import {
  addVec2,
  angleDegOfVec2,
  clamp,
  lengthVec2,
  normalizeAngleDeg,
  normalizeSignedAngleDeg,
  rotateVec2,
  subVec2,
} from "./graph";
import {
  DEFAULT_BACKGROUND_SCENE_LAYER,
  DEFAULT_FOREGROUND_SCENE_LAYER,
  DEFAULT_IMAGE_FILTER_SETTINGS,
  type ImageFilterSettings,
  type JointId,
  type LayerBlendMode,
  type RigWorldTransforms,
  type SceneImageLayer,
  type SvgOverlay,
  type Vec2,
} from "./types";

export const OVERLAY_SCALE_MIN = 0.1;
export const OVERLAY_SCALE_MAX = 9;
export const OVERLAY_FEATHER_MAX = 8;
export const OVERLAY_SEGMENT_SCALE_MIN = 0.45;
export const OVERLAY_SEGMENT_SCALE_MAX = 2.75;
export const SCENE_LAYER_SCALE_MIN = 0.05;
export const SCENE_LAYER_SCALE_MAX = 8;
export const FILTER_BRIGHTNESS_MIN = 0;
export const FILTER_BRIGHTNESS_MAX = 3;
export const FILTER_CONTRAST_MIN = 0;
export const FILTER_CONTRAST_MAX = 3;
export const FILTER_SATURATE_MIN = 0;
export const FILTER_SATURATE_MAX = 3;
export const FILTER_HUE_ROTATE_MIN = -180;
export const FILTER_HUE_ROTATE_MAX = 180;
export const FILTER_BLUR_MIN = 0;
export const FILTER_BLUR_MAX = 24;

export const LAYER_BLEND_MODE_OPTIONS: LayerBlendMode[] = [
  "normal",
  "multiply",
  "screen",
  "overlay",
  "darken",
  "lighten",
  "color-dodge",
  "color-burn",
  "hard-light",
  "soft-light",
];
const LAYER_BLEND_MODE_SET = new Set<LayerBlendMode>(LAYER_BLEND_MODE_OPTIONS);
const OVERLAY_SEGMENT_LENGTH_EPSILON = 1e-4;

export type OverlayRenderPose = {
  position: Vec2;
  rotationDeg: number;
  scaleX: number;
  scaleY: number;
  parentAnchorWorld: Vec2;
  childAnchorWorld: Vec2 | null;
};

export const normalizeOverlayScale = (value: number): number =>
  clamp(value, OVERLAY_SCALE_MIN, OVERLAY_SCALE_MAX);

export const normalizeOverlayAlpha = (value: number): number => clamp(value, 0, 1);

export const normalizeOverlayFeather = (value: number): number =>
  clamp(value, 0, OVERLAY_FEATHER_MAX);

export const normalizeLayerBlendMode = (
  value: unknown,
  fallback: LayerBlendMode = "normal"
): LayerBlendMode =>
  typeof value === "string" && LAYER_BLEND_MODE_SET.has(value as LayerBlendMode)
    ? (value as LayerBlendMode)
    : fallback;

export const normalizeImageFilterSettings = (
  input: Partial<ImageFilterSettings> | undefined,
  fallback: ImageFilterSettings = DEFAULT_IMAGE_FILTER_SETTINGS
): ImageFilterSettings => ({
  brightness: clamp(input?.brightness ?? fallback.brightness, FILTER_BRIGHTNESS_MIN, FILTER_BRIGHTNESS_MAX),
  contrast: clamp(input?.contrast ?? fallback.contrast, FILTER_CONTRAST_MIN, FILTER_CONTRAST_MAX),
  saturate: clamp(input?.saturate ?? fallback.saturate, FILTER_SATURATE_MIN, FILTER_SATURATE_MAX),
  hueRotateDeg: clamp(input?.hueRotateDeg ?? fallback.hueRotateDeg, FILTER_HUE_ROTATE_MIN, FILTER_HUE_ROTATE_MAX),
  blurPx: clamp(input?.blurPx ?? fallback.blurPx, FILTER_BLUR_MIN, FILTER_BLUR_MAX),
  grayscale: clamp(input?.grayscale ?? fallback.grayscale, 0, 1),
  sepia: clamp(input?.sepia ?? fallback.sepia, 0, 1),
  invert: clamp(input?.invert ?? fallback.invert, 0, 1),
});

export const normalizeSceneLayerScale = (value: number): number =>
  clamp(value, SCENE_LAYER_SCALE_MIN, SCENE_LAYER_SCALE_MAX);

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
  segmentRestLength: null,
  segmentRestAngleDeg: null,
  rotation: 0,
  scale: 1,
  flipX: false,
  flipY: false,
  visible: true,
  alpha: 1,
  feather: 0,
  blendMode: "multiply",
  filters: normalizeImageFilterSettings({
    grayscale: 1,
    contrast: 1.1,
  }),
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
  const nextBlendMode = normalizeLayerBlendMode(patch.blendMode, overlay.blendMode);
  const nextFilters = patch.filters
    ? normalizeImageFilterSettings(patch.filters, overlay.filters)
    : overlay.filters;

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
    blendMode: nextBlendMode,
    filters: nextFilters,
  };
};

const resolveParentAnchor = (
  overlay: SvgOverlay,
  world: RigWorldTransforms
): { position: Vec2; jointRotationDeg: number } => {
  const parentJoint = overlay.parentJointId ? world[overlay.parentJointId] : null;
  const parentWorldPosition = parentJoint?.worldPosition ?? { x: 0, y: 0 };
  const parentWorldRotation = parentJoint?.worldRotationDeg ?? 0;
  const rotatedOffset = rotateVec2(overlay.offset, parentWorldRotation);
  return {
    position: addVec2(parentWorldPosition, rotatedOffset),
    jointRotationDeg: parentWorldRotation,
  };
};

const resolveChildAnchor = (overlay: SvgOverlay, world: RigWorldTransforms): Vec2 | null => {
  if (!overlay.childJointId) {
    return null;
  }
  const childJoint = world[overlay.childJointId];
  if (!childJoint) {
    return null;
  }
  return addVec2(
    childJoint.worldPosition,
    rotateVec2(overlay.childOffset, childJoint.worldRotationDeg)
  );
};

export const calibrateOverlaySegmentRestPose = (
  overlay: SvgOverlay,
  world: RigWorldTransforms
): SvgOverlay => {
  const childAnchor = resolveChildAnchor(overlay, world);
  if (!childAnchor) {
    if (overlay.segmentRestLength === null && overlay.segmentRestAngleDeg === null) {
      return overlay;
    }
    return {
      ...overlay,
      segmentRestLength: null,
      segmentRestAngleDeg: null,
    };
  }

  const parentAnchor = resolveParentAnchor(overlay, world).position;
  const segmentVector = subVec2(childAnchor, parentAnchor);
  const segmentLength = lengthVec2(segmentVector);
  if (segmentLength <= OVERLAY_SEGMENT_LENGTH_EPSILON) {
    return {
      ...overlay,
      segmentRestLength: null,
      segmentRestAngleDeg: null,
    };
  }

  return {
    ...overlay,
    segmentRestLength: segmentLength,
    segmentRestAngleDeg: angleDegOfVec2(segmentVector),
  };
};

export const resolveOverlayRenderPose = (
  overlay: SvgOverlay,
  world: RigWorldTransforms
): OverlayRenderPose => {
  const { position: parentAnchorWorld, jointRotationDeg } = resolveParentAnchor(overlay, world);
  const childAnchorWorld = resolveChildAnchor(overlay, world);
  let rotationDeg = normalizeAngleDeg(jointRotationDeg + overlay.rotation);
  let segmentScale = 1;

  if (
    childAnchorWorld &&
    overlay.segmentRestLength !== null &&
    overlay.segmentRestLength > OVERLAY_SEGMENT_LENGTH_EPSILON &&
    overlay.segmentRestAngleDeg !== null
  ) {
    const segmentVector = subVec2(childAnchorWorld, parentAnchorWorld);
    const segmentLength = lengthVec2(segmentVector);
    if (segmentLength > OVERLAY_SEGMENT_LENGTH_EPSILON) {
      const segmentAngle = angleDegOfVec2(segmentVector);
      const deltaAngle = normalizeSignedAngleDeg(segmentAngle - overlay.segmentRestAngleDeg);
      rotationDeg = normalizeAngleDeg(rotationDeg + deltaAngle);
      segmentScale = clamp(
        segmentLength / overlay.segmentRestLength,
        OVERLAY_SEGMENT_SCALE_MIN,
        OVERLAY_SEGMENT_SCALE_MAX
      );
    }
  }

  const signedScaleX = overlay.scale * (overlay.flipX ? -1 : 1) * segmentScale;
  const signedScaleY = overlay.scale * (overlay.flipY ? -1 : 1) * segmentScale;

  return {
    position: parentAnchorWorld,
    rotationDeg,
    scaleX: signedScaleX,
    scaleY: signedScaleY,
    parentAnchorWorld,
    childAnchorWorld,
  };
};

export const resetOverlayTransform = (overlay: SvgOverlay): SvgOverlay => ({
  ...overlay,
  offset: { x: 0, y: 0 },
  childOffset: { x: 0, y: 0 },
  segmentRestLength: null,
  segmentRestAngleDeg: null,
  rotation: 0,
  scale: 1,
  flipX: false,
  flipY: false,
  alpha: 1,
  feather: 0,
  blendMode: "multiply",
  filters: normalizeImageFilterSettings({
    grayscale: 1,
    contrast: 1.1,
  }),
});

export const applySceneLayerPatch = (
  layer: SceneImageLayer,
  patch: Partial<SceneImageLayer>
): SceneImageLayer => {
  const nextScaleX = patch.transform?.scaleX ?? layer.transform.scaleX;
  const nextScaleY = patch.transform?.scaleY ?? layer.transform.scaleY;
  return {
    ...layer,
    ...patch,
    alpha: patch.alpha !== undefined ? normalizeOverlayAlpha(patch.alpha) : layer.alpha,
    blendMode: normalizeLayerBlendMode(patch.blendMode, layer.blendMode),
    filters: patch.filters
      ? normalizeImageFilterSettings(patch.filters, layer.filters)
      : layer.filters,
    transform: patch.transform
      ? {
          x: patch.transform.x ?? layer.transform.x,
          y: patch.transform.y ?? layer.transform.y,
          rotation: patch.transform.rotation ?? layer.transform.rotation,
          scaleX: normalizeSceneLayerScale(nextScaleX),
          scaleY: normalizeSceneLayerScale(nextScaleY),
        }
      : layer.transform,
  };
};

export const createDefaultBackgroundLayer = (): SceneImageLayer => ({
  ...DEFAULT_BACKGROUND_SCENE_LAYER,
  filters: { ...DEFAULT_BACKGROUND_SCENE_LAYER.filters },
  transform: { ...DEFAULT_BACKGROUND_SCENE_LAYER.transform },
});

export const createDefaultForegroundLayer = (): SceneImageLayer => ({
  ...DEFAULT_FOREGROUND_SCENE_LAYER,
  filters: { ...DEFAULT_FOREGROUND_SCENE_LAYER.filters },
  transform: { ...DEFAULT_FOREGROUND_SCENE_LAYER.transform },
});
