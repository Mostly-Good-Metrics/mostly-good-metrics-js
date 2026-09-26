import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { build } from 'esbuild';
import { chromium } from 'playwright-core';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const chromeCandidates = [
  process.env.CHROME_PATH,
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/google-chrome-stable',
  '/usr/bin/chromium',
  '/usr/bin/chromium-browser',
].filter(Boolean);
const executablePath = chromeCandidates.find(existsSync);

assert.ok(executablePath, `Chrome not found; checked: ${chromeCandidates.join(', ')}`);

const scratchDirectory = mkdtempSync(join(tmpdir(), 'mgm-browser-storage-'));
const bundlePath = join(scratchDirectory, 'mgm.js');
const harnessPath = join(scratchDirectory, 'index.html');

try {
  await build({
    entryPoints: [join(repositoryRoot, 'src/index.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'MGM',
    outfile: bundlePath,
    logLevel: 'silent',
  });
  writeFileSync(harnessPath, '<!doctype html><title>MGM browser storage test</title>');

  const browser = await chromium.launch({ executablePath, headless: true });
  try {
    const page = await browser.newPage();
    await page.goto(`file://${harnessPath}`);
    await page.addScriptTag({ path: bundlePath });

    const deferredResult = await page.evaluate(() => {
      const eventStorageKey = 'mostlygoodmetrics_events';
      const originalSetItem = Storage.prototype.setItem;
      window.__mgmEventWrites = 0;
      Storage.prototype.setItem = function (key, value) {
        if (key === eventStorageKey) window.__mgmEventWrites += 1;
        return originalSetItem.call(this, key, value);
      };

      const seed = Array.from({ length: 10_000 }, (_, index) => ({
        name: 'seed_event',
        client_event_id: `seed-${index}`,
        timestamp: '2026-09-25T12:34:56.789Z',
        platform: 'web',
        environment: 'test',
        properties: { index },
      }));
      localStorage.clear();
      originalSetItem.call(localStorage, eventStorageKey, JSON.stringify(seed));

      MGM.MostlyGoodMetrics.configure({
        apiKey: 'browser-test',
        collectDeviceProperties: false,
        flushInterval: 3600,
        maxBatchSize: 1000,
        maxStoredEvents: 10_000,
        trackAppLifecycleEvents: false,
        trackPageViews: false,
        networkClient: {
          isRateLimited: () => true,
          getRetryAfterTime: () => null,
          sendEvents: async () => ({ success: true }),
        },
      });

      const writesBeforeTrack = window.__mgmEventWrites;
      MGM.MostlyGoodMetrics.track('deferred_event');
      return {
        writesBeforeTrack,
        writesAfterTrack: window.__mgmEventWrites,
      };
    });

    assert.equal(
      deferredResult.writesAfterTrack,
      deferredResult.writesBeforeTrack,
      'track() synchronously wrote the full queue to localStorage'
    );

    await page.waitForFunction(() => window.__mgmEventWrites > 0, null, { timeout: 3000 });

    const teardownResult = await page.evaluate(() => {
      const eventStorageKey = 'mostlygoodmetrics_events';

      MGM.MostlyGoodMetrics.track('pagehide_event');
      window.dispatchEvent(new PageTransitionEvent('pagehide'));
      const afterPageHide = JSON.parse(localStorage.getItem(eventStorageKey) ?? '[]');

      MGM.MostlyGoodMetrics.track('visibility_event');
      Object.defineProperty(document, 'hidden', { configurable: true, value: true });
      document.dispatchEvent(new Event('visibilitychange'));
      const afterVisibilityChange = JSON.parse(localStorage.getItem(eventStorageKey) ?? '[]');

      return {
        pageHidePersisted: afterPageHide.some((event) => event.name === 'pagehide_event'),
        visibilityPersisted: afterVisibilityChange.some(
          (event) => event.name === 'visibility_event'
        ),
        storedAsArray: Array.isArray(afterVisibilityChange),
      };
    });

    assert.equal(teardownResult.pageHidePersisted, true, 'pagehide lost a deferred event');
    assert.equal(
      teardownResult.visibilityPersisted,
      true,
      'hidden visibilitychange lost a deferred event'
    );
    assert.equal(teardownResult.storedAsArray, true, 'the persisted queue format changed');

    const remainingDuplicateId = await page.evaluate(async () => {
      MGM.MostlyGoodMetrics.reset();
      localStorage.clear();
      const storage = new MGM.LocalStorageEventStorage(100);
      const timestamp = '2026-09-25T12:34:56.789Z';
      await Promise.all([
        storage.store({
          name: 'duplicate',
          client_event_id: 'first-id',
          timestamp,
          platform: 'web',
          environment: 'test',
        }),
        storage.store({
          name: 'duplicate',
          client_event_id: 'second-id',
          timestamp,
          platform: 'web',
          environment: 'test',
        }),
      ]);
      await storage.removeEvents(1, ['first-id']);
      return (await storage.fetchEvents(10))[0]?.client_event_id;
    });

    assert.equal(
      remainingDuplicateId,
      'second-id',
      'flush cleanup removed both same-name, same-timestamp events'
    );
  } finally {
    await browser.close();
  }

  console.log('Browser storage regression tests passed');
} finally {
  rmSync(scratchDirectory, { recursive: true, force: true });
}
