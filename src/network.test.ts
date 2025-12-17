import { TextEncoder } from 'util';
import { FetchNetworkClient } from './network';
import { MGMEventsPayload, ResolvedConfiguration } from './types';

// Polyfill TextEncoder for Jest environment
global.TextEncoder = TextEncoder;

describe('FetchNetworkClient', () => {
  let networkClient: FetchNetworkClient;
  let mockFetch: jest.Mock;
  let capturedHeaders: Record<string, string>;

  const createMockConfig = (
    overrides: Partial<ResolvedConfiguration> = {}
  ): ResolvedConfiguration => ({
    apiKey: 'test-api-key',
    baseURL: 'https://api.example.com',
    maxStoredEvents: 1000,
    flushIntervalMs: 30000,
    maxBatchSize: 100,
    environment: 'production',
    platform: 'web',
    sdk: 'javascript',
    trackAppLifecycleEvents: false,
    ...overrides,
  });

  const createMockPayload = (): MGMEventsPayload => ({
    events: [
      {
        name: 'test_event',
        client_event_id: '123e4567-e89b-12d3-a456-426614174000',
        timestamp: new Date().toISOString(),
        platform: 'web',
        environment: 'production',
      },
    ],
  });

  beforeEach(() => {
    networkClient = new FetchNetworkClient();
    capturedHeaders = {};

    mockFetch = jest.fn().mockImplementation((_url: string, options: RequestInit) => {
      capturedHeaders = options.headers as Record<string, string>;
      return Promise.resolve({
        status: 204,
        headers: new Headers(),
      });
    });

    global.fetch = mockFetch;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('SDK identification headers', () => {
    it('should include X-MGM-SDK header from config', async () => {
      const config = createMockConfig({ sdk: 'react-native' });
      await networkClient.sendEvents(createMockPayload(), config);

      expect(capturedHeaders['X-MGM-SDK']).toBe('react-native');
    });

    it('should include X-MGM-SDK-Version header', async () => {
      const config = createMockConfig();
      await networkClient.sendEvents(createMockPayload(), config);

      expect(capturedHeaders['X-MGM-SDK-Version']).toBeDefined();
      expect(capturedHeaders['X-MGM-SDK-Version']).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it('should include X-MGM-Platform header from config', async () => {
      const config = createMockConfig({ platform: 'ios' });
      await networkClient.sendEvents(createMockPayload(), config);

      expect(capturedHeaders['X-MGM-Platform']).toBe('ios');
    });

    it('should include X-MGM-Platform-Version when osVersion is configured', async () => {
      const config = createMockConfig({ osVersion: '17.0' });
      await networkClient.sendEvents(createMockPayload(), config);

      expect(capturedHeaders['X-MGM-Platform-Version']).toBe('17.0');
    });

    it('should include X-MGM-Key header with API key', async () => {
      const config = createMockConfig({ apiKey: 'my-secret-key' });
      await networkClient.sendEvents(createMockPayload(), config);

      expect(capturedHeaders['X-MGM-Key']).toBe('my-secret-key');
    });

    it('should include X-MGM-Bundle-Id when bundleId is configured', async () => {
      const config = createMockConfig({ bundleId: 'com.example.app' });
      await networkClient.sendEvents(createMockPayload(), config);

      expect(capturedHeaders['X-MGM-Bundle-Id']).toBe('com.example.app');
    });

    it('should not include X-MGM-Bundle-Id when bundleId is not configured', async () => {
      const config = createMockConfig();
      await networkClient.sendEvents(createMockPayload(), config);

      expect(capturedHeaders['X-MGM-Bundle-Id']).toBeUndefined();
    });

    it('should include all SDK headers together', async () => {
      const config = createMockConfig({
        apiKey: 'test-key',
        sdk: 'javascript',
        platform: 'web',
        osVersion: '14.0',
        bundleId: 'com.test.app',
      });
      await networkClient.sendEvents(createMockPayload(), config);

      expect(capturedHeaders['X-MGM-Key']).toBe('test-key');
      expect(capturedHeaders['X-MGM-SDK']).toBe('javascript');
      expect(capturedHeaders['X-MGM-SDK-Version']).toBeDefined();
      expect(capturedHeaders['X-MGM-Platform']).toBe('web');
      expect(capturedHeaders['X-MGM-Platform-Version']).toBe('14.0');
      expect(capturedHeaders['X-MGM-Bundle-Id']).toBe('com.test.app');
    });
  });

  describe('sendEvents', () => {
    it('should return success on 204 response', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 204,
        headers: new Headers(),
      });

      const result = await networkClient.sendEvents(createMockPayload(), createMockConfig());

      expect(result.success).toBe(true);
    });

    it('should return success on 200 response', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 200,
        headers: new Headers(),
      });

      const result = await networkClient.sendEvents(createMockPayload(), createMockConfig());

      expect(result.success).toBe(true);
    });

    it('should handle rate limiting (429) with Retry-After header', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 429,
        headers: new Headers({ 'Retry-After': '120' }),
      });

      const result = await networkClient.sendEvents(createMockPayload(), createMockConfig());

      expect(result.success).toBe(false);
      expect(result.shouldRetry).toBe(true);
      expect(result.error?.type).toBe('RATE_LIMITED');
    });

    it('should handle client errors (4xx) without retry', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 400,
        headers: new Headers(),
      });

      const result = await networkClient.sendEvents(createMockPayload(), createMockConfig());

      expect(result.success).toBe(false);
      expect(result.shouldRetry).toBe(false);
      expect(result.error?.type).toBe('BAD_REQUEST');
    });

    it('should handle server errors (5xx) with retry', async () => {
      mockFetch.mockResolvedValueOnce({
        status: 500,
        headers: new Headers(),
      });

      const result = await networkClient.sendEvents(createMockPayload(), createMockConfig());

      expect(result.success).toBe(false);
      expect(result.shouldRetry).toBe(true);
      expect(result.error?.type).toBe('SERVER_ERROR');
    });

    it('should handle network errors with retry', async () => {
      mockFetch.mockRejectedValueOnce(new Error('Network failure'));

      const result = await networkClient.sendEvents(createMockPayload(), createMockConfig());

      expect(result.success).toBe(false);
      expect(result.shouldRetry).toBe(true);
      expect(result.error?.type).toBe('NETWORK_ERROR');
    });

    it('should send to correct endpoint', async () => {
      const config = createMockConfig({ baseURL: 'https://api.test.com' });
      await networkClient.sendEvents(createMockPayload(), config);

      expect(mockFetch).toHaveBeenCalledWith('https://api.test.com/v1/events', expect.any(Object));
    });

    it('should use POST method', async () => {
      await networkClient.sendEvents(createMockPayload(), createMockConfig());

      expect(mockFetch).toHaveBeenCalledWith(
        expect.any(String),
        expect.objectContaining({ method: 'POST' })
      );
    });
  });

  describe('rate limiting', () => {
    it('should not be rate limited initially', () => {
      expect(networkClient.isRateLimited()).toBe(false);
    });

    it('should return null for retry time initially', () => {
      expect(networkClient.getRetryAfterTime()).toBeNull();
    });

    it('should skip requests when rate limited', async () => {
      // First request gets rate limited
      mockFetch.mockResolvedValueOnce({
        status: 429,
        headers: new Headers({ 'Retry-After': '60' }),
      });

      await networkClient.sendEvents(createMockPayload(), createMockConfig());

      // Second request should be skipped
      const result = await networkClient.sendEvents(createMockPayload(), createMockConfig());

      expect(result.success).toBe(false);
      expect(result.error?.type).toBe('RATE_LIMITED');
      expect(mockFetch).toHaveBeenCalledTimes(1); // Only first request was made
    });
  });
});
