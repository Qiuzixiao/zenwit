# 文档渲染器

[English](document-renderers.md) | 中文

渲染器插件教会 Workbench 如何呈现某一类文件。对每个打开的文件，Workbench 派生唯一的 descriptor、选择一个已注册的渲染器并渲染所选视图。插件只贡献声明与懒加载视图模块；它们从不构造 descriptor，也不从 Workbench 导入运行时代码。

注册表是 [ui-workbench](../packages/client/ui-workbench/README.zh.md) 拥有的客户端服务 `ctx.documentRenderers`。其公共契约是类型专用子路径 `@deepseek-ai/dsh-client-ui-workbench/preview`。内核注册六个内置只读渲染器——`builtin/html`、`builtin/svg`、`builtin/image`、`builtin/pdf`、`builtin/video`、`builtin/audio`——并自行绘制。Markdown 的可视化编辑保持为 Workbench 编辑器而非渲染器，因为它编辑草稿，而不是呈现只读视图。

## Descriptor

[DocumentDescriptor](../packages/client/ui-workbench/src/client/document-descriptor.ts) 是"这个文件是什么、能怎么显示"的唯一答案：

| 字段 | 含义 |
|---|---|
| `path` | 绝对项目路径。 |
| `mediaType` | 解析出的 MIME 类型；无声明时为 `text/plain` 或 `application/octet-stream`。 |
| `storage` | 可按 UTF-8 编辑为 `text`，不可当文本解码为 `binary`。未知扩展名保持 `text`。 |
| `views` | 有序的可用视图；首个为默认。由所选渲染器的视图加上文本存储的 `source` 派生。 |
| `renderer` | 选中的渲染器 id，回退时为 `null`。 |
| `size` | 已知字节大小，未知为 `undefined`。 |

`views` 是派生而非声明，因此渲染器无法声称一个没人能绘制的视图。四种组合是"文本或二进制"与"有或无选中渲染器"的笛卡尔积：`['preview', 'source']`、`['preview']`、`['source']`、`[]`。

## Contribution

插件注册一个渲染器 contribution：`id`（反域名、发布后不可改）、`contract`（构建时对应的整数版本）、`match`（`extensions` 与 `mediaTypes`，纯数据）、`views`、可选的 `priority` 与 `maxBytes`，以及动态导入视图模块的 `load()`。通过 `ctx.effect` 安装该 contribution，会在插件 fiber 卸载时自动移除。

由于 `match` 是纯数据，注册表无需运行插件代码即可回答"谁声明了 .mm"，因此设置清单可以在不加载插件的前提下枚举渲染器。

## 选择顺序

当多个声明匹配时，由唯一全序决定，与注册顺序无关：

1. `priority` 降序——唯一的显式覆盖杠杆。
2. specificity 降序——精确 mediaType（3）、文件扩展名（2）、`image/*` 这类通配 mediaType（1）。
3. 完全同分时内置优先。
4. `id` 升序，保证结果可复现。

意图覆盖内置的插件把 `priority` 设为大于 0；否则内置赢得同分。

## 降级

对渲染器认领的文件，Workbench 绝不显示空白面板：

| 情况 | 结果 |
|---|---|
| 匹配到渲染器 | descriptor 记录该 id，渲染默认视图。 |
| 无渲染器、文本存储 | 仅 `source`。 |
| 无渲染器、二进制存储 | 无视图；Workbench 报告暂无预览。 |
| `load()` 失败 | descriptor 去掉该渲染器，保留源码，编辑器头部显示原因与重试入口。失败的渲染器按 id 记忆，重新渲染不会重试它；只有显式重试才会重新武装。 |
| 文件超过 `maxBytes` | 同样的回退，附带文件过大原因。 |

## 兼容

`contract` 是注册时校验的整数。构建版本不符的 contribution 会被软拒绝：记录原因到设置清单后忽略，因此一个不兼容的渲染器不会破坏该插件的其他功能。新增可选字段是 minor；修改必填字段或 descriptor 语义是破坏性变更。本构建不认识的 view id 会从可用视图中丢弃，而不是整体拒绝该渲染器。

## 内容通道

图片、PDF、视频、音频内置渲染器通过 Host 的惰性内容路由（`/api/desktop/projects/file?stream=1`）读取。它以 `createReadStream` 流式传输、报告 `Accept-Ranges: bytes`、以 `206` 与 `Content-Range` 响应 `Range`、以 `304` 响应 `If-None-Match`，并发送真实媒体类型与 `Content-Disposition: inline`、`X-Content-Type-Options: nosniff`。活动内容（HTML、SVG）与未知扩展名保持沙箱资产策略：`application/octet-stream`、`attachment` 与 `Content-Security-Policy: sandbox; default-src 'none'`。100 MiB 整文件读取上限只作用于沙箱资产路由，因此大视频可以流式播放与拖动。

## 安全

渲染器只收到 `path`、`mediaType`、当前文本 `source`、变更 `revision`、Workbench 翻译函数，以及 `resolve(relative)`。`resolve` 为文档相对资源返回同源 URL，Host 在每次读取时都会执行项目包含与软链拒绝检查。渲染器本身拿不到传输通道，也拿不到原始文件字节，因此插件无法抓取任意 Host 路由。Mindmap 解析器拒绝 `<!DOCTYPE` 声明、拍平内嵌富文本、以白名单读取属性而非展开，并限制节点数、深度与大小。渲染器绘制 React 元素；契约禁止 `dangerouslySetInnerHTML`。

## 新增渲染器

创建一个包，其浏览器半声明 `inject = ['documentRenderers']`，并在 `ctx.effect` 中注册 contribution。[Mindmap 渲染器](../packages/client/renderer-mindmap/README.zh.md) 即参考实现：按扩展名匹配 `.mm`，声明 `contract: 1` 与 `maxBytes: 4 MiB`，并加载解析草稿、绘制树形结构的视图。
