---
description: "Layout navigation service, panel hooks, and theme presentation for the workbench."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-layout

English | [中文](README.zh.md)

## Summary

This package provides `ctx.layout`, the root `usePanelInfo` hook, and document theme presentation. It registers no `root` component or child slots. The former AppFrame, its stylesheet, and its title component have been deleted; the workbench owns page composition and document titles.

<a id="use-this-package"></a>
## Use this package

Mount this service alongside the workbench and `ui-theme`. The workbench declares `main`, `sidebar.settings`, `sidebar.panellist`, and `shell.overlay`. Register global panels under `main`; `ctx.layout.selectPanel(id)` selects a registered key, and `null` returns to the current Conversation without changing the Session.

<a id="understand-the-implementation"></a>
## Understand the implementation

`src/client/index.ts` creates one service-owned store and publishes its panel selection through `slots.provideRoot`. `LayoutController` validates selected keys, retains selection while the panel exists, and clears it when the panel unregisters. `beginNavigation()` returns a signal superseded by another navigation, panel selection, or service disposal. Geometry actions remain available to existing consumers through the same service.

The theme presenter applies the initial snapshot and follows `theme/change`: color scheme, body theme attributes, alias tokens, content font size, and an owned theme-color metadata node. Disposal removes its writes and listeners. Service and hook teardown never removes the workbench root.

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

- Panel preferences are transient. The service supplies no frame, resize controls, or title component; a visual owner must render the selected panel.

<a id="dev-note"></a>
### Dev Note

No runtime invariant entry: package tests directly verify service and contract behavior.
