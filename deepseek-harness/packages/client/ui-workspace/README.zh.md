---
description: "工作台使用的工作区导航服务与根级快照钩子。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workspace

[English](README.md) | 中文

## 概述

本包通过 `ctx.uiWorkspace` 提供 `UiWorkspaceService`，并将 Workspace Controller 列表发布为 `useWorkspaces`。WorkspacePicker、WorkspaceBrowser、行组件、样式、视图 store、树形辅助逻辑及相关文案已删除。

<a id="use-this-package"></a>
## 使用本包

加载 Workspace 与 Session Controller、目录选择 Remote、布局服务和槽位注册表。在界面操作中调用 `ctx.uiWorkspace.openSession`、`openWorkspace`、`connectWorkspace`、`startSession`、`forkSession` 或 `archiveSession`。目录辅助方法继续提供 `pickDirectory`、`listDirectory` 和 `createDirectory`。首页和工作区展示由工作台负责。

<a id="understand-the-implementation"></a>
## 理解实现

`src/client/navigation.ts` 保留导航、空白会话复用、目录操作和导航取消。`src/client/index.ts` 提供该服务，通过 `slots.provideRoot` 发布控制器已有的 observable，不复制工作区状态，也不注册视觉槽位。卸载时清理钩子贡献和服务，不触及其他包的根组件。

`contract/slots.ts` 保留目录流程所有者类型和槽位名称，供现有目录选择客户端使用。这些仅是类型契约；适配器不再声明原侧栏或 hero 选择器槽位。

<a id="further-exploration"></a>
## 进一步探索

[Web Client architecture](../../../docs/subsystems/web-client.zh.md) · [Slots](../../../docs/subsystems/slots.zh.md)

<a id="model-experience"></a>
## 模型体验

无。本包不修改模型输入或提供方请求。

#### KV Cache 影响

无。本包不组装或发送提供方请求。

<a id="known-limitations-and-deferred-work"></a>
## 已知限制与延期工作

- 本包不提供工作区浏览器、搜索行、选择菜单或重命名对话框。视觉调用方使用控制器 API 执行这些操作。导航服务测试保留，并与适配器生命周期测试一起运行。

<a id="dev-note"></a>
### 开发备注

不发布运行时不变式入口：服务与契约行为由本包测试直接验证。
