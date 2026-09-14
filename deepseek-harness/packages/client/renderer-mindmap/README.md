---
description: "FreeMind (.mm) mindmap document renderer plugin for the Zenwit Workbench preview registry."
kind: "package-reference"
---

# dsh-client-renderer-mindmap

English | [中文](README.zh.md)

## Summary

An independent Workbench document renderer plugin. It contributes a `preview` view for `.mm` FreeMind documents: the registry selects it, and the view parses the XML draft into a bounded node tree and draws it with React elements. The package carries no kernel code and reaches the registry only through `ctx.documentRenderers`, so installing or removing it changes `.mm` presentation without rebuilding the kernel.

## Table of Contents

- [Parsing rules](#parsing-rules)
- [Model Experience](#model-experience)
- [Known Limitations and Deferred Work](#known-limitations-and-deferred-work)

-----

<a id="parsing-rules"></a>
## Parsing rules

`parseMindmap` refuses an empty body, a `<!DOCTYPE` declaration (XXE defense), a document over the character bound, malformed XML, and a root that is not a `map` element with a `node` child. It reads only the `TEXT`, `POSITION`, `STYLE` and `FOLDED` attributes; every other attribute is ignored rather than spread onto the DOM. A `<richcontent TYPE="NODE">` child is flattened to its whitespace-normalized text, so HTML never reaches the page. Node count and depth are capped at 5000 and 64.

The contribution declares `contract: 1` and `maxBytes: 4 MiB`. A build with a different contract version soft-rejects it and reports the reason in the renderer inventory; other functionality is unaffected.

-----

## Model Experience

None, as the browser-side renderer contributes no prompt, schema, or session event.

#### KV Cache effect

Independent; the package changes no model request.

## Known Limitations and Deferred Work

<a id="known-limitations-and-deferred-work"></a>

- **Layout is a nested tree, not a radial canvas.** `FOLDED`, `POSITION` and `STYLE` are parsed and carried but not yet used to place nodes.
- **Only UTF-8 documents are supported.** The Workbench text path refuses non-UTF-8 bytes, so a GBK `.mm` opens as source instead.

### Dev Note

<details>
<summary>Working context for maintainers — click to expand</summary>

None.

</details>

**Runtime invariant:** No companion is published. The package registers one disposable renderer and owns no mutable runtime relationship.
