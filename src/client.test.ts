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
      expect(events[0].userId).toBe('user_456');
    });

    it('should not set empty userId', () => {
      MostlyGoodMetrics.identify('user_123');
      MostlyGoodMetrics.identify('');
      expect(MostlyGoodMetrics.shared?.userId).toBe('user_123');
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
  });
});
