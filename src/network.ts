import { logger } from './logger';
import {
  Constraints,
  INetworkClient,
  MGMError,
  MGMEventsPayload,
  ResolvedConfiguration,
  SendResult,
} from './types';

const EVENTS_ENDPOINT = '/v1/events';
const REQUEST_TIMEOUT_MS = 60000; // 60 seconds

/**
 * Compress data using gzip if available (browser CompressionStream API).
 * Falls back to uncompressed data if compression is not available.
 */
async function compressIfNeeded(data: string): Promise<{ data: BodyInit; compressed: boolean }> {
  const bytes = new TextEncoder().encode(data);

  // Only compress if payload exceeds threshold
  if (bytes.length < Constraints.COMPRESSION_THRESHOLD_BYTES) {
    return { data, compressed: false };
  }

  // Check if CompressionStream is available (modern browsers)
  if (typeof CompressionStream === 'undefined') {
    logger.debug('CompressionStream not available, sending uncompressed');
    return { data, compressed: false };
  }

  try {
    const stream = new Blob([bytes]).stream();
    const compressedStream = stream.pipeThrough(new CompressionStream('gzip'));
    const compressedBlob = await new Response(compressedStream).blob();

    logger.debug(`Compressed payload from ${bytes.length} to ${compressedBlob.size} bytes`);

    return { data: compressedBlob, compressed: true };
  } catch (e) {
    logger.warn('Failed to compress payload, sending uncompressed', e);
    return { data, compressed: false };
  }
}

/**
 * Default network client using the Fetch API.
 */
export class FetchNetworkClient implements INetworkClient {
  private retryAfterTime: Date | null = null;

  /**
   * Send events to the MostlyGoodMetrics API.
   */
  async sendEvents(payload: MGMEventsPayload, config: ResolvedConfiguration): Promise<SendResult> {
    // Check rate limiting
    if (this.isRateLimited()) {
      const retryAfter = this.getRetryAfterTime();
      const waitMs = retryAfter ? retryAfter.getTime() - Date.now() : 0;
      logger.debug(`Rate limited, retry after ${Math.ceil(waitMs / 1000)}s`);

      return {
        success: false,
        error: new MGMError('RATE_LIMITED', 'Rate limited, please retry later', {
          retryAfter: Math.ceil(waitMs / 1000),
        }),
        shouldRetry: true,
      };
    }

    const url = `${config.baseURL}${EVENTS_ENDPOINT}`;
    const jsonBody = JSON.stringify(payload);
    const { data, compressed } = await compressIfNeeded(jsonBody);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-MGM-Key': config.apiKey,
    };

    if (config.bundleId) {
      headers['X-MGM-Bundle-Id'] = config.bundleId;
    }

    if (compressed) {
      headers['Content-Encoding'] = 'gzip';
    }

    logger.debug(`Sending ${payload.events.length} events to ${url}`);

    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: data,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      return this.handleResponse(response);
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        logger.warn('Request timed out');
        return {
          success: false,
          error: new MGMError('NETWORK_ERROR', 'Request timed out'),
          shouldRetry: true,
        };
      }

      logger.error('Network error', e);
      return {
        success: false,
        error: new MGMError(
          'NETWORK_ERROR',
          e instanceof Error ? e.message : 'Unknown network error'
        ),
        shouldRetry: true,
      };
    }
  }

  /**
   * Handle the API response and return appropriate result.
   */
  private handleResponse(response: Response): SendResult {
    const statusCode = response.status;

    // Success
    if (statusCode === 204 || statusCode === 200) {
      logger.debug('Events sent successfully');
      return { success: true };
    }

    // Rate limited
    if (statusCode === 429) {
      const retryAfterHeader = response.headers.get('Retry-After');
      const retryAfterSeconds = retryAfterHeader ? parseInt(retryAfterHeader, 10) : 60;

      this.retryAfterTime = new Date(Date.now() + retryAfterSeconds * 1000);

      logger.warn(`Rate limited, retry after ${retryAfterSeconds}s`);

      return {
        success: false,
        error: new MGMError('RATE_LIMITED', 'Rate limited by server', {
          retryAfter: retryAfterSeconds,
          statusCode,
        }),
        shouldRetry: true,
      };
    }

    // Client errors (4xx) - don't retry, drop events
    if (statusCode >= 400 && statusCode < 500) {
      const errorType =
        statusCode === 400
          ? 'BAD_REQUEST'
          : statusCode === 401
            ? 'UNAUTHORIZED'
            : statusCode === 403
              ? 'FORBIDDEN'
              : 'BAD_REQUEST';

      const errorMessage = `Server returned ${statusCode}`;
      logger.error(errorMessage);

      return {
        success: false,
        error: new MGMError(errorType, errorMessage, { statusCode }),
        shouldRetry: false, // Drop events on client errors
      };
    }

    // Server errors (5xx) - retry later
    if (statusCode >= 500) {
      const errorMessage = `Server error: ${statusCode}`;
      logger.warn(errorMessage);

      return {
        success: false,
        error: new MGMError('SERVER_ERROR', errorMessage, { statusCode }),
        shouldRetry: true,
      };
    }

    // Unexpected status code
    logger.warn(`Unexpected status code: ${statusCode}`);
    return {
      success: false,
      error: new MGMError('UNKNOWN_ERROR', `Unexpected status code: ${statusCode}`, {
        statusCode,
      }),
      shouldRetry: true,
    };
  }

  /**
   * Check if currently rate limited.
   */
  isRateLimited(): boolean {
    if (!this.retryAfterTime) {
      return false;
    }

    if (Date.now() >= this.retryAfterTime.getTime()) {
      this.retryAfterTime = null;
      return false;
    }

    return true;
  }

  /**
   * Get the time when rate limiting expires.
   */
  getRetryAfterTime(): Date | null {
    return this.retryAfterTime;
  }
}

/**
 * Create the default network client.
 */
export function createDefaultNetworkClient(): INetworkClient {
  return new FetchNetworkClient();
}
