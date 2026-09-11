# zenwit

zenwit 是基于 DeepSeek Harness 内核的桌面智能体应用。本项目直接维护桌面与内核源码，保留原项目的开源许可证和版权署名。

![zenwit 图标](dsh-plugin-desktop/build/app-icon.png)

## 开发

使用 Node.js `^22.19.0` 或 `>=24.0.0`，通过 Corepack 使用项目的 Yarn 4.18.0。

```sh
corepack yarn install --immutable
corepack yarn dev
```

Beta 使用 `corepack yarn dev:beta`。构建使用 `corepack yarn build`，测试使用 `corepack yarn test`，类型检查使用 `corepack yarn typecheck`。

## 产品边界

- 稳定版名为 `zenwit`，预览版名为 `zenwit Beta`，各自使用独立应用标识与数据目录。
- 内核源码位于 `deepseek-harness/`，可以直接修改；桌面运行时需要重新构建并同步。
- 原项目的自动更新与安装包下载服务已断开；当前版本通过本地构建和手动安装更新。
- 桌面启动时关闭内置会话遥测；模型提供商、远程访问和第三方插件仍可能联网。
- 当前没有声明 zenwit 的正式下载站点、反馈服务或签名发行渠道。

详情见[产品身份与服务说明](docs/zenwit-product.md)、[本地内核开发](docs/local-kernel.md)和[架构说明](docs/architecture.md)。部分历史文档仍使用原项目名称。

## 来源与许可

本项目基于 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness) 与 [DSH Desktop](https://github.com/anywhere-labs/dsh-desktop)。参见 [LICENSE](LICENSE) 与各包的第三方许可说明。
