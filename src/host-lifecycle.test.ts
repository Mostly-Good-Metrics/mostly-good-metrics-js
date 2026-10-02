import { TextEncoder, TextDecoder } from 'util';
import { ReadableStream } from 'stream/web';
import { MostlyGoodMetrics } from './client';
import {
  flushPendingStorageWrites,
  InMemoryEventStorage,
  InMemoryExperimentStorage,
  LocalStorageEventStorage,
  persistence,
} from './storage';
import { MGMConfiguration } from './types';

const drain = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe('browser and teardown failure recovery', () => {
  let storage: InMemoryEventStorage;
  let pushDescriptor: PropertyDescriptor | undefined;
  beforeEach(() => {
    jest.useFakeTimers();
    MostlyGoodMetrics.reset();
    localStorage.clear();
    persistence.configurePersistence('memory');
    persistence.setOptOutStatus(false);
    persistence.setUserId(null);
    storage = new InMemoryEventStorage();
    pushDescriptor = Object.getOwnPropertyDescriptor(history, 'pushState');
    jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    jest.restoreAllMocks();
    if (pushDescriptor) Object.defineProperty(history, 'pushState', pushDescriptor);
    else Reflect.deleteProperty(history, 'pushState');
    MostlyGoodMetrics.reset();
    jest.useRealTimers();
  });
  const configure = (extra: Partial<MGMConfiguration> = {}) =>
    MostlyGoodMetrics.configure({
      apiKey: 'offline-test',
      persistence: 'memory',
      storage,
      experimentMode: 'local',
      localExperiments: [],
      experimentStorage: new InMemoryExperimentStorage(),
      networkClient: {
        sendEvents: async () => ({ success: true }),
        isRateLimited: () => false,
        getRetryAfterTime: () => null,
      },
      ...extra,
    });

  it('does not fail initialization when a router makes history immutable', () => {
    Object.defineProperty(history, 'pushState', {
      configurable: true,
      writable: false,
      value: history.pushState,
    });
    expect(() => configure({ trackPageViews: true })).not.toThrow();
    expect(MostlyGoodMetrics.isConfigured).toBe(true);
  });

  it('does not break host navigation when page metadata access throws', async () => {
    configure({ trackPageViews: true });
    const title = jest.spyOn(Document.prototype, 'title', 'get').mockImplementation(() => {
      throw new Error('metadata unavailable');
    });
    expect(() => history.pushState({}, '', '/metadata_failure')).not.toThrow();
    expect(location.pathname).toBe('/metadata_failure');
    title.mockRestore();
    history.pushState({}, '', '/metadata_recovered');
    await drain();
    expect(
      (await storage.fetchEvents(100)).some(
        (event) => event.properties?.pathname === '/metadata_recovered'
      )
    ).toBe(true);
  });

  it('preserves router return values and restores the original function identity', async () => {
    const expected = Promise.resolve('router result');
    const original = jest.fn(() => expected);
    Object.defineProperty(history, 'pushState', {
      configurable: true,
      writable: true,
      value: original,
    });
    configure({ trackPageViews: true });
    const result = (history.pushState as unknown as (...args: unknown[]) => unknown)(
      {},
      '',
      '/router'
    );
    expect(result).toBe(expected);
    await expected;
    MostlyGoodMetrics.reset();
    expect(history.pushState).toBe(original);
  });

  it('does not overwrite a router hook installed after the SDK', () => {
    configure({ trackPageViews: true });
    const routerHook = jest.fn();
    history.pushState = routerHook;
    MostlyGoodMetrics.reset();
    expect(history.pushState).toBe(routerHook);
  });

  it('preserves native history exceptions', () => {
    configure({ trackPageViews: true });
    expect(() => history.pushState({}, '', 'https://different-origin.invalid/')).toThrow();
  });

  it('continues cleanup and allows reconfigure when host listener removal throws', () => {
    configure({ trackPageViews: true, trackAppLifecycleEvents: true });
    jest.spyOn(window, 'removeEventListener').mockImplementation(() => {
      throw new Error('instrumented remove failed');
    });
    expect(() => MostlyGoodMetrics.reset()).not.toThrow();
    expect(MostlyGoodMetrics.isConfigured).toBe(false);
    expect(jest.getTimerCount()).toBe(0);
    expect(() => configure()).not.toThrow();
  });

  it('detaches document listeners across repeated resets even if the host replaces removal', () => {
    const active = new Set<EventListenerOrEventListenerObject>();
    const originalAdd = document.addEventListener.bind(document);
    const originalRemove = document.removeEventListener.bind(document);
    for (let cycle = 0; cycle < 8; cycle++) {
      const add = jest
        .spyOn(document, 'addEventListener')
        .mockImplementation((type, listener, options) => {
          if (type === 'visibilitychange') active.add(listener);
          originalAdd(type, listener, options);
        });
      document.removeEventListener = (type, listener, options) => {
        active.delete(listener);
        originalRemove(type, listener, options);
      };
      configure({ trackPageViews: true, trackAppLifecycleEvents: true });
      expect(active.size).toBe(3);
      // The SDK retained the previously installed remover implementation.
      Object.defineProperty(document, 'removeEventListener', {
        configurable: true,
        value: () => {
          throw new Error('host remover replaced');
        },
      });
      MostlyGoodMetrics.reset();
      expect(active.size).toBe(0);
      add.mockRestore();
      Object.defineProperty(document, 'removeEventListener', {
        configurable: true,
        writable: true,
        value: originalRemove,
      });
    }
  });

  it('releases timed-out readiness waiters while custom initialization stays pending', async () => {
    const cache = new InMemoryExperimentStorage();
    jest.spyOn(cache, 'getItem').mockImplementation(() => new Promise(() => {}));
    const client = configure({ experimentStorage: cache });
    const waits = Array.from({ length: 100 }, () => client.ready(1));
    await jest.advanceTimersByTimeAsync(1);
    await Promise.all(waits);
    expect(jest.getTimerCount()).toBe(1);
    expect((client as unknown as { readyWaiters: Set<unknown> }).readyWaiters.size).toBe(0);
  });

  it('bounds repeated identity refreshes and ignores older response completion', async () => {
    const requests: { signal: AbortSignal; complete: (response: unknown) => void }[] = [];
    global.fetch = jest.fn(
      (_url, init) =>
        new Promise((resolve) => {
          requests.push({ signal: init?.signal as AbortSignal, complete: resolve });
        })
    ) as jest.Mock;
    const client = configure({ experimentMode: 'server', localExperiments: undefined });
    await drain();
    for (let i = 0; i < 20; i++) client.identify(`user_${i}`);
    await drain();
    expect(requests.length).toBe(21);
    expect(requests.filter((request) => !request.signal.aborted)).toHaveLength(1);
    expect(jest.getTimerCount()).toBe(2); // one flush interval, one request timeout
    requests[20].complete({
      ok: true,
      json: async () => ({ assigned_variants: { feature: 'latest' } }),
    });
    await drain();
    requests[0].complete({
      ok: true,
      json: async () => ({ assigned_variants: { feature: 'obsolete' } }),
    });
    await drain();
    expect(client.getVariant('feature', 'fallback')).toBe('latest');
    for (const request of requests.slice(1, 20)) request.complete({ ok: false });
    await drain();
  });

  it('drops capture if a reentrant provider destroys its SDK', async () => {
    const client = configure({
      contextProvider: () => {
        MostlyGoodMetrics.reset();
        return { safe: true };
      },
    });
    client.track('destroyed_capture');
    await drain();
    expect(await storage.eventCount()).toBe(0);
  });

  it('cancels experiment request resources and ignores a late response after destroy', async () => {
    let complete!: (response: unknown) => void;
    let signal: AbortSignal | undefined;
    global.fetch = jest.fn((_url, init) => {
      signal = init?.signal as AbortSignal;
      return new Promise((resolve) => {
        complete = resolve;
      });
    }) as jest.Mock;
    const experimentStorage = new InMemoryExperimentStorage();
    const write = jest.spyOn(experimentStorage, 'setItem');
    const old = configure({
      experimentMode: 'server',
      localExperiments: undefined,
      experimentStorage,
    });
    await drain();
    expect(signal?.aborted).toBe(false);
    MostlyGoodMetrics.reset();
    expect(signal?.aborted).toBe(true);
    expect(jest.getTimerCount()).toBe(0);
    configure({ experimentStorage });
    complete({ ok: true, json: async () => ({ assigned_variants: { stale: 'old' } }) });
    await drain();
    expect(old.getVariant('stale', 'fallback')).toBe('fallback');
    expect(write).not.toHaveBeenCalled();
  });

  it('cancels default event delivery and clears its timeout when the SDK is destroyed', async () => {
    global.TextEncoder = TextEncoder;
    let signal: AbortSignal | undefined;
    global.fetch = jest.fn((_url, init) => {
      signal = init?.signal as AbortSignal;
      return new Promise((_resolve, reject) =>
        signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
      );
    }) as jest.Mock;
    const client = configure({ networkClient: undefined });
    client.track('inflight_event');
    await drain();
    const flush = client.flush();
    await drain();
    expect(signal?.aborted).toBe(false);
    MostlyGoodMetrics.reset();
    expect(signal?.aborted).toBe(true);
    await flush;
    expect(jest.getTimerCount()).toBe(0);
    expect(await storage.eventCount()).toBe(1);
  });

  it.each([null, 3, ['invalid'], { feature: null }])(
    'rejects malformed cached variants %s before app feature selection',
    async (variants) => {
      const cache = new InMemoryExperimentStorage();
      cache.setItem(
        'mgm_experiment_variants',
        JSON.stringify({ userId: 'known', variants, fetchedAt: Date.now() })
      );
      global.fetch = jest.fn(async () => ({
        ok: true,
        json: async () => ({ assigned_variants: { feature: 'valid' } }),
      })) as jest.Mock;
      const client = configure({
        anonymousId: 'known',
        experimentMode: 'server',
        localExperiments: undefined,
        experimentStorage: cache,
      });
      await drain();
      expect(() => client.getVariant('feature', 'control')).not.toThrow();
      expect(client.getVariant('feature', 'control')).toBe('valid');
    }
  );

  it.each(['memory', 'local'] as const)(
    'evicts oldest default %s queue entries by bytes and preserves recovery',
    async (mode) => {
      const queue =
        mode === 'memory' ? new InMemoryEventStorage(10000) : new LocalStorageEventStorage(10000);
      const pending = [];
      for (let i = 0; i < 160; i++)
        pending.push(
          queue.store({
            name: 'large',
            timestamp: '2026-10-02',
            platform: 'web',
            environment: 'test',
            client_event_id: String(i),
            properties: { a: String(i) + 'a'.repeat(9000) },
          })
        );
      await jest.runOnlyPendingTimersAsync();
      await Promise.all(pending);
      const retained = await queue.fetchEvents(10000);
      expect(retained.length).toBeGreaterThan(0);
      expect(retained.length).toBeLessThan(160);
      expect(retained[retained.length - 1].client_event_id).toBe('159');
      expect(JSON.stringify(retained).length).toBeLessThan(1024 * 1024 + 1000);
      const removed = retained.slice(0, 10).map((event) => event.client_event_id!);
      const remove = queue.removeEvents(10, removed);
      await jest.runOnlyPendingTimersAsync();
      await remove;
      const store = queue.store({
        name: 'recovery',
        timestamp: '2026-10-02',
        platform: 'web',
        environment: 'test',
        client_event_id: 'recovery',
      });
      await jest.runOnlyPendingTimersAsync();
      await store;
      const final = await queue.fetchEvents(10000);
      expect(final[final.length - 1].name).toBe('recovery');
      expect(final.some((event) => removed.includes(event.client_event_id!))).toBe(false);
    }
  );

  it('ignores oversized persisted queues before attempting JSON parsing', async () => {
    localStorage.setItem('mostlygoodmetrics_events', '[' + ' '.repeat(1024 * 1024) + ']');
    const parse = jest.spyOn(JSON, 'parse');
    expect(await new LocalStorageEventStorage().eventCount()).toBe(0);
    expect(parse).not.toHaveBeenCalled();
  });

  it('keeps ready non-rejecting when a host timer integration throws', async () => {
    const client = configure();
    jest.spyOn(global, 'setTimeout').mockImplementation(() => {
      throw new Error('timer unavailable');
    });
    await expect(client.ready()).resolves.toBeUndefined();
    await drain();
  });

  it('falls back from unavailable native crypto implementations during initialization and identity reset', () => {
    jest.spyOn(crypto, 'getRandomValues').mockImplementation(() => {
      throw new Error('native crypto module unavailable');
    });
    expect(() => configure({ persistence: 'localStorage' })).not.toThrow();
    const client = MostlyGoodMetrics.shared!;
    expect(() => client.resetAnonymousId()).not.toThrow();
    expect(client.anonymousId).toMatch(/^\$anon_[a-z0-9]{12}$/);
  });

  it.each([false, true])(
    'bounds streamed experiment responses before parsing oversized=%s',
    async (oversized) => {
      global.TextDecoder = TextDecoder as typeof global.TextDecoder;
      global.TextEncoder = TextEncoder;
      const json = jest.fn(() => {
        throw new Error('unbounded parser must not run');
      });
      const bytes = oversized
        ? new Uint8Array(1024 * 1024 + 1)
        : new TextEncoder().encode(JSON.stringify({ assigned_variants: { feature: 'valid' } }));
      global.fetch = jest.fn(async () => ({
        ok: true,
        headers: new Headers(),
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(bytes);
            controller.close();
          },
        }),
        json,
      })) as jest.Mock;
      const client = configure({ experimentMode: 'server', localExperiments: undefined });
      await client.ready();
      expect(client.getVariant('feature', 'control')).toBe(oversized ? 'control' : 'valid');
      expect(json).not.toHaveBeenCalled();
    }
  );

  it('falls back when requestIdleCallback throws and can persist later events', async () => {
    Object.defineProperty(window, 'requestIdleCallback', {
      configurable: true,
      value: () => {
        throw new Error('scheduler unavailable');
      },
    });
    try {
      const queue = new LocalStorageEventStorage();
      const first = queue.store({
        name: 'first',
        timestamp: '2026-10-02',
        platform: 'web',
        environment: 'test',
      });
      await jest.runOnlyPendingTimersAsync();
      await expect(first).resolves.toBeUndefined();
      const second = queue.store({
        name: 'second',
        timestamp: '2026-10-02',
        platform: 'web',
        environment: 'test',
      });
      flushPendingStorageWrites(queue);
      await expect(second).resolves.toBeUndefined();
      expect(JSON.parse(localStorage.getItem('mostlygoodmetrics_events')!)).toHaveLength(2);
    } finally {
      Reflect.deleteProperty(window, 'requestIdleCallback');
    }
  });
});
