# App Audit: Bitruvius Core Motion

**Date:** 2026-02-17  
**Goal:** Audit current app and recommend a highly intuitive posing app with an intuitive control scheme. UI/presentation is not sacred.

---

## 1. Current Architecture (Summary)

| Layer | Location | Role |
|-------|----------|------|
| Entry | `index.tsx` | Mounts `RigCoreV2Shell` |
| Shell | `src/rig-adapter/RigCoreV2Shell.tsx` | Full UI: layout, workflows, sidebar, canvas menus, wheel, viewport wiring |
| Viewport | `src/components/SkeletonViewport.tsx` | SVG skeleton + joints + IK targets + overlays; pointer/drag events |
| Wheel | `src/components/CanvasCommandWheel.tsx` | Radial control: rotate / XY / scalar; axis lock; precision; ring segments |
| Adapter | `src/rig-adapter/useRigAdapter.ts` | React reducer bridge to `rigReducer`; FK/IK/pins/overlays/scene |
| Core | `src/rig-core/*` | State (`types`, `reducer`), FK/IK (fabrik, ccd, modes), pins, serialize, topology |

- **Rig state:** `RigState` has `mode: "FK" | "IK"`, `joints`, `ikTargets`, `ikPoleTargets`, `pins`, `overlays`, `sceneLayers`, etc.
- **Rendering:** Skeleton is SVG (lines, circles, primitives); no canvas. Viewport uses `viewBox` and display transform for zoom/pan.

---

## 2. Current Control Scheme (What Exists)

### 2.1 Modes and workflows

- **Core mode (rig):** `FK` or `IK`.  
  - **FK:** Drag a joint → rotate around parent (with minimum drag radius); root drag → translate root.  
  - **IK:** Drag an effector target (or pole) → solver moves chain; drag joint can still drive target in some flows.

- **Canvas workflow (UI):** Six workflows: **Pose**, **Compose**, **Rotate**, **IK**, **Play**, **Animation**.  
  Each sets rig mode + wheel primary tool + skeletal/mask visibility:
  - Pose → FK, translate wheel, skeleton-only
  - Compose → FK, translate, masks + skeleton locked
  - Rotate → FK, rotate wheel
  - IK → IK, translate wheel
  - Play → IK, zoom wheel, jump/fall preview
  - Animation → FK, translate

- **Wheel:** `CanvasCommandWheel` has:
  - **Primary tool:** Rotate | Translate | Zoom (drives selected joint rotation, XY, or camera zoom).
  - **Control mode:** rotate | xy | scalar (matches primary tool).
  - **Axis lock:** XY | X | Y.
  - **Precision:** Coarse | Fine.
  - **Ring segments:** 1–3 layers; primary (and optional tertiary) segments for tool selection.
  - Wheel is hidden when "View: Full"; otherwise bottom-left overlay.

- **Selection:** One `selectedJointId`. Set by: dropdown (sidebar/canvas menu) or click on skeleton. Wheel and numeric inputs affect this joint.

### 2.2 Viewport interaction (SkeletonViewport)

- **Root:** Drag root anchor → FK translate root (if enabled).
- **Bones/limbs:** Click/drag on segment or extremity (hand/foot silhouette) → activates parent joint for FK drag (rotation around parent) or, in IK, moves target.
- **Joint dots:** Click → select; drag → same as segment (FK rotate or IK target drag).
- **IK targets:** Shown when `state.mode === "IK"`. Drag target → move IK effector; drag pole → bend (e.g. knee/elbow).
- **Double‑click:** On joint/target in IK → "sticky" IK (target follows pointer until Escape or double‑click again).
- **Pinch:** Touch pinch on viewport → zoom (scale).
- **Overlays:** Parent/child anchors draggable when overlay editing enabled.

### 2.3 Sidebar and chrome

- **Tabs:** Rig | Animation | Model | Camera | Data | SLM.
- **Rig tab:** FK/IK toggle, joint list, rotation/translation inputs, IK target/pole inputs, pin mode (none/world/ground), mirror, turnover, advanced (solver, stretch, friction, clamp reach, etc.).
- **Model:** Same FK/IK + joint dropdown + wheel-like numeric controls; "Advanced" section for solver, stretch, friction, etc.
- **Canvas top bar:** Workflow buttons (1–6), View (Focus/Balanced/Full), Rings, Console toggle, workflow description, Sticky IK chip when active.
- **Canvas menus:** Each workflow can open a dropdown (Pose, Compose, Rotate, IK, Play, Animation) with mode-specific options (e.g. IK scope, solver, stretch).

### 2.4 Other behaviors

- **Mirror:** When enabled, FK rotation on one side applies opposite rotation to mirrored joint.
- **Pins:** World (fix joint at x,y) or ground (fix Y only); cycle per joint (none → world → ground → none).
- **IK scope:** Limb / Upper / Lower / Full; "Apply Scope" / "Activate Scope Targets" / "Reset Scope Filters."
- **Hover help:** Contextual tips for controls matching regex patterns.

---

## 3. Pain Points (Why It’s Not Intuitive)

1. **Too many concepts at once**  
   User must understand: FK vs IK, then six workflow labels, then wheel tool (rotate/translate/zoom), then axis lock and precision. Workflow both changes mode and changes UI (which menu is open, wheel tool). That’s a high cognitive load for "I want to pose a figure."

2. **Redundant and overlapping controls**  
   - FK/IK and joint selection appear in: canvas workflow, canvas Pose menu, sidebar Rig tab, sidebar Model tab, and (for FK/IK) again next to the wheel.  
   - Same numeric controls (rotation, XY, IK target/pole) in sidebar and in canvas menu.  
   - "Pose" vs "Rotate" are both FK; difference is only default wheel tool (translate vs rotate). Easy to miss.

3. **Unclear primary action**  
   - Is the main action "drag on figure" or "select joint then use wheel/sliders"?  
   - Drag semantics depend on mode (FK vs IK) and on what you drag (joint vs target vs pole). Not clearly communicated in one sentence.

4. **Hidden or obscure behaviors**  
   - Sticky IK (double‑click) is powerful but not obvious.  
   - Minimum drag radius for FK rotation can make small adjustments feel broken.  
   - Wheel hidden in "Full" view; rings cycle 1→2→3; axis lock and precision add options without clear benefit for basic posing.

5. **Shell size and navigation**  
   - `RigCoreV2Shell.tsx` is ~7k+ lines. Hard to refactor; workflow logic, layout, and event handlers are intertwined.  
   - Many modules and panels (floating, minimized, tabbed) make it unclear where to look for "pose the character."

6. **Viewport hit targets**  
   - Many overlapping hit areas: primitive segments, extremity silhouettes, hand/foot circles, joint dots, IK targets, pole targets, root anchor. Easy to grab the wrong thing or not know what will move.

---

## 4. Recommended Direction: Intuitive Posing App

Principles: **one primary way to pose**, **minimal mode switching**, **clear affordances**, **progressive disclosure**.

### 4.1 Single primary interaction

- **Primary action:** "Drag on the figure to pose."
  - **Hands and feet:** Drag → IK (move end-effector; solver solves chain). No need to "switch to IK mode" for limbs.
  - **Other joints (shoulder, elbow, knee, waist, etc.):** Drag → FK (rotate around parent). No need to "switch to Rotate workflow."
  - **Root:** Drag root anchor → translate character (optional: lock X and/or Y for "ground plane").
- **Selection:** Click (no drag) = select joint. Selection is for: numeric refinement (wheel or sidebar), pin, or "who gets the next drag." No need for a separate "Pose" vs "Rotate" workflow; the body part implies the behavior.

### 4.2 Single "Pose" workflow (collapse six to one)

- One main mode: **Pose.**  
  - Compose (masks + skeleton) can be a **view toggle** (skeleton only / masks only / both), not a workflow.  
  - Rotate is just "FK on this joint" — already covered by drag.  
  - IK is implied by dragging hands/feet (and optionally neck).  
  - Play (jump/fall) and Animation (timeline) can be **secondary modes** (e.g. "Play" tab or "Animate" tab), not part of the main canvas workflow bar.

- Result: **One canvas bar:** e.g. "Pose" (default) + optional "Animate" / "Play." No Pose vs Rotate vs IK as separate workflows.

### 4.3 Clear, minimal chrome

- **Top bar:** One mode indicator (e.g. "Pose"), view density (optional), and maybe one "Options" or "Settings" that opens a panel/drawer. Remove: separate workflow buttons (1–6), Rings, multiple menus.
- **Wheel:** Only when a joint is selected. Use it for **refinement:** rotate, or XY nudge, or both in one wheel (e.g. inner ring = rotate, outer = XY). Hide axis lock and precision behind "Fine" toggle or remove for v1.
- **Sidebar:** Single panel or drawer: **Selection** (which joint), **Pins** (per joint: none / world / ground), **Numeric** (rotation, XY for selected joint; IK target/pole only when selected joint is an effector). Advanced (solver, stretch, friction, mirror, turnover) in a collapsible "Advanced" section or second page.

### 4.4 Consistent drag semantics and affordances

- **End-effectors (hands, feet, optionally neck):** Always show a clear "handle" (e.g. circle or target icon). Drag = IK. Optionally show a faint "ghost" segment from shoulder/hip to hand/foot so it’s obvious it’s the end of a chain.
- **Other joints:** Drag = rotate around parent. Optional: small arc or hint on hover (e.g. "Rotate" icon or arc). Root: distinct visual (e.g. "move body" icon) so it’s clear drag = translate.
- **No double‑click for core flow:** Sticky IK can be a checkbox or modifier ("Hold Alt and drag to lock target to cursor") instead of double‑click, so it’s discoverable.

### 4.5 Discoverability

- **First-run or persistent hint:** e.g. "Drag any part to pose. Hands and feet move in space; other joints rotate. Click to select for fine-tuning."
- **Tooltips:** One line per control. Remove long hover-help regex list in favor of short, explicit labels.

### 4.6 Implementation priorities

1. **Behavior (no UI change):**  
   - Implement "context-aware" drag: if dragged joint is hand/foot/neck, perform IK move (set target + solve); otherwise FK rotate. Optionally keep a single "FK only" / "IK only" override in settings for power users.

2. **Shell simplification:**  
   - Replace six workflow buttons with one "Pose" (and optionally "Animate" / "Play").  
   - Collapse canvas menus into one small panel (selection, pins, view toggles).  
   - Hide wheel when nothing selected or when "View: Full"; show one simple wheel for selected joint (rotate + XY).

3. **Viewport:**  
   - Reduce overlapping hit areas: prioritize end-effector handles and joint circles; use segment drag only for "parent joint" when click is on segment (current behavior can stay, but ensure one clear "grab" per part).  
   - Optional: dim non-selected joints slightly and highlight selected and its children to show "what will move."

4. **Sidebar:**  
   - One tab or no tabs: Selection (dropdown or tree), Pins, Numeric (rotation, XY, and if effector: IK target/pole). Advanced behind "Advanced" or second screen.

5. **Documentation:**  
   - Short "How to pose" in README or in-app: drag limbs, click to select, use wheel/sliders to refine. List one or two modifiers (e.g. Alt for sticky IK) if kept.

---

## 5. What to Keep (No Need to Throw Away)

- **rig-core:** Keep as-is (reducer, FK/IK, pins, topology, serialize). Only adapter/shell and viewport wiring change.
- **SkeletonViewport:** Keep component; optionally simplify props (e.g. one `onDrag` that receives jointId + world position + "kind": "fk" | "ik" | "root") and consolidate callbacks.
- **CanvasCommandWheel:** Keep component; simplify props (e.g. always "rotate + XY" for selected joint; single "Fine" toggle instead of axis lock + precision).
- **useRigAdapter:** Keep; possibly add one high-level action like `poseJoint(jointId, worldX, worldY, kind)` that dispatches FK or IK internally based on joint type.

---

## 6. Summary

| Current | Recommended |
|--------|-------------|
| 6 workflows (Pose, Compose, Rotate, IK, Play, Animation) | 1 primary "Pose" (+ optional Animate/Play) |
| Explicit FK vs IK mode switch | Context-aware: hands/feet/neck = IK; rest = FK |
| Wheel: rotate / translate / zoom, axis lock, precision, rings | One wheel: rotate + XY for selected joint; optional Fine |
| Many chrome toggles and menus | One top bar, one panel/drawer, Advanced collapsed |
| Double-click = sticky IK | Optional modifier or checkbox |
| Selection + mode + workflow all affect behavior | Click = select; drag = pose (behavior by body part) |

The file base is solid; the main gains come from **simplifying the control model** (one way to pose, behavior by body part) and **reducing chrome and workflow options** so the app feels like a single, intuitive posing tool rather than a multi-mode rig editor.

---

## 7. Quick reference: intuitive control scheme

- **Drag hand/foot/neck** → IK (move end-effector; solver updates chain).
- **Drag any other joint** → FK (rotate around parent).
- **Drag root** → Translate character (optional X/Y lock).
- **Click (no drag)** → Select joint (for wheel/sliders/pins).
- **Wheel** → Only when a joint is selected; rotate + XY nudge; optional "Fine" toggle.
- **One workflow** → "Pose" (default). Animate/Play as separate tabs or secondary mode.
- **Chrome** → Single bar + one panel/drawer; Advanced (solver, stretch, mirror, etc.) collapsed.
- **Copy for in-app hint:** "Drag any part to pose. Hands and feet move in space; other joints rotate. Click to select for fine-tuning."
