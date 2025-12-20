/**
 * Configuration options for the MostlyGoodMetrics SDK.
 */
export interface MGMConfiguration {
  /**
   * The API key for authenticating with MostlyGoodMetrics.
   * Required.
   */
  apiKey: string;

  /**
   * The base URL for the MostlyGoodMetrics API.
   * @default "https://ingest.mostlygoodmetrics.com"
   */
  baseURL?: string;

  /**
   * The environment name (e.g., "production", "staging", "development").
   * @default "production"
   */
  environment?: string;

  /**
   * Maximum number of events to send in a single batch.
   * Must be between 1 and 1000.
   * @default 100
   */
  maxBatchSize?: number;

  /**
   * Interval in seconds between automatic flush attempts.
   * Must be at least 1 second.
   * @default 30
   */
  flushInterval?: number;

  /**
   * Maximum number of events to store locally before dropping oldest events.
   * Must be at least 100.
   * @default 10000
   */
  maxStoredEvents?: number;

  /**
   * Whether to enable debug logging to the console.
   * @default false
   */
  enableDebugLogging?: boolean;

  /**
   * Whether to automatically track app lifecycle events
   * ($app_opened, $app_backgrounded, $app_installed, $app_updated).
   * @default true
   */
  trackAppLifecycleEvents?: boolean;

  /**
   * Custom bundle identifier to use instead of auto-detection.
   * Useful for multi-tenant applications.
   */
  bundleId?: string;

  /**
   * The app version string to include with events.
   * If not provided, will attempt to auto-detect from the environment.
   */
  appVersion?: string;

  /**
   * The OS version string to include with events.
   * If not provided, will attempt to auto-detect from the environment.
   * For React Native, pass Platform.Version.toString().
   */
  osVersion?: string;

  /**
   * Override the auto-detected platform.
   * Use this when wrapping the SDK (e.g., React Native should pass 'ios' or 'android').
   */
  platform?: Platform;

  /**
   * The SDK identifier. Auto-set to 'javascript' but can be overridden by wrapper SDKs.
   * @default "javascript"
   */
  sdk?: SDK;

  /**
   * The SDK version string. Wrapper SDKs (e.g., React Native) should pass their version here.
   * If not provided, uses the JS SDK's version.
   */
  sdkVersion?: string;

  /**
   * Custom storage adapter. If not provided, uses localStorage in browsers
   * or in-memory storage in non-browser environments.
   */
  storage?: IEventStorage;

  /**
   * Custom network client. If not provided, uses fetch-based client.
   */
  networkClient?: INetworkClient;
}

/**
 * Internal resolved configuration with all defaults applied.
 */
export interface ResolvedConfiguration extends Required<
  Omit<MGMConfiguration, 'storage' | 'networkClient'>
> {
  storage?: IEventStorage;
  networkClient?: INetworkClient;
}

/**
 * Properties that can be attached to an event.
 * Supports nested objects up to 3 levels deep.
 */
export type EventProperties = Record<string, EventPropertyValue>;

/**
 * Valid types for event property values.
 */
export type EventPropertyValue =
  | null
  | boolean
  | number
  | string
  | EventPropertyValue[]
  | { [key: string]: EventPropertyValue };

/**
 * An analytics event to be tracked.
 */
export interface MGMEvent {
  /**
   * The name of the event. Must match pattern: ^$?[a-zA-Z][a-zA-Z0-9_]*$
   * Max 255 characters.
   */
  name: string;

  /**
   * Unique client-generated ID for deduplication.
   */
  client_event_id: string;

  /**
   * ISO8601 timestamp when the event occurred.
   */
  timestamp: string;

  /**
   * The user ID associated with this event.
   */
  userId?: string;

  /**
   * The session ID associated with this event.
   */
  sessionId?: string;

  /**
   * The platform this event was generated from.
   */
  platform: Platform;

  /**
   * The app version string.
   */
  appVersion?: string;

  /**
   * The app build number (separate from version).
   */
  appBuildNumber?: string;

  /**
   * The OS version string.
   */
  osVersion?: string;

  /**
   * The environment name.
   */
  environment: string;

  /**
   * The device manufacturer (e.g., "Apple", "Samsung").
   */
  deviceManufacturer?: string;

  /**
   * The user's locale (e.g., "en-US").
   */
  locale?: string;

  /**
   * The user's timezone (e.g., "America/New_York").
   */
  timezone?: string;

  /**
   * Custom properties attached to this event.
   */
  properties?: EventProperties;
}

/**
 * Context sent with each batch of events.
 * Applied to all events in the batch server-side.
 */
export interface MGMEventContext {
  platform: Platform;
  appVersion?: string;
  appBuildNumber?: string;
  osVersion?: string;
  userId?: string;
  sessionId?: string;
  environment: string;
  deviceManufacturer?: string;
  locale?: string;
  timezone?: string;
}

/**
 * The payload sent to the events API.
 */
export interface MGMEventsPayload {
  events: MGMEvent[];
  context: MGMEventContext;
}

/**
 * Supported platforms (the actual OS/runtime).
 */
export type Platform = 'web' | 'ios' | 'android' | 'node';

/**
 * SDK identifiers.
 */
export type SDK = 'javascript' | 'react-native' | 'swift' | 'android';

/**
 * Device types for automatic device detection.
 */
export type DeviceType = 'phone' | 'tablet' | 'desktop' | 'tv' | 'watch' | 'unknown';

/**
 * Error types that can occur in the SDK.
 */
export type MGMErrorType =
  | 'NETWORK_ERROR'
  | 'ENCODING_ERROR'
  | 'BAD_REQUEST'
  | 'UNAUTHORIZED'
  | 'FORBIDDEN'
  | 'RATE_LIMITED'
  | 'SERVER_ERROR'
  | 'INVALID_EVENT_NAME'
  | 'STORAGE_ERROR'
  | 'UNKNOWN_ERROR';

/**
 * Result of a network send operation.
 */
export type SendResult =
  | { success: true }
  | { success: false; error: MGMError; shouldRetry: boolean };

/**
 * Interface for event storage implementations.
 */
export interface IEventStorage {
  /**
   * Store an event for later sending.
   */
  store(event: MGMEvent): Promise<void>;

  /**
   * Fetch up to `limit` events from storage (FIFO order).
   */
  fetchEvents(limit: number): Promise<MGMEvent[]>;

  /**
   * Remove events from storage after successful send.
   */
  removeEvents(count: number): Promise<void>;

  /**
   * Get the current count of stored events.
   */
  eventCount(): Promise<number>;

  /**
   * Clear all stored events.
   */
  clear(): Promise<void>;
}

/**
 * Interface for network client implementations.
 */
export interface INetworkClient {
  /**
   * Send a batch of events to the server.
   */
  sendEvents(payload: MGMEventsPayload, config: ResolvedConfiguration): Promise<SendResult>;

  /**
   * Check if the client is currently rate-limited.
   */
  isRateLimited(): boolean;

  /**
   * Get the retry-after time if rate-limited, or null if not.
   */
  getRetryAfterTime(): Date | null;
}

/**
 * Custom error class for SDK errors.
 */
export class MGMError extends Error {
  public readonly type: MGMErrorType;
  public readonly retryAfter?: number;
  public readonly statusCode?: number;

  constructor(
    type: MGMErrorType,
    message: string,
    options?: { retryAfter?: number; statusCode?: number }
  ) {
    super(message);
    this.name = 'MGMError';
    this.type = type;
    this.retryAfter = options?.retryAfter;
    this.statusCode = options?.statusCode;

    // Maintains proper stack trace for where error was thrown (V8 engines)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, MGMError);
    }
  }
}

/**
 * System event names (prefixed with $).
 */
export const SystemEvents = {
  APP_INSTALLED: '$app_installed',
  APP_UPDATED: '$app_updated',
  APP_OPENED: '$app_opened',
  APP_BACKGROUNDED: '$app_backgrounded',
} as const;

/**
 * System property keys (prefixed with $).
 */
export const SystemProperties = {
  DEVICE_TYPE: '$device_type',
  DEVICE_MODEL: '$device_model',
  VERSION: '$version',
  PREVIOUS_VERSION: '$previous_version',
  SDK: '$sdk',
} as const;

/**
 * Default configuration values.
 */
export const DefaultConfiguration = {
  baseURL: 'https://ingest.mostlygoodmetrics.com',
  environment: 'production',
  maxBatchSize: 100,
  flushInterval: 30,
  maxStoredEvents: 10000,
  enableDebugLogging: false,
  trackAppLifecycleEvents: true,
} as const;

/**
 * Validation constraints.
 */
export const Constraints = {
  MAX_EVENT_NAME_LENGTH: 255,
  MAX_BATCH_SIZE: 1000,
  MIN_BATCH_SIZE: 1,
  MIN_FLUSH_INTERVAL: 1,
  MIN_STORED_EVENTS: 100,
  MAX_STRING_PROPERTY_LENGTH: 1000,
  MAX_PROPERTY_DEPTH: 3,
  MAX_PROPERTY_SIZE_BYTES: 10 * 1024, // 10KB
  COMPRESSION_THRESHOLD_BYTES: 1024, // 1KB
} as const;

/**
 * Regular expression for validating event names.
 * Must start with a letter (or $ for system events) followed by alphanumeric and underscores.
 */
export const EVENT_NAME_REGEX = /^\$?[a-zA-Z][a-zA-Z0-9_]*$/;
