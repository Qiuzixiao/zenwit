# Source editor scroll ownership

The source editor fills the center pane without an inset card, gray surround, shadow or internal rounded frame. Only document content has horizontal padding, so the sticky line-number gutter meets the pane's left edge while code scrolls underneath it. The outer editor clips content and does not introduce a second scroll container. Visual Markdown spacing is independent.

The workbench browser integration checks that the gutter remains aligned with the white frame after horizontal scrolling.
