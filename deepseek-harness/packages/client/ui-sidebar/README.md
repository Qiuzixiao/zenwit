---
description: "Sidebar extension contracts for the workbench; no visual sidebar implementation."
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar

English | [中文](README.zh.md)

## Summary

This package retains sidebar SlotMap and owner-prop contracts. The former SidebarRoot, stylesheet, locale copy, and visual registration have been deleted. Both Loader entries are inert.

<a id="use-this-package"></a>
## Use this package

Import `SidebarSettingsOwnerProps` and panel/icon contracts from the `/client` entry. The workbench declares `sidebar.settings` and `sidebar.panellist` at runtime. Settings occupants receive `wide`; panel icons receive `size` and `active`. Contract imports do not declare or populate a slot.

<a id="understand-the-implementation"></a>
## Understand the implementation

`src/client/contract/slots.ts` owns the shared types. `src/client/index.ts` exports those contracts with an empty injection list and a no-op apply. There are no panel-list subscriptions, navigation callbacks, or locale registrations. Optional brand, workspace, and footer contracts remain available to composed clients without reinstating the old page.

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

- This package cannot render a sidebar or settings trigger on its own. The workbench must declare the seats and supply their owner props; settings and panel plugins supply their occupants.

<a id="dev-note"></a>
### Dev Note

No runtime invariant entry: package tests directly verify service and contract behavior.
