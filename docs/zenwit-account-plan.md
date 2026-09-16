# ZenwitAI 桌面端账号登录 · 实施规划

> 状态：**W1 / W2 / W3 已完成并部署生产**（镜像 `zenwit-new-api:v1.0.0-rc.25-deviceauth.3`）；W4 桌面端实施中
> 决策：设备授权轮询（RFC 8628 变体） · 确认页走 new-api React 路由 · **镜像在服务器上构建**（基线 tag `v1.0.0-rc.25`）

## 1. 目标

装完 Zenwit Desktop，点两次就能对话：**点「登录 ZenwitAI」→ 浏览器点「授权」→ 回应用即可用**。
全程不出现 API Key、baseURL、模型名；密码永不进入客户端。

### 非目标（本期明确不做）

- 不改现有 BYOK 路径（一个字都不动）
- 不做内嵌登录窗（留到 P2，作为无浏览器环境的兜底）
- 不做余额 / 用量 / 设备管理面板（P1）
- **不改 deepseek-harness 内核**
- 不改登录、注册、2FA、Passkey、邮箱验证、找回密码这些页面本身

## 2. 架构

```
①  桌面端点「登录 ZenwitAI」
      ├─ 生成 device_code（密钥，不出本机）+ code_verifier（PKCE）
      ├─ POST /api/user/device/start            → user_code, interval, expires_in
      └─ 打开系统浏览器 https://ai.zenwit.cn/device?code=<user_code>
              │
②  浏览器确认页（new-api React 路由，需登录）
      ├─ 未登录 → /sign-in?redirect=/device?code=...
      └─ 点「授权」→ POST /api/user/device/approve （UserAuth，SPA 自带 Bearer）
              │
③  页面显示「已授权，可以关闭此页面」
              │
④  桌面端每 interval 秒轮询 POST /api/user/device/poll
      └─ ← { status: "approved", key: "sk-...", token_id, base_url }
              │
⑤  写凭证 + 写 provider 配置 + 拉 /v1/models → 界面切到「已连接」
```

**device_code 是轮询密钥，永不进入 URL、日志或浏览器历史。** URL 上只放一次性的短 user_code。

## 3. 接口契约（冻结，实现前不再改）

### 3.1 POST /api/user/device/start — 无鉴权

```jsonc
// 请求
{ "code_challenge": "<base64url(sha256(verifier))>", "device_name": "MacBook Pro", "device_id": "a1b2c3d4" }
// 响应
{ "success": true, "data": {
    "user_code": "WXYZ-1234", "device_code": "<opaque 43 chars>",
    "verification_uri": "https://ai.zenwit.cn/device",
    "interval": 2, "expires_in": 600 } }
```

### 3.2 POST /api/user/device/approve — UserAuth（SPA 自带 Bearer）

```jsonc
// 请求
{ "user_code": "WXYZ-1234" }
// 响应
{ "success": true, "data": { "approved": true, "device_name": "MacBook Pro", "expires_at": 1789400000 } }
```

### 3.3 POST /api/user/device/poll — 无鉴权

```jsonc
// 请求
{ "device_code": "<opaque>", "code_verifier": "<base64url>" }
// 待授权
{ "success": true, "data": { "status": "pending" } }
// 已授权（仅返回一次，服务端同时标记 consumed）—— 注意：**不返回 base_url**
{ "success": true, "data": { "status": "approved", "key": "sk-...", "token_id": 12,
    "name": "ZenwitAI Desktop - MacBook Pro - a1b2c3d4",
    "user": { "username": "x", "display_name": "y" } } }
// 过期 / 已消费 / verifier 不匹配 → success:false + 明确 message
```

**限流（关键）**：start 与 poll **不能挂 `CriticalRateLimit`**（它只有 20 次/1200 秒，轮询 2 秒一次必然打爆）。
poll 用独立宽松限流（建议 120 次/分钟/IP），approve 沿用 `CriticalRateLimit`。

### 3.4 铸造的令牌

| 字段 | 值 |
|---|---|
| name | `ZenwitAI Desktop · <device_name> · <device_id>` |
| group | `default` |
| unlimited_quota | true |
| expired_time | -1（永不过期；吊销由用户在控制台做） |
| 幂等 | 同名令牌已存在 → **删除旧的、创建新的**（重登录 = 换钥匙，不留垃圾） |

### 3.5 桌面端内部路由

| 路由 | 方法 | 返回 |
|---|---|---|
| `/_dsh/desktop/account/status` | GET | `{state:'signed-out'\|'signing-in'\|'signed-in', user?, device?, user_code?, verification_uri?, error?}` |
| `/_dsh/desktop/account/sign-in` | POST | 立即返回 `{state:'signing-in', user_code, verification_uri}`，后台开始轮询 |
| `/_dsh/desktop/account/cancel` | POST | 取消进行中的登录 |
| `/_dsh/desktop/account/sign-out` | POST | 清除凭证 + 撤销令牌 + 移除 provider |

### 3.6 本地落盘

| 内容 | 位置 |
|---|---|
| 中继令牌 | `ctx.credentials` → ref `ZENWIT_GATEWAY_KEY`（`.credentials.yaml`，0600） |
| provider 配置 | `settings.yaml` → `llm-pi-ai.providers.zenai = { apiKeyEnv, baseURL, api, models }` |

> 🔴 **`baseURL` 必须含 `/v1`：`https://api.zenwit.cn/v1`**
> OpenAI 兼容适配器是把操作路径**原样拼在 baseURL 后面**的（`${baseURL}/chat/completions`），
> 所以版本前缀属于 baseURL。写成裸 origin 会打到控制台的 SPA 兜底路由，
> 拿回一段 HTML —— 流式读取器只会报 `Stream ended without finish_reason`，
> **看不出是路径错了**，极难排查。
>
> 修复方式（已落地）：`gateway-auth.ts` 只保留一个 `GATEWAY_API_BASE` 常量，
> `GATEWAY_MODELS_URL` 与 provider 的 `baseURL` 都从它派生 ——
> 结构上杜绝两个调用点再次拼法不一致。
| 账号元信息（**不含密钥**） | `<userData>/identity/gateway-account.json` |

> ⚠️ **本节原稿有一条被实施证伪的契约**：原稿写"拉不到模型时回退成空模型列表，不要让登录失败"。
> 这是错的 —— `llm-pi-ai` 对 settings 写入做严格校验（`resolveRouteModels(..., 'strict')`），
> 而 `zenai` 不在内置目录里，`models: []` 会抛 `PiAiCatalogError`。
> **照原稿写，登录必然失败** —— 正好是原稿想避免的结果。
> 另外该路由还必须声明 `api`（内核要求，非内置路由必须有）。
>
> 实际做法：**登录仍然完成**（凭证与账号元信息落盘），**非法 profile 永不写入**，
> 状态上报 `provider: 'degraded'` + `error: 'provider-unavailable'`，
> 读取状态时触发一个 30 秒限流的后台对账自愈，界面上另给一个「重试模型配置」按钮。
> 重试路径**只读凭证**，绝不写或清除它。

## 4. 工作分解

### W1 · new-api 后端（约 200 行）

| 文件 | 改动 |
|---|---|
| `model/auth_flow.go` | 新增 `PurposeDeviceLogin` 常量（**无需 DB 迁移**：`purpose` 是 varchar，无枚举约束） |
| `controller/device_auth.go` | 新建。3 个 handler；复用 `CreateAuthFlow` / 消费逻辑与 `controller/token.go` 的令牌创建 |
| `router/api-router.go` | 新增 3 条路由 + poll 的独立宽松限流中间件 |
| `middleware/rate-limit.go` | 新增一个 device-poll 限流器（或复用现有宽松档） |

**验收**：`go build ./...` 通过；Go 单测覆盖 start→approve→poll 全链路与三类失败（过期 / 重复消费 / verifier 不匹配）。

### W2 · new-api 前端（约 100 行）

| 文件 | 改动 |
|---|---|
| `web/src/routes/device.tsx` | 新建公开路由。读 `?code=`；未登录跳 sign-in；调用 approve；渲染确认卡片 |
| `web/src/features/device/*` | 确认卡片组件（走站点既有样式与 i18n） |
| 路由注册 | 加到公开路由区（不是 `_authenticated` 也不是 `(auth)`） |

**验收**：未登录 → 跳登录 → 回跳 → 授权成功；已登录 → 一步到位；无效 code → 明确报错页。

### W3 · 镜像与部署（在服务器上构建）

#### 前置：源码基线必须可证明

线上跑的是 `calciumion/new-api:latest`，构建于 **2026-08-18 18:57:25 +0800**，自报版本 **v1.0.0-rc.25**。
本地仓库的 tag `v1.0.0-rc.25` 指向 `f1164142`（2026-08-18 18:24:43 +0800），比镜像早 33 分钟。
本地 HEAD 只比该 tag 多一个 `docs: improve CLAUDE.md`（仅 1 个文档文件，**零代码差异**）。

**线上行为已验证一致**：`POST /api/user/passkey/login/begin` → 200（本地源码里存在）；
`POST /api/user/device/start` → 404（要加的路由尚不存在）。

**因此**：从 tag `v1.0.0-rc.25` 拉分支 `feat/device-auth`，改动全部落在该分支，tag 保持纯净。

> ⚠️ 服务器 `/opt/QAPI` 那份源码树**没有 `.git`**，无法证明对应哪个 commit —— **不要基于它构建**。

#### 步骤

1. **加 2 GB swap**。该机当前 swap 为 0；Go 编译与 bun 打包并发时有 OOM 风险，而 OOM 会先打死生产容器
2. rsync 本地仓库到服务器独立构建目录（排除 `.git` `node_modules` `web/node_modules`），不污染 `/opt/QAPI`
3. **写 `VERSION`**：`echo "v1.0.0-rc.25-deviceauth.1" > VERSION`
   （Dockerfile 用 `-X common.Version=$(cat VERSION)` 注入；服务器那份 `VERSION` 是 0 字节，不写则版本号为空）
4. `docker build -t zenwit-new-api:v1.0.0-rc.25-deviceauth.1 .`
   （构建链：bun 打包前端 → golang 1.26.1-alpine 编译 → debian bookworm-slim 运行；基镜像按 digest 钉死）
5. **冒烟实例**：独立 compose + 端口 3001 + 独立库 `new-api-test` + 独立 redis db。
   在空库上跑完整链路：`/api/user/register` 建测试用户 → 登录拿 JWT → start → approve → poll →
   用返回的 `sk-` 打 `/v1/models`。**全程不碰生产数据**
6. 冒烟通过 → 改生产 compose 的 image tag → `docker compose up -d`
7. **保留 `calciumion/new-api:latest` 镜像**（回滚即改回 tag）

**验收**：冒烟实例上完整设备授权链路走通并拿到可用的 `sk-`；生产切换后 `/api/status` 正常、无 5xx、容器 healthy，原 BYOK 与登录页不受影响。

### W4 · 桌面端（5 个新文件 + 2 处改动）

| 文件 | 职责 |
|---|---|
| `dsh-plugin-desktop-beta/src/gateway-auth.ts` | 设备授权协议：PKCE 生成 → start → 轮询 → 结果。跑在 **Host 侧**（utility process），因为设备端点是普通 HTTPS，Node 侧没有 CORS 约束。照抄 `update-checker.ts` 的 fetch 范式（注入 request 与时钟、响应体限长） |
| `dsh-plugin-desktop-beta/src/account-contract.ts` | 路由常量 + 请求/响应类型 |
| `dsh-plugin-desktop-beta/src/account-controller.ts` | 写 `ctx.credentials` 与 provider 配置；状态机 |
| `dsh-plugin-desktop-beta/src/account-route.ts` | `/_dsh/desktop/account/*`，沿用 `desktop-settings-route.ts` 的回环同源守卫 |
| `dsh-plugin-desktop-beta/src/client/AccountSection.tsx` | 设置 → 账号页（注册进已有的 `settings.section`） |
| `src/host-rpc.ts` + `src/main.ts`（改） | **1 个**消息：请主进程用 `shell.openExternal` 打开授权页。HTTP 与轮询全在 Host，主进程不参与协议 |
| `src/index.ts`（改） | 注册路由 |

> **与初稿的差异**：初稿打算用 Electron `BrowserWindow` 内嵌登录页。实施时改为**系统浏览器 + 轮询**，
> 因为设备授权端点来自 Host 侧的普通 HTTP 请求，不需要任何浏览器上下文，
> 于是主进程只需要"打开一个 URL"这一件事，实现面小得多，也不需要在本地回环服务器上给外部来源开口子。

**约束**：
- 文案**必须**走 locale 字典（`verify-client-ui-i18n` 门禁）
- 主进程新增模块要有单测（照 `update-checker` 的注入式测试）
- 改完 beta → **同步到 `dsh-plugin-desktop/`** → `corepack yarn check:desktop-variants`
- 登录**不进 onboarding**（避免挡住 BYOK 步骤），只出现在设置页

**验收**：`corepack yarn check` 通过；两通道变体检查通过。

### W5 · 端到端验证

| # | 场景 | 结果 | 证据 |
|---|---|---|---|
| 1 | 全新安装 → 登录 ≤5 秒 | ⏳ **未验** | 需要打包后的应用 + 人在浏览器点一次「授权」，无法无人化 |
| 2 | 真调一次 `deepseek-v4-flash` | ⚠️ **部分** | 设备密钥调 `/v1/chat/completions` 返回 **503 `model_not_found`（No available channel）而不是 401** → **令牌认证这一层是通的**，卡在渠道层。生产上渠道存在但上游 key 无效（已知且你暂缓的问题） |
| 3 | 控制台查看令牌 | ✅ **已验** | 实链路测试：控制台恰好列出 **1 个** `ZenwitAI Desktop - Live Verification Mac - live0001` |
| 4 | 吊销后立即失效 | ✅ **已验** | 实链路测试：控制台 `DELETE /api/token/:id` 之后，同一密钥打 `/v1/models` → **401** |
| 5 | 再次登录替换而非堆积 | ✅ **已验** | 实链路测试 + 单测：旧密钥 401、新密钥 200、同名令牌只剩 1 个 |
| 6 | 登出清除凭证 | ✅ **已验（单测）** | `account-controller.spec.ts` 覆盖 `sign-out` 清凭证 / 移 provider / 回未登录 |
| 7 | 拒绝授权 / 过期超时 | ✅ **已验（单测）** | `gateway-auth.spec.ts` 覆盖 pending→approved、错 verifier、10 分钟超时、取消、畸形响应 |
| 8 | **回归：BYOK 路径** | ✅ **已验** | 桌面端全量套件 1334 passed（beta）/ 1357 passed（stable）；**内核 `deepseek-harness/` 零改动** |

### W5 实链路测试（最能说明问题的一项）

用**真实发布的桌面端代码**跑**真实 HTTP** 打一个隔离的 new-api 实例（只把硬编码的 URL 重写到实例，
并补上生产边缘会发的 `X-Forwarded-*` 头）。三个场景 **3/3 通过**：

1. 完整仪式：start → pending 轮询 → approve → poll 拿到密钥 → 密钥打 `/v1/models` 200 / 伪造密钥 401 → `discoverGatewayModels` → 控制台只有 1 个令牌 → 吊销后 401
2. 二次登录替换：旧密钥 401、新密钥 200、只剩 1 个令牌
3. 模型调用：503 `model_not_found`（渠道层），**不是 401**

> 这轮还顺带验证了桌面端的一条**安全控制**：把服务端返回的 `verification_uri` 换成非控制台域名时，
> 客户端会抛 `gateway response is malformed: verification_uri is outside the console origin` 并拒绝登录 ——
> 防止被篡改的网关把用户重定向到钓鱼页。这是它第一次被真实触发。

### 仍未验的两项，以及为什么

- **#1 真机登录**：需要打包 Electron 应用 + 真人在浏览器点「授权」。我无法无人化完成。
- **#2 流式返回**：被上游 DeepSeek 渠道 key 无效挡住（你此前明确说先不弄）。**认证层已验证通过**。

## 5. 风险与对策

| 风险 | 对策 |
|---|---|
| **poll 被 CriticalRateLimit 打爆**（20 次/20 分钟） | 已在契约里单列：poll 用独立宽松限流，实现时必须验证 |
| 首次镜像构建踩坑（Go 版本 / pnpm / 前端产物） | 先在测试实例上完整跑通，不碰生产 |
| `auth_flows` 的 `purpose` 是需要迁移的枚举 | 已确认是 varchar + 普通索引，**无迁移**；实现时再核一次 |
| 用户取消授权后 `auth_flows` 残留行 | 有 `expires_at`，让 TTL 自然回收；不额外写清理任务 |
| 主进程 fetch 走不走代理 | 内核 `packages/util/http-proxy` 装的是全局 dispatcher，主进程 `fetch` 会继承；实机验证一次 |
| 令牌创建触发 `CriticalRateLimit` 的连带影响 | 令牌创建发生在 poll 内部（服务端），不受匿名限流影响；确认 walk-through |

## 6. 回滚

| 层 | 回滚动作 | 代价 |
|---|---|---|
| 镜像 | compose 改回 `calciumion/new-api:latest` + `up -d`（该镜像保留在服务器） | 秒级 |
| 数据库 | **无 schema 变更**，只多出 `auth_flows` 行与 `tokens` 行 | 不需要回滚 |
| 前端 | 随镜像一起回滚 | 同上 |
| 桌面端 | 新增文件，不打包即不存在 | 无 |

## 7. 顺序

```
W1 后端 ──┬─→ W3 镜像冒烟 ──→ W2 前端 ──→ W3 生产部署 ──→ W5 端到端
          │
          └─→ W4 桌面端（对着契约并行开发，用 mock 端点跑通轮询）
```

W1 的契约冻结后，W2 与 W4 可以并行。

---

## 8. 实施结果（W1–W3 已完成，2026-09-15）

### 分支与提交

分支 `feat/device-auth`，从 tag `v1.0.0-rc.25` 拉出。三个提交，**全是加法**：

| 提交 | 内容 |
|---|---|
| `c78f1fd8` | feat(api): 设备授权端点（+830 行，0 删除） |
| `121d9abb` | feat(web): /device 确认页（+329 行） |
| `0e6e4534` | fix(api): 通过令牌缓存退役旧设备密钥 |

### 后端（W1）

| 文件 | 改动 |
|---|---|
| `controller/device_auth.go` | 新增 382 行 |
| `controller/device_auth_test.go` | 新增 368 行 |
| `model/auth_flow.go` | +51：复用一次性仪式存储，新增按 intent 查找与带抢占保护的批准 |
| `model/token.go` | +27：`DeleteTokensByUserAndName` |
| `middleware/rate-limit.go` | +15：独立于 CriticalRateLimit 的轮询限流 |
| `common/constants.go` | +8：限流参数 |
| `router/api-router.go` | +6：三条路由 |

**验证**：`go build ./...` 通过；`go vet` 干净；controller / model / middleware / router 四个包测试全绿。

### 前端（W2）

| 文件 | 改动 |
|---|---|
| `web/src/routes/device.tsx` | 公开路由；未登录跳 sign-in 并带 code 回跳 |
| `web/src/features/device/{index.tsx,api.ts,types.ts}` | 确认卡片 |
| `web/src/i18n/locales/zh.json` | +11 条中文文案 |
| `web/src/routeTree.gen.ts` | 构建时由 tanstack router 插件自动重新生成 |

**验证**：`bun run typecheck` 通过；`bun run build` 成功。

### 构建与部署（W3）

- **构建前先加 2 GB swap**：该机 swap 原本为 0，Go 编译与 bun 打包并发有 OOM 风险，而 OOM 会先打死生产容器
- **Dockerfile 增加 GOPROXY build arg**（默认 `https://goproxy.cn,direct`）：服务器上 `proxy.golang.org` 完全不可达（实测 000），`go mod download` 会无限期挂起。默认值指向公共镜像源，仍可 `--build-arg` 覆盖回上游
- 构建目录 `/opt/qapi-build`，**独立于 `/opt/QAPI` 那份没有 `.git`、无法证明来源的旧快照**
- **冒烟实例**：容器 `new-api-test`，端口 3001，独立库 `new-api-test`，redis db 1 —— 全程不碰生产数据

### 冒烟测试抓到并修复的真 bug

第一次冒烟：**重新登录后旧密钥仍然可用（200）**。

根因：`GetTokenByKey` 先查 Redis 缓存，而替换设备令牌用的是裸软删除，绕过了
`invalidateTokenCacheForMutation`（该函数必须在写库**之前**调用：抬 10 秒 fence + 删除缓存哈希）。
**没有 Redis 时不会复现** —— 单元测试全绿，只有开 Redis 的真实实例才暴露。

修复：`DeleteTokensByUserAndName` 先失效缓存再软删除。修复后 **25 项冒烟全过**。

> 值得记住的一条：**单元测试覆盖不到缓存影子路径，必须有一遍开 Redis 的真实链路验证。**

### 生产部署

| 项 | 值 |
|---|---|
| 镜像 | `zenwit-new-api:v1.0.0-rc.25-deviceauth.3`（300 MB） |
| 切换 | `docker compose up -d`，31 秒后 healthy |
| 自报版本 | `v1.0.0-rc.25-deviceauth.3` |
| compose 备份 | `/opt/backups/zenai/config/docker-compose.yml.before-deviceauth-20260915-012450` |
| 回滚镜像 | `calciumion/new-api:latest` 仍在本地 |
| 部署后验证 | **19 项全过**：新路由存在、PKCE 生效、未批准轮询返回 pending、品牌 / 备案 / Logo / 法律文档 / 首页配图 / 注册开关 / Turnstile / Passkey 全部未受影响、`/device` 与 `/sign-in` 都返回 SPA |
| 前端嵌入 | 确认 `/device` 的页面文案与路由注册都在线上 JS bundle 里 |

### 数据库影响

**无 schema 变更。** `auth_flows.purpose` 是 `varchar(32)` + 普通索引，不是数据库枚举，
新增 `device_login` 取值不需要迁移 —— 这也是回滚不需要回滚数据的原因。

### 生产上留下的痕迹

部署验证时开过一次真实的授权仪式（`device_name = "Deploy Verification"`）。
它**只创建了一行 `auth_flows` 记录，10 分钟后自然过期**，没有铸造任何令牌、没有碰任何用户数据。

---

## 9. 首次真机登录暴露的缺陷与修复（2026-09-15 15:1x）

### 症状

用户用 @wangyixiao 登录**成功**，但一对话就报：

```
● 本轮运行失败   Stream ended without finish_reason        TRANSPORT
已重试模型请求 (5/5) · 8s
```

### 排查（不改一行代码就能定位）

| 步骤 | 证据 |
|---|---|
| 登录是否成功 | `zenwit/identity/gateway-account.json` 里 user=wangyixiao、token id=13、`provider.ready=true` → **完全成功** |
| 配置是否写对 | 应用 home 的 `settings.yaml`：provider `zenai`、默认模型 `deepseek-v4-pro`、凭证 ref 齐全 → **都对** |
| 网关有没有收到 | `logs` 表里该用户**一条消费记录都没有** → 请求**根本没进中继** |
| 请求打到哪了 | nginx 访问日志：`POST /chat/completions` → **200 `text/html` 1166B**（SPA 兜底页），<br>时间戳 15:11:13/14/15/18/22/31 与「重试 5/5 · 8s」完全吻合 |
| 路径对比 | `/chat/completions` → 200 `text/html`；`/v1/chat/completions` → 401 `application/json` + `X-New-Api-Version` 头 |

### 根因

**provider 的 `baseURL` 少了 `/v1`。**

OpenAI 兼容适配器是把操作路径**原样拼在 baseURL 后面**的，所以 `baseURL = https://api.zenwit.cn`
产生的是 `https://api.zenwit.cn/chat/completions` —— 少了版本前缀，落到控制台的 SPA 兜底路由，
返回一段 HTML。流式读取器把 HTML 当 SSE 解析，读不出 `finish_reason`，
于是报 `Stream ended without finish_reason` —— **这个报错完全指不出真正的原因**。

为什么"发现模型"却成功了：`GATEWAY_MODELS_URL` 自己硬编码拼了 `/v1/models`，
而 provider 的 `baseURL` 没拼 —— **同一份配置里两套拼法**。

### 修复（结构性，不是打补丁）

`gateway-auth.ts` 里只保留**一个**源头常量：

```ts
export const GATEWAY_API_ORIGIN = 'https://api.zenwit.cn'
export const GATEWAY_API_BASE = GATEWAY_API_ORIGIN + '/v1'   // 唯一事实来源
export const GATEWAY_MODELS_URL = GATEWAY_API_BASE + '/models'
```

provider 的 `baseURL` 与账号元信息 / 状态投影的 `base_url` 全部改用 `GATEWAY_API_BASE`。
现在 `GATEWAY_API_ORIGIN` **只在 `gateway-auth.ts` 出现**，
两个调用点在结构上不可能再对前缀有分歧。

**验证**（两个通道各跑一遍）：typecheck 干净；新增 25 项测试通过；
全量 beta **1334 passed** / stable **1357 passed**；`check:desktop-variants` **184 文件对齐**。

### 端到端复验（用真实设备令牌、按修复后的配置）

```
app will call : https://api.zenwit.cn/v1/chat/completions
non-streaming : 200 json   finish_reason=length   usage=53
streaming     : 200 text/event-stream   26 SSE chunks   finish_reason=length
```

流式那一行是关键 —— 它正是之前失败的模式，现在能拿到完整的 `finish_reason`。

### 教训

**验过"令牌能认证"不等于验过"请求路径对"。** 我在 W5 里验了 `/v1/models` 与令牌认证，
也验了隔离实例上的 `/v1/chat/completions` 返回 503（说明到了渠道层），
但**生产上的真实路径从没端到端跑过一次**。发现模型走一条 URL、模型调用走另一条 URL，
这个不一致在联调时看起来一切正常，直到真的对话才暴露。

**规则**：凡是"从一个 base 拼出多个端点"的配置，只能有一个源头常量；
发现路径与调用路径必须由同一个常量派生。



## 10. 首页一级入口、设备只读接口、插件市场入口（2026-09-15 16:xx）

### 需求（用户标注截图）

首页顶栏按 `首页 · 项目库 · 插件市场 · 个人中心`，并在右侧工具栏最前面加 `设置`；
另外要一个「个人中心」页面，且必须在首页就能进得去。

### 现状根因

`ui-workbench` 的 `HomePage.tsx` **一个插槽都不渲染**，顶栏只硬编码了「首页 / 项目库」两个按钮；
`sidebar.panellist`（插件页面）与 `sidebar.settings`（设置）只在 `Workspace.tsx` 的侧边栏里渲染。
于是**没打开项目时，首页既到不了插件市场，也到不了设置**。
发版产物（vendor 里的 ui-workbench tarball）grep `插件市场` / `个人中心` 均为 **0 命中**。

### 一、内核改动（deepseek-harness/packages/client/ui-workbench）

- `HomePage.tsx`：新增 `panels` / `activePanel` / `selectPanel` / `renderSlot` 四个 props；
  左栏 = `首页 · 项目库 · 全部 sidebar.panellist 注册项`；右侧工具栏最前面渲染 `sidebar.settings`（`{ wide: false }`）；
  选中面板时首页主体换成该 `main` keyed 页面。
- `WorkbenchFrame.tsx`：面板宿主从「整页隐藏」改为由首页主体承载；打开项目前先 `selectPanel(null)`。
- 内核**不写死任何产品名** —— 插件市场、个人中心都只是注册 `sidebar.panellist` + `main` 的普通贡献者。
- 文档：ui-workbench README 中英 + 新 Agent Note `2026-09-15-home-surface-panel-navigation.md`（中英 + sidecar），
  并在 `2026-09-08-global-main-panels` 里加了交叉链接。
- **重建整套内核运行时**（265 个 tarball）→ 同步进 `vendor/dsh-runtime/0.1.5-rc.1/` → `yarn install`。

验证：ui-workbench **123 passed**；`tsc -b` 干净；`check:layout` 全绿（`verify-desktop-variants` 184 文件对齐）；
`sync-vendored-runtime --check` stable/beta 双通道通过；13 个 `patches/dsh-*` 逐个用 `patch --dry-run` 验证**仍可干净应用**。

### 二、服务端：设备只读接口

设备授权只签发 `/v1` 用的 relay token，`/api/user/self` 那类接口要会话，所以桌面端读不到自己的额度与用量。
新增 `controller/device_account.go` + 两条路由：

| 接口 | 鉴权 | 返回 |
|---|---|---|
| `GET /api/user/device/overview` | `middleware.TokenAuthReadOnly()`（relay token） | 余额 / 累计已用 / 今日消耗 / 本月消耗 / 账号信息 |
| `GET /api/user/device/logs` | 同上 | 本人消费明细分页（时间窗 + 模型过滤） |

两个窗口**只报额度**：`model.SumUsedQuota` 的 `rpm/tpm` 只统计**最近 60 秒**（源码 `model/log.go:658`），
放进「今日 / 本月」卡片会撒谎，所以不暴露。

验证：`gofmt` / `go vet` 干净、`go build ./...` 通过、`go test ./controller/` 全绿
（新增 3 例：只统计本人 / 只统计消费类型 / 缺密钥与禁用密钥一律 401）。
部署：镜像 `zenwit-new-api:v1.0.0-rc.25-deviceaccount.1`，compose 已先备份；
生产实测容器 **healthy / restarts=0**，两个新接口无凭据 **401**（说明路由存在），`device/start` 仍 **200**。

### 三、插件市场首页入口

`dsh-community-market` 注册 `sidebar.panellist`(id `community-market`, order 10) + `main`(key `community-market`)，
新增 `MarketPanel.tsx` 复用既有 `MarketSurface`（保留原来的侧边栏启动器与浮层不动）。

验证：market **150 passed**（含更新后的 `client-index.spec.ts`）、两个 tsconfig typecheck 干净、
包构建 + `verify-package-exports` + `verify-market-docs` + `verify-client-loader` 全部通过。

### 纪律

- 内核改动 → 必须重建 vendor 运行时，**两个 channel 都要同步**，随后跑 `check:layout`。
- 补丁对账**不能用 `git apply --check` 判定**：它会因 hunk 行数校验拒绝本可应用的补丁；
  要用 `patch -p1 --dry-run --forward`。
- 以后首页新增任何「一级页面」只需注册 `sidebar.panellist` + `main`，不必再动内核。

## 11. 个人中心页面 + 真机走查（2026-09-15 17:0x）

### 交付

两个 channel 各一份、共享文件逐字节一致（`verify-desktop-variants`：**187 个 src 文件对齐**）。

| 层 | 文件 | 职责 |
|---|---|---|
| Host | `src/account-contract.ts` | 两条新路径 + `credential-rejected` + overview/usage 类型 |
| Host | `src/account-controller.ts` | `overview()` / `usage(query)`；读本机 relay key，`Authorization: Bearer sk-…`；401/403→`credential-rejected`、超限/结构不符→`gateway-malformed`、其他→`gateway-unreachable`；**key 永不进日志或错误文本** |
| Host | `src/account-route.ts` | 两个同源 loopback GET；page/page_size 有界（默认 20、上限 50/1000），越界 400 且不触达上游 |
| 渲染 | `src/client/AccountCenter.tsx`（新） | 面板 + 导航图标；`main` 的 key 与 `sidebar.panellist` 的 id 共用 `DESKTOP_ACCOUNT_PANEL_ID` |
| 渲染 | `src/client/account-error-copy.ts`（新） | 错误码→文案键的唯一映射，`AccountSection.tsx` 改为共用 |
| 渲染 | `src/client/account-center-styles.ts`（新） | 面板样式 |

金额口径：`元 = quota / 500000`（Price=1，1 个内部单位 = 1 元）。充值入口走系统浏览器打开 `https://ai.zenwit.cn/wallet`（支付通道本身仍未接入，只做入口）。

### 独立复验（我自己重跑的四个门禁）

| 命令 | 结果 |
|---|---|
| `corepack yarn check:desktop-variants` | **187 文件对齐** |
| `corepack yarn typecheck` | 干净 |
| `corepack yarn workspace dsh-plugin-desktop-beta run test` | **137 files / 1346 passed, 7 skipped** |
| `corepack yarn workspace dsh-plugin-desktop run test` | **139 files / 1369 passed, 8 skipped** |

### 真机走查（隔离实例 + CDP，未动你正在用的那个应用）

用 `--user-data-dir=/tmp/zenwit-verify --remote-debugging-port=9333` 另起一个实例，
再用 Node 内置 `WebSocket` 直连 CDP 驱动它 —— **不需要屏幕录制权限**，也绕开了 `screencapture` 的
`could not create image from display`。

实测结果（真实渲染，不是单测）：

```
首页 nav      : ["首页","项目库","插件市场","个人中心"]   设置座位 aria-label = "设置"
点 个人中心   : 个人中心*  → 面板渲染「个人中心 / 查看账号信息、额度与最近用量。/ 未登录 / 登录 ZenwitAI」
点 插件市场   : 插件市场*  → 面板内联渲染真实目录（当前来源 Zenwit / QNovel Mochi / 安装）
点 首页       : 首页*      → 回到项目首页
```

### 两个被证伪的"阻塞"

1. 子代理报告"服务端接口仍是 404、未部署"——**不成立**。实测两个 origin 对
   `/api/user/device/overview` 与 `/logs` 都返回 **401**（路由存在、缺凭据），
   而 `GET /api/user/device/start` 返回 404 是因为它**只接受 POST**（探针用错了动词）。
2. `ai.zenwit.cn` 与 `api.zenwit.cn` 对这两条路径行为完全一致，选择前者（与 `start`/`poll` 同源）是对的。

### 还差什么

- **你的应用需要重启一次**才会加载新界面（你现在开着的那个实例是 15:31 启动的旧构建）。
- 额度 / 用量卡片的**已登录态**只能在你的真实账号下复验（隔离实例没有账号）。

## 12. 设备令牌被「同名替换」顶掉：根因与彻底修复（2026-09-16）

### 事故

个人中心显示「暂时无法读取额度信息 / 用量记录」，但账号卡仍是「已连接」。
真相：app 里存的那枚 relay 令牌**已被软删除**（401 `Invalid token`），而 `status()` 只读本地文件、
从不校验凭据，所以它继续报「已连接」，只有两张读接口的卡报错。

### 令牌为什么会没

`createDeviceRelayToken` 是「**同名即删**」：先 `DeleteTokensByUserAndName(user, name)` 再插新的。
而 `name` 里的设备身份来自 `installation-id` —— **一个会随 userData 一起被复制的文件**。
2026-09-15 17:41 / 17:44 / 18:03 我为真机走查起的三个隔离实例各复制了一份 profile，
因此拿到**同一个设备身份**：每登一次就顶掉真机那一枚。`tokens` 表里同名 6 代只剩 1 枚活着（id 18），
而 app 手里是早已删掉的 id 15。

### 修复

**服务端**（new-api，commit `dfb2c094`）：
- `tokens` 新增 `device_id` 列（纯新增，AutoMigrate 自动建）。
- `DeleteDeviceTokens(user_id, device_id)` 取代按名删除：**只删这一份安装自己的上一枚**；
  `device_id` 为空（控制台令牌、升级前的旧令牌）时**什么都不删**。
- `TokenAuthReadOnly` 对「令牌不存在 / 已禁用」返回机器可读 code（`token_revoked` / `token_disabled`），
  与「没带令牌」`token_missing` 区分。

**客户端**（两个 channel）：
- 设备身份改为 `sha256(realpath(userData) + "\n" + installation-id)` 前 16 位 ——
  **副本因为路径不同而得到不同身份**，从此不可能顶掉真机。
- `status()` 增加 `credential: 'valid' | 'unknown' | 'rejected'`，由 overview/usage 的结果维护；
  凭证被拒时 `provider` 强制降级为 `degraded`，并**跳过 provider 对账**（不再把死钥匙写回 profile）。
- 面板：状态胶囊显示「登录已失效」，顶部横幅说明原因 + **一键「重新登录」**（不必先退出登录）；
  两张卡改显示「等待重新登录」，不再糊弄成「暂时无法读取」。
- 日志节流：一次失效只记一条（之前每几秒一条）。

### 验证

- Go：`TestDeviceSignInKeepsAnotherInstallationsCredential`（两次不同 device_id 走完整 ceremony：
  第一枚**仍然有效**；同 device_id 再登只顶掉自己）、`TestDeleteDeviceTokensIgnoresUnidentifiedCredentials`。
- TS：`desktopDeviceIdentity` 稳定性/区分性；`revoked device credential`（401 → `credential: rejected` + `provider: degraded`）。
- 身份实算：隔离实例 A `/tmp/zenwit-a` → `9ff6fd7612c72de2`；用户真机 → `c485f2a80f5ec9ea`（**不同**）。
- 真机（隔离实例 + CDP）：
  - A 登录后新建令牌 id 19，**上一枚 id 18 仍然存活** —— 两份安装不再互相顶掉；
  - 未交互的实例 B **不产生任何 ceremony**（排除「应用会自动重登」）；
  - 保留吊销凭据的实例截图 = 横幅 + 「登录已失效」+ 两张卡「等待重新登录」。
- 门禁：beta **1348** / stable **1371** passed，`check:desktop-variants` 187 文件对齐，typecheck 干净。
- 部署：镜像 `zenwit-new-api:v1.0.0-rc.25-deviceaccount.2`，容器 healthy。

### 遗留（待决定）

- `tokens` 里还有两枚**没人使用但仍活着**的设备令牌：id 18（事故前 app 用的那枚）与 id 19（我走查时建的）。
  两者都是不限额度、永不过期的 relay key；要清就软删它们（不影响任何在用客户端）。
## 13. 顶栏右侧两个图标位、删掉侧栏底部重复入口（2026-09-16）

### 需求（来自标注截图）

- 侧栏底部的**「插件市场」重复入口**：删掉，顶部导航已经有了。
- 侧栏底部的**「设置」与「Cordis Plugin 0 running」**：移到右上角，做成两个图标。
- 底部那两行**整行不保留**。

### 改动

**内核 ui-workbench**：

- WorkbenchFrame（工作区工具行）与 WorkbenchTopBar（首页 / 项目库工具行）都在右侧渲染两个全局座位
  sidebar.settings 与 sidebar.footer.action（都传 wide: false），位置紧邻提醒铃铛左边；首页自己的工具簇排在这两个图标之前。
- Workspace 不再渲染侧栏底部（workspaceFooterActions / workspaceSettings / workspacePluginActions 及对应 CSS 一并删除），
  工作区侧栏现在只剩项目文件树。

**内核 ui-cordis**：

- 面板触发按钮不再假设自己位于页脚：触发按钮上方不足面板自身的 60vh 时，固定定位的面板改为在**下方**展开。

**插件市场 dsh-community-market**：

- 删除重复的 sidebar.footer.action 启动器与 shell.overlay 浮层，连同 market-view-store、MarketLauncher、MarketOverlay 与它们的样式；
  市场只保留一级面板（main 键）+ 设置里的标签页。

### 验证

| 门禁 | 结果 |
|---|---|
| 内核 ui-workbench + ui-cordis 客户端测试 | **145 passed** |
| 市场 vitest run | **17 files / 137 passed** |
| 市场 typecheck / check | 干净 |
| 内核 release:pack --family dsh | **265 tarball** |
| sync-vendored-runtime --write（stable + beta） | 已同步 |
| corepack yarn check:layout | 通过 |
| 内核 test:docs（Agent Note 格式、文档预算、双语配对） | 通过 |

### 遗留

- **视觉复验留给你**：按你的要求我没有再自己起进程。重启应用后请看右上角是否只剩两个图标、侧栏底部是否已经干净。

