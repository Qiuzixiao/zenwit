# Document renderers

English | [中文](document-renderers.zh.md)

A renderer plugin teaches the Workbench how to present one kind of file. For each open file the Workbench derives a single descriptor, selects one registered renderer, and renders the selected view. Plugins contribute a declaration and a lazy view module; they never construct a descriptor and never import runtime code from the Workbench.

The registry is the Client service `ctx.documentRenderers` owned by [ui-workbench](../packages/client/ui-workbench/README.md). Its public contract is the type-only subpath `@deepseek-ai/dsh-client-ui-workbench/preview`. The kernel registers six built-in read-only renderers — `builtin/html`, `builtin/svg`, `builtin/image`, `builtin/pdf`, `builtin/video`, `builtin/audio` — and draws them itself. Markdown's visual editing stays a Workbench editor rather than a renderer, because it edits the draft instead of presenting a read-only view.

## The descriptor

[DocumentDescriptor](../packages/client/ui-workbench/src/client/document-descriptor.ts) is the one answer to "what is this file and how can it be shown":

| Field | Meaning |
|---|---|
| `path` | Absolute project path. |
| `mediaType` | Resolved MIME type; `text/plain` or `application/octet-stream` when nothing declared one. |
| `storage` | `text` for UTF-8-editable content, `binary` for bytes that must never be decoded as text. Unknown extensions stay `text`. |
| `views` | Ordered offered views; the first is the default. Derived from the selected renderer's views plus `source` for text storage. |
| `renderer` | The selected renderer id, or `null` for the fallback. |
| `size` | Known byte size, or `undefined`. |

`views` is derived rather than declared, so a renderer cannot claim a view nothing can draw. The four combinations are text or binary crossed with a selected renderer or none: `['preview', 'source']`, `['preview']`, `['source']`, and `[]`.

## The contribution

A plugin registers a renderer contribution: `id` (reverse-domain, immutable after publication), `contract` (the integer version it was built against), `match` (`extensions` and `mediaTypes`, pure data), `views`, optional `priority` and `maxBytes`, and `load()`, which dynamically imports the view module. Installing the contribution through `ctx.effect` removes it when the plugin fiber disposes.

Because `match` is pure data, the registry answers "who claims .mm" without running plugin code, so the settings inventory can enumerate renderers without loading them.

## Selection order

When several declarations match, one total order decides, independent of registration order:

1. `priority` descending — the only explicit override lever.
2. Specificity descending — exact media type (3), filename extension (2), wildcard media type such as `image/*` (1).
3. Built-in first on an otherwise exact tie.
4. `id` ascending, so the result is reproducible.

A plugin that means to override a built-in sets `priority` above zero; otherwise the built-in wins the tie.

## Degradation

The Workbench never shows an empty panel for a file a renderer claims:

| Situation | Result |
|---|---|
| A renderer matches | The descriptor names it; the default view renders. |
| No renderer, text storage | `source` only. |
| No renderer, binary storage | No view; the Workbench reports that no preview exists. |
| `load()` fails | The descriptor drops the renderer, source stays, and the editor header shows the reason and a retry control. A failed renderer is remembered by id, so re-rendering does not retry it; only the explicit retry re-arms it. |
| The file exceeds `maxBytes` | The same fallback with a size reason. |

## Compatibility

`contract` is an integer the registry checks at registration. A contribution built against a different version is soft-rejected: it is recorded with its reason in the settings inventory and otherwise ignored, so one incompatible renderer cannot break a plugin's other features. Adding an optional field is a minor change; changing a required field or the descriptor's meaning is breaking. A view id this build does not know is dropped from the offered views rather than rejecting the whole renderer.

## Content channel

Image, PDF, video, and audio built-ins read through the Host's lazy content route (`/api/desktop/projects/file?stream=1`). It streams with `createReadStream`, reports `Accept-Ranges: bytes`, answers `Range` with `206` and `Content-Range`, answers `If-None-Match` with `304`, and sends the real media type with `Content-Disposition: inline` and `X-Content-Type-Options: nosniff`. Active content (HTML, SVG) and unknown extensions keep the sandbox-asset policy: `application/octet-stream`, `attachment`, and `Content-Security-Policy: sandbox; default-src 'none'`. The 100 MiB whole-file read cap applies only to the sandbox-asset route, so a large video streams and seeks.

## Security

A renderer receives only `path`, `mediaType`, the current text `source`, a change `revision`, the Workbench translate function, and `resolve(relative)`. `resolve` returns a same-origin URL for a document-relative asset, and the Host enforces project containment and symlink rejection on every read. The renderer itself gets no transport and no raw file bytes, so a plugin cannot fetch arbitrary Host routes. The Mindmap parser rejects a `<!DOCTYPE` declaration, flattens embedded rich text, whitelists attributes rather than spreading them, and caps node count, depth, and size. Renderers draw React elements; the contract forbids `dangerouslySetInnerHTML`.

## Adding a renderer

Create a package whose browser half declares `inject = ['documentRenderers']` and registers a contribution in `ctx.effect`. The [Mindmap renderer](../packages/client/renderer-mindmap/README.md) is the reference: it matches `.mm` by extension, declares `contract: 1` and `maxBytes: 4 MiB`, and loads a view that parses the draft and draws the tree.
