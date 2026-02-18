# Intuitive control scheme (one-pager)

See **docs/AUDIT.md** for full audit and rationale. This file is the implementation checklist for the intuitive posing app.

## Target behavior

| Action | Result |
|--------|--------|
| **Drag** hand, foot, or neck | IK: move end-effector; solver updates chain |
| **Drag** any other joint (shoulder, elbow, knee, waist, etc.) | FK: rotate joint around parent |
| **Drag** root | Translate character (optional ground lock) |
| **Click** (no drag) | Select joint (for refinement and pins) |
| **Wheel / sliders** | Affect selected joint only (rotate, XY, IK target/pole if effector) |

## UI simplification

- **One primary workflow:** "Pose." No separate Pose / Rotate / IK / Compose workflows; behavior is determined by which part you drag.
- **One bar:** Mode label (e.g. "Pose"), view options, optional Settings/Options. Remove workflow row and per-workflow menus.
- **One panel/drawer:** Selection, pins, numeric controls (rotation, XY; IK target/pole when selected joint is an effector). Advanced (solver, stretch, mirror, friction, etc.) in collapsible "Advanced" or second screen.
- **Wheel:** Shown only when a joint is selected; use for rotate + XY. Optional "Fine" toggle; drop axis lock and precision rings for v1.
- **In-app hint:** "Drag any part to pose. Hands and feet move in space; other joints rotate. Click to select for fine-tuning."

## Implementation order

1. **Context-aware drag** in shell/viewport: on drag, if `jointId` is hand/foot/neck → dispatch IK target move; else → FK rotate (or root translate). Keep existing `useRigAdapter` and rig-core; add or reuse actions.
2. **Collapse workflows** in `RigCoreV2Shell`: single "Pose" entry point; remove workflow buttons and workflow-specific menus (or fold into one small menu).
3. **Simplify wheel** usage: single control mode (rotate + XY for selected joint); hide when no selection or when "Full" view.
4. **Reduce viewport hit ambiguity:** Clear handles for hands/feet/neck; one primary hit target per joint/segment.
5. **Sidebar:** One panel with Selection, Pins, Numeric; Advanced collapsed.

## What not to change

- **rig-core** (reducer, FK/IK, pins, topology, serialize).
- **SkeletonViewport** and **CanvasCommandWheel** as components; simplify their *usage* and props from the shell, not necessarily their internals in the first pass.
