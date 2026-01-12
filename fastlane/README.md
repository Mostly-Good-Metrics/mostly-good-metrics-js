fastlane documentation
----

# Installation

Make sure you have the latest version of the Xcode command line tools installed:

```sh
xcode-select --install
```

For _fastlane_ installation instructions, see [Installing _fastlane_](https://docs.fastlane.tools/#installing-fastlane)

# Available Actions

### sync_tags

```sh
[bundle exec] fastlane sync_tags
```

Sync local tags with remote for all SDKs

### versions

```sh
[bundle exec] fastlane versions
```

Show current versions of all SDKs

### status

```sh
[bundle exec] fastlane status
```

Show status of all SDKs: versions, dependencies, unreleased changes

### release_flutter

```sh
[bundle exec] fastlane release_flutter
```

Release Flutter SDK. Options: bump (major|minor|patch, default: patch), notes, skip_publish, confirm:false

### release_js

```sh
[bundle exec] fastlane release_js
```

Release JavaScript SDK. Options: bump (major|minor|patch, default: patch), notes, skip_publish, confirm:false

### release_rn

```sh
[bundle exec] fastlane release_rn
```

Release React Native SDK. Options: bump (major|minor|patch, default: patch), notes, skip_publish, confirm:false

### release_swift

```sh
[bundle exec] fastlane release_swift
```

Release Swift SDK. Options: bump (major|minor|patch, default: patch), notes, skip_publish, confirm:false

### release_android

```sh
[bundle exec] fastlane release_android
```

Release Android SDK. Options: bump (major|minor|patch, default: patch), notes, skip_publish, confirm:false

### release_all_except_react_native

```sh
[bundle exec] fastlane release_all_except_react_native
```

Release all SDKs except React Native. Options: skip_publish

### release_all

```sh
[bundle exec] fastlane release_all
```

Release all SDKs. Options: bump (major|minor|patch, default: patch), notes, skip_publish, confirm:false

### release

```sh
[bundle exec] fastlane release
```

Release JavaScript SDK

----

This README.md is auto-generated and will be re-generated every time [_fastlane_](https://fastlane.tools) is run.

More information about _fastlane_ can be found on [fastlane.tools](https://fastlane.tools).

The documentation of _fastlane_ can be found on [docs.fastlane.tools](https://docs.fastlane.tools).
