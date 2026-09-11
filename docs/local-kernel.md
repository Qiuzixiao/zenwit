# Local Kernel Development

Desktop and `deepseek-harness/` are owned by this project. The kernel is an ordinary source directory, with no nested Git repository, remote, or required upstream commit. Keep upstream license and attribution files when modifying or redistributing the code.

The root uses Yarn and the kernel uses pnpm. Dependency lockfiles and package versions remain build inputs, not restrictions on editing the kernel. `upstream.json` describes the currently packaged runtime; its original commit is provenance, not a checkout requirement.

Desktop resolves the tarballs in `vendor/dsh-runtime/`, not live kernel source. After kernel changes, rebuild and synchronize the runtime from the project root:

```sh
corepack yarn upstream:prepare-runtime
node scripts/sync-vendored-runtime.mjs --write --channel stable
node scripts/sync-vendored-runtime.mjs --write --channel beta
corepack yarn install
corepack yarn check:layout
```

Both channels currently share a runtime version. Synchronize both before installing. If changing the kernel package family version, update each channel's `sourceVersion` in `upstream.json` to the packed version before synchronization. Existing version-specific patches under `patches/` must still apply to the new artifacts; review them when changing affected kernel code.

Run the kernel tests relevant to the change, then the affected Desktop checks. A normal `yarn dev` or `yarn build` does not rebuild the kernel automatically.

This source archive has no root Git history. When creating your own repository, track `deepseek-harness/` as ordinary files along with Desktop. No official remote or tag is required. Historical pinned-submodule notes describe the original project, not the ownership policy of this local project.
