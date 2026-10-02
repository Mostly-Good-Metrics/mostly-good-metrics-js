/* Exercise the built consumer package without handlers masking host failures. */
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const scenarios = ['properties', 'provider', 'onError', 'storage', 'network', 'logger', 'timer'];
const turn = () => new Promise((resolve) => setImmediate(resolve));

async function exercise(scenario, modulePath) {
  const { MostlyGoodMetrics, MGMError } = require(modulePath);
  const events = [];
  let notifySend;
  const sent = new Promise((resolve) => { notifySend = resolve; });
  const storage = {
    async store(event) {
      events.push(event);
    },
    async eventCount() {
      if (scenario === 'storage') throw new Error('synthetic count failure');
      return events.length;
    },
    async fetchEvents(limit) { return events.slice(0, limit); },
    async removeEvents(count) { events.splice(0, count); },
    async clear() { events.length = 0; },
  };
  const networkClient = {
    async sendEvents() {
      notifySend();
      if (scenario === 'onError') {
        return { success: false, error: new MGMError('NETWORK_ERROR', 'synthetic send failure'), shouldRetry: true };
      }
      throw new Error('synthetic network failure');
    },
    isRateLimited() { return false; },
    getRetryAfterTime() { return null; },
  };
  const originalConsole = {};
  if (scenario === 'logger') {
    for (const method of ['debug', 'log', 'warn', 'error', 'info']) {
      originalConsole[method] = console[method];
      console[method] = () => { throw new Error('synthetic logger failure'); };
    }
  }
  try {
    MostlyGoodMetrics.configure({
      apiKey: 'mgm_test_offline',
      persistence: 'memory',
      collectDeviceProperties: false,
      trackAppLifecycleEvents: false,
      experimentMode: 'local',
      localExperiments: [],
      enableDebugLogging: scenario === 'logger',
      maxBatchSize: scenario === 'network' || scenario === 'onError' ? 1 : 100,
      flushInterval: scenario === 'timer' ? 1 : 30,
      storage,
      networkClient,
      ...(scenario === 'provider' && {
        contextProvider: async () => { throw new Error('synthetic provider rejection'); },
      }),
      ...(scenario === 'onError' && {
        onError: async () => { throw new Error('synthetic onError rejection'); },
      }),
    });
    const properties = { good: 'retained' };
    if (scenario === 'properties') {
      Object.defineProperty(properties, 'broken', {
        enumerable: true,
        get() { throw new Error('synthetic property getter failure'); },
      });
    }
    MostlyGoodMetrics.track('crash_safety_probe', properties);
    // Drain real promise jobs. No fake timers or process error listeners.
    for (let i = 0; i < 5; i++) await turn();
    if (scenario === 'properties') {
      assert.equal(events[0].properties.good, 'retained');
      assert.equal(events[0].properties.broken, undefined);
    }
    if (scenario === 'network' || scenario === 'timer' || scenario === 'onError') {
      await sent;
      await turn();
    }
    if (scenario === 'storage') {
      await assert.rejects(MostlyGoodMetrics.getPendingEventCount(), /synthetic count failure/);
    }
    if (scenario === 'network') {
      // Explicitly awaited operations retain their rejection contract.
      await assert.rejects(MostlyGoodMetrics.flush(), /synthetic network failure/);
    }
  } finally {
    MostlyGoodMetrics.reset();
    Object.assign(console, originalConsole);
  }
  await turn();
}

if (process.argv[2] === '--scenario') {
  exercise(process.argv[3], process.argv[4]).catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
} else {
  const modulePath = path.resolve(process.argv[2] || path.join(__dirname, '../dist/cjs/index.js'));
  let failures = 0;
  for (const scenario of scenarios) {
    const result = spawnSync(process.execPath,
      ['--unhandled-rejections=strict', __filename, '--scenario', scenario, modulePath],
      { encoding: 'utf8', timeout: 5000 });
    if (result.status !== 0 || result.error) {
      failures++;
      console.error(`FAIL ${scenario}: ${result.error || result.stderr || result.stdout}`);
    } else {
      console.log(`PASS ${scenario}`);
    }
  }
  process.exitCode = failures ? 1 : 0;
}
