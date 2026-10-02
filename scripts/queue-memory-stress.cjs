const assert = require('node:assert/strict');
const { randomBytes } = require('node:crypto');
const { MostlyGoodMetrics } = require('../dist/cjs/index.js');
console.error = console.warn = () => {};
const client = MostlyGoodMetrics.configure({
  apiKey: 'offline-heap-test',
  persistence: 'memory',
  collectDeviceProperties: false,
  maxStoredEvents: 10000,
  experimentMode: 'local',
  localExperiments: [],
  networkClient: {
    isRateLimited: () => true,
    getRetryAfterTime: () => null,
    sendEvents: async () => {
      throw new Error('unexpected network');
    },
  },
});
(async () => {
  try {
    await client.ready();
    for (let i = 0; i < 12000; i++) {
      const properties = {};
      for (let key = 0; key < 9; key++)
        properties[`property_${key}`] = randomBytes(750).toString('base64');
      client.track('queue_memory_probe', properties);
      if (i % 100 === 0) await new Promise((resolve) => setImmediate(resolve));
    }
    await new Promise((resolve) => setImmediate(resolve));
    const retained = await client.getPendingEventCount();
    assert.ok(retained > 0 && retained < 500);
    await client.clearPendingEvents();
    for (let i = 0; i < 200; i++) {
      client.track('truncated_large_source', { value: randomBytes(750_000).toString('base64') });
      await new Promise((resolve) => setImmediate(resolve));
    }
    await client.clearPendingEvents();
    for (let i = 0; i < 200; i++) {
      client.track('already_sliced_source', {
        value: randomBytes(750_000).toString('base64').substring(0, 1000),
      });
      await new Promise((resolve) => setImmediate(resolve));
    }
    const before = await client.getPendingEventCount();
    client.track('queue_recovery', { small: true });
    await new Promise((resolve) => setImmediate(resolve));
    assert.ok((await client.getPendingEventCount()) > 0);
    console.log(`PASS constrained-heap queue:12000 max-size captures retained=${before}`);
  } finally {
    MostlyGoodMetrics.reset();
  }
})().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
