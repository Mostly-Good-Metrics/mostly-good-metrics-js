/* Seeded consumer stress: real promise jobs, strict rejection mode, no network. */
const assert = require('node:assert/strict');
const path = require('node:path');
const sdk = require(path.resolve(process.argv[2] || path.join(__dirname, '../dist/cjs/index.js')));
const { MostlyGoodMetrics, InMemoryEventStorage, MGMError } = sdk;
const turn = () => new Promise((resolve) => setImmediate(resolve));
const seeds = [0x5eed, 17, 65537, 0x12345678];
const activeTimeouts = new Set();
const activeIntervals = new Set();
const native = { setTimeout, clearTimeout, setInterval, clearInterval };
global.setTimeout = (callback, milliseconds, ...args) => {
  let id;
  id = native.setTimeout(() => {
    activeTimeouts.delete(id);
    callback(...args);
  }, milliseconds);
  activeTimeouts.add(id);
  return id;
};
global.clearTimeout = (id) => {
  activeTimeouts.delete(id);
  native.clearTimeout(id);
};
global.setInterval = (...args) => {
  const id = native.setInterval(...args);
  activeIntervals.add(id);
  return id;
};
global.clearInterval = (id) => {
  activeIntervals.delete(id);
  native.clearInterval(id);
};
// Silence intentional SDK diagnostics; do not install process error/rejection handlers.
console.error = console.warn = () => {};
global.fetch = async () => {
  throw new Error('Unexpected real network path');
};

function properties(kind) {
  const cycle = {};
  cycle.self = cycle;
  const recursive = [];
  recursive.push(recursive);
  const getter = { good: 'kept' };
  Object.defineProperty(getter, 'bad', {
    enumerable: true,
    get() {
      throw new Error('getter failure');
    },
  });
  const array = [1, 2];
  Object.defineProperty(array, 1, {
    get() {
      throw new Error('array getter');
    },
  });
  return [
    { normal: { value: 'ok' } },
    { cycle },
    { recursive },
    getter,
    new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('proxy failure');
        },
      }
    ),
    { sparse: new Array(4_000_000_000) },
    { bigint: 1n, number: NaN },
    { array },
  ][kind];
}

async function stress(seed) {
  let state = seed >>> 0;
  const random = (n) => {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    return state % n;
  };
  for (let session = 0; session < 16; session++) {
    let fault = 0,
      faultsEnabled = true;
    const queue = new InMemoryEventStorage(100);
    const sent = [];
    const invoke = (operation, call) => {
      if (faultsEnabled && fault === operation) throw new Error('synthetic sync adapter failure');
      if (faultsEnabled && fault === operation + 5)
        return Promise.reject(new Error('synthetic async adapter failure'));
      return call();
    };
    const storage = {
      store: (event) => invoke(1, () => queue.store(event)),
      eventCount: () => invoke(2, () => queue.eventCount()),
      fetchEvents: (limit) => invoke(3, () => queue.fetchEvents(limit)),
      removeEvents: (count, ids) => invoke(4, () => queue.removeEvents(count, ids)),
      clear: () => invoke(5, () => queue.clear()),
    };
    const networkClient = {
      async sendEvents(payload) {
        if (faultsEnabled && fault % 3 === 1) throw new Error('synthetic send rejection');
        if (faultsEnabled && fault % 3 === 2)
          return {
            success: false,
            shouldRetry: true,
            error: new MGMError('NETWORK_ERROR', 'synthetic offline'),
          };
        sent.push(...payload.events);
        return { success: true };
      },
      isRateLimited() {
        if (faultsEnabled && fault === 10) throw new Error('rate limit getter failure');
        return false;
      },
      getRetryAfterTime() {
        return null;
      },
    };
    const corrupted = ['null', '{}', '3', '[null]', '{invalid'][session % 5];
    const client = MostlyGoodMetrics.configure({
      apiKey: 'offline-stress',
      persistence: 'memory',
      storage,
      networkClient,
      maxBatchSize: 50,
      maxStoredEvents: 100,
      flushInterval: [NaN, Infinity, 1e100, 30][session % 4],
      experimentMode: 'local',
      localExperiments: [
        { id: 'valid', name: 'experiment', variants: ['control'] },
        { id: 'invalid', name: 'malformed' },
      ],
      experimentStorage: {
        getItem: async () => corrupted,
        setItem: async () => {
          if (faultsEnabled && fault === 11) throw new Error('experiment persistence');
        },
      },
      contextProvider: () => {
        if (!faultsEnabled) return { recovered: true };
        if (fault === 0) throw new Error('provider failure');
        if (fault === 1) return Promise.reject(new Error('provider async failure'));
        if (fault === 2) MostlyGoodMetrics.track('provider_reentry');
        return properties(random(8));
      },
      onError: async () => {
        if (faultsEnabled) throw new Error('onError async failure');
      },
    });
    await client.ready();
    for (let iteration = 0; iteration < 40; iteration++) {
      fault = random(12);
      const value = properties(random(8));
      switch (random(13)) {
        case 0:
          client.track('stress_event', value);
          break;
        case 1:
          client.setSuperProperties(value);
          break;
        case 2:
          client.setSuperProperty('stress', value);
          break;
        case 3:
          client.removeSuperProperty('stress');
          break;
        case 4:
          client.identify('stress_user', {
            get email() {
              throw new Error('profile getter');
            },
            name: 'safe',
          });
          break;
        case 5:
          client.resetIdentity({ clearAnonymousId: true });
          break;
        case 6:
          client.resetAnonymousId();
          break;
        case 7:
          client.startNewSession();
          break;
        case 8:
          client.optOut();
          client.optIn();
          break;
        case 9:
          client.getVariant('experiment', 'fallback');
          break;
        case 10:
          await client.flush().catch(() => {});
          break;
        case 11:
          await client.clearPendingEvents().catch(() => {});
          break;
        case 12:
          await client.getPendingEventCount().catch(() => {});
          break;
      }
      await turn();
      assert.equal(client.isFlushing, false);
      assert.ok((await queue.eventCount()) <= 100);
    }
    faultsEnabled = false;
    client.optIn();
    client.clearSuperProperties();
    const recoveryName = `recovery_${seed}_${session}`;
    client.track(recoveryName, { recovered: true });
    await turn();
    await client.flush();
    assert.ok(
      sent.some((event) => event.name === recoveryName),
      'SDK did not recover after injected failures'
    );
    assert.equal(await queue.eventCount(), 0);
    MostlyGoodMetrics.reset();
    await turn();
    assert.equal(activeIntervals.size, 0, 'SDK interval leaked across reset');
    assert.equal(activeTimeouts.size, 0, 'SDK timeout leaked across reset');
    assert.equal(MostlyGoodMetrics.isConfigured, false);
  }
  console.log(`PASS seed=${seed} sessions=16 operations=640`);
}
(async () => {
  try {
    for (const seed of seeds) await stress(seed);
  } finally {
    MostlyGoodMetrics.reset();
    Object.assign(global, native);
  }
})().catch((error) => {
  process.stderr.write(`${error.stack}\n`);
  process.exitCode = 1;
});
