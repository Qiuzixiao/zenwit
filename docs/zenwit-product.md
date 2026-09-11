# zenwit Product Identity

The desktop product is named `zenwit`; its separate preview edition is `zenwit Beta`. Application IDs are `app.zenwit.desktop` and `app.zenwit.desktop.beta`. Internal DSH plugin and npm package names remain compatible with the kernel. Original licenses and attribution remain in place.

## Local Data

Electron settings, encrypted credentials, logs, and installation identity are scoped to each edition's application data directory. The default kernel Home is its `kernel/` child. `ZENWIT_HOME` can explicitly select a different kernel Home. Existing DSH application data is not copied or adopted automatically. The internal `DSH_HOME` environment variable is still used when starting the kernel.

## External Services

The original Desktop update and installer endpoints are disconnected. Background updates are disabled, and version-check/download functions reject operations before making a request. `updates.zenwit.invalid` is a reserved non-service placeholder, not a deployed endpoint. Configure and validate an owned release service before enabling `DESKTOP_UPDATES_ENABLED` in both editions.

Desktop profile composition disables built-in DSH session telemetry and the upstream feedback command/UI. It replaces the official brand plugin through sidebar and conversation slots and gives the assistant a zenwit identity through system-prompt configuration. User-selected model providers, remote access, plugin catalogs and installed third-party plugins can still make network requests. The existing catalog is `https://plugins.zenwit.cn/v1/catalog-source.json`; market support retains the existing `Qiuzixiao/qnovel-plugins` issue link. Installation requirements are available inline. No new feedback endpoint, production domain, signing identity, or release repository is claimed by this change.

Diagnostics remain locally exported files; inspect them before sharing. The root [privacy and data use notice](../PRIVACY.md) describes the local build. A public distributor must provide its actual operator identity and privacy contact.

## Branding And Builds

The desktop runtime uses the versioned patches under `patches/` for kernel locale, onboarding, title, conversation headline and web metadata. Matching kernel source edits are included. When rebuilding the kernel from source, review and remove already-applied branding hunks before synchronizing tarballs; keep unrelated runtime patches intact. Internal package identifiers and model provider names are intentionally unchanged.

The application and tray icons use a Z mark. Editable artwork lives in each Desktop package's `build/zenwit-icon.svg` and `build/tray-icon.svg`. Run `node scripts/generate-app-icons.mjs` and `node scripts/generate-tray-icons.mjs` from the package directory to regenerate PNG assets.

Build from the root with `corepack yarn build`. Launch stable with `corepack yarn dev`, or Beta with `corepack yarn dev:beta`. See [local kernel development](local-kernel.md) when changing kernel code. Signing, notarization, public distribution and an update service are separate release operations.
