# Agent Note: Workbench engine rebuild

Status: implemented

English | [中文](2026-09-16-workbench-engine-rebuild.zh.md)

## Problem

The product's file management and editor were an in-kernel implementation: the file tree was one whole-project scan bounded by a render budget, the search ran over that already-truncated tree in the browser, there was no change/Git view, no terminal, no browser, and no way for the model to put a file on screen. A large project showed a truncated tree and a search that could not see past it.

The capability bar the product wanted already existed as a community plugin. Adopting it as a profile plugin would have made the product's core file work a runtime dependency of a third party, added a second workbench root beside the product's own, and could not have been scoped to the product's project library.

## Decision

The product implements the engine itself and the previous implementation is deleted.

- **Host half** lives in `zenwit-workspace` (`src/workbench/`): single-level directory listing, atomic read/write/rename/remove/upload, host-side filename search, workspace containment and the Host-header trust fence, Git, plus one method API at `/api/desktop/workbench` (JSON envelope: `{ method, project, … }`), a streaming upload route, media bytes and a sandboxed HTML preview route. Project scope replaces the source plugin's session scope: every method names a directory the project library has registered and the containment guard re-checks the resolved target.
- **Client half** lives in `ui-workbench/src/client/workbench/`: explorer, tab strip with drag-to-split, editor host, previews, change and diff views, terminal, browser, task page and side chat. It is this package's own source, renamed and re-skinned onto the kernel's `--dsw-*` tokens, with its copy in the kernel locale dictionaries.
- **Panel seats** stay as [home surface panel navigation](2026-09-15-home-surface-panel-navigation.md) decided them (same list, same selection); the workspace renders the selected panel **in place of** the engine surface instead of over a retained document editor, because the engine owns that region now.
- **Three columns**: the workspace keeps the explorer / engine surface / conversation columns it always had. The engine's explorer is published as a component (`ExplorerPane`, the ported tree panel) that the shell renders in its left column from the store `apply()` returns, so the left and center columns are one workbench; the pane is project-scoped, so it lists the open project before any conversation exists.
- **Mount contract**: the workspace shell renders one region (`[data-zenwit-workbench-surface]`); the engine mounts its own React root into it and marks the host embedded (the `embedded` flag reaches `Workbench`). Embedded mode fills that region: the panel takes no viewport geometry, the center-column locator never runs (so no `data-dsh-center-col` tag and no layout push on the conversation column), and the collapse control and height drag stay hidden because the panel already owns its whole region. Without the region the engine keeps its viewport overlay and the center-column tracking, so it runs standalone.
- **Stylesheet identity**: the client bundle preset names each injected stylesheet by its path under the package's `src` directory. The engine's `workbench/workbench.module.css` and the shell's `workbench.module.css` share a basename, and the previous id dropped directories — the injection guard skipped the second sheet, so the engine rendered unstyled.
- **Plugin continuity**: the public [document renderer registry](2026-09-13-document-renderer-registry.md) stays as the contribution contract and gains a `declarations()` read; `renderer-bridge.ts` mirrors every extension-matched declaration into the engine's viewer registry, so a contributed preview view keeps rendering unchanged.
- **Chat file links** open in the engine's editor tab through `ctx.workbenchFiles.openFile`.

## Consequences

- `Workspace.tsx` shrank from ~1350 lines to ~166: it declares the engine region and owns the conversation column; the engine owns document lifetimes.
- The engine's Host half is covered by `zenwit-workspace`'s suites (filesystem, Git, search, preview routes); the package's own suites cover registration, the shell, the bridge and the project API.
- The client artifact carries the editor, terminal and diagram stacks because the kernel builds one dynamic bundle per package; restoring per-view lazy loading needs split artifacts and a Host chunk route.
- The bridge only mirrors renderers that declare file extensions; a media-type-only declaration needs engine-side sniffing.
- The model-driven open tool is Host-supplied (`workbench_open` in the desktop package). A model-terminal view is deliberately NOT part of this engine: the kernel's own terminal tools already give the model shell access, and the ported view needed an output subscription and a wait-cancel hook the terminal service does not expose, so it was removed rather than shipped inert.
- In the product shell the engine renders as a full-region panel, so its empty state is the pane's own openable-type cards; a deployment that wants a tab open on arrival seeds one through `ctx.workbenchEngine.openTab`.

## Alternatives considered

**Ship the community plugin as a profile plugin.** Rejected: it makes file work a third-party runtime dependency, mounts a second workbench root, and cannot be bound to the project library.

**Keep the old implementation and add features to it.** Rejected: the bounded whole-project scan is the architecture, not a defect to patch; search, lazy levels and the change view all follow from replacing it.
