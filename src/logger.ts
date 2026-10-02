/**
 * Internal logger for the MostlyGoodMetrics SDK.
 * Only outputs when debug logging is enabled.
 */

const LOG_PREFIX = '[MostlyGoodMetrics]';

let debugEnabled = false;

/**
 * Enable or disable debug logging.
 */
export function setDebugLogging(enabled: boolean): void {
  debugEnabled = enabled;
}

/**
 * Check if debug logging is enabled.
 */
export function isDebugEnabled(): boolean {
  return debugEnabled;
}

/**
 * Log a debug message (only when debug logging is enabled).
 */
export function debug(message: string, ...args: unknown[]): void {
  if (debugEnabled) {
    try {
      console.log(`${LOG_PREFIX} [DEBUG]`, message, ...args);
    } catch {
      // Logging integrations must never interrupt the host application.
    }
  }
}

/**
 * Log an info message (only when debug logging is enabled).
 */
export function info(message: string, ...args: unknown[]): void {
  if (debugEnabled) {
    try {
      console.info(`${LOG_PREFIX} [INFO]`, message, ...args);
    } catch {
      // Logging integrations must never interrupt the host application.
    }
  }
}

/**
 * Log a warning message (always shown).
 */
export function warn(message: string, ...args: unknown[]): void {
  try {
    console.warn(`${LOG_PREFIX} [WARN]`, message, ...args);
  } catch {
    // Logging integrations must never interrupt the host application.
  }
}

/**
 * Log an error message (always shown).
 */
export function error(message: string, ...args: unknown[]): void {
  try {
    console.error(`${LOG_PREFIX} [ERROR]`, message, ...args);
  } catch {
    // Logging integrations must never interrupt the host application.
  }
}

export const logger = {
  setDebugLogging,
  isDebugEnabled,
  debug,
  info,
  warn,
  error,
};
