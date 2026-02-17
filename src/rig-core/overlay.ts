import { clamp } from "./graph";
import type { JointId, SvgOverlay } from "./types";

export const OVERLAY_SCALE_MIN = 0.1;
export const OVERLAY_SCALE_MAX = 9;
export const OVERLAY_FEATHER_MAX = 8;

export const normalizeOverlayScale = (value: number): number =>
  clamp(value, OVERLAY_SCALE_MIN, OVERLAY_SCALE_MAX);

export const normalizeOverlayAlpha = (value: number): number => clamp(value, 0, 1);

export const normalizeOverlayFeather = (value: number): number =>
  clamp(value, 0, OVERLAY_FEATHER_MAX);

export const createSvgOverlay = (params: {
  id: string;
  name: string;
  dataUrl: string;
  parentJointId?: JointId | null;
}): SvgOverlay => ({
  id: params.id,
  name: params.name,
  dataUrl: params.dataUrl,
  parentJointId: params.parentJointId ?? null,
  childJointId: null,
  offset: { x: 0, y: 0 },
  childOffset: { x: 0, y: 0 },
  rotation: 0,
  scale: 1,
  flipX: false,
  flipY: false,
  visible: true,
  alpha: 1,
  feather: 0,
});

export const applyOverlayPatch = (overlay: SvgOverlay, patch: Partial<SvgOverlay>): SvgOverlay => {
  const updatedOffset = patch.offset
    ? {
        x: patch.offset.x ?? overlay.offset.x,
        y: patch.offset.y ?? overlay.offset.y,
      }
    : overlay.offset;
  const updatedChildOffset = patch.childOffset
    ? {
        x: patch.childOffset.x ?? overlay.childOffset.x,
        y: patch.childOffset.y ?? overlay.childOffset.y,
      }
    : overlay.childOffset;
  const nextScale = normalizeOverlayScale(patch.scale ?? overlay.scale);
  const nextFlipX = patch.flipX ?? overlay.flipX;
  const nextFlipY = patch.flipY ?? overlay.flipY;
  const nextAlpha = patch.alpha !== undefined ? normalizeOverlayAlpha(patch.alpha) : overlay.alpha;
  const nextFeather =
    patch.feather !== undefined ? normalizeOverlayFeather(patch.feather) : overlay.feather;

  return {
    ...overlay,
    ...patch,
    offset: updatedOffset,
    childOffset: updatedChildOffset,
    scale: nextScale,
    flipX: nextFlipX,
    flipY: nextFlipY,
    alpha: nextAlpha,
    feather: nextFeather,
  };
};

export const resetOverlayTransform = (overlay: SvgOverlay): SvgOverlay => ({
  ...overlay,
  offset: { x: 0, y: 0 },
  rotation: 0,
  scale: 1,
  flipX: false,
  flipY: false,
  alpha: 1,
  feather: 0,
  childOffset: { x: 0, y: 0 },
});
