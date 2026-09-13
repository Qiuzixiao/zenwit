---
description: "独立浏览器工作台：项目库、文件编辑器与插槽组合的对话。"
kind: "package-reference"
---

# @deepseek-ai/dsh-client-ui-workbench

[English](README.md) | 中文

## 概要

本包是唯一的浏览器 `root` 所有者。首页和项目库进入可调整宽度的文件管理器／编辑器／对话三栏工作区。迁移旧产品界面，保留项目标签、搜索、创建和删除，不依赖短剧 Agent、领域数据或已移除的 client-runtime。

## 使用

与 API session/workspace controllers、ui-renderer、ui-session、仅提供服务的 ui-layout 和 ui-workspace、locale、conversation、input-trigger 一起挂载。保留 ui-settings-general 及需要的设置扩展；通用 `@` 文件和会话候选由 ui-reference 提供。Host 提供既有通用 `/api/desktop/projects` 接口。

根节点独占声明 `main`（keyed root）、`sidebar.settings`（single root）、`sidebar.panellist`（list root）、`shell.overlay`（list root）。设置接收 `{ wide: true }`；main 的 conversation 项在右侧显示；插件页面在中间显示，文档编辑器保持挂载。不得再挂载其他根界面、SidebarRoot、ui-workspace 原生浏览器或 rightbar 所有者；本包不使用覆盖优先级。

聊天和工具文件链接调用 `ctx.workbenchFiles.openFile(path, line?)`。支持项目相对路径、绝对本地路径和本地 file URL；拒绝越出当前项目的路径；指定行号时切换源码并定位。选区引用保存未提交的编辑内容，可加入当前或新会话，不会自动发送。

## 实现

对话区宽度根据工作台可用空间调整，窗口缩放时保留用户设定的展开宽度。向右侧边缘拖拽可折叠，向左拖拽分隔线可展开；点击展开恢复折叠前的宽度。窄对话区的顶部操作显示为图标，输入框工具栏的响应式布局由 conversation 负责。

WorkbenchFrame 负责页面、插件导航和标题；Workspace 负责工作区交互和文档生命周期；workspace-files 负责路径校验、文件树筛选和页签持久化；Editor 保留 Milkdown 可视化 Markdown、GFM、撤销重做、搜索、大纲、选区和 CodeMirror 源码编辑；ScrollDots 保留键盘与指针滚动。产品文案通过类型化中英词典注册。

保留自动保存、串行草稿备份、外部变更同步、冲突对比、明确覆盖、保留本地副本、导入、新建文件／目录、重命名、删除和关闭／离开保护。新建文件后自动打开。普通读取不带 sync=1，以便恢复草稿；同步读取带 sync=1。保存携带 expectedContent，409 保留本地编辑并暂停自动保存。Host SSE 监听由插件 effect 持有，通过框架绑定的 hook 进入 React，并随插件释放。

接口覆盖项目列表／创建／标签更新／删除、structure、file 读取／保存／草稿／清理、node 创建／重命名／删除、import、changes（SSE）、reveal 和 terminal。本地文件管理器与终端由用户菜单操作显式打开，远程部署可能不支持。

## 验证

包内测试覆盖注册释放、路径边界、页签恢复、项目接口错误、新建文件自动打开、草稿恢复、保存冲突与保存期间继续输入。使用内核 TypeScript 对本包 tsconfig.json 编译，并通过共享 tsdown 配置打包。实际浏览器组合测试由集成应用的 apps/web/tests/workbench.e2e.ts 负责。

## Model Experience

导航和文件编辑不发送模型请求。选区操作仅把当前内容暂存为文件引用，用户提交对话后才进入模型输入。

#### KV Cache effect

导航和编辑不影响缓存；后续提交的选区按既有引用序列化逻辑改变提示词。

## 已知限制与后续工作

- HTTP/SSE 文件能力由同源 Host 实现，本包不负责文件系统权限与存储。
- Milkdown、CodeMirror 语言语法以及 PDF.js 的 Worker、字体和图片解码器打入浏览器产物。Markdown（`.md`、`.markdown`、`.mdown`）支持可视化／源码编辑；HTML 和 SVG 支持源码／预览切换；图片和 PDF 为只读预览。HTML 打包同一项目内直接相对引用的普通 `.js`、样式表 `.css` 和图片 `src`，限制为 64 个资源、单项 4 MiB、总量 32 MiB；不打包本地 CSS 导入／URL、ES 模块、运行时 fetch 和开发服务器路由。
- Workspace 保留较大的迁移交互组件；路径／页签和编辑器已分离，跨文档保存与冲突操作保持在一起以保留时序。

### 开发说明

不声明 runtime invariant：本包只提供界面和 effect 注册，没有独立重建的持久状态。配置、聚合构建接线及仓库 Agent Note 由集成改动负责；实现和测试仅位于本目录。
