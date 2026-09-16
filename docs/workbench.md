# Zenwit workbench

The product has one workbench: a home/project library followed by a three-column file manager, document editor, and conversation. Agent presets contribute prompts, tools, and workflows; they do not own the home page, filesystem UI, editor, or conversation navigation.

## Ownership

| Owner | Responsibility |
| --- | --- |
| `deepseek-harness/packages/client/ui-workbench` | Sole root registration, home, projects, file management, document editing, panel navigation, and chat-to-editor file navigation. |
| `zenwit-workspace` | Generic project registry, contained filesystem operations, file import, editor recovery, and save-conflict checks. No Electron or screenplay dependency. |
| `deepseek-harness/packages/client/ui-conversation` | Session/input controllers and the compact workbench conversation surface, including approval and question composition. |
| `deepseek-harness/packages/client/ui-chat` | Message rendering and file-link callbacks to the workbench editor. |
| `deepseek-harness/packages/client/ui-layout` | Navigation state and theme presentation; no page or root registration. |
| `deepseek-harness/packages/client/ui-workspace` | Workspace navigation and observable bindings; no sidebar browser or hero picker. |
| Desktop packages | Electron windows, native chrome, lifecycle, updates, and OS capabilities. Modes do not select different workbench roots. |

## Removed presentation

The original AppFrame, SidebarRoot, WorkspacePicker/WorkspaceBrowser, ConversationRoot, right sidebar/file-preview packages, and desktop AdvancedFrame/ExtendedFrame implementations are removed. The workbench does not shadow a retained page with registration priority or hide it with CSS.

Settings, models, permissions, approvals, attachments, and tool renderers remain reusable contributions. Existing Session and Workspace controllers retain ownership of runtime state. Opening a project binds its directory to a Workspace and opens a Session; it does not select a domain-specific Agent.

## Verification

`node --test scripts/workbench-boundary.test.mjs` prevents reintroducing the old page owners or a screenplay dependency in the common workbench. Workspace backend tests cover real temporary project files and HTTP requests. Changes to the kernel must be built and synchronized to both desktop runtime artifact sets using [local kernel development](local-kernel.md).

Filesystem save conflicts compare the expected disk content before replacement. This detects stale editor writes but does not promise an operating-system-wide atomic compare-and-swap against unrelated external writers.

## Migration continuity

The resident workbench chrome declares and renders `sidebar.footer.action` in its tool row, so Cordis approvals and plugin lifecycle controls survive project and session switches. The same row hosts the settings seat, which keeps Settings reachable on a surface without a sidebar. Run cards open the same panel; the attention list consumes feature-owned pending-action sources without granting permission itself. Normal approvals and questions retain their existing composer owners.

Foreground Workspace navigation publishes a revision separately from background Session updates. The workbench follows explicit navigation, and the editor can defer cross-project navigation until edits are saved or discarded. History supports current-project/all-project search, rename, fork and archive; archived sessions are excluded from normal lists and navigation.

The directory picker seats are declared by the workbench. Opening an existing directory explicitly registers it in the private project registry without copying content. Existing kernel Workspaces are included in the project library and adopted when opened. Removing a project from the library keeps files and session records; permanent deletion is restricted to application-created library projects. External projects keep the same file containment, symlink rejection and save-conflict rules.

| Capability | Workbench destination | Verification |
| --- | --- | --- |
| Plugin approvals, versions and lifecycle | Workbench tool row and Run-card review action | Cordis panel test and browser approval flow |
| Normal approval and questions | Composer; global attention navigation | Session-browser tests and composer browser tests |
| Existing directory selection | Global folder action and directory-flow seats | Registration test and real filesystem HTTP tests |
| History and archive | Searchable session browser | Session-browser and Workspace navigation tests |
| Creator navigation | Explicit foreground Workspace navigation | Frame navigation regression |
| Original branded shells/right sidebar | Intentionally removed | Workbench boundary test |

Document types share the center pane: Markdown has visual/source editing, HTML and SVG have source/preview switching, source files select CodeMirror language grammars, and images/PDFs use read-only readers. Raw project bytes are served as attachments; HTML executes only in an opaque sandbox, with bounded same-project resource reads.
