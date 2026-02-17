# System Roadmap

## Phase 0: Stabilization Baseline
- [x] Set active runtime boundary (`src/rig-*`).
- [x] Move legacy runtime into `/legacy` and freeze by policy.
- [x] Remove stale external module import map from app shell.
- [x] Add quality gate scripts: typecheck, lint, test, ci.
- [x] Add initial CI workflow.
- [x] Add baseline unit tests for core logic.

## Phase 1: Shell Decomposition
- [ ] Split `RigCoreV2Shell` into focused modules:
  - canvas HUD
  - rig inspector
  - camera panel
  - overlay panel
  - transfer panel
- [ ] Keep `RigCoreV2Shell` as orchestration only.

## Phase 2: Constraint Engine Unification
- [ ] Define a single FK/IK constraint pipeline.
- [ ] Encode manipulation intent explicitly (direct ankle drag, knee lift, root drag).
- [ ] Keep all constraints toggleable with safe defaults.

## Phase 3: Canvas-First UX Simplification
- [ ] Keep minimal always-on HUD on canvas.
- [ ] Make wheel contextual to active selection.
- [ ] Reduce side panel to advanced controls only.

## Phase 4: Data and Persistence Hardening
- [ ] Move transfer schema typing/parsing into `rig-core`.
- [ ] Add local autosave/restore.
- [ ] Version calibration payloads independently of pose snapshots.

## Phase 5: Regression and Performance Program
- [ ] Add FK/IK invariant test matrix.
- [ ] Add Playwright smoke journeys for critical interactions.
- [ ] Add drag/camera performance budget checks.
