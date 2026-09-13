# Workbench migration continuity

The workbench migration removed the runtime declaration of `sidebar.footer.action` while ui-cordis still registered its entire approval/lifecycle panel there. Existing directory pickers similarly waited on removed directory-flow seats. The new history surface also omitted archived-session filtering and management actions; foreground navigation changed Session state without changing the workbench's local home/workspace surface.

The workbench now owns the retained extension seats and a resident footer. Feature-owned pending sources contribute to an attention list through UiWorkspace without merging permission lifecycles. UiWorkspace publishes explicit foreground navigation independently of background Session updates and supports a disposable editor navigation guard. The searchable history surface restores rename/archive/fork and uses the archive set at display and navigation boundaries.

The private project registry supports explicit adoption and non-destructive forgetting of existing directories. External projects cannot use permanent project deletion. The file backend resolves registered project ancestors rather than assuming every project is a child of the managed library root. The kernel Workspace list remains visible through the project library, and selection adopts its path without copying data.

See `docs/workbench.md` for the migration matrix and focused verification surfaces.

Verification: 326 GUI test files passed (4,720 tests; one skipped), the generic workspace backend passed 15 tests, and the root headless check passed for both Desktop variants. Browser coverage exercises actual Cordis approval, activation and stop, including approval panel bounds at 1440 and 768 pixels. The workbench browser scenario covers project creation, file editing and responsive conversation layout.

Directory adoption preserves the original path. Opening a moved folder at a new path registers a new project; it does not rewrite historical Session cwd or move existing conversation associations. Restoring the old directory path remains the way to reconnect that history without a separate migration.

The local pnpm 11 dependency preflight attempted repeated installs with mismatched override settings. Validation used root Yarn to enter the kernel, an explicit full install with `--lockfile-only=false`, and `pnpm_config_verify_deps_before_run=false` for build/pack after installation. No user-level package-manager configuration was changed.
