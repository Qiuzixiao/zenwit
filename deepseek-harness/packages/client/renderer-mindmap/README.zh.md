---
description: "面向 Zenwit Workbench 预览注册表的 FreeMind（.mm）思维导图渲染器插件。"
kind: "package-reference"
---

# dsh-client-renderer-mindmap

[English](README.md) | 中文

## 概述

一个独立的 Workbench 文档渲染器插件。它为 `.mm` FreeMind 文档贡献一个 `preview` 视图：注册表选中它后，视图把 XML 草稿解析为有界节点树，并用 React 元素绘制。该包不包含内核代码，只通过 `ctx.documentRenderers` 接入注册表，因此安装或移除它会改变 `.mm` 的呈现方式，而无需重建内核。

## 目录

- [解析规则](#parsing-rules)
- [模型体验](#model-experience)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)

-----

<a id="parsing-rules"></a>
## 解析规则

`parseMindmap` 会拒绝空文档、包含 `<!DOCTYPE` 声明的文档（防 XXE）、超过字符上限的文档、格式错误的 XML，以及根不是带 `node` 子节点的 `map` 元素的情形。它只读取 `TEXT`、`POSITION`、`STYLE`、`FOLDED` 四个属性；其余属性一律忽略，绝不展开到 DOM。`<richcontent TYPE="NODE">` 子节点会被拍平为规范化空白的纯文本，HTML 不会进入页面。节点数与深度上限为 5000 与 64。

该 contribution 声明 `contract: 1` 与 `maxBytes: 4 MiB`。contract 版本不符的构建会被软拒绝，原因记录在渲染器清单中，不影响其他功能。

-----

<a id="model-experience"></a>
## 模型体验

无，因为该浏览器端渲染器不贡献任何 prompt、schema 或会话事件。

#### KV Cache 影响

独立；该包不改变任何模型请求。

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **布局是嵌套树，而非放射状画布。** `FOLDED`、`POSITION`、`STYLE` 已被解析并保留，但尚未用于摆放节点。
- **仅支持 UTF-8 文档。** Workbench 文本通道会拒绝非 UTF-8 字节，因此 GBK 的 `.mm` 会以源码打开。

### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>

**运行时不变式：** 不发布 companion。该包注册一个可处置的渲染器，不持有可变运行时关系。
