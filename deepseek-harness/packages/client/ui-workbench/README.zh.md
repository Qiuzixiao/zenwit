---
description: "独立的浏览器工作台：项目库、工作台引擎区域，以及由插槽组合的对话。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workbench

[English](README.md) | 中文

## 概要

浏览器 `root` 的唯一拥有者。首页与项目库进入工作区：**工作台引擎**区域（资源管理器、标签、编辑器、预览、变更、终端）与对话列并排。引擎是本产品自己的实现，由本包启动并挂载到工作区声明的区域；它调用的文件接口是宿主端的 `/api/desktop/workbench` 端点。项目标签、搜索、创建与删除照旧可用。

## 使用本包

与 API 会话/工作区控制器、`ui-renderer`、`ui-session`、仅服务的 `ui-layout` 与 `ui-workspace`、locale、conversation、input-trigger 一起挂载。保留 `ui-settings-general` 与所需的设置扩展；保留 `ui-reference` 以提供通用的 `@` 文件/会话候选。宿主必须提供通用的 `/api/desktop/projects` 端点以及工作台引擎端点（方法调用、流式上传、媒体字节流、沙箱 HTML 预览、项目变更流）。

根槽位只声明 `main`（keyed root）、`sidebar.settings`（single root）、`sidebar.panellist`（list root）、`sidebar.footer.action`（list root）、`shell.overlay`（list root）以及两个目录选择孔。两个内置界面都在共享顶栏的工具行里以 `{ wide: false }` 渲染设置座位（座位按 32px 的栏位尺寸绘制，不出现带文字的宽行）；该座位打开的设置面板是这条顶栏的 DOM 后代，因此顶栏规则的选择器权重受 `tests/workbench-chrome-styles.client.spec.ts` 守卫。注册到 `sidebar.panellist` 的条目在两个内置界面都是一级导航，在工作区里同时是工具行条目；被选中的 `main` 键把页面托管在首页主体，或在工作区里**顶替**引擎区域（引擎保持挂载但隐藏，状态不丢）。`main` 里的 `conversation` 键渲染在右侧。不要再挂载第二个根拥有者、SidebarRoot、可视化 ui-workspace 浏览器或右侧栏拥有者；本包不使用阴影优先级。

聊天与工具卡片的文件链接调用带类型的 `ctx.workbenchFiles.openFile(path, line?)` 服务：接受项目相对路径、绝对本地路径与本地文件 URL，拒绝越出当前项目的路径，并在当前会话的引擎编辑器标签里打开文件。选区进对话会把未保存文本作为结构化输入引用暂存，可在新会话中提交；它绝不自动提交。

## 实现说明

`WorkbenchFrame.tsx` 负责页面选择、面板托管与标题；`WorkbenchTopBar.tsx` 为所有内置界面渲染品牌、一级导航与设置座位，避免各处顶栏走样；`HomePage.tsx` 在内置界面旁列出已注册的面板条目并托管被选中的那个。`Workspace.tsx` 是工作区外壳：它声明引擎区域（`[data-zenwit-workbench-surface]`）并负责对话列的几何。引擎把自己的 React 根挂进那个区域；没有该属性时退回自带的全视口浮层。

`workbench/` 就是引擎。它的入口注册引擎服务（`ctx.workbenchEngine`）、语言字典与内置标签/预览器描述符，并挂载外壳。资源管理器、标签条、编辑器宿主、预览、变更视图、diff 渲染器、终端、浏览器、任务页与侧边对话都在 `workbench/` 的子模块里；重依赖视图（编辑器、终端、图表）经 `workbench/chunk-loader.ts` 加载。引擎通过宿主的方法接口读写文件（`fs.tree`、`fs.read`、`fs.write`、`fs.rename`、`fs.remove`、`fs.search`、`git.*`），流式上传，并从媒体路由与沙箱 HTML 路由渲染预览。

`renderer-bridge.ts` 把对外的 `ctx.documentRenderers` 注册表镜像进引擎的预览器注册表，因此贡献了按扩展名匹配预览视图的插件无需改动即可继续渲染。内置预览器仍归引擎自己；只声明媒体类型的渲染器不会被桥接。

两处列表渲染都有上界，文件树按目录懒加载（展开一层读一层），文件名搜索在宿主端执行。保存流程保留自动保存、草稿恢复、外部改动对账与冲突处理；文档生命周期归引擎，所有文件操作都经宿主的项目作用域接口完成。

## 验证

包内聚焦用例覆盖根注册与拆除、工作区外壳的引擎区域与面板让位、渲染器桥接、本地路径限制、会话浏览器行为与项目接口。引擎的宿主半（文件系统、Git、搜索、预览路由）由 `zenwit-workspace` 自己的测试覆盖。用内核的 TypeScript 编译器按本包 `tsconfig.json` 编译；用共享的 `clientBundle` 预设打包。

## 模型体验

无：界面导航与文件编辑不注册任何模型输入；捕获的文本只是暂存为文件引用，只有用户提交对话后它才对模型可见。

#### KV 缓存影响

导航与编辑没有任何影响。随后提交的选区按常规的对话引用序列化改变提示词。

## 已知限制与后续工作

- 接口仍是宿主拥有的同源 HTTP 能力；本包不实现文件系统权限或存储。
- 客户端产物现在包含编辑器、终端与图表三套依赖（内核每个包只产出一个动态包），启动时会为未必打开的视图付出代价。恢复逐视图懒加载需要拆分的构建产物与宿主分片路由。
- 贡献的预览视图只有在声明了文件扩展名时才会被桥接；只声明媒体类型的要等引擎侧的嗅探。
- HTML 预览直接从预览路由提供已保存文件与其项目内相对资源；它不把一个页面打包成单一文档。
- 侧边对话方法由宿主提供：它只通过宿主的 `extra` 派发表进入本包，因此未接该方法的部署对 `sidechat.*` 一律答 501。浏览器半调用的方法现在都有宿主实现（`scripts/verify-workbench-methods.mjs` 会在客户端/宿主方法约定漂移时失败）。

### 开发注记

不发布运行时不变式：本包只增加展示与 effect 拥有的注册，没有可独立重建的持久状态可比较。集成改动必须自行负责 profile/聚合接线与仓库级 Agent Note；包内实现与测试仍留在本目录。
