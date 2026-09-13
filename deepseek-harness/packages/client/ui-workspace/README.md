---
description: "Workspace navigation service and root snapshot hooks for the workbench."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workspace

English | [中文](README.zh.md)

## Summary

This package provides `UiWorkspaceService` as `ctx.uiWorkspace` and publishes the Workspace Controller list as `useWorkspaces`. WorkspacePicker, WorkspaceBrowser, rows, styles, view stores, tree helpers, and their locale copy have been deleted.

<a id="use-this-package"></a>
## Use this package

Mount the Workspace and Session Controllers, directory-picker Remote, layout service, and slot registry. Call `ctx.uiWorkspace.openSession`, `openWorkspace`, `connectWorkspace`, `startSession`, `forkSession`, or `archiveSession` from UI actions. Directory helpers remain `pickDirectory`, `listDirectory`, and `createDirectory`. The workbench supplies home and workspace presentation.

<a id="understand-the-implementation"></a>
## Understand the implementation

`src/client/navigation.ts` retains navigation, blank-session reuse, directory operations, and navigation cancellation. `src/client/index.ts` provides that service and publishes the controller's existing observable through `slots.provideRoot`; it creates no mirrored Workspace state and registers no visual slots. Teardown removes the hook contribution and service without touching another package's root.

Directory-flow owner types and slot names remain in `contract/slots.ts` for existing directory-picker clients. These are type contracts only; the adapter no longer declares the former sidebar or hero picker seats.

<a id="further-exploration"></a>
## Further Exploration

[Web Client architecture](../../../docs/subsystems/web-client.md) · [Slots](../../../docs/subsystems/slots.md)

<a id="model-experience"></a>
## Model Experience

None. This package does not change model input or provider requests.

#### KV Cache effect

None; this package does not assemble or send provider requests.

<a id="known-limitations-and-deferred-work"></a>
## Known Limitations and Deferred Work

- The package supplies no workspace browser, search rows, picker menus, or rename dialogs. Visual callers use the controller APIs for those operations. Navigation service tests remain alongside adapter lifecycle tests.

<a id="dev-note"></a>
### Dev Note

No runtime invariant entry: package tests directly verify service and contract behavior.
