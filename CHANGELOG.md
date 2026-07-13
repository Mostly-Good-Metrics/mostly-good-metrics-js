# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased]

### Added

- `getVariant(name, fallback?)` now accepts an optional fallback value returned when the experiment is unknown or experiments have not loaded yet (defaults to `null`; backwards compatible). (MGM-31)
- Automatic `$experiment_exposure` event on the first `getVariant()` hit per (user, experiment, variant), with properties `$experiment_name` (the raw experiment name) and `$variant`. Dedup flags are persisted so exposures are not re-tracked across restarts. The `$experiment_{name}` super property behavior is unchanged. (MGM-31)
- Pluggable `experimentStorage` configuration option with a new `IExperimentStorage` interface (async-capable) for the experiments cache and exposure flags. Defaults to localStorage; React Native apps can inject AsyncStorage. Exported `LocalStorageExperimentStorage`, `InMemoryExperimentStorage`, and `createDefaultExperimentStorage`. (MGM-31)
- Post-identify experiment refetches now include `anonymous_id` alongside `user_id` in `GET /v1/experiments` so the server can alias pre-identify assignments. (MGM-28/MGM-31)

### Changed

- Experiments cache policy is now stale-while-revalidate with no TTL (previously 24h expiry): cached variants are served synchronously and never expire; a background refetch runs at most once per hour. On `identify()` with a changed user, current in-memory variants keep being served until the refetch response is atomically swapped in - variants are never cleared to null mid-session. (MGM-31)
