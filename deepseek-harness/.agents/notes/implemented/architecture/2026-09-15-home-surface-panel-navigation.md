# Agent Note: Home surface panel navigation

Status: implemented

English | [中文](2026-09-15-home-surface-panel-navigation.zh.md)

## Problem

The workbench home surface rendered no slots at all. Every seat the shell declares for extension UI — `sidebar.panellist` for application-wide main panels and `sidebar.settings` for the settings trigger — was rendered only inside `Workspace`. A user who had not opened a project could therefore reach neither a plugin's global view nor Settings from the page the product opens on; the only remaining route was native window chrome, which a packaged build does not present as an in-page destination.

Product surfaces that belong on the landing page — an account center, the plugin market — had no composition path. The alternatives were to hardcode product names into the kernel workbench or to cover the page with an overlay from a plugin, and the [global main panels](2026-09-08-global-main-panels.md) decision already put panel navigation in the shell rather than a feature.

## Decision

The home surface is a panel host and renders the seats it needs. `HomePage.tsx` receives the live panel list, the current selection, the selection action and `renderSlot` through its props; `WorkbenchFrame.tsx` supplies them from the hooks and injected face it already owns.

- `HomePage` renders the `sidebar.settings` seat in its tool row with `{ wide: false }`. The existing `ui-settings-general` occupant draws its compact trigger there and opens the same modal panel it opens from the workspace.
- `WorkbenchTopBar.tsx` renders the brand block, the two built-in destinations, every `sidebar.panellist` entry and the settings seat. Both built-in surfaces render it, so their chrome and tool row cannot drift apart; only the tool cluster on the right belongs to the surface.
- `HomePage` hosts the selected `main` key in its own body in place of the intro and the three-panel project body. The panel page gets the full height below the header. `ProjectLibraryPage` carries the same chrome, the same hero pattern and its own tools, and selecting a panel from it returns to the home surface, which is the only surface that hosts a panel page.
- Built-in surfaces and panels share one selection. The home button selects `null`; selecting a panel marks it `aria-current="page"` and hides the built-in body; the library button clears the selection before switching surface; opening a project clears it before the workspace mounts. `Workspace` keeps hosting the selected key in its center pane, so document editors stay mounted while a panel is shown.
- `WorkbenchFrame` keeps page selection and titles but no longer renders the `main` page for the home and library surfaces, and no longer hides the page body behind it.

The kernel names no product: entries arrive only from registrations, so the same mechanism serves any plugin that registers a main panel.

## Alternatives considered

**Declaring home-only navigation slots (`home.nav`, `home.tools`).** A home-specific seat needs its own page-selection state and its own page host, duplicating `main` and `ctx.layout.selectPanel`. The existing panel list already carries the id, order and label a navigation row needs.

**Moving the home header into `WorkbenchFrame`** so the frame could keep one panel host for every surface. The header owns the project search query, the create dialog and the folder-picker triggers; lifting it would move page state into the frame for no gain.

**Keeping the frame-level panel host and leaving the page body hidden behind it.** The header lives inside the hidden body, so the navigation that selected the panel would disappear with it and the user could not return to a built-in surface.

**Overlaying the home page from a plugin with renderer injection or CSS.** The repository forbids covering a retained page with priority or styles, and an overlay would still not give the plugin a first-level destination.

**Leaving the selected panel in place when a project opens.** The workspace would show the panel in its center pane instead of the conversation, which is not what "open this project" asks for.

## Consequences

A plugin that registers a main panel is reachable from the moment the app opens, and the same registration drives both surfaces: the home navigation row and the workspace tool row render the same list, and the icon owner share (`size`, `active`) is satisfied in both. The kernel stays product-neutral: account center and plugin market are ordinary registrants.

The home body now has two layouts, so `.homePluginPage` spans the rows the intro and project body occupied. Panel selection remains transient and resets on reload. Adding a panel entry changes the home header width, which the navigation row absorbs by shrinking rather than wrapping.

Verification is the workbench client suite: `tests/home.client.spec.tsx` asserts the settings seat renders, that a registered entry is a navigation button with the right selected state, that selecting it reaches the owner, and that the panel body replaces the built-in body; `tests/frame-navigation.client.spec.tsx` asserts opening a project clears the selection first. The package's types are covered by the client aggregate check (`tsc -b tsconfig.client.json`).
