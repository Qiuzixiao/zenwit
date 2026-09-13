---
description: "工作台使用的布局导航服务、面板钩子与主题呈现。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-layout

[English](README.md) | 中文

## 概述

本包提供 `ctx.layout`、根级 `usePanelInfo` 钩子和文档主题呈现，不注册 `root` 组件或子槽位。旧 AppFrame、样式表和标题组件已删除；页面组合和文档标题由工作台负责。

<a id="use-this-package"></a>
## 使用本包

将本服务与工作台及 `ui-theme` 一起加载。工作台声明 `main`、`sidebar.settings`、`sidebar.panellist` 和 `shell.overlay`。全局面板注册到 `main`；`ctx.layout.selectPanel(id)` 选择已注册的 key，`null` 返回当前会话界面，但不改变 Session。

<a id="understand-the-implementation"></a>
## 理解实现

`src/client/index.ts` 创建一份服务持有的 store，通过 `slots.provideRoot` 发布面板选择。`LayoutController` 校验选择的 key，在面板存在时保留选择，在面板注销后清空选择。`beginNavigation()` 返回的信号会被后续导航、面板选择或服务卸载中止。原有使用方仍可通过同一服务调用几何操作。

主题呈现器应用初始快照并监听 `theme/change`，更新配色、body 主题属性、别名 token、正文字号和自有 theme-color 元数据节点。卸载会清理写入和监听器。服务与钩子的卸载不会移除工作台根组件。

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

- 面板偏好是临时状态。本服务不提供框架、缩放控件或标题组件；视觉所有者必须负责渲染选中的面板。

<a id="dev-note"></a>
### 开发备注

不发布运行时不变式入口：服务与契约行为由本包测试直接验证。
