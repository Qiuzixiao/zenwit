# Zenwit Plugin Market

This Desktop-owned package provides the Zenwit plugin market. It reads only
https://plugins.zenwit.cn/v1/plugins. The public catalog manifest is available at
https://plugins.zenwit.cn/v1/catalog-source.json.

The market has Discover, Installable, and Installed views. Search, category
filters, pagination, details, and installation previews share the existing
Desktop UI and Host services. There is no source picker or custom-source API.
Legacy source records are ignored; old cached pages cannot match the fixed
Zenwit source identity. The retired source-mutation endpoint returns HTTP 410.

The API project `qnovel-plugins-api` owns catalog metadata and publication.
The `qnovel-plugins` repository owns plugin source; npm supplies published
packages. Installation verifies the catalog's exact stable `latestVersion`
against npm and checks its DSH bundle declaration. It never resolves npm
`latest` in place of the published version.

Desktop offers Zenwit or Disabled. New installations default to Zenwit;
explicit Disabled selections and safe-mode behavior remain supported.
Legacy `dsh-market` selections migrate to Zenwit. The third-party
`dshmarket` dependency and runtime integration have been removed.

Plugin compatibility is separate from catalog availability. The currently
published `qnovel-mochi@0.1.0` declares DSH `0.1.0-rc.7`, whereas this
Desktop uses `0.1.5-rc.1`; its Client declaration still references the
removed `dsh-client-runtime` module and needs a compatible plugin release.

## Validation

Run `corepack yarn workspace dsh-community-market check`.
Desktop changes must also pass both editions' checks and
`corepack yarn check:desktop-variants`.

See [installation behavior](docs/install-and-uninstall.md) and the
[catalog contract](docs/catalog-provider-contract.md).
