# zenwit repository rules

This repository owns both the desktop product and the editable DeepSeek Harness kernel source.

## Prerequisites and setup

- Use Node.js `^22.19.0` or `>=24.0.0` and the root Yarn `4.18.0` release through Corepack.
- `deepseek-harness/` is included as ordinary source; no submodule initialization is needed.
- Install root dependencies with `corepack yarn install --immutable`.

## Build, run, and verify

- Start the desktop development workflow with `corepack yarn dev`.
- Build the desktop package with `corepack yarn build`.
- Run unit tests with `corepack yarn test`.
- Run type checking with `corepack yarn typecheck`.
- Run the complete headless gate with `corepack yarn check`.
- Develop and validate Desktop feature changes in `dsh-plugin-desktop-beta/` first, then synchronize shared changes into `dsh-plugin-desktop/` while preserving declared variant differences. Before committing or pushing shared Desktop changes, run `corepack yarn check:desktop-variants` and validate both affected packages; neither package automatically inherits the other's source edits.
- Run upstream operations through the root scripts, such as `corepack yarn upstream:build`.

- `deepseek-harness/` is locally owned kernel source. Kernel changes are allowed alongside desktop changes; follow its local engineering guidelines.
- `dsh-plugin-desktop/` owns the Cordis Host and Client faces, Electron bootstrap, packaging, and release tests.
- `dsh-community-fabric/` owns the community interoperability RFC. Until schemas and a reviewed reference adapter exist, it remains a private documentation scaffold and must not declare loadable DSH or package entry points.
- `dsh-community-market/` owns the community-market shell. Until its runtime is implemented, it remains a private documentation scaffold and must not declare loadable DSH or package entry points.
- The outer repository and all owned packages use the root Yarn release with `nodeLinker: node-modules`.
- The kernel keeps its own pnpm workspace. Run kernel commands through the root `upstream:*` scripts, whose Yarn portable-shell commands enter the source directory before invoking Corepack.
- Zenwit owns the sole generic workbench root: home, file manager, editor, and conversation. Desktop modes control native chrome only. Do not restore deleted DSH page owners or use priority/CSS to cover a retained original page. Agent workflows must not own common workbench capabilities; do not reactivate upstream brand or feedback plugins.
- Keep graphical application launch explicit. Builds, typechecks, unit tests, and Loader smokes must remain headless-safe.
- Keep dependency lockfiles for reproducible builds; they do not restrict kernel source edits.
- Desktop consumes local `vendor/dsh-runtime/` tarballs. After changing the kernel, build and synchronize them as described in [local kernel development](docs/local-kernel.md).
- `upstream.json` records the runtime artifacts and original source provenance; its commit does not constrain the local kernel checkout. The previous pinned-submodule Agent Note is historical and superseded by this policy.
