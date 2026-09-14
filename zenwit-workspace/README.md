# zenwit-workspace

Independent generic project/files Host package, version `0.1.0-dev.0`. It provides the existing `/api/desktop/projects` contract for a home, file tree, editor and chat UI. It has no runtime dependencies, client face, Electron imports, desktop imports, screenplay imports, templates or migration logic.

## Integration

The package root exports the Cordis Host face (`name`, `inject`, `apply`) and the standalone `createWorkspaceBackend` factory. Load **one instance per application home**. It injects the current services `webServer` and `connection`, registers exact routes using `ctx.webServer.register()`, and owns unregister/disposal through `ctx.effect()`. The connection trust/auth fence runs before the package's same-origin fence.

After root workspace/dependency installation, build before starting the Host:

```sh
corepack yarn workspace zenwit-workspace build
corepack yarn workspace zenwit-workspace typecheck
corepack yarn workspace zenwit-workspace test
```

Both desktop packages can depend on `zenwit-workspace: 0.1.0-dev.0`. Root Yarn owns the package manager and lockfile; this package has no `prepack` hook. Include `lib/` in release artifacts (listed in `files`). `corepack yarn workspace zenwit-workspace pack` packages the previously built output.

At the composition boundary, load the package using the existing Cordis plugin mechanism. The equivalent programmatic registration is:

```ts
import * as workspace from 'zenwit-workspace'

ctx.plugin(workspace, {
  homeDir: applicationHome, // pass the launcher's actual app home explicitly
  projectsDir: projectsDirectory, // optional; absolute path
})
```

`apply` defaults `expectedOrigin` to `http://127.0.0.1:${ctx.webServer.port}`. Optional configuration:

| Option | Default | Purpose |
| --- | --- | --- |
| `homeDir` | `ZENWIT_HOME`, otherwise `~/.zenwit` | Private registry and recovery data |
| `projectsDir` | `ZENWIT_PROJECTS_DIR`, otherwise `~/Zenwit/projects` | User project directories |
| `expectedOrigin` | Host loopback URL | Trusted renderer origin, never derived from request headers |
| `nativeAction` | absent | Optional `(action: 'reveal' \| 'terminal', absolutePath) => void \| Promise<void>` |

Paths must be disjoint, absolute resolved locations without symlink ancestors. For example, resolve a platform temporary-directory alias with `realpath` before configuring it. The package deliberately does not infer DSH home or depend on desktop runtime. Set `homeDir` from the owning application. Registry: `<homeDir>/workspace/projects.json`; recovery: `<homeDir>/workspace/document-recovery/`.

Native actions use an injected callback only; without one, `/reveal` and `/terminal` return `501`. The callback is invoked only after authorization and project containment checks. Adapt this callback to the shell's existing native capabilities when composing the Host.

A non-Cordis server can import `createWorkspaceBackend` from `zenwit-workspace/backend`, call `backend.handle(req, res)` for `PROJECT_API_PATHS`, and call `backend.dispose()` during shutdown. Its caller must supply any application authentication fence that Cordis normally provides.

## HTTP contract

All JSON responses use `Cache-Control: no-store`. Body errors return `{ error }`. Mutations require an exact `Origin`, matching `Host`, and a loopback peer; GET supports the same origin header or browser `Sec-Fetch-Site: same-origin` plus a matching Referer. A conflicting Origin is always rejected. No CORS, wildcard origins or forwarded-header trust is enabled. The extracted policy supports local HTTP loopback (`127.0.0.1` or `[::1]`), not LAN/HTTPS browser access.

All paths are absolute. The base is `/api/desktop/projects`:

| Method and suffix | Input | Response |
| --- | --- | --- |
| `GET` | none | `{ root, projects: [{ name, path, tags, updatedAt, agentId? }] }` |
| `POST` | `{ name, tags?, agentId? }` | `{ project }`; creates an empty directory and registers it |
| `PATCH` | `{ path, tags }` | `{ project }` |
| `POST /delete` or `POST ?action=delete` | `{ path }` | `{ ok: true, path }`; permanently removes registered project content |
| `GET /structure` | `?path=projectPath` | `{ path, root, tree, truncated, agentId? }` |
| `GET /resources` | `?path=projectPath` | `{ resources: [{ name, path, kind: 'file', detail }], truncated }` |
| `POST /node` | `{ path, kind: 'file' \| 'directory' }` | `{ ok: true, path, node }` |
| `PATCH /node` | `{ path, newName }` | `{ ok: true, path, node }` |
| `DELETE /node` | `{ path }` | `{ ok: true, path }`; recursively deletes a directory |
| `POST /import` | `?projectPath=...&destinationPath=...&name=...`; raw bytes | `{ ok: true, path, node }` |
| `GET /file` | `?path=filePath` | `{ content, recovery, versions }`; missing disk file returns `404` with recovery |
| `GET /file` | `?path=filePath&raw=1&relative=optionalPath` | Complete bytes (100 MiB limit), attachment/octet-stream with sandbox CSP; relative resources stay in the source project |
| `GET /file` | `?path=filePath&sync=1` | `{ content }`, including `404` with `content: null` |
| `POST /file` | `{ path, content, expectedContent: string \| null }` | `{ ok: true }`; `409` includes current disk `{ error, content }`; missing expectation is `428` |
| `POST /file` | `{ path, action: 'draft', content, baseline }` | `{ ok: true }` |
| `POST /file` | `{ path, action: 'discard-draft', expectedDraft? }` | `{ ok: true }`; guarded discard preserves a newer draft |
| `POST /file` | `{ path, action: 'checkpoint', content }` | `{ ok: true, versions }` |
| `GET /changes` | `?path=projectPath` | SSE `data: ready`, then `data: changed`; 15-second keepalive |
| `POST /reveal`, `POST /terminal` | `{ path }` | `{ ok: true }` or `501` without native capability |

JSON bodies are limited to 2 MiB; raw import to 100 MiB, checked against both declared and streamed sizes. Imports and new nodes do not overwrite existing destinations. Tags preserve normalization, deduplication and the old limits (8 tags, 24 characters each).

Tree nodes retain the legacy `kind: 'dir' | 'file'`, `detail`, and optional `children`; node mutation responses use `kind: 'directory' | 'file'`. Markdown display names omit `.md`. Scans omit dotfiles, links, special files and `node_modules` — dependency caches are not project content — and retain the old depth limit (levels 0–8). One scan carries at most 50,000 entries and reports `truncated: true` when that budget stopped the walk, so a response can never be unbounded. Resources include `.md`, `.markdown`, `.txt`, `.json`, `.yaml`, `.yml`. Text reads and writes reject invalid UTF-8, NUL bytes and known image/PDF files with `415`; binary imports and raw previews preserve bytes. Raw previews do not create text recovery entries.

## Storage and safety

Only direct children registered by this package are projects. Copying a `.zenwit-project/project.json` marker into a directory grants no access, and existing short-drama projects are not discovered or migrated. Optional `agentId` is caller-owned and has no default. New project names are sanitized and collisions receive numbered suffixes.

Containment rejects traversal, symlinks (including dangling and cross-project links), private `.zenwit-project` paths and project-root node mutations. Import rechecks containment after receiving the complete body. Registry updates and recovery writes use exclusive temporary files followed by rename. Malformed registry data fails closed without replacing it.

Saves compare disk content with `expectedContent`, persist checkpoints before touching the file, then recheck immediately before atomic replacement. New files use exclusive link creation so a concurrent creation is not overwritten. Request mutations are synchronous after body receipt, serializing saves in one Node process. This is optimistic protection against ordinary editor/agent changes, not a cross-process transaction or an OS sandbox: an independent process can still race the final check/rename or replace filesystem ancestors. The package does not share the kernel filesystem provider's locks. Keep a single Host writer for each app home; external tools should cooperate if they require stronger ordering.

Recovery holds at most 50 checkpoints per document and 100 MiB of checkpoint content per project; drafts are not evicted. Recovery stays keyed by absolute project/file path across restarts. Rename/delete does not migrate or purge old recovery entries, preserving the legacy deleted-file recovery behavior. Project deletion does not erase recovery data.

SSE watches project directories recursively, including atomic replacement and new nested files. Watcher failure returns `503` before streaming or closes an existing stream. Disconnect and Host disposal close watchers and timers. Keep the frontend's periodic refresh fallback and reconnect handling.

## Verification

Tests use Node's built-in test runner with real isolated files and HTTP servers, plus deterministic streamed-upload and Host lifecycle probes. They cover registry persistence, generic creation, tag updates, deletion, tree/resources, node operations, binary import, size limits, origin/Host fences, traversal and symlinks, import-time path replacement, conflict saves, draft recovery, checkpoint budgets, native capability validation and SSE disposal. Build emits ESM and declarations using TypeScript; no GUI is launched.

The source was extracted from the prior `project-library-route.ts`, `document-recovery.ts`, `project-file-events.ts` and HTTP guards, with request compatibility checked against the prior `ui-short-drama/Workspace.tsx`. Only the generic protocol and filesystem behavior are retained.
