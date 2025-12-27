import { InMemoryEventStorage, LocalStorageEventStorage, persistence } from './storage';
import { MGMEvent } from './types';

const createMockEvent = (name: string): MGMEvent => ({
  name,
  timestamp: new Date().toISOString(),
  platform: 'web',
  environment: 'test',
});

describe('InMemoryEventStorage', () => {
  let storage: InMemoryEventStorage;

  beforeEach(() => {
    storage = new InMemoryEventStorage(100);
  });

  it('should store and retrieve events', async () => {
    const event = createMockEvent('test_event');
    await storage.store(event);

    const events = await storage.fetchEvents(10);
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('test_event');
  });

  it('should return correct event count', async () => {
    expect(await storage.eventCount()).toBe(0);

    await storage.store(createMockEvent('event1'));
    expect(await storage.eventCount()).toBe(1);

    await storage.store(createMockEvent('event2'));
    expect(await storage.eventCount()).toBe(2);
  });

  it('should fetch events in FIFO order', async () => {
    await storage.store(createMockEvent('first'));
    await storage.store(createMockEvent('second'));
    await storage.store(createMockEvent('third'));

    const events = await storage.fetchEvents(2);
    expect(events).toHaveLength(2);
    expect(events[0].name).toBe('first');
    expect(events[1].name).toBe('second');
  });

  it('should remove events correctly', async () => {
    await storage.store(createMockEvent('first'));
    await storage.store(createMockEvent('second'));
    await storage.store(createMockEvent('third'));

    await storage.removeEvents(2);

    const events = await storage.fetchEvents(10);
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('third');
  });

  it('should clear all events', async () => {
    await storage.store(createMockEvent('event1'));
    await storage.store(createMockEvent('event2'));

    await storage.clear();

    expect(await storage.eventCount()).toBe(0);
  });

  it('should drop oldest events when exceeding max', async () => {
    // Note: minimum is 100, so we need to store more than 100 events
    const storage = new InMemoryEventStorage(100);

    // Store 105 events
    for (let i = 0; i < 105; i++) {
      await storage.store(createMockEvent(`event${i}`));
    }

    // Should have dropped to 100 (the max)
    expect(await storage.eventCount()).toBe(100);

    // First 5 events should have been dropped
    const events = await storage.fetchEvents(3);
    expect(events[0].name).toBe('event5');
    expect(events[1].name).toBe('event6');
    expect(events[2].name).toBe('event7');
  });

  it('should enforce minimum storage size', async () => {
    // Even with 0 max, should use minimum (100)
    const storage = new InMemoryEventStorage(0);

    for (let i = 0; i < 150; i++) {
      await storage.store(createMockEvent(`event${i}`));
    }

    // Should have dropped to 100 (minimum)
    expect(await storage.eventCount()).toBe(100);
  });
});

describe('LocalStorageEventStorage', () => {
  let storage: LocalStorageEventStorage;

  beforeEach(() => {
    // Mock localStorage
    const localStorageMock = (() => {
      let store: Record<string, string> = {};
      return {
        getItem: jest.fn((key: string) => store[key] ?? null),
        setItem: jest.fn((key: string, value: string) => {
          store[key] = value;
        }),
        removeItem: jest.fn((key: string) => {
          delete store[key];
        }),
        clear: jest.fn(() => {
          store = {};
        }),
      };
    })();

    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    });

    storage = new LocalStorageEventStorage(100);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('should store and retrieve events', async () => {
    const event = createMockEvent('test_event');
    await storage.store(event);

    const events = await storage.fetchEvents(10);
    expect(events).toHaveLength(1);
    expect(events[0].name).toBe('test_event');
  });

  it('should persist events to localStorage', async () => {
    const event = createMockEvent('persisted_event');
    await storage.store(event);

    expect(localStorage.setItem).toHaveBeenCalled();
  });

  it('should return correct event count', async () => {
    expect(await storage.eventCount()).toBe(0);

    await storage.store(createMockEvent('event1'));
    expect(await storage.eventCount()).toBe(1);

    await storage.store(createMockEvent('event2'));
    expect(await storage.eventCount()).toBe(2);
  });

  it('should clear events', async () => {
    await storage.store(createMockEvent('event1'));
    await storage.clear();

    expect(await storage.eventCount()).toBe(0);
    expect(localStorage.removeItem).toHaveBeenCalled();
  });

  it('should handle JSON parse errors gracefully', async () => {
    (localStorage.getItem as jest.Mock).mockReturnValueOnce('invalid json');

    // Should not throw and should return empty array
    const events = await storage.fetchEvents(10);
    expect(events).toHaveLength(0);
  });
});

describe('PersistenceManager super properties', () => {
  beforeEach(() => {
    // Mock localStorage
    const localStorageMock = (() => {
      let store: Record<string, string> = {};
      return {
        getItem: jest.fn((key: string) => store[key] ?? null),
        setItem: jest.fn((key: string, value: string) => {
          store[key] = value;
        }),
        removeItem: jest.fn((key: string) => {
          delete store[key];
        }),
        clear: jest.fn(() => {
          store = {};
        }),
      };
    })();

    Object.defineProperty(window, 'localStorage', {
      value: localStorageMock,
      writable: true,
    });

    // Clear any existing super properties
    persistence.clearSuperProperties();
  });

  afterEach(() => {
    jest.clearAllMocks();
    persistence.clearSuperProperties();
  });

  it('should return empty object when no super properties are set', () => {
    const props = persistence.getSuperProperties();
    expect(props).toEqual({});
  });

  it('should set and get a single super property', () => {
    persistence.setSuperProperty('tier', 'premium');

    const props = persistence.getSuperProperties();
    expect(props.tier).toBe('premium');
  });

  it('should set and get multiple super properties', () => {
    persistence.setSuperProperties({
      tier: 'enterprise',
      region: 'us-west',
      beta_user: true,
    });

    const props = persistence.getSuperProperties();
    expect(props.tier).toBe('enterprise');
    expect(props.region).toBe('us-west');
    expect(props.beta_user).toBe(true);
  });

  it('should merge properties when setting multiple times', () => {
    persistence.setSuperProperty('first', 'value1');
    persistence.setSuperProperties({
      second: 'value2',
      third: 'value3',
    });

    const props = persistence.getSuperProperties();
    expect(props.first).toBe('value1');
    expect(props.second).toBe('value2');
    expect(props.third).toBe('value3');
  });

  it('should override existing property with same key', () => {
    persistence.setSuperProperty('key', 'original');
    persistence.setSuperProperty('key', 'updated');

    const props = persistence.getSuperProperties();
    expect(props.key).toBe('updated');
  });

  it('should remove a single super property', () => {
    persistence.setSuperProperties({
      keep: 'this',
      remove: 'this',
    });

    persistence.removeSuperProperty('remove');

    const props = persistence.getSuperProperties();
    expect(props.keep).toBe('this');
    expect(props.remove).toBeUndefined();
  });

  it('should handle removing non-existent property gracefully', () => {
    persistence.setSuperProperty('exists', 'value');

    expect(() => persistence.removeSuperProperty('nonexistent')).not.toThrow();

    const props = persistence.getSuperProperties();
    expect(props.exists).toBe('value');
  });

  it('should clear all super properties', () => {
    persistence.setSuperProperties({
      prop1: 'value1',
      prop2: 'value2',
      prop3: 'value3',
    });

    persistence.clearSuperProperties();

    const props = persistence.getSuperProperties();
    expect(Object.keys(props)).toHaveLength(0);
  });

  it('should persist super properties to localStorage', () => {
    persistence.setSuperProperties({
      persistent: 'value',
    });

    expect(localStorage.setItem).toHaveBeenCalledWith(
      'mostlygoodmetrics_super_properties',
      JSON.stringify({ persistent: 'value' })
    );
  });

  it('should handle various value types', () => {
    persistence.setSuperProperties({
      string_val: 'text',
      number_val: 42,
      boolean_val: true,
      null_val: null,
    });

    const props = persistence.getSuperProperties();
    expect(props.string_val).toBe('text');
    expect(props.number_val).toBe(42);
    expect(props.boolean_val).toBe(true);
    expect(props.null_val).toBe(null);
  });

  it('should handle localStorage getItem returning corrupted JSON', () => {
    (localStorage.getItem as jest.Mock).mockReturnValueOnce('not valid json {');

    // Should not throw and should return empty object
    const props = persistence.getSuperProperties();
    expect(props).toEqual({});
  });
});

describe('PersistenceManager anonymous ID (localStorage)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (localStorage.getItem as jest.Mock).mockReturnValue(null);
    // Disable cookies for these tests to test localStorage behavior
    persistence.configureCookies(undefined, true);
  });

  const generateMockUUID = () => 'mock-uuid-12345';

  it('should generate anonymous ID if none exists', () => {
    const id = persistence.initializeAnonymousId(undefined, generateMockUUID);
    expect(id).toBe('mock-uuid-12345');
    expect(localStorage.setItem).toHaveBeenCalledWith(
      'mostlygoodmetrics_anonymous_id',
      'mock-uuid-12345'
    );
  });

  it('should return existing anonymous ID from localStorage', () => {
    (localStorage.getItem as jest.Mock).mockReturnValueOnce('existing-anonymous-id');
    const id = persistence.initializeAnonymousId(undefined, generateMockUUID);
    expect(id).toBe('existing-anonymous-id');
  });

  it('should use override ID from wrapper SDK', () => {
    const overrideId = 'react-native-device-id';
    const id = persistence.initializeAnonymousId(overrideId, generateMockUUID);
    expect(id).toBe(overrideId);
    expect(localStorage.setItem).toHaveBeenCalledWith('mostlygoodmetrics_anonymous_id', overrideId);
  });

  it('should prefer override ID over existing persisted ID', () => {
    (localStorage.getItem as jest.Mock).mockReturnValueOnce('existing-anonymous-id');
    const overrideId = 'react-native-device-id';
    const id = persistence.initializeAnonymousId(overrideId, generateMockUUID);
    expect(id).toBe(overrideId);
  });

  it('should reset anonymous ID with new UUID', () => {
    let callCount = 0;
    const generateNewUUID = () => {
      callCount++;
      return `new-uuid-${callCount}`;
    };

    const id1 = persistence.resetAnonymousId(generateNewUUID);
    expect(id1).toBe('new-uuid-1');

    const id2 = persistence.resetAnonymousId(generateNewUUID);
    expect(id2).toBe('new-uuid-2');
    expect(id2).not.toBe(id1);
  });

  it('should persist anonymous ID to localStorage', () => {
    persistence.setAnonymousId('test-anonymous-id');
    expect(localStorage.setItem).toHaveBeenCalledWith(
      'mostlygoodmetrics_anonymous_id',
      'test-anonymous-id'
    );
  });

  it('should get anonymous ID from localStorage', () => {
    (localStorage.getItem as jest.Mock).mockReturnValueOnce('stored-anonymous-id');
    const id = persistence.getAnonymousId();
    expect(id).toBe('stored-anonymous-id');
  });
});

describe('PersistenceManager anonymous ID (cookies)', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    (localStorage.getItem as jest.Mock).mockReturnValue(null);
    // Clear document.cookie
    document.cookie = 'mostlygoodmetrics_anonymous_id=; path=/; max-age=0';
  });

  const generateMockUUID = () => 'mock-uuid-12345';

  it('should use cookies when enabled', () => {
    persistence.configureCookies(undefined, false);
    persistence.setAnonymousId('cookie-test-id');
    expect(document.cookie).toContain('mostlygoodmetrics_anonymous_id=cookie-test-id');
  });

  it('should read from cookies before localStorage', () => {
    persistence.configureCookies(undefined, false);
    document.cookie = 'mostlygoodmetrics_anonymous_id=cookie-id; path=/';
    (localStorage.getItem as jest.Mock).mockReturnValue('localStorage-id');

    const id = persistence.getAnonymousId();
    expect(id).toBe('cookie-id');
  });

  it('should fall back to localStorage when cookie is not set', () => {
    persistence.configureCookies(undefined, false);
    (localStorage.getItem as jest.Mock).mockReturnValue('localStorage-id');

    const id = persistence.getAnonymousId();
    expect(id).toBe('localStorage-id');
  });

  it('should set cookie with custom domain for cross-subdomain support', () => {
    persistence.configureCookies('.example.com', false);
    persistence.setAnonymousId('cross-domain-id');
    // Note: jsdom rejects cookies for non-matching domains, so we verify localStorage fallback
    // In real browsers, the cookie would be set with domain=.example.com
    expect(localStorage.setItem).toHaveBeenCalledWith(
      'mostlygoodmetrics_anonymous_id',
      'cross-domain-id'
    );
  });

  it('should not use cookies when disabled', () => {
    persistence.configureCookies(undefined, true);
    persistence.setAnonymousId('no-cookie-id');
    // Cookie should not contain our ID (cleared in beforeEach)
    expect(document.cookie).not.toContain('mostlygoodmetrics_anonymous_id=no-cookie-id');
    // But localStorage should have it
    expect(localStorage.setItem).toHaveBeenCalledWith(
      'mostlygoodmetrics_anonymous_id',
      'no-cookie-id'
    );
  });
});
