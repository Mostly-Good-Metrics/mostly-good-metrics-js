# MostlyGoodMetrics JavaScript SDK

A lightweight JavaScript/TypeScript SDK for tracking analytics events with [MostlyGoodMetrics](https://mostlygoodmetrics.com).

## Table of Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration Options](#configuration-options)
- [Automatic Behavior](#automatic-behavior)
- [Automatic Events](#automatic-events)
- [Automatic Context](#automatic-context)
- [Event Naming](#event-naming)
- [Properties](#properties)
- [Manual Flush](#manual-flush)
- [Debug Logging](#debug-logging)
- [Custom Storage](#custom-storage)
- [Framework Integration](#framework-integration)
- [License](#license)

## Requirements

- Node.js 16+ (for build tools)
- Modern browser with ES2020 support, or Node.js runtime

## Installation

```bash
npm install @mostly-good-metrics/javascript
```

Or with yarn:

```bash
yarn add @mostly-good-metrics/javascript
```

## Quick Start

### 1. Initialize the SDK

Initialize once at app startup:

```typescript
import { MostlyGoodMetrics } from '@mostly-good-metrics/javascript';

MostlyGoodMetrics.configure({
  apiKey: 'mgm_proj_your_api_key',
});
```

### 2. Track Events

```typescript
// Simple event
MostlyGoodMetrics.track('button_clicked');

// Event with properties
MostlyGoodMetrics.track('purchase_completed', {
  product_id: 'SKU123',
  price: 29.99,
  currency: 'USD',
});
```

### 3. Identify Users

```typescript
// Set user identity (optional - anonymous ID is auto-generated)
MostlyGoodMetrics.identify('user_123');

// Reset identity (e.g., on logout)
MostlyGoodMetrics.resetIdentity();
```

That's it! Events are automatically batched and sent.

## Configuration Options

For more control, pass additional configuration:

```typescript
MostlyGoodMetrics.configure({
  apiKey: 'mgm_proj_your_api_key',
  baseURL: 'https://mostlygoodmetrics.com',
  environment: 'production',
  appVersion: '1.0.0',
  maxBatchSize: 100,
  flushInterval: 30,
  maxStoredEvents: 10000,
  enableDebugLogging: process.env.NODE_ENV === 'development',
  trackAppLifecycleEvents: true,
  cookieDomain: '.yourdomain.com', // For cross-subdomain tracking
  disableCookies: false, // Set true for privacy mode
});
```

| Option | Default | Description |
|--------|---------|-------------|
| `apiKey` | - | **Required.** Your API key |
| `baseURL` | `https://mostlygoodmetrics.com` | API endpoint |
| `environment` | `"production"` | Environment name |
| `appVersion` | - | App version string (required for install/update tracking) |
| `maxBatchSize` | `100` | Events per batch (1-1000) |
| `flushInterval` | `30` | Auto-flush interval in seconds |
| `maxStoredEvents` | `10000` | Max cached events |
| `enableDebugLogging` | `false` | Enable console output |
| `trackAppLifecycleEvents` | `false` | Auto-track lifecycle events ($app_opened, etc.) |
| `bundleId` | auto-detected | Custom bundle identifier |
| `cookieDomain` | - | Cookie domain for cross-subdomain tracking (e.g., `.example.com`) |
| `disableCookies` | `false` | Set `true` to disable cookies (GDPR/privacy mode) |
| `anonymousId` | auto-generated | Override anonymous ID (for wrapper SDKs) |
| `storage` | auto-detected | Custom storage adapter (see [Custom Storage](#custom-storage)) |
| `networkClient` | fetch-based | Custom network client |

### Cross-Subdomain Tracking

To share the same anonymous user ID across subdomains (e.g., `app.yourdomain.com`, `www.yourdomain.com`), set `cookieDomain`:

```typescript
MostlyGoodMetrics.configure({
  apiKey: 'mgm_proj_your_api_key',
  cookieDomain: '.yourdomain.com',
});
```

### Privacy Mode (No Cookies)

For GDPR compliance or privacy-focused applications, disable cookies entirely:

```typescript
MostlyGoodMetrics.configure({
  apiKey: 'mgm_proj_your_api_key',
  disableCookies: true, // Only use localStorage
});
```

## Automatic Behavior

The SDK automatically handles common tasks so you can focus on tracking what matters:

- **Anonymous user ID generation** - UUID automatically generated and persisted in cookies + localStorage
- **User ID persistence** - Identity set via `identify()` persists across page loads; falls back to anonymous ID when reset
- **Event persistence** - Events are saved to localStorage (with in-memory fallback) and survive page reloads
- **Batch processing** - Events are grouped for efficient network usage
- **Periodic flush** - Events are sent every 30 seconds (configurable via `flushInterval`)
- **Visibility-based flush** - Events are sent when the tab is hidden or page unloads
- **Payload compression** - Large batches (>1KB) are automatically gzip compressed
- **Retry on failure** - Failed requests are retried; events are preserved until successfully sent
- **Rate limiting** - Exponential backoff when rate limited by the server
- **Session management** - New session ID generated on each page load
- **Offline support** - Events queue locally when offline and send when connectivity returns
- **Deduplication** - Events include unique IDs (`client_event_id`) to prevent duplicate processing

## Automatic Events

When `trackAppLifecycleEvents` is enabled, the SDK automatically tracks:

| Event | When | Properties |
|-------|------|------------|
| `$app_installed` | First visit (localStorage) | `$version` |
| `$app_updated` | Version change detected | `$version`, `$previous_version` |
| `$app_opened` | Page load / tab visible | - |
| `$app_backgrounded` | Tab hidden / page unload | - |

> **Note:** Install and update detection require `appVersion` to be configured.

## Automatic Context

Every event automatically includes contextual information. You don't need to manually add these fields.

| Field | Type | Example | Description |
|-------|------|---------|-------------|
| `client_event_id` | Event | `550e8400-e29b-41d4-a716-446655440000` | Unique UUID for deduplication |
| `timestamp` | Event | `2024-01-15T10:30:00.000Z` | ISO 8601 event time |
| `user_id` | Event | `user_123` | Identified user ID, or anonymous UUID |
| `session_id` | Event | `abc123-def456` | UUID per page load (new session each load) |
| `platform` | Event | `web` | Platform identifier |
| `environment` | Event | `production` | Environment name (from config) |
| `locale` | Event | `en-US` | User's locale from browser |
| `timezone` | Event | `America/New_York` | User's timezone from browser |
| `osVersion` | Event | `10.15.7` | Operating system version (if available) |
| `appVersion` | Event | `1.2.0` | App version (if configured) |
| `$device_type` | Property | `desktop` | Device type: `desktop`, `phone`, `tablet` |
| `$device_model` | Property | `Chrome 120.0` | Browser name and version |
| `$browser` | Property | `Chrome` | Browser name |
| `$browser_version` | Property | `120.0.6099.130` | Full browser version |
| `$os` | Property | `Mac OS X` | Operating system name |
| `$os_version` | Property | `10.15.7` | Operating system version |
| `$screen_width` | Property | `1920` | Screen width in pixels |
| `$screen_height` | Property | `1080` | Screen height in pixels |
| `$viewport_width` | Property | `1440` | Viewport width in pixels |
| `$viewport_height` | Property | `900` | Viewport height in pixels |
| `$user_agent` | Property | `Mozilla/5.0...` | Full user agent string |

> **Note:** Properties with the `$` prefix are reserved for system use. The Type column indicates whether the field appears at the event level or within the event's properties object.

## Event Naming

Event names must:
- Start with a letter (or `$` for system events)
- Contain only alphanumeric characters and underscores
- Be 255 characters or less

**Reserved `$` prefix:** The `$` prefix is reserved for system events (like `$app_opened`, `$app_installed`). Do not use `$` for custom event names.

```typescript
// Valid
MostlyGoodMetrics.track('button_clicked');
MostlyGoodMetrics.track('PurchaseCompleted');
MostlyGoodMetrics.track('step_1_completed');

// Invalid (will be ignored)
MostlyGoodMetrics.track('123_event');      // starts with number
MostlyGoodMetrics.track('event-name');     // contains hyphen
MostlyGoodMetrics.track('event name');     // contains space
MostlyGoodMetrics.track('$custom_event');  // $ prefix is reserved
```

## Properties

Events support various property types:

```typescript
MostlyGoodMetrics.track('checkout', {
  string_prop: 'value',
  int_prop: 42,
  double_prop: 3.14,
  bool_prop: true,
  null_prop: null,
  list_prop: ['a', 'b', 'c'],
  nested: {
    key: 'value',
  },
});
```

**Limits:**
- String values: truncated to 1000 characters
- Nesting depth: max 3 levels
- Total properties size: max 10KB

## Manual Flush

Events are automatically flushed periodically and when the page is hidden. You can also trigger a manual flush:

```typescript
await MostlyGoodMetrics.flush();
```

To check pending events:

```typescript
const count = await MostlyGoodMetrics.getPendingEventCount();
console.log(`${count} events pending`);
```

## Debug Logging

Enable debug logging to see SDK activity:

```typescript
MostlyGoodMetrics.configure({
  apiKey: 'mgm_proj_your_api_key',
  enableDebugLogging: true,
});
```

Output example:
```
[MostlyGoodMetrics] [INFO] MostlyGoodMetrics initialized with environment: production
[MostlyGoodMetrics] [DEBUG] Tracking event: button_clicked
[MostlyGoodMetrics] [DEBUG] Starting flush
[MostlyGoodMetrics] [DEBUG] Successfully sent 5 events
```

## Custom Storage

You can provide a custom storage adapter for environments where localStorage isn't available:

```typescript
import { MostlyGoodMetrics, IEventStorage, InMemoryEventStorage } from '@mostly-good-metrics/javascript';

// Use in-memory storage
MostlyGoodMetrics.configure({
  apiKey: 'mgm_proj_your_api_key',
  storage: new InMemoryEventStorage(10000),
});

// Or implement your own
class MyCustomStorage implements IEventStorage {
  async store(event: MGMEvent): Promise<void> { /* ... */ }
  async fetchEvents(limit: number): Promise<MGMEvent[]> { /* ... */ }
  async removeEvents(count: number): Promise<void> { /* ... */ }
  async eventCount(): Promise<number> { /* ... */ }
  async clear(): Promise<void> { /* ... */ }
}
```

## Framework Integration

### React

```typescript
// src/analytics.ts
import { MostlyGoodMetrics } from '@mostly-good-metrics/javascript';

export function initAnalytics() {
  MostlyGoodMetrics.configure({
    apiKey: process.env.REACT_APP_MGM_API_KEY!,
    environment: process.env.NODE_ENV,
    appVersion: process.env.REACT_APP_VERSION,
  });
}

// src/index.tsx
import { initAnalytics } from './analytics';
initAnalytics();
```

### Next.js

```typescript
// lib/analytics.ts
import { MostlyGoodMetrics } from '@mostly-good-metrics/javascript';

export function initAnalytics() {
  if (typeof window !== 'undefined') {
    MostlyGoodMetrics.configure({
      apiKey: process.env.NEXT_PUBLIC_MGM_API_KEY!,
      environment: process.env.NODE_ENV,
    });
  }
}

// app/layout.tsx or pages/_app.tsx
'use client';
import { useEffect } from 'react';
import { initAnalytics } from '@/lib/analytics';

export default function RootLayout({ children }) {
  useEffect(() => {
    initAnalytics();
  }, []);

  return <html>...</html>;
}
```

### Vue

```typescript
// src/plugins/analytics.ts
import { MostlyGoodMetrics } from '@mostly-good-metrics/javascript';

export default {
  install() {
    MostlyGoodMetrics.configure({
      apiKey: import.meta.env.VITE_MGM_API_KEY,
      environment: import.meta.env.MODE,
    });
  }
};

// src/main.ts
import analytics from './plugins/analytics';
app.use(analytics);
```

> **TypeScript Support:** This SDK is written in TypeScript and includes full type definitions. All types (`MGMConfiguration`, `MGMEvent`, `EventProperties`, `IEventStorage`, etc.) are automatically available when you import the SDK.

## License

MIT
