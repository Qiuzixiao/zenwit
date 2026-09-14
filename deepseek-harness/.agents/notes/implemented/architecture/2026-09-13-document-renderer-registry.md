# Agent Note: Document renderer registry

Status: implemented

English | [中文](2026-09-13-document-renderer-registry.zh.md)

## Problem

The Workbench answered "can this file be previewed" with three predicates over one enum: `documentKind`, `isBinaryDocument`, and `hasDocumentPreview`. The concept "has a preview" had no name; the two predicates could not overlap by construction. Every new format grew the number of call sites linearly, and two real shapes could not be expressed at all: video (binary storage with a preview) and `.mm` (text storage with a preview). Adding a format meant editing the kernel, rebuilding every runtime tarball, and restarting the application.

## Decision

The Workbench derives one [DocumentDescriptor](../../../../docs/document-renderers.md) per file from a registry of renderer contributions. The descriptor carries `path`, `mediaType`, `storage`, ordered `views`, the selected `renderer` or `null`, and an optional `size`. `views` is derived — the selected renderer's views plus `source` for text storage — so a contribution cannot claim a view nothing can draw.

`ctx.documentRenderers` owns registration, selection, and the inventory. A contribution is pure declaration data (`id`, `contract`, `match`, `views`, optional `priority` and `maxBytes`) plus a lazy `load()`; `match` stays pure data so "who claims .mm" is answerable without loading plugin code. Selection is one total order independent of registration order: priority descending, specificity descending (exact media type, extension, wildcard media type), built-in first on an exact tie, then id ascending. The registry soft-rejects a contribution built against another contract version and records the reason for the settings inventory.

The kernel registers six built-in read-only renderers and draws them itself: `builtin/html`, `builtin/svg`, `builtin/image`, `builtin/pdf`, `builtin/video`, `builtin/audio`. The media built-ins point a native element at the Host's lazy content route, which streams with real MIME, ETag, conditional requests, and byte ranges. Built-ins are in-process, carry no loader, and win an otherwise exact tie, so a plugin overrides one only by declaring `priority` above zero. Markdown's visual editing is a Workbench editor, not a renderer: it edits the draft with history, find, and outline, which the read-only renderer contract deliberately does not carry. The Workbench adds that editor's `preview` view when no renderer claims a Markdown file.

A renderer receives `path`, `mediaType`, the current text `source`, a change `revision`, the translate function, and `resolve(relative)`, which builds a same-origin URL for a document-relative asset under Host-enforced containment — no transport and no raw bytes. The [Mindmap renderer](../../../../packages/client/renderer-mindmap/README.md) proves an independent package can add a format without kernel changes; it registers a `.mm` preview through `ctx.documentRenderers`. This supersedes the removed sidebar document-preview service `ctx.documentPreviews` and its package ([document preview operations](2026-09-08-document-preview-operations.md)).

## Alternatives considered

**Extend `DocumentKind` and add branches.** This keeps "has a preview" unnamed and keeps the call sites growing with the format count. It cannot express the two shapes that motivated the work without adding more mutually-exclusive predicates.

**Let plugins construct descriptors.** A descriptor a plugin supplies is not trustworthy for storage, size, or view availability. Deriving it in one place keeps the descriptor the single authority.

**Break ties by registration order.** Registration order follows profile bundle order and is not reproducible across machines. A four-segment total order ends in a stable id comparison instead.

**A catch-all renderer.** A catch-all hides every later, more specific registration behind itself and turns each new built-in into a shadowing bug. `renderer: null` is the explicit fallback.

**Put Markdown's visual editor in the registry.** That would force editing callbacks into a contract whose other consumers are read-only, freezing an editor's history, find, and selection API into a preview contract. The editor stays a Workbench built-in view; a plugin that matches Markdown by media type overrides it.

**Send raw bytes to plugins.** Exposing a byte reader would let any renderer read arbitrary Host routes and collapse the two threat models. P0 gives plugins text only; a dedicated content channel with real MIME and Range is deferred.

## Consequences

Adding a format is now a package, not a kernel release: the registry selects it, and uninstalling the package removes it while open tabs re-resolve to `source` without losing drafts. The descriptor becomes a public, pre-stable contract with a versioned integer and a soft-reject path, so it can grow by optional additions. The Workbench no longer answers format questions itself, which moves the compatibility burden onto the contract. `.mm` is supported out of the box by the shipped Mindmap package. The lazy content channel streams large media with byte ranges, and one resolver serves document-relative assets under Host-enforced containment. A page-level Content-Security-Policy remains absent: the served shell injects inline boot scripts, so enforcing one needs per-response nonces for those injections and a runtime confirmation, which is deferred.

Verification is the descriptor table tests, the four-segment order tests, the registry registration and disposal tests, the preview host tests (including the one-attempt load failure), and the Mindmap parser, view, and plugin-registration tests. The browser boundary test and the client aggregate typecheck pin the split.
