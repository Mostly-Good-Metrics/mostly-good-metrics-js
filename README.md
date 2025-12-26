# MostlyGoodMetrics JavaScript SDK

A lightweight JavaScript/TypeScript SDK for tracking analytics events with [MostlyGoodMetrics](https://mostlygoodmetrics.com).

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

## User Identification

The SDK automatically generates and persists an anonymous `user_id` (UUID) for each user. This ID:
- Is auto-generated on first visit
- Persists across sessions (stored in cookies and localStorage)
- Is included in every event as `user_id`

When you call `identify()`, the identified user ID takes precedence over the anonymous ID.

```typescript
// Before identify(): user_id = "550e8400-e29b-41d4-a716-446655440000" (auto-generated)
MostlyGoodMetrics.identify('user_123');
// After identify(): user_id = "user_123"

MostlyGoodMetrics.resetIdentity();
// After reset: user_id = "550e8400-e29b-41d4-a716-446655440000" (back to anonymous)
```

### Cross-Subdomain Tracking

By default, the anonymous ID is stored in cookies (with localStorage fallback). To share the anonymous ID across subdomains:

```typescript
MostlyGoodMetrics.configure({
  apiKey: 'mgm_proj_your_api_key',
  cookieDomain: '.yourdomain.com', // Share across all subdomains
});
```

This allows tracking the same user across `app.yourdomain.com`, `www.yourdomain.com`, etc.

### Privacy Mode (No Cookies)

For GDPR compliance or privacy-focused applications, you can disable cookies entirely:

```typescript
MostlyGoodMetrics.configure({
  apiKey: 'mgm_proj_your_api_key',
  disableCookies: true, // Only use localStorage
});
```

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
| `disableCookies` | `false` | Disable cookies, use only localStorage |
| `anonymousId` | auto-generated | Override anonymous ID (for wrapper SDKs like React Native) |
| `storage` | auto-detected | Custom storage adapter |
| `networkClient` | fetch-based | Custom network client |

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

| Property | Description |
|----------|-------------|
| `$device_type` | Device type (`desktop`, `phone`, `tablet`) |
| `$device_model` | Browser name and version |

Additionally, `osVersion` and `appVersion` (if configured) are included at the event level.

## Event Naming

Event names must:
- Start with a letter (or `$` for system events)
- Contain only alphanumeric characters and underscores
- Be 255 characters or less

```typescript
// Valid
MostlyGoodMetrics.track('button_clicked');
MostlyGoodMetrics.track('PurchaseCompleted');
MostlyGoodMetrics.track('step_1_completed');

// Invalid (will be ignored)
MostlyGoodMetrics.track('123_event');      // starts with number
MostlyGoodMetrics.track('event-name');     // contains hyphen
MostlyGoodMetrics.track('event name');     // contains space
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

## Automatic Behavior

The SDK automatically:

- **Generates anonymous user ID** (UUID, persisted in cookies + localStorage)
- **Persists events** to localStorage (with in-memory fallback)
- **Batches events** for efficient network usage
- **Flushes on interval** (default: every 30 seconds)
- **Flushes on visibility change** when the tab is hidden
- **Compresses payloads** using gzip for large batches (>1KB)
- **Retries on failure** for network errors (events are preserved)
- **Handles rate limiting** with exponential backoff
- **Persists identified user ID** across page loads
- **Generates session IDs** per page load

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

## TypeScript Support

Full TypeScript support with exported types:

```typescript
import {
  MostlyGoodMetrics,
  MGMConfiguration,
  MGMEvent,
  EventProperties,
  IEventStorage,
  INetworkClient,
} from '@mostly-good-metrics/javascript';
```

## License

MIT
