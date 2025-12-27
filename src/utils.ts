import { logger } from './logger';
import {
  Constraints,
  DefaultConfiguration,
  DeviceType,
  EVENT_NAME_REGEX,
  EventProperties,
  EventPropertyValue,
  MGMConfiguration,
  MGMError,
  Platform,
  ResolvedConfiguration,
} from './types';

/**
 * Generate a UUID v4 string.
 */
export function generateUUID(): string {
  // Use crypto.randomUUID if available (modern browsers and Node.js 19+)
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }

  // Fallback implementation
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/**
 * Generate a short random string for anonymous IDs.
 * Uses base36 (0-9, a-z) for URL-safe, readable IDs.
 */
function generateRandomString(length: number): string {
  const chars = '0123456789abcdefghijklmnopqrstuvwxyz';
  let result = '';
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) {
    const array = new Uint8Array(length);
    crypto.getRandomValues(array);
    for (let i = 0; i < length; i++) {
      result += chars[array[i] % chars.length];
    }
  } else {
    for (let i = 0; i < length; i++) {
      result += chars[Math.floor(Math.random() * chars.length)];
    }
  }
  return result;
}

/**
 * Generate an anonymous user ID with $anon_ prefix.
 * Format: $anon_xxxxxxxxxxxx (12 random chars)
 */
export function generateAnonymousId(): string {
  return `$anon_${generateRandomString(12)}`;
}

/**
 * Get the current timestamp in ISO8601 format.
 */
export function getISOTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Validate an event name.
 * Must match pattern: ^$?[a-zA-Z][a-zA-Z0-9_]*$
 * Max 255 characters.
 */
export function isValidEventName(name: string): boolean {
  if (!name || name.length > Constraints.MAX_EVENT_NAME_LENGTH) {
    return false;
  }
  return EVENT_NAME_REGEX.test(name);
}

/**
 * Validate an event name and throw if invalid.
 */
export function validateEventName(name: string): void {
  if (!name) {
    throw new MGMError('INVALID_EVENT_NAME', 'Event name is required');
  }

  if (name.length > Constraints.MAX_EVENT_NAME_LENGTH) {
    throw new MGMError(
      'INVALID_EVENT_NAME',
      `Event name must be ${Constraints.MAX_EVENT_NAME_LENGTH} characters or less`
    );
  }

  if (!EVENT_NAME_REGEX.test(name)) {
    throw new MGMError(
      'INVALID_EVENT_NAME',
      'Event name must start with a letter (or $ for system events) and contain only alphanumeric characters and underscores'
    );
  }
}

/**
 * Sanitize event properties by truncating strings and limiting depth.
 */
export function sanitizeProperties(
  properties: EventProperties | undefined,
  maxDepth: number = Constraints.MAX_PROPERTY_DEPTH
): EventProperties | undefined {
  if (!properties || typeof properties !== 'object') {
    return undefined;
  }

  const sanitized = sanitizeValue(properties, 0, maxDepth);
  if (typeof sanitized === 'object' && sanitized !== null && !Array.isArray(sanitized)) {
    return sanitized as EventProperties;
  }

  return undefined;
}

/**
 * Recursively sanitize a property value.
 */
function sanitizeValue(
  value: EventPropertyValue,
  depth: number,
  maxDepth: number
): EventPropertyValue {
  // Null is valid
  if (value === null) {
    return null;
  }

  // Primitives
  if (typeof value === 'boolean' || typeof value === 'number') {
    return value;
  }

  // Strings - truncate if needed
  if (typeof value === 'string') {
    if (value.length > Constraints.MAX_STRING_PROPERTY_LENGTH) {
      logger.debug(
        `Truncating string property from ${value.length} to ${Constraints.MAX_STRING_PROPERTY_LENGTH} characters`
      );
      return value.substring(0, Constraints.MAX_STRING_PROPERTY_LENGTH);
    }
    return value;
  }

  // Arrays
  if (Array.isArray(value)) {
    if (depth >= maxDepth) {
      logger.debug(`Max property depth reached, omitting nested array`);
      return null;
    }
    return value.map((item) => sanitizeValue(item, depth + 1, maxDepth));
  }

  // Objects
  if (typeof value === 'object') {
    if (depth >= maxDepth) {
      logger.debug(`Max property depth reached, omitting nested object`);
      return null;
    }

    const result: Record<string, EventPropertyValue> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = sanitizeValue(val, depth + 1, maxDepth);
    }
    return result;
  }

  // Unknown type - convert to null
  return null;
}

/**
 * Resolve configuration with defaults.
 */
export function resolveConfiguration(config: MGMConfiguration): ResolvedConfiguration {
  const maxBatchSize = Math.min(
    Math.max(config.maxBatchSize ?? DefaultConfiguration.maxBatchSize, Constraints.MIN_BATCH_SIZE),
    Constraints.MAX_BATCH_SIZE
  );

  const flushInterval = Math.max(
    config.flushInterval ?? DefaultConfiguration.flushInterval,
    Constraints.MIN_FLUSH_INTERVAL
  );

  const maxStoredEvents = Math.max(
    config.maxStoredEvents ?? DefaultConfiguration.maxStoredEvents,
    Constraints.MIN_STORED_EVENTS
  );

  return {
    apiKey: config.apiKey,
    baseURL: config.baseURL ?? DefaultConfiguration.baseURL,
    environment: config.environment ?? DefaultConfiguration.environment,
    maxBatchSize,
    flushInterval,
    maxStoredEvents,
    enableDebugLogging: config.enableDebugLogging ?? DefaultConfiguration.enableDebugLogging,
    trackAppLifecycleEvents:
      config.trackAppLifecycleEvents ?? DefaultConfiguration.trackAppLifecycleEvents,
    bundleId: config.bundleId ?? detectBundleId(),
    appVersion: config.appVersion ?? '',
    osVersion: config.osVersion ?? '',
    platform: config.platform ?? detectPlatform(),
    sdk: config.sdk ?? 'javascript',
    sdkVersion: config.sdkVersion ?? '',
    storage: config.storage,
    networkClient: config.networkClient,
    onError: config.onError,
  };
}

/**
 * Detect the bundle ID from the current environment.
 */
function detectBundleId(): string {
  // In browser, use the hostname
  if (typeof window !== 'undefined' && window.location) {
    return window.location.hostname;
  }

  // In Node.js, could use package.json name but that requires fs access
  return '';
}

/**
 * Detect the current platform.
 * Note: For React Native, the platform should be passed via config (ios/android).
 */
export function detectPlatform(): Platform {
  // Check for Node.js
  if (typeof process !== 'undefined' && process.versions?.node) {
    return 'node';
  }

  // Default to web for browser environments
  return 'web';
}

/**
 * Detect the device type from user agent.
 */
export function detectDeviceType(): DeviceType {
  if (typeof navigator === 'undefined' || !navigator.userAgent) {
    return 'unknown';
  }

  const ua = navigator.userAgent.toLowerCase();

  // Check for specific device types
  if (/tablet|ipad|playbook|silk/i.test(ua)) {
    return 'tablet';
  }

  if (/mobile|iphone|ipod|android.*mobile|blackberry|opera mini|opera mobi/i.test(ua)) {
    return 'phone';
  }

  if (/smart-tv|smarttv|googletv|appletv|hbbtv|pov_tv|netcast.tv/i.test(ua)) {
    return 'tv';
  }

  // Default to desktop for other browsers
  if (typeof window !== 'undefined') {
    return 'desktop';
  }

  return 'unknown';
}

/**
 * Get the OS version string.
 */
export function getOSVersion(): string {
  if (typeof navigator === 'undefined' || !navigator.userAgent) {
    return '';
  }

  const ua = navigator.userAgent;

  // Try to extract OS version from user agent
  const patterns: [RegExp, string][] = [
    [/Windows NT ([\d.]+)/i, 'Windows'],
    [/Mac OS X ([\d_.]+)/i, 'macOS'],
    [/iPhone OS ([\d_]+)/i, 'iOS'],
    [/iPad.*OS ([\d_]+)/i, 'iPadOS'],
    [/Android ([\d.]+)/i, 'Android'],
    [/Linux/i, 'Linux'],
  ];

  for (const [pattern, osName] of patterns) {
    const match = ua.match(pattern);
    if (match) {
      const version = match[1]?.replace(/_/g, '.') ?? '';
      return version ? `${osName} ${version}` : osName;
    }
  }

  return '';
}

/**
 * Get the browser/device model.
 */
export function getDeviceModel(): string {
  if (typeof navigator === 'undefined' || !navigator.userAgent) {
    return '';
  }

  const ua = navigator.userAgent;

  // Try to extract browser name and version
  const patterns: [RegExp, string][] = [
    [/Chrome\/([\d.]+)/i, 'Chrome'],
    [/Firefox\/([\d.]+)/i, 'Firefox'],
    [/Safari\/([\d.]+)/i, 'Safari'],
    [/Edge\/([\d.]+)/i, 'Edge'],
    [/MSIE ([\d.]+)/i, 'IE'],
    [/Trident.*rv:([\d.]+)/i, 'IE'],
  ];

  for (const [pattern, browserName] of patterns) {
    const match = ua.match(pattern);
    if (match) {
      return `${browserName} ${match[1]}`;
    }
  }

  return '';
}

/**
 * Delay execution for a specified number of milliseconds.
 */
export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Get the user's locale.
 */
export function getLocale(): string {
  if (typeof navigator !== 'undefined') {
    return navigator.language || 'en';
  }
  return 'en';
}

/**
 * Get the user's timezone.
 */
export function getTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}
