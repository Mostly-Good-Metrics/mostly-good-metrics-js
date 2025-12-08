import { logger } from './logger';
import { Constraints, IEventStorage, MGMError, MGMEvent } from './types';

const STORAGE_KEY = 'mostlygoodmetrics_events';
const USER_ID_KEY = 'mostlygoodmetrics_user_id';
const APP_VERSION_KEY = 'mostlygoodmetrics_app_version';

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
  private inMemoryAppVersion: string | null = null;

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
}

export const persistence = new PersistenceManager();
