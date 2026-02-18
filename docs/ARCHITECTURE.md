# Architecture Baseline (2026-02-17)

## Active Runtime
- Entrypoint: `/Users/bradleygeiser/Updated Model Bitruvius/Bitruvius-Core-Motion/index.tsx`
- Shell: `/Users/bradleygeiser/Updated Model Bitruvius/Bitruvius-Core-Motion/src/rig-adapter/RigCoreV2Shell.tsx`
- Viewport + canvas controls:
  - `/Users/bradleygeiser/Updated Model Bitruvius/Bitruvius-Core-Motion/src/components/SkeletonViewport.tsx`
  - `/Users/bradleygeiser/Updated Model Bitruvius/Bitruvius-Core-Motion/src/components/CanvasCommandWheel.tsx`
- Core engine:
  - `/Users/bradleygeiser/Updated Model Bitruvius/Bitruvius-Core-Motion/src/rig-core/*`

## Legacy Runtime (Isolated Sandbox)
- Legacy code remains under `/Users/bradleygeiser/Updated Model Bitruvius/Bitruvius-Core-Motion/legacy`.
- The legacy tree is excluded from the active runtime and quality gate, and is used for migration reference and isolated experiments only.
- Shippable/runtime work should target `/Users/bradleygeiser/Updated Model Bitruvius/Bitruvius-Core-Motion/src`.

## Quality Gate
- Typecheck: `npm run typecheck`
- Lint: `npm run lint`
- Tests: `npm run test`
- Full gate: `npm run ci`
