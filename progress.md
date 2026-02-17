Original prompt: I see the clutter. Right now, the Bitruvius V2 is over-rendering; the masks (the solid geometric blocks) are obscuring the very "surgical, mathematic" logic you're trying to calibrate.

If we are moving into a true Skeleton Mode, we need to strip the visual "flesh" away. The friction you're seeing—that floating arm at 77°—is harder to diagnose when you're looking at a misaligned mask rather than the raw vector of the bone itself.

The Structural Shift

To achieve the precision you're looking for, the Skeleton Mode should function as a "X-Ray" or "Wireframe" toggle that overrides the `maskTransforms` entirely.

- Skeletal View: Reduces the limbs to single-pixel weight lines and circular nodes (joints).
- Anchor Points: Displays the IK targets as crosshairs, showing exactly where the math is trying to pull the limb.
- The Logic Gap: Without the masks, you’ll see that the "floating" issue is actually a Vertex Offset—the line for the upper arm isn't starting at the center of the shoulder joint node.

Revised JSON Implementation

To clean this up, we can add a `renderMode` or `visualState` to your `poseData` that tells the engine to bypass the masks and only draw the hierarchy:

{
  "isIKEnabled": true,
  "renderMode": "skeleton_only",
  "constraints": {
    "showMasks": false,
    "showJoints": true,
    "lineWeight": 1
  }
}

The "Surgical" Next Step

By removing the masks, we can finally see the trigonometry at work. In IK mode, the "Skeleton" will simply be a calculated path between the Collar and the Hand Anchor, with the Elbow acting as the variable hinge.

Would you like me to provide the specific CSS or Canvas logic to hide those mask layers and render the "lines and joints" skeleton instead?

## Notes
- Initialized this file per develop-web-game skill.

## 2026-02-15 - Skeleton Mode Wiring
- Added app-level `renderMode` state (`full` / `skeleton_only`) with pose-data import/export support.
- Added `constraints` payload support: `showMasks`, `showJoints`, `showIKTargets`, `lineWeight`.
- Implemented render override behavior in `App`: when `renderMode === "skeleton_only"`, mask layers are bypassed.
- Routed render controls into `Mannequin` as `rigVisuals` and enabled IK target crosshair visibility controls.
- Removed duplicate hip rig lines in the skeleton rig renderer.
- Verified TypeScript/Vite build passes via `npm run build`.

## 2026-02-15 - Verification
- Started Vite dev server on port 3000 and ran the develop-web-game Playwright client.
- Client run artifacts: `output/web-game/skeleton-mode/shot-0.png`, `output/web-game/skeleton-mode/shot-1.png`.
- No Playwright error files were generated in that run.
- Ran a focused Playwright script to activate rig, switch to `PERF`, and toggle `VISUAL MODE: SKELETON ONLY`.
- Verified output screenshot: `output/web-game/skeleton-mode/skeleton-visual-mode.png`.
- Verified console health file: `output/web-game/skeleton-mode/skeleton-console-errors.json` contains `[]`.

## TODO / Suggestions For Next Agent
- If needed, add a dedicated "Skeleton Mode" quick-toggle near the viewport (outside the side panel) for faster debugging.
- Consider adding persistent storage for `renderMode` and `constraints` (localStorage) so toggles survive refresh.
- Optional: expose `renderMode` in a typed shared model in `types.ts` if pose data evolves further.

## 2026-02-15 - Clear Shapes Without Black Fills
- Added `materialMode` to mannequin rendering to separate textured/default fills from clear placeholder geometry.
- Wired app-level render path so `showMasks: false` in `full` mode now renders clear envelopes (light fill + outline) instead of dark/black blocks.
- In clear material mode, head/collar also fall back to geometric placeholders (no headpiece/collar image overlays).
- Verified build succeeds (`npm run build`).

## 2026-02-15 - Visual Anchor Unification Pass
- Implemented type-level mask mode parity: `MaskTransform.mode` now includes `hidden`.
- Added canonical visual anchor + viewBox metadata (`DEFAULT_VISUAL_ANCHORS`, `DEFAULT_TEXTURE_VIEWBOXES`) to support deterministic texture-to-host fitting.
- Refactored `components/Bone.tsx` mask placement to anchor-fit textures against host root/tip joints (scale/rotation/translation solve), then apply `partOffsets`/`partScales` as post-fit art-direction nudges.
- Unified clip/mask coordinate frame in `Bone`; removed fixed `x/y/width/height` texture boxing assumptions.
- Updated `Bone` clip IDs to be instance-unique (`useId`) to avoid clip-path collisions across ghost + main mannequin layers.
- Unified rendering path in `Mannequin`: head/collar now flow through `Bone` like all other parts; no separate image branches.
- Added `anchorFitEnabled` + `visualAnchorOverrides` state/pose-data round-trip support and parsed `constraints.hideLimbBlocks` in `applyPoseData`.
- Normalized default collar texture path to lowercase (`/collar.svg`) for case-sensitive environments.
- Verification: `npm run build` passes after changes.

## 2026-02-15 - Playwright Validation (develop-web-game skill)
- Started Vite on `http://localhost:3000` and ran Playwright client burst against the updated renderer.
- Initial run could not interact because the helper searches for `<canvas>` and this app is SVG-based; reran with selector click bootstrap.
- Captured screenshots:
  - `output/web-game/anchor-audit/shot-0.png`
  - `output/web-game/anchor-audit/shot-1.png`
- Console/page errors: no `errors-*.json` emitted for this run.

## TODO / Suggestions For Next Agent
- Add explicit in-app controls for `anchorFitEnabled` and per-part visual anchor editing to support iterative calibration without JSON edits.
- Consider adding SVG marker extraction tooling to auto-seed `visualAnchorOverrides` from asset dots/holes.
- If headpiece contrast is intended to be active, add matching `<filter id="contrast-*">` defs in SVG `<defs>`; current URL filters are referenced but not defined.

## 2026-02-15 - Hardcoded Asset Registry (Host-Relative)
- Added `hardcoded_assets` support in pose JSON as a first-class modular registry.
- New schema types:
  - `HardcodedAssetConfig`
  - `HardcodedAssetsMap`
- Renderer integration:
  - `Mannequin` now renders `hardcodedAssets` as host-relative overlays.
  - Supports `host_line`, `render_priority`, `proportions`, `normalized_offset`, `offset`, `anchor_attach`, `visual_logic`, `mode`, `alpha`, optional texture anchors/viewBox.
  - Assets follow host transforms (position + rotation), avoiding absolute world-coordinate drift.
- Pose import/export integration:
  - Export includes `hardcoded_assets`.
  - Import accepts both `hardcoded_assets` and `hardcodedAssets` for compatibility.
- Verification: `npm run build` passes.
- Added default `hardcoded_assets` entries for mirrored forearms and both shins in `App.tsx` (`custom_forearm_l`, `custom_forearm_r`, `custom_shin_l`, `custom_shin_r`) using host-relative anchoring.
- Re-ran `npm run build` after defaults update; build passes.

## 2026-02-16 - Single-Piece Foot (No Toe Primitive)
- Merged toe length into `l_foot` / `r_foot` Primitive sizing (foot rawH now `FOOT + TOE`).
- Removed toe Primitives from rendering and skeleton rig joints (no separate toe mask/primitive).
- Updated pose/editor plumbing to stop exposing toe keys in FK/UI lists and render ordering.
- Skeleton rig now draws a foot segment line to computed foot-tip (keeps skeleton-only mode readable without a toe joint).
- Import compat: legacy `pivotOffsets.l_toe/r_toe` are folded into `l_foot/r_foot` on apply.
- Verification: `npm run build` passes.
- Note: sandbox blocks localhost socket connections (`Operation not permitted`), so Playwright smoke was not re-run from this environment.

## 2026-02-16 - Remove Forearm/Shin Legacy Overlay
- Cleared `DEFAULT_HARDCODED_ASSETS` so the extra forearm/shin overlay pieces no longer render by default.

## 2026-02-16 - IK Bridge Quality Pass
- `applyPoseData` now merges (patches) `partOffsets`, `partScales`, `maskTransforms`, and normalizes partial `maskTransforms`/`ikConstraints` payloads (prevents NaN transforms when users paste minimal JSON blocks).
- IK `bendPriority` is now respected when solving (outer/inner/neutral).
- IK `stretch` is now applied to arm kinematics/Primitives during render (only when target is out of reach and `stretch > 1`).
- Toggling IK on now seeds anchors from current hand joint positions (prevents arm “snap” on enable).

## 2026-02-16 - New Foot Shape Asset
- Replaced default foot texture with `/default-shapes/foot.svg` sourced from the latest asset farm.
- Updated default foot (and legacy toe) viewBoxes to the new 320x223 dimensions.

## 2026-02-16 - Limb Width + Hand Drop
- Default mask transforms now widen biceps/forearms/shins/thighs by 2× (scaleX).
- Hands start one hand-length lower via default part offsets to close the wrist gap.

## 2026-02-16 - Recenter Control
- Added a one-click “Recenter Masks & Primitives” action that resets offsets, scales, mask transforms, anchors, and viewboxes while keeping primitives un-clipped and skeleton-bound.

## 2026-02-16 - Left Leg Mirror
- Flipped the left leg horizontally (mask scaleX negative on thigh/calf/foot) for better bilateral symmetry while keeping right leg standard.

## 2026-02-16 - Slimmer Limbs
- Halved limb primitive widths (biceps, forearms, thighs, shins, feet) via mask scaleX = ±0.5.

## 2026-02-16 - Collar Base + Leg Restore
- Collar primitive now acts as a cervical base block (scaleX 0.4, geometry `base_block`) so shoulder assets can overlap cleanly.
- Reset leg primitives to solid blocks (scale 1.3 on thighs/calves, 1.1 on feet) removing the left-leg “needle” effect and keeping both legs anchored to joints.

## 2026-02-16 - Inverted Triangle Collar + Leg Sync
- Collar re-shaped to an inverted triangle (scale 1.4, topWidth 1.2, bottomWidth 0.1, rounding high) to form a structural bridge between shoulders and spine.
- Waist mask set to circular base (scale 1.3, scaleX 0.8) and collar/waist offsets remain zeroed for centered seating.
- Left/right thigh and calf scales synchronized at 1.3; feet at 1.1 via defaults to keep both legs equally volumetric.

## 2026-02-16 - Asset Swap (User SVGs)
- Updated default textures to user-provided assets: head→`head2collar.svg`, torso→`torso4holes.svg`, waist→`waist.svg`, limbs (biceps/forearms/thighs/shins)→`limbs.svg`, hands/feet→`handpiece.svg`.
- Adjusted texture viewBoxes to match new SVG sizes (head/torso 1504², limbs 1800², hands/feet 1504², waist 1800²).

## 2026-02-16 - Proportion Reset
- Cleared all default part and mask scaling to 1.0 so every piece loads at native proportions from the provided SVGs (no pinching/stretching or shape overrides).

## 2026-02-16 - Vitruvian Primitive Ratios
- Rebuilt primitive proportions to Vitruvian-like ratios (head=1, torso≈2.5 heads, legs≈4 heads total, shoulders≈1.8 head widths) to serve as the geometric frame, with assets fitted unsquished via project-mode masks.

## 2026-02-16 - Anti-Squish Normalization
- Anchor-fit defaults off and imports are forced to scaleX=1; mask images render with aspect-preserving fit.
- Default mask scales boosted to 2.2 (collar/waist), 2.0 (torso), 1.8 (limbs), 1.2 (head) to counter narrow source viewboxes while staying centered; viewBoxCenter default set to y=-300 for 2/3-height framing.
- Pivot offsets zeroed in defaults to eliminate drift from sub-pixel values.

## 2026-02-16 - Mask/Primitive Calibration Decoupling
- Root cause identified: visual mask transforms were still driving structural math.
  - `maskTransforms.scale/scaleX/scaleY` were affecting Primitive width/length in `Mannequin` render.
  - Hip spacing math used texture-derived width proxies (`length * viewBox aspect`), collapsing/overlapping leg roots.
- Fixes applied:
  - Decoupled kinematics from mask/viewBox data: hip spacing now uses kinematic widths (`WAIST_WIDTH` vs `LIMB_WIDTH_THIGH`) only.
  - Decoupled Primitive sizing from `maskTransforms`: Primitive `length/width` now derive from kinematic dimensions + `partScales` only.
  - Mask image transform now receives raw per-part `maskTransform` directly (texture-space adjustment only).
  - `MASK DRAG` move now updates `maskTransforms.x/y` (instead of `partOffsets`), so mask calibration no longer drifts Primitive frames.
  - Restored stable defaults: all `DEFAULT_MASK_TRANSFORMS` reset to neutral scale `1`; `anchorFitEnabled` defaults to `true` (including recenter and import fallback when field is absent).
- Verification:
  - `npm run build` passes.
  - Playwright smoke run captured fresh screenshots at:
    - `output/web-game/mask-calibration/shot-0.png`
    - `output/web-game/mask-calibration/shot-1.png`
  - No `errors-*.json` files were emitted for this run.

## 2026-02-16 - SVG-Only Mask Pass
- Removed Primitive geometry rendering when a mask image exists by suppressing `Bone` stroke pass for masked parts (`shouldRenderStroke = !isCoverMode && !shouldRenderMask`).
- Updated default render constraints to mask-first:
  - `showMasks: true`
  - `showPrimitives: false`
- Updated recenter reset to keep `showPrimitives: false`.
- Moved waist visual frame down by default: `partOffsets.waist.y = 180`.
- Increased head mask scale to 3x default: `maskTransforms.head.scale = 3`.
- Cropped and simplified waist texture asset:
  - `public/default-shapes/waist.svg` now uses a tighter viewBox (`430 450 1040 1010`)
  - Reduced to main silhouette path only (removed secondary detail layers).
- Verification:
  - `npm run build` passes.
  - Playwright screenshot captured: `output/web-game/svg-mask-only/shot-0.png`.

## 2026-02-16 - Waist Removal + Leg Bridge
- Removed waist visual from mannequin render path (`partKey === 'waist'` skipped) and set default waist mask mode to `hidden`.
- Re-anchored hips to torso bottom by using `trans.torso.position` as the leg root base.
- Updated hip spread reference width to torso width (`TORSO_WIDTH`) so upper legs grow from torso-bottom space cleanly.
- Verification:
  - `npm run build` passes.
  - Playwright capture: `output/web-game/no-waist-legs-extended/shot-0.png`.

## 2026-02-16 - Surgical Correction Defaults
- Applied user-requested default calibration profile:
  - `head.scale = 1.5`
  - `collar.scale = 1.4` with `topWidth=1.6`, `bottomWidth=0.1`
  - `torso.scale = 1.8`, `scaleX = 1`
  - `waist.scale = 1.4`
  - `partOffsets.waist` reset to zero
  - `anchorFitEnabled` default/recenter/import-fallback set to `false`
- Updated waist semantics to represent torso-bottom hip socket:
  - `trans.waist` now tracks torso-base position/rotation
  - hip chain now rotates from torso basis (`hiRot = torsoRot + hip`)
  - waist render restored (no longer hard-skipped, no hidden default mode)
  - render order adjusted to draw `torso` before `waist`
- Validation:
  - `npm run build` passes.
  - Playwright capture: `output/web-game/surgical-correction/shot-0.png`.
  - Observation: torso at `1.8` already overfills in this asset profile; increasing to `2.0` would exacerbate drift/overlap.

## 2026-02-16 - Violet Accent Palette Pass
- Shifted UI accent palette from blue/sky to violet across active UI surfaces:
  - `App.tsx` Tailwind accents (`text/bg/border/accent` tokens)
  - `components/Bone.tsx` and `components/Mannequin.tsx` highlight colors
  - `src/components/SkeletonViewport.tsx` skeleton line highlight
  - `src/rig-adapter/RigCoreV2Shell.tsx` active/action buttons and slider accent
- Updated key accent hex values:
  - `#38bdf8` -> `#a78bfa`
  - `#1d4ed8` -> `#7c3aed`
  - `#1e40af` -> `#5b21b6`
- Validation:
  - Playwright run completed against `http://localhost:3000`.
  - Verified screenshot reflects violet controls/accent actions: `output/web-game/shot-0.png`.

## 2026-02-16 - IK Rigid (No Stretch)
- Enforced rigid IK in active `src/rig-core` pipeline so solve updates rotations without rebaking segment translations.
- Removed post-solve pin projection from IK pass:
  - `src/rig-core/ik/modes.ts` now commits FABRIK rotations directly (no `applyPinsToJointState` in IK solve path).
  - `src/rig-core/reducer.ts` now keeps `solved.joints` directly in `maybeRunIkSolve`.
- Removed translation rewrite in chain commit:
  - `src/rig-core/ik/fabrik.ts` no longer recomputes child `localTranslation` from solved world positions.
  - This keeps link lengths rigid during IK (cardboard-cutout behavior).
- Validation:
  - `npm run build` passes.
  - Playwright capture run completes: `output/web-game/shot-0.png`.
  - Note: `npx tsc --noEmit` still reports existing unrelated type errors in legacy `App.tsx`/`components/Mannequin.tsx`.
- Additional rigid-check probe:
  - Programmatically set IK mode `single_chain`, selected joint `l_hand`, target `(1200, -800)`.
  - Diagnostics reported `residual: 1234.887` (target remains unreachable as expected under rigid/no-stretch constraints).
  - Screenshot: `output/web-game/ik-rigid-unreachable.png`.

## 2026-02-16 - Strict IK Stretch Gate
- Added explicit IK stretch toggle state: `ikStretchEnabled` (default `false`).
- Added reducer/action plumbing:
  - new action `SET_IK_STRETCH_ENABLED`
  - `useRigAdapter.setIkStretchEnabled(enabled)`
  - `RigCoreV2Shell` checkbox: `Allow IK Stretch (joint drag only)`.
- Enforced strict stretch conditions in IK solver pipeline:
  - Stretch is allowed only when:
    - `ikStretchEnabled === true`
    - current interaction is skeletal joint drag (`dragState.handle === "joint"`).
  - Numeric IK target edits and target-handle drags remain rigid (no stretch), even with toggle enabled.
- Solver updates:
  - `solveFabrikChain` now accepts `allowStretch`; when target is unreachable and stretch is allowed, segment lengths are scaled for that solve pass.
  - `commitChainPositionsToJoints` now conditionally bakes translations only when `allowStretch` is true; otherwise only rotations are applied.
- Serialization updates:
  - `RigSnapshotV2` now includes `ikStretchEnabled` and restores it on load.
- Validation:
  - `npm run build` passes.
  - Playwright behavioral check output:
    - toggle OFF + far numeric IK target: `residualOff = 1234.887`
    - toggle ON + far numeric IK target: `residualToggleOnTarget = 1234.887`
    - toggle ON + skeletal joint drag: `residualJointDrag = 0`
  - Verification screenshots:
    - `output/web-game/ik-selector-debug.png`
    - `output/web-game/ik-stretch-joint-drag-only.png`

## 2026-02-16 - Ghosting Reintroduced + Release Motion
- Reintroduced viewport ghosting trails in `SkeletonViewport`:
  - Captures recent pose frames and renders faded purple joint/segment echoes while moving.
  - Trail fades over ~420ms and keeps the latest ~10 frames.
- Wired drag lifecycle fully through viewport/shell:
  - Added `onDragEnd` callback to `SkeletonViewport` and connected it to `rig.dragEnd()`.
  - Joint/target drags now call `rig.dragStart(...)` and `rig.dragMove(...)` consistently.
- Added brief IK inertial follow-through after release in `useRigAdapter`:
  - On IK joint/target release, last drag velocity is damped and applied to IK target for a short decay.
  - New drags/target edits cancel active inertia immediately.
- Validation:
  - `npm run build` passes.
  - Playwright captures confirm:
    - ghosting visible during drag: `output/web-game/ghosting-drag.png`
    - continued motion shortly after release: `output/web-game/ghosting-release-early.png`
    - settling after decay: `output/web-game/ghosting-release-late.png`

## 2026-02-16 - Smooth Drag Pass (Friction/Snapping Audit)
- Removed redundant IK update path during drag (was causing duplicate solver runs per pointer move):
  - `handleJointDrag` now relies on `rig.dragMove(...)` for IK and only calls direct joint reposition in FK mode.
  - `handleTargetDrag` now only calls `rig.dragMove(...)` (no extra `ikSetTarget` dispatch).
  - `onJointPointerDown` no longer sends an immediate extra `ikSetTarget` in IK mode.
- Reduced visual snapping by freezing viewport auto-fit during active pointer drag:
  - `SkeletonViewport` now locks viewBox while `dragState` is active and resumes adaptive fit after release.
- Validation:
  - `npm run build` passes.
  - Drag replay capture: `output/web-game/smooth-drag-check.png`.

## 2026-02-16 - ULC Anchor Defaults Unlocked
- Removed default parent/child joint anchoring for new masks:
  - New overlays now start with `parentJointId: null` and `childJointId: null`.
- Made parent anchor optional throughout UI/runtime:
  - Parent dropdown now includes `None` and defaults to blank.
  - Overlay label now displays both parent and child states (`None` when unassigned).
  - Parent/child status and action messages handle null safely.
- Drag behavior with no parent anchor:
  - Parent-anchor drag now directly updates world-space offset when parent is `None`.
- Safety guards:
  - "Place overlay on joint" now requires parent joint to be set; otherwise shows a status warning.
- Validation:
  - `npm run build` passes.

## 2026-02-16 - Start-State Grounding/Framing Pass
- Captured startup screenshot with develop-web-game Playwright loop: `output/web-game/start-state-check/shot-0.png`.
- Root cause (viewport): start-state camera framing favored floor-lock and produced a clipped/low composition; initial lock behavior was also sensitive to pre-measure viewport dimensions.
- Updated `src/components/SkeletonViewport.tsx`:
  - Root anchor marker now renders at `waist` world position (upper/lower body junction).
  - Camera lock now waits for measured viewport dimensions and re-syncs when viewbox aspect shape changes.
  - Vertical framing now fits padded content bounds (`centerY`) so full figure remains visible head-to-toe in start state.
- Verification: `npm run build` passes; refreshed startup screenshot confirms full leg chain visible.

## 2026-02-16 - Camera Zoom-Out + Feet-Bottom Framing
- Captured/inspected startup shots while tuning camera behavior.
- Fixed viewport container sizing in `src/rig-adapter/RigCoreV2Shell.tsx` so the main panel has explicit height (`height: 100%`, `overflow: hidden`), preventing square SVG sizing drift.
- Updated `src/components/SkeletonViewport.tsx` camera framing:
  - Reduced `DEFAULT_MODEL_HEIGHT_FRACTION` to `0.4` (larger visible world area / zoomed out).
  - Bottom-anchored vertical framing to foot world points (with small bottom padding) so feet sit on viewport floor.
- Verification: `npm run build` passes and startup screenshot confirms zoomed-out framing with feet at bottom (`output/web-game/start-state-check/shot-0.png`).

## 2026-02-16 - Root Axis Toggle Logic Refinement
- Implemented independent root-axis toggles in `src/rig-adapter/RigCoreV2Shell.tsx`:
  - `Root X` toggle controls horizontal ground-root authority.
  - `Ground Y` toggle controls whether feet are pinned to ground layer (`y=0`) or ground layer is removed.
- Refined requested behavior chain:
  - X disabled + Y enabled: waist becomes horizontal functional root, ground layer remains active.
  - X disabled + Y disabled: waist remains functional root and ground layer is off.
- Enforced ground layer by pin logic when Y enabled; removes foot ground pins when Y disabled.
- Updated root drag/translation handling so root-axis toggles are respected.
- Updated root anchor rendering in `src/components/SkeletonViewport.tsx`:
  - X from feet split midpoint when `Root X` enabled, else waist x.
  - Y from `0` when `Ground Y` enabled, else waist y.
- Visual verification captures:
  - `output/web-game/root-axis-logic/state-default.png`
  - `output/web-game/root-axis-logic/state-x-off.png`
  - `output/web-game/root-axis-logic/state-x-off-y-off.png`
- Verification: `npm run build` passes.

## 2026-02-16 - Tab-Gated Drag Modes + SLM Layout
- Replaced ULC tab with `SLM` (`Skeletal-lock-Masks`) and added explicit interaction modes:
  - `Skeletals` (bones/joints drag only)
  - `Masks` (mask anchors/editing only)
  - `Lock Both` (skeletal + mask interactions together)
- Added tab-aware interaction gating:
  - `Skeletals` tab forces skeletal-only interaction.
  - `SLM` tab uses chosen mode (`skeletal_only`, `mask_only`, `locked`).
  - Other tabs default to skeletal-only interaction.
- Wired viewport event guards so disabled interaction channels return early / pass `undefined` handlers.
- Added overlay interaction toggle path in `SkeletonViewport` (`overlayInteractionEnabled`) to disable mask pointer operations when masked interaction is off.
- UI polish: in SLM mode, upload/edit controls and mask list become disabled/non-interactive when mask interaction is off.
- Verification:
  - `npm run build` passes.
  - Playwright browser-run in sandbox failed due Chromium permission boundary; reran elevated and captured start screenshot at `output/web-game/slm-gating/start/shot-0.png`.
  - Playwright `click-selector` attempts for `skeletals`/`slm` timed out in this environment, so tab-switch runtime assertions should be validated manually in local interactive dev session.

## 2026-02-16 - Precision Drag + Camera Stabilization Audit Pass
- Audited pointer->solver->camera path and tightened movement for precision-first control.
- `src/rig-adapter/useRigAdapter.ts`:
  - Added precision drag filtering (damped low-pass with per-frame max step and reduced Y gain) so drag input no longer jumps/lifts aggressively.
  - Disabled IK release inertia (`ENABLE_IK_DRAG_INERTIA = false`) to avoid post-release overshoot.
  - Drag start now cancels mode-transition and pending drag queue for cleaner control handoff.
- `src/components/SkeletonViewport.tsx`:
  - Camera lock updates now pause while actively dragging.
  - Increased root drift reset threshold and blended viewBox updates (eased follow) to reduce sudden recenter/zoom churn.
  - Root focus Y now honors ground-root mode using actual ground pin Y when available.
  - View bounds no longer include active IK targets, preventing aggressive auto-zoom when target is moved far.
- Verification: `npm run build` passes.

## 2026-02-16 - Skeletals Overhaul + Skeleton Offset Removal
- Fixed runtime crash caused by lingering `skeletonOffsetX/Y` references after offset state removal.
- Removed skeleton offset controls from Skeletals and Camera tabs.
- Removed skeleton offset usage from viewport display transform (offsets now fixed at 0).
- Removed skeleton offset fields from transfer calibration load path; preserved `skeletonScale`, joint-enabled map, mirror setting.
- Overhauled Skeletals tab for easier FK/IK use:
  - Added explicit `FK Edit` / `IK Edit` mode buttons.
  - Added FK rotation controls in Skeletals (slider + number + nudge buttons).
  - Added IK target controls in Skeletals (X/Y slider + number + clear target).
  - Added IK solver controls in Skeletals (solve mode + stretch toggle).
- Validation: `npm run build` passes.

## 2026-02-17 - Phase 0 Baseline Prep (Roadmap)
- Runtime boundary established:
  - Active runtime remains `index.tsx` -> `src/rig-adapter/RigCoreV2Shell`.
  - Legacy runtime moved to `legacy/` and marked read-only by filesystem permissions.
- App shell cleanup:
  - Removed stale external `importmap` from `index.html`.
- Quality gate added:
  - New scripts: `typecheck`, `lint`, `test`, `ci`.
  - Added ESLint flat config (`eslint.config.js`).
  - Added Vitest config (`vitest.config.ts`) + baseline tests in `src/rig-core/*.test.ts`.
  - Added GitHub Actions workflow: `.github/workflows/ci.yml`.
- Typecheck boundary tightened:
  - `tsconfig.json` now excludes `legacy/` and scopes includes to active runtime.
- Docs:
  - Added `docs/ARCHITECTURE.md` and `docs/ROADMAP.md`.
- Verification:
  - `npm run ci` passes locally end-to-end.

## 2026-02-17 - Default Mask Storage Removal (Primitives + Skeleton Start)
- Removed the default-mask localStorage pipeline from `src/rig-adapter/RigCoreV2Shell.tsx`:
  - deleted `DEFAULT_MASK_STORAGE_KEY`, `StoredMask`, `decodeStoredMasks`, and `encodeStoredMasks`.
  - deleted `persistDefaultMask` / `loadDefaultMasks` and the startup `useEffect` that rehydrated masks.
- Overlay imports no longer write defaults into storage (`applyImportedOverlay` no longer calls `persistDefaultMask`).
- Updated runtime-defaults note in `src/rig-core/defaultOverlays.ts` to reflect that startup defaults are intentionally empty.
- Verification: `npm run ci` passes (typecheck, lint, tests, build).
