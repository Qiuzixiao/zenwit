---
description: "Standalone browser workbench with a project library, file editor, and slot-composed chat."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workbench

English | [中文](README.zh.md)

## Summary

The sole browser `root` owner. Home and the project library lead into a resizable file-manager / editor / conversation workspace. This package migrates the former product UI without a short-drama agent, domain schema, or removed client-runtime dependency. Project tags, search, creation and deletion remain available.

## Use this package

Mount with the API session/workspace controllers, `ui-renderer`, `ui-session`, the service-only `ui-layout` and `ui-workspace`, locale, conversation, and input-trigger plugins. Keep `ui-settings-general` and the desired settings extensions; keep `ui-reference` for generic `@` file/session candidates. The Host must serve the existing generic `/api/desktop/projects` endpoints.

The root exclusively declares `main` (keyed root), `sidebar.settings` (single root), `sidebar.panellist` (list root), and `shell.overlay` (list root). Settings receives `{ wide: true }`. The `conversation` key in `main` renders on the right. Selected plugin pages render in the center, leaving the document editors mounted. Do not mount another root owner, SidebarRoot, a visual ui-workspace browser, or a rightbar owner; this package uses no shadow priority.

Chat/tool file links call the typed `ctx.workbenchFiles.openFile(path, line?)` service. It accepts project-relative paths, absolute local paths and local file URLs, rejects traversal outside the selected project, and reveals a requested line in source mode. Selection-to-chat captures unsaved text in a structured input reference, optionally in a new session; it never submits automatically.

## Understand the implementation

Chat width follows the available workspace space and remembers the user's expanded width across window resizing. Dragging toward the right edge collapses the pane; dragging its divider left expands it. Clicking expand restores the width from before collapse. Narrow chat headers use icon actions, and the conversation composer owns its responsive toolbar layout.

`WorkbenchFrame.tsx` owns page selection, plugin navigation and titles. `Workspace.tsx` owns workspace interaction and document lifetimes. `workspace-files.ts` owns file-path validation, tree filtering and persisted tab metadata. `Editor.tsx` retains Milkdown visual Markdown, GFM, undo/redo, search, outline navigation, selection capture and CodeMirror source editing. `ScrollDots.tsx` retains keyboard- and pointer-operable scroll handles. UI copy is registered in typed English and Chinese dictionaries.

Both rendered lists are bounded: the tree shares one 400-row render budget across its whole recursion, and the quick-open dialog renders at most 100 rows, each with a notice that says how to see the rest. A filter query no longer expands every directory into one element per node. Project change events collapse into at most one `fileRevision` bump per 250 ms window: one bump costs the Host a whole-project scan, and a build writes thousands of files while the app runs. A structure response is derived into the flattened file list once per response, a superseded response is cancelled before its JSON is parsed, and the tree reports the Host `truncated` flag instead of implying completeness.

File editing preserves autosave, serial draft backups, external-change reconciliation, conflict comparison, explicit overwrite, local-copy preservation, import, new file/folder, rename, delete, and safe close/leave flows. Newly created files open immediately. Normal reads omit `sync=1` so persisted drafts can recover; synchronization reads include it. Saves carry `expectedContent`; 409 responses keep local edits and pause autosave. Host change-feed observation belongs to the plugin effect and reaches React through a renderer-bound hook. File revisions and service registrations are disposed with the plugin.

The Host endpoints used by the migrated UI are: project list/create/tag update, project delete, structure, file read/save/draft/discard, node create/rename/delete, import, changes (SSE), reveal and terminal. Host-native reveal/terminal actions remain explicit menu actions and may be unavailable on remote deployments.

## Validation

Focused package tests cover registration and teardown, local-path confinement, tab restoration, project API failures, new-file opening, persisted-draft recovery, save conflicts and edits arriving during an in-flight save. Compile with the kernel TypeScript compiler against this package's `tsconfig.json`; bundle with the shared `tsdown.config.ts`. Real browser composition is covered by the integrating application's `apps/web/tests/workbench.e2e.ts`.

## Model Experience

Shell navigation and file editing do not send model requests. Adding a selection stages the captured text as a file reference; it becomes model-visible only when the user submits the conversation.

#### KV Cache effect

None from navigation or editing. A subsequently submitted selection changes the prompt according to the normal conversation reference serializer.

## Known Limitations and Deferred Work

- The API remains a host-owned same-origin HTTP/SSE capability; this package does not implement filesystem authority or storage.
- Milkdown, CodeMirror language grammars, PDF.js workers/fonts and image decoders are bundled in the browser artifact. Markdown (`.md`, `.markdown`, `.mdown`) supports visual/source editing; HTML and SVG support source/preview switching; images and PDFs are read-only previews. HTML packages direct relative classic `.js`, stylesheet `.css`, and image `src` resources inside the same project, within 64 assets, 4 MiB per asset and 32 MiB total. Local CSS imports/URLs, ES modules, runtime fetches and development-server routing are not bundled.
- File editing remains a substantial migrated workspace component. Path/tab helpers and editor instances are separate, while cross-document autosave/conflict actions remain together to retain their ordering.
- The file tree renders whatever one bounded structure response carries. The Host omits `node_modules` and stops at its entry budget; there is no per-directory lazy loading yet, so a project beyond that budget shows a truncated tree rather than fetching the remainder on demand.

### Dev Note

No runtime invariant entry: the package adds presentation and effect-owned registrations, with no independently reconstructed durable state to compare. The integration change must own profile/aggregate wiring and the repository Agent Note; package implementation and tests remain inside this directory.
