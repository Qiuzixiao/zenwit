# Zenwit 插件市场

这个 Desktop 自有包提供 Zenwit 插件市场，只读取
https://plugins.zenwit.cn/v1/plugins。公开目录说明位于
https://plugins.zenwit.cn/v1/catalog-source.json。

市场提供发现、可安装、已安装三个视图。搜索、分类筛选、分页、详情和安装预览复用
现有 Desktop UI 与 Host 服务。不提供来源选择或自定义源 API。旧来源记录会被忽略；
旧缓存无法匹配固定 Zenwit 来源身份。已移除的来源修改接口返回 HTTP 410。

`qnovel-plugins-api` 管理目录元数据和上下架；`qnovel-plugins` 保存插件源码；
npm 提供已发布安装包。安装会向 npm 验证目录中的精确稳定版本 `latestVersion`，
并检查 DSH Bundle 声明，不会用 npm `latest` 替代后台上架版本。

Desktop 提供 Zenwit 和关闭两个选项。新安装默认使用 Zenwit，已有明确关闭选择与
安全模式仍然有效。旧 `dsh-market` 选择迁移到 Zenwit；第三方 `dshmarket`
依赖和运行接入已移除。

插件兼容性与目录可用性分别验证。目前发布的 `qnovel-mochi@0.1.0` 声明 DSH
`0.1.0-rc.7`，当前 Desktop 使用 `0.1.5-rc.1`；它的 Client 声明仍引用已移除的
`dsh-client-runtime` 模块，需要发布兼容版本。

## 验证

执行 `corepack yarn workspace dsh-community-market check`。
Desktop 修改还需通过两个版本的检查与 `corepack yarn check:desktop-variants`。

参见[安装行为](docs/install-and-uninstall.zh.md)和[目录协议](docs/catalog-provider-contract.zh.md)。
