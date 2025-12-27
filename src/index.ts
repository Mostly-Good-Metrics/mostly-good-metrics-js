/**
 * MostlyGoodMetrics JavaScript SDK
 *
 * A lightweight, framework-agnostic analytics library for web applications.
 *
 * @example
 * ```typescript
 * import { MostlyGoodMetrics } from '@mostly-good-metrics/javascript';
 *
 * // Initialize the SDK
 * MostlyGoodMetrics.configure({
 *   apiKey: 'mgm_proj_your_api_key',
 *   environment: 'production',
 * });
 *
 * // Track events
 * MostlyGoodMetrics.track('button_clicked', {
 *   button_id: 'submit',
 *   page: '/checkout',
 * });
 *
 * // Identify users
 * MostlyGoodMetrics.identify('user_123');
 * ```
 */

// Main client
export { MostlyGoodMetrics } from './client';

// Types
export type {
  MGMConfiguration,
  ResolvedConfiguration,
  EventProperties,
  EventPropertyValue,
  MGMEvent,
  MGMEventContext,
  MGMEventsPayload,
  Platform,
  SDK,
  DeviceType,
  MGMErrorType,
  SendResult,
  IEventStorage,
  INetworkClient,
} from './types';

// Error class
export { MGMError } from './types';

// Constants
export {
  SystemEvents,
  SystemProperties,
  DefaultConfiguration,
  Constraints,
  EVENT_NAME_REGEX,
} from './types';

// Storage implementations (for custom storage adapters)
export { InMemoryEventStorage, LocalStorageEventStorage, createDefaultStorage } from './storage';

// Network client (for custom network implementations)
export { FetchNetworkClient, createDefaultNetworkClient } from './network';

// Utilities (for advanced usage)
export {
  generateAnonymousId,
  generateUUID,
  getISOTimestamp,
  isValidEventName,
  validateEventName,
  sanitizeProperties,
  detectPlatform,
  detectDeviceType,
  getOSVersion,
  getDeviceModel,
} from './utils';

// Logger (for debugging)
export { logger } from './logger';
