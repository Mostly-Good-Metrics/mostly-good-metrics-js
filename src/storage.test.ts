import { InMemoryEventStorage, LocalStorageEventStorage } from './storage';
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
