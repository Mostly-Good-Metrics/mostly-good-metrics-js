import { logger } from './logger';
import {
  Constraints,
  EventProperties,
  IEventStorage,
  IExperimentStorage,
  MGMError,
  MGMEvent,
  PersistenceMode,
} from './types';

const STORAGE_KEY = 'mostlygoodmetrics_events';
const USER_ID_KEY = 'mostlygoodmetrics_user_id';
const ANONYMOUS_ID_KEY = 'mostlygoodmetrics_anonymous_id';
const APP_VERSION_KEY = 'mostlygoodmetrics_app_version';
const SUPER_PROPERTIES_KEY = 'mostlygoodmetrics_super_properties';
const IDENTIFY_HASH_KEY = 'mostlygoodmetrics_identify_hash';
const IDENTIFY_TIMESTAMP_KEY = 'mostlygoodmetrics_identify_timestamp';
const OPT_OUT_KEY = 'mostlygoodmetrics_opt_out';
const SESSION_KEY = 'mostlygoodmetrics_session';
const STORAGE_WRITE_TIMEOUT_MS = 1000;

interface PersistedSession {
  id: string;
  lastActivityAt: number;
}

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
 * Check if cookies are available in this environment.
 */
function isCookieAvailable(): boolean {
  try {
    if (typeof document === 'undefined' || typeof document.cookie === 'undefined') {
      return false;
    }
    // Test if we can actually set a cookie
    const testKey = '__mgm_cookie_test__';
    document.cookie = `${testKey}=test; path=/; max-age=60`;
    const hasTest = document.cookie.indexOf(testKey) !== -1;
    // Clean up test cookie
    document.cookie = `${testKey}=; path=/; max-age=0`;
    return hasTest;
  } catch {
    return false;
  }
}

/**
 * Get a cookie value by name.
 */
function getCookie(name: string): string | null {
  if (!isCookieAvailable()) {
    return null;
  }
  const cookies = document.cookie.split(';');
  for (const cookie of cookies) {
    const [cookieName, cookieValue] = cookie.trim().split('=');
    if (cookieName === name) {
      return decodeURIComponent(cookieValue);
    }
  }
  return null;
}

/**
 * Set a cookie with optional domain for cross-subdomain support.
 * Uses a 1-year expiry by default.
 */
function setCookie(
  name: string,
  value: string,
  domain?: string,
  maxAge = 365 * 24 * 60 * 60
): void {
  if (!isCookieAvailable()) {
    return;
  }
  let cookieString = `${name}=${encodeURIComponent(value)}; path=/; max-age=${maxAge}; SameSite=Lax`;
  if (domain) {
    cookieString += `; domain=${domain}`;
  }
  document.cookie = cookieString;
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

  async removeEvents(count: number, clientEventIds?: string[]): Promise<void> {
    if (clientEventIds?.length) {
      const sentIds = new Set(clientEventIds.filter(Boolean));
      let idlessEventsToRemove = Math.max(0, count - sentIds.size);
      this.events = this.events.filter((event) => {
        if (event.client_event_id) {
          return !sentIds.has(event.client_event_id);
        }
        if (idlessEventsToRemove > 0) {
          idlessEventsToRemove -= 1;
          return false;
        }
        return true;
      });
    } else {
      this.events.splice(0, count);
    }
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
  private pendingSave: Promise<void> | null = null;
  private resolvePendingSave: (() => void) | null = null;
  private rejectPendingSave: ((error: unknown) => void) | null = null;
  private idleCallbackId: number | null = null;
  private timeoutId: number | null = null;
  private dirty = false;

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

  private scheduleSave(): Promise<void> {
    this.dirty = true;
    if (this.pendingSave) {
      return this.pendingSave;
    }

    this.pendingSave = new Promise<void>((resolve, reject) => {
      this.resolvePendingSave = resolve;
      this.rejectPendingSave = reject;
    });

    if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
      this.idleCallbackId = window.requestIdleCallback(() => this.flushPendingWrites(), {
        timeout: STORAGE_WRITE_TIMEOUT_MS,
      });
    } else if (typeof window !== 'undefined') {
      this.timeoutId = window.setTimeout(() => this.flushPendingWrites(), 0);
    } else {
      this.timeoutId = setTimeout(() => this.flushPendingWrites(), 0) as unknown as number;
    }

    return this.pendingSave;
  }

  private cancelScheduledSave(): void {
    if (
      this.idleCallbackId !== null &&
      typeof window !== 'undefined' &&
      typeof window.cancelIdleCallback === 'function'
    ) {
      window.cancelIdleCallback(this.idleCallbackId);
    }
    if (this.timeoutId !== null) {
      clearTimeout(this.timeoutId);
    }
    this.idleCallbackId = null;
    this.timeoutId = null;
  }

  private flushPendingWrites(): void {
    if (!this.dirty) {
      return;
    }

    this.cancelScheduledSave();
    const resolve = this.resolvePendingSave;
    const reject = this.rejectPendingSave;
    this.pendingSave = null;
    this.resolvePendingSave = null;
    this.rejectPendingSave = null;

    try {
      this.saveEvents();
      this.dirty = false;
      resolve?.();
    } catch (error) {
      reject?.(error);
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

    await this.scheduleSave();
  }

  async fetchEvents(limit: number): Promise<MGMEvent[]> {
    const events = this.loadEvents();
    return events.slice(0, limit);
  }

  async removeEvents(count: number, clientEventIds?: string[]): Promise<void> {
    const events = this.loadEvents();
    if (clientEventIds?.length) {
      const sentIds = new Set(clientEventIds.filter(Boolean));
      let idlessEventsToRemove = Math.max(0, count - sentIds.size);
      this.events = events.filter((event) => {
        if (event.client_event_id) {
          return !sentIds.has(event.client_event_id);
        }
        if (idlessEventsToRemove > 0) {
          idlessEventsToRemove -= 1;
          return false;
        }
        return true;
      });
    } else {
      events.splice(0, count);
    }
    await this.scheduleSave();
  }

  async eventCount(): Promise<number> {
    return this.loadEvents().length;
  }

  async clear(): Promise<void> {
    this.events = [];
    this.cancelScheduledSave();
    this.dirty = false;
    this.pendingSave = null;
    this.resolvePendingSave?.();
    this.resolvePendingSave = null;
    this.rejectPendingSave = null;
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
 * Persist any queued LocalStorageEventStorage mutation immediately.
 * Used by browser teardown paths so deferred writes cannot lose events.
 */
export function flushPendingStorageWrites(storage: IEventStorage): void {
  if (storage instanceof LocalStorageEventStorage) {
    const flushable = storage as unknown as { flushPendingWrites(): void };
    flushable.flushPendingWrites();
  }
}

/**
 * Create the appropriate storage implementation based on the environment.
 */
export function createDefaultStorage(
  maxEvents: number,
  mode: PersistenceMode = 'localStorage+cookie'
): IEventStorage {
  if (mode === 'memory') {
    logger.debug('Memory persistence mode, using in-memory event storage');
    return new InMemoryEventStorage(maxEvents);
  }

  if (isLocalStorageAvailable()) {
    logger.debug('Using LocalStorage for event persistence');
    return new LocalStorageEventStorage(maxEvents);
  }

  logger.debug('LocalStorage not available, using in-memory storage');
  return new InMemoryEventStorage(maxEvents);
}

/**
 * localStorage-backed experiment storage adapter (default in browsers).
 */
export class LocalStorageExperimentStorage implements IExperimentStorage {
  getItem(key: string): string | null {
    try {
      return localStorage.getItem(key);
    } catch (e) {
      logger.debug(`Failed to read '${key}' from localStorage`, e);
      return null;
    }
  }

  setItem(key: string, value: string): void {
    try {
      localStorage.setItem(key, value);
    } catch (e) {
      logger.debug(`Failed to write '${key}' to localStorage`, e);
    }
  }
}

/**
 * In-memory experiment storage adapter.
 * Used as a fallback when localStorage is not available, or for testing.
 */
export class InMemoryExperimentStorage implements IExperimentStorage {
  private values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }
}

/**
 * Create the appropriate experiment storage implementation for the environment.
 * React Native apps should inject an AsyncStorage-backed adapter via the
 * `experimentStorage` configuration option instead.
 */
export function createDefaultExperimentStorage(
  mode: PersistenceMode = 'localStorage+cookie'
): IExperimentStorage {
  if (mode !== 'memory' && isLocalStorageAvailable()) {
    return new LocalStorageExperimentStorage();
  }
  return new InMemoryExperimentStorage();
}

/**
 * Persistence helpers for user ID and app version.
 * Uses cookies first (for cross-subdomain support), then localStorage as fallback.
 */
class PersistenceManager {
  private inMemoryUserId: string | null = null;
  private inMemoryAnonymousId: string | null = null;
  private inMemoryAppVersion: string | null = null;
  private inMemorySuperProperties: EventProperties = {};
  private inMemoryOptOut: boolean | null = null;
  private inMemoryIdentifyHash: string | null = null;
  private inMemoryIdentifyLastSentAt: number | null = null;
  private inMemorySession: PersistedSession | null = null;
  private cookieDomain: string | undefined = undefined;
  private mode: PersistenceMode = 'localStorage+cookie';

  /**
   * Configure persistence settings.
   * @param mode Where to persist state ('localStorage+cookie', 'localStorage', or 'memory')
   * @param cookieDomain Domain for cross-subdomain cookies (e.g., '.example.com')
   */
  configurePersistence(mode: PersistenceMode, cookieDomain?: string): void {
    this.mode = mode;
    this.cookieDomain = cookieDomain;
  }

  /**
   * Backwards-compatible cookie configuration.
   * @param cookieDomain Domain for cross-subdomain cookies (e.g., '.example.com')
   * @param disableCookies If true, only use localStorage (no cookies)
   */
  configureCookies(cookieDomain?: string, disableCookies?: boolean): void {
    this.configurePersistence(
      disableCookies ? 'localStorage' : 'localStorage+cookie',
      cookieDomain
    );
  }

  /**
   * Check if cookies should be used.
   */
  private shouldUseCookies(): boolean {
    return this.mode === 'localStorage+cookie' && isCookieAvailable();
  }

  /**
   * Check if localStorage should be used.
   */
  private shouldUseLocalStorage(): boolean {
    return this.mode !== 'memory' && isLocalStorageAvailable();
  }

  /**
   * Get the persisted user ID.
   */
  getUserId(): string | null {
    if (this.shouldUseLocalStorage()) {
      return localStorage.getItem(USER_ID_KEY);
    }
    return this.inMemoryUserId;
  }

  /**
   * Set the user ID (persists across sessions).
   */
  setUserId(userId: string | null): void {
    if (this.shouldUseLocalStorage()) {
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
   * Checks cookies first, then localStorage, then in-memory.
   */
  getAnonymousId(): string | null {
    // Try cookies first (for cross-subdomain support)
    if (this.shouldUseCookies()) {
      const cookieId = getCookie(ANONYMOUS_ID_KEY);
      if (cookieId) {
        return cookieId;
      }
    }

    // Fall back to localStorage
    if (this.shouldUseLocalStorage()) {
      return localStorage.getItem(ANONYMOUS_ID_KEY);
    }

    return this.inMemoryAnonymousId;
  }

  /**
   * Set the anonymous ID (persists across sessions).
   * Saves to both cookies and localStorage for redundancy.
   */
  setAnonymousId(anonymousId: string): void {
    // Save to cookies if enabled
    if (this.shouldUseCookies()) {
      setCookie(ANONYMOUS_ID_KEY, anonymousId, this.cookieDomain);
    }

    // Also save to localStorage as fallback
    if (this.shouldUseLocalStorage()) {
      localStorage.setItem(ANONYMOUS_ID_KEY, anonymousId);
    }

    this.inMemoryAnonymousId = anonymousId;
  }

  /**
   * Initialize the anonymous ID. If an override is provided, use it.
   * Otherwise, use existing persisted ID or generate a new UUID.
   * @param overrideId Optional ID from wrapper SDK (e.g., React Native device ID)
   * @param generateUUID Function to generate a UUID
   */
  initializeAnonymousId(overrideId: string | undefined, generateUUID: () => string): string {
    // If wrapper SDK provides an override, always use it
    if (overrideId) {
      this.setAnonymousId(overrideId);
      return overrideId;
    }

    // Check for existing persisted anonymous ID
    const existingId = this.getAnonymousId();
    if (existingId) {
      // Ensure it's saved to cookies if we have cookie support now
      if (this.shouldUseCookies() && !getCookie(ANONYMOUS_ID_KEY)) {
        setCookie(ANONYMOUS_ID_KEY, existingId, this.cookieDomain);
      }
      return existingId;
    }

    // Generate and persist a new anonymous ID
    const newId = generateUUID();
    this.setAnonymousId(newId);
    return newId;
  }

  /**
   * Reset the anonymous ID to a new UUID.
   * @param generateUUID Function to generate a UUID
   */
  resetAnonymousId(generateUUID: () => string): string {
    const newId = generateUUID();
    this.setAnonymousId(newId);
    return newId;
  }

  /**
   * Get the persisted app version (for detecting updates).
   */
  getAppVersion(): string | null {
    if (this.shouldUseLocalStorage()) {
      return localStorage.getItem(APP_VERSION_KEY);
    }
    return this.inMemoryAppVersion;
  }

  /**
   * Set the app version.
   */
  setAppVersion(version: string | null): void {
    if (this.shouldUseLocalStorage()) {
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

    if (!this.shouldUseLocalStorage()) {
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
    if (this.shouldUseLocalStorage()) {
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
    if (this.shouldUseLocalStorage()) {
      try {
        localStorage.setItem(SUPER_PROPERTIES_KEY, JSON.stringify(properties));
      } catch (e) {
        logger.warn('Failed to save super properties to localStorage', e);
      }
    }
  }

  /**
   * Get the stored identify hash (for debouncing).
   */
  getIdentifyHash(): string | null {
    if (this.shouldUseLocalStorage()) {
      return localStorage.getItem(IDENTIFY_HASH_KEY);
    }
    return this.inMemoryIdentifyHash;
  }

  /**
   * Set the identify hash.
   */
  setIdentifyHash(hash: string): void {
    if (this.shouldUseLocalStorage()) {
      localStorage.setItem(IDENTIFY_HASH_KEY, hash);
    }
    this.inMemoryIdentifyHash = hash;
  }

  /**
   * Get the timestamp of the last identify event sent.
   */
  getIdentifyLastSentAt(): number | null {
    if (this.shouldUseLocalStorage()) {
      const timestamp = localStorage.getItem(IDENTIFY_TIMESTAMP_KEY);
      return timestamp ? parseInt(timestamp, 10) : null;
    }
    return this.inMemoryIdentifyLastSentAt;
  }

  /**
   * Set the timestamp of the last identify event sent.
   */
  setIdentifyLastSentAt(timestamp: number): void {
    if (this.shouldUseLocalStorage()) {
      localStorage.setItem(IDENTIFY_TIMESTAMP_KEY, timestamp.toString());
    }
    this.inMemoryIdentifyLastSentAt = timestamp;
  }

  /**
   * Clear identify debounce state (used when resetting identity).
   */
  clearIdentifyState(): void {
    if (this.shouldUseLocalStorage()) {
      localStorage.removeItem(IDENTIFY_HASH_KEY);
      localStorage.removeItem(IDENTIFY_TIMESTAMP_KEY);
    }
    this.inMemoryIdentifyHash = null;
    this.inMemoryIdentifyLastSentAt = null;
  }

  /**
   * Get the persisted opt-out choice.
   * Returns true (opted out), false (explicitly opted in), or null when the
   * user has never made an explicit choice.
   */
  getOptOutStatus(): boolean | null {
    // Check cookies first (consistent with anonymous ID persistence)
    if (this.shouldUseCookies()) {
      const cookieValue = getCookie(OPT_OUT_KEY);
      if (cookieValue === 'true') {
        return true;
      }
      if (cookieValue === 'false') {
        return false;
      }
    }

    if (this.shouldUseLocalStorage()) {
      try {
        const stored = localStorage.getItem(OPT_OUT_KEY);
        if (stored === 'true') {
          return true;
        }
        if (stored === 'false') {
          return false;
        }
      } catch (e) {
        logger.warn('Failed to read opt-out status from localStorage', e);
      }
    }

    // Only consult the in-memory value when no durable storage is usable
    // (memory mode or non-browser environments). When durable storage is
    // available but empty, the user has made no persisted choice.
    if (!this.shouldUseCookies() && !this.shouldUseLocalStorage()) {
      return this.inMemoryOptOut;
    }

    return null;
  }

  /**
   * Persist the user's explicit opt-out choice.
   * Both states are stored so an explicit optIn() overrides
   * `optedOutByDefault` and Do Not Track defaults on later visits.
   */
  setOptOutStatus(optedOut: boolean): void {
    const value = optedOut ? 'true' : 'false';

    if (this.shouldUseCookies()) {
      setCookie(OPT_OUT_KEY, value, this.cookieDomain);
    }

    if (this.shouldUseLocalStorage()) {
      try {
        localStorage.setItem(OPT_OUT_KEY, value);
      } catch (e) {
        logger.warn('Failed to persist opt-out status to localStorage', e);
      }
    }

    this.inMemoryOptOut = optedOut;
  }

  /** Resolve and touch the browser session using an inactivity timeout. */
  touchSession(timeoutMs: number, generateUUID: () => string): string {
    const now = Date.now();
    let session = this.getSession();

    if (!session || now - session.lastActivityAt >= timeoutMs) {
      session = { id: generateUUID(), lastActivityAt: now };
    } else {
      session.lastActivityAt = now;
    }

    this.setSession(session, timeoutMs);
    return session.id;
  }

  /** Force a fresh browser session. */
  resetSession(timeoutMs: number, generateUUID: () => string): string {
    const session = { id: generateUUID(), lastActivityAt: Date.now() };
    this.setSession(session, timeoutMs);
    return session.id;
  }

  clearSession(): void {
    if (this.shouldUseCookies()) {
      setCookie(SESSION_KEY, '', this.cookieDomain, 0);
    }
    if (this.shouldUseLocalStorage()) {
      try {
        localStorage.removeItem(SESSION_KEY);
      } catch {
        /* best effort */
      }
    }
    this.inMemorySession = null;
  }

  private getSession(): PersistedSession | null {
    if (this.shouldUseCookies()) {
      const raw = getCookie(SESSION_KEY);
      if (raw) {
        const session = this.parseSession(raw);
        if (session) {
          return session;
        }
      }
    }

    if (this.shouldUseLocalStorage()) {
      try {
        const raw = localStorage.getItem(SESSION_KEY);
        return raw ? this.parseSession(raw) : null;
      } catch {
        return null;
      }
    }

    return this.inMemorySession;
  }

  private parseSession(raw: string): PersistedSession | null {
    try {
      const value = JSON.parse(raw) as Partial<PersistedSession>;
      return typeof value.id === 'string' &&
        value.id !== '' &&
        Number.isFinite(value.lastActivityAt)
        ? { id: value.id, lastActivityAt: value.lastActivityAt as number }
        : null;
    } catch {
      return null;
    }
  }

  private setSession(session: PersistedSession, timeoutMs: number): void {
    const raw = JSON.stringify(session);
    if (this.shouldUseCookies()) {
      setCookie(SESSION_KEY, raw, this.cookieDomain, Math.ceil(timeoutMs / 1000));
    }
    if (this.shouldUseLocalStorage()) {
      try {
        localStorage.setItem(SESSION_KEY, raw);
      } catch {
        /* best effort */
      }
    }
    this.inMemorySession = session;
  }
}

export const persistence = new PersistenceManager();
