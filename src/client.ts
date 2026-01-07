import { logger, setDebugLogging } from './logger';
import { createDefaultNetworkClient } from './network';
import { createDefaultStorage, persistence } from './storage';
import {
  EventProperties,
  IEventStorage,
  INetworkClient,
  MGMConfiguration,
  MGMEvent,
  MGMEventContext,
  MGMEventsPayload,
  ResolvedConfiguration,
  SystemEvents,
  SystemProperties,
  UserProfile,
} from './types';
import {
  delay,
  detectDeviceType,
  generateAnonymousId,
  generateUUID,
  getDeviceModel,
  getISOTimestamp,
  getLocale,
  getOSVersion,
  getTimezone,
  resolveConfiguration,
  sanitizeProperties,
  validateEventName,
} from './utils';

const FLUSH_DELAY_MS = 100; // Delay between batch sends

/**
 * Main client for MostlyGoodMetrics.
 * Use the static `configure` method to initialize, then use static methods or the instance.
 */
export class MostlyGoodMetrics {
  private static instance: MostlyGoodMetrics | null = null;

  private config: ResolvedConfiguration;
  private storage: IEventStorage;
  private networkClient: INetworkClient;
  private flushTimer: ReturnType<typeof setInterval> | null = null;
  private isFlushingInternal = false;
  private sessionIdValue: string;
  private anonymousIdValue: string;
  private lifecycleSetup = false;

  /**
   * Private constructor - use `configure` to create an instance.
   */
  private constructor(config: MGMConfiguration) {
    this.config = resolveConfiguration(config);
    this.sessionIdValue = generateUUID();

    // Configure cookie settings before initializing anonymous ID
    persistence.configureCookies(config.cookieDomain, config.disableCookies);
    this.anonymousIdValue = persistence.initializeAnonymousId(
      config.anonymousId,
      generateAnonymousId
    );

    // Set up logging
    setDebugLogging(this.config.enableDebugLogging);

    // Initialize storage
    this.storage = this.config.storage ?? createDefaultStorage(this.config.maxStoredEvents);

    // Initialize network client
    this.networkClient = this.config.networkClient ?? createDefaultNetworkClient();

    logger.info(`MostlyGoodMetrics initialized with environment: ${this.config.environment}`);

    // Start auto-flush timer
    this.startFlushTimer();

    // Set up lifecycle tracking
    if (this.config.trackAppLifecycleEvents) {
      this.setupLifecycleTracking();
    }
  }

  /**
   * Configure and initialize the SDK.
   * Returns the singleton instance.
   */
  static configure(config: MGMConfiguration): MostlyGoodMetrics {
    if (!config.apiKey) {
      throw new Error('API key is required');
    }

    if (MostlyGoodMetrics.instance) {
      logger.warn('MostlyGoodMetrics.configure called multiple times. Using existing instance.');
      return MostlyGoodMetrics.instance;
    }

    MostlyGoodMetrics.instance = new MostlyGoodMetrics(config);
    return MostlyGoodMetrics.instance;
  }

  /**
   * Get the shared instance, or null if not configured.
   */
  static get shared(): MostlyGoodMetrics | null {
    return MostlyGoodMetrics.instance;
  }

  /**
   * Check if the SDK has been configured.
   */
  static get isConfigured(): boolean {
    return MostlyGoodMetrics.instance !== null;
  }

  /**
   * Reset the SDK (primarily for testing).
   */
  static reset(): void {
    if (MostlyGoodMetrics.instance) {
      MostlyGoodMetrics.instance.destroy();
      MostlyGoodMetrics.instance = null;
    }
  }

  // =====================================================
  // Static convenience methods (delegate to shared instance)
  // =====================================================

  /**
   * Track an event with the given name and optional properties.
   */
  static track(name: string, properties?: EventProperties): void {
    MostlyGoodMetrics.instance?.track(name, properties);
  }

  /**
   * Identify the current user with optional profile data.
   * @param userId The user's unique identifier
   * @param profile Optional profile data (email, name)
   */
  static identify(userId: string, profile?: UserProfile): void {
    MostlyGoodMetrics.instance?.identify(userId, profile);
  }

  /**
   * Reset user identity.
   */
  static resetIdentity(): void {
    MostlyGoodMetrics.instance?.resetIdentity();
  }

  /**
   * Flush pending events to the server.
   */
  static flush(): Promise<void> {
    return MostlyGoodMetrics.instance?.flush() ?? Promise.resolve();
  }

  /**
   * Start a new session.
   */
  static startNewSession(): void {
    MostlyGoodMetrics.instance?.startNewSession();
  }

  /**
   * Clear all pending events.
   */
  static clearPendingEvents(): Promise<void> {
    return MostlyGoodMetrics.instance?.clearPendingEvents() ?? Promise.resolve();
  }

  /**
   * Get the count of pending events.
   */
  static getPendingEventCount(): Promise<number> {
    return MostlyGoodMetrics.instance?.getPendingEventCount() ?? Promise.resolve(0);
  }

  /**
   * Set a single super property that will be included with every event.
   */
  static setSuperProperty(key: string, value: EventProperties[string]): void {
    MostlyGoodMetrics.instance?.setSuperProperty(key, value);
  }

  /**
   * Set multiple super properties at once.
   */
  static setSuperProperties(properties: EventProperties): void {
    MostlyGoodMetrics.instance?.setSuperProperties(properties);
  }

  /**
   * Remove a single super property.
   */
  static removeSuperProperty(key: string): void {
    MostlyGoodMetrics.instance?.removeSuperProperty(key);
  }

  /**
   * Clear all super properties.
   */
  static clearSuperProperties(): void {
    MostlyGoodMetrics.instance?.clearSuperProperties();
  }

  /**
   * Get all current super properties.
   */
  static getSuperProperties(): EventProperties {
    return MostlyGoodMetrics.instance?.getSuperProperties() ?? {};
  }

  // =====================================================
  // Instance properties
  // =====================================================

  /**
   * Get the current user ID.
   */
  get userId(): string | null {
    return persistence.getUserId();
  }

  /**
   * Get the current session ID.
   */
  get sessionId(): string {
    return this.sessionIdValue;
  }

  /**
   * Get the anonymous ID (auto-generated UUID, persisted across sessions).
   */
  get anonymousId(): string {
    return this.anonymousIdValue;
  }

  /**
   * Check if a flush operation is in progress.
   */
  get isFlushing(): boolean {
    return this.isFlushingInternal;
  }

  /**
   * Get the resolved configuration.
   */
  get configuration(): ResolvedConfiguration {
    return { ...this.config };
  }

  // =====================================================
  // Instance methods
  // =====================================================

  /**
   * Track an event with the given name and optional properties.
   */
  track(name: string, properties?: EventProperties): void {
    try {
      validateEventName(name);
    } catch (e) {
      logger.error(`Invalid event name: ${name}`, e);
      return;
    }

    const sanitizedProperties = sanitizeProperties(properties);
    const superProperties = persistence.getSuperProperties();

    // Merge properties: super properties < event properties < system properties
    // Event properties override super properties, system properties are always added
    const mergedProperties: EventProperties = {
      ...superProperties,
      ...sanitizedProperties,
      [SystemProperties.DEVICE_TYPE]: detectDeviceType(),
      [SystemProperties.DEVICE_MODEL]: getDeviceModel(),
      [SystemProperties.SDK]: this.config.sdk,
    };

    const event: MGMEvent = {
      name,
      client_event_id: generateUUID(),
      timestamp: getISOTimestamp(),

      user_id: this.userId ?? this.anonymousIdValue,

      session_id: this.sessionIdValue,
      platform: this.config.platform,
      app_version: this.config.appVersion || undefined,
      os_version: this.config.osVersion || getOSVersion() || undefined,
      environment: this.config.environment,
      locale: getLocale(),
      timezone: getTimezone(),
      properties: Object.keys(mergedProperties).length > 0 ? mergedProperties : undefined,
    };

    logger.debug(`Tracking event: ${name}`, event);

    // Store event asynchronously
    this.storage.store(event).catch((e) => {
      logger.error('Failed to store event', e);
    });

    // Check if we should flush due to batch size
    void this.checkBatchSize();
  }

  /**
   * Identify the current user with optional profile data.
   * Profile data is sent to the backend via the $identify event.
   * Debouncing: only sends $identify if payload changed or >24h since last send.
   *
   * @param userId The user's unique identifier
   * @param profile Optional profile data (email, name)
   */
  identify(userId: string, profile?: UserProfile): void {
    if (!userId) {
      logger.warn('identify called with empty userId');
      return;
    }

    logger.debug(`Identifying user: ${userId}`);
    persistence.setUserId(userId);

    // If profile data is provided, check if we should send $identify event
    // eslint-disable-next-line @typescript-eslint/prefer-nullish-coalescing -- intentional truthy check for non-empty strings
    if (profile && (profile.email || profile.name)) {
      this.sendIdentifyEventIfNeeded(userId, profile);
    }
  }

  /**
   * Send $identify event if debounce conditions are met.
   * Only sends if: hash changed OR more than 24 hours since last send.
   */
  private sendIdentifyEventIfNeeded(userId: string, profile: UserProfile): void {
    // Compute hash of the identify payload
    const payloadString = JSON.stringify({ userId, email: profile.email, name: profile.name });
    const currentHash = this.simpleHash(payloadString);

    const storedHash = persistence.getIdentifyHash();
    const lastSentAt = persistence.getIdentifyLastSentAt();
    const now = Date.now();
    const twentyFourHoursMs = 24 * 60 * 60 * 1000;

    const hashChanged = storedHash !== currentHash;
    const expiredTime = !lastSentAt || now - lastSentAt > twentyFourHoursMs;

    if (hashChanged || expiredTime) {
      logger.debug(
        `Sending $identify event (hashChanged=${hashChanged}, expiredTime=${expiredTime})`
      );

      // Build properties object with only defined values
      const properties: EventProperties = {};
      if (profile.email) {
        properties.email = profile.email;
      }
      if (profile.name) {
        properties.name = profile.name;
      }

      // Track the $identify event
      this.track(SystemEvents.IDENTIFY, properties);

      // Update stored hash and timestamp
      persistence.setIdentifyHash(currentHash);
      persistence.setIdentifyLastSentAt(now);
    } else {
      logger.debug('Skipping $identify event (debounced)');
    }
  }

  /**
   * Simple hash function for debouncing.
   * Uses a basic string hash - not cryptographic, just for comparison.
   */
  private simpleHash(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(16);
  }

  /**
   * Reset user identity.
   * Clears the user ID and identify debounce state.
   */
  resetIdentity(): void {
    logger.debug('Resetting user identity');
    persistence.setUserId(null);
    persistence.clearIdentifyState();
  }

  /**
   * Start a new session.
   */
  startNewSession(): void {
    this.sessionIdValue = generateUUID();
    logger.debug(`Started new session: ${this.sessionIdValue}`);
  }

  /**
   * Flush pending events to the server.
   */
  async flush(): Promise<void> {
    if (this.isFlushingInternal) {
      logger.debug('Flush already in progress');
      return;
    }

    this.isFlushingInternal = true;
    logger.debug('Starting flush');

    try {
      await this.performFlush();
    } finally {
      this.isFlushingInternal = false;
    }
  }

  /**
   * Clear all pending events.
   */
  async clearPendingEvents(): Promise<void> {
    logger.debug('Clearing all pending events');
    await this.storage.clear();
  }

  /**
   * Get the count of pending events.
   */
  async getPendingEventCount(): Promise<number> {
    return this.storage.eventCount();
  }

  /**
   * Set a single super property that will be included with every event.
   */
  setSuperProperty(key: string, value: EventProperties[string]): void {
    logger.debug(`Setting super property: ${key}`);
    persistence.setSuperProperty(key, value);
  }

  /**
   * Set multiple super properties at once.
   */
  setSuperProperties(properties: EventProperties): void {
    logger.debug(`Setting super properties: ${Object.keys(properties).join(', ')}`);
    persistence.setSuperProperties(properties);
  }

  /**
   * Remove a single super property.
   */
  removeSuperProperty(key: string): void {
    logger.debug(`Removing super property: ${key}`);
    persistence.removeSuperProperty(key);
  }

  /**
   * Clear all super properties.
   */
  clearSuperProperties(): void {
    logger.debug('Clearing all super properties');
    persistence.clearSuperProperties();
  }

  /**
   * Get all current super properties.
   */
  getSuperProperties(): EventProperties {
    return persistence.getSuperProperties();
  }

  /**
   * Clean up resources (stop timers, etc.).
   */
  destroy(): void {
    this.stopFlushTimer();
    this.removeLifecycleListeners();
    logger.debug('MostlyGoodMetrics instance destroyed');
  }

  // =====================================================
  // Private methods
  // =====================================================

  private async checkBatchSize(): Promise<void> {
    const count = await this.storage.eventCount();
    if (count >= this.config.maxBatchSize) {
      logger.debug('Batch size threshold reached, triggering flush');
      void this.flush();
    }
  }

  private async performFlush(): Promise<void> {
    let hasMoreEvents = true;
    while (hasMoreEvents) {
      const eventCount = await this.storage.eventCount();
      if (eventCount === 0) {
        logger.debug('No events to flush');
        break;
      }

      // Check rate limiting
      if (this.networkClient.isRateLimited()) {
        logger.debug('Rate limited, skipping flush');
        break;
      }

      const events = await this.storage.fetchEvents(this.config.maxBatchSize);
      if (events.length === 0) {
        break;
      }

      const payload = this.buildPayload(events);
      const result = await this.networkClient.sendEvents(payload, this.config);

      if (result.success) {
        logger.debug(`Successfully sent ${events.length} events`);
        await this.storage.removeEvents(events.length);
      } else {
        logger.warn(`Failed to send events: ${result.error.message}`);

        // Call onError callback if configured
        if (this.config.onError) {
          try {
            this.config.onError(result.error);
          } catch (e) {
            logger.error('Error in onError callback', e);
          }
        }

        if (!result.shouldRetry) {
          // Drop events on non-retryable errors (4xx)
          logger.warn('Dropping events due to non-retryable error');
          await this.storage.removeEvents(events.length);
        } else {
          // Keep events for retry on retryable errors
          hasMoreEvents = false;
        }
      }

      // Small delay between batches to avoid overwhelming the server
      await delay(FLUSH_DELAY_MS);
    }
  }

  private buildPayload(events: MGMEvent[]): MGMEventsPayload {
    const context: MGMEventContext = {
      platform: this.config.platform,
      app_version: this.config.appVersion || undefined,
      os_version: this.config.osVersion || getOSVersion() || undefined,

      user_id: this.userId ?? this.anonymousIdValue,

      session_id: this.sessionIdValue,
      environment: this.config.environment,
      locale: getLocale(),
      timezone: getTimezone(),
    };

    return { events, context };
  }

  private startFlushTimer(): void {
    if (this.flushTimer) {
      return;
    }

    this.flushTimer = setInterval(() => {
      void this.flush();
    }, this.config.flushInterval * 1000);

    logger.debug(`Started flush timer (${this.config.flushInterval}s interval)`);
  }

  private stopFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
      logger.debug('Stopped flush timer');
    }
  }

  private setupLifecycleTracking(): void {
    if (this.lifecycleSetup) {
      return;
    }

    if (typeof window === 'undefined' || typeof document === 'undefined') {
      logger.debug('Not in browser environment, skipping lifecycle tracking');
      return;
    }

    this.lifecycleSetup = true;

    // Track app installed/updated
    this.trackInstallOrUpdate();

    // Track app opened
    this.trackAppOpened();

    // Track visibility changes (background/foreground)
    document.addEventListener('visibilitychange', this.handleVisibilityChange);

    // Flush on page unload
    window.addEventListener('beforeunload', this.handleBeforeUnload);
    window.addEventListener('pagehide', this.handlePageHide);

    logger.debug('Lifecycle tracking enabled');
  }

  private removeLifecycleListeners(): void {
    if (typeof document !== 'undefined') {
      document.removeEventListener('visibilitychange', this.handleVisibilityChange);
    }
    if (typeof window !== 'undefined') {
      window.removeEventListener('beforeunload', this.handleBeforeUnload);
      window.removeEventListener('pagehide', this.handlePageHide);
    }
  }

  private trackInstallOrUpdate(): void {
    const currentVersion = this.config.appVersion;
    const previousVersion = persistence.getAppVersion();

    if (!currentVersion) {
      // No version configured, skip install/update tracking
      return;
    }

    if (persistence.isFirstLaunch()) {
      // First launch ever - track install
      this.track(SystemEvents.APP_INSTALLED, {
        [SystemProperties.VERSION]: currentVersion,
      });
      persistence.setAppVersion(currentVersion);
    } else if (previousVersion && previousVersion !== currentVersion) {
      // Version changed - track update
      this.track(SystemEvents.APP_UPDATED, {
        [SystemProperties.VERSION]: currentVersion,
        [SystemProperties.PREVIOUS_VERSION]: previousVersion,
      });
      persistence.setAppVersion(currentVersion);
    } else if (!previousVersion) {
      // First time with version tracking
      persistence.setAppVersion(currentVersion);
    }
  }

  private trackAppOpened(): void {
    this.track(SystemEvents.APP_OPENED);
  }

  private handleVisibilityChange = (): void => {
    if (document.hidden) {
      // App backgrounded
      this.track(SystemEvents.APP_BACKGROUNDED);
      void this.flush(); // Flush when going to background
    } else {
      // App foregrounded
      this.track(SystemEvents.APP_OPENED);
    }
  };

  private handleBeforeUnload = (): void => {
    // Best-effort flush using sendBeacon if available
    this.flushWithBeacon();
  };

  private handlePageHide = (): void => {
    // Best-effort flush using sendBeacon if available
    this.flushWithBeacon();
  };

  private flushWithBeacon(): void {
    // Use sendBeacon for reliable delivery during page unload
    if (typeof navigator === 'undefined' || !navigator.sendBeacon) {
      return;
    }

    // Note: This is a synchronous, best-effort send
    // We can't use async storage operations here, so we rely on
    // the regular flush mechanism for most events
    logger.debug('Page unloading, attempting beacon flush');
  }
}
