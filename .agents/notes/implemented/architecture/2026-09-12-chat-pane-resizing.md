# Chat pane sizing and composer layout

The workbench observes its content width and limits the displayed chat width to the space remaining beside the file pane, dividers and editor. The preferred expanded width is persisted separately from this temporary constraint, so reducing the window does not erase the user's preference. Expanded chat has a 280px usable floor; the center yields below 240px only when the window cannot accommodate both.

Dragging below 200px collapses chat to its 48px rail. Dragging back past 240px expands it, providing hysteresis during one gesture. Collapse retains the width from before the gesture; clicking expand restores it. Pointer capture keeps drags working over document previews, and cancellation or window blur ends tracking.

The composer uses a single grid row on wide cards and two full-width rows below 400px. Narrow cards align the model at the left of the second row and send at the right. Model text shrinks within the available width, and the action group reserves room for both send and stop. Narrow chat headers hide action labels while retaining accessible names and tooltips.

The real workbench browser test covers expansion beyond the previous 520px cap, viewport constraints and restoration, drag collapse and expansion, persisted collapse and width, and toolbar geometry across six pane widths. Package component tests retain document and conversation behavior coverage.
