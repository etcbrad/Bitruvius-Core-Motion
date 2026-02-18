import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import {
  addVec2,
  computeWorldTransforms,
  lengthVec2,
  normalizeAngleDeg,
  normalizeVec2,
  rotateVec2,
  scaleVec2,
  subVec2,
} from "../rig-core/graph";
import { applyPinsToWorldTransforms } from "../rig-core/pins";
import { resolveOverlayRenderPose } from "../rig-core/overlay";
import {
  ImageFilterSettings,
  JointId,
  JOINT_IDS,
  JointState,
  LayerBlendMode,
  PinConstraint,
  RigSceneLayers,
  RigState,
  Vec2,
} from "../rig-core/types";
import { ACTIVATION_PARENT_BY_CHILD } from "../rig-core/topology";

export type SkeletonDisplayTransform = {
  offsetX: number;
  offsetY: number;
  scale: number;
};

export type RotationPreviewPath = {
  jointId: JointId;
  pivot: Vec2;
  points: Vec2[];
};

export type SkeletonViewportExportLayerMode =
  | "composite"
  | "skeleton"
  | "joints"
  | "masks"
  | "background"
  | "foreground";

type SkeletonViewportProps = {
  state: RigState;
  width?: number | string;
  height?: number | string;
  className?: string;
  primitiveTurnoverEnabled?: boolean;
  sceneLayers?: RigSceneLayers;
  renderIntent?: "interactive" | "export";
  exportLayerMode?: SkeletonViewportExportLayerMode;
  canvasBackground?: string;
  displayTransform?: SkeletonDisplayTransform;
  limbStacking?: "left_over_right" | "right_over_left";
  rootAnchorUseGroundX?: boolean;
  rootAnchorUseGroundY?: boolean;
  cameraZoomPreset?: "far" | "medium" | "close";
  cameraZoomMultiplier?: number;
  cameraFocusMode?: "root_pin" | "selected_joint" | "static";
  cleanFkMode?: boolean;
  jointEnabledMap?: Partial<Record<JointId, boolean>>;
  skeletonVisible?: boolean;
  jointsVisible?: boolean;
  masksVisible?: boolean;
  jointVisibilityMap?: Partial<Record<JointId, boolean>>;
  skeletonVisibilityMap?: Partial<Record<JointId, boolean>>;
  overlayInteractionEnabled?: boolean;
  manakinMode?: boolean;
  parallaxLayersEnabled?: boolean;
  rotationPreview?: RotationPreviewPath | null;
  targetDisplayPositions?: Partial<Record<JointId, Vec2>>;
  onJointPointerDown?: (
    jointId: JointId,
    x: number,
    y: number,
    event: React.PointerEvent<SVGElement>
  ) => void;
  onJointClick?: (jointId: JointId) => void;
  onTargetPointerDown?: (
    jointId: JointId,
    x: number,
    y: number,
    event: React.PointerEvent<SVGGElement>
  ) => void;
  onPoleTargetPointerDown?: (
    jointId: JointId,
    x: number,
    y: number,
    event: React.PointerEvent<SVGGElement>
  ) => void;
  onJointDrag?: (
    jointId: JointId,
    x: number,
    y: number,
    event: React.PointerEvent<SVGSVGElement>
  ) => void;
  onTargetDrag?: (
    jointId: JointId,
    x: number,
    y: number,
    event: React.PointerEvent<SVGSVGElement>
  ) => void;
  onPoleTargetDrag?: (
    jointId: JointId,
    x: number,
    y: number,
    event: React.PointerEvent<SVGSVGElement>
  ) => void;
  onViewportPointerMove?: (
    x: number,
    y: number,
    event: React.PointerEvent<SVGSVGElement>
  ) => void;
  onDragEnd?: () => void;
  onPinchZoom?: (scaleMultiplier: number) => void;
  onOverlayAnchorDragMove?: (
    overlayId: string,
    anchor: "parent" | "child",
    x: number,
    y: number,
    event: React.PointerEvent<SVGSVGElement>
  ) => void;
  onOverlayAnchorDragEnd?: (overlayId: string, anchor: "parent" | "child") => void;
};

type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
};

type ParsedViewBox = {
  x: number;
  y: number;
  width: number;
  height: number;
};

const expandBounds = (bounds: Bounds, point: Vec2): Bounds => ({
  minX: Math.min(bounds.minX, point.x),
  minY: Math.min(bounds.minY, point.y),
  maxX: Math.max(bounds.maxX, point.x),
  maxY: Math.max(bounds.maxY, point.y),
});

const createInitialBounds = (): Bounds => ({
  minX: Number.POSITIVE_INFINITY,
  minY: Number.POSITIVE_INFINITY,
  maxX: Number.NEGATIVE_INFINITY,
  maxY: Number.NEGATIVE_INFINITY,
});

const parseViewBox = (value: string): ParsedViewBox | null => {
  const parts = value.trim().split(/\s+/).map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isFinite(part))) {
    return null;
  }
  return {
    x: parts[0],
    y: parts[1],
    width: parts[2],
    height: parts[3],
  };
};

const roundViewBoxValue = (value: number): number => {
  const scale = 10 ** CAMERA_VIEWBOX_PRECISION;
  return Math.round(value * scale) / scale;
};

const serializeViewBox = (box: ParsedViewBox): string =>
  String(roundViewBoxValue(box.x)) + " " +
  String(roundViewBoxValue(box.y)) + " " +
  String(roundViewBoxValue(box.width)) + " " +
  String(roundViewBoxValue(box.height));

const viewBoxValueDiffers = (a: number, b: number, threshold: number): boolean =>
  Math.abs(roundViewBoxValue(a) - roundViewBoxValue(b)) > threshold;

const toCssBlendMode = (blendMode: LayerBlendMode): React.CSSProperties["mixBlendMode"] =>
  blendMode === "normal" ? "normal" : blendMode;

const toCssFilter = (filters: ImageFilterSettings, extraBlurPx = 0): string => {
  const blurPx = Math.max(0, filters.blurPx + extraBlurPx);
  return [
    `brightness(${filters.brightness})`,
    `contrast(${filters.contrast})`,
    `saturate(${filters.saturate})`,
    `hue-rotate(${filters.hueRotateDeg}deg)`,
    `blur(${blurPx}px)`,
    `grayscale(${filters.grayscale})`,
    `sepia(${filters.sepia})`,
    `invert(${filters.invert})`,
  ].join(" ");
};

const toPreserveAspectRatio = (fitMode: "cover" | "contain" | "stretch"): string => {
  if (fitMode === "stretch") {
    return "none";
  }
  return fitMode === "cover" ? "xMidYMid slice" : "xMidYMid meet";
};

// Lower fill fraction = zoomed-out framing (show a larger world area).
const DEFAULT_MODEL_HEIGHT_FRACTION = 0.4;
const PRIMITIVE_PADDING_PX = 76;
const FOOT_BOTTOM_PADDING_PX = 10;
const OVERLAY_IMAGE_SIZE = 200;
const OVERLAY_ANCHOR_SIZE = 44;
const OVERLAY_ANCHOR_SCALE = 0.28;
const ROOT_ANCHOR_RADIUS = 10;
const SHIN_WIDTH = 12;
const HAND_PRIMITIVE_LENGTH = 10.5;
const HAND_PRIMITIVE_WRIST_BACK = 4.2;
const FOOT_PRIMITIVE_LENGTH = 14.5;
const FOOT_PRIMITIVE_HEEL_BACK = 7;
const CAMERA_ROOT_DRIFT_RESET_THRESHOLD = 120;
const CAMERA_VIEWBOX_EASE = 0.14;
const CAMERA_VIEWBOX_DRIFT_EASE = 0.24;
const CAMERA_VIEWBOX_COMMIT_EPSILON = 1e-3;
const CAMERA_VIEWBOX_PRECISION = 4;
const JOINT_VISUAL_INTERPOLATION_ALPHA = 0.3;
const JOINT_VISUAL_INTERPOLATION_DRAG_ALPHA = 0.52;
const JOINT_VISUAL_TRANSLATION_MAX_STEP = 48;
const JOINT_VISUAL_ROTATION_MAX_STEP_DEG = 20;
const JOINT_VISUAL_TRANSLATION_SNAP = 0.05;
const JOINT_VISUAL_ROTATION_SNAP_DEG = 0.06;
const POINTER_DRAG_ACTIVATION_MOUSE_PX = 0.75;
const POINTER_DRAG_ACTIVATION_PEN_PX = 1.2;
const POINTER_DRAG_ACTIVATION_TOUCH_PX = 6;
const DRAG_CLICK_SUPPRESS_MS = 220;
const ROOT_ANCHOR_HIT_RADIUS_PAD = 19;
const JOINT_HIT_RADIUS_PAD = 8;
const TARGET_HIT_RADIUS = 22;
const POLE_HIT_SIZE = 32;
const ROLE_COLORS = {
  anchor: "#dc2626",
  parent: "#7c3aed",
  child: "#16a34a",
} as const;
const HAND_JOINT_SET = new Set<JointId>(["l_hand", "r_hand"]);
const FOOT_JOINT_SET = new Set<JointId>(["l_foot", "r_foot"]);
const EXTREMITY_JOINT_SET = new Set<JointId>([
  ...Array.from(HAND_JOINT_SET),
  ...Array.from(FOOT_JOINT_SET),
]);
const getPrimitiveActivationJointId = (childId: JointId, parentId: JointId): JointId =>
  ACTIVATION_PARENT_BY_CHILD[childId] ?? parentId;
const getPointerDragActivationPx = (pointerType: string | undefined): number => {
  if (pointerType === "touch") {
    return POINTER_DRAG_ACTIVATION_TOUCH_PX;
  }
  if (pointerType === "pen") {
    return POINTER_DRAG_ACTIVATION_PEN_PX;
  }
  return POINTER_DRAG_ACTIVATION_MOUSE_PX;
};

type ViewportDragState =
  | { kind: "joint"; pointerId: number; jointId: JointId }
  | { kind: "target"; pointerId: number; jointId: JointId }
  | { kind: "pole"; pointerId: number; jointId: JointId }
  | { kind: "overlay-anchor"; pointerId: number; overlayId: string; anchor: "parent" | "child" };

type JointBlendResult = {
  joints: Record<JointId, JointState>;
  settled: boolean;
};

const cloneJointStateMap = (joints: Record<JointId, JointState>): Record<JointId, JointState> => {
  const next = {} as Record<JointId, JointState>;
  for (const jointId of JOINT_IDS) {
    const joint = joints[jointId];
    next[jointId] = {
      ...joint,
      localTranslation: { ...joint.localTranslation },
    };
  }
  return next;
};

const shortestRotationDelta = (fromDeg: number, toDeg: number): number => {
  const normalized = normalizeAngleDeg(toDeg - fromDeg);
  return normalized > 180 ? normalized - 360 : normalized;
};

const blendJointStateMap = (
  current: Record<JointId, JointState>,
  target: Record<JointId, JointState>,
  alpha: number,
  maxTranslationStep: number,
  maxRotationStepDeg: number
): JointBlendResult => {
  const eased = Math.max(0, Math.min(1, alpha));
  const next = {} as Record<JointId, JointState>;
  let settled = true;
  let changed = false;

  for (const jointId of JOINT_IDS) {
    const fromJoint = current[jointId];
    const toJoint = target[jointId];

    const fromRotation = fromJoint.localRotationDegRaw;
    const rotationDelta = shortestRotationDelta(fromRotation, toJoint.localRotationDegRaw);
    const rotationSettled = Math.abs(rotationDelta) <= JOINT_VISUAL_ROTATION_SNAP_DEG;
    const rotationStep = rotationSettled
      ? rotationDelta
      : Math.max(-maxRotationStepDeg, Math.min(maxRotationStepDeg, rotationDelta * eased));
    const nextRotation = normalizeAngleDeg(fromRotation + rotationStep);

    const dx = toJoint.localTranslation.x - fromJoint.localTranslation.x;
    const dy = toJoint.localTranslation.y - fromJoint.localTranslation.y;
    const distance = Math.hypot(dx, dy);
    const translationSettled = distance <= JOINT_VISUAL_TRANSLATION_SNAP;
    const translationStep = translationSettled
      ? distance
      : Math.min(distance, Math.max(0.8, Math.min(maxTranslationStep, distance * eased)));
    const translationT = distance > 1e-9 ? translationStep / distance : 1;
    const nextTranslation = {
      x: fromJoint.localTranslation.x + dx * translationT,
      y: fromJoint.localTranslation.y + dy * translationT,
    };

    const nextJoint: JointState = {
      ...fromJoint,
      parentId: toJoint.parentId,
      length: toJoint.length,
      localRotationDegRaw: rotationSettled ? normalizeAngleDeg(toJoint.localRotationDegRaw) : nextRotation,
      localTranslation: translationSettled
        ? { ...toJoint.localTranslation }
        : nextTranslation,
    };
    next[jointId] = nextJoint;
    if (
      Math.abs(nextJoint.localRotationDegRaw - fromJoint.localRotationDegRaw) > 1e-6 ||
      Math.abs(nextJoint.localTranslation.x - fromJoint.localTranslation.x) > 1e-6 ||
      Math.abs(nextJoint.localTranslation.y - fromJoint.localTranslation.y) > 1e-6
    ) {
      changed = true;
    }
    if (!rotationSettled || !translationSettled) {
      settled = false;
    }
  }

  return {
    joints: changed ? next : current,
    settled,
  };
};

const getPrimitiveStrokeWidth = (childId: JointId): number => {
  if (childId === "torso") {
    return 30;
  }
  if (childId === "collar") {
    return 24;
  }
  if (childId === "neck") {
    return 18;
  }
  if (childId === "waist") {
    return 26;
  }
  if (
    childId === "l_shoulder" ||
    childId === "r_shoulder" ||
    childId === "l_hip" ||
    childId === "r_hip"
  ) {
    return 18;
  }
  if (
    childId === "l_elbow" ||
    childId === "r_elbow" ||
    childId === "l_knee" ||
    childId === "r_knee"
  ) {
    return 14;
  }
  if (
    childId === "l_hand" ||
    childId === "r_hand" ||
    childId === "l_foot" ||
    childId === "r_foot"
  ) {
    return 12;
  }
  return 10;
};

export const SkeletonViewport: React.FC<SkeletonViewportProps> = ({
  state,
  width = "100%",
  height = "100%",
  className,
  primitiveTurnoverEnabled = false,
  sceneLayers,
  renderIntent = "interactive",
  exportLayerMode = "composite",
  canvasBackground = "#ffffff",
  displayTransform,
  limbStacking = "left_over_right",
  rootAnchorUseGroundX = true,
  rootAnchorUseGroundY = true,
  cameraZoomPreset = "medium",
  cameraZoomMultiplier = 1,
  cameraFocusMode = "static",
  cleanFkMode = false,
  jointEnabledMap,
  skeletonVisible = true,
  jointsVisible = true,
  masksVisible = true,
  jointVisibilityMap,
  skeletonVisibilityMap,
  overlayInteractionEnabled = true,
  manakinMode = false,
  parallaxLayersEnabled = false,
  rotationPreview = null,
  targetDisplayPositions,
  onJointPointerDown,
  onJointClick,
  onTargetPointerDown,
  onPoleTargetPointerDown,
  onJointDrag,
  onTargetDrag,
  onPoleTargetDrag,
  onViewportPointerMove,
  onDragEnd,
  onPinchZoom,
  onOverlayAnchorDragMove,
  onOverlayAnchorDragEnd,
}) => {
  const svgRef = useRef<SVGSVGElement | null>(null);
  const stableViewBoxRef = useRef("-200 -200 400 400");
  const lastCommittedLockedViewBoxRef = useRef<string | null>(null);
  const [cameraLockedViewBox, setCameraLockedViewBox] = useState<string | null>(null);
  const [dragState, setDragState] = useState<ViewportDragState | null>(null);
  const [viewportSize, setViewportSize] = useState({ width: 1, height: 1 });
  const [hoveredTargetJointId, setHoveredTargetJointId] = useState<JointId | null>(null);
  const [ghostNowMs, setGhostNowMs] = useState(() => Date.now());
  const [ghostFrames, setGhostFrames] = useState<Array<{ t: number; positions: Record<JointId, Vec2> }>>([]);
  const [visualJoints, setVisualJoints] = useState<Record<JointId, JointState>>(() =>
    cloneJointStateMap(state.joints)
  );
  const visualJointsRef = useRef<Record<JointId, JointState>>(cloneJointStateMap(state.joints));
  const ghostFramesRef = useRef<Array<{ t: number; positions: Record<JointId, Vec2> }>>([]);
  const touchPointsRef = useRef<Map<number, Vec2>>(new Map());
  const pinchDistanceRef = useRef<number | null>(null);
  const dragMotionRef = useRef<{
    pointerId: number;
    startX: number;
    startY: number;
    pointerType: string;
    moved: boolean;
  } | null>(null);
  const suppressClickUntilRef = useRef<number>(0);
  const exportIntent = renderIntent === "export";
  const activeSceneLayers = sceneLayers ?? state.sceneLayers;
  const includeBackgroundLayer =
    exportLayerMode === "composite" || exportLayerMode === "background";
  const includeForegroundLayer =
    exportLayerMode === "composite" || exportLayerMode === "foreground";
  const includeSkeletonLayer =
    exportLayerMode === "composite" || exportLayerMode === "skeleton";
  const includeJointLayer =
    exportLayerMode === "composite" || exportLayerMode === "joints";
  const includeMaskLayer =
    exportLayerMode === "composite" || exportLayerMode === "masks";
  const skeletonLayerVisible = skeletonVisible && (!exportIntent || includeSkeletonLayer);
  const jointsLayerVisible = jointsVisible && (!exportIntent || includeJointLayer);
  const masksLayerVisible = masksVisible && (!exportIntent || includeMaskLayer);
  const showIkTargets = !exportIntent && state.mode === "IK";
  const ghostPreviewActive =
    Boolean(dragState) || Boolean(rotationPreview && rotationPreview.points.length > 1);
  const showMotionTrails =
    !exportIntent && (!cleanFkMode || ghostPreviewActive || ghostFrames.length > 0);
  const showBalanceOverlay = !exportIntent && !cleanFkMode;
  const showHelpers = !exportIntent;

  useEffect(() => {
    visualJointsRef.current = visualJoints;
  }, [visualJoints]);

  useEffect(() => {
    const target = cloneJointStateMap(state.joints);
    if (exportIntent) {
      visualJointsRef.current = target;
      setVisualJoints(target);
      return;
    }

    let rafId: number | null = null;
    let cancelled = false;

    const step = () => {
      if (cancelled) {
        return;
      }
      const isInteracting = Boolean(dragState);
      const alpha = isInteracting ? JOINT_VISUAL_INTERPOLATION_DRAG_ALPHA : JOINT_VISUAL_INTERPOLATION_ALPHA;
      const translationStep = isInteracting
        ? JOINT_VISUAL_TRANSLATION_MAX_STEP * 1.35
        : JOINT_VISUAL_TRANSLATION_MAX_STEP;
      const rotationStep = isInteracting
        ? JOINT_VISUAL_ROTATION_MAX_STEP_DEG * 1.35
        : JOINT_VISUAL_ROTATION_MAX_STEP_DEG;
      const blended = blendJointStateMap(
        visualJointsRef.current,
        target,
        alpha,
        translationStep,
        rotationStep
      );
      visualJointsRef.current = blended.joints;
      setVisualJoints(blended.joints);

      if (!blended.settled) {
        if (typeof window !== "undefined" && typeof window.requestAnimationFrame === "function") {
          rafId = window.requestAnimationFrame(step);
        }
      }
    };

    step();
    return () => {
      cancelled = true;
      if (
        rafId !== null &&
        typeof window !== "undefined" &&
        typeof window.cancelAnimationFrame === "function"
      ) {
        window.cancelAnimationFrame(rafId);
      }
    };
  }, [dragState, exportIntent, state.joints]);

  const world = useMemo(() => {
    const computed = computeWorldTransforms(exportIntent ? state.joints : visualJoints);
    return applyPinsToWorldTransforms(computed, state.pins).world;
  }, [exportIntent, state.joints, state.pins, visualJoints]);

  const parentJointSet = useMemo(() => {
    const set = new Set<JointId>();
    for (const jointId of JOINT_IDS) {
      const parentId = world[jointId].parentId;
      if (parentId) {
        set.add(parentId);
      }
    }
    return set;
  }, [world]);

  const safeScale = Math.max(0.001, displayTransform?.scale ?? 1);
  const safeOffsetX = displayTransform?.offsetX ?? 0;
  const safeOffsetY = displayTransform?.offsetY ?? 0;

  const toDisplay = useCallback(
    (point: Vec2): Vec2 => ({
      x: point.x * safeScale + safeOffsetX,
      y: point.y * safeScale + safeOffsetY,
    }),
    [safeOffsetX, safeOffsetY, safeScale]
  );

  const fromDisplay = useCallback(
    (point: Vec2): Vec2 => ({
      x: (point.x - safeOffsetX) / safeScale,
      y: (point.y - safeOffsetY) / safeScale,
    }),
    [safeOffsetX, safeOffsetY, safeScale]
  );

  const collarDisplay = world.collar ? toDisplay(world.collar.worldPosition) : null;
  const torsoDisplay = world.torso ? toDisplay(world.torso.worldPosition) : null;
  const waistDisplay = world.waist ? toDisplay(world.waist.worldPosition) : null;
  const torsoRibbonSpread =
    collarDisplay && waistDisplay
      ? Math.max(10, Math.abs(collarDisplay.x - waistDisplay.x) * 0.35)
      : 0;
  const torsoAccentSpread = Math.max(6, torsoRibbonSpread * 0.6);
  const torsoRibbonPath =
    collarDisplay && torsoDisplay && waistDisplay
      ? [
          `M ${collarDisplay.x - torsoRibbonSpread} ${collarDisplay.y + 4}`,
          `C ${collarDisplay.x - torsoRibbonSpread} ${torsoDisplay.y - 8}, ${waistDisplay.x - torsoRibbonSpread} ${torsoDisplay.y - 6}, ${waistDisplay.x - torsoRibbonSpread} ${waistDisplay.y}`,
          `L ${waistDisplay.x + torsoRibbonSpread} ${waistDisplay.y}`,
          `C ${waistDisplay.x + torsoRibbonSpread} ${torsoDisplay.y - 6}, ${collarDisplay.x + torsoRibbonSpread} ${torsoDisplay.y - 8}, ${collarDisplay.x + torsoRibbonSpread} ${collarDisplay.y + 4}`,
          "Z",
        ].join(" ")
      : "";
  const torsoAccentPath =
    collarDisplay && torsoDisplay && waistDisplay
      ? [
          `M ${collarDisplay.x - torsoAccentSpread} ${collarDisplay.y + 8}`,
          `C ${collarDisplay.x - torsoAccentSpread} ${torsoDisplay.y - 4}, ${waistDisplay.x - torsoAccentSpread} ${torsoDisplay.y - 2}, ${waistDisplay.x - torsoAccentSpread} ${waistDisplay.y}`,
          `L ${waistDisplay.x + torsoAccentSpread} ${waistDisplay.y}`,
          `C ${waistDisplay.x + torsoAccentSpread} ${torsoDisplay.y - 2}, ${collarDisplay.x + torsoAccentSpread} ${torsoDisplay.y - 4}, ${collarDisplay.x + torsoAccentSpread} ${collarDisplay.y + 8}`,
          "Z",
        ].join(" ")
      : "";
  const waistEllipseRx =
    waistDisplay && torsoDisplay ? 26 + Math.abs(waistDisplay.x - torsoDisplay.x) * 0.25 : 26;
  const waistEllipseRy =
    waistDisplay && torsoDisplay ? 12 + Math.abs(waistDisplay.y - torsoDisplay.y) * 0.18 : 12;

  const isJointEnabled = useCallback(
    (jointId: JointId): boolean => jointEnabledMap?.[jointId] !== false,
    [jointEnabledMap]
  );
  const isJointVisible = useCallback(
    (jointId: JointId): boolean => jointVisibilityMap?.[jointId] !== false,
    [jointVisibilityMap]
  );
  const isSkeletonJointVisible = useCallback(
    (jointId: JointId): boolean => skeletonVisibilityMap?.[jointId] !== false,
    [skeletonVisibilityMap]
  );

  const cameraZoomFraction = useMemo(() => {
    if (cameraZoomPreset === "far") {
      return 0.25;
    }
    if (cameraZoomPreset === "close") {
      return 0.72;
    }
    return DEFAULT_MODEL_HEIGHT_FRACTION;
  }, [cameraZoomPreset]);

  const clientToSvgPoint = useCallback((clientX: number, clientY: number): Vec2 | null => {
    const svg = svgRef.current;
    if (!svg) {
      return null;
    }
    const ctm = svg.getScreenCTM();
    if (!ctm) {
      return null;
    }
    const point = svg.createSVGPoint();
    point.x = clientX;
    point.y = clientY;
    const transformed = point.matrixTransform(ctm.inverse());
    return { x: transformed.x, y: transformed.y };
  }, []);

  const clearDrag = useCallback(() => {
    const dragMotion = dragMotionRef.current;
    if (dragMotion?.moved) {
      suppressClickUntilRef.current = Date.now() + DRAG_CLICK_SUPPRESS_MS;
    }
    if (dragState) {
      const svg = svgRef.current;
      if (svg?.hasPointerCapture(dragState.pointerId)) {
        svg.releasePointerCapture(dragState.pointerId);
      }
      if (dragState.kind === "overlay-anchor") {
        onOverlayAnchorDragEnd?.(dragState.overlayId, dragState.anchor);
      }
    }
    setDragState(null);
    setHoveredTargetJointId(null);
    dragMotionRef.current = null;
    onDragEnd?.();
    touchPointsRef.current.clear();
    pinchDistanceRef.current = null;
  }, [dragState, onDragEnd, onOverlayAnchorDragEnd]);

  const shouldSuppressClick = useCallback((): boolean => Date.now() < suppressClickUntilRef.current, []);

  const handleSvgPointerDown = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      if (event.pointerType !== "touch") {
        return;
      }
      touchPointsRef.current.set(event.pointerId, { x: event.clientX, y: event.clientY });
      if (touchPointsRef.current.size === 2) {
        const points = Array.from(touchPointsRef.current.values());
        pinchDistanceRef.current = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
      }
    },
    []
  );

  useLayoutEffect(() => {
    const svg = svgRef.current;
    if (!svg) {
      return;
    }

    const updateSize = () => {
      const widthPx = Math.max(1, svg.clientWidth || 1);
      const heightPx = Math.max(1, svg.clientHeight || 1);
      setViewportSize((prev) =>
        prev.width === widthPx && prev.height === heightPx
          ? prev
          : { width: widthPx, height: heightPx }
      );
    };

    updateSize();

    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", updateSize);
      return () => window.removeEventListener("resize", updateSize);
    }

    const observer = new ResizeObserver(updateSize);
    observer.observe(svg);
    return () => observer.disconnect();
  }, []);

  const handleJointDragStart = useCallback(
    (jointId: JointId, event: React.PointerEvent<SVGElement>) => {
      if (!isJointEnabled(jointId) || !onJointDrag) {
        return;
      }
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }
      event.preventDefault();
      const captureTarget = svgRef.current ?? event.currentTarget;
      captureTarget.setPointerCapture(event.pointerId);
      dragMotionRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        pointerType: event.pointerType,
        moved: false,
      };
      setDragState({
        kind: "joint",
        pointerId: event.pointerId,
        jointId,
      });
    },
    [isJointEnabled, onJointDrag]
  );

  const handleTargetDragStart = useCallback(
    (jointId: JointId, event: React.PointerEvent<SVGElement>) => {
      if (!isJointEnabled(jointId) || !onTargetDrag) {
        return;
      }
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }
      event.preventDefault();
      const captureTarget = svgRef.current ?? event.currentTarget;
      captureTarget.setPointerCapture(event.pointerId);
      dragMotionRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        pointerType: event.pointerType,
        moved: false,
      };
      setDragState({
        kind: "target",
        pointerId: event.pointerId,
        jointId,
      });
    },
    [isJointEnabled, onTargetDrag]
  );

  const handlePoleTargetDragStart = useCallback(
    (jointId: JointId, event: React.PointerEvent<SVGElement>) => {
      if (!isJointEnabled(jointId) || !onPoleTargetDrag) {
        return;
      }
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }
      event.preventDefault();
      const captureTarget = svgRef.current ?? event.currentTarget;
      captureTarget.setPointerCapture(event.pointerId);
      dragMotionRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        pointerType: event.pointerType,
        moved: false,
      };
      setDragState({
        kind: "pole",
        pointerId: event.pointerId,
        jointId,
      });
    },
    [isJointEnabled, onPoleTargetDrag]
  );

  const handleOverlayAnchorPointerDown = useCallback(
    (overlayId: string, anchor: "parent" | "child", event: React.PointerEvent<SVGGElement>) => {
      if (!overlayInteractionEnabled) {
        return;
      }
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }
      event.preventDefault();
      const svg = svgRef.current;
      if (svg) {
        svg.setPointerCapture(event.pointerId);
      }
      dragMotionRef.current = {
        pointerId: event.pointerId,
        startX: event.clientX,
        startY: event.clientY,
        pointerType: event.pointerType,
        moved: false,
      };
      setDragState({
        kind: "overlay-anchor",
        pointerId: event.pointerId,
        overlayId,
        anchor,
      });
    },
    [overlayInteractionEnabled]
  );

  const handleRootPointerDown = useCallback(
    (event: React.PointerEvent<SVGGElement>) => {
      event.stopPropagation();
      if (event.pointerType === "mouse" && event.button !== 0) {
        return;
      }
      const svgPoint = clientToSvgPoint(event.clientX, event.clientY);
      if (!svgPoint) {
        return;
      }
      const worldPoint = fromDisplay(svgPoint);
      onJointPointerDown?.("root", worldPoint.x, worldPoint.y, event);
      handleJointDragStart("root", event);
    },
    [clientToSvgPoint, fromDisplay, handleJointDragStart, onJointPointerDown]
  );

  const handleSvgPointerMove = useCallback(
    (event: React.PointerEvent<SVGSVGElement>) => {
      const nativeEvent = event.nativeEvent as PointerEvent & {
        getCoalescedEvents?: () => PointerEvent[];
      };
      const coalesced =
        typeof nativeEvent.getCoalescedEvents === "function" ? nativeEvent.getCoalescedEvents() : [];
      const finalSample = coalesced.length ? coalesced[coalesced.length - 1] : nativeEvent;
      const finalClientX = Number.isFinite(finalSample.clientX) ? finalSample.clientX : event.clientX;
      const finalClientY = Number.isFinite(finalSample.clientY) ? finalSample.clientY : event.clientY;

      if (event.pointerType === "touch") {
        const tracked = touchPointsRef.current.get(event.pointerId);
        if (tracked) {
          event.preventDefault();
          touchPointsRef.current.set(event.pointerId, { x: finalClientX, y: finalClientY });
          if (touchPointsRef.current.size === 2 && onPinchZoom) {
            const points = Array.from(touchPointsRef.current.values());
            const nextDistance = Math.hypot(points[0].x - points[1].x, points[0].y - points[1].y);
            const prevDistance = pinchDistanceRef.current;
            if (prevDistance && prevDistance > 0 && nextDistance > 0) {
              const rawScale = nextDistance / prevDistance;
              const clamped = Math.max(0.9, Math.min(1.1, rawScale));
              onPinchZoom(clamped);
            }
            pinchDistanceRef.current = nextDistance;
            return;
          }
        }
      }
      const svgPoint = clientToSvgPoint(finalClientX, finalClientY);
      if (!svgPoint) {
        return;
      }
      const worldPoint = fromDisplay(svgPoint);
      onViewportPointerMove?.(worldPoint.x, worldPoint.y, event);
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
      }

      const dragMotion = dragMotionRef.current;
      if (dragMotion && dragMotion.pointerId === event.pointerId && !dragMotion.moved) {
        const distanceFromStart = Math.hypot(finalClientX - dragMotion.startX, finalClientY - dragMotion.startY);
        const activationDistance = getPointerDragActivationPx(dragMotion.pointerType);
        if (distanceFromStart < activationDistance) {
          return;
        }
        dragMotion.moved = true;
        suppressClickUntilRef.current = Date.now() + DRAG_CLICK_SUPPRESS_MS;
      }
      if (dragState.kind === "joint") {
        onJointDrag?.(dragState.jointId, worldPoint.x, worldPoint.y, event);
        return;
      }
      if (dragState.kind === "target") {
        onTargetDrag?.(dragState.jointId, worldPoint.x, worldPoint.y, event);
        return;
      }
      if (dragState.kind === "pole") {
        onPoleTargetDrag?.(dragState.jointId, worldPoint.x, worldPoint.y, event);
        return;
      }
      if (dragState.kind === "overlay-anchor") {
        onOverlayAnchorDragMove?.(
          dragState.overlayId,
          dragState.anchor,
          worldPoint.x,
          worldPoint.y,
          event
        );
      }
    },
    [
      clientToSvgPoint,
      dragState,
      fromDisplay,
      onJointDrag,
      onPinchZoom,
      onPoleTargetDrag,
      onTargetDrag,
      onViewportPointerMove,
      onOverlayAnchorDragMove,
    ]
  );

  const pinByJoint = useMemo(() => {
    const byJoint = new Map<JointId, { world: boolean; ground: boolean }>();
    for (const jointId of JOINT_IDS) {
      byJoint.set(jointId, { world: false, ground: false });
    }
    for (const pin of state.pins) {
      const existing = byJoint.get(pin.jointId);
      if (!existing) {
        continue;
      }
      if (pin.kind === "world") {
        existing.world = true;
      } else {
        existing.ground = true;
      }
    }
    return byJoint;
  }, [state.pins]);

  const viewBox = useMemo(() => {
    const hasFootGroundPin = state.pins.some(
      (pin) =>
        pin.kind === "ground" && (pin.jointId === "l_foot" || pin.jointId === "r_foot")
    );
    const leftGroundPin = state.pins.find(
      (pin): pin is Extract<PinConstraint, { kind: "ground" }> =>
        pin.kind === "ground" && pin.jointId === "l_foot"
    );
    const rightGroundPin = state.pins.find(
      (pin): pin is Extract<PinConstraint, { kind: "ground" }> =>
        pin.kind === "ground" && pin.jointId === "r_foot"
    );
    const fixedFloorY = leftGroundPin?.groundY ?? rightGroundPin?.groundY ?? 0;
    const lowestFootWorldY = Math.max(
      world.l_foot?.worldPosition.y ?? Number.NEGATIVE_INFINITY,
      world.r_foot?.worldPosition.y ?? Number.NEGATIVE_INFINITY
    );
    const lowestJointWorldY = Number.isFinite(lowestFootWorldY)
      ? lowestFootWorldY
      : JOINT_IDS.reduce(
          (lowest, jointId) => Math.max(lowest, world[jointId].worldPosition.y),
          Number.NEGATIVE_INFINITY
        );
    const floorCorrectionY =
      Number.isFinite(lowestJointWorldY) && lowestJointWorldY > fixedFloorY
        ? lowestJointWorldY - fixedFloorY
        : 0;
    let bounds = createInitialBounds();
    for (const jointId of JOINT_IDS) {
      bounds = expandBounds(bounds, toDisplay(world[jointId].worldPosition));
    }
    if (!Number.isFinite(bounds.minX)) {
      return "-200 -200 400 400";
    }

    let minX = bounds.minX - PRIMITIVE_PADDING_PX;
    let maxX = bounds.maxX + PRIMITIVE_PADDING_PX;
    let minY = bounds.minY - PRIMITIVE_PADDING_PX;
    let maxY = bounds.maxY + PRIMITIVE_PADDING_PX;

    const contentWidth = Math.max(1, maxX - minX);
    const contentHeight = Math.max(1, maxY - minY);
    const targetFraction = Math.max(
      0.1,
      Math.min(4, cameraZoomFraction * Math.max(0.25, Math.min(4, cameraZoomMultiplier)))
    );
    const aspect = Math.max(0.1, viewportSize.width / viewportSize.height);

    let viewHeight = contentHeight / targetFraction;
    const minHeightForWidth = (contentWidth / targetFraction) / aspect;
    if (viewHeight < minHeightForWidth) {
      viewHeight = minHeightForWidth;
    }
    const viewWidth = viewHeight * aspect;

    const waist = world.waist?.worldPosition ?? { x: 0, y: 0 };
    const leftFoot = world.l_foot?.worldPosition;
    const rightFoot = world.r_foot?.worldPosition;
    const splitX =
      leftFoot && rightFoot
        ? (leftFoot.x + rightFoot.x) * 0.5
        : leftFoot
          ? leftFoot.x
          : rightFoot
            ? rightFoot.x
            : 0;
    const rootFocus = toDisplay({
      x: rootAnchorUseGroundX ? splitX : waist.x,
      y: rootAnchorUseGroundY && hasFootGroundPin ? fixedFloorY : waist.y,
    });
    const selectedFocus = toDisplay(world[state.selectedJointId ?? "waist"].worldPosition);
    const focusPoint = cameraFocusMode === "selected_joint" ? selectedFocus : rootFocus;
    minX = focusPoint.x - viewWidth * 0.5;
    const groundDisplayY = toDisplay({ x: 0, y: fixedFloorY + floorCorrectionY }).y;
    minY = groundDisplayY + FOOT_BOTTOM_PADDING_PX - viewHeight;

    return `${minX} ${minY} ${viewWidth} ${viewHeight}`;
  }, [
    cameraFocusMode,
    cameraZoomMultiplier,
    cameraZoomFraction,
    rootAnchorUseGroundX,
    rootAnchorUseGroundY,
    safeOffsetX,
    safeOffsetY,
    safeScale,
    state.pins,
    state.selectedJointId,
    toDisplay,
    viewportSize,
    world,
  ]);

  const lastRootYRef = useRef<number | null>(null);
  const lastStaticCameraSignatureRef = useRef<string | null>(null);
  const rootY = world.root?.worldPosition.y ?? world.waist?.worldPosition.y ?? null;
  const waistY = world.waist?.worldPosition.y ?? null;
  const cameraLockedViewBoxRef = useRef<string | null>(cameraLockedViewBox);
  useEffect(() => {
    cameraLockedViewBoxRef.current = cameraLockedViewBox;
  }, [cameraLockedViewBox]);

  const commitViewBox = useCallback((value: string) => {
    const parsed = parseViewBox(value);
    if (!parsed) {
      return;
    }
    const normalized = serializeViewBox(parsed);
    if (
      cameraLockedViewBoxRef.current === normalized ||
      lastCommittedLockedViewBoxRef.current === normalized
    ) {
      return;
    }
    lastCommittedLockedViewBoxRef.current = normalized;
    stableViewBoxRef.current = normalized;
    setCameraLockedViewBox(normalized);
  }, []);

  const staticCameraSignature = useMemo(
    () =>
      [
        cameraFocusMode,
        cameraZoomPreset,
        cameraZoomMultiplier,
        safeScale,
        safeOffsetX,
        safeOffsetY,
        viewportSize.width,
        viewportSize.height,
      ].join("|"),
    [
      cameraFocusMode,
      cameraZoomMultiplier,
      cameraZoomPreset,
      safeOffsetX,
      safeOffsetY,
      safeScale,
      viewportSize.height,
      viewportSize.width,
    ]
  );

  useEffect(() => {
    if (viewportSize.width <= 1 || viewportSize.height <= 1 || dragState) {
      return;
    }

    const prevY = lastRootYRef.current;
    lastRootYRef.current = rootY;
    const drift = prevY === null || rootY === null ? 0 : Math.abs(rootY - prevY);

    const parsedNext = parseViewBox(viewBox);
    if (!parsedNext) {
      return;
    }

    if (cameraFocusMode === "static") {
      const shouldResetStaticLock =
        cameraLockedViewBoxRef.current === null ||
        lastStaticCameraSignatureRef.current !== staticCameraSignature;
      if (shouldResetStaticLock) {
        lastStaticCameraSignatureRef.current = staticCameraSignature;
        commitViewBox(serializeViewBox(parsedNext));
      }
      return;
    }
    lastStaticCameraSignatureRef.current = null;

    const lockedSerialized =
      cameraLockedViewBoxRef.current ?? stableViewBoxRef.current;
    const parsedLocked = parseViewBox(lockedSerialized);
    if (!parsedLocked) {
      commitViewBox(serializeViewBox(parsedNext));
      return;
    }

    if (cameraLockedViewBoxRef.current === null) {
      commitViewBox(serializeViewBox(parsedNext));
      return;
    }

    const easing =
      drift > CAMERA_ROOT_DRIFT_RESET_THRESHOLD ? CAMERA_VIEWBOX_DRIFT_EASE : CAMERA_VIEWBOX_EASE;

    const lockedAspect = parsedLocked.width / Math.max(1e-6, parsedLocked.height);
    const nextAspect = parsedNext.width / Math.max(1e-6, parsedNext.height);
    const shapeChanged = Math.abs(lockedAspect - nextAspect) > 1e-4;
    const widthChanged = Math.abs(parsedLocked.width - parsedNext.width) > 1e-3;
    const heightChanged = Math.abs(parsedLocked.height - parsedNext.height) > 1e-3;
    const centerChanged =
      Math.abs((parsedLocked.x + parsedLocked.width * 0.5) - (parsedNext.x + parsedNext.width * 0.5)) > 1e-3 ||
      Math.abs((parsedLocked.y + parsedLocked.height * 0.5) - (parsedNext.y + parsedNext.height * 0.5)) > 1e-3;
    if (!shapeChanged && !widthChanged && !heightChanged && !centerChanged) {
      return;
    }

    const blended = {
      x: parsedLocked.x + (parsedNext.x - parsedLocked.x) * easing,
      y: parsedLocked.y + (parsedNext.y - parsedLocked.y) * easing,
      width: parsedLocked.width + (parsedNext.width - parsedLocked.width) * easing,
      height: parsedLocked.height + (parsedNext.height - parsedLocked.height) * easing,
    };
    const serializedBlended = serializeViewBox(blended);
    const parsedBlended = parseViewBox(serializedBlended);
    if (!parsedBlended) {
      return;
    }
    const shouldCommit =
      viewBoxValueDiffers(parsedBlended.x, parsedLocked.x, CAMERA_VIEWBOX_COMMIT_EPSILON) ||
      viewBoxValueDiffers(parsedBlended.y, parsedLocked.y, CAMERA_VIEWBOX_COMMIT_EPSILON) ||
      viewBoxValueDiffers(parsedBlended.width, parsedLocked.width, CAMERA_VIEWBOX_COMMIT_EPSILON) ||
      viewBoxValueDiffers(parsedBlended.height, parsedLocked.height, CAMERA_VIEWBOX_COMMIT_EPSILON);
    if (!shouldCommit) {
      return;
    }
    const rafId = requestAnimationFrame(() => {
      commitViewBox(serializedBlended);
    });
    return () => cancelAnimationFrame(rafId);
  }, [
    cameraFocusMode,
    commitViewBox,
    dragState,
    rootY,
    staticCameraSignature,
    viewBox,
    viewportSize.height,
    viewportSize.width,
  ]);

  const collarTrianglePoints = useMemo(() => {
    const left = world.l_shoulder;
    const right = world.r_shoulder;
    const waist = world.waist;
    if (!left || !right || !waist) {
      return null;
    }
    const leftDisplay = toDisplay(left.worldPosition);
    const rightDisplay = toDisplay(right.worldPosition);
    const waistDisplay = toDisplay(waist.worldPosition);
    return `${leftDisplay.x},${leftDisplay.y} ${rightDisplay.x},${rightDisplay.y} ${waistDisplay.x},${waistDisplay.y}`;
  }, [toDisplay, world.l_shoulder, world.r_shoulder, world.waist]);

  const primitiveSegments = useMemo(() => {
    const trunkSegments: Array<{ childId: JointId; parentId: JointId }> = [
      { childId: "collar", parentId: "waist" },
    ];
    const trunkChildIds = new Set(trunkSegments.map((segment) => segment.childId));
    const worldSegments = JOINT_IDS.filter(
      (jointId) =>
        jointId !== "waist" &&
        !trunkChildIds.has(jointId) &&
        Boolean(world[jointId].parentId)
    ).map((jointId) => {
      const joint = world[jointId];
      const parent = world[joint.parentId as JointId];
      return {
        childId: jointId,
        parentId: joint.parentId as JointId,
        start: toDisplay(parent.worldPosition),
        end: toDisplay(joint.worldPosition),
      };
    });
    return [
      ...trunkSegments.map(({ childId, parentId }) => {
        const child = world[childId];
        const parent = world[parentId];
        return {
          childId,
          parentId,
          start: toDisplay(parent.worldPosition),
          end: toDisplay(child.worldPosition),
        };
      }),
      ...worldSegments,
    ];
  }, [toDisplay, world]);
  const extremitySegments = useMemo(
    () => {
      const sorted = [...primitiveSegments.filter((segment) => EXTREMITY_JOINT_SET.has(segment.childId))];
      sorted.sort((a, b) => {
        const aIsLeft = a.childId.startsWith("l_");
        const bIsLeft = b.childId.startsWith("l_");
        if (aIsLeft === bIsLeft) return 0;
        return limbStacking === "left_over_right" ? (aIsLeft ? 1 : -1) : (aIsLeft ? -1 : 1);
      });
      return sorted;
    },
    [primitiveSegments, limbStacking]
  );

  const groundPins = state.pins.filter((pin) => pin.kind === "ground");
  const floorGuideY = useMemo(() => {
    const leftGroundPin = state.pins.find(
      (pin): pin is Extract<PinConstraint, { kind: "ground" }> =>
        pin.kind === "ground" && pin.jointId === "l_foot"
    );
    const rightGroundPin = state.pins.find(
      (pin): pin is Extract<PinConstraint, { kind: "ground" }> =>
        pin.kind === "ground" && pin.jointId === "r_foot"
    );
    return leftGroundPin?.groundY ?? rightGroundPin?.groundY ?? 0;
  }, [state.pins]);
  const floorContactShadows = useMemo(() => {
    const footIds: JointId[] = ["l_foot", "r_foot"];
    return footIds
      .map((jointId) => {
        const foot = world[jointId]?.worldPosition;
        if (!foot) {
          return null;
        }
        return {
          id: jointId,
          center: toDisplay({ x: foot.x, y: floorGuideY }),
        };
      })
      .filter((entry): entry is { id: JointId; center: Vec2 } => Boolean(entry));
  }, [floorGuideY, toDisplay, world]);
  const centerOfMass = useMemo(() => {
    const bodyJointIds = JOINT_IDS.filter((jointId) => jointId !== "root");
    if (!bodyJointIds.length) {
      return { x: 0, y: 0 };
    }
    let sumX = 0;
    let sumY = 0;
    let count = 0;
    for (const jointId of bodyJointIds) {
      const point = world[jointId]?.worldPosition;
      if (!point) {
        continue;
      }
      sumX += point.x;
      sumY += point.y;
      count += 1;
    }
    if (!count) {
      return { x: 0, y: 0 };
    }
    return { x: sumX / count, y: sumY / count };
  }, [world]);
  const centerOfMassDisplay = useMemo(
    () => toDisplay(centerOfMass),
    [centerOfMass, toDisplay]
  );
  const supportRange = useMemo(() => {
    const leftFootX = world.l_foot?.worldPosition.x;
    const rightFootX = world.r_foot?.worldPosition.x;
    if (!Number.isFinite(leftFootX) || !Number.isFinite(rightFootX)) {
      return null;
    }
    return {
      minX: Math.min(leftFootX as number, rightFootX as number),
      maxX: Math.max(leftFootX as number, rightFootX as number),
    };
  }, [world.l_foot, world.r_foot]);
  const centerOfMassBalance = useMemo(() => {
    if (!supportRange) {
      return { status: "unknown" as const, label: "CoM", color: "#6b7280" };
    }
    if (centerOfMass.x < supportRange.minX) {
      return { status: "left" as const, label: "CoM shift left", color: "#b45309" };
    }
    if (centerOfMass.x > supportRange.maxX) {
      return { status: "right" as const, label: "CoM shift right", color: "#b45309" };
    }
    return { status: "balanced" as const, label: "CoM balanced", color: "#047857" };
  }, [centerOfMass.x, supportRange]);
  const centerOfMassFloorDisplay = useMemo(
    () => toDisplay({ x: centerOfMass.x, y: floorGuideY }),
    [centerOfMass.x, floorGuideY, toDisplay]
  );
  const GHOST_SAMPLE_EPSILON_PX = 0.3;
  const GHOST_LIFETIME_MS = 420;
  const GHOST_MAX_FRAMES = 10;
  const pruneGhostFrames = useCallback(
    (frames: Array<{ t: number; positions: Record<JointId, Vec2> }>, now: number) => {
      const firstVisibleIndex = frames.findIndex((frame) => now - frame.t <= GHOST_LIFETIME_MS);
      if (firstVisibleIndex === -1) {
        return frames.length ? [] : frames;
      }
      if (firstVisibleIndex === 0) {
        return frames;
      }
      return frames.slice(firstVisibleIndex);
    },
    []
  );

  useLayoutEffect(() => {
    if (!showMotionTrails) {
      return;
    }
    const positions = JOINT_IDS.reduce((acc, jointId) => {
      acc[jointId] = toDisplay(world[jointId].worldPosition);
      return acc;
    }, {} as Record<JointId, Vec2>);

    setGhostFrames((prev) => {
      const now = Date.now();
      const pruned = pruneGhostFrames(prev, now);
      const last = pruned[pruned.length - 1];
      if (last) {
        const maxDelta = JOINT_IDS.reduce((maxDistance, jointId) => {
          const prevPos = last.positions[jointId];
          const nextPos = positions[jointId];
          if (!prevPos || !nextPos) {
            return maxDistance;
          }
          const dx = nextPos.x - prevPos.x;
          const dy = nextPos.y - prevPos.y;
          return Math.max(maxDistance, Math.hypot(dx, dy));
        }, 0);
        if (maxDelta < GHOST_SAMPLE_EPSILON_PX) {
          return pruned;
        }
      }
      const next = [...pruned, { t: now, positions }];
      return next.slice(-GHOST_MAX_FRAMES);
    });
  }, [pruneGhostFrames, showMotionTrails, toDisplay, world]);

  useEffect(() => {
    if (showMotionTrails) {
      return;
    }
    if (!ghostFrames.length) {
      return;
    }
    setGhostFrames([]);
  }, [ghostFrames.length, showMotionTrails]);

  useEffect(() => {
    ghostFramesRef.current = ghostFrames;
  }, [ghostFrames]);

  useLayoutEffect(() => {
    if (!showMotionTrails || !ghostFrames.length) {
      return;
    }
    let rafId = 0;
    const tick = () => {
      const now = Date.now();
      setGhostNowMs(now);
      setGhostFrames((prev) => pruneGhostFrames(prev, now));
      const hasVisibleFrame = ghostFramesRef.current.some((frame) => now - frame.t <= GHOST_LIFETIME_MS);
      if (hasVisibleFrame) {
        rafId = requestAnimationFrame(tick);
      }
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [ghostFrames.length, pruneGhostFrames, showMotionTrails]);

  const visibleGhostFrames = useMemo(
    () => ghostFrames.filter((frame) => ghostNowMs - frame.t <= GHOST_LIFETIME_MS),
    [ghostFrames, ghostNowMs]
  );
  const liveGhostPositions = useMemo(
    () =>
      JOINT_IDS.reduce((acc, jointId) => {
        acc[jointId] = toDisplay(world[jointId].worldPosition);
        return acc;
      }, {} as Record<JointId, Vec2>),
    [toDisplay, world]
  );
  const primitiveSurfaceFilter = primitiveTurnoverEnabled ? "url(#primitive-feather)" : undefined;
  const activeViewBoxValue = cameraLockedViewBox ?? stableViewBoxRef.current;
  const activeViewBox = parseViewBox(activeViewBoxValue) ?? {
    x: -200,
    y: -200,
    width: 400,
    height: 400,
  };
  const sceneLayerCenter = {
    x: activeViewBox.x + activeViewBox.width * 0.5,
    y: activeViewBox.y + activeViewBox.height * 0.5,
  };
  const buildSceneLayerTransform = (layer: RigSceneLayers["background"]): string =>
    `translate(${layer.transform.x} ${layer.transform.y}) ` +
    `rotate(${layer.transform.rotation} ${sceneLayerCenter.x} ${sceneLayerCenter.y}) ` +
    `translate(${sceneLayerCenter.x} ${sceneLayerCenter.y}) ` +
    `scale(${layer.transform.scaleX} ${layer.transform.scaleY}) ` +
    `translate(${-sceneLayerCenter.x} ${-sceneLayerCenter.y})`;
  const backgroundShadowFilter =
    activeSceneLayers.backgroundShadow.enabled && activeSceneLayers.background.dataUrl
      ? `drop-shadow(${activeSceneLayers.backgroundShadow.offsetX}px ${activeSceneLayers.backgroundShadow.offsetY}px ${activeSceneLayers.backgroundShadow.blurPx}px rgba(15, 23, 42, ${activeSceneLayers.backgroundShadow.alpha}))`
      : undefined;

  return (
    <svg
      ref={svgRef}
      className={className}
      width={width}
      height={height}
      viewBox={cameraLockedViewBox ?? stableViewBoxRef.current}
      data-parallax-enabled={parallaxLayersEnabled ? "true" : "false"}
      role="img"
      aria-label="Skeleton viewport"
      onPointerMove={handleSvgPointerMove}
      onPointerDown={handleSvgPointerDown}
      onPointerUp={clearDrag}
      onPointerCancel={clearDrag}
      style={{
        background: canvasBackground,
        touchAction: "none",
        userSelect: "none",
        WebkitUserSelect: "none",
        WebkitTouchCallout: "none",
      }}
    >
      <defs>
        <pattern id="rig-grid" width="50" height="50" patternUnits="userSpaceOnUse">
          <path d="M 50 0 L 0 0 0 50" fill="none" stroke="#e5e7eb" strokeWidth="1" />
        </pattern>
        <filter id="primitive-feather" x="-25%" y="-25%" width="150%" height="150%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="0.45" result="blurred" />
          <feMerge>
            <feMergeNode in="blurred" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <filter id="skeleton-feather" x="-20%" y="-20%" width="140%" height="140%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="0.2" result="blurred" />
          <feMerge>
            <feMergeNode in="blurred" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
        <radialGradient id="navel-glow" cx="50%" cy="50%" r="50%">
          <stop offset="25%" stopColor="#22c55e" stopOpacity="0.55" />
          <stop offset="60%" stopColor="#22c55e" stopOpacity="0.02" />
          <stop offset="100%" stopColor="#22c55e" stopOpacity="0" />
        </radialGradient>
      </defs>

      <rect
        x={activeViewBox.x}
        y={activeViewBox.y}
        width={activeViewBox.width}
        height={activeViewBox.height}
        fill={canvasBackground}
      />
      {showHelpers && (
        <rect x="-5000" y="-5000" width="10000" height="10000" fill="url(#rig-grid)" />
      )}
      {includeBackgroundLayer && activeSceneLayers.background.visible && activeSceneLayers.background.dataUrl && (
        <g
          data-export-layer="background"
          transform={buildSceneLayerTransform(activeSceneLayers.background)}
          opacity={activeSceneLayers.background.alpha}
          style={{
            mixBlendMode: toCssBlendMode(activeSceneLayers.background.blendMode),
          }}
        >
          <image
            href={activeSceneLayers.background.dataUrl}
            x={activeViewBox.x}
            y={activeViewBox.y}
            width={activeViewBox.width}
            height={activeViewBox.height}
            preserveAspectRatio={toPreserveAspectRatio(activeSceneLayers.background.fitMode)}
            style={{ filter: toCssFilter(activeSceneLayers.background.filters) }}
          />
        </g>
      )}
      <g
        data-export-layer="character"
        style={backgroundShadowFilter ? { filter: backgroundShadowFilter } : undefined}
      >
      {skeletonLayerVisible && showHelpers && world.waist && (
        <g pointerEvents="none">
          <circle
            cx={toDisplay(world.waist.worldPosition).x}
            cy={toDisplay(world.waist.worldPosition).y}
            r={22}
            fill="url(#navel-glow)"
          />
          <circle
            cx={toDisplay(world.waist.worldPosition).x}
            cy={toDisplay(world.waist.worldPosition).y}
            r={10}
            fill="rgba(34, 197, 94, 0.45)"
            stroke="#15803d"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
          />
          <circle
            cx={toDisplay(world.waist.worldPosition).x}
            cy={toDisplay(world.waist.worldPosition).y}
            r={4}
            fill="#ecfccb"
            stroke="#15803d"
            strokeWidth={1.4}
            vectorEffect="non-scaling-stroke"
          />
        </g>
      )}
      {jointsLayerVisible && showHelpers && (() => {
        const waist = world.waist?.worldPosition ?? { x: 0, y: 0 };
        const leftFoot = world.l_foot?.worldPosition;
        const rightFoot = world.r_foot?.worldPosition;
        const leftGroundPin = state.pins.find(
          (pin): pin is Extract<PinConstraint, { kind: "ground" }> =>
            pin.kind === "ground" && pin.jointId === "l_foot"
        );
        const rightGroundPin = state.pins.find(
          (pin): pin is Extract<PinConstraint, { kind: "ground" }> =>
            pin.kind === "ground" && pin.jointId === "r_foot"
        );
        const hasFootGroundPin = Boolean(leftGroundPin || rightGroundPin);
        const groundRootY =
          leftGroundPin?.groundY ??
          rightGroundPin?.groundY ??
          0;
        const splitX =
          leftFoot && rightFoot
            ? (leftFoot.x + rightFoot.x) * 0.5
            : leftFoot
              ? leftFoot.x
              : rightFoot
                ? rightFoot.x
                : 0;
        const rootPoint = toDisplay({
          x: rootAnchorUseGroundX ? splitX : waist.x,
          y: rootAnchorUseGroundY && hasFootGroundPin ? groundRootY : waist.y,
        });
        const rootEnabled = isJointEnabled("root") && isJointVisible("root");
        const haloColor = "rgba(220, 38, 38, 0.35)";
        return (
          <g
            onPointerDown={(event) => {
              if (!rootEnabled) {
                return;
              }
              handleRootPointerDown(event);
            }}
            style={{
              cursor: rootEnabled ? "grab" : "not-allowed",
              pointerEvents: "auto",
              opacity: rootEnabled ? 1 : 0.55,
            }}
          >
            <circle
              cx={rootPoint.x}
              cy={rootPoint.y}
              r={ROOT_ANCHOR_RADIUS + ROOT_ANCHOR_HIT_RADIUS_PAD}
              fill="rgba(0,0,0,0.001)"
              stroke="none"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={rootPoint.x}
              cy={rootPoint.y}
              r={ROOT_ANCHOR_RADIUS + 8}
              fill="none"
              stroke={haloColor}
              strokeWidth={4}
              opacity={0.65}
              vectorEffect="non-scaling-stroke"
              filter="url(#skeleton-feather)"
            />
            <image
              href="/root-anchor.svg"
              x={rootPoint.x - ROOT_ANCHOR_RADIUS}
              y={rootPoint.y - ROOT_ANCHOR_RADIUS}
              width={ROOT_ANCHOR_RADIUS * 2}
              height={ROOT_ANCHOR_RADIUS * 2}
              preserveAspectRatio="xMidYMid meet"
              style={{
                opacity: rootEnabled ? 0.95 : 0.45,
                pointerEvents: "none",
              }}
            />
            <circle
              cx={rootPoint.x}
              cy={rootPoint.y}
              r={ROOT_ANCHOR_RADIUS * 0.46}
              fill={ROLE_COLORS.anchor}
              stroke="#111"
              strokeWidth={1.3}
              vectorEffect="non-scaling-stroke"
              filter="url(#skeleton-feather)"
            />
            {!cleanFkMode && torsoRibbonPath && (
              <g pointerEvents="none">
                <path
                  d={torsoRibbonPath}
                  fill="rgba(248, 113, 113, 0.25)"
                  stroke="rgba(248, 113, 113, 0.6)"
                  strokeWidth={1.4}
                  vectorEffect="non-scaling-stroke"
                />
                <path
                  d={torsoAccentPath}
                  fill="rgba(59, 130, 246, 0.3)"
                  stroke="rgba(59, 130, 246, 0.6)"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
                {waistDisplay && (
                  <ellipse
                    cx={waistDisplay.x}
                    cy={waistDisplay.y}
                    rx={waistEllipseRx}
                    ry={waistEllipseRy}
                    fill="rgba(15, 118, 110, 0.3)"
                    stroke="rgba(15, 118, 110, 0.9)"
                    strokeWidth={1}
                    vectorEffect="non-scaling-stroke"
                  />
                )}
              </g>
            )}
          </g>
        );
      })()}

      {showMotionTrails && dragState && (
        <g opacity={0.24} pointerEvents="none">
          {JOINT_IDS.map((jointId) => {
            if (jointId === "waist") {
              return null;
            }
            const joint = world[jointId];
            if (!joint.parentId) {
              return null;
            }
            const start = liveGhostPositions[joint.parentId];
            const end = liveGhostPositions[jointId];
            return (
              <line
                key={`live-ghost-line-${jointId}`}
                x1={start.x}
                y1={start.y}
                x2={end.x}
                y2={end.y}
                stroke="#8b5cf6"
                strokeWidth={2.5}
                strokeLinecap="round"
                strokeDasharray="5 4"
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
        </g>
      )}

      {showMotionTrails && visibleGhostFrames.map((frame, frameIndex) => {
        const age = ghostNowMs - frame.t;
        const fade = Math.max(0, 1 - age / GHOST_LIFETIME_MS);
        const opacity = 0.32 * fade;
        if (opacity <= 0.001) {
          return null;
        }
        return (
          <g key={`ghost-${frame.t}-${frameIndex}`} opacity={opacity} pointerEvents="none">
            {JOINT_IDS.map((jointId) => {
              if (jointId === "waist") {
                return null;
              }
              const joint = world[jointId];
              if (!joint.parentId) {
                return null;
              }
              const start = frame.positions[joint.parentId];
              const end = frame.positions[jointId];
              return (
                <line
                  key={`ghost-line-${frame.t}-${jointId}`}
                  x1={start.x}
                  y1={start.y}
                  x2={end.x}
                  y2={end.y}
                  stroke="#7c3aed"
                  strokeWidth={2}
                  strokeLinecap="round"
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </g>
        );
      })}

      {rotationPreview && rotationPreview.points.length > 1 && (
        <g pointerEvents="none">
          <polyline
            points={rotationPreview.points.map((pt) => `${pt.x},${pt.y}`).join(" ")}
            stroke="#a855f7"
            strokeWidth={1.5}
            fill="none"
            strokeDasharray="6 4"
            opacity={0.8}
            vectorEffect="non-scaling-stroke"
          />
          {rotationPreview.points.map((point, index) => {
            const alpha = 0.85 - (index / Math.max(1, rotationPreview.points.length)) * 0.6;
            return (
              <circle
                key={`rotation-preview-point-${index}`}
                cx={point.x}
                cy={point.y}
                r={2.2}
                fill="rgba(244, 114, 182, 0.8)"
                opacity={Math.max(0.2, alpha)}
                vectorEffect="non-scaling-stroke"
              />
            );
          })}
          <line
            x1={rotationPreview.pivot.x}
            y1={rotationPreview.pivot.y}
            x2={rotationPreview.points[rotationPreview.points.length - 1].x}
            y2={rotationPreview.points[rotationPreview.points.length - 1].y}
            stroke="rgba(129, 140, 248, 0.9)"
            strokeWidth={1.2}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
          />
        </g>
      )}

      {skeletonLayerVisible && primitiveSegments.map((segment) => {
        const activationJointId = getPrimitiveActivationJointId(segment.childId, segment.parentId);
        const activationJoint = world[activationJointId];
        const enabled =
          Boolean(activationJoint) &&
          isSkeletonJointVisible(segment.childId) &&
          isSkeletonJointVisible(segment.parentId) &&
          isJointEnabled(segment.childId) &&
          isJointEnabled(segment.parentId) &&
          isJointEnabled(activationJointId);
        return (
          <line
            key={`primitive-${segment.parentId}-${segment.childId}`}
            x1={segment.start.x}
            y1={segment.start.y}
            x2={segment.end.x}
            y2={segment.end.y}
            stroke={enabled ? "rgba(17, 24, 39, 0.26)" : "rgba(107, 114, 128, 0.22)"}
            strokeWidth={getPrimitiveStrokeWidth(segment.childId)}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            filter={primitiveSurfaceFilter}
            style={{ cursor: enabled ? "grab" : "not-allowed", opacity: enabled ? 1 : 0.55 }}
            onClick={(event) => {
              if (shouldSuppressClick()) {
                event.preventDefault();
                event.stopPropagation();
                return;
              }
              if (!enabled) {
                return;
              }
              onJointClick?.(activationJointId);
            }}
            onPointerDown={(event) => {
              if (!enabled || !activationJoint) {
                return;
              }
              event.stopPropagation();
              onJointPointerDown?.(
                activationJointId,
                activationJoint.worldPosition.x,
                activationJoint.worldPosition.y,
                event
              );
              handleJointDragStart(activationJointId, event);
            }}
          />
        );
      })}
      {manakinMode && skeletonLayerVisible && (() => {
        const waist = world.waist?.worldPosition;
        const leftHip = world.l_hip?.worldPosition;
        const rightHip = world.r_hip?.worldPosition;
        if (!waist || !leftHip || !rightHip) {
          return null;
        }
        const hipMid = { x: (leftHip.x + rightHip.x) * 0.5, y: (leftHip.y + rightHip.y) * 0.5 };
        const base = { x: hipMid.x, y: Math.max(leftHip.y, rightHip.y) + 6 };
        const pointsAttr = [leftHip, rightHip, base, waist]
          .map((pt) => toDisplay(pt))
          .map((pt) => `${pt.x},${pt.y}`)
          .join(" ");
        return (
          <polygon
            key="pelvis-ribbon"
            points={pointsAttr}
            fill="rgba(16, 185, 129, 0.16)"
            stroke="rgba(16, 185, 129, 0.55)"
            strokeWidth={2}
            vectorEffect="non-scaling-stroke"
            filter={primitiveSurfaceFilter}
            style={{ pointerEvents: "none" }}
          />
        );
      })()}
      {manakinMode && skeletonLayerVisible && (() => {
        const waist = world.waist?.worldPosition;
        const xiphoid = world.xiphoid?.worldPosition;
        const collar = world.collar?.worldPosition;
        const neck = world.neck?.worldPosition;
        if (!waist || !xiphoid || !collar || !neck) {
          return null;
        }
        const pts = [waist, xiphoid, collar, neck].map((pt) => toDisplay(pt));
        const pathD = `M ${pts[0].x} ${pts[0].y} L ${pts[1].x} ${pts[1].y} L ${pts[2].x} ${pts[2].y} L ${pts[3].x} ${pts[3].y}`;
        return (
          <path
            key="spine-ribbon"
            d={pathD}
            fill="none"
            stroke="rgba(59, 130, 246, 0.7)"
            strokeWidth={10}
            strokeLinecap="round"
            strokeLinejoin="round"
            vectorEffect="non-scaling-stroke"
            filter={primitiveSurfaceFilter}
            style={{ pointerEvents: "none" }}
          />
        );
      })()}
      {skeletonLayerVisible && extremitySegments.map((segment) => {
        const enabled =
          isSkeletonJointVisible(segment.childId) &&
          isSkeletonJointVisible(segment.parentId) &&
          isJointEnabled(segment.childId) &&
          isJointEnabled(segment.parentId);
        const direction = normalizeVec2(subVec2(segment.end, segment.start));
        if (lengthVec2(direction) <= 1e-5) {
          return null;
        }
        const normal = { x: -direction.y, y: direction.x };
        const isFoot = FOOT_JOINT_SET.has(segment.childId);
        const angleDeg = (Math.atan2(direction.y, direction.x) * 180) / Math.PI;
        const makePoint = (along: number, across: number): Vec2 =>
          addVec2(segment.end, addVec2(scaleVec2(direction, along), scaleVec2(normal, across)));
        const silhouettePoints = isFoot
          ? [
              makePoint(-FOOT_PRIMITIVE_HEEL_BACK, 4.3),
              makePoint(1.4, 6.8),
              makePoint(FOOT_PRIMITIVE_LENGTH, 5.8),
              makePoint(FOOT_PRIMITIVE_LENGTH, -5.8),
              makePoint(1.8, -4.8),
              makePoint(-FOOT_PRIMITIVE_HEEL_BACK, -3.6),
            ]
          : [
              makePoint(-HAND_PRIMITIVE_WRIST_BACK, 5.3),
              makePoint(1.8, 6.4),
              makePoint(HAND_PRIMITIVE_LENGTH, 4.4),
              makePoint(HAND_PRIMITIVE_LENGTH, -4.4),
              makePoint(1.8, -6.4),
              makePoint(-HAND_PRIMITIVE_WRIST_BACK, -5.3),
            ];
        const silhouettePointsAttr = silhouettePoints.map((point) => `${point.x},${point.y}`).join(" ");
        const accentStart = isFoot ? makePoint(-4.4, 0.35) : makePoint(-2.4, 0);
        const accentEnd = isFoot ? makePoint(11.2, 0.7) : makePoint(7.8, 0);
        const toePoint = isFoot ? makePoint(FOOT_PRIMITIVE_LENGTH, 0) : null;
        const hitRadiusX = isFoot ? 23 : 19;
        const hitRadiusY = isFoot ? 14 : 12;
        const fillColor = enabled
          ? isFoot
            ? "rgba(17, 24, 39, 0.24)"
            : "rgba(30, 64, 175, 0.24)"
          : "rgba(107, 114, 128, 0.2)";
        const strokeColor = enabled
          ? isFoot
            ? "rgba(17, 24, 39, 0.46)"
            : "rgba(30, 64, 175, 0.42)"
          : "rgba(107, 114, 128, 0.35)";
        const accentColor = enabled
          ? isFoot
            ? "rgba(255, 255, 255, 0.5)"
            : "rgba(255, 255, 255, 0.58)"
          : "rgba(255, 255, 255, 0.35)";
        return (
          <g
            key={`extremity-${segment.childId}`}
            style={{
              cursor: enabled
                ? dragState?.kind === "joint" && dragState.jointId === segment.parentId
                  ? "grabbing"
                  : "grab"
                : "not-allowed",
              opacity: enabled ? 1 : 0.55,
            }}
            onClick={(event) => {
              if (shouldSuppressClick()) {
                event.preventDefault();
                event.stopPropagation();
                return;
              }
              if (!enabled) {
                return;
              }
              onJointClick?.(segment.parentId);
            }}
            onPointerDown={(event) => {
              if (!enabled) {
                return;
              }
              const parentJoint = world[segment.parentId];
              if (!parentJoint) {
                return;
              }
              event.stopPropagation();
              onJointPointerDown?.(
                segment.parentId,
                parentJoint.worldPosition.x,
                parentJoint.worldPosition.y,
                event
              );
              handleJointDragStart(segment.parentId, event);
            }}
          >
            <polygon
              points={silhouettePointsAttr}
              fill={fillColor}
              stroke={strokeColor}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              filter={primitiveSurfaceFilter}
            />
            <line
              x1={accentStart.x}
              y1={accentStart.y}
              x2={accentEnd.x}
              y2={accentEnd.y}
              stroke={accentColor}
              strokeWidth={1.2}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: "none" }}
            />
            {toePoint && (
              <circle
                cx={toePoint.x}
                cy={toePoint.y}
                r={1.7}
                fill={accentColor}
                stroke="none"
                vectorEffect="non-scaling-stroke"
                style={{ pointerEvents: "none" }}
              />
            )}
            <ellipse
              cx={segment.end.x}
              cy={segment.end.y}
              rx={hitRadiusX}
              ry={hitRadiusY}
              fill="rgba(0,0,0,0.001)"
              stroke="none"
              vectorEffect="non-scaling-stroke"
              transform={`rotate(${angleDeg} ${segment.end.x} ${segment.end.y})`}
            />
            <ellipse
              cx={segment.end.x}
              cy={segment.end.y}
              rx={hitRadiusX + 4}
              ry={hitRadiusY + 4}
              fill="rgba(0,0,0,0.001)"
              stroke="none"
              vectorEffect="non-scaling-stroke"
              transform={`rotate(${angleDeg} ${segment.end.x} ${segment.end.y})`}
            />
          </g>
        );
      })}

      {/* Hand and Foot Ground Interaction Anchors */}
      {skeletonLayerVisible && showHelpers &&
        (["l_hand", "r_hand", "l_foot", "r_foot"] as JointId[]).map((jointId) => {
          const joint = world[jointId];
          if (!joint || !isSkeletonJointVisible(jointId) || !isJointEnabled(jointId)) {
            return null;
          }
          const displayPos = toDisplay(joint.worldPosition);
          const isHand = HAND_JOINT_SET.has(jointId);
          const isFoot = FOOT_JOINT_SET.has(jointId);
          const radius = isHand ? 4.5 : 6;
          const haloRadius = radius + 2;
          return (
            <g
              key={`limb-tip-anchor-${jointId}`}
              style={{
                cursor:
                  dragState?.kind === "joint" && dragState.jointId === jointId
                    ? "grabbing"
                    : "grab",
                opacity: 1,
              }}
              onPointerDown={(event) => {
                event.stopPropagation();
                onJointPointerDown?.(jointId, joint.worldPosition.x, joint.worldPosition.y, event);
                handleJointDragStart(jointId, event);
              }}
              onClick={(event) =>{
                if (shouldSuppressClick()) {
                  event.preventDefault();
                  return;
                }
                event.stopPropagation();
                onJointClick?.(jointId);
              }}
            >
              {/* Interaction halo */}
              <circle
                cx={displayPos.x}
                cy={displayPos.y}
                r={haloRadius + 4}
                fill="rgba(0,0,0,0.001)"
                stroke="none"
                vectorEffect="non-scaling-stroke"
              />
              {/* Visual halo */}
              <circle
                cx={displayPos.x}
                cy={displayPos.y}
                r={haloRadius}
                fill="none"
                stroke={isHand ? "rgba(59, 130, 246, 0.3)" : "rgba(34, 197, 94, 0.3)"}
                strokeWidth={2.5}
                opacity={0.7}
                vectorEffect="non-scaling-stroke"
                style={{ pointerEvents: "none" }}
              />
              {/* Anchor circle */}
              <circle
                cx={displayPos.x}
                cy={displayPos.y}
                r={radius}
                fill={isHand ? "#3b82f6" : "#22c55e"}
                stroke="#111111"
                strokeWidth={1.2}
                vectorEffect="non-scaling-stroke"
                style={{ pointerEvents: "none" }}
              />
              {/* Center dot */}
              <circle
                cx={displayPos.x}
                cy={displayPos.y}
                r={radius * 0.4}
                fill="#ffffff"
                stroke="none"
                vectorEffect="non-scaling-stroke"
                style={{ pointerEvents: "none" }}
              />
            </g>
          );
        })}

      {skeletonLayerVisible && collarTrianglePoints && (
        <polygon
          points={collarTrianglePoints}
          fill="rgba(37, 99, 235, 0.08)"
          stroke="rgba(37, 99, 235, 0.4)"
          strokeWidth={1.2}
          vectorEffect="non-scaling-stroke"
          filter="url(#primitive-feather)"
        />
      )}

      {skeletonLayerVisible && (() => {
        const neck = toDisplay(world.neck.worldPosition);
        const collar = toDisplay(world.collar.worldPosition);
        const torso = toDisplay(world.torso.worldPosition);
        const waist = toDisplay(world.waist.worldPosition);
        const headEnabled = isJointEnabled("neck");
        const torsoEnabled = isJointEnabled("torso") || isJointEnabled("waist");
        const leftShoulder = world.l_shoulder?.worldPosition;
        const rightShoulder = world.r_shoulder?.worldPosition;
        const shoulderSpanWorld =
          leftShoulder && rightShoulder
            ? lengthVec2(subVec2(leftShoulder, rightShoulder))
            : 72;
        // Vitruvian proportion target: shoulder span ~= 2 head widths.
        const vitruvianHeadRadius = (shoulderSpanWorld * safeScale) / 4;
        const headRadius = Math.max(14, headEnabled ? vitruvianHeadRadius : vitruvianHeadRadius * 0.9);
        return (
          <>
            <line
              x1={collar.x}
              y1={collar.y}
              x2={neck.x}
              y2={neck.y}
              stroke={headEnabled ? "rgba(17, 24, 39, 0.72)" : "rgba(107, 114, 128, 0.52)"}
              strokeWidth={headEnabled ? 2.2 : 1.6}
              strokeLinecap="round"
              vectorEffect="non-scaling-stroke"
              filter="url(#skeleton-feather)"
              pointerEvents="none"
            />
            <ellipse
              cx={torso.x}
              cy={torso.y}
              rx={torsoEnabled ? 28 : 24}
              ry={torsoEnabled ? 38 : 32}
              fill={torsoEnabled ? "rgba(17, 24, 39, 0.22)" : "rgba(107, 114, 128, 0.2)"}
              vectorEffect="non-scaling-stroke"
              filter={primitiveSurfaceFilter}
              pointerEvents="none"
            />
            <ellipse
              cx={waist.x}
              cy={waist.y}
              rx={torsoEnabled ? 22 : 19}
              ry={torsoEnabled ? 20 : 17}
              fill={torsoEnabled ? "rgba(17, 24, 39, 0.2)" : "rgba(107, 114, 128, 0.18)"}
              vectorEffect="non-scaling-stroke"
              filter={primitiveSurfaceFilter}
              pointerEvents="none"
            />
            <circle
              cx={neck.x}
              cy={neck.y}
              r={headRadius}
              fill={headEnabled ? "rgba(17, 24, 39, 0.24)" : "rgba(107, 114, 128, 0.18)"}
              vectorEffect="non-scaling-stroke"
              filter={primitiveSurfaceFilter}
              pointerEvents="none"
            />
          </>
        );
      })()}

      {skeletonLayerVisible && primitiveTurnoverEnabled && (() => {
        const leftShoulder = world.l_shoulder;
        const rightShoulder = world.r_shoulder;
        const waistJoint = world.waist;
        if (
          !leftShoulder ||
          !rightShoulder ||
          !waistJoint
        ) {
          return null;
        }
        const shoulderLeft = toDisplay(leftShoulder.worldPosition);
        const shoulderRight = toDisplay(rightShoulder.worldPosition);
        const navelDisplay = toDisplay(waistJoint.worldPosition);

        return (
          <polygon
            points={`${shoulderLeft.x},${shoulderLeft.y} ${shoulderRight.x},${shoulderRight.y} ${navelDisplay.x},${navelDisplay.y}`}
            fill="rgba(17, 24, 39, 0.08)"
            stroke="rgba(17, 24, 39, 0.18)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
            filter={primitiveSurfaceFilter}
          />
        );
      })()}

      {skeletonLayerVisible && primitiveTurnoverEnabled && (() => {
        const shinTargets: Array<{ knee: JointId; foot: JointId }> = [
          { knee: "l_knee", foot: "l_foot" },
          { knee: "r_knee", foot: "r_foot" },
        ];

        return shinTargets.map(({ knee, foot }) => {
          const kneeJoint = world[knee];
          const footJoint = world[foot];
          if (!kneeJoint || !footJoint) {
            return null;
          }
          const kneeDisplay = toDisplay(kneeJoint.worldPosition);
          const footDisplay = toDisplay(footJoint.worldPosition);
          const direction = subVec2(footDisplay, kneeDisplay);
          const length = Math.hypot(direction.x, direction.y);
          if (length < 1) {
            return null;
          }
          const perp = normalizeVec2({ x: -direction.y, y: direction.x });
          const half = scaleVec2(perp, SHIN_WIDTH / 2);
          const points = [
            addVec2(kneeDisplay, half),
            addVec2(footDisplay, half),
            addVec2(footDisplay, scaleVec2(perp, -SHIN_WIDTH / 2)),
            addVec2(kneeDisplay, scaleVec2(perp, -SHIN_WIDTH / 2)),
          ];
          const pointsAttr = points.map((point) => `${point.x},${point.y}`).join(" ");
          return (
              <polygon
                key={`shin-${knee}-${foot}`}
                points={pointsAttr}
                fill="rgba(17, 24, 39, 0.08)"
                stroke="rgba(17, 24, 39, 0.2)"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
                filter={primitiveSurfaceFilter}
              />
            );
          });
      })()}

      {masksLayerVisible && state.overlays.map((overlay) => {
        const overlayPose = resolveOverlayRenderPose(overlay, world);
        const drawPoint = toDisplay(overlayPose.position);
        const overlayRotation = overlayPose.rotationDeg;
        const overlayScaleX = overlayPose.scaleX;
        const overlayScaleY = overlayPose.scaleY;
        const filterValue = toCssFilter(overlay.filters, overlay.feather);
        const parentAnchorTransform = `translate(${drawPoint.x}, ${drawPoint.y}) rotate(${overlayRotation}) scale(${OVERLAY_ANCHOR_SCALE})`;
        const childDisplay = overlayPose.childAnchorWorld ? toDisplay(overlayPose.childAnchorWorld) : null;

        return (
          <React.Fragment key={`overlay-${overlay.id}`}>
            {overlay.visible && (
              <g
                transform={`translate(${drawPoint.x}, ${drawPoint.y}) rotate(${overlayRotation}) scale(${overlayScaleX}, ${overlayScaleY})`}
                opacity={overlay.alpha}
              >
                <image
                  href={overlay.dataUrl}
                  x={-OVERLAY_IMAGE_SIZE / 2}
                  y={-OVERLAY_IMAGE_SIZE / 2}
                  width={OVERLAY_IMAGE_SIZE}
                  height={OVERLAY_IMAGE_SIZE}
                  preserveAspectRatio="xMidYMid meet"
                  style={{ filter: filterValue, mixBlendMode: toCssBlendMode(overlay.blendMode) }}
                />
              </g>
            )}
            {showHelpers && (
              <g
                key={`overlay-anchor-parent-${overlay.id}`}
                transform={parentAnchorTransform}
                style={{
                  cursor: overlayInteractionEnabled ? "grab" : "not-allowed",
                  pointerEvents: overlayInteractionEnabled ? "auto" : "none",
                  opacity: overlayInteractionEnabled ? 1 : 0.5,
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  handleOverlayAnchorPointerDown(overlay.id, "parent", event);
                }}
              >
                <circle
                  cx={0}
                  cy={0}
                  r={13}
                  fill="rgba(0,0,0,0.001)"
                  stroke="none"
                  vectorEffect="non-scaling-stroke"
                />
                <image
                  href={overlay.dataUrl}
                  x={-OVERLAY_ANCHOR_SIZE / 2}
                  y={-OVERLAY_ANCHOR_SIZE / 2}
                  width={OVERLAY_ANCHOR_SIZE}
                  height={OVERLAY_ANCHOR_SIZE}
                  preserveAspectRatio="xMidYMid meet"
                  style={{ filter: "grayscale(1) contrast(1.2)", opacity: 0.65 }}
                />
                <image
                  href="/root-anchor.svg"
                  x={-6}
                  y={-6}
                  width={12}
                  height={12}
                  preserveAspectRatio="xMidYMid meet"
                  style={{ opacity: 0.95, pointerEvents: "none" }}
                />
                <circle
                  cx={0}
                  cy={0}
                  r={3.2}
                  fill={ROLE_COLORS.anchor}
                  stroke="#111111"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            )}
            {showHelpers && childDisplay && (
              <g
                key={`overlay-anchor-child-${overlay.id}`}
                transform={`translate(${childDisplay.x}, ${childDisplay.y}) rotate(${overlayRotation}) scale(${OVERLAY_ANCHOR_SCALE})`}
                style={{
                  cursor: overlayInteractionEnabled ? "grab" : "not-allowed",
                  pointerEvents: overlayInteractionEnabled ? "auto" : "none",
                  opacity: overlayInteractionEnabled ? 1 : 0.5,
                }}
                onPointerDown={(event) => {
                  event.stopPropagation();
                  handleOverlayAnchorPointerDown(overlay.id, "child", event);
                }}
              >
                <circle
                  cx={0}
                  cy={0}
                  r={13}
                  fill="rgba(0,0,0,0.001)"
                  stroke="none"
                  vectorEffect="non-scaling-stroke"
                />
                <image
                  href={overlay.dataUrl}
                  x={-OVERLAY_ANCHOR_SIZE / 2}
                  y={-OVERLAY_ANCHOR_SIZE / 2}
                  width={OVERLAY_ANCHOR_SIZE}
                  height={OVERLAY_ANCHOR_SIZE}
                  preserveAspectRatio="xMidYMid meet"
                  style={{ filter: "grayscale(1) contrast(1.2)", opacity: 0.45 }}
                />
                <image
                  href="/root-anchor.svg"
                  x={-6}
                  y={-6}
                  width={12}
                  height={12}
                  preserveAspectRatio="xMidYMid meet"
                  style={{ opacity: 0.95, pointerEvents: "none" }}
                />
                <circle
                  cx={0}
                  cy={0}
                  r={3.2}
                  fill={ROLE_COLORS.anchor}
                  stroke="#111111"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            )}
          </React.Fragment>
        );
      })}

      {skeletonLayerVisible && showHelpers && groundPins.map((pin) => (
        <line
          key={`ground-${pin.jointId}-${pin.groundY}`}
          x1={-5000 * safeScale + safeOffsetX}
          x2={5000 * safeScale + safeOffsetX}
          y1={pin.groundY * safeScale + safeOffsetY}
          y2={pin.groundY * safeScale + safeOffsetY}
          stroke="#0f766e"
          strokeWidth={1}
          strokeDasharray="8 6"
          vectorEffect="non-scaling-stroke"
        />
      ))}
      {skeletonLayerVisible && showHelpers && !groundPins.length && (
        <line
          x1={-5000 * safeScale + safeOffsetX}
          x2={5000 * safeScale + safeOffsetX}
          y1={floorGuideY * safeScale + safeOffsetY}
          y2={floorGuideY * safeScale + safeOffsetY}
          stroke="#94a3b8"
          strokeWidth={1}
          strokeDasharray="6 8"
          opacity={0.45}
          vectorEffect="non-scaling-stroke"
        />
      )}
      {skeletonLayerVisible && showHelpers && floorContactShadows.map(({ id, center }) => (
        <ellipse
          key={`floor-shadow-${id}`}
          cx={center.x}
          cy={center.y}
          rx={16}
          ry={5.5}
          fill="rgba(15, 23, 42, 0.2)"
          vectorEffect="non-scaling-stroke"
          pointerEvents="none"
        />
      ))}
      {skeletonLayerVisible && showBalanceOverlay && (
        <>
          <line
            x1={centerOfMassDisplay.x}
            y1={centerOfMassDisplay.y}
            x2={centerOfMassFloorDisplay.x}
            y2={centerOfMassFloorDisplay.y}
            stroke={centerOfMassBalance.color}
            strokeWidth={1.2}
            strokeDasharray="4 3"
            opacity={0.8}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
          <circle
            cx={centerOfMassDisplay.x}
            cy={centerOfMassDisplay.y}
            r={5}
            fill="#fef3c7"
            stroke={centerOfMassBalance.color}
            strokeWidth={1.6}
            vectorEffect="non-scaling-stroke"
            pointerEvents="none"
          />
          <text
            x={centerOfMassDisplay.x + 8}
            y={centerOfMassDisplay.y - 8}
            fill={centerOfMassBalance.color}
            fontSize={10}
            fontWeight={600}
            style={{ userSelect: "none", pointerEvents: "none" }}
          >
            {centerOfMassBalance.label}
          </text>
        </>
      )}

      {skeletonLayerVisible && JOINT_IDS.map((jointId) => {
        if (jointId === "waist") {
          return null;
        }
        const joint = world[jointId];
        if (!joint.parentId) {
          return null;
        }
        const parent = world[joint.parentId];
        const start = toDisplay(parent.worldPosition);
        const end = toDisplay(joint.worldPosition);
        const lineEnabled =
          isSkeletonJointVisible(jointId) &&
          isSkeletonJointVisible(joint.parentId) &&
          isJointEnabled(jointId) &&
          isJointEnabled(joint.parentId);
        return (
          <line
            key={`${joint.parentId}-${jointId}`}
            x1={start.x}
            y1={start.y}
            x2={end.x}
            y2={end.y}
            stroke={lineEnabled ? "#111111" : "#a1a1aa"}
            strokeWidth={3}
            strokeDasharray={lineEnabled ? undefined : "4 4"}
            strokeLinecap="round"
            vectorEffect="non-scaling-stroke"
            filter="url(#skeleton-feather)"
          />
        );
      })}

      {jointsLayerVisible && JOINT_IDS.map((jointId) => {
        if (jointId === "root") {
          return null;
        }
        if (!isJointVisible(jointId)) {
          return null;
        }
        const point = world[jointId].worldPosition;
        const drawPoint = toDisplay(point);
        const selected = state.selectedJointId === jointId;
        const pinState = pinByJoint.get(jointId);
        const enabled = isJointEnabled(jointId);
        const isParentJoint = parentJointSet.has(jointId);
        const isExtremityJoint = EXTREMITY_JOINT_SET.has(jointId);
        const roleColor = isParentJoint ? ROLE_COLORS.parent : ROLE_COLORS.child;
        const dotSize = selected ? (isExtremityJoint ? 18 : 16) : isExtremityJoint ? 14 : 12;
        const hitRadiusBase = selected ? (isExtremityJoint ? 15 : 13) : isExtremityJoint ? 13 : 11;
        const hitRadius = hitRadiusBase + JOINT_HIT_RADIUS_PAD;
        const markerRadius = selected ? (isExtremityJoint ? 4.8 : 4.2) : isExtremityJoint ? 3.8 : 3.2;
        return (
          <g
            key={jointId}
            style={{
              cursor: enabled ? (dragState?.kind === "joint" && dragState.jointId === jointId ? "grabbing" : "grab") : "not-allowed",
              opacity: enabled ? 1 : 0.55,
            }}
            onClick={(event) => {
              if (shouldSuppressClick()) {
                event.preventDefault();
                event.stopPropagation();
                return;
              }
              if (enabled) {
                onJointClick?.(jointId);
              }
            }}
            onPointerDown={(event) => {
              if (!enabled) {
                return;
              }
              event.stopPropagation();
              onJointPointerDown?.(jointId, point.x, point.y, event);
              handleJointDragStart(jointId, event);
            }}
          >
            <circle
              cx={drawPoint.x}
              cy={drawPoint.y}
              r={hitRadius}
              fill="rgba(0,0,0,0.001)"
              stroke="none"
              vectorEffect="non-scaling-stroke"
            />
            <image
              href="/root-anchor.svg"
              x={drawPoint.x - dotSize / 2}
              y={drawPoint.y - dotSize / 2}
              width={dotSize}
              height={dotSize}
              preserveAspectRatio="xMidYMid meet"
              style={{ pointerEvents: "none" }}
            />
            <circle
              cx={drawPoint.x}
              cy={drawPoint.y}
              r={markerRadius}
              fill={roleColor}
              stroke="#111111"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              filter="url(#skeleton-feather)"
              style={{ pointerEvents: "none" }}
            />
            {enabled && pinState?.world && (
              <rect
                x={drawPoint.x - 4}
                y={drawPoint.y - 16}
                width={8}
                height={8}
                fill="#7c3aed"
                stroke="#111111"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            )}
            {enabled && pinState?.ground && (
              <path
                d={`M ${drawPoint.x - 6} ${drawPoint.y - 10} L ${drawPoint.x + 6} ${drawPoint.y - 10} L ${drawPoint.x} ${drawPoint.y - 2} Z`}
                fill="#0f766e"
                stroke="#111111"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
            )}
          </g>
        );
      })}

      {jointsLayerVisible && JOINT_IDS.map((jointId) => {
        const target = state.ikTargets[jointId];
        if (!showIkTargets || !target?.active || !isJointEnabled(jointId) || !isJointVisible(jointId)) {
          return null;
        }
        const renderTarget = { x: target.x, y: target.y };
        const drawTarget = toDisplay(renderTarget);
        const jointWorld = world[jointId]?.worldPosition;
        const jointDrawOffset = jointWorld
          ? {
              x: toDisplay(jointWorld).x - drawTarget.x,
              y: toDisplay(jointWorld).y - drawTarget.y,
            }
          : null;
        const hasJointOffset = jointDrawOffset !== null && Math.hypot(jointDrawOffset.x, jointDrawOffset.y) > 0.75;
        const solvedTarget = targetDisplayPositions?.[jointId];
        const solvedTargetOffset =
          solvedTarget === undefined
            ? null
            : {
                x: solvedTarget.x - renderTarget.x,
                y: solvedTarget.y - renderTarget.y,
              };
        const hasSolvedOffset =
          solvedTargetOffset !== null && Math.hypot(solvedTargetOffset.x, solvedTargetOffset.y) > 0.75;
        const solvedDrawOffset = hasSolvedOffset
          ? {
              x: toDisplay({ x: solvedTarget!.x, y: solvedTarget!.y }).x - drawTarget.x,
              y: toDisplay({ x: solvedTarget!.x, y: solvedTarget!.y }).y - drawTarget.y,
            }
          : null;
        const solvedVsJointDelta =
          solvedDrawOffset && jointDrawOffset
            ? Math.hypot(solvedDrawOffset.x - jointDrawOffset.x, solvedDrawOffset.y - jointDrawOffset.y)
            : Number.POSITIVE_INFINITY;
        const showSolvedGuide = Boolean(solvedDrawOffset) && solvedVsJointDelta > 0.75;
        const draggingThisTarget = dragState?.kind === "target" && dragState.jointId === jointId;
        const hoveringThisTarget = hoveredTargetJointId === jointId;
        const activeTargetScale = draggingThisTarget ? 1.2 : hoveringThisTarget ? 1.1 : 1;
        const haloStroke = draggingThisTarget
          ? "rgba(14, 165, 233, 0.95)"
          : hoveringThisTarget
            ? "rgba(8, 145, 178, 0.72)"
            : "rgba(56, 189, 248, 0.45)";
        return (
          <g
            key={`target-${jointId}`}
            transform={`translate(${drawTarget.x}, ${drawTarget.y})`}
            onPointerEnter={() => setHoveredTargetJointId(jointId)}
            onPointerLeave={() => setHoveredTargetJointId((prev) => (prev === jointId ? null : prev))}
            onPointerDown={(event) => {
              event.stopPropagation();
              onTargetPointerDown?.(jointId, renderTarget.x, renderTarget.y, event);
              handleTargetDragStart(jointId, event);
            }}
            style={{
              cursor:
                dragState?.kind === "target" && dragState.jointId === jointId ? "grabbing" : "grab",
            }}
          >
            {hasJointOffset && jointDrawOffset && (
              <line
                x1={0}
                y1={0}
                x2={jointDrawOffset.x}
                y2={jointDrawOffset.y}
                stroke="rgba(56, 189, 248, 0.75)"
                strokeWidth={1.3}
                strokeDasharray="2.5 3.5"
                vectorEffect="non-scaling-stroke"
                style={{ pointerEvents: "none" }}
              />
            )}
            {showSolvedGuide && solvedDrawOffset && (
              <g pointerEvents="none">
                <line
                  x1={0}
                  y1={0}
                  x2={solvedDrawOffset.x}
                  y2={solvedDrawOffset.y}
                  stroke="rgba(37, 99, 235, 0.65)"
                  strokeWidth={1.3}
                  strokeDasharray="4 3"
                  vectorEffect="non-scaling-stroke"
                />
                <circle
                  cx={solvedDrawOffset.x}
                  cy={solvedDrawOffset.y}
                  r={6.2}
                  fill="none"
                  stroke="rgba(37, 99, 235, 0.72)"
                  strokeWidth={1.2}
                  vectorEffect="non-scaling-stroke"
                />
              </g>
            )}
            <circle
              cx={0}
              cy={0}
              r={TARGET_HIT_RADIUS}
              fill="rgba(0,0,0,0.001)"
              stroke="none"
              vectorEffect="non-scaling-stroke"
            />
            <circle
              cx={0}
              cy={0}
              r={7.5 * activeTargetScale}
              fill="none"
              stroke={haloStroke}
              strokeWidth={1.6}
              vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: "none" }}
            />
            <image
              href="/root-anchor.svg"
              x={-(6 * activeTargetScale)}
              y={-(6 * activeTargetScale)}
              width={12 * activeTargetScale}
              height={12 * activeTargetScale}
              preserveAspectRatio="xMidYMid meet"
              style={{ pointerEvents: "none" }}
            />
            <circle
              cx={0}
              cy={0}
              r={3.2 * activeTargetScale}
              fill={ROLE_COLORS.anchor}
              stroke="#111111"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: "none" }}
            />
          </g>
        );
      })}
      {jointsLayerVisible && JOINT_IDS.map((jointId) => {
        const poleTarget = state.ikPoleTargets[jointId];
        if (!showIkTargets || !poleTarget?.active || !isJointEnabled(jointId) || !isJointVisible(jointId)) {
          return null;
        }
        const drawTarget = toDisplay({ x: poleTarget.x, y: poleTarget.y });
        return (
          <g
            key={`pole-${jointId}`}
            transform={`translate(${drawTarget.x}, ${drawTarget.y})`}
            onPointerDown={(event) => {
              event.stopPropagation();
              onPoleTargetPointerDown?.(jointId, poleTarget.x, poleTarget.y, event);
              handlePoleTargetDragStart(jointId, event);
            }}
            style={{
              cursor:
                dragState?.kind === "pole" && dragState.jointId === jointId ? "grabbing" : "grab",
            }}
          >
            <rect
              x={-POLE_HIT_SIZE / 2}
              y={-POLE_HIT_SIZE / 2}
              width={POLE_HIT_SIZE}
              height={POLE_HIT_SIZE}
              fill="rgba(0,0,0,0.001)"
              stroke="none"
              vectorEffect="non-scaling-stroke"
            />
            <rect
              x={-5.5}
              y={-5.5}
              width={11}
              height={11}
              transform="rotate(45)"
              fill="#fef9c3"
              stroke="#92400e"
              strokeWidth={1.4}
              vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: "none" }}
            />
          </g>
        );
      })}
      </g>
      {includeForegroundLayer && activeSceneLayers.foreground.visible && activeSceneLayers.foreground.dataUrl && (
        <g
          data-export-layer="foreground"
          transform={buildSceneLayerTransform(activeSceneLayers.foreground)}
          opacity={activeSceneLayers.foreground.alpha}
          style={{
            mixBlendMode: toCssBlendMode(activeSceneLayers.foreground.blendMode),
          }}
        >
          <image
            href={activeSceneLayers.foreground.dataUrl}
            x={activeViewBox.x}
            y={activeViewBox.y}
            width={activeViewBox.width}
            height={activeViewBox.height}
            preserveAspectRatio={toPreserveAspectRatio(activeSceneLayers.foreground.fitMode)}
            style={{ filter: toCssFilter(activeSceneLayers.foreground.filters) }}
          />
        </g>
      )}
    </svg>
  );
};
