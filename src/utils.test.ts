import {
  generateAnonymousId,
  generateUUID,
  getISOTimestamp,
  isValidEventName,
  validateEventName,
  sanitizeProperties,
  resolveConfiguration,
  getLocale,
  getTimezone,
} from './utils';
import { Constraints, DefaultConfiguration, MGMError } from './types';

describe('generateUUID', () => {
  it('should generate a valid UUID v4 format', () => {
    const uuid = generateUUID();
    const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    expect(uuid).toMatch(uuidRegex);
  });

  it('should generate unique UUIDs', () => {
    const uuids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      uuids.add(generateUUID());
    }
    expect(uuids.size).toBe(100);
  });
});

describe('generateAnonymousId', () => {
  it('should generate an ID with $anon_ prefix', () => {
    const id = generateAnonymousId();
    expect(id).toMatch(/^\$anon_[a-z0-9]{12}$/);
  });

  it('should generate unique IDs', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(generateAnonymousId());
    }
    expect(ids.size).toBe(100);
  });

  it('should be 18 characters total ($anon_ + 12 random)', () => {
    const id = generateAnonymousId();
    expect(id.length).toBe(18);
  });
});

describe('getISOTimestamp', () => {
  it('should return a valid ISO8601 timestamp', () => {
    const timestamp = getISOTimestamp();
    const parsed = new Date(timestamp);
    expect(parsed.toISOString()).toBe(timestamp);
  });

  it('should return current time', () => {
    const before = Date.now();
    const timestamp = getISOTimestamp();
    const after = Date.now();

    const timestampMs = new Date(timestamp).getTime();
    expect(timestampMs).toBeGreaterThanOrEqual(before);
    expect(timestampMs).toBeLessThanOrEqual(after);
  });
});

describe('isValidEventName', () => {
  it('should accept valid event names', () => {
    expect(isValidEventName('button_clicked')).toBe(true);
    expect(isValidEventName('PageView')).toBe(true);
    expect(isValidEventName('event123')).toBe(true);
    expect(isValidEventName('a')).toBe(true);
    expect(isValidEventName('ABC_123_xyz')).toBe(true);
  });

  it('should accept system event names (starting with $)', () => {
    expect(isValidEventName('$app_opened')).toBe(true);
    expect(isValidEventName('$app_installed')).toBe(true);
    expect(isValidEventName('$custom_system_event')).toBe(true);
  });

  it('should reject invalid event names', () => {
    expect(isValidEventName('')).toBe(false);
    expect(isValidEventName('123_event')).toBe(false); // starts with number
    expect(isValidEventName('_event')).toBe(false); // starts with underscore
    expect(isValidEventName('event-name')).toBe(false); // contains hyphen
    expect(isValidEventName('event.name')).toBe(false); // contains dot
    expect(isValidEventName('event name')).toBe(false); // contains space
    expect(isValidEventName('event@name')).toBe(false); // contains @
  });

  it('should reject event names exceeding max length', () => {
    const longName = 'a'.repeat(Constraints.MAX_EVENT_NAME_LENGTH + 1);
    expect(isValidEventName(longName)).toBe(false);

    const maxLengthName = 'a'.repeat(Constraints.MAX_EVENT_NAME_LENGTH);
    expect(isValidEventName(maxLengthName)).toBe(true);
  });
});

describe('validateEventName', () => {
  it('should not throw for valid event names', () => {
    expect(() => validateEventName('valid_event')).not.toThrow();
    expect(() => validateEventName('$system_event')).not.toThrow();
  });

  it('should throw MGMError for empty event names', () => {
    expect(() => validateEventName('')).toThrow(MGMError);
    try {
      validateEventName('');
    } catch (e) {
      expect(e).toBeInstanceOf(MGMError);
      expect((e as MGMError).type).toBe('INVALID_EVENT_NAME');
    }
  });

  it('should throw MGMError for invalid event names', () => {
    expect(() => validateEventName('123invalid')).toThrow(MGMError);
    try {
      validateEventName('invalid-name');
    } catch (e) {
      expect(e).toBeInstanceOf(MGMError);
      expect((e as MGMError).type).toBe('INVALID_EVENT_NAME');
    }
  });
});

describe('sanitizeProperties', () => {
  it('should return undefined for undefined input', () => {
    expect(sanitizeProperties(undefined)).toBeUndefined();
  });

  it('should pass through valid properties unchanged', () => {
    const props = {
      string: 'value',
      number: 42,
      boolean: true,
      null: null,
    };
    expect(sanitizeProperties(props)).toEqual(props);
  });

  it('should truncate long strings', () => {
    const longString = 'a'.repeat(Constraints.MAX_STRING_PROPERTY_LENGTH + 100);
    const props = { text: longString };

    const sanitized = sanitizeProperties(props);
    expect(sanitized?.text).toHaveLength(Constraints.MAX_STRING_PROPERTY_LENGTH);
  });

  it('should handle nested objects within depth limit', () => {
    const props = {
      level1: {
        level2: {
          level3: 'value',
        },
      },
    };

    const sanitized = sanitizeProperties(props);
    expect(sanitized).toEqual(props);
  });

  it('should truncate objects exceeding max depth', () => {
    const props = {
      level1: {
        level2: {
          level3: {
            level4: 'too deep',
          },
        },
      },
    };

    const sanitized = sanitizeProperties(props);
    expect(sanitized?.level1).toBeDefined();
    expect((sanitized?.level1 as Record<string, unknown>).level2).toBeDefined();
    expect(
      ((sanitized?.level1 as Record<string, unknown>).level2 as Record<string, unknown>).level3
    ).toBeNull();
  });

  it('should handle arrays', () => {
    const props = {
      items: ['a', 'b', 'c'],
      numbers: [1, 2, 3],
    };

    expect(sanitizeProperties(props)).toEqual(props);
  });

  it('should handle mixed content', () => {
    const props = {
      user: {
        name: 'John',
        age: 30,
        tags: ['premium', 'active'],
      },
      active: true,
      score: null,
    };

    expect(sanitizeProperties(props)).toEqual(props);
  });
});

describe('resolveConfiguration', () => {
  it('should apply default values', () => {
    const config = resolveConfiguration({ apiKey: 'test-key' });

    expect(config.apiKey).toBe('test-key');
    expect(config.baseURL).toBe(DefaultConfiguration.baseURL);
    expect(config.environment).toBe(DefaultConfiguration.environment);
    expect(config.maxBatchSize).toBe(DefaultConfiguration.maxBatchSize);
    expect(config.flushInterval).toBe(DefaultConfiguration.flushInterval);
    expect(config.maxStoredEvents).toBe(DefaultConfiguration.maxStoredEvents);
    expect(config.enableDebugLogging).toBe(DefaultConfiguration.enableDebugLogging);
    expect(config.trackAppLifecycleEvents).toBe(DefaultConfiguration.trackAppLifecycleEvents);
  });

  it('should use provided values', () => {
    const config = resolveConfiguration({
      apiKey: 'test-key',
      baseURL: 'https://custom.api.com',
      environment: 'staging',
      maxBatchSize: 50,
      flushInterval: 60,
      maxStoredEvents: 5000,
      enableDebugLogging: true,
      trackAppLifecycleEvents: false,
    });

    expect(config.baseURL).toBe('https://custom.api.com');
    expect(config.environment).toBe('staging');
    expect(config.maxBatchSize).toBe(50);
    expect(config.flushInterval).toBe(60);
    expect(config.maxStoredEvents).toBe(5000);
    expect(config.enableDebugLogging).toBe(true);
    expect(config.trackAppLifecycleEvents).toBe(false);
  });

  it('should enforce maxBatchSize constraints', () => {
    // Too high
    let config = resolveConfiguration({ apiKey: 'test', maxBatchSize: 2000 });
    expect(config.maxBatchSize).toBe(Constraints.MAX_BATCH_SIZE);

    // Too low
    config = resolveConfiguration({ apiKey: 'test', maxBatchSize: 0 });
    expect(config.maxBatchSize).toBe(Constraints.MIN_BATCH_SIZE);
  });

  it('should enforce flushInterval minimum', () => {
    const config = resolveConfiguration({ apiKey: 'test', flushInterval: 0 });
    expect(config.flushInterval).toBe(Constraints.MIN_FLUSH_INTERVAL);
  });

  it('should enforce maxStoredEvents minimum', () => {
    const config = resolveConfiguration({ apiKey: 'test', maxStoredEvents: 10 });
    expect(config.maxStoredEvents).toBe(Constraints.MIN_STORED_EVENTS);
  });
});

describe('getLocale', () => {
  it('should return a non-empty string', () => {
    const locale = getLocale();
    expect(typeof locale).toBe('string');
    expect(locale.length).toBeGreaterThan(0);
  });

  it('should return a locale-like string (e.g., en, en-US)', () => {
    const locale = getLocale();
    // Locale should be something like "en", "en-US", "fr-FR", etc.
    expect(locale).toMatch(/^[a-z]{2}(-[A-Z]{2})?$/i);
  });
});

describe('getTimezone', () => {
  it('should return a string', () => {
    const timezone = getTimezone();
    expect(typeof timezone).toBe('string');
  });

  it('should return a valid IANA timezone or empty string', () => {
    const timezone = getTimezone();
    // Should be empty or a valid IANA timezone like "America/New_York" or "UTC"
    if (timezone) {
      expect(timezone).toMatch(/^([A-Za-z_]+\/[A-Za-z_]+|UTC)$/);
    }
  });
});
