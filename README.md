<div align="center">
<img width="1200" height="475" alt="GHBanner" src="https://github.com/user-attachments/assets/0aa67016-6eaf-458a-adb2-6e31a0763ed6" />
</div>

# Bitruvius Core Motion

Active runtime lives in `src/rig-adapter` + `src/rig-core`.
Legacy runtime is isolated under `legacy/` for migration reference and sandbox experiments only; it is not part of the active runtime.

Architecture and roadmap:
- `/Users/bradleygeiser/Updated Model Bitruvius/Bitruvius-Core-Motion/docs/ARCHITECTURE.md`
- `/Users/bradleygeiser/Updated Model Bitruvius/Bitruvius-Core-Motion/docs/ROADMAP.md`

## Local Dev

**Prerequisites:** Node.js

1. `npm install`
2. `npm run dev`

## Quality Gate

- `npm run typecheck`
- `npm run lint`
- `npm run test`
- `npm run ci`
