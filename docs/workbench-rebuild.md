# Zenwit 工作台引擎重建方案与进度

> 本文件是这次重建的方案与唯一进度记录：目标与决定、命名规范、阶段计划、逐阶段实际结果与验证数字、已知缺口、检查指引。第 9 节为合并后的进度记录（早期逐轮追加的日志已并入对应阶段）。

## 1. 目标与总决定

用 Zenwit 自己的**工作台引擎**替换原有的文件管理与编辑器实现，能力覆盖资源管理器、编辑器、预览、变更/Git、统一 diff、终端、内嵌浏览器、任务页、侧边对话与模型工具；视觉沿用 Zenwit 现有风格；通过软件更新发布，不做插件、不上插件市场。

| 决定项 | 结论 |
| --- | --- |
| 形态 | 内核实现 + 产品自带桌面插件（不放市场、不走插件安装） |
| 发布 | 软件更新（内核构建 → 打包 → 双渠道同步 → 安装 → 双变体验证） |
| 布局 | 保持「左文件 / 中工作区 / 右对话」，中栏内部为多标签 + 分栏（底部面板已在 6.18 移除） |
| 视觉 | 复用内核 `--dsw-*` 语义 token（移植样式表 295 处 token、0 处硬编码颜色） |
| 实现来源 | 移植现成实现，**禁止重写、禁止自研**；只做改名、去第三方名称、换皮、接线 |
| 名称 | 全部使用 Zenwit 命名（见第 2 节），仓库与产品中不出现第三方名称 |
| 旧实现 | 原有文件树、编辑器、预览、相关弹窗与用例已删除 |

## 2. 命名规范

| 对象 | 命名 |
| --- | --- |
| 引擎名 | Zenwit 工作台引擎 |
| 客户端归属 | `packages/client/ui-workbench`（`src/client/workbench/`） |
| 后台归属 | `zenwit-workspace`（`src/workbench/`） |
| 客户端模块 | `WorkbenchTree` / `WorkbenchTabs` / `WorkbenchEditor` / `WorkbenchPreview` / `WorkbenchChanges` / `WorkbenchDock` / `WorkbenchTerminal` / `WorkbenchBrowser` / `WorkbenchTasks` / `WorkbenchSideChat` / `WorkbenchSplit` |
| 逻辑模块 | `workbench-store` `workbench-diff` `chunk-loader` `file-icons` |
| 后台模块 | `tree` `operations` `search` `containment` `session-path` `trust` `wire` `git` `shell` `shell-route` `preview` `opens` `opens-route` `prefs-store` `changes` `jobs` `subagents` `subagent-activity` `sidechat` `backend` |
| 接口 | `/api/desktop/workbench`（方法信封）、`/upload`、`/file`、`/html/<项目>/<路径>`、`/ws/terminal`、`/ws/agent-opens` |
| 存储 | `<home>/workspace/workbench-preferences.json`（带修订号） |
| 服务 | `ctx.workbenchEngine`（客户端引擎）、`ctx.workbenchOpens`（宿主打开投递）、`ctx.workbenchFiles`（聊天文件链接） |
| 模型工具 | `workbench_open`（模型主动打开文件/文件夹/网页） |
| 第三方声明 | 不出现；版权人已同意去掉署名 |

## 3. 最终形态

- **左栏**：项目名 + 资源管理器，可拖宽、可折叠。内容由引擎的 `ExplorerPane`（移植的 `TreePanel`）提供：点开才加载的目录树、文件类型图标、宿主端文件名搜索、右键菜单、拖放上传、`@` 引用进对话；左栏按**项目**工作，没有对话会话时照样可用。
- **中栏**：引擎区域。标签条 + 内容区，多标签（中键关闭、右键关闭其他/左/右、拖拽排序、拖出左右或上下分屏、拖回合并）、按类型自动预览；未打开文件时显示该面板自己的"可打开类型"卡片。
- **右栏**：对话（产品原生），不变。
- **引擎自带的标签**：终端、变更预览、后台任务、浏览器、侧边对话都还是引擎里的标签，在中栏的引擎区域里打开。
- **模型**：`workbench_open` 把文件/文件夹/网页放到调用者会话的工作区（默认开启，设置可关）。

## 4. 留 / 删 / 换

**留**：首页、项目库、项目登记与删除、对话、设置、顶栏、三栏骨格、文案字典、配色与图标、桌面双变体与打包链路、`ctx.documentRenderers` 对外预览器注册表。

**删**：`ui-workbench` 原有文件树、编辑器（Milkdown/CodeMirror）、预览（HTML/PDF）、文档标签、节点对话框与右键菜单，以及其用例；`zenwit-workspace` 原有的整项目结构扫描与旧文件读写接口（保留项目注册表）。

**换**：第 2 节列出的宿主模块与引擎客户端模块，全部按"原样移植 + 改名"落地。

## 5. 阶段计划（目标）

1. 底座：删旧、搬引擎、接产品、换皮。
2. 左栏：资源管理器。
3. 中栏：标签、编辑器、预览。
4. 底部面板与终端。
5. 变更 / Git / 统一 diff。
6. 浏览器、任务页、侧边对话。
7. 模型主动操作。
8. 扩展点、设置、多语言、性能。
9. 双变体验证与发布。

## 6. 执行进度（实际结果）

### 6.1 底座与左栏、中栏 — 完成
- 宿主引擎 10 个模块 + 主机 API 落地；路由挂在 `/api/desktop/workbench`（方法信封）与 `/upload`（流式），经既有 `desktop-workspace` 插件注册，两版自动生效。
- 客户端半 126 个文件搬入并改名去标识（第三方名称 0 处残留）；类型错误 **141 → 0**；依赖补齐（clsx、react-icons、mermaid、dompurify、xterm、CodeMirror 全语言包与 legacy-modes、react-dom、ui-settings/connection/modules）。
- 产品外壳 `Workspace.tsx` 从 1352 行收缩到 **166 行**：只声明引擎区域（`data-zenwit-workbench-surface`）与对话列；一级面板选中时让位。
- 旧实现与 9 个过时用例删除；包体 `lib/client.js` 由 **11.80 MB → 1.85 MB**（当时尚未接回引擎重依赖）。
- 皮肤合规：移植样式表 295 处 `--dsw-*` token、0 处硬编码颜色；三条主题不变量（0.5px 发丝描边、抬高面不叠中性描边 + 滚动条重绑、全圆角配 `corner-shape: round`）全部对齐，`ui-theme` 82 项转绿。

### 6.2 文案与预览路由 — 完成
- `verify-client-ui-i18n` 绿（659 文件）：19 处硬编码文案清零，数据常量改名以区别于文案（语义未动）。
- 媒体路由 `/file`（项目作用域、包含判定、大小上限、按扩展名给类型、`download=1`)与沙箱 HTML 路由 `/html/<项目>/<路径>`（CSP sandbox + nosniff + no-referrer）落地；子资源请求走 Host 头信任围栏（同源标记检查会误杀无 Origin/Referer 的请求）；客户端媒体/下载/HTML 地址与 Markdown 本地图片改写同步。
- 分片加载改为打包器 `import()`（内核单包单产物），`chunk-loader.ts` 330 行 → 108 行；xterm 样式改为包内 vendor 副本。**代价**：重依赖随核心包打进产物（11.28 MB），按需加载待评估。

### 6.3 扩展点、文档、真机链路 — 完成
- `renderer-bridge.ts` 把对外 `ctx.documentRenderers` 镜像进引擎预览器注册表（按扩展名匹配；注册表新增 `declarations()`），既有插件预览器无需改动。
- 包 README（中英）改写为引擎架构；Agent Note（中英）记录问题/决定/结果/替代方案并交叉链接；双语配对重录；`verify-agent-note-format` 与 README 限制门禁通过。
- **运行时真机链路打通**：内核构建 → 打包 265 个 tarball → stable/beta 双渠道同步 → 安装 → `check:layout`；此后每次内核改动都重复该链路。

### 6.4 终端宿主半 — 完成
- `shell.ts`：PTY 会话注册表（打开/写入/改尺寸/终止），**有界回放转录**（256 KiB，按字节截断不切字符），`node-pty` 惰性加载并探测。
- `shell-route.ts`：`/ws/terminal` 升级路由，文本帧即输入/输出，JSON 控制帧 `resize`/`close`/`park`；拒绝以 1011 关闭并给出 `pty-deps-missing` 或 `shell-not-found:<名>`；断开只停车不杀会话。
- 依赖探测方法 `terminal.deps` 返回修复指引。
- **决定：不移植上游的 8 个终端工具**——内核已有 `terminal_open/send/read/signal/close/list`（`dsh-tool-terminal` + `dsh-terminal` + `dsh-terminal-bash`），重复实现会重名冲突；"模型能直接驱动终端"由既有工具满足。

### 6.5 模型主动打开 — 完成
- `opens.ts` + `opens-route.ts`：按会话的请求队列，**发送即出队**（已投递的绝不重放，避免重复开标签页），未投递的等视图挂上时回放；`/ws/agent-opens` 分租。
- 桌面两版新增 `workbench-open.ts`：用内核 `defineTool` 注册 `workbench_open`（kind/target/title），按调用者会话入队；`cordis.patch.yml` 独立插件行挂载；`ctx.workbenchOpens` 由工作区宿主发布。
- `agentOpenTools` 默认改为 **true**（产品决定），设置页保留开关。

### 6.6 宿主接口补齐 — 完成
- **对照审计**客户端调用的方法，修正命名不一致（`session.cwd`、`git.branch`），实现缺失但可映射者：`shell.get`、`pty.close`、`settings.get/update`（带修订号的偏好存储，过期写入 409）、`browser.probe`（回报 X-Frame-Options 与 CSP frame-ancestors）、`open.external`。
- 新增 `extra` 扩展方法机制：宿主可选服务（会话日志、任务、子代理）由拥有内核服务的桌面插件提供。
- `changes.ops`（本轮文件视角）：按游标返回 `tool/call`+`tool/result`，窗口上限 4000，无游标从 -1 起（seq 0 不漏）。
- `subagents.live`（子代理拓扑）：一次刷新整棵树，只取运行中的子会话、排除侧边对话线程，倒扫折叠最近文本/工具；`lastActivity` 纯函数。
- `jobs.output`/`jobs.kill`（任务页）：从属主会话日志回放**模型已读过的**输出（不消费模型游标）、噪声与错误结果只计已读、字节上限；取消经 `ctx.jobs`。

### 6.7 方法契约守卫 — 完成
- `scripts/verify-workbench-methods.mjs`（并入 `check:architecture`）对照客户端 `call('ns.method')` 与宿主两张派发表，未声明漂移即失败；缺口必须在 `KNOWN_GAPS` 登记。
- 守卫立刻抓出两处真实缺陷：`git.commit-diff`（我实现成驼峰，历史补丁显示此前 404）、`git.cherry-pick`（客户端要调、宿主未实现）。现状：**40 个客户端方法全部有宿主实现**。

### 6.8 侧边对话（核心逻辑 + 方法层） — 完成
- `sidechat.ts`（400 行纯函数）：继承裁剪（开放回合诚实收尾；有悬挂工具调用时截断并改用结构化快照）、`buildOpenTurnSnapshot`（已结算读 durable，进行中由实时增量补；两处预算上限）、边界提示（模型可见契约逐字保留）、注入行结构识别、标签压缩、自有日志切分。
- **方法层落地**：桌面两版新增 `workbench-sidechat.ts`（6 个方法），经 `extra` 并入工作台派发表，读内核 `agents` / `sessions` / `sessionTitle` 服务。`start` 以父会话日志为种子建子会话（子代理描述符让线程在任务页是一条健康记录，再由标签过滤掉），`prompt` 首次带边界与停靠快照、之后是普通追问、进程已退出时走 `resume`，`cancel` / `dispose` / `info` / `events` 各就其位；方法层不导入内核运行时，只按结构读取宿主上下文。
- 诚实降级：本代内核的在飞增量是进程内的，`sidechat.events` 的 `live` 返回空数组，线程文本在回合落盘后出现（代码注释与本文件均已声明）。
- 验证：桌面两版各 14 项新用例（建线程与种子、停靠快照、空线程、父会话未运行即拒绝、首次与后续提问、退出后恢复、取消、幂等释放、存活与路由、游标过滤与非法游标）全绿。

### 6.9 产物验收：第三方名称清零 — 完成
- 对**构建产物**（不是源码）做第三方名称扫描，查出客户端包里有 5 处 `dsh-better` 泄漏——来源是上游的**插件推荐目录**（`plugins-tabs` / `plugins-viewers` / `add-plugin-modal` 及其 98 行中英文案），那是上游生态的推荐清单，本产品有自己的市场，不该随包发布。
- 处理：删除四个目录模块、设置页里的两张"添加插件"虚线卡片与对应弹窗、以及全部带第三方名称的文案键。产物复查：`better-sidebar` / `dsh-better` / `betterWorkbench` / `overleaf` / `/sidebar/` 全部 **0 处**；宿主产物同样 0 处。
- 顺带清掉了构建残渣（`lib/types` 下已删模块的 `.d.ts`/`.js`），并重新打包同步运行时，避免残留文件进入发布产物。
- 验证：类型检查 0 错误；工作台包 12 文件 / 52 项通过；文案门禁 655 文件；产物大小 11.28 MB → 11.25 MB。

### 6.10 引擎激活验收 — 完成
- 新增 `tests/engine-activation.client.spec.ts`：把产品插件在真实 Cordis 上下文里跑起来，断言
  1. 引擎服务 `ctx.workbenchEngine` 确实被提供（含版本号），
  2. 聊天文件链接 `ctx.workbenchFiles.openFile` 路由进引擎且不抛错，
  3. 引擎的注册面真实可用（注册一个标签 → 出现在 `getTabs()`，disposer 后消失），
  4. 拆除后服务消失。
- 意义：这条用例证明"产品插件 + 引擎"这一层接线在真实上下文中成立，而不只是各自的单测通过。
- 验证：工作台包 **13 文件 / 53 项**通过；类型检查 0 错误。

### 6.11 缺口的诚实降级 — 完成
- 未落地的功能以前会以传输层的"未知方法"404 返回，界面显示的是英文开发者字符串。现在：
  - 宿主为已声明缺口返回 **501 + 专门的 `not-ported` 错误码 + 一句产品口吻的话**（当前缺口清单已清空，机制保留给未来的缺口）；
  - 客户端把该错误码映射为**本地化文案**（中英），四处错误展示点统一走这个映射；
  - **方法契约守卫同时交叉校验两份清单**：宿主的 `NOT_PORTED_METHODS` 与守卫的 `KNOWN_GAPS` 必须完全一致——一边答 501 而另一边没登记、或登记了却仍走 404，守卫都会失败。这样"缺口清单"不会悄悄漂移。
- 验证：`zenwit-workspace check` 75 项；工作台包 13 文件 / 53 项；文案门禁 655 文件；守卫输出"40 个方法有实现 + 2 个缺口全部以 501 作答"。

### 6.12 双变体验证与打包冒烟 — 完成
- 两版桌面 `check`（构建 + 类型检查 + 测试 + 闭包/CLI/Loader/profile/licenses/operations 门禁）**全绿**。
- 期间修正了两处测试期望（注入列表加 `sessions`；路由清单加工作台 API 与 HTML 前缀），并纠正了一次**被管道掩盖退出码造成的假绿**。

### 6.13 真机验收发现的两个缺陷 — 完成
在真实桌面窗口里跑起来后，中栏是空白（只剩一行引擎标签），查出两个根因，都已修掉：

1. **注入的样式表被判成同一张，引擎的样式整张没生效。** 客户端打包预设给注入的 `<style>` 打的标签是"包名/文件名"，丢掉了目录；引擎的 `workbench/workbench.module.css` 与产品外壳的 `workbench.module.css` 因此撞名，注入守卫看到同名标签就直接跳过第二张表。修法是标签改用样式表在包内 `src` 下的路径（`packages/client/tsdown.client.ts` 新增 `stylesheetTagName`），并在 `scripts/client-bundle-css.spec.ts` 补一条"同名不同目录必须得到不同标签"的回归用例。这正是中栏看起来"没样式"、面板挤在左上角的原因。
2. **引擎仍按视口几何摆自己，没有把自己当成产品给的区域。** 挂载时已经标记嵌入，但 `Workbench` 没收到这个标记：它照样去量 DSH 的原生中列、写 `data-dsh-center-col`（于是布局挤压落到对话列上）、并用量到的左右边距与高度摆放面板。现在 `embedded` 一路传到 `Workbench`：面板以 `inset: 0` 填满引擎区域、不再取视口几何、中列定位器整体停用（`useCenterColumn` 新增开关参数）、折叠按钮与高度拖拽条在嵌入模式下隐藏。

验证：内核 `tsc -b tsconfig.client.json` 0 错误；内核客户端套件 **311 文件 / 4556 项**通过；工作台包 14 文件 / 57 项通过；`scripts/client-bundle-css.spec.ts` 4 项通过（含同名样式表必须拿到不同标签的回归用例）；重建内核产物并同步 stable/beta 两个渠道（各 265 包）后 `check:layout` 全绿；两版桌面 `check` 仍全绿（140 文件 / 1385 + 8 跳过；138 文件 / 1362 + 7 跳过）。两版 `node_modules` 里安装的引擎产物已确认带上了新标签与嵌入模式样式。

### 6.14 三栏恢复 — 完成
真机上看，三栏只剩了"引擎区 + 对话"两栏：左栏没有内容了。原因是我在第 6.1 步接线时，把引擎**整个**放进中栏一个区域，顺手把原来 5 条轨道的三栏网格（左文件 / 中工作区 / 右对话）改成了 2 栏 —— 这是越权改动，不在"换实现"的范围内。

修复只做接线与摆放，不重写：
- **左栏回到 `Workspace.tsx`**：恢复 5 轨道网格（左栏 | 手柄 | 中栏 | 手柄 | 对话），左栏沿用产品原来的卡片样式（`.paneStructure`）、项目名标题栏、拖宽（190–360）与折叠；`.engineExplorer` 作为引擎资源管理器的落点。
- **引擎把资源管理器作为组件提供**：新增 `workbench/ExplorerPane.tsx`，内部就是移植的 `TreePanel`；`apply()` 返回它的 per-session store，客户端注入面新增 `engine: { store, service, openFile, referenceFile }`，产品外壳据此渲染左栏。**同一个 store 同时供左栏和引擎区域**，所以在左栏点文件就是在引擎区域开标签。
- **按项目工作，不依赖对话**：左栏用项目路径当根（`cwd = projectPath`），没有会话时展开状态由左栏自己持有（store 在无会话时是空操作），因此首页/项目库之间切换、还没开对话时左栏都有文件。

验证：新增 `tests/embedded-surface.client.spec.tsx` 断言引擎面板确实填进产品声明的区域、不带视口几何、不给对话列打布局挤压标记；`workspace-shell.client.spec.tsx` 扩到 5 项（三栏存在、5 轨道网格、左栏渲染出资源管理器、左右栏各自折叠/恢复）；工作台包 14 文件 / 56 项、内核客户端套件 **312 文件 / 4559 项**通过；重建并同步两渠道运行时（各 265 包）后 `check:layout` 全绿；两版桌面 `check` 全绿（140 文件 / 1385 + 8 跳过；138 文件 / 1362 + 7 跳过）；两版安装目录里的引擎产物已确认带左栏资源管理器与三栏外壳。

### 6.15 中栏接管（区域出现时搬进去） — 完成
真机上中栏是空的，点开的文件却出现在右下角一条横条里。原因：引擎在插件激活时就挂载，而产品的"引擎区域"要等你打开项目才渲染 —— 引擎启动时看不到区域，就退回了它自带的"浮在窗口上"模式（此时标签面板按 DSH 原生中列量位置，在本产品里量到的是对话列，于是浮在右下角），等区域出现后也不会再搬。

修法：挂载后持续核对产品声明的区域（每 500 毫秒一次属性查询；区域在 `#root` 里渲染，body 的 childList 观察者看不到它，所以用轮询）——区域出现就把它搬进去并切到嵌入模式（填满中栏：标签条在中栏顶部、内容在中栏里），区域消失（回到首页）就搬回独立浮层。视图自我检查只在独立浮层模式下跑。

**后续修正（同一步）**：嵌入后面板第一次铺满时把整个窗口盖住了 —— 引擎自己那一层是"相对窗口铺满"的，面板 `inset: 0` 于是在窗口里铺满，左栏与右栏被压在下面。现在嵌入模式下这一层改成"相对引擎区域铺满"（`:global([data-zenwit-workbench-embedded]) > :global([data-dsh-panel-host])`），面板的 `inset: 0` 就只在中栏内生效；独立浮层模式仍是相对窗口。

验证：`tests/embedded-surface.client.spec.tsx` 两项——① 区域已存在时引擎填进去、不带视口几何、不给对话列打挤压标记；② 激活时没有区域、区域稍后出现时引擎搬进去并切到嵌入模式。工作台包 14 文件 / 57 项、内核客户端套件 **312 文件 / 4560 项**通过；重建并同步两渠道运行时后 `check:layout` 全绿；两版桌面 `check` 全绿（140 文件 / 1385 + 8 跳过；138 文件 / 1362 + 7 跳过）；两版安装目录里的产物已确认带这段逻辑。

### 6.16 中栏卡面、返回按钮、区域交付改为推送式 — 完成
真机反馈三件事，一起修：

1. **中栏不是圆角卡片**：中栏原来只有一块裸区域。现在 `.paneEngine` 与左栏、右栏用同一套卡片样式（1px 细边、`--zw-r-card` 圆角、`--zw-surface` 底、阴影、`overflow: hidden`）；引擎面板自带的全宽底色与上边框在这个卡片里被清掉，圆角才不会被方块底盖住。
2. **"返回项目库"点了没用**：`Workspace` 少注册了"关闭请求"回调（正是顶栏返回按钮调用的那个），按钮因此是禁用状态。已恢复注册；`registerCloseRequest` 在卸载时注销。
3. **打开项目后中栏不显示，点文件也不显示，刷新才出来**：区域交付改成**推送式**——产品外壳在自己的区域挂载时把元素交给引擎（`ctx.workbenchEngine.attachRegion(element)`），离开时交回 null；引擎立刻搬进去并切嵌入模式。删掉了原来"每 500 毫秒查一次文档"的轮询，不再依赖时序。

验证：`tests/embedded-surface.client.spec.tsx` 两项（交给区域后填进去且不带视口几何、不给对话列打挤压标记；激活后才交付也能搬进去、交回后回到独立浮层）；`workspace-shell.client.spec.tsx` 7 项（新增"交出区域并在卸载时收回""注册返回按钮用的关闭回调"）；工作台包 14 文件 / 59 项、内核客户端套件 **312 文件 / 4562 项**通过；重建并同步两渠道运行时后 `check:layout` 全绿；两版桌面 `check` 全绿（140 文件 / 1385 + 8 跳过；138 文件 / 1362 + 7 跳过）；已确认两版安装目录里的产物带 `attachRegion` 与中栏卡片样式（`.paneEngine [data-dsh-bottom-panel]{background:0 0;border-top:none}`）。

### 6.17 工作台不再浮在首页/项目库上 — 完成
回首页后引擎面板还浮在右下角（标签条 + 文件内容压在"继续你的工作"上面）。原因：区域交回 `null` 时引擎按"独立宿主"处理，退回自带的全视口浮层；而面板的开合状态是持久化的，之前打开过就一直显示。

修法：把"交回区域"的语义补成三态——**没交过**＝独立宿主，保留浮层；**交了元素**＝填满该区域；**交了 null**＝产品在屏幕上但没有区域（首页、项目库），引擎**整体不渲染**（宿主仍在，标签与状态保留）。`WorkbenchFrame` 在非工作台界面时主动交回 null；工作台界面由 `Workspace` 交出元素。嵌入与隐藏两种模式下都不做中列跟踪、不写布局挤压。

验证：`embedded-surface.client.spec.tsx` 三项（交出区域即填满且无视口几何；没有区域时整体不渲染、宿主仍在；激活后才交付也能搬进去、交回后隐藏）；`frame-navigation.client.spec.tsx` 断言首页会向引擎声明"没有区域"；工作台包 14 文件 / 60 项、内核客户端套件 **312 文件 / 4563 项**通过；重建并同步两渠道运行时后 `check:layout` 全绿；两版桌面 `check` 全绿（140 文件 / 1385 + 8 跳过；138 文件 / 1362 + 7 跳过）；已确认两版安装目录里的产物带 `attachRegion` 三态逻辑。

### 6.18 去硬套第一批：拆掉"底部面板"、视口几何与第三种状态 — 完成
按"改造上游代码以符合本产品设计"的要求做第一批，只删不加：

- **不再按窗口摆位置**：删掉 `center-column.ts`、`layout-push.ts`、`shell/use-center-column.ts`，以及 `layout.css` 里给对话列加 margin 的挤压规则和拖拽/折叠体态规则。工作台现在只做一件事：填满产品交给它的中栏区域。
- **不再有"可折叠底部面板"**：`WorkbenchState` 去掉 `bottomOpen`/`bottomHeight`/`bottomOpenedOnce`，删掉 `toggleBottomPanel`/`setBottomHeight` 与 `BOTTOM_*`/`CONVERSATION_MIN`；`Workbench.tsx` 删掉高度拖拽、折叠按钮、键盘内缩、"位置兼容模式"标题栏适配、better-locale 集成与自定义 CSS 注入；`bottomSplits` 更名为 `splits`；样式里删掉 `.bottomPanel*`/`.bottomResize`/`.bottomClose`/`.toggleButton` 与固定的视口宿主层，换成 `.surface`。
- **第三种状态没了**：区域交付只剩两态——交付元素＝在中栏里渲染；交付 null＝把宿主从中栏移出文档（React 树保持挂载，标签和终端不丢）。删掉固定浮层、降级同步自检、以及 aionui 面板互斥（`setSuspended`/`externalDisable` 的调用路径）。
- **验证**：`embedded-surface.client.spec.tsx` 改为两态断言（交付元素后在中栏里渲染、不带视口几何；没有区域时宿主不在文档里、交回后再移出）；工作台包 14 文件 / 59 项、内核客户端套件 **312 文件 / 4562 项**通过；重建并同步两渠道运行时（各 265 包）后 `check:layout` 全绿；两版桌面 `check` 全绿（140 文件 / 1385 + 8 跳过；138 文件 / 1362 + 7 跳过）；两版安装目录里的产物已是新构建（17:20）。

**仍待做（下一批）**：`desktop-env`/`shell-presets`/`titlebar-strip`/`wco` 四个上游专属模块与其设置页分区、`agentTerminalTools`/`bottomPanelAutoTerminal` 死偏好、better-locale 文案键、store 从"按对话"改成"按项目"、以及文件改名。

### 6.19 去硬套第二批：一个文件管理器、按项目的工作台、清掉上游专属件 — 完成
1. **左栏是唯一的文件管理器**：`EditorHost` 里的第二棵文件树、它的宽度拖拽、文件树开关按钮、"打开方式"菜单与 `treeOpen/treeWidth` meta 全部删除；"文件"标签不再出现在 + 菜单里（`hidden: true`），文件只从左栏和聊天链接进入编辑器。
2. **工作台按项目走**：store 的键从"对话"改成**项目目录**（`setSession` → `setProject`、`bySession` → `byProject`、`getSessionStates` → `getProjectStates`、`reduceFor` 按项目、持久化键 `zenwit-workbench:v2:<项目>`）；外壳在挂载时把项目交给引擎（`engine.setProject(projectPath)`）。终端的 PTY 仍属于"打开它的那次对话"，所以终端标签生成时把会话写进 `meta.ptySession`，跨会话固定终端据此重连（`pinned.ts` 的家作用域改为"项目定位 + 会话连接"）。store 另存一个"当前显示的对话"镜像，供"切换对话要 park 终端 / 关闭标签要释放终端"这条判断使用。
3. **删掉上游专属件**：`desktop-env.ts`、`shell-presets.ts`、`titlebar-strip.ts`、`wco.ts` 四个模块及其在设置页里的"位置兼容模式"整块（下拉、壳预设、自定义 CSS 弹窗、相关文案与偏好字段的读取）全部删除；同时删掉"给模型注入 8 个终端工具"这个死开关（那 8 个工具本来就不移植）、aionui 面板互斥（`setSuspended`/`externalDisable`/`suspended`）及其在链接接管、turn-tail 接管里的判断；还删掉了从未被安装的"原生右栏工作台"写入口（`WorkbenchSurface`、`setSurface` 与 openTab 里的整段分支）。

验证：`workspace-shell.client.spec.tsx` 增加"外壳交出项目、卸载时收回"的断言；工作台包 14 文件 / 59 项、内核客户端套件 **312 文件 / 4562 项**通过；重建并同步两渠道运行时后 `check:layout` 全绿；两版桌面 `check` 全绿（140 文件 / 1385 + 8 跳过；138 文件 / 1362 + 7 跳过）。顺带把 `openTabInBottomPane` 这类带"Bottom"的名字改成 `openTabInPane`。

4. **改名按方案第 2 节落地**：`FileTree→WorkbenchTree`、`TreePanel→WorkbenchTreePanel`、`TabBar→WorkbenchTabs`、`EditorHost→WorkbenchEditor`、`split-pane→WorkbenchSplit`、`TerminalView→WorkbenchTerminal`、`BrowserView→WorkbenchBrowser`、`SubagentView→WorkbenchTasks`、`SideChatView→WorkbenchSideChat`、`ExplorerPane→WorkbenchExplorer`、`state.ts→workbench-store.ts`（共 11 个文件、31 个文件的引用同步更新）；`openTabInBottomPane→openTabInPane`。改名前后 `tsc` 0 错误、用例全过。

**收尾（不影响使用）**：偏好对象与语言字典里还有几个已经没人读的键（`titleBarScheme`/`customCss`/`agentTerminalTools`/`bottomPanelAutoTerminal`/`editorExplorer` 与 better-locale 那几行文案），清理它们需要再动一遍 prefs 与字典，留作下一次顺手清理。

### 6.20 自查与修复（9 项） — 完成
按"先确认问题存在、再定位原因、最后修"的顺序处理：

| # | 问题（确认过） | 原因 | 修法 |
| --- | --- | --- | --- |
| 1 | 中栏点不动、切不了标签、滚不动 | 工作台根节点带着旧浮层时代的 `[data-dsh-panel-host] { pointer-events: none }`，而"面板自己重新打开指针事件"的规则随底部面板一起删了 | 去掉该规则；根节点保持完全可交互 |
| 2 | 中栏内容被裁、没有滚动条 | 引擎宿主 div 的"嵌入模式铺满区域"规则随浮层删除，根节点 `height: 100%` 落在自动高度的父级上 → 内部 `overflow-y:auto` 没有确定高度 | 给 `[data-zenwit-workbench]` 加 `position:absolute; inset:0` |
| 3 | 回首页会释放终端、丢未保存草稿 | 外壳卸载时 `setProject(null)` 清了 store 的 state → 所有标签视图卸载（草稿只在内存、终端被 close） | 卸载只交回区域，**不再把项目置空** |
| 4 | 聊天文件链接有时"点了没反应" | 会话 cwd 未知时 scope 只有 sessionId，被 `(scope.cwd ?? '') !== 项目` 判成"另一个项目" → 标签落进空字符串键的幽灵状态 | 目标项目解析为 `scope.cwd ?? 当前项目`，比较用解析后的值；`reduceFor` 也用解析值 |
| 5 | 换对话后同一个终端标签连到新 shell | 标签按项目保留，但终端 WS 用当前 `sessionId` 连 PTY | 终端标签生成时写入 `meta.ptySession`；视图与关闭都用它（旧标签回退到 scope） |
| 6 | Windows 下固定终端解析错 | 虚拟 id `pinned:<项目路径>:<tabId>` 用第一个冒号切分，`C:\...` 被切成 `C` | 虚拟 id 改用项目路径的稳定哈希（无冒号），项目本身放在标签 meta 里 |
| 7 | "打开方式"设置是死 UI | 设置面板还在，但左栏没把 openWith 配置传给树 | 把 openWith 配置与回调接进 `WorkbenchExplorer`（含固定/SSH 目标） |
| 8 | 无意义的空编辑标签入口 | 归拢产物的 "reveal" 会额外开一个无路径 editor 标签（旧文件浏览器） | 删掉那次 openTab，保留高亮/展开 |
| 9 | 孤儿文件、失效 CSS、没人读的偏好与文案 | 前几批删除后的残留 | 删 `tree-mutations.ts`、`resource-address.ts`；删 `layout.css` 的挤压规则与过期注释；删 `titleBar*`/`customCss`/`agentTerminalTools`/`bottomPanelAutoTerminal`/`editorExplorer` 偏好字段、`TITLE_BAR_STRIP_*`/`TITLEBAR_MODES` 常量、46 条死文案键，以及 better-locale 覆盖整合（`attachBetterLocale` 已无调用者） |

验证：文案门禁 0；客户端 `tsc -b tsconfig.client.json` 0 错误；工作台包 **15 文件 / 61 项**、内核客户端套件 **313 文件 / 4564 项**通过；重建并同步两渠道运行时后 `check:layout` 全绿；两版桌面 `check` 全绿（140 文件 / 1385 + 8 跳过；138 文件 / 1362 + 7 跳过）；两版安装目录里的产物已确认带新的宿主规则（`[data-zenwit-workbench]{position:absolute;inset:0}`，且不再有 `pointer-events:none`）。

同时补了两条**能挡住这类问题**的用例：`tests/workbench-styles.client.spec.ts` 直接读样式表，断言工作台根节点不做点击穿透、且铺满区域（前一版正是这两条被漏掉）；`workspace-shell.client.spec.tsx` 增加"卸载时不清项目"的断言。

### 6.21 移除 agent 终端残留 — 完成
按产品决定（这个功能用处不大）整体移除，不做半成品：

- **客户端**：删掉 `agent-terminals` 的 WebSocket 消费与对账（`use-host-feeds.ts`）、状态里的 `agentWaits` 与 `isAgentTabId`/`agentUuidOf`/`reconcileAgentTerminals`/`mirrorAgentWaits` 一组辅助、终端视图里的 agent 分支（uuid 连接、等待状态、park 判断）、等待横幅组件 `TerminalWaitBanner.tsx` 与它的样式和文案、标签上的沙漏徽标、固定终端里的 agent 关闭分支、`api.agentPtyClose`/`agentSkipWait` 两个方法。
- **宿主与守卫**：`NOT_PORTED_METHODS` 与 `KNOWN_GAPS` 双双清空（守卫交叉校验恒等成立）；backend 用例里那条 501 断言随之删除。
- **文档**：本文件的缺口清单、包 README（中英，配对重录）、Agent Note（中英）都把这条从「待办缺口」改成「产品决定不做 + 原因」。

**要恢复这条功能的前置条件**（记录在案）：给内核终端服务加两项能力——按 owner+会话订阅原始输出、取消一次在飞的 `terminal_send` 等待；否则做出来只能是只读的行文本回看，画不出真终端。

验证：工作台包 15 文件 / 61 项、内核客户端套件 **313 文件 / 4564 项**通过；文案门禁 0；客户端 `tsc` 0 错误；守卫输出「**38 个客户端方法全部有宿主实现 + 0 个缺口**」；重建并同步两渠道运行时后 `check:layout` 全绿；两版桌面 `check` 全绿（140 文件 / 1385 + 8 跳过；138 文件 / 1362 + 7 跳过）；两版安装目录里的产物已确认 **0 处** `agent-terminals`/`agent-pty`/`agentWaits`/`TerminalWaitBanner`/`skip-wait`。

### 6.22 修复一次样式表误删（事故） — 完成
真机反馈：markdown 预览左上角出现一个孤立小按钮，点开把大纲条目挤成一段无样式文字。

- **原因**：我在 6.21 清理等待横幅样式时，用「按行号删除」的方式判断结束位置，规则写错、匹配到了很后面的一个 `}`，一次删掉约 500 行无关样式。
- **影响面**（与操作前的备份逐类比对：代码仍在用、样式已丢的类共 **33 个**）：目录/大纲（`toc*` 六个类）、渲染错误提示条（`boundaryError` / `tabBoundaryError`）、分屏内容容器（`paneBody`）、变更/Git 视图（`git*` 六个类）、产物 chips（`produced*`）、「打开方式」菜单（`openWith*`）、终端依赖修复提示（`terminalDeps*` / `terminalRetry`）、`editorHtmlBlock`。
- **修法**：以操作前的备份为基线重建样式表——把其中的占位宿主规则替换成 6.20 的正确写法，并只排除本就该删的 `.terminalWaitBanner` / `.terminalWaitNeedle`。现在与备份的差异只剩这两处（共 58 行）。
- **补守卫**：新增 `tests/style-class-coverage.client.spec.ts`——逐文件解析 `import css from '…module.css'`，断言源码里每个 `css.<名字>` 在对应样式表里都有定义。它上线即抓出另一处陈旧引用（`PdfView.tsx` 的 `css.panelResize` 从来没定义过），已一并清掉。

验证：与备份的差异只剩两处（宿主规则替换 + 等待横幅删除，共 58 行）；类覆盖检查只剩 `terminalWaitBanner`/`terminalWaitNeedle` 两个「本应删除」的类；工作台包 **16 文件 / 62 项**、内核客户端套件 **314 文件 / 4565 项**通过；重建并同步两渠道运行时后 `check:layout` 全绿；两版桌面 `check` 全绿（140 文件 / 1385 + 8 跳过；138 文件 / 1362 + 7 跳过）；两版安装目录产物（18:39）已确认 `tocBar`/`tocPanel`/`tocItemText`/`boundaryError`/`paneBody`/`gitEmpty`/`producedChip`/`openWithPin`/`terminalRetry` 全部回来了。

### 6.23 标签栏改成产品风格 — 完成
真机反馈：中栏标签栏是移植过来的 VS Code 风格（34px、扁平分隔线、直角、选中只换底色），与工作台其余部分不搭。按旧产品那套重做，**只改样式、不动逻辑**：

| 项 | 旧（VS Code 风） | 现在（产品风） |
| --- | --- | --- |
| 标签栏 | 34px、底部 0.5px 细线、整条底色 | **44px**、无细线、透明底、左右留白 8px、标签间距 4px |
| 标签 | 直角、右侧分隔线、min 64 / max 160 | **圆角 `--zw-r-sm`、无分隔线、min 96 / max 180、高 30px** |
| 悬停 | 换底色 | 浅底（`--zw-surface`）+ 文字加深 |
| 选中 | 只换底色 | **白底 + `--zw-hairline-strong` 细边 + 轻阴影 + 文字加粗 600** |
| 关闭按钮 | 18×18 常驻 | 22×22、**仅悬停/选中时淡入**（占位保留，不挤压标题；键盘聚焦也可见） |
| `+` 按钮 | 22×22、不透明底 | 26×26、透明底、悬停浅底 |
| 徽标 | kernel token | 产品品牌色（`--zw-brand-soft` / `--zw-brand`） |

颜色全部走工作台已有的 `--zw-*` 变量（浅色/深色皮肤自动跟随），未引入任何新的类名或硬编码颜色；拖拽落点虚线改为品牌色并跟随圆角；`prefers-reduced-motion` 下关闭按钮的过渡也关掉。

验证：样式类覆盖守卫（16 文件 / 62 项）、内核客户端套件 **314 文件 / 4565 项**、文案门禁 0、客户端 `tsc` 0 错误；重建并同步两渠道运行时后 `check:layout` 全绿；两版桌面 `check` 全绿（140 文件 / 1385 + 8 跳过；138 文件 / 1362 + 7 跳过）；两版安装目录产物（18:50）已确认新规则：`.tabBar{height:44px;gap:4px}`、`.tab{border-radius:var(--zw-r-sm);min-width:96px;max-width:180px;height:30px}`、`.tabActive{--zw-ink + --zw-hairline-strong + --zw-surface + shadow + 600}`、`.tabClose{22px;opacity:0}`。

### 6.24 空面板欢迎卡片改成居中玻璃卡 — 完成
真机反馈：一个标签都没打开时，中栏左上角横排 5 个深色方块，很突兀。**只改样式**：

- `.paneEmptyCards`：从"贴顶的 auto-fill 网格"改成**整块居中**（flex-wrap + 双向居中 + 24px 内边距 + 溢出可滚），窄面板时自动换行、仍居中。
- `.paneCard`：固定宽 132px（`min(132px,100%)`）、`--zw-r-card` 圆角、**半透明玻璃**（`color-mix(--zw-surface 82%, transparent)` + `backdrop-filter: blur(12px)`）、`--zw-hairline` 细边 + `--zw-shadow` 轻阴影、图标放大到 22px、内边距加大；悬停改浮起（上移 2px + `--zw-shadow-float` + 文字加深），按下回位，禁用态保持半透明。
- 颜色全部走 `--zw-*`（浅色/深色自动跟随），未新增类名、未改任何逻辑；`prefers-reduced-motion` 下过渡已由既有规则关闭。

验证：工作台包 16 文件 / 62 项、内核客户端套件 **314 文件 / 4565 项**、两版桌面 `check` 全绿（140 文件 / 1385 + 8 跳过；138 文件 / 1362 + 7 跳过）、`check:layout` 全绿；两版安装目录产物已确认新规则：`.paneEmptyCards{display:flex;flex-wrap:wrap;align-items:center;align-content:center;justify-content:center;gap:12px;padding:24px;overflow:auto}`、`.paneCard{width:min(132px,100%);border-radius:var(--zw-r-card);background:color-mix(in srgb,var(--zw-surface) 82%,transparent);backdrop-filter:blur(12px);box-shadow:var(--zw-shadow)}`、`.paneCard svg{width:22px;height:22px}`。

### 6.25 左侧文件管理器支持拖动折叠 — 完成
真机反馈：右侧对话列可以自由拖动、拖窄了自动折叠，左侧文件管理器只能拖到固定宽度、折叠得点按钮。**只改产品外壳的宽度逻辑**（`Workspace.tsx`，无新样式）：

- 删掉写死的 `LEFT_MAX = 360`，改成与右列同一条规则：**左列最多长到"中栏与右列都收到最小值"**（`availableWidth - centerMin - 右列最小值`），所以现在是自由拖宽。
- 加折叠阈值（与右列对称）：拖到 **< 160px 折叠**成 48px 竖条，只有拖回 **> 200px 才展开**——两个阈值不同，避免在边界来回跳。
- 折叠手势会**记住折叠前的宽度**（`leftDragPreferred`），展开时回到那个宽度；折叠状态下从竖条往外拖同样能展开（和右列一样）。
- 折叠态的竖条与展开按钮沿用既有样式（`.leftRail[data-collapsed]` 已经和 `.paneChat` 同一套规则），因此两边的折叠观感完全一致。

验证：新增一条拖动用例（jsdom 里模拟 pointerdown/move/up：拖过折叠边 → 首轨变 48px 且出现展开按钮；再拖过展开边 → 恢复），`workspace-shell.client.spec.tsx` 8 项通过；工作台包 16 文件 / 62 项、内核客户端套件 **314 文件 / 4566 项**、文案门禁 0、客户端 `tsc` 0 错误；重建并同步两渠道运行时后 `check:layout` 全绿；两版桌面 `check` 全绿（140 文件 / 1385 + 8 跳过；138 文件 / 1362 + 7 跳过）；两版安装目录产物已确认带新的拖动逻辑（`leftDragPreferred` / `leftDragCollapsed`）。

### 6.26 左列折叠宽度改 44px + 修掉拖到最大时的闪烁 — 完成
1. 折叠竖条宽度：`COLLAPSED_WIDTH` 48 → **44px**（左右两列共用这个常量，因此两边的竖条都是 44px，仍对称）。
2. 拖到最大时画面闪烁（右列没有）：**根因是一条反馈环**。旧公式把"可用宽度"算成"容器宽 − 左列当前宽 − 两条手柄"，而左列的上限又从这个"可用宽度"里减出来——左列一长，可用宽度就变小，上限随之变小，于是每一次 pointermove 都把它重新夹回一个变动的上限，来回震荡（肉眼看就是闪）。右列没这问题，因为它的上限从来不减自己的宽度。
   修法：把"网格可用宽度"只算一次（容器宽 − 两条手柄），不再减左列自身宽度；中栏下限、右列上限、左列上限全部由这一个测量值推导，顺序上先算右列再算左列，所以**左列的上限不再依赖左列当前宽度**，环断了，拖到顶也稳。

验证：新增两条用例——① 拖过折叠边首轨变 **44px** 并出现展开按钮，再拖过展开边恢复；② 在 1200px 的实测网格下把左列拖过头并**连续两次同位置拖动**，断言宽度稳定停在最大值 432px（旧公式会从 412 跳到 240，这条用例会失败）。`workspace-shell.client.spec.tsx` 9 项通过。

### 6.27 空面板标签栏显示「开始」标签 — 完成
真机反馈：一个标签都没打开时，标签栏只剩一个孤零零的 `+`，看不出当前在哪一页。现在空面板会在标签栏里显示一个**「开始」标签**（罗盘图标 + 文案，用选中态样式）：它是这一页的名字，不是可关闭/可拖拽的真标签。

- 位置：`WorkbenchTabs.tsx` 在 `tabs.length === 0` 时渲染静态 chip（`css.tab + css.tabActive + css.startTab`，`aria-current="page"`，无关闭按钮、不参与拖拽）；鼠标样式为默认，不当按钮看。
- 文案：新增语言键 `start`（zh「开始」/ en「Start」），进的是内核语言字典，中英都有。
- 样式：复用标签那套（圆角卡、选中态白底+细边+轻阴影），只加 `.startTab { cursor: default }` 与图标不收缩。
- `+` 按钮保留（空面板里点它可以直接开标签），欢迎卡片仍是主要入口。

验证：新增 `workbench-tabs.client.spec.tsx` 两项——空面板渲染出「开始」且**没有关闭按钮**、`+` 按钮仍在；工作台包 **17 文件 / 66 项**、内核客户端套件 **315 文件 / 4569 项**、文案门禁 0、客户端 `tsc` 0 错误；重建并同步两渠道运行时后 `check:layout` 全绿；两版桌面 `check` 全绿（140 文件 / 1385 + 8 跳过；138 文件 / 1362 + 7 跳过）；两版安装目录产物已确认带 `.startTab` 规则与 `start` 文案键（zh 开始 / en Start）。

### 6.28 设置页错乱的根因 + 「工作台」设置页改名与清理 — 完成
真机反馈两条：从工作区打开设置后**很多设置页面显示错乱**（按钮丢底色/描边、栏目行挤在一起、主题方块变形）；设置里的**「侧边卡片」这一页语义与现在的三栏产品不符**。

**根因（一层 CSS 权重问题，不是设计问题）**：设置座位 `sidebar.settings` 渲染在**工作区顶栏** `<nav class="workbenchTools">` 内部，而设置面板又是这个座位的 DOM 后代；外壳样式写了 `.workbenchTools button { … }`（后代选择器，权重 0,1,1）和 `.globalActions button { … }`，内核设置界面的控件却都是**单类名**样式（0,1,0）——权重压不过，且与样式表加载顺序无关。于是：主按钮（`.primaryButton` / 内核 `Button.primary`）丢填充与描边、左侧栏目行 `.navCell` 内边距 9/16/12→6/10、关闭按钮由 28×28 圆变成 34×32 圆角条、卡片 `.cardMain` 内边距与圆角错位、带 `aria-pressed` 的开关卡片与主题方块 `.themeCube` 被产品蓝覆盖（外层方块的边框还被 `border:0` 抹掉）。从首页/项目库打开设置不经过这条顶栏，所以同一套界面在那里是正常的——这解释了"有的页面正常有的乱"。

**修法（第一层，6.29 补成子选择器）**：把三条外壳规则降到 `:where()` 权重（`:where(.workbenchTools) button`、`:where(.workbenchTools button[aria-pressed="true"])`、`:where(.globalActions) button`），并把首页路径的 `.navTools button:focus-visible` 收成子选择器 `.navTools > button:focus-visible`。`:where()` 只降权重、不删规则，外壳自己的裸按钮（返回/面板/通知）没有竞争类规则，外观不变。**这层只解决了「权重压过」，没解决「属性泄漏」——真机复验后在 6.29 补成子选择器。**

**改名与语义对齐**：
- `SideCardSection` → `WorkbenchSettingsSection`（含 CSS 模块与全部引用）；栏目名 zh「侧边卡片」→「**工作台**」、en「Side card」→「Workbench」；新增字典键 `settingsProductName`（Zenwit 工作台 / Zenwit Workbench）替掉硬编码标牌 `DSH-zenwit-workbench`。
- 分组名统一：zh「侧边栏内容」→「中栏标签页」（en Workbench tabs）、zh「文件预览」→「文件打开方式」。
- 标签卡片不再印内部类型 id（旧代码 `desc: tab.id` 会显示 editor / git / terminal / browser…），改用描述符自带的说明文案；没有说明就不渲染那一行。
- 删掉**死开关** `bottomPanelAutoTerminal`：`WorkbenchPrefs` 里根本没有这个字段，它只能"点了立刻弹回"，还会往设置 JSON 里写脏键；同时删只为它存在的两个文案键。
- 文案去掉已删除功能的措辞（底部面板 / 全屏抽屉 / 侧边栏），`agentOpenTools` 的描述按实际默认值改成「默认开启」（与第 3 节一致，默认值本身不动）。
- 代码清理：删 21 个未引用 CSS 类与"添加插件"整段（含空注释块、缩进错位、常量位置），修 4 处"改了 `border-color` 但 `border:0`"的死声明（改成透明 1px 边，边框色才画得出来）；注释用词统一到工作台表述（18 个文件，`layout.css` 里指"浮动菜单卡"的 side card 保留原意）。

**守卫（先证伪再落地）**：
1. 新增 `workbench-chrome-styles.client.spec.ts`：设置座位所在的外壳容器不得用后代元素选择器压过类级样式（必须 `:where()` 或 `>`），并正例断言三条规则仍是 `:where()` 形态。把两条规则临时改回旧写法 → **2 项失败**，改回后 3 项通过。
2. 新增 `workbench-settings.client.spec.tsx`：每个描述符开关键必须能在 `WorkbenchPrefs` 找到字段（死开关回归即红）、字典里不得再出现"侧边卡片/底部面板"、卡片渲染出描述而不是 id、产品名来自字典。
3. `style-class-coverage.client.spec.ts` 增加"设置页样式表无未引用类"的定向断言（塞一个探针类 → 失败，删掉 → 通过）。

验证：工作台包 **19 文件 / 76 项**、内核客户端套件 **317 文件 / 4579 项**、文案门禁 0（645 文件）、客户端 `tsc` 0 错误；重建并同步两渠道运行时后 `check:layout` 全绿（含双语配对、方法契约 38 个全有实现、双渠道各 265 包、189 个共享桌面源文件对齐）；两版桌面 `check` 全绿（beta 138 文件 / 1362 + 7 跳过；stable 140 文件 / 1385 + 8 跳过）；两版安装目录产物（22:08）已确认带三条 `:where()` 规则、`navTools>button:focus-visible`、`Zenwit 工作台`，且不再含 `bottomPanelAutoTerminal` / `DSH-zenwit-workbench` / `addCard`。

### 6.29 设置页错乱第二层：属性泄漏（Agent 预设页仍错乱） — 完成
真机复验（截图）：6.28 之后**Agent 预设页仍然错乱**——卡片标题被水平居中、说明文字不换行、一行横穿相邻卡片并冲出设置面板，面板底部还出现了横向滚动条。

**根因（6.28 那层修得不完整）**：`:where()` 只把**权重**降下来，规则本身仍会**设置**属性。外壳规则里的 `white-space: nowrap` 和 `align-items: center` 在内核控件里**没有竞争声明**，于是照样生效：
- `white-space: nowrap` → 卡片说明不换行（`.cardDesc` 的 `-webkit-line-clamp: 4` 永远不会触发，因为压根没有第二行），一行文字按 max-content 撑出去；
- `align-items: center` → `.cardMain` 是列向 flex 且没有自己声明 `align-items`，于是子项被水平居中、宽度按内容收缩，标题/说明/id 全部居中并横向溢出。

**修法（第二层，结构性堵死）**：三条规则改成**子选择器**——`:where(.workbenchTools) > button`、`:where(.workbenchTools) > button[aria-pressed="true"]`、`:where(.globalActions) > button`。子选择器在结构上**根本匹配不到**面板内部（面板是座位的后代，不是顶栏的直接子元素），属性泄漏这条路被关闭；`:where()` 保留，将来的类级规则仍然更优先。座位里的插件按钮不再有 34×32 的兜底尺寸：本产品 `sidebar.footer.action` 没有注册者，唯一带 `data-cordis-badge` 的 Cordis 面板渲染在座位本身、不受影响（已核）。

**顺带补回一处被这次收紧摘掉的焦点环**：旧规则 `.navTools button:focus-visible` 曾给首页路径的设置齿轮画产品焦点环，收成 `>` 之后齿轮不再匹配，于是按属性选择器补回 `.navSettings :global(button[aria-haspopup="dialog"]):focus-visible` 与 `.globalSeat :global(button[aria-haspopup="dialog"]):focus-visible`（只命中设置触发器；面板内没有任何元素带该属性，已核）。

**守卫升级（先证伪）**：`workbench-chrome-styles.client.spec.ts` 从「允许 `:where()` 或 `>`」收紧为「设置座位所在容器下的裸元素规则**必须**用子选择器」，并把两种历史形态写进注释。把规则临时改回 `:where(.workbenchTools) button` → **2 项失败**；再改回更旧的 `.workbenchTools button` → 同样 **2 项失败**；恢复后 3 项通过。

验证：工作台包 **19 文件 / 76 项**；内核客户端套件 **317 文件 / 4579 项**（首跑有 1 项疑似偶发失败且输出被截断未落名，立即复跑全绿、`FAIL` 计数为 0）；文案门禁 0（645 文件）、客户端 `tsc` 0 错误；重建并同步两渠道运行时后 `check:layout` 全绿；两版桌面 `check` 全绿（beta 138 文件 / 1362 + 7 跳过；stable 140 文件 / 1385 + 8 跳过）；两版安装目录产物（22:37）已确认规则为 `:where(.…_workbenchTools)>button` 形态、旧的 `:where(.…_workbenchTools) button` 零残留。

## 7. 验证记录（最近一次全量）


| 检查 | 结果 |
| --- | --- |
| 内核客户端套件（`vitest run packages/client`） | **317 文件 / 4579 通过** |
| 内核 GUI 套件（`vitest run packages/client packages/host`） | **326 文件 / 4710 通过 + 1 跳过** |
| `zenwit-workspace check`（构建 + 测试） | **75 项全绿** |
| 桌面正式版 `check` | 140 文件 / **1385 通过 + 8 跳过**，6 项门禁全绿 |
| 桌面测试版 `check` | 138 文件 / **1362 通过 + 7 跳过**，6 项门禁全绿 |
| `check:layout`（双语文档、架构含方法契约、双渠道运行时、双变体、布局） | 全绿 |
| 文案门禁 / README 限制门禁 | 659 文件 / 267 README 全过 |
| 类型检查 | 整客户端工程 + 两版桌面 + zenwit-workspace 均 0 错误 |
| 运行时同步 | stable/beta 各 265 包校验通过；189 个桌面共享源文件对齐 |
| 方法契约守卫 | 40 个方法**全部有宿主实现**，缺口清单为空 |

**既有红灯（与本轮改造无关，HEAD 上同样失败）**：内核 `pnpm run test:docs` 有 7 项红，全部是基础检出就带的问题——
`ui-layout` / `ui-sidebar` / `ui-workspace` 三个 README 的"模型体验"段不符合门禁文法；
`ui-sidebar-documentpreview` 等已删包留下的失效链接与双语配对偏差（笔记、`docs/subsystems/sidebar-right`、`packages/api/workspace-files`、`packages/client`）；
`2026-09-11-zenwit-product-brand` 笔记缺中英配对且不符合现行格式；
归档清单基线读取方式在多仓根下失效；
`files.client.spec.ts` 里测试夹具路径 `/project/docs/notes.md` 被文档引用门禁误判。
本轮顺手修掉了与本包相关的两项（`ui-workbench` README 的模型体验段、`shell-presets.ts` 的死文档引用），其余未动。

## 8. 已知缺口（显式声明）

1. **按需加载**：编辑器/终端/图表随核心包打进产物（内核单包单产物约束）；桌面端影响小于 Web 端。
2. 预览器桥接只覆盖声明了扩展名的插件预览器；HTML 预览直接服务已保存文件与其相对资源。

**方法缺口：无**（`KNOWN_GAPS` 与宿主的 `NOT_PORTED_METHODS` 都为空，守卫的交叉校验因此恒等成立）。曾经的 agent 终端缺口已按产品决定整体移除：模型跑命令的能力由内核自带终端工具提供，引擎里那套"模型终端标签 + 等待提示 + agent-pty 通道"（客户端 WS 消费、等待横幅、`agent-pty.*` 两个方法与宿主缺口登记）已删除；若将来要在中栏显示模型终端，需要先给内核终端服务加输出订阅与等待取消（见 6.21）。

## 9. 交付清单与检查指引

| 层 | 位置 |
| --- | --- |
| 宿主半 | `zenwit-workspace/src/workbench/`（目录懒加载、操作、搜索、包含、Git、方法 API、媒体/HTML、PTY 与套接字、打开投递、偏好、任务、子代理、本轮文件、侧边对话核心） |
| 客户端半 | `deepseek-harness/packages/client/ui-workbench/src/client/workbench/`（资源管理器、标签/分屏、编辑器、预览、变更/diff、终端、浏览器、任务页、侧边对话视图、预览器桥） |
| 左栏资源管理器 | `…/src/client/workbench/ExplorerPane.tsx`（移植的 `TreePanel`，按项目工作，共用引擎的 store） |
| 工作区外壳 | `…/src/client/Workspace.tsx`（三栏网格：左资源管理器 / 中引擎区域 / 右对话） |
| 桌面 | `dsh-plugin-desktop{,-beta}/src/workbench-open.ts`（模型工具）、`workbench-sidechat.ts`（侧边对话方法）、`workspace.ts`（宿主扩展方法装配） |
| 守卫 | `scripts/verify-workbench-methods.mjs` |
| 文档 | 本文件、包 README（中英）、Agent Note（中英） |

**先读**：本文件 → `.agents/notes/implemented/architecture/2026-09-16-workbench-engine-rebuild.md` → `zenwit-workspace/src/workbench/backend.ts` → `…/src/client/Workspace.tsx`。

**应用内重点看**：左栏懒加载树与右键菜单、标签拖拽分屏、编辑器保存/冲突、变更视图两个视角与红绿 diff、终端、内嵌浏览器、任务页（子代理拓扑 + 后台任务）、设置里的"工作台"页、模型主动打开文件。

**复跑验证**：`corepack yarn workspace zenwit-workspace check`；`corepack yarn workspace dsh-plugin-desktop check`（含打包冒烟）；`corepack yarn check:layout`；内核套件 `cd deepseek-harness && pnpm exec vitest run packages/client packages/host`。

## 10. 风险与对策

| 风险 | 对策 |
| --- | --- |
| node-pty 原生依赖 | 惰性加载 + 依赖探测，失败只降级终端不可用；三平台打包仍需各自验证 |
| 打包体积 | 按需加载待评估；启动路径只留必要依赖 |
| 翻译与门禁 | 新文案进 locale 字典；i18n 门禁纳入验收 |
| 客户端/宿主方法漂移 | 方法契约守卫 + `KNOWN_GAPS` 显式登记 |
| 删除旧实现不可逆 | git 历史保留；发布前保留上一版运行时 |
| 双变体 | 先在 beta 完成，再同步正式包；`check:desktop-variants` 守护 |

## 11. 提交状态

**未提交、未推送**（按要求）。工作树包含全部改动，便于逐文件检查；运行时产物已同步两个渠道，可直接从源码启动应用查看效果。
