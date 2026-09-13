---
description: "工作台使用的侧栏扩展契约，不包含旧侧栏视觉实现。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-sidebar

[English](README.md) | 中文

## 概述

本包保留侧栏 SlotMap 和所有者属性契约。旧 SidebarRoot、样式表、界面文案和视觉注册已删除。Host 与 Client 两侧 Loader 入口均无运行时行为。

<a id="use-this-package"></a>
## 使用本包

从 `/client` 入口导入 `SidebarSettingsOwnerProps` 及面板、图标契约。工作台在运行时声明 `sidebar.settings` 和 `sidebar.panellist`。设置占用方接收 `wide`，面板图标接收 `size` 和 `active`。导入契约不会声明或填充槽位。

<a id="understand-the-implementation"></a>
## 理解实现

`src/client/contract/slots.ts` 持有共享类型。`src/client/index.ts` 导出这些契约，注入列表为空，apply 不执行操作。本包不再订阅面板列表、提供导航回调或注册语言字典。可选品牌、工作区和页脚契约继续供组合客户端使用，不会恢复旧页面。

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

- 本包不能独立渲染侧栏或设置入口。工作台必须声明槽位并提供所有者属性；设置与面板插件提供占用方。

<a id="dev-note"></a>
### 开发备注

不发布运行时不变式入口：服务与契约行为由本包测试直接验证。
