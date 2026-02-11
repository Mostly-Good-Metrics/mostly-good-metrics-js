# MostlyGoodMetrics JavaScript SDK

A lightweight JavaScript/TypeScript SDK for tracking analytics events with [MostlyGoodMetrics](https://mostlygoodmetrics.com).

## Table of Contents

- [Requirements](#requirements)
- [Installation](#installation)
- [Quick Start](#quick-start)
- [Configuration Options](#configuration-options)
- [User Identification](#user-identification)
- [Tracking Events](#tracking-events)
- [Event Naming](#event-naming)
- [Properties](#properties)
- [Automatic Events](#automatic-events)
- [Automatic Properties](#automatic-properties)
- [Automatic Context](#automatic-context)
- [Automatic Behavior](#automatic-behavior)
- [Framework Integration](#framework-integration)
- [Manual Flush](#manual-flush)
- [Debug Logging](#debug-logging)
- [Custom Storage](#custom-storage)
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
  cookieDomain: '.yourdomain.com',
  disableCookies: false,
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
| `disableCookies` | `false` | Disable cookies entirely (uses localStorage only) |
| `anonymousId` | auto-generated | Override anonymous ID (for wrapper SDKs) |
| `storage` | auto-detected | Custom storage adapter (see [Custom Storage](#custom-storage)) |
| `networkClient` | fetch-based | Custom network client |

## User Identification

The SDK automatically generates and persists an anonymous user ID (UUID) for each user. This ID:
- Is auto-generated on first visit
- Persists across sessions (stored in cookies + localStorage)
- Is included in every event as `user_id`

When you call `identify()`, the identified user ID replaces the anonymous ID and also persists across sessions.

```typescript
// Before identify(): user_id = "550e8400-e29b-41d4-a716-446655440000" (auto-generated)
MostlyGoodMetrics.identify('user_123');
// After identify(): user_id = "user_123"

MostlyGoodMetrics.resetIdentity();
// After reset: user_id = new auto-generated UUID
```

### Cookie & Privacy Considerations

By default, the anonymous ID is stored in both:
- **Cookies**: Enables cross-subdomain tracking when `cookieDomain` is configured (e.g., `.example.com`)
- **localStorage**: Provides fallback when cookies are disabled

For privacy-focused implementations:

```typescript
MostlyGoodMetrics.configure({
  apiKey: 'mgm_proj_your_api_key',
  disableCookies: true, // GDPR/privacy mode - uses localStorage only
});
```

When `disableCookies: true`:
- Anonymous ID is stored in localStorage only
- No cookies are set
- Cross-subdomain tracking is disabled

## Tracking Events

Track events with the `track()` method:

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

## Automatic Events

When `trackAppLifecycleEvents` is enabled, the SDK automatically tracks:

| Event | When | Properties |
|-------|------|------------|
| `$app_installed` | First visit (localStorage) | `$version` |
| `$app_updated` | Version change detected | `$version`, `$previous_version` |
| `$app_opened` | Page load / tab visible | - |
| `$app_backgrounded` | Tab hidden / page unload | - |

> **Note:** Install and update detection require `appVersion` to be configured.

## Automatic Properties

The SDK automatically includes these properties with every event:

| Property | Description | Example | Source |
|----------|-------------|---------|--------|
| `$device_type` | Device form factor | `desktop`, `phone`, `tablet` | Detected from user agent and screen size |
| `$device_model` | Browser name and major version | `Chrome 120.0` | Parsed from user agent |
| `$browser` | Browser name | `Chrome`, `Safari`, `Firefox` | Parsed from user agent |
| `$browser_version` | Full browser version | `120.0.6099.130` | Parsed from user agent |
| `$os` | Operating system name | `Mac OS X`, `Windows`, `Linux`, `iOS`, `Android` | Parsed from user agent |
| `$os_version` | Operating system version | `10.15.7` | Parsed from user agent |
| `$screen_width` | Screen width in pixels | `1920` | `window.screen.width` |
| `$screen_height` | Screen height in pixels | `1080` | `window.screen.height` |
| `$viewport_width` | Viewport width in pixels | `1440` | `window.innerWidth` |
| `$viewport_height` | Viewport height in pixels | `900` | `window.innerHeight` |
| `$user_agent` | Full user agent string | `Mozilla/5.0...` | `navigator.userAgent` |

> **Note:** Properties with the `$` prefix are reserved for system use. Do not use the `$` prefix for your own custom properties.

## Automatic Context

The SDK automatically includes these fields with every event to provide rich context:

### Identity & Session

| Field | Description | Example | Persistence |
|-------|-------------|---------|-------------|
| `user_id` | Identified user ID (set via `identify()`) or auto-generated anonymous UUID | `user_123` | Persisted in cookies + localStorage (survives page reloads) |
| `session_id` | UUID generated per page load | `abc123-def456` | Regenerated on each page load |

### Device & Platform

| Field | Description | Example | Source |
|-------|-------------|---------|--------|
| `platform` | Platform identifier | `web` | Hardcoded |
| `locale` | User's locale | `en-US` | `Intl.DateTimeFormat().resolvedOptions().locale` |
| `timezone` | User's timezone | `America/New_York` | `Intl.DateTimeFormat().resolvedOptions().timeZone` |

### App & Environment

| Field | Description | Example | Source |
|-------|-------------|---------|--------|
| `app_version` | App version (if configured) | `1.2.0` | Configuration option |
| `environment` | Environment name | `production`, `staging`, `development` | Configuration option (default: `production`) |

### Event Metadata

| Field | Description | Example | Purpose |
|-------|-------------|---------|---------|
| `client_event_id` | Unique UUID for each event | `550e8400-e29b-41d4-a716-446655440000` | Deduplication (prevents processing the same event twice) |
| `timestamp` | ISO 8601 timestamp when event was tracked | `2024-01-15T10:30:00.000Z` | Event ordering and time-based analysis |

## Automatic Behavior

The SDK handles many tasks automatically to provide a seamless analytics experience:

### Identity Management
- **Generates anonymous user ID**: Creates a persistent UUID on first visit, stored in cookies + localStorage
- **Persists identified user ID**: Stores user ID (from `identify()`) in cookies + localStorage, automatically restored on page reload
- **Generates session IDs**: Creates a new UUID on each page load to track user sessions

### Event Storage & Delivery
- **Persists events**: Stores events in localStorage (with in-memory fallback if unavailable)
- **Batches events**: Groups events together for efficient network usage (default: 100 events per batch)
- **Flushes on interval**: Automatically sends events every 30 seconds (configurable via `flushInterval`)
- **Flushes on visibility change**: Sends pending events when tab is hidden or page unloads
- **Compresses payloads**: Large batches (>1KB) are automatically gzip compressed
- **Retries on failure**: Preserves events on network errors and retries with exponential backoff
- **Handles rate limiting**: Automatically backs off when server rate limits are hit
- **Adds deduplication IDs**: Includes unique `client_event_id` with each event to prevent duplicate processing
- **Offline support**: Events queue locally when offline and send when connectivity returns

### Lifecycle Tracking
When `trackAppLifecycleEvents` is enabled, the SDK automatically:
- **Detects install**: Tracks `$app_installed` event on first visit (requires `appVersion` config)
- **Detects updates**: Tracks `$app_updated` event when app version changes (requires `appVersion` config)
- **Tracks page visibility**: Fires `$app_opened` when page becomes visible
- **Tracks page hidden**: Fires `$app_backgrounded` when page is hidden or unloads

### Platform Integration
- **Detects device type**: Automatically identifies desktop, phone, or tablet from user agent and screen size
- **Captures browser info**: Includes browser name and version with every event
- **Captures OS info**: Includes operating system name and version with every event
- **Captures screen dimensions**: Includes screen and viewport size for UI analytics
- **Captures locale**: Includes user's language/region setting
- **Captures timezone**: Includes user's timezone for accurate time-based analysis

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

The SDK supports both JavaScript and TypeScript projects. All type definitions are included automatically.

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

## License

MIT
