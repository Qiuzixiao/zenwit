# Agent Note: Bounded project scans and coalesced structure reloads

Status: implemented

English | [中文](2026-09-14-bounded-project-scans.zh.md)

## Problem

The desktop renderer exhausted its V8 heap and crashed (`exitCode: 5`, reported as `crashed`) minutes after `yarn dev` started; Crashpad holds six such minidumps since 2026-09-10 and every one records an out-of-memory crash key. The GC log names the process: 4,060 MB live against a 4,091.8 MB heap limit, a scavenge every 1.5–2.5 ms that reclaims almost nothing — the ~109% CPU in Activity Monitor was collection, not work. Two JavaScript stacks were captured at the failing allocation: `flatMap` under `flattenFiles` in the `ui-workbench` bundle, and `Set.add` under a shell-bundle `subscribe`. The desktop's own recovery reloaded the page three times and then reported "renderer recovery timed out waiting for page load and client health" — a blank window that cannot heal itself.

A tree render was the decisive driver, and the first fix did not bound it. `Workspace.tsx` treated every directory as open while the file-search box held any text (`isOpen = fileQuery.trim() !== '' || expanded.has(node.path)`), so a query matching most of the project built one element per node — 19,350 nodes on this repository, roughly 120,000 DOM elements — inside the render body, on every render. A probe with a 5,000-node project and the query `file` never finished a render inside a 5 s test timeout. The file-change feed kept bumping the revision, so each pass restarted before it could commit: the heap filled with live, uncommittable work (mutator busy 98%, scavenges reclaiming nothing) and V8 aborted at 2,875 MB of a 4,093 MB limit.

The earlier scan reduction was necessary but not sufficient. The Host structure scan walked the entire project including `node_modules`: this repository root holds 212,365 files, 191,713 of them dependency files, and one scan returned 134,481 nodes (15,751 directories, 118,730 files), 23.5 MiB of JSON, and 2,393 ms of synchronous work, of which 5,467 markdown files were read in full (47.4 MiB) to print a word count. `GET /changes` streams one event per filesystem batch, the Client turned every event into a `fileRevision` bump, and a bump reloaded the whole tree. The Client also re-flattened all 118,730 file nodes on every render, and a superseded response was parsed into a full object graph before the staleness check could drop it. `yarn dev` itself is the trigger: it builds thousands of files into the very project the running app is watching.

## Decision

Scans are bounded and never enter dependency caches. `zenwit-workspace/src/structure-scan.ts` owns both walks — structure and `@` resources — with an explicit entry limit parameter; the routes pass `MAX_SCAN_ENTRIES` (50,000) and report `truncated` in the response. `node_modules` is never entered, because a package cache is not project content. The same project root now scans in about 0.3 s as 19,350 nodes, and the node `detail` contract is untouched — markdown word counting is roughly two thirds of the remaining time.

Both rendered lists are bounded. The tree shares one render budget (`TREE_RENDER_LIMIT`, 400 rows) across the whole recursion, so element creation stops at the budget instead of following the match set, and the pane says how many rows it is showing; the quick-open dialog renders at most `QUICK_OPEN_LIMIT` (100) rows and its keyboard navigation indexes that same list. `filterTree` and the quick-open filter are derived from their own inputs rather than recomputed per render.

The Client stops one scan from being paid for repeatedly. `Workspace.tsx` derives the flattened file list with `useMemo` keyed on the structure response, so a search keystroke no longer re-walks the tree, and it checks the request generation before `res.json()`, cancelling the unread body instead of parsing a tree nobody will render. `index.ts` collapses a burst of change events into at most one `fileRevision` bump per 250 ms window. The revision stays one number, so every existing consumer — tree reload, external-change sync, editor reconciliation — keeps its contract; only the rate changes.

`truncated` is optional on `StructureResponse`, so a Host that does not bound scans stays compatible. The Client shows a localized notice rather than implying a complete tree.

Consumer-visible change: `node_modules` no longer appears in the file tree or the `@` reference picker. Files inside it remain readable by path through the file endpoints.

## Alternatives considered

**Throttle events only, keep the unbounded walk.** One scan is already 23.5 MiB held in renderer state, and a project larger than this one would exhaust the heap at a quiet event rate.

**Bound the walk without excluding dependency caches.** A budget large enough for a real project (this repository needs about 20,000 nodes once `node_modules` is excluded) would truncate a tree the user can legitimately browse.

**Per-directory lazy loading.** The right long-term design, but it changes the structure response, the tree component, and the search and quick-open paths, and the reported defect does not require it. Recorded as deferred work in the package README.

**Cache scans in the Host.** Caching hides the walk but not the 23.5 MiB response, and it adds invalidation on top of a change feed that already exists.

**Debounce inside `Workspace.tsx` instead of at the change feed.** The revision also drives external-change sync and editor reconciliation; coalescing belongs where events arrive, not at one consumer.

**Count words lazily or drop them.** Word counts are only 218 ms of the surviving 275 ms scan, so shortening the walk, not the detail text, was the fix.
## Consequences

One scan is bounded at 50,000 entries and skips dependency caches: this repository root drops from 134,481 nodes / 23.5 MiB / 2,393 ms to 19,350 nodes / 3.3 MiB / about 0.3 s. One rendered list is bounded at 400 rows and the other at 100, so no project size can drive the element count: the 5,000-node render probe that never completed inside a 5 s timeout now renders in 507 ms with at most 400 rows. A project beyond the budget gets a truncated tree and a localized notice instead of a renderer crash. `node_modules` is no longer browsable in the tree or the `@` picker — the deliberate cost of the exclusion; files inside it stay readable by path. A change burst now costs at most four scans per second instead of one per changed file, so the tree lags a build by up to 250 ms.

The two halves ship together: the client tolerates a Host that sends no `truncated`, and the Host never sends a field the client must understand. Verification is `zenwit-workspace/tests/structure-scan.test.mjs` (cache exclusion, budget reported exactly at the boundary, retained depth limit, unchanged markdown detail), the Host HTTP test asserting `node_modules` is absent from `/structure` and `/resources`, and client specs covering the truncated notice, one flatten per tree across a search-driven re-render, the cancelled superseded response, and one revision bump per event burst.
