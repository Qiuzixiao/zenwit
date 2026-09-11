# zenwit Product Brand

Status: implemented for this locally owned source distribution.

The desktop product owns the zenwit brand. Shared locale defaults, welcome copy, the conversation headline and web metadata use zenwit. Model provider identities and package protocol identifiers keep their original meanings. The desktop registers the sidebar and conversation marks through declared slots and disables the official brand row to prevent competing single-slot registrations.

The root desktop profile disables upstream feedback and telemetry and sets its assistant identity through the system-prompt configuration. Source changes here have corresponding root Yarn patches for the existing vendored runtime. After a full kernel rebuild, reconcile those patches before refreshing the runtime; already-applied source changes must not be applied twice.

Verification includes desktop runtime-content tests, profile composition tests, both desktop package suites, and an isolated Electron launch inspecting sidebar, conversation, settings, and browser title. Original licenses and attribution remain in force.
