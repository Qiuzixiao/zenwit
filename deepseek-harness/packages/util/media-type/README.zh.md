---
description: "共享的媒体类型知识：一份扩展名表、无歧义的字节签名识别，以及供 Workbench 预览注册表与 Host 文件服务共用的显式 probe。"
kind: "package-library"
---

# dsh-util-media-type

[English](README.md) | 中文

## 概述

"这是什么类型的文件"的唯一真相源，由浏览器预览代码与 Host 文件服务共用。该包把文件扩展名映射到规范 MIME 类型，识别无歧义的文件头字节签名，并通过 `probeMediaType` 调和两者。它是纯函数模块，不提供 Cordis service、不持有运行时状态，在浏览器与 Node 中行为一致。

## 目录

- [媒体类型知识](#media-type-knowledge)
- [已知限制与暂缓事项](#known-limitations-and-deferred-work)
- [开发备注](#dev-note)

-----

<a id="media-type-knowledge"></a>
## 媒体类型知识

`MEDIA_TYPE_BY_EXTENSION` 是声明类型表，键为小写、不带点的扩展名。`extensionForPath(path)` 返回该最后扩展名，basename 没有扩展名时返回 `undefined`；最后一个扩展名生效，因此 `archive.tar.gz` 得到 `gz`，而 `mediaTypeForPath` 报告未知类型。

`sniffMediaType(data)` 只识别对应单一类型的签名：PNG、JPEG、GIF、WebP、WAV、PDF、WebM 与 MP4。可能对应多种类型的签名（如两字节的位图前缀 `BM`）只保留扩展名声明。过短的缓冲区不匹配任何签名。

`imageMimeForPath(path)` 保证可用的 Blob 类型，未知时回退为 `application/octet-stream`。`probeMediaType(path, data?)` 返回 `{ declared, detected, mediaType, mismatch }`。当提供并识别出字节时，`mediaType` 为检测类型，否则为扩展名声明类型；`mismatch` 仅在两个已知来源不一致时为真，因此扩展名为 `.png`、字节为 JPEG 时解析为 `image/jpeg` 且 `mismatch: true`。`isTextMediaType(mediaType)` 判断已知类型是否为可按 UTF-8 读取的文本（`text/*`、SVG、XML、JSON、YAML、TOML，以及 `+json`/`+xml` 后缀）；未知类型由调用方决定，不属本包职责。

-----

## 已知限制与暂缓事项

<a id="known-limitations-and-deferred-work"></a>

- **扩展名表是固定词表，而非穷举表。** 不在表中的扩展名解析为 `undefined`，由调用方保留自己的默认行为（Workbench 视为文本）。新增格式是加一行表项，而不是改函数。
- **字节识别刻意保持狭窄。** 为避免误判，省略了有歧义或较弱的签名；需要更深检查的调用方自行承担该步骤。

<a id="dev-note"></a>
### 开发备注

<details>
<summary>维护者工作上下文 — 点击展开</summary>

无。

</details>

**运行时不变式：** 不发布 companion。该工具不持有可变运行时关系。
