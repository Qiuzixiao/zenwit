---
description: "Standalone browser workbench: project library, the workbench engine surface, and slot-composed chat."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workbench

English | [中文](README.zh.md)

## Summary

The sole browser `root` owner. Home and the project library lead into the workspace: the **workbench engine** surface (explorer, tabs, editors, previews, changes, terminal) beside the conversation column. The engine is this product's own implementation, applied by this package and mounted into the region the workspace declares; the file APIs it calls are the Host's `/api/desktop/workbench` endpoints. Project tags, search, creation and deletion remain available.

## Use this package

Mount with the API session/workspace controllers, `ui-renderer`, `ui-session`, the service-only `ui-layout` and `ui-workspace`, locale, conversation, and input-trigger plugins. Keep `ui-settings-general` and the desired settings extensions; keep `ui-reference` for generic `@` file/session candidates. The Host must serve the generic `/api/desktop/projects` endpoints and the workbench engine endpoints (methods, streaming upload, media bytes, sandboxed HTML preview, project change feed).

The root exclusively declares `main` (keyed root), `sidebar.settings` (single root), `sidebar.panellist` (list root), `sidebar.footer.action` (list root), `shell.overlay` (list root) and the two directory-flow holes. Both built-in surfaces render the settings seat with `{ wide: false }` in the tool row of the chrome they share, so the seat draws the 32px rail metric instead of the label row (the settings panel that seat opens is a DOM descendant of that chrome bar — see `tests/workbench-chrome-styles.client.spec.ts` for the selector-specificity guard this requires). Registered `sidebar.panellist` entries are first-level navigation on both built-in surfaces and tool-row entries in the workspace; the selected `main` key hosts the page in the home body or, in the workspace, **in place of** the engine surface (the engine stays mounted but hidden, so its state survives). The `conversation` key in `main` renders on the right. Do not mount another root owner, SidebarRoot, a visual ui-workspace browser, or a rightbar owner; this package uses no shadow priority.

Chat/tool file links call the typed `ctx.workbenchFiles.openFile(path, line?)` service. It accepts project-relative paths, absolute local paths and local file URLs, rejects traversal outside the selected project, and opens the file in the engine's editor tab of the current session. Selection-to-chat captures unsaved text in a structured input reference, optionally in a new session; it never submits automatically.

## Understand the implementation

`WorkbenchFrame.tsx` owns page selection, panel hosting and titles; `WorkbenchTopBar.tsx` renders the brand, the first-level navigation and the settings seat for every built-in surface, so their chrome cannot drift apart; `HomePage.tsx` offers the registered panel entries beside the built-in surfaces and hosts the selected one. `Workspace.tsx` is the workspace shell: it declares the engine region (`[data-zenwit-workbench-surface]`) and owns the conversation column's geometry. The engine mounts its own React root into that region; without the attribute it falls back to a viewport-pinned overlay.

`workbench/` is the engine. Its entry registers the engine service (`ctx.workbenchEngine`), the locale dictionaries and the built-in tab/viewer descriptors, and mounts the shell. The explorer, tab strip, editor host, previews, change views, diff renderer, terminal, browser, task page and side chat live in `workbench/` submodules; heavy views (editor, terminal, diagrams) load through `workbench/chunk-loader.ts`. The engine reads files through the Host's method API (`fs.tree`, `fs.read`, `fs.write`, `fs.rename`, `fs.remove`, `fs.search`, `git.*`), streams uploads, and renders previews from the media and sandboxed HTML routes.

`renderer-bridge.ts` mirrors the public `ctx.documentRenderers` registry into the engine's viewer registry, so a plugin that contributed an extension-matched preview view keeps rendering unchanged. Built-in renderers stay the engine's own; a renderer that declares only media types is not bridged.

Both rendered lists are bounded, the file tree loads directories lazily (one level per expand) and the filename search runs on the Host. Save flows preserve autosave, draft recovery, external-change reconciliation and conflict handling; the engine owns document lifetimes and reports every file operation through the Host's project-scoped API.

## Validation

Focused package tests cover root registration and teardown, the workspace shell's engine region and panel hand-off, the renderer bridge, local-path confinement, session-browser behavior and the project API. The engine's Host half (filesystem, Git, search, preview routes) is covered by `zenwit-workspace`'s own suites. Compile with the kernel TypeScript compiler against this package's `tsconfig.json`; bundle with the shared `clientBundle` preset.

## Model Experience

None, as shell navigation and file editing register no model input; the captured text is staged as a file reference and becomes model-visible only when the user submits the conversation.

#### KV Cache effect

None from navigation or editing. A subsequently submitted selection changes the prompt according to the normal conversation reference serializer.

## Known Limitations and Deferred Work

- The API remains a host-owned same-origin HTTP capability; this package does not implement filesystem authority or storage.
- The client artifact now carries the editor, terminal and diagram stacks (the kernel builds one dynamic bundle per package), so start-up pays for views the user may not open. Restoring per-view lazy loading needs split build artifacts and a Host chunk route.
- A contributed preview view is bridged only when it declares file extensions; media-type-only declarations wait for engine-side sniffing.
- The HTML preview serves the saved file and its project-relative assets directly from the preview route; it does not bundle a page into a single document.
- The side-conversation methods are host-supplied: they reach this package only through the Host's `extra` dispatch table, so a deployment without them answers 501 for `sidechat.*`. Every method the browser half calls now has a host implementation (`scripts/verify-workbench-methods.mjs` fails when either side of the Client/Host method contract drifts).

### Dev Note

No runtime invariant entry: the package adds presentation and effect-owned registrations, with no independently reconstructed durable state to compare. The integration change must own profile/aggregate wiring and the repository Agent Note; package implementation and tests remain inside this directory.
