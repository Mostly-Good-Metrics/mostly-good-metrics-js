import { logger } from './logger';
import { Constraints, EventProperties, IEventStorage, MGMError, MGMEvent } from './types';

const STORAGE_KEY = 'mostlygoodmetrics_events';
const USER_ID_KEY = 'mostlygoodmetrics_user_id';
const ANONYMOUS_ID_KEY = 'mostlygoodmetrics_anonymous_id';
const APP_VERSION_KEY = 'mostlygoodmetrics_app_version';
const SUPER_PROPERTIES_KEY = 'mostlygoodmetrics_super_properties';

/**
 * Check if we're running in a browser environment with localStorage available.
 */
function isLocalStorageAvailable(): boolean {
  try {
    if (typeof window === 'undefined' || typeof localStorage === 'undefined') {
      return false;
    }
    const testKey = '__mgm_test__';
    localStorage.setItem(testKey, 'test');
    localStorage.removeItem(testKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * In-memory event storage implementation.
 * Used as a fallback when localStorage is not available,
 * or for testing purposes.
 */
export class InMemoryEventStorage implements IEventStorage {
  private events: MGMEvent[] = [];
  private maxEvents: number;

  constructor(maxEvents: number = Constraints.MIN_STORED_EVENTS) {
    this.maxEvents = Math.max(maxEvents, Constraints.MIN_STORED_EVENTS);
  }

  async store(event: MGMEvent): Promise<void> {
    this.events.push(event);

    // Trim oldest events if we exceed the limit
    if (this.events.length > this.maxEvents) {
      const excess = this.events.length - this.maxEvents;
      this.events.splice(0, excess);
      logger.debug(`Dropped ${excess} oldest events due to storage limit`);
    }
  }

  async fetchEvents(limit: number): Promise<MGMEvent[]> {
    return this.events.slice(0, limit);
  }

  async removeEvents(count: number): Promise<void> {
    this.events.splice(0, count);
  }

  async eventCount(): Promise<number> {
    return this.events.length;
  }

  async clear(): Promise<void> {
    this.events = [];
  }

  /**
   * Update the maximum number of stored events.
   */
  setMaxEvents(maxEvents: number): void {
    this.maxEvents = Math.max(maxEvents, Constraints.MIN_STORED_EVENTS);
  }
}

/**
 * LocalStorage-based event storage implementation.
 * Persists events across page reloads and browser restarts.
 */
export class LocalStorageEventStorage implements IEventStorage {
  private maxEvents: number;
  private events: MGMEvent[] | null = null;

  constructor(maxEvents: number = Constraints.MIN_STORED_EVENTS) {
    this.maxEvents = Math.max(maxEvents, Constraints.MIN_STORED_EVENTS);
  }

  private loadEvents(): MGMEvent[] {
    if (this.events !== null) {
      return this.events;
    }

    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        this.events = JSON.parse(stored) as MGMEvent[];
      } else {
        this.events = [];
      }
    } catch (e) {
      logger.warn('Failed to load events from localStorage', e);
      this.events = [];
    }

    return this.events;
  }

  private saveEvents(): void {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(this.events ?? []));
    } catch (e) {
      logger.error('Failed to save events to localStorage', e);
      throw new MGMError('STORAGE_ERROR', 'Failed to save events to localStorage');
    }
  }

  async store(event: MGMEvent): Promise<void> {
    const events = this.loadEvents();
    events.push(event);

    // Trim oldest events if we exceed the limit
    if (events.length > this.maxEvents) {
      const excess = events.length - this.maxEvents;
      events.splice(0, excess);
      logger.debug(`Dropped ${excess} oldest events due to storage limit`);
    }

    this.saveEvents();
  }

  async fetchEvents(limit: number): Promise<MGMEvent[]> {
    const events = this.loadEvents();
    return events.slice(0, limit);
  }

  async removeEvents(count: number): Promise<void> {
    const events = this.loadEvents();
    events.splice(0, count);
    this.saveEvents();
  }

  async eventCount(): Promise<number> {
    return this.loadEvents().length;
  }

  async clear(): Promise<void> {
    this.events = [];
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch (e) {
      logger.warn('Failed to clear events from localStorage', e);
    }
  }

  /**
   * Update the maximum number of stored events.
   */
  setMaxEvents(maxEvents: number): void {
    this.maxEvents = Math.max(maxEvents, Constraints.MIN_STORED_EVENTS);
  }
}

/**
 * Create the appropriate storage implementation based on the environment.
 */
export function createDefaultStorage(maxEvents: number): IEventStorage {
  if (isLocalStorageAvailable()) {
    logger.debug('Using LocalStorage for event persistence');
    return new LocalStorageEventStorage(maxEvents);
  }

  logger.debug('LocalStorage not available, using in-memory storage');
  return new InMemoryEventStorage(maxEvents);
}

/**
 * Persistence helpers for user ID and app version.
 * These use localStorage when available, otherwise fall back to in-memory.
 */
class PersistenceManager {
  private inMemoryUserId: string | null = null;
  private inMemoryAnonymousId: string | null = null;
  private inMemoryAppVersion: string | null = null;
  private inMemorySuperProperties: EventProperties = {};

  /**
   * Get the persisted user ID.
   */
  getUserId(): string | null {
    if (isLocalStorageAvailable()) {
      return localStorage.getItem(USER_ID_KEY);
    }
    return this.inMemoryUserId;
  }

  /**
   * Set the user ID (persists across sessions).
   */
  setUserId(userId: string | null): void {
    if (isLocalStorageAvailable()) {
      if (userId) {
        localStorage.setItem(USER_ID_KEY, userId);
      } else {
        localStorage.removeItem(USER_ID_KEY);
      }
    }
    this.inMemoryUserId = userId;
  }

  /**
   * Get the anonymous ID (auto-generated UUID).
   */
  getAnonymousId(): string | null {
    if (isLocalStorageAvailable()) {
      return localStorage.getItem(ANONYMOUS_ID_KEY);
    }
    return this.inMemoryAnonymousId;
  }

  /**
   * Set the anonymous ID (persists across sessions).
   */
  setAnonymousId(anonymousId: string): void {
    if (isLocalStorageAvailable()) {
      localStorage.setItem(ANONYMOUS_ID_KEY, anonymousId);
    }
    this.inMemoryAnonymousId = anonymousId;
  }

  /**
   * Initialize the anonymous ID. If an override is provided, use it.
   * Otherwise, use existing persisted ID or generate a new one.
   * @param overrideId Optional ID from wrapper SDK (e.g., React Native device ID)
   * @param generateId Function to generate an anonymous ID
   */
  initializeAnonymousId(overrideId: string | undefined, generateId: () => string): string {
    // If wrapper SDK provides an override, always use it
    if (overrideId) {
      this.setAnonymousId(overrideId);
      return overrideId;
    }

    // Check for existing persisted anonymous ID
    const existingId = this.getAnonymousId();
    if (existingId) {
      return existingId;
    }

    // Generate and persist a new anonymous ID
    const newId = generateId();
    this.setAnonymousId(newId);
    return newId;
  }

  /**
   * Get the persisted app version (for detecting updates).
   */
  getAppVersion(): string | null {
    if (isLocalStorageAvailable()) {
      return localStorage.getItem(APP_VERSION_KEY);
    }
    return this.inMemoryAppVersion;
  }

  /**
   * Set the app version.
   */
  setAppVersion(version: string | null): void {
    if (isLocalStorageAvailable()) {
      if (version) {
        localStorage.setItem(APP_VERSION_KEY, version);
      } else {
        localStorage.removeItem(APP_VERSION_KEY);
      }
    }
    this.inMemoryAppVersion = version;
  }

  /**
   * Check if this is the first time the app has been opened.
   * Uses localStorage to detect first-ever installation.
   */
  isFirstLaunch(): boolean {
    const FIRST_LAUNCH_KEY = 'mostlygoodmetrics_installed';

    if (!isLocalStorageAvailable()) {
      return false; // Can't reliably detect without persistence
    }

    const hasLaunched = localStorage.getItem(FIRST_LAUNCH_KEY);
    if (!hasLaunched) {
      localStorage.setItem(FIRST_LAUNCH_KEY, 'true');
      return true;
    }
    return false;
  }

  /**
   * Get all super properties.
   */
  getSuperProperties(): EventProperties {
    if (isLocalStorageAvailable()) {
      try {
        const stored = localStorage.getItem(SUPER_PROPERTIES_KEY);
        if (stored) {
          return JSON.parse(stored) as EventProperties;
        }
      } catch (e) {
        logger.warn('Failed to load super properties from localStorage', e);
      }
      return {};
    }
    return { ...this.inMemorySuperProperties };
  }

  /**
   * Set a single super property.
   */
  setSuperProperty(key: string, value: EventProperties[string]): void {
    const properties = this.getSuperProperties();
    properties[key] = value;
    this.saveSuperProperties(properties);
  }

  /**
   * Set multiple super properties at once.
   */
  setSuperProperties(properties: EventProperties): void {
    const current = this.getSuperProperties();
    const merged = { ...current, ...properties };
    this.saveSuperProperties(merged);
  }

  /**
   * Remove a single super property.
   */
  removeSuperProperty(key: string): void {
    const properties = this.getSuperProperties();
    delete properties[key];
    this.saveSuperProperties(properties);
  }

  /**
   * Clear all super properties.
   */
  clearSuperProperties(): void {
    this.saveSuperProperties({});
  }

  private saveSuperProperties(properties: EventProperties): void {
    this.inMemorySuperProperties = properties;
    if (isLocalStorageAvailable()) {
      try {
        localStorage.setItem(SUPER_PROPERTIES_KEY, JSON.stringify(properties));
      } catch (e) {
        logger.warn('Failed to save super properties to localStorage', e);
      }
    }
  }
}

export const persistence = new PersistenceManager();
