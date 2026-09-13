# One generic workbench, independent Agent workflows

The user requested deletion of the original DSH workbench pages and migration of the previous product's common home/file-manager/editor/conversation experience. This supersedes the earlier compatibility-mode rule that retained the original kernel layout. Short-drama Agent workflows and other domain behavior are outside this migration.

The workbench owns the sole root registration. Layout and Workspace navigation retain their reusable controller responsibilities without their old presentation. Desktop modes affect native chrome only. The independent `zenwit-workspace` Host package owns project files and editor recovery; it does not import either desktop variant or a domain plugin. Agent presets remain ordinary Harness contributions.

See `docs/workbench.md` for ownership and validation. The architecture regression test asserts removal of old source entry points and absence of screenplay dependencies.
