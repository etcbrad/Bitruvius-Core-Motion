# Architecture Baseline (2026-02-17)

## Active Runtime
- Entrypoint: `/Users/bradleygeiser/Updated Model Bitruvius/Bitruvius-Core-Motion/index.tsx`
- Shell: `/Users/bradleygeiser/Updated Model Bitruvius/Bitruvius-Core-Motion/src/rig-adapter/RigCoreV2Shell.tsx`
- Viewport + canvas controls:
  - `/Users/bradleygeiser/Updated Model Bitruvius/Bitruvius-Core-Motion/src/components/SkeletonViewport.tsx`
  - `/Users/bradleygeiser/Updated Model Bitruvius/Bitruvius-Core-Motion/src/components/CanvasCommandWheel.tsx`
- Core engine:
  - `/Users/bradleygeiser/Updated Model Bitruvius/Bitruvius-Core-Motion/src/rig-core/*`

## Frozen Legacy Runtime
- Legacy code moved to `/Users/bradleygeiser/Updated Model Bitruvius/Bitruvius-Core-Motion/legacy`.
- Legacy tree is reference-only and should not receive feature work.

## Quality Gate
- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Tests: `npm run test`
- Full gate: `npm run ci`
