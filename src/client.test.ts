import { MostlyGoodMetrics } from './client';
import { InMemoryEventStorage } from './storage';
import { INetworkClient, MGMEventsPayload, ResolvedConfiguration, SendResult } from './types';

class MockNetworkClient implements INetworkClient {
  public sentPayloads: MGMEventsPayload[] = [];
  public sendResult: SendResult = { success: true };
  private rateLimited = false;

  async sendEvents(payload: MGMEventsPayload, _config: ResolvedConfiguration): Promise<SendResult> {
    this.sentPayloads.push(payload);
    return this.sendResult;
  }

  isRateLimited(): boolean {
    return this.rateLimited;
  }

  getRetryAfterTime(): Date | null {
    return null;
  }

  setRateLimited(limited: boolean): void {
    this.rateLimited = limited;
  }
}

describe('MostlyGoodMetrics', () => {
  let storage: InMemoryEventStorage;
  let networkClient: MockNetworkClient;

  beforeEach(() => {
    // Reset singleton
    MostlyGoodMetrics.reset();

    storage = new InMemoryEventStorage(100);
    networkClient = new MockNetworkClient();
  });

  afterEach(() => {
    MostlyGoodMetrics.reset();
  });

  describe('configure', () => {
    it('should create a singleton instance', () => {
      const instance = MostlyGoodMetrics.configure({
        apiKey: 'test-key',
        storage,
        networkClient,
        trackAppLifecycleEvents: false,
      });

      expect(instance).toBeDefined();
      expect(MostlyGoodMetrics.shared).toBe(instance);
      expect(MostlyGoodMetrics.isConfigured).toBe(true);
    });

    it('should throw if apiKey is missing', () => {
      expect(() => {
        MostlyGoodMetrics.configure({ apiKey: '' });
      }).toThrow('API key is required');
    });

    it('should return existing instance on multiple configure calls', () => {
      const instance1 = MostlyGoodMetrics.configure({
        apiKey: 'test-key',
        storage,
        networkClient,
        trackAppLifecycleEvents: false,
      });

      const instance2 = MostlyGoodMetrics.configure({
        apiKey: 'different-key',
        storage,
        networkClient,
        trackAppLifecycleEvents: false,
      });

      expect(instance1).toBe(instance2);
    });
  });

  describe('track', () => {
    beforeEach(() => {
      MostlyGoodMetrics.configure({
        apiKey: 'test-key',
        storage,
        networkClient,
        trackAppLifecycleEvents: false,
      });
    });

    it('should store events', async () => {
      MostlyGoodMetrics.track('test_event');

      // Wait for async storage
      await new Promise((resolve) => setTimeout(resolve, 10));

      const count = await storage.eventCount();
      expect(count).toBe(1);

      const events = await storage.fetchEvents(1);
      expect(events[0].name).toBe('test_event');
    });

    it('should include properties', async () => {
      MostlyGoodMetrics.track('button_clicked', {
        button_id: 'submit',
        page: '/checkout',
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const events = await storage.fetchEvents(1);
      expect(events[0].properties?.button_id).toBe('submit');
      expect(events[0].properties?.page).toBe('/checkout');
    });

    it('should include system properties', async () => {
      MostlyGoodMetrics.track('test_event');

      await new Promise((resolve) => setTimeout(resolve, 10));

      const events = await storage.fetchEvents(1);
      expect(events[0].properties?.$device_type).toBeDefined();
    });

    it('should not track events with invalid names', async () => {
      MostlyGoodMetrics.track('invalid-name');
      MostlyGoodMetrics.track('123_starts_with_number');

      await new Promise((resolve) => setTimeout(resolve, 10));

      const count = await storage.eventCount();
      expect(count).toBe(0);
    });

    it('should include environment and platform', async () => {
      MostlyGoodMetrics.track('test_event');

      await new Promise((resolve) => setTimeout(resolve, 10));

      const events = await storage.fetchEvents(1);
      expect(events[0].environment).toBe('production');
      expect(events[0].platform).toBeDefined();
    });

    it('should include client_event_id as a UUID', async () => {
      MostlyGoodMetrics.track('test_event');

      await new Promise((resolve) => setTimeout(resolve, 10));

      const events = await storage.fetchEvents(1);
      expect(events[0].client_event_id).toBeDefined();
      // UUID v4 format: xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx
      expect(events[0].client_event_id).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      );
    });

    it('should generate unique client_event_id for each event', async () => {
      MostlyGoodMetrics.track('event1');
      MostlyGoodMetrics.track('event2');
      MostlyGoodMetrics.track('event3');

      await new Promise((resolve) => setTimeout(resolve, 10));

      const events = await storage.fetchEvents(3);
      const ids = events.map((e) => e.client_event_id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(3);
    });

    it('should include $sdk property defaulting to javascript', async () => {
      MostlyGoodMetrics.track('test_event');

      await new Promise((resolve) => setTimeout(resolve, 10));

      const events = await storage.fetchEvents(1);
      expect(events[0].properties?.$sdk).toBe('javascript');
    });
  });

  describe('platform and sdk configuration', () => {
    it('should use configured platform', async () => {
      MostlyGoodMetrics.reset();
      MostlyGoodMetrics.configure({
        apiKey: 'test-key',
        storage,
        networkClient,
        trackAppLifecycleEvents: false,
        platform: 'ios',
      });

      MostlyGoodMetrics.track('test_event');
      await new Promise((resolve) => setTimeout(resolve, 10));

      const events = await storage.fetchEvents(1);
      expect(events[0].platform).toBe('ios');
    });

    it('should use configured sdk', async () => {
      MostlyGoodMetrics.reset();
      MostlyGoodMetrics.configure({
        apiKey: 'test-key',
        storage,
        networkClient,
        trackAppLifecycleEvents: false,
        sdk: 'react-native',
      });

      MostlyGoodMetrics.track('test_event');
      await new Promise((resolve) => setTimeout(resolve, 10));

      const events = await storage.fetchEvents(1);
      expect(events[0].properties?.$sdk).toBe('react-native');
    });

    it('should allow both platform and sdk to be configured together', async () => {
      MostlyGoodMetrics.reset();
      MostlyGoodMetrics.configure({
        apiKey: 'test-key',
        storage,
        networkClient,
        trackAppLifecycleEvents: false,
        platform: 'android',
        sdk: 'react-native',
      });

      MostlyGoodMetrics.track('test_event');
      await new Promise((resolve) => setTimeout(resolve, 10));

      const events = await storage.fetchEvents(1);
      expect(events[0].platform).toBe('android');
      expect(events[0].properties?.$sdk).toBe('react-native');
    });
  });

  describe('identify', () => {
    beforeEach(() => {
      MostlyGoodMetrics.configure({
        apiKey: 'test-key',
        storage,
        networkClient,
        trackAppLifecycleEvents: false,
      });
    });

    it('should set userId', () => {
      MostlyGoodMetrics.identify('user_123');
      expect(MostlyGoodMetrics.shared?.userId).toBe('user_123');
    });

    it('should include userId in events', async () => {
      MostlyGoodMetrics.identify('user_456');
      MostlyGoodMetrics.track('test_event');

      await new Promise((resolve) => setTimeout(resolve, 10));

      const events = await storage.fetchEvents(1);
      expect(events[0].user_id).toBe('user_456');
    });

    it('should not set empty userId', () => {
      MostlyGoodMetrics.identify('user_123');
      MostlyGoodMetrics.identify('');
      expect(MostlyGoodMetrics.shared?.userId).toBe('user_123');
    });

    it('should send $identify event with email', async () => {
      MostlyGoodMetrics.resetIdentity(); // Clear any previous identify state
      MostlyGoodMetrics.identify('user_123', { email: 'test@example.com' });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const events = await storage.fetchEvents(10);
      const identifyEvent = events.find((e) => e.name === '$identify');
      expect(identifyEvent).toBeDefined();
      expect(identifyEvent?.properties?.email).toBe('test@example.com');
      expect(identifyEvent?.properties?.name).toBeUndefined();
    });

    it('should send $identify event with name', async () => {
      MostlyGoodMetrics.resetIdentity(); // Clear any previous identify state
      MostlyGoodMetrics.identify('user_123', { name: 'John Doe' });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const events = await storage.fetchEvents(10);
      const identifyEvent = events.find((e) => e.name === '$identify');
      expect(identifyEvent).toBeDefined();
      expect(identifyEvent?.properties?.name).toBe('John Doe');
      expect(identifyEvent?.properties?.email).toBeUndefined();
    });

    it('should send $identify event with both email and name', async () => {
      MostlyGoodMetrics.resetIdentity(); // Clear any previous identify state
      MostlyGoodMetrics.identify('user_123', { email: 'test@example.com', name: 'John Doe' });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const events = await storage.fetchEvents(10);
      const identifyEvent = events.find((e) => e.name === '$identify');
      expect(identifyEvent).toBeDefined();
      expect(identifyEvent?.properties?.email).toBe('test@example.com');
      expect(identifyEvent?.properties?.name).toBe('John Doe');
    });

    it('should not send $identify event without profile data', async () => {
      MostlyGoodMetrics.resetIdentity(); // Clear any previous identify state
      MostlyGoodMetrics.identify('user_123');

      await new Promise((resolve) => setTimeout(resolve, 10));

      const events = await storage.fetchEvents(10);
      const identifyEvent = events.find((e) => e.name === '$identify');
      expect(identifyEvent).toBeUndefined();
    });

    it('should debounce $identify event with same profile data', async () => {
      MostlyGoodMetrics.resetIdentity(); // Clear any previous identify state

      MostlyGoodMetrics.identify('user_123', { email: 'debounce-test@example.com' });
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Call again with same data - should not send another event
      MostlyGoodMetrics.identify('user_123', { email: 'debounce-test@example.com' });
      await new Promise((resolve) => setTimeout(resolve, 10));

      const events = await storage.fetchEvents(10);
      const identifyEvents = events.filter((e) => e.name === '$identify');
      expect(identifyEvents.length).toBe(1);
    });

    it('should send new $identify event when profile data changes', async () => {
      MostlyGoodMetrics.resetIdentity(); // Clear any previous identify state

      MostlyGoodMetrics.identify('user_123', { email: 'change-test@example.com' });
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Call with different email - should send new event
      MostlyGoodMetrics.identify('user_123', { email: 'changed@example.com' });
      await new Promise((resolve) => setTimeout(resolve, 10));

      const events = await storage.fetchEvents(10);
      const identifyEvents = events.filter((e) => e.name === '$identify');
      expect(identifyEvents.length).toBe(2);
    });

    it('should not send $identify event with empty profile', async () => {
      MostlyGoodMetrics.resetIdentity(); // Clear any previous identify state
      MostlyGoodMetrics.identify('user_123', {});

      await new Promise((resolve) => setTimeout(resolve, 10));

      const events = await storage.fetchEvents(10);
      const identifyEvent = events.find((e) => e.name === '$identify');
      expect(identifyEvent).toBeUndefined();
    });
  });

  describe('resetIdentity', () => {
    beforeEach(() => {
      MostlyGoodMetrics.configure({
        apiKey: 'test-key',
        storage,
        networkClient,
        trackAppLifecycleEvents: false,
      });
    });

    it('should clear userId', () => {
      MostlyGoodMetrics.identify('user_123');
      MostlyGoodMetrics.resetIdentity();
      expect(MostlyGoodMetrics.shared?.userId).toBeNull();
    });

    it('should keep anonymousId unchanged', () => {
      const originalAnonymousId = MostlyGoodMetrics.shared?.anonymousId;
      MostlyGoodMetrics.resetIdentity();
      const newAnonymousId = MostlyGoodMetrics.shared?.anonymousId;
      expect(newAnonymousId).toBe(originalAnonymousId);
    });
  });

  describe('anonymousId', () => {
    it('should auto-generate anonymousId on init', () => {
      MostlyGoodMetrics.configure({
        apiKey: 'test-key',
        storage,
        networkClient,
        trackAppLifecycleEvents: false,
      });
      expect(MostlyGoodMetrics.shared?.anonymousId).toBeDefined();
      expect(MostlyGoodMetrics.shared?.anonymousId.length).toBeGreaterThan(0);
    });

    it('should include anonymousId as user_id in events when not identified', async () => {
      MostlyGoodMetrics.configure({
        apiKey: 'test-key',
        storage,
        networkClient,
        trackAppLifecycleEvents: false,
      });
      MostlyGoodMetrics.track('test_event');

      await new Promise((resolve) => setTimeout(resolve, 10));

      const events = await storage.fetchEvents(1);
      expect(events[0].user_id).toBe(MostlyGoodMetrics.shared?.anonymousId);
    });

    it('should allow wrapper SDK to override anonymousId', () => {
      const customAnonymousId = 'react-native-device-id-12345';
      MostlyGoodMetrics.configure({
        apiKey: 'test-key',
        storage,
        networkClient,
        trackAppLifecycleEvents: false,
        anonymousId: customAnonymousId,
      });
      expect(MostlyGoodMetrics.shared?.anonymousId).toBe(customAnonymousId);
    });

    it('should include custom anonymousId as user_id in events', async () => {
      const customAnonymousId = 'react-native-device-id-12345';
      MostlyGoodMetrics.configure({
        apiKey: 'test-key',
        storage,
        networkClient,
        trackAppLifecycleEvents: false,
        anonymousId: customAnonymousId,
      });
      MostlyGoodMetrics.track('test_event');

      await new Promise((resolve) => setTimeout(resolve, 10));

      const events = await storage.fetchEvents(1);
      expect(events[0].user_id).toBe(customAnonymousId);
    });

    it('should use identified userId over anonymousId', async () => {
      MostlyGoodMetrics.configure({
        apiKey: 'test-key',
        storage,
        networkClient,
        trackAppLifecycleEvents: false,
      });
      MostlyGoodMetrics.identify('identified_user_123');
      MostlyGoodMetrics.track('test_event');

      await new Promise((resolve) => setTimeout(resolve, 10));

      const events = await storage.fetchEvents(1);
      expect(events[0].user_id).toBe('identified_user_123');
    });
  });

  describe('flush', () => {
    beforeEach(() => {
      MostlyGoodMetrics.configure({
        apiKey: 'test-key',
        storage,
        networkClient,
        trackAppLifecycleEvents: false,
      });
    });

    it('should send events to network client', async () => {
      MostlyGoodMetrics.track('event1');
      MostlyGoodMetrics.track('event2');

      await new Promise((resolve) => setTimeout(resolve, 10));
      await MostlyGoodMetrics.flush();

      expect(networkClient.sentPayloads).toHaveLength(1);
      expect(networkClient.sentPayloads[0].events).toHaveLength(2);
    });

    it('should clear events after successful send', async () => {
      MostlyGoodMetrics.track('test_event');

      await new Promise((resolve) => setTimeout(resolve, 10));
      await MostlyGoodMetrics.flush();

      const count = await storage.eventCount();
      expect(count).toBe(0);
    });

    it('should not send when rate limited', async () => {
      networkClient.setRateLimited(true);

      MostlyGoodMetrics.track('test_event');
      await new Promise((resolve) => setTimeout(resolve, 10));
      await MostlyGoodMetrics.flush();

      expect(networkClient.sentPayloads).toHaveLength(0);
    });

    it('should keep events on retryable error', async () => {
      networkClient.sendResult = {
        success: false,
        error: { name: 'MGMError', message: 'Server error', type: 'SERVER_ERROR' } as never,
        shouldRetry: true,
      };

      MostlyGoodMetrics.track('test_event');
      await new Promise((resolve) => setTimeout(resolve, 10));
      await MostlyGoodMetrics.flush();

      const count = await storage.eventCount();
      expect(count).toBe(1);
    });

    it('should drop events on non-retryable error', async () => {
      networkClient.sendResult = {
        success: false,
        error: { name: 'MGMError', message: 'Bad request', type: 'BAD_REQUEST' } as never,
        shouldRetry: false,
      };

      MostlyGoodMetrics.track('test_event');
      await new Promise((resolve) => setTimeout(resolve, 10));
      await MostlyGoodMetrics.flush();

      const count = await storage.eventCount();
      expect(count).toBe(0);
    });

    it('should call onError callback when network error occurs', async () => {
      const onError = jest.fn();
      MostlyGoodMetrics.reset();
      MostlyGoodMetrics.configure({
        apiKey: 'test-key',
        storage,
        networkClient,
        trackAppLifecycleEvents: false,
        onError,
      });

      networkClient.sendResult = {
        success: false,
        error: { name: 'MGMError', message: 'Server error', type: 'SERVER_ERROR' } as never,
        shouldRetry: true,
      };

      MostlyGoodMetrics.track('test_event');
      await new Promise((resolve) => setTimeout(resolve, 10));
      await MostlyGoodMetrics.flush();

      expect(onError).toHaveBeenCalledTimes(1);
      expect(onError).toHaveBeenCalledWith(expect.objectContaining({ type: 'SERVER_ERROR' }));
    });

    it('should not call onError callback on success', async () => {
      const onError = jest.fn();
      MostlyGoodMetrics.reset();
      MostlyGoodMetrics.configure({
        apiKey: 'test-key',
        storage,
        networkClient,
        trackAppLifecycleEvents: false,
        onError,
      });

      networkClient.sendResult = { success: true };

      MostlyGoodMetrics.track('test_event');
      await new Promise((resolve) => setTimeout(resolve, 10));
      await MostlyGoodMetrics.flush();

      expect(onError).not.toHaveBeenCalled();
    });

    it('should catch exceptions thrown by onError callback', async () => {
      const onError = jest.fn().mockImplementation(() => {
        throw new Error('Callback error');
      });
      MostlyGoodMetrics.reset();
      MostlyGoodMetrics.configure({
        apiKey: 'test-key',
        storage,
        networkClient,
        trackAppLifecycleEvents: false,
        onError,
      });

      networkClient.sendResult = {
        success: false,
        error: { name: 'MGMError', message: 'Server error', type: 'SERVER_ERROR' } as never,
        shouldRetry: true,
      };

      MostlyGoodMetrics.track('test_event');
      await new Promise((resolve) => setTimeout(resolve, 10));

      // Should not throw
      await expect(MostlyGoodMetrics.flush()).resolves.not.toThrow();
      expect(onError).toHaveBeenCalled();
    });
  });

  describe('startNewSession', () => {
    beforeEach(() => {
      MostlyGoodMetrics.configure({
        apiKey: 'test-key',
        storage,
        networkClient,
        trackAppLifecycleEvents: false,
      });
    });

    it('should generate a new session ID', () => {
      const originalSessionId = MostlyGoodMetrics.shared?.sessionId;
      MostlyGoodMetrics.startNewSession();
      const newSessionId = MostlyGoodMetrics.shared?.sessionId;

      expect(newSessionId).toBeDefined();
      expect(newSessionId).not.toBe(originalSessionId);
    });
  });

  describe('clearPendingEvents', () => {
    beforeEach(() => {
      MostlyGoodMetrics.configure({
        apiKey: 'test-key',
        storage,
        networkClient,
        trackAppLifecycleEvents: false,
      });
    });

    it('should clear all pending events', async () => {
      MostlyGoodMetrics.track('event1');
      MostlyGoodMetrics.track('event2');

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(await storage.eventCount()).toBe(2);

      await MostlyGoodMetrics.clearPendingEvents();
      expect(await storage.eventCount()).toBe(0);
    });
  });

  describe('getPendingEventCount', () => {
    beforeEach(() => {
      MostlyGoodMetrics.configure({
        apiKey: 'test-key',
        storage,
        networkClient,
        trackAppLifecycleEvents: false,
      });
    });

    it('should return correct count', async () => {
      expect(await MostlyGoodMetrics.getPendingEventCount()).toBe(0);

      MostlyGoodMetrics.track('event1');
      MostlyGoodMetrics.track('event2');
      MostlyGoodMetrics.track('event3');

      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(await MostlyGoodMetrics.getPendingEventCount()).toBe(3);
    });
  });

  describe('static methods without configuration', () => {
    it('should not throw when SDK is not configured', async () => {
      expect(() => MostlyGoodMetrics.track('test')).not.toThrow();
      expect(() => MostlyGoodMetrics.identify('user')).not.toThrow();
      expect(() => MostlyGoodMetrics.resetIdentity()).not.toThrow();
      expect(() => MostlyGoodMetrics.startNewSession()).not.toThrow();

      await expect(MostlyGoodMetrics.flush()).resolves.not.toThrow();
      await expect(MostlyGoodMetrics.clearPendingEvents()).resolves.not.toThrow();
      await expect(MostlyGoodMetrics.getPendingEventCount()).resolves.toBe(0);
    });

    it('should not throw for super property methods when not configured', () => {
      expect(() => MostlyGoodMetrics.setSuperProperty('key', 'value')).not.toThrow();
      expect(() => MostlyGoodMetrics.setSuperProperties({ key: 'value' })).not.toThrow();
      expect(() => MostlyGoodMetrics.removeSuperProperty('key')).not.toThrow();
      expect(() => MostlyGoodMetrics.clearSuperProperties()).not.toThrow();
      expect(MostlyGoodMetrics.getSuperProperties()).toEqual({});
    });
  });

  describe('super properties', () => {
    beforeEach(() => {
      MostlyGoodMetrics.configure({
        apiKey: 'test-key',
        storage,
        networkClient,
        trackAppLifecycleEvents: false,
      });
    });

    afterEach(() => {
      MostlyGoodMetrics.clearSuperProperties();
    });

    it('should set a single super property', () => {
      MostlyGoodMetrics.setSuperProperty('plan', 'premium');

      const props = MostlyGoodMetrics.getSuperProperties();
      expect(props.plan).toBe('premium');
    });

    it('should set multiple super properties at once', () => {
      MostlyGoodMetrics.setSuperProperties({
        plan: 'enterprise',
        role: 'admin',
      });

      const props = MostlyGoodMetrics.getSuperProperties();
      expect(props.plan).toBe('enterprise');
      expect(props.role).toBe('admin');
    });

    it('should merge with existing super properties', () => {
      MostlyGoodMetrics.setSuperProperty('existing', 'value');
      MostlyGoodMetrics.setSuperProperties({
        new_prop: 'new_value',
      });

      const props = MostlyGoodMetrics.getSuperProperties();
      expect(props.existing).toBe('value');
      expect(props.new_prop).toBe('new_value');
    });

    it('should remove a single super property', () => {
      MostlyGoodMetrics.setSuperProperties({
        keep: 'this',
        remove: 'this',
      });

      MostlyGoodMetrics.removeSuperProperty('remove');

      const props = MostlyGoodMetrics.getSuperProperties();
      expect(props.keep).toBe('this');
      expect(props.remove).toBeUndefined();
    });

    it('should clear all super properties', () => {
      MostlyGoodMetrics.setSuperProperties({
        prop1: 'value1',
        prop2: 'value2',
      });

      MostlyGoodMetrics.clearSuperProperties();

      const props = MostlyGoodMetrics.getSuperProperties();
      expect(Object.keys(props)).toHaveLength(0);
    });

    it('should include super properties in tracked events', async () => {
      MostlyGoodMetrics.setSuperProperties({
        user_tier: 'gold',
        source: 'mobile',
      });

      MostlyGoodMetrics.track('purchase');

      await new Promise((resolve) => setTimeout(resolve, 10));

      const events = await storage.fetchEvents(1);
      expect(events[0].properties?.user_tier).toBe('gold');
      expect(events[0].properties?.source).toBe('mobile');
    });

    it('should allow event properties to override super properties', async () => {
      MostlyGoodMetrics.setSuperProperty('source', 'default');

      MostlyGoodMetrics.track('click', {
        source: 'override',
      });

      await new Promise((resolve) => setTimeout(resolve, 10));

      const events = await storage.fetchEvents(1);
      expect(events[0].properties?.source).toBe('override');
    });

    it('should not allow super properties to override system properties', async () => {
      MostlyGoodMetrics.setSuperProperty('$device_type', 'hacked');

      MostlyGoodMetrics.track('test_event');

      await new Promise((resolve) => setTimeout(resolve, 10));

      const events = await storage.fetchEvents(1);
      // System properties should take precedence
      expect(events[0].properties?.$device_type).not.toBe('hacked');
    });
  });

  describe('getVariant', () => {
    let originalFetch: typeof global.fetch;

    beforeEach(() => {
      originalFetch = global.fetch;
    });

    afterEach(() => {
      global.fetch = originalFetch;
      MostlyGoodMetrics.reset();
    });

    it('should return null when SDK not configured', () => {
      const variant = MostlyGoodMetrics.getVariant('button-color');
      expect(variant).toBeNull();
    });

    it('should return null when experiment not found after experiments loaded', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ experiments: [] }),
      });

      MostlyGoodMetrics.configure({
        apiKey: 'test-key',
        storage,
        networkClient,
        trackAppLifecycleEvents: false,
      });

      await MostlyGoodMetrics.ready();

      const variant = MostlyGoodMetrics.getVariant('nonexistent-experiment');
      expect(variant).toBeNull();
    });

    it('should return null when called before experiments are loaded', async () => {
      // Never resolve the fetch
      global.fetch = jest.fn().mockImplementation(() => new Promise(() => {}));

      MostlyGoodMetrics.configure({
        apiKey: 'test-key',
        storage,
        networkClient,
        trackAppLifecycleEvents: false,
      });

      // Don't wait for ready - experiments not loaded yet
      const variant = MostlyGoodMetrics.getVariant('button-color');
      expect(variant).toBeNull();
    });

    it('should return variant when experiment exists', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            experiments: [{ id: 'button-color', variants: ['a', 'b'] }],
          }),
      });

      MostlyGoodMetrics.configure({
        apiKey: 'test-key',
        storage,
        networkClient,
        trackAppLifecycleEvents: false,
      });

      await MostlyGoodMetrics.ready();

      const variant = MostlyGoodMetrics.getVariant('button-color');
      expect(variant).not.toBeNull();
      expect(['a', 'b']).toContain(variant);
    });

    it('should be deterministic - same user gets same variant', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            experiments: [{ id: 'button-color', variants: ['a', 'b', 'c'] }],
          }),
      });

      MostlyGoodMetrics.configure({
        apiKey: 'test-key',
        storage,
        networkClient,
        trackAppLifecycleEvents: false,
      });

      await MostlyGoodMetrics.ready();

      // Call multiple times - should return same variant
      const variant1 = MostlyGoodMetrics.getVariant('button-color');
      const variant2 = MostlyGoodMetrics.getVariant('button-color');
      const variant3 = MostlyGoodMetrics.getVariant('button-color');

      expect(variant1).toBe(variant2);
      expect(variant2).toBe(variant3);
    });

    it('should store variant as super property', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            experiments: [{ id: 'button-color', variants: ['a', 'b'] }],
          }),
      });

      MostlyGoodMetrics.configure({
        apiKey: 'test-key',
        storage,
        networkClient,
        trackAppLifecycleEvents: false,
      });

      await MostlyGoodMetrics.ready();

      const variant = MostlyGoodMetrics.getVariant('button-color');

      const superProps = MostlyGoodMetrics.getSuperProperties();
      expect(superProps.experiment_button_color).toBe(variant);
    });

    it('should attach experiment variant to tracked events', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            experiments: [{ id: 'checkout-flow', variants: ['control', 'treatment'] }],
          }),
      });

      MostlyGoodMetrics.configure({
        apiKey: 'test-key',
        storage,
        networkClient,
        trackAppLifecycleEvents: false,
      });

      await MostlyGoodMetrics.ready();

      const variant = MostlyGoodMetrics.getVariant('checkout-flow');
      MostlyGoodMetrics.track('purchase_completed');

      await new Promise((resolve) => setTimeout(resolve, 10));

      const events = await storage.fetchEvents(1);
      expect(events[0].properties?.experiment_checkout_flow).toBe(variant);
    });

    it('should handle fetch failure gracefully', async () => {
      global.fetch = jest.fn().mockRejectedValue(new Error('Network error'));

      MostlyGoodMetrics.configure({
        apiKey: 'test-key',
        storage,
        networkClient,
        trackAppLifecycleEvents: false,
      });

      // Should resolve even on fetch failure
      await MostlyGoodMetrics.ready();

      const variant = MostlyGoodMetrics.getVariant('button-color');
      expect(variant).toBeNull();
    });

    it('should handle non-ok response gracefully', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: false,
        status: 500,
      });

      MostlyGoodMetrics.configure({
        apiKey: 'test-key',
        storage,
        networkClient,
        trackAppLifecycleEvents: false,
      });

      await MostlyGoodMetrics.ready();

      const variant = MostlyGoodMetrics.getVariant('button-color');
      expect(variant).toBeNull();
    });

    it('should convert experiment name to snake_case for property', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            experiments: [{ id: 'newOnboardingFlow', variants: ['a', 'b'] }],
          }),
      });

      MostlyGoodMetrics.configure({
        apiKey: 'test-key',
        storage,
        networkClient,
        trackAppLifecycleEvents: false,
      });

      await MostlyGoodMetrics.ready();

      MostlyGoodMetrics.getVariant('newOnboardingFlow');

      const superProps = MostlyGoodMetrics.getSuperProperties();
      expect(superProps.experiment_new_onboarding_flow).toBeDefined();
    });

    it('should return null for empty experimentName', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () => Promise.resolve({ experiments: [] }),
      });

      MostlyGoodMetrics.configure({
        apiKey: 'test-key',
        storage,
        networkClient,
        trackAppLifecycleEvents: false,
      });

      await MostlyGoodMetrics.ready();

      const variant = MostlyGoodMetrics.getVariant('');
      expect(variant).toBeNull();
    });

    it('should return null for experiment with no variants', async () => {
      global.fetch = jest.fn().mockResolvedValue({
        ok: true,
        json: () =>
          Promise.resolve({
            experiments: [{ id: 'empty-experiment', variants: [] }],
          }),
      });

      MostlyGoodMetrics.configure({
        apiKey: 'test-key',
        storage,
        networkClient,
        trackAppLifecycleEvents: false,
      });

      await MostlyGoodMetrics.ready();

      const variant = MostlyGoodMetrics.getVariant('empty-experiment');
      expect(variant).toBeNull();
    });
  });
});
