# mostly-good-metrics-js — CURRENT_STATE.md

_Last updated: 2026-06-20_

## What this is

JavaScript/TypeScript SDK. Published to npm as `@mostly-good-metrics/javascript`. Supports Node.js and browser environments. Current version: 0.7.0.

## Status

Active. Highest-volume SDK by platform reach (web + React Native share this core).

## Standards

- All changes require unit tests
- Public API changes forbidden without explicit approval
- Releases via Fastlane (from `tools/`) — auto-generates release notes, bumps version, publishes to npm
- 24-hour debounce on `$identify` events

## Known Gaps

- Breaking change detection is manual (code review only); no automated API diff
- Changelog coverage (check if CHANGELOG.md exists and is current)
