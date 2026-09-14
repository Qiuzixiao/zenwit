---
description: "Shared media-type knowledge: one filename-extension table, unambiguous byte-signature detection, and an explicit probe for the Workbench preview registry and Host file services."
kind: "package-library"
---

# dsh-util-media-type

English | [中文](README.zh.md)

## Summary

One source of truth for "what kind of file is this", shared by browser preview code and Host file services. The package maps filename extensions to canonical MIME types, recognizes unambiguous leading-byte signatures, and reconciles both through `probeMediaType`. It is pure, carries no Cordis service or runtime state, and runs unchanged in the browser and in Node.

## Table of Contents

- [Media-type knowledge](#media-type-knowledge)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)
- [Dev Note](#dev-note)

-----

<a id="media-type-knowledge"></a>
## Media-type knowledge

`MEDIA_TYPE_BY_EXTENSION` is the declared-type table, keyed by a lowercase extension without its dot. `extensionForPath(path)` returns that final extension, or `undefined` when the basename has none; the last extension wins, so `archive.tar.gz` yields `gz` and `mediaTypeForPath` reports no known type.

`sniffMediaType(data)` recognizes only signatures with one unambiguous type: PNG, JPEG, GIF, WebP, WAV, PDF, WebM, and MP4. A signature that could name more than one type, such as the two-byte `BM` bitmap prefix, stays extension-declared only. Short buffers match nothing.

`imageMimeForPath(path)` guarantees a usable Blob type, falling back to `application/octet-stream`. `probeMediaType(path, data?)` returns `{ declared, detected, mediaType, mismatch }`. `mediaType` is the detected type when bytes are supplied and recognized, otherwise the declared extension; `mismatch` is true only when two known sources disagree, so a `.png` name over JPEG bytes resolves to `image/jpeg` with `mismatch: true`. `isTextMediaType(mediaType)` classifies a known type as UTF-8 text (`text/*`, SVG, XML, JSON, YAML, TOML, and `+json`/`+xml` suffixes); an unknown type is the caller's policy, not this package's.

-----

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **The extension table is a fixed vocabulary, not an exhaustive one.** An extension absent from the table resolves to `undefined` so the caller keeps its own default (the Workbench treats it as text). Adding a format means adding a table row, not changing a function.
- **Byte detection is intentionally narrow.** Ambiguous or weak signatures are omitted to avoid misclassifying content; callers that need deeper inspection own that step.

<a id="dev-note"></a>
### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. This utility owns no mutable runtime relationship.
