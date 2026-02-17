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
import { JointId, JOINT_IDS, PinConstraint, RigState, Vec2 } from "../rig-core/types";

export type SkeletonDisplayTransform = {
  offsetX: number;
  offsetY: number;
  scale: number;
};

type SkeletonViewportProps = {
  state: RigState;
  width?: number | string;
  height?: number | string;
  className?: string;
  primitiveTurnoverEnabled?: boolean;
  displayTransform?: SkeletonDisplayTransform;
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

// Lower fill fraction = zoomed-out framing (show a larger world area).
const DEFAULT_MODEL_HEIGHT_FRACTION = 0.4;
const PRIMITIVE_PADDING_PX = 76;
const FOOT_BOTTOM_PADDING_PX = 10;
const OVERLAY_IMAGE_SIZE = 200;
const OVERLAY_ANCHOR_SIZE = 44;
const OVERLAY_ANCHOR_SCALE = 0.28;
const ROOT_ANCHOR_RADIUS = 10;
const SHIN_WIDTH = 12;
const CAMERA_ROOT_DRIFT_RESET_THRESHOLD = 120;
const CAMERA_VIEWBOX_EASE = 0.14;
const CAMERA_VIEWBOX_DRIFT_EASE = 0.24;
const CAMERA_VIEWBOX_COMMIT_EPSILON = 1e-3;
const CAMERA_VIEWBOX_PRECISION = 4;
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
const PRIMITIVE_ACTIVATION_PARENT_BY_CHILD: Partial<Record<JointId, JointId>> = {
  l_hand: "l_elbow",
  r_hand: "r_elbow",
  l_foot: "l_knee",
  r_foot: "r_knee",
};
const getPrimitiveActivationJointId = (childId: JointId, parentId: JointId): JointId =>
  PRIMITIVE_ACTIVATION_PARENT_BY_CHILD[childId] ?? parentId;

type ViewportDragState =
  | { kind: "joint"; pointerId: number; jointId: JointId }
  | { kind: "target"; pointerId: number; jointId: JointId }
  | { kind: "pole"; pointerId: number; jointId: JointId }
  | { kind: "overlay-anchor"; pointerId: number; overlayId: string; anchor: "parent" | "child" };

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
  displayTransform,
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
  onJointPointerDown,
  onJointClick,
  onTargetPointerDown,
  onPoleTargetPointerDown,
  onJointDrag,
  onTargetDrag,
  onPoleTargetDrag,
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
  const [ghostNowMs, setGhostNowMs] = useState(() => Date.now());
  const [ghostFrames, setGhostFrames] = useState<Array<{ t: number; positions: Record<JointId, Vec2> }>>([]);
  const ghostFramesRef = useRef<Array<{ t: number; positions: Record<JointId, Vec2> }>>([]);
  const touchPointsRef = useRef<Map<number, Vec2>>(new Map());
  const pinchDistanceRef = useRef<number | null>(null);
  const showIkTargets = state.mode === "IK";
  const showMotionTrails = !cleanFkMode;
  const showBalanceOverlay = !cleanFkMode;

  const world = useMemo(() => {
    const computed = computeWorldTransforms(state.joints);
    return applyPinsToWorldTransforms(computed, state.pins).world;
  }, [state.joints, state.pins]);

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
    onDragEnd?.();
    touchPointsRef.current.clear();
    pinchDistanceRef.current = null;
  }, [dragState, onDragEnd, onOverlayAnchorDragEnd]);

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
      const sample = coalesced.length ? coalesced[coalesced.length - 1] : nativeEvent;
      const clientX = Number.isFinite(sample.clientX) ? sample.clientX : event.clientX;
      const clientY = Number.isFinite(sample.clientY) ? sample.clientY : event.clientY;

      if (event.pointerType === "touch") {
        const tracked = touchPointsRef.current.get(event.pointerId);
        if (tracked) {
          event.preventDefault();
          touchPointsRef.current.set(event.pointerId, { x: clientX, y: clientY });
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
      if (!dragState || event.pointerId !== dragState.pointerId) {
        return;
      }
      const svgPoint = clientToSvgPoint(clientX, clientY);
      if (!svgPoint) {
        return;
      }
      if (dragState.kind === "joint") {
        const worldPoint = fromDisplay(svgPoint);
        onJointDrag?.(dragState.jointId, worldPoint.x, worldPoint.y, event);
        return;
      }
      if (dragState.kind === "target") {
        const worldPoint = fromDisplay(svgPoint);
        onTargetDrag?.(dragState.jointId, worldPoint.x, worldPoint.y, event);
        return;
      }
      if (dragState.kind === "pole") {
        const worldPoint = fromDisplay(svgPoint);
        onPoleTargetDrag?.(dragState.jointId, worldPoint.x, worldPoint.y, event);
        return;
      }
      if (dragState.kind === "overlay-anchor") {
        const worldPoint = fromDisplay(svgPoint);
        onOverlayAnchorDragMove?.(
          dragState.overlayId,
          dragState.anchor,
          worldPoint.x,
          worldPoint.y,
          event
        );
        return;
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
    () => primitiveSegments.filter((segment) => EXTREMITY_JOINT_SET.has(segment.childId)),
    [primitiveSegments]
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
  const GHOST_LIFETIME_MS = 420;
  const GHOST_MAX_FRAMES = 10;

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
      const pruned = prev.filter((frame) => now - frame.t <= GHOST_LIFETIME_MS);
      const last = pruned[pruned.length - 1];
      if (last) {
        const probeJoint = state.selectedJointId ?? "waist";
        const prevPos = last.positions[probeJoint];
        const nextPos = positions[probeJoint];
        if (prevPos && nextPos) {
          const dx = nextPos.x - prevPos.x;
          const dy = nextPos.y - prevPos.y;
          if (Math.hypot(dx, dy) < 0.35) {
            return pruned;
          }
        }
      }
      const next = [...pruned, { t: now, positions }];
      return next.slice(-GHOST_MAX_FRAMES);
    });
  }, [showMotionTrails, toDisplay, world, state.selectedJointId]);

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
      setGhostFrames((prev) => prev.filter((frame) => now - frame.t <= GHOST_LIFETIME_MS));
      const hasVisibleFrame = ghostFramesRef.current.some((frame) => now - frame.t <= GHOST_LIFETIME_MS);
      if (hasVisibleFrame) {
        rafId = requestAnimationFrame(tick);
      }
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, [ghostFrames.length, showMotionTrails]);

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

  return (
    <svg
      ref={svgRef}
      className={className}
      width={width}
      height={height}
      viewBox={cameraLockedViewBox ?? stableViewBoxRef.current}
      role="img"
      aria-label="Skeleton viewport"
      onPointerMove={handleSvgPointerMove}
      onPointerDown={handleSvgPointerDown}
      onPointerUp={clearDrag}
      onPointerCancel={clearDrag}
      style={{
        background: "#ffffff",
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

      <rect x="-5000" y="-5000" width="10000" height="10000" fill="url(#rig-grid)" />
      {skeletonVisible && world.waist && (
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
      {jointsVisible && (() => {
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
              r={ROOT_ANCHOR_RADIUS + 13}
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
            {!cleanFkMode && world.torso && (
              <circle
                cx={toDisplay(world.torso.worldPosition).x}
                cy={toDisplay(world.torso.worldPosition).y}
                r={ROOT_ANCHOR_RADIUS * 0.6}
                fill="rgba(244, 114, 182, 0.35)"
                stroke="#c026d3"
                strokeWidth={1}
                vectorEffect="non-scaling-stroke"
              />
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
          {JOINT_IDS.map((jointId) => {
            if (jointId === "root") {
              return null;
            }
            const p = liveGhostPositions[jointId];
            return (
              <circle
                key={`live-ghost-joint-${jointId}`}
                cx={p.x}
                cy={p.y}
                r={4.5}
                fill="#ddd6fe"
                stroke="#8b5cf6"
                strokeWidth={1.2}
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
            {JOINT_IDS.map((jointId) => {
              if (jointId === "root") {
                return null;
              }
              const p = frame.positions[jointId];
              return (
                <circle
                  key={`ghost-joint-${frame.t}-${jointId}`}
                  cx={p.x}
                  cy={p.y}
                  r={4}
                  fill="#c4b5fd"
                  stroke="#7c3aed"
                  strokeWidth={1}
                  vectorEffect="non-scaling-stroke"
                />
              );
            })}
          </g>
        );
      })}

      {skeletonVisible && primitiveSegments.map((segment) => {
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
            onClick={() => {
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
      {skeletonVisible && extremitySegments.map((segment) => {
        const enabled =
          isSkeletonJointVisible(segment.childId) &&
          isSkeletonJointVisible(segment.parentId) &&
          isJointEnabled(segment.childId) &&
          isJointEnabled(segment.parentId);
        const direction = subVec2(segment.end, segment.start);
        const angleDeg = (Math.atan2(direction.y, direction.x) * 180) / Math.PI;
        const isFoot = FOOT_JOINT_SET.has(segment.childId);
        const radiusX = isFoot ? 11 : 7.5;
        const radiusY = isFoot ? 5.5 : 6.5;
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
            onClick={() => {
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
            <ellipse
              cx={segment.end.x}
              cy={segment.end.y}
              rx={radiusX}
              ry={radiusY}
              fill={enabled ? "rgba(17, 24, 39, 0.24)" : "rgba(107, 114, 128, 0.2)"}
              stroke={enabled ? "rgba(17, 24, 39, 0.45)" : "rgba(107, 114, 128, 0.35)"}
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              filter={primitiveSurfaceFilter}
              transform={`rotate(${angleDeg} ${segment.end.x} ${segment.end.y})`}
            />
            <ellipse
              cx={segment.end.x}
              cy={segment.end.y}
              rx={radiusX + 4}
              ry={radiusY + 4}
              fill="rgba(0,0,0,0.001)"
              stroke="none"
              vectorEffect="non-scaling-stroke"
              transform={`rotate(${angleDeg} ${segment.end.x} ${segment.end.y})`}
            />
          </g>
        );
      })}
      {skeletonVisible && collarTrianglePoints && (
        <polygon
          points={collarTrianglePoints}
          fill="rgba(37, 99, 235, 0.08)"
          stroke="rgba(37, 99, 235, 0.4)"
          strokeWidth={1.2}
          vectorEffect="non-scaling-stroke"
          filter="url(#primitive-feather)"
        />
      )}

      {skeletonVisible && (() => {
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

      {skeletonVisible && primitiveTurnoverEnabled && (() => {
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

      {skeletonVisible && primitiveTurnoverEnabled && (() => {
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

      {masksVisible && state.overlays.map((overlay) => {
        const parent = overlay.parentJointId ? world[overlay.parentJointId] : null;
        const parentWorldPosition = parent?.worldPosition ?? { x: 0, y: 0 };
        const parentWorldRotation = parent?.worldRotationDeg ?? 0;
        const rotatedOffset = rotateVec2(overlay.offset, parentWorldRotation);
        const overlayPosition = addVec2(parentWorldPosition, rotatedOffset);
        const drawPoint = toDisplay(overlayPosition);
        const overlayRotation = normalizeAngleDeg(parentWorldRotation + overlay.rotation);
        const overlayScaleX = overlay.scale * (overlay.flipX ? -1 : 1);
        const overlayScaleY = overlay.scale * (overlay.flipY ? -1 : 1);
        const filterValue = overlay.feather
          ? `grayscale(1) contrast(1.1) blur(${overlay.feather}px)`
          : "grayscale(1) contrast(1.1)";
        const parentAnchorTransform = `translate(${drawPoint.x}, ${drawPoint.y}) rotate(${overlayRotation}) scale(${OVERLAY_ANCHOR_SCALE})`;

        const childJoint = overlay.childJointId ? world[overlay.childJointId] : null;
        const childAnchorPosition =
          childJoint && overlay.childJointId
            ? addVec2(childJoint.worldPosition, rotateVec2(overlay.childOffset, childJoint.worldRotationDeg))
            : null;
        const childDisplay = childAnchorPosition ? toDisplay(childAnchorPosition) : null;

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
                  style={{ filter: filterValue, mixBlendMode: "multiply" }}
                />
              </g>
            )}
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
            {childDisplay && (
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

      {skeletonVisible && groundPins.map((pin) => (
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
      {skeletonVisible && !groundPins.length && (
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
      {skeletonVisible && floorContactShadows.map(({ id, center }) => (
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
      {skeletonVisible && showBalanceOverlay && (
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

      {skeletonVisible && JOINT_IDS.map((jointId) => {
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

      {jointsVisible && JOINT_IDS.map((jointId) => {
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
        const hitRadius = selected ? (isExtremityJoint ? 15 : 13) : isExtremityJoint ? 13 : 11;
        const markerRadius = selected ? (isExtremityJoint ? 4.8 : 4.2) : isExtremityJoint ? 3.8 : 3.2;
        return (
          <g
            key={jointId}
            style={{
              cursor: enabled ? (dragState?.kind === "joint" && dragState.jointId === jointId ? "grabbing" : "grab") : "not-allowed",
              opacity: enabled ? 1 : 0.55,
            }}
            onClick={() => {
              if (enabled) {
                onJointClick?.(jointId);
              }
            }}
            onPointerDown={(event) => {
              if (!enabled) {
                return;
              }
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

      {jointsVisible && JOINT_IDS.map((jointId) => {
        const target = state.ikTargets[jointId];
        if (!showIkTargets || !target?.active || !isJointEnabled(jointId) || !isJointVisible(jointId)) {
          return null;
        }
        const drawTarget = toDisplay({ x: target.x, y: target.y });
        return (
          <g
            key={`target-${jointId}`}
            transform={`translate(${drawTarget.x}, ${drawTarget.y})`}
            onPointerDown={(event) => {
              onTargetPointerDown?.(jointId, target.x, target.y, event);
              handleTargetDragStart(jointId, event);
            }}
            style={{
              cursor:
                dragState?.kind === "target" && dragState.jointId === jointId ? "grabbing" : "grab",
            }}
          >
            <circle
              cx={0}
              cy={0}
              r={12}
              fill="rgba(0,0,0,0.001)"
              stroke="none"
              vectorEffect="non-scaling-stroke"
            />
            <image
              href="/root-anchor.svg"
              x={-6}
              y={-6}
              width={12}
              height={12}
              preserveAspectRatio="xMidYMid meet"
              style={{ pointerEvents: "none" }}
            />
            <circle
              cx={0}
              cy={0}
              r={3.2}
              fill={ROLE_COLORS.anchor}
              stroke="#111111"
              strokeWidth={1}
              vectorEffect="non-scaling-stroke"
              style={{ pointerEvents: "none" }}
            />
          </g>
        );
      })}
      {jointsVisible && JOINT_IDS.map((jointId) => {
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
              onPoleTargetPointerDown?.(jointId, poleTarget.x, poleTarget.y, event);
              handlePoleTargetDragStart(jointId, event);
            }}
            style={{
              cursor:
                dragState?.kind === "pole" && dragState.jointId === jointId ? "grabbing" : "grab",
            }}
          >
            <rect
              x={-10}
              y={-10}
              width={20}
              height={20}
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
    </svg>
  );
};
