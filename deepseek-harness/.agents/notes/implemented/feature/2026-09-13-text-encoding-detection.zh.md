# Agent Note: 文本编码探测与保持

Status: implemented

[English](2026-09-13-text-encoding-detection.md) | 中文

## 问题

项目文本路径把每个文件都按严格 UTF-8 解码，其他编码一律返回 415。中文 Windows 上 Excel 导出的 GBK（gb18030）CSV、UTF-16 的笔记、或旧编码的 `.mm`，明明是纯文本却完全打不开，错误显示为 "file is not UTF-8 text; use binary preview"。

## 决策

`zenwit-workspace/src/encoding.ts` 在解码前先从字节探测文本编码。带 BOM 或严格 UTF-8 可解码即为确定；NUL 字节分布可识别无 BOM 的 UTF-16；否则依次尝试 `gb18030`、`big5`、`shift_jis` 的严格解码，最后回退 `windows-1252`。看起来是二进制的字节（NUL 密度较高且不符合 UTF-16 模式）仍返回 415，二进制不会被误当文本。

读取响应同时返回解码后的 `content` 与其 `encoding`。编辑器保存时把 `encoding` 回传，Host 对 Node 无法原生编码的编码（`gb18030`、`big5`、`shift_jis`、`windows-1252`、`utf-16be`）用 `iconv-lite` 重新编码；`utf-8` 与 `utf-16le` 用 `Buffer`。保存若带了不支持的标签则回退 UTF-8。**按原编码保存正是重点**：把 GBK 文件悄悄转成 UTF-8 会破坏其他读取它的程序。

## 考虑过的替代方案

**一律用 `windows-1252` 解码。** 任何字节序列在单字节编码下都能解码，但 GBK CSV 会变成乱码而不是明确失败——比它取代的 415 更糟。

**保存时把非 UTF-8 文件转成 UTF-8。** 这会丢弃原始编码并破坏所有期待它的消费者。保持编码才是契约。

**手写 GBK 映射表。** GB18030 映射数万码点；表会很大、易错且需要自行维护。`iconv-lite` 已在锁文件中作为传递依赖被审查过，且是纯 JavaScript。

**在浏览器里探测。** 客户端拿不到字节：文件读写属于 Host，探测因此与读写同处，只有结果标签跨进程传输。

**完整的统计式字符集探测。** 跨多种编码的二元组打分对当前消费者来说依赖过大。严格解码顺序覆盖 `gb18030`（被报告的场景）并给出可预测回退；只有当 `gb18030` 无法解码时才选 `big5` 或 `shift_jis`。

## 影响

非 UTF-8 文本现在不再 415，可打开并保存。Host 增加 `iconv-lite` 生产依赖，随 `zenwit-workspace` 闭包一起打包。探测是启发式的：字节同样构成合法 gb18030 的 Big5 文档可能被识别为 gb18030，短文件也可能看不出编码——猜错会产生替换字符而非报错，且原始字节只在用户保存时改变。候选集之外的编码会落到 `windows-1252`。

验证为 Host 后端测试：GBK CSV 读为解码后的中文且 `encoding: gb18030`，以该标签保存写回原始编码，带 BOM 的 UTF-16LE 笔记读为 `utf-16le`，可识别为二进制的字节仍返回 415。
