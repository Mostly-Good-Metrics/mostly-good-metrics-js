import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import { chromium } from 'playwright-core';
const root = fileURLToPath(new URL('..', import.meta.url));
const chrome = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
].find((value) => value && existsSync(value));
assert.ok(chrome, 'Chrome is required for host-boundary checks');
const scratch = mkdtempSync(join(tmpdir(), 'mgm-host-boundaries-'));
const errors = [];
let browser;
try {
  await build({
    entryPoints: [join(root, 'dist/esm/index.js')],
    bundle: true,
    minify: true,
    format: 'iife',
    globalName: 'MGM',
    outfile: join(scratch, 'sdk.js'),
  });
  writeFileSync(join(scratch, 'index.html'), '<title>MGM offline host-boundary test</title>');
  browser = await chromium.launch({ executablePath: chrome, headless: true });
  const page = await browser.newPage();
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto(`file://${join(scratch, 'index.html')}`);
  await page.addScriptTag({ path: join(scratch, 'sdk.js') });
  const result = await page.evaluate(async () => {
    // Keep the browser entirely offline, including accidental experiment fetches.
    const nativeFetch = window.fetch;
    window.fetch = async () => {
      throw new Error('Unexpected live fetch');
    };
    const nativePush = Object.getOwnPropertyDescriptor(history, 'pushState');
    const nativeAdd = window.addEventListener;
    const nativeRemove = window.removeEventListener;
    const nativeIdle = window.requestIdleCallback;
    const nativeCancelIdle = window.cancelIdleCallback;
    const nativeTitle = Object.getOwnPropertyDescriptor(Document.prototype, 'title');
    const nativeInterval = window.setInterval;
    const nativeClear = window.clearInterval;
    const intervals = new Set();
    window.setInterval = (...args) => {
      const id = nativeInterval(...args);
      intervals.add(id);
      return id;
    };
    window.clearInterval = (id) => {
      intervals.delete(id);
      nativeClear(id);
    };
    const tick = () => new Promise((resolve) => setTimeout(resolve, 0));
    const checks = [];
    const check = (condition, message) => {
      if (!condition) throw new Error(message);
      checks.push(message);
    };
    const configure = (extra) =>
      MGM.MostlyGoodMetrics.configure({
        apiKey: 'offline-browser',
        persistence: 'memory',
        trackPageViews: true,
        trackAppLifecycleEvents: true,
        appVersion: 'test',
        collectDeviceProperties: false,
        experimentMode: 'local',
        localExperiments: [],
        storage: new MGM.InMemoryEventStorage(100),
        networkClient: {
          sendEvents: async () => ({ success: true }),
          isRateLimited: () => false,
          getRetryAfterTime: () => null,
        },
        ...extra,
      });
    try {
      for (let cycle = 0; cycle < 12; cycle++) {
        Object.defineProperty(history, 'pushState', {
          configurable: true,
          writable: false,
          value: history.pushState,
        });
        const instance = configure();
        check(MGM.MostlyGoodMetrics.isConfigured, 'readonly history initialization survived');
        await tick();
        Object.defineProperty(Document.prototype, 'title', {
          configurable: true,
          get() {
            throw new Error('metadata getter failure');
          },
          set: nativeTitle.set,
        });
        window.dispatchEvent(new PopStateEvent('popstate'));
        Object.defineProperty(document, 'hidden', {
          configurable: true,
          get() {
            throw new Error('visibility getter failure');
          },
        });
        document.dispatchEvent(new Event('visibilitychange'));
        window.dispatchEvent(new PageTransitionEvent('pagehide'));
        await tick();
        delete document.hidden;
        Object.defineProperty(Document.prototype, 'title', nativeTitle);
        window.removeEventListener = () => {
          throw new Error('host cleanup wrapper failure');
        };
        MGM.MostlyGoodMetrics.reset();
        check(intervals.size === 0, 'reset cleared all SDK intervals despite hook failure');
        check(!MGM.MostlyGoodMetrics.isConfigured, 'reset cleared singleton despite hook failure');
        window.removeEventListener = nativeRemove;
        if (nativePush) Object.defineProperty(history, 'pushState', nativePush);
        else delete history.pushState;
        const queue = new MGM.LocalStorageEventStorage(100);
        window.requestIdleCallback = () => {
          throw new Error('idle scheduling failure');
        };
        const stored = queue.store({
          name: 'idle_recovery',
          timestamp: '2026-10-02',
          platform: 'web',
          environment: 'test',
        });
        await stored;
        check(
          (await queue.fetchEvents(100)).some((event) => event.name === 'idle_recovery'),
          'failed idle scheduler recovered'
        );
        await queue.clear();
        window.requestIdleCallback = nativeIdle;
        const recovered = configure({ trackPageViews: false });
        recovered.track('recovered');
        await tick();
        await recovered.flush();
        check(
          (await recovered.getPendingEventCount()) === 0,
          'delivery recovered after host failures'
        );
        MGM.MostlyGoodMetrics.reset();
        await tick();
        check(intervals.size === 0, 'repeated init/reset kept interval count bounded');
        void instance;
      }
      // Failed listener removal leaves inert handlers. Exercise them afterward.
      window.dispatchEvent(new PopStateEvent('popstate'));
      window.dispatchEvent(new PageTransitionEvent('pagehide'));
      await tick();
      return { checks: checks.length, cycles: 12, intervals: intervals.size };
    } finally {
      MGM.MostlyGoodMetrics.reset();
      Object.defineProperty(Document.prototype, 'title', nativeTitle);
      delete document.hidden;
      if (nativePush) Object.defineProperty(history, 'pushState', nativePush);
      else delete history.pushState;
      Object.assign(window, {
        fetch: nativeFetch,
        addEventListener: nativeAdd,
        removeEventListener: nativeRemove,
        requestIdleCallback: nativeIdle,
        cancelIdleCallback: nativeCancelIdle,
        setInterval: nativeInterval,
        clearInterval: nativeClear,
      });
    }
  });
  assert.deepEqual(errors, [], 'SDK caused uncaught browser errors/rejections');
  assert.equal(result.intervals, 0);
  console.log(
    `PASS optimized Chrome host boundaries: ${result.cycles} cycles, ${result.checks} assertions, zero uncaught errors`
  );
} finally {
  if (browser) await browser.close();
  rmSync(scratch, { recursive: true, force: true });
}
