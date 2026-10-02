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
 * Must match pattern: ^$?[a-zA-Z][a-zA-Z0-9_]*( [a-zA-Z0-9_]+)*$
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
      'Event name must start with a letter (or $ for system events) and contain only alphanumeric characters, underscores, and spaces'
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

  let sanitized: EventPropertyValue;
  try {
    sanitized = sanitizeValue(properties, 0, maxDepth, { remaining: 1024 });
  } catch {
    return undefined;
  }
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
  maxDepth: number,
  budget: { remaining: number }
): EventPropertyValue {
  if (budget.remaining-- <= 0) {
    return null;
  }
  // Null is valid
  if (value === null) {
    return null;
  }

  // Primitives
  if (typeof value === 'boolean' || typeof value === 'number') {
    return typeof value === 'number' && !Number.isFinite(value) ? null : value;
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
    return Array.from(
      { length: Math.min(value.length, Math.max(0, budget.remaining)) },
      (_, index) => {
        try {
          return sanitizeValue(value[index], depth + 1, maxDepth, budget);
        } catch {
          return null;
        }
      }
    );
  }

  // Objects
  if (typeof value === 'object') {
    if (depth >= maxDepth) {
      logger.debug(`Max property depth reached, omitting nested object`);
      return null;
    }

    const result: Record<string, EventPropertyValue> = {};
    for (const key of Object.keys(value)) {
      if (budget.remaining <= 0) {
        break;
      }
      try {
        // Define own data properties: even __proto__ must remain ordinary data.
        Object.defineProperty(result, key, {
          value: sanitizeValue(value[key], depth + 1, maxDepth, budget),
          enumerable: true,
          writable: true,
          configurable: true,
        });
      } catch {
        // Omit unreadable getters/proxies without losing the other properties.
      }
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
  // Browser/Node timers use a signed 32-bit millisecond delay. Overflowing it
  // can become a 1ms loop in Node instead of a long flush interval.
  const maxTimerMilliseconds = 2_147_483_647;
  const finite = (value: number | undefined, fallback: number): number =>
    Number.isFinite(value) ? (value as number) : fallback;
  const maxBatchSize = Math.min(
    Math.max(
      finite(config.maxBatchSize, DefaultConfiguration.maxBatchSize),
      Constraints.MIN_BATCH_SIZE
    ),
    Constraints.MAX_BATCH_SIZE
  );
  const flushInterval = Math.min(
    Math.max(
      finite(config.flushInterval, DefaultConfiguration.flushInterval),
      Constraints.MIN_FLUSH_INTERVAL
    ),
    Math.floor(maxTimerMilliseconds / 1000)
  );
  const maxStoredEvents = Math.min(
    Math.max(
      finite(config.maxStoredEvents, DefaultConfiguration.maxStoredEvents),
      Constraints.MIN_STORED_EVENTS
    ),
    Number.MAX_SAFE_INTEGER
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
    trackPageViews: config.trackPageViews ?? DefaultConfiguration.trackPageViews,
    sessionTimeoutMinutes: Math.min(
      Math.max(
        finite(config.sessionTimeoutMinutes, DefaultConfiguration.sessionTimeoutMinutes),
        Constraints.MIN_SESSION_TIMEOUT_MINUTES
      ),
      Math.floor(maxTimerMilliseconds / 60_000)
    ),
    existingInstallation: config.existingInstallation ?? DefaultConfiguration.existingInstallation,
    bundleId: config.bundleId ?? detectBundleId(),
    appVersion: config.appVersion ?? '',
    osVersion: config.osVersion ?? '',
    platform: config.platform ?? detectPlatform(),
    sdk: config.sdk ?? 'javascript',
    sdkVersion: config.sdkVersion ?? '',
    persistence:
      config.persistence ??
      (config.disableCookies ? 'localStorage' : DefaultConfiguration.persistence),
    optedOutByDefault: config.optedOutByDefault ?? DefaultConfiguration.optedOutByDefault,
    respectDoNotTrack: config.respectDoNotTrack ?? DefaultConfiguration.respectDoNotTrack,
    collectDeviceProperties:
      config.collectDeviceProperties ?? DefaultConfiguration.collectDeviceProperties,
    experimentMode: config.experimentMode ?? DefaultConfiguration.experimentMode,
    localExperiments: config.localExperiments,
    contextProvider: config.contextProvider,
    storage: config.storage,
    networkClient: config.networkClient,
    experimentStorage: config.experimentStorage,
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

/** Browser name and full version parsed from the user agent. */
export function getBrowserInfo(): { name: string; version: string } {
  if (typeof navigator === 'undefined' || !navigator.userAgent) {
    return { name: '', version: '' };
  }

  const patterns: [RegExp, string][] = [
    [/Edg\/([\d.]+)/i, 'Edge'],
    [/OPR\/([\d.]+)/i, 'Opera'],
    [/CriOS\/([\d.]+)/i, 'Chrome'],
    [/Chrome\/([\d.]+)/i, 'Chrome'],
    [/FxiOS\/([\d.]+)/i, 'Firefox'],
    [/Firefox\/([\d.]+)/i, 'Firefox'],
    [/Version\/([\d.]+).*Safari\//i, 'Safari'],
  ];

  for (const [pattern, name] of patterns) {
    const match = navigator.userAgent.match(pattern);
    if (match) {
      return { name, version: match[1] };
    }
  }

  return { name: '', version: '' };
}

/** Operating-system name without the version suffix. */
export function getOSName(): string {
  const value = getOSVersion();
  if (!value) {
    return '';
  }
  if (value.startsWith('macOS')) {
    return 'macOS';
  }
  if (value.startsWith('iPadOS')) {
    return 'iPadOS';
  }
  if (value.startsWith('iOS')) {
    return 'iOS';
  }
  if (value.startsWith('Android')) {
    return 'Android';
  }
  if (value.startsWith('Windows')) {
    return 'Windows';
  }
  if (value.startsWith('Linux')) {
    return 'Linux';
  }
  return value;
}

/**
 * Check whether the browser is signalling a tracking opt-out via
 * Do Not Track (`navigator.doNotTrack === '1'`) or Global Privacy Control
 * (`navigator.globalPrivacyControl === true`).
 * Only honored when the `respectDoNotTrack` configuration option is enabled.
 */
export function isDoNotTrackEnabled(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }

  const nav = navigator as Navigator & {
    doNotTrack?: string | null;
    globalPrivacyControl?: boolean;
  };

  if (nav.doNotTrack === '1') {
    return true;
  }

  if (nav.globalPrivacyControl === true) {
    return true;
  }

  return false;
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
