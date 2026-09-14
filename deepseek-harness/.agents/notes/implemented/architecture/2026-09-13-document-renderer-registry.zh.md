# Agent Note: 文档渲染器注册表

Status: implemented

[English](2026-09-13-document-renderer-registry.md) | 中文

## 问题

Workbench 用三个谓词和同一个 enum 回答"这个文件能不能预览"：`documentKind`、`isBinaryDocument`、`hasDocumentPreview`。"有预览"这个概念没有名字，两个谓词由构造保证互斥。每新增一种格式，调用点数量线性增长；而两种真实形态根本无法表达：视频（binary 存储 + 预览）与 `.mm`（text 存储 + 预览）。新增格式意味着改内核、重建全部运行时 tarball、重启应用。

## 决策

Workbench 从渲染器贡献注册表为每个文件派生唯一的 [DocumentDescriptor](../../../../docs/document-renderers.zh.md)。descriptor 携带 `path`、`mediaType`、`storage`、有序 `views`、选中的 `renderer` 或 `null`，以及可选的 `size`。`views` 是派生的——所选渲染器的视图加上文本存储的 `source`——因此贡献无法声称一个没人能绘制的视图。

`ctx.documentRenderers` 负责注册、选择与清单。一个贡献是纯声明数据（`id`、`contract`、`match`、`views`、可选 `priority` 与 `maxBytes`）加上懒加载的 `load()`；`match` 保持纯数据，使"谁声明了 .mm"无需加载插件代码即可回答。选择是与注册顺序无关的唯一全序：priority 降序、specificity 降序（精确 mediaType、扩展名、通配 mediaType）、完全同分时内置优先、最后按 id 升序。注册表对构建版本不符的贡献进行软拒绝，并记录原因供设置清单展示。

内核注册六个内置只读渲染器并自行绘制：`builtin/html`、`builtin/svg`、`builtin/image`、`builtin/pdf`、`builtin/video`、`builtin/audio`。媒体内置把原生元素指向 Host 的惰性内容路由，后者以真实 MIME、ETag、条件请求与字节范围流式传输。内置是进程内的、无 loader，并在完全同分时胜出，因此插件只有声明大于 0 的 `priority` 才能覆盖它们。Markdown 的可视化编辑是 Workbench 编辑器而非渲染器：它带着历史、查找与大纲编辑草稿，而只读渲染器契约刻意不携带这些。当没有渲染器认领 Markdown 文件时，Workbench 补上该编辑器的 `preview` 视图。

渲染器只收到 `path`、`mediaType`、当前文本 `source`、变更 `revision`、翻译函数，以及 `resolve(relative)`——后者在 Host 强制包含检查下为文档相对资源构造同源 URL——没有传输通道、没有原始字节。[Mindmap 渲染器](../../../../packages/client/renderer-mindmap/README.zh.md) 证明独立包可以不改内核新增格式；它通过 `ctx.documentRenderers` 注册 `.mm` 预览。本决策取代已移除的侧栏文档预览服务 `ctx.documentPreviews` 及其包（[document preview operations](2026-09-08-document-preview-operations.zh.md)）。

## 考虑过的替代方案

**扩展 `DocumentKind` 并加分支。** 这仍然不给"有预览"命名，调用点仍随格式数增长，也无法表达驱动这次工作的两种形态，除非再加更多互斥谓词。

**允许插件构造 descriptor。** 插件提供的 descriptor 在存储、大小、视图可用性上都不可信。集中派生使 descriptor 保持唯一权威。

**按注册顺序打破同分。** 注册顺序取决于 profile bundle 顺序，跨机器不可复现。四段全序以稳定的 id 比较收尾。

**引入 catch-all 渲染器。** catch-all 会把之后所有更具体的注册遮蔽在自身之后，让每个新增内置都变成遮蔽 bug。`renderer: null` 才是显式回退。

**把 Markdown 可视化编辑器放进注册表。** 那会迫使编辑回调进入一个其余消费者都是只读的契约，把编辑器的历史、查找与选区 API 冻结进预览契约。编辑器保持为 Workbench 内置视图；按 mediaType 匹配 Markdown 的插件可以覆盖它。

**把原始字节交给插件。** 暴露字节读取会让任意渲染器读取任意 Host 路由，并抹平两种威胁模型。P0 只给插件文本；带真实 MIME 与 Range 的专用内容通道推迟。

## 影响

新增一种格式现在是发一个包，而不是发一次内核：注册表选中它；卸载该包会移除它，已打开标签页重新解析为 `source` 且不丢草稿。descriptor 成为公开的预稳定契约，带整数版本与软拒绝路径，可通过可选字段增长。Workbench 不再自行回答格式问题，兼容负担转移到契约上。`.mm` 由随包发布的 Mindmap 插件开箱即用。惰性内容通道以字节范围流式传输大文件，统一解析器在 Host 强制包含下服务文档相对资源。页面级 Content-Security-Policy 仍然缺位：被服务的壳会内联注入引导脚本，因此强制执行需要为这些注入提供逐响应 nonce 并做运行时确认，暂缓。

验证包括 descriptor 表驱动测试、四段全序测试、注册表注册与处置测试、预览宿主测试（含 load 失败只尝试一次），以及 Mindmap 解析器、视图与插件注册测试。浏览器边界测试与客户端聚合类型检查锁定该分层。
