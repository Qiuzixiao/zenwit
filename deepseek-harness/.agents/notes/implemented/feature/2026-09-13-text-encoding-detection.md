# Agent Note: Text encoding detection and preservation

Status: implemented

English | [中文](2026-09-13-text-encoding-detection.zh.md)

## Problem

The project text path decoded every file as strict UTF-8 and returned 415 for anything else. A GBK (gb18030) CSV exported by Excel on a Chinese Windows machine, a UTF-16 note, or a legacy-encoded `.mm` could not be opened as text at all, even though they are plain text. The failure surfaced as "file is not UTF-8 text; use binary preview".

## Decision

`zenwit-workspace/src/encoding.ts` detects a file's text encoding from its bytes before decoding. A BOM or a strict UTF-8 decode is certain; a NUL-byte distribution identifies BOM-less UTF-16; otherwise the Host tries `gb18030`, `big5`, and `shift_jis` with a strict decode and falls back to `windows-1252`. Bytes that look binary (nonzero NUL density without a UTF-16 pattern) stay a 415 refusal, so nothing binary is mistaken for text.

The read response carries the decoded `content` and its `encoding`. The editor echoes `encoding` back on save, and the Host re-encodes with `iconv-lite` for the encodings Node cannot encode natively (`gb18030`, `big5`, `shift_jis`, `windows-1252`, `utf-16be`); `utf-8` and `utf-16le` use `Buffer`. A save that names an unsupported label falls back to UTF-8. Saving in the original encoding is the point: converting a GBK file to UTF-8 silently would break the other programs that read it.

## Alternatives considered

**Decode everything with `windows-1252`.** Every byte sequence decodes under a single-byte encoding, but a GBK CSV becomes mojibake instead of failing loudly — worse than the 415 it replaces.

**Convert non-UTF-8 files to UTF-8 on save.** This discards the original encoding and breaks every consumer that expects it. Preserving the encoding is the contract.

**A hand-rolled GBK table.** GB18030 maps tens of thousands of code points; a table would be large, error-prone, and need its own maintenance. `iconv-lite` is already vetted transitively in the lockfile and is pure JavaScript.

**Detect in the browser.** The Client never sees the bytes: the Host owns file reads and writes, so detection lives beside them, and only the resulting label crosses the wire.

**A full statistical charset detector.** Bigram scoring across many encodings is a large dependency for the current consumer. Strict-decode ordering covers `gb18030` (the reported case) and falls back predictably; `big5` and `shift_jis` are chosen only when `gb18030` cannot decode the bytes.

## Consequences

Non-UTF-8 text now opens and saves without a 415. The Host gains `iconv-lite` as a production dependency, packaged as part of the `zenwit-workspace` closure. Detection is a heuristic: a Big5 document whose bytes also form valid gb18030 may decode as gb18030, and a short file may not reveal its encoding — a wrong guess produces replacement characters rather than an error, and the original bytes change only when the user saves. Encodings outside the candidate set land on `windows-1252`.

Verification is the Host backend tests: a GBK CSV reads as decoded Chinese with `encoding: gb18030`, a save with that label writes the original encoding back, a BOM'd UTF-16LE note reads as `utf-16le`, and recognized-binary bytes still return 415.
