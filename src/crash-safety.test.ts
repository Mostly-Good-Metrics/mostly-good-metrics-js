import { MostlyGoodMetrics } from './client';
import {
  InMemoryEventStorage,
  InMemoryExperimentStorage,
  LocalStorageEventStorage,
  persistence,
} from './storage';
import { EventProperties, INetworkClient, MGMError, MGMExperimentConfig } from './types';
import { logger } from './logger';

const settle = async (): Promise<void> => {
  for (let i = 0; i < 20; i++) await Promise.resolve();
};

describe('host application failure containment', () => {
  let storage: InMemoryEventStorage;
  const network: INetworkClient = {
    sendEvents: async () => ({ success: true }),
    isRateLimited: () => false,
    getRetryAfterTime: () => null,
  };
  beforeEach(() => {
    MostlyGoodMetrics.reset();
    localStorage.clear();
    persistence.configurePersistence('memory');
    persistence.setOptOutStatus(false);
    persistence.setUserId(null);
    persistence.clearSuperProperties();
    storage = new InMemoryEventStorage();
  });
  afterEach(() => {
    MostlyGoodMetrics.reset();
  });
  const configure = (extra = {}) =>
    MostlyGoodMetrics.configure({
      apiKey: 'test-key',
      persistence: 'memory',
      storage,
      networkClient: network,
      experimentMode: 'local',
      localExperiments: [],
      experimentStorage: new InMemoryExperimentStorage(),
      ...extra,
    });

  it('contains property getters and proxy traps and still captures later events', async () => {
    const client = configure();
    const properties = {
      good: 'kept',
      get bad(): string {
        throw new Error('getter');
      },
    };
    expect(() => client.track('getter_event', properties)).not.toThrow();
    const proxy = new Proxy(
      {},
      {
        ownKeys() {
          throw new Error('proxy');
        },
      }
    );
    expect(() => client.track('proxy_event', proxy)).not.toThrow();
    client.track('after_failure');
    await settle();
    expect(await storage.eventCount()).toBe(3);
    expect((await storage.fetchEvents(10))[0].properties?.good).toBe('kept');
  });

  it('contains synchronous custom storage failures', () => {
    const client = configure();
    jest.spyOn(storage, 'store').mockImplementation(() => {
      throw new Error('adapter');
    });
    expect(() => client.track('adapter_failure')).not.toThrow();
    jest.spyOn(storage, 'clear').mockImplementation(() => {
      throw new Error('adapter');
    });
    expect(() => client.optOut()).not.toThrow();
    expect(() => client.resetIdentity({ clearAnonymousId: true })).not.toThrow();
  });

  it('preserves explicit flush errors while containing background batch checks', async () => {
    const client = configure();
    jest.spyOn(storage, 'eventCount').mockRejectedValue(new Error('adapter'));
    await expect(client.flush()).rejects.toThrow('adapter');
    expect(client.isFlushing).toBe(false);
    const check = client as unknown as { checkBatchSize(): Promise<void> };
    await expect(check.checkBatchSize()).resolves.toBeUndefined();
  });

  it('contains throwing logging integrations', () => {
    for (const method of ['log', 'info', 'warn', 'error'] as const)
      jest.spyOn(console, method).mockImplementation(() => {
        throw new Error('console integration');
      });
    expect(() => {
      logger.setDebugLogging(true);
      logger.debug('debug');
      logger.info('info');
      logger.warn('warn');
      logger.error('error');
    }).not.toThrow();
    expect(() => configure({ enableDebugLogging: true }).track('logged_event')).not.toThrow();
  });

  it('observes rejected async callbacks rather than creating unhandled rejections', async () => {
    const client = configure({
      contextProvider: (() =>
        Promise.reject(new Error('async context'))) as unknown as () => EventProperties,
      onError: async () => {
        throw new Error('async error handler');
      },
      networkClient: {
        ...network,
        sendEvents: async () => ({
          success: false,
          shouldRetry: true,
          error: new MGMError('NETWORK_ERROR', 'offline'),
        }),
      },
    });
    client.track('callback_event');
    await settle();
    await client.flush();
    await settle();
    expect(await storage.eventCount()).toBe(1);
  });

  it('contains corrupted cookie encoding and key-specific storage access failures', () => {
    document.cookie = 'mostlygoodmetrics_anonymous_id=%E0%A4%A; path=/';
    expect(() => configure({ persistence: 'localStorage+cookie' })).not.toThrow();
    MostlyGoodMetrics.reset();
    document.cookie = 'mostlygoodmetrics_anonymous_id=; path=/; max-age=0';
    const originalGet = Storage.prototype.getItem;
    const originalSet = Storage.prototype.setItem;
    jest.spyOn(Storage.prototype, 'getItem').mockImplementation(function (key) {
      if (key !== '__mgm_test__') throw new Error('blocked key');
      return originalGet.call(this, key);
    });
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key !== '__mgm_test__') throw new Error('quota');
      originalSet.call(this, key, value);
    });
    const client = configure({ persistence: 'localStorage' });
    expect(() => client.identify('user')).not.toThrow();
    expect(client.userId).toBe('user');
    expect(() => client.startNewSession()).not.toThrow();
    expect(() => client.track('storage_denied')).not.toThrow();
    expect(() => persistence.clearIdentifyState()).not.toThrow();
  });

  it.each(['{}', 'null', '[null, 3, {}]'])(
    'recovers from malformed stored queue %s',
    async (raw) => {
      localStorage.setItem('mostlygoodmetrics_events', raw);
      const queue = new LocalStorageEventStorage();
      expect(await queue.eventCount()).toBe(0);
      await queue.store({
        name: 'valid',
        timestamp: '2026-10-02',
        client_event_id: 'valid',
        platform: 'web',
        environment: 'test',
      });
      expect(await queue.eventCount()).toBe(1);
    }
  );

  it('snapshots profile getters without interrupting identify or later tracking', async () => {
    const client = configure();
    const profile = {
      get email(): string {
        throw new Error('profile getter');
      },
      name: 'safe',
    };
    expect(() => client.identify('user', profile)).not.toThrow();
    client.track('after_identify');
    await settle();
    expect(client.userId).toBe('user');
    expect((await storage.fetchEvents(10))[0].properties?.name).toBe('safe');
    expect(await storage.eventCount()).toBe(2);
  });

  it('bounds sparse and recursive arrays while preserving subsequent events', async () => {
    const client = configure();
    const recursive: unknown[] = [];
    recursive.push(recursive);
    expect(() =>
      client.track('bounded', { sparse: new Array(4_000_000_000), recursive: recursive as never })
    ).not.toThrow();
    client.track('after_bounded');
    await settle();
    const events = await storage.fetchEvents(10);
    expect(JSON.stringify(events[0]).length).toBeLessThan(10_000);
    expect(events).toHaveLength(2);
  });

  it('contains recursive context callbacks without recursively capturing thousands of events', async () => {
    let calls = 0;
    const client = configure({
      contextProvider: () => {
        calls++;
        if (calls > 10) throw new Error('recursive context');
        MostlyGoodMetrics.track('inside_provider');
        return { context: 'safe' };
      },
    });
    client.track('outside_provider');
    await settle();
    expect(calls).toBe(1);
    expect(await storage.eventCount()).toBe(2);
  });

  it('falls back for malformed experiment configuration instead of throwing during app feature selection', async () => {
    const client = configure({
      localExperiments: [
        { id: 'id', name: 'broken' },
        { id: 'id2', name: 'invalid', variants: [null] },
      ] as unknown as MGMExperimentConfig[],
    });
    await client.ready();
    expect(() => client.getVariant('broken', 'control')).not.toThrow();
    expect(client.getVariant('broken', 'control')).toBe('control');
    expect(client.getVariant('invalid', 'control')).toBe('control');
    expect(client.getVariant('toString', 'control')).toBe('control');
  });

  it('does not resurrect stale identities when real writes fail after the probe succeeds', async () => {
    const client = configure({ persistence: 'localStorage' });
    client.identify('alice');
    const set = Storage.prototype.setItem;
    const remove = Storage.prototype.removeItem;
    jest.spyOn(Storage.prototype, 'setItem').mockImplementation(function (key, value) {
      if (key === 'mostlygoodmetrics_user_id') throw new Error('quota');
      set.call(this, key, value);
    });
    jest.spyOn(Storage.prototype, 'removeItem').mockImplementation(function (key) {
      if (key === 'mostlygoodmetrics_user_id') throw new Error('denied');
      remove.call(this, key);
    });
    client.identify('bob');
    expect(client.userId).toBe('bob');
    client.track('bob_event');
    client.resetIdentity();
    expect(client.userId).toBeNull();
    client.track('anonymous_event');
    await settle();
    const events = await storage.fetchEvents(10);
    expect(events[0].user_id).toBe('bob');
    expect(events[1].user_id).toBe(client.anonymousId);
  });

  it.each(['null', '3', '[null]'])('contains malformed stored super properties %s', (raw) => {
    const client = configure({ persistence: 'localStorage' });
    localStorage.setItem('mostlygoodmetrics_super_properties', raw);
    expect(client.getSuperProperties()).toEqual({});
    expect(() => client.removeSuperProperty('key')).not.toThrow();
    expect(() => client.setSuperProperty('key', 'safe')).not.toThrow();
  });

  it('does not restore stale cookie consent or anonymous ID after failed real cookie writes', () => {
    const client = configure({ persistence: 'localStorage+cookie' });
    client.optIn();
    const oldId = client.anonymousId;
    const cookieSetter = Object.getOwnPropertyDescriptor(Document.prototype, 'cookie')!.set!;
    jest.spyOn(Document.prototype, 'cookie', 'set').mockImplementation(function (value: string) {
      if (value.startsWith('mostlygoodmetrics_')) throw new Error('cookie write denied');
      cookieSetter.call(this, value);
    });
    client.optOut();
    const newId = client.resetAnonymousId();
    expect(newId).not.toBe(oldId);
    MostlyGoodMetrics.reset();
    const reconfigured = configure({ persistence: 'localStorage+cookie' });
    expect(reconfigured.isOptedOut()).toBe(true);
    expect(reconfigured.anonymousId).toBe(newId);
  });

  it('preserves last-wins handling for duplicate local experiment names', async () => {
    const client = configure({
      localExperiments: [
        { id: 'first', name: 'duplicate', variants: ['old'] },
        { id: 'second', name: 'duplicate', variants: ['new'] },
      ],
    });
    await client.ready();
    expect(client.getVariant('duplicate')).toBe('new');
  });

  it.each([NaN, Infinity, -Infinity, 1e100])(
    'keeps numeric configuration %s from overflowing platform timers',
    (value) => {
      const interval = jest.spyOn(global, 'setInterval');
      const client = configure({
        flushInterval: value,
        sessionTimeoutMinutes: value,
        maxBatchSize: value,
        maxStoredEvents: value,
        trackPageViews: true,
        platform: 'web',
      });
      expect(Number.isFinite(client.configuration.flushInterval)).toBe(true);
      expect(Number.isFinite(client.configuration.maxBatchSize)).toBe(true);
      expect(Number.isFinite(client.configuration.maxStoredEvents)).toBe(true);
      expect(interval.mock.calls).toHaveLength(2);
      for (const [, milliseconds] of interval.mock.calls) {
        expect(milliseconds).toBeGreaterThanOrEqual(1000);
        expect(milliseconds).toBeLessThanOrEqual(2_147_483_647);
      }
    }
  );

  it('snapshots unsafe super properties before delivery', async () => {
    const client = configure();
    const nested: EventProperties = {};
    nested.self = nested;
    client.setSuperProperties({ nested, unsupported: BigInt(1) as unknown as string });
    client.track('snapshot');
    await settle();
    const events = await storage.fetchEvents(10);
    expect(() => JSON.stringify(events)).not.toThrow();
  });
});
