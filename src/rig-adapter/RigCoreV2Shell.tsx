import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CanvasCommandWheel, type CanvasWheelDensity } from "../components/CanvasCommandWheel";
import { SkeletonViewport } from "../components/SkeletonViewport";
import { normalizeAngleDeg, normalizeSignedAngleDeg, inverseRotateVec2, subVec2 } from "../rig-core/graph";
import { AnimationPanel } from "./AnimationPanel";
import {
  DEFAULT_CONSTRAINT_SETTINGS,
  JOINT_IDS,
  type ConstraintSettings,
  type JointId,
  type SvgOverlay,
  type Vec2,
} from "../rig-core/types";
import {
  fromRigSnapshotV2,
  migrateLegacyPayloadToRigSnapshotV2,
  toRigSnapshotV2,
  type RigSnapshotV2,
} from "../rig-core/serialize";
import { useRigAdapter } from "./useRigAdapter";
import { createSvgOverlay, OVERLAY_FEATHER_MAX, OVERLAY_SCALE_MAX, OVERLAY_SCALE_MIN } from "../rig-core/overlay";

type FixLogEntry = {
  id: string;
  createdAt: string;
  title: string;
  details: string;
  status: "open" | "resolved";
};

type RigTransferPayloadV2 = {
  version: 2;
  snapshot: RigSnapshotV2;
  calibration: {
    skeletonScale: number;
    jointEnabled: Partial<Record<JointId, boolean>>;
    mirrorControlsEnabled: boolean;
    primitiveTurnoverEnabled?: boolean;
    constraintSettings?: ConstraintSettings;
  };
  fixes: FixLogEntry[];
};
type ConsoleTab = "rig" | "animation" | "skeletals" | "camera" | "data" | "slm";
type SkeletalMaskMode = "skeletal_only" | "mask_only" | "locked";
type CanvasUxPreset = "focus" | "balanced" | "full";
const GROUND_ROOT_Y = 0;
const MAX_GROUND_PINNED_STRETCH_RATIO = 1.75;
const DEFAULT_CONSOLE_TAB: ConsoleTab = "animation";
const DEFAULT_GROUND_ROOT_X_ENABLED = false;
const DEFAULT_GROUND_ROOT_Y_ENABLED = false;
const DEFAULT_CAMERA_ZOOM_PRESET: "far" | "medium" | "close" = "medium";
const DEFAULT_CAMERA_ZOOM_MULTIPLIER = 2;
const DEFAULT_CAMERA_FOCUS_MODE: "root_pin" | "selected_joint" | "static" = "static";
const DEFAULT_MIRROR_CONTROLS_ENABLED = false;
const DEFAULT_PRIMITIVE_TURNOVER_ENABLED = false;
const DEFAULT_ADVANCED_RIG_ENABLED = false;
const DEFAULT_SKELETAL_MASK_MODE: SkeletalMaskMode = "skeletal_only";
const DEFAULT_AUTO_CLONE_LIMB_UPLOADS = true;
const DEFAULT_CANVAS_UX_PRESET: CanvasUxPreset = "focus";
const DEFAULT_WHEEL_DENSITY: CanvasWheelDensity = "standard";
const FK_ROTATION_DRAG_SENSITIVITY = 0.45;
const WHEEL_ROTATION_SENSITIVITY = 0.6;
const ROTATION_DELTA_DEADBAND_DEG = 0.08;
const ROTATION_INTERPOLATION_ALPHA = 0.36;
const ROTATION_INTERPOLATION_RESET_MS = 120;
const SVG_ARTIFACT_MAIN_OVERLAP_MARGIN_RATIO = 0.18;
const SVG_ARTIFACT_MAX_MAIN_AREA_RATIO = 0.08;
const SVG_ARTIFACT_MAX_VIEWBOX_AREA_RATIO = 0.01;
const SVG_ARTIFACT_MIN_CENTER_DISTANCE_RATIO = 0.55;
const IK_CHAIN_BY_EFFECTOR: Partial<Record<JointId, JointId[]>> = {
  l_hand: ["l_shoulder", "l_elbow", "l_hand"],
  r_hand: ["r_shoulder", "r_elbow", "r_hand"],
  l_foot: ["l_hip", "l_knee", "l_foot"],
  r_foot: ["r_hip", "r_knee", "r_foot"],
  neck: ["root", "waist", "xiphoid", "collar", "neck"],
};
const IK_POLE_JOINT_BY_EFFECTOR: Partial<Record<JointId, JointId>> = {
  l_hand: "l_elbow",
  r_hand: "r_elbow",
  l_foot: "l_knee",
  r_foot: "r_knee",
};
const MIRRORED_JOINT_MAP: Partial<Record<JointId, JointId>> = {
  l_shoulder: "r_shoulder",
  r_shoulder: "l_shoulder",
  l_elbow: "r_elbow",
  r_elbow: "l_elbow",
  l_hand: "r_hand",
  r_hand: "l_hand",
  l_hip: "r_hip",
  r_hip: "l_hip",
  l_knee: "r_knee",
  r_knee: "l_knee",
  l_foot: "r_foot",
  r_foot: "l_foot",
};
const DEFAULT_CHILD_BY_PARENT: Partial<Record<JointId, JointId>> = {
  root: "waist",
  waist: "xiphoid",
  xiphoid: "collar",
  collar: "torso",
  l_shoulder: "l_elbow",
  l_elbow: "l_hand",
  r_shoulder: "r_elbow",
  r_elbow: "r_hand",
  l_hip: "l_knee",
  l_knee: "l_foot",
  r_hip: "r_knee",
  r_knee: "r_foot",
};
const CLICK_ACTIVATION_PARENT_BY_CHILD: Partial<Record<JointId, JointId>> = {
  l_hand: "l_elbow",
  r_hand: "r_elbow",
  l_foot: "l_knee",
  r_foot: "r_knee",
};

const getMirroredJointId = (jointId: JointId): JointId | null =>
  MIRRORED_JOINT_MAP[jointId] ?? null;
const getClickActivationJointId = (jointId: JointId): JointId =>
  CLICK_ACTIVATION_PARENT_BY_CHILD[jointId] ?? jointId;
const isLegEffector = (jointId: JointId): boolean => jointId === "l_foot" || jointId === "r_foot";

const formatJointLabel = (jointId: JointId): string => {
  if (jointId === "root") return "waist";
  if (jointId === "waist") return "navel";
  if (jointId === "neck") return "nose";
  return jointId;
};

const asFiniteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const encodeSvgTextToBase64 = (text: string): string => {
  const safeText = unescape(encodeURIComponent(text));
  if (typeof window !== "undefined" && typeof window.btoa === "function") {
    return window.btoa(safeText);
  }
  if (typeof globalThis !== "undefined" && typeof globalThis.btoa === "function") {
    return globalThis.btoa(safeText);
  }
  let binary = "";
  for (let i = 0; i < safeText.length; i += 1) {
    binary += String.fromCharCode(safeText.charCodeAt(i));
  }
  return btoa(binary);
};

const decodeBase64SvgText = (base64: string): string => {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) {
    bytes[i] = binary.charCodeAt(i);
  }
  return new TextDecoder().decode(bytes);
};

const decodeSvgDataUri = (dataUri: string): string | null => {
  if (!dataUri.startsWith("data:image/svg+xml")) {
    return null;
  }
  const commaIndex = dataUri.indexOf(",");
  if (commaIndex < 0) {
    return null;
  }
  const meta = dataUri.slice(0, commaIndex).toLowerCase();
  const payload = dataUri.slice(commaIndex + 1);
  try {
    if (meta.includes(";base64")) {
      return decodeBase64SvgText(payload);
    }
    return decodeURIComponent(payload);
  } catch {
    return null;
  }
};

const svgTextToDataUrl = (svgText: string): string =>
  `data:image/svg+xml;base64,${encodeSvgTextToBase64(svgText)}`;

const sanitizeDetachedSvgArtifacts = (svgText: string): { svgText: string; removedCount: number } => {
  if (typeof DOMParser === "undefined" || typeof XMLSerializer === "undefined" || typeof document === "undefined") {
    return { svgText, removedCount: 0 };
  }

  const parser = new DOMParser();
  const doc = parser.parseFromString(svgText, "image/svg+xml");
  if (doc.querySelector("parsererror")) {
    return { svgText, removedCount: 0 };
  }
  const sourceSvg = doc.documentElement;
  if (!sourceSvg || sourceSvg.tagName.toLowerCase() !== "svg") {
    return { svgText, removedCount: 0 };
  }

  const markerAttr = "data-artifact-candidate-id";
  const renderableSelector = "path,rect,circle,ellipse,polygon,polyline,line,image,text,use";
  const sourceCandidates = Array.from(sourceSvg.querySelectorAll(renderableSelector)).filter(
    (element) => !element.closest("defs,clipPath,mask,marker,pattern,symbol,linearGradient,radialGradient,filter")
  );

  if (sourceCandidates.length < 2) {
    return { svgText, removedCount: 0 };
  }

  sourceCandidates.forEach((element, index) => {
    element.setAttribute(markerAttr, String(index));
  });

  const mount = document.createElement("div");
  mount.style.position = "fixed";
  mount.style.left = "-100000px";
  mount.style.top = "-100000px";
  mount.style.width = "0";
  mount.style.height = "0";
  mount.style.opacity = "0";
  mount.style.pointerEvents = "none";
  mount.style.overflow = "hidden";
  document.body.appendChild(mount);

  let removedCount = 0;
  try {
    const liveSvg = sourceSvg.cloneNode(true) as SVGSVGElement;
    mount.appendChild(liveSvg);
    const liveCandidates = Array.from(liveSvg.querySelectorAll(`[${markerAttr}]`));
    const metrics = liveCandidates
      .map((element) => {
        const id = element.getAttribute(markerAttr);
        if (id === null) {
          return null;
        }
        try {
          const bbox = (element as SVGGraphicsElement).getBBox();
          if (!Number.isFinite(bbox.width) || !Number.isFinite(bbox.height)) {
            return null;
          }
          const area = Math.max(0, bbox.width * bbox.height);
          if (area <= 0) {
            return null;
          }
          return {
            id,
            area,
            minX: bbox.x,
            minY: bbox.y,
            maxX: bbox.x + bbox.width,
            maxY: bbox.y + bbox.height,
            centerX: bbox.x + bbox.width * 0.5,
            centerY: bbox.y + bbox.height * 0.5,
            width: bbox.width,
            height: bbox.height,
          };
        } catch {
          return null;
        }
      })
      .filter((entry): entry is NonNullable<typeof entry> => Boolean(entry));

    if (metrics.length >= 2) {
      const main = metrics.reduce((largest, current) => (current.area > largest.area ? current : largest));
      const mainArea = Math.max(1, main.area);
      const margin = Math.max(main.width, main.height) * SVG_ARTIFACT_MAIN_OVERLAP_MARGIN_RATIO;
      const diagonal = Math.max(1, Math.hypot(main.width, main.height));

      const viewBoxAttr = sourceSvg.getAttribute("viewBox");
      const viewBoxArea = (() => {
        if (!viewBoxAttr) {
          return mainArea;
        }
        const parts = viewBoxAttr
          .split(/[\s,]+/)
          .map((part) => Number(part))
          .filter((part) => Number.isFinite(part));
        if (parts.length !== 4) {
          return mainArea;
        }
        const width = Math.abs(parts[2]);
        const height = Math.abs(parts[3]);
        const area = width * height;
        return Number.isFinite(area) && area > 0 ? area : mainArea;
      })();

      const idsToRemove = metrics
        .filter((entry) => entry.id !== main.id)
        .filter((entry) => {
          const overlapsExpandedMain = !(
            entry.maxX < main.minX - margin ||
            entry.minX > main.maxX + margin ||
            entry.maxY < main.minY - margin ||
            entry.minY > main.maxY + margin
          );
          if (overlapsExpandedMain) {
            return false;
          }
          const areaRatioToMain = entry.area / mainArea;
          const areaRatioToViewBox = entry.area / Math.max(1, viewBoxArea);
          const centerDistance =
            Math.hypot(entry.centerX - main.centerX, entry.centerY - main.centerY) / diagonal;
          return (
            areaRatioToMain <= SVG_ARTIFACT_MAX_MAIN_AREA_RATIO &&
            areaRatioToViewBox <= SVG_ARTIFACT_MAX_VIEWBOX_AREA_RATIO &&
            centerDistance >= SVG_ARTIFACT_MIN_CENTER_DISTANCE_RATIO
          );
        })
        .map((entry) => entry.id);

      for (const id of idsToRemove) {
        const sourceElement = sourceSvg.querySelector(`[${markerAttr}="${id}"]`);
        if (sourceElement) {
          sourceElement.remove();
          removedCount += 1;
        }
      }
    }
  } finally {
    sourceSvg.querySelectorAll(`[${markerAttr}]`).forEach((element) => {
      element.removeAttribute(markerAttr);
    });
    mount.remove();
  }

  const serializer = new XMLSerializer();
  return {
    svgText: serializer.serializeToString(sourceSvg),
    removedCount,
  };
};

const generateOverlayId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `overlay-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const extractOverlayName = (source: string): string => {
  if (source.startsWith("data:")) {
    return "inline-overlay.svg";
  }
  const segments = source.split("/");
  const last = segments[segments.length - 1] ?? "overlay.svg";
  const cleaned = last.split("?")[0];
  return cleaned || "overlay.svg";
};

const resolveOverlayAnchors = (
  overlayName: string,
  fallbackParentJointId: JointId
): { parentJointId: JointId; childJointId: JointId | null } => {
  const normalized = overlayName.trim().toLowerCase();
  if (normalized.includes("head2collar")) {
    return { parentJointId: "collar", childJointId: "neck" };
  }
  return {
    parentJointId: fallbackParentJointId,
    childJointId: DEFAULT_CHILD_BY_PARENT[fallbackParentJointId] ?? null,
  };
};

const angleDegFrom = (from: { x: number; y: number }, to: { x: number; y: number }): number =>
  (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI;

const rotatePoint = (point: { x: number; y: number }, deltaDeg: number): { x: number; y: number } => {
  const rad = (deltaDeg * Math.PI) / 180;
  const c = Math.cos(rad);
  const s = Math.sin(rad);
  return {
    x: point.x * c - point.y * s,
    y: point.x * s + point.y * c,
  };
};

export const RigCoreV2Shell: React.FC = () => {
  const rig = useRigAdapter();
  const [skeletonScale, setSkeletonScale] = useState(1);
  const [jointEnabled, setJointEnabled] = useState<Partial<Record<JointId, boolean>>>(() =>
    Object.fromEntries(JOINT_IDS.map((jointId) => [jointId, true])) as Partial<Record<JointId, boolean>>
  );
  const [jointVisibility, setJointVisibility] = useState<Partial<Record<JointId, boolean>>>(() =>
    Object.fromEntries(JOINT_IDS.map((jointId) => [jointId, true])) as Partial<Record<JointId, boolean>>
  );
  const [skeletonVisibility, setSkeletonVisibility] = useState<Partial<Record<JointId, boolean>>>(() =>
    Object.fromEntries(JOINT_IDS.map((jointId) => [jointId, true])) as Partial<Record<JointId, boolean>>
  );
  const [showJoints, setShowJoints] = useState(true);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [showMasks, setShowMasks] = useState(true);
  const [transferInput, setTransferInput] = useState("");
  const [transferStatus, setTransferStatus] = useState("");
  const [fixTitle, setFixTitle] = useState("");
  const [fixDetails, setFixDetails] = useState("");
  const [fixLog, setFixLog] = useState<FixLogEntry[]>([]);
  const overlayFileInputRef = useRef<HTMLInputElement | null>(null);
  const [activeOverlayId, setActiveOverlayId] = useState<string | null>(null);
  const [overlayUrlInput, setOverlayUrlInput] = useState("");
  const [overlayStatus, setOverlayStatus] = useState("");
  const [activeConsoleTab, setActiveConsoleTab] = useState<ConsoleTab>(DEFAULT_CONSOLE_TAB);
  const [advancedRigEnabled, setAdvancedRigEnabled] = useState(DEFAULT_ADVANCED_RIG_ENABLED);
  const clearMasksForJoint = useCallback(
    (jointId: JointId | null) => {
      if (!jointId) {
        return;
      }
      const overlaysToRemove = rig.state.overlays.filter(
        (overlay) => overlay.parentJointId === jointId
      );
      overlaysToRemove.forEach((overlay) => rig.removeOverlay(overlay.id));
    },
    [rig, rig.state.overlays]
  );
  const [groundRootXEnabled, setGroundRootXEnabled] = useState(DEFAULT_GROUND_ROOT_X_ENABLED);
  const [groundRootYEnabled, setGroundRootYEnabled] = useState(DEFAULT_GROUND_ROOT_Y_ENABLED);
  const [cameraZoomPreset, setCameraZoomPreset] = useState<"far" | "medium" | "close">(DEFAULT_CAMERA_ZOOM_PRESET);
  const [cameraZoomMultiplier, setCameraZoomMultiplier] = useState(DEFAULT_CAMERA_ZOOM_MULTIPLIER);
  const [cameraFocusMode, setCameraFocusMode] = useState<"root_pin" | "selected_joint" | "static">(
    DEFAULT_CAMERA_FOCUS_MODE
  );
  const [mirrorControlsEnabled, setMirrorControlsEnabled] = useState(DEFAULT_MIRROR_CONTROLS_ENABLED);
  const [primitiveTurnoverEnabled, setPrimitiveTurnoverEnabled] = useState(DEFAULT_PRIMITIVE_TURNOVER_ENABLED);
  const [skeletalMaskMode, setSkeletalMaskMode] = useState<SkeletalMaskMode>(DEFAULT_SKELETAL_MASK_MODE);
  const [autoCloneLimbUploads, setAutoCloneLimbUploads] = useState(DEFAULT_AUTO_CLONE_LIMB_UPLOADS);
  const [canvasUxPreset, setCanvasUxPreset] = useState<CanvasUxPreset>(DEFAULT_CANVAS_UX_PRESET);
  const [wheelDensity, setWheelDensity] = useState<CanvasWheelDensity>(DEFAULT_WHEEL_DENSITY);
  const [groundPlaneY, setGroundPlaneY] = useState(GROUND_ROOT_Y);
  const [cameraOffset, setCameraOffset] = useState({ x: 0, y: 0 });
  const fkDragRotationRef = useRef<{
    jointId: JointId;
    pivot: { x: number; y: number };
    lastPointerAngleDeg: number;
    currentJointRotationDeg: number;
    mirroredJointId: JointId | null;
    currentMirroredRotationDeg: number;
  } | null>(null);
  const fkDragDeltaFilterRef = useRef<{ jointId: JointId | null; value: number; lastMs: number }>({
    jointId: null,
    value: 0,
    lastMs: 0,
  });
  const wheelDeltaFilterRef = useRef<{ value: number; lastMs: number }>({
    value: 0,
    lastMs: 0,
  });
  const previousAdvancedRigEnabledRef = useRef(advancedRigEnabled);
  const availableConsoleTabs = useMemo<ConsoleTab[]>(
    () => ["rig", "animation", "skeletals", "camera", "data", "slm"],
    []
  );
  useEffect(() => {
    if (!availableConsoleTabs.includes(activeConsoleTab)) {
      setActiveConsoleTab("rig");
    }
  }, [activeConsoleTab, availableConsoleTabs]);
  useEffect(() => {
    if (previousAdvancedRigEnabledRef.current && !advancedRigEnabled) {
      fkDragRotationRef.current = null;
      fkDragDeltaFilterRef.current = { jointId: null, value: 0, lastMs: 0 };
      wheelDeltaFilterRef.current = { value: 0, lastMs: 0 };
      rig.dragEnd();
    }
    previousAdvancedRigEnabledRef.current = advancedRigEnabled;
  }, [advancedRigEnabled, rig]);
  const handlePinchZoom = useCallback((scaleMultiplier: number) => {
    if (!Number.isFinite(scaleMultiplier) || scaleMultiplier <= 0) {
      return;
    }
    setCameraZoomMultiplier((prev) => {
      const next = prev * scaleMultiplier;
      return Math.min(4, Math.max(0.05, next));
    });
  }, []);

  const selectedJointId = rig.state.selectedJointId ?? "waist";
  const selectedJoint = rig.state.joints[selectedJointId];
  const selectedTarget = rig.state.ikTargets[selectedJointId];
  const selectedPoleJointId = IK_POLE_JOINT_BY_EFFECTOR[selectedJointId] ?? null;
  const selectedPoleTarget = selectedPoleJointId
    ? rig.state.ikPoleTargets[selectedPoleJointId]
    : undefined;
  const selectedPoleWorldPosition = selectedPoleJointId
    ? rig.worldTransforms[selectedPoleJointId].worldPosition
    : null;
  const selectedPoleXValue = selectedPoleTarget?.x ?? selectedPoleWorldPosition?.x ?? 0;
  const selectedPoleYValue = selectedPoleTarget?.y ?? selectedPoleWorldPosition?.y ?? 0;
  const selectedJointWorldPosition = rig.worldTransforms[selectedJointId].worldPosition;
  const wheelXValue = rig.state.mode === "IK"
    ? (selectedTarget?.x ?? selectedJointWorldPosition.x)
    : selectedJoint.localTranslation.x;
  const wheelYValue = rig.state.mode === "IK"
    ? (selectedTarget?.y ?? selectedJointWorldPosition.y)
    : selectedJoint.localTranslation.y;
  const selectedJointEnabled = jointEnabled[selectedJointId] !== false;
  const rootJoint = rig.state.joints.root;
  const leftFootWorld = rig.worldTransforms.l_foot.worldPosition;
  const rightFootWorld = rig.worldTransforms.r_foot.worldPosition;
  const currentGroundY = useMemo(() => {
    const leftGroundPin = rig.state.pins.find((pin) => pin.kind === "ground" && pin.jointId === "l_foot");
    const rightGroundPin = rig.state.pins.find((pin) => pin.kind === "ground" && pin.jointId === "r_foot");
    if (leftGroundPin?.kind === "ground") {
      return leftGroundPin.groundY;
    }
    if (rightGroundPin?.kind === "ground") {
      return rightGroundPin.groundY;
    }
    return Math.max(leftFootWorld.y, rightFootWorld.y);
  }, [leftFootWorld.y, rightFootWorld.y, rig.state.pins]);
  const hasAnyFootGroundPin = useMemo(
    () =>
      rig.state.pins.some(
        (pin) =>
          pin.kind === "ground" && (pin.jointId === "l_foot" || pin.jointId === "r_foot")
      ),
    [rig.state.pins]
  );
  const clampIkDragPoint = useCallback(
    (jointId: JointId, x: number, y: number): { x: number; y: number } => {
      if (!hasAnyFootGroundPin || !rig.state.constraintSettings.clampGroundedIkTargetReach) {
        return { x, y };
      }

      const chain = IK_CHAIN_BY_EFFECTOR[jointId];
      if (!chain || chain.length < 2) {
        return { x, y };
      }

      const rootWorld = rig.worldTransforms[chain[0]]?.worldPosition;
      if (!rootWorld) {
        return { x, y };
      }

      let baseReach = 0;
      for (let index = 1; index < chain.length; index += 1) {
        const childId = chain[index];
        const local = rig.state.joints[childId]?.localTranslation;
        if (!local) {
          continue;
        }
        baseReach += Math.hypot(local.x, local.y);
      }

      const maxReach =
        baseReach *
        (rig.state.ikStretchEnabled && !isLegEffector(jointId) ? MAX_GROUND_PINNED_STRETCH_RATIO : 1);
      const dx = x - rootWorld.x;
      const dy = y - rootWorld.y;
      const distance = Math.hypot(dx, dy);
      if (!Number.isFinite(distance) || distance <= maxReach || maxReach <= 0) {
        return { x, y };
      }

      const t = maxReach / distance;
      return {
        x: rootWorld.x + dx * t,
        y: rootWorld.y + dy * t,
      };
    },
    [
      hasAnyFootGroundPin,
      rig.state.constraintSettings.clampGroundedIkTargetReach,
      rig.state.ikStretchEnabled,
      rig.state.joints,
      rig.worldTransforms,
    ]
  );
  const normalizedRotation = useMemo(
    () => normalizeAngleDeg(selectedJoint.localRotationDegRaw),
    [selectedJoint.localRotationDegRaw]
  );
  const poseDataText = useMemo(() => JSON.stringify(toRigSnapshotV2(rig.state), null, 2), [rig.state]);
  const overlaySpawnJointId: JointId = rig.state.selectedJointId ?? "waist";
  const effectiveInteractionMode: SkeletalMaskMode = useMemo(() => {
    if (activeConsoleTab === "rig") {
      return "locked";
    }
    if (activeConsoleTab === "skeletals") {
      return "skeletal_only";
    }
    if (activeConsoleTab === "slm") {
      return skeletalMaskMode;
    }
    return "skeletal_only";
  }, [activeConsoleTab, skeletalMaskMode]);
  const showSidebar = canvasUxPreset !== "focus";
  const activeWheelDensity: CanvasWheelDensity = useMemo(() => {
    if (canvasUxPreset === "focus") {
      return "minimal";
    }
    if (canvasUxPreset === "full") {
      return "full";
    }
    return wheelDensity;
  }, [canvasUxPreset, wheelDensity]);
  const skeletalInteractionEnabled = effectiveInteractionMode !== "mask_only";
  const maskInteractionEnabled = effectiveInteractionMode !== "skeletal_only";
  const overlayEditingEnabled = activeConsoleTab === "slm" && maskInteractionEnabled;
  const overlaysHierarchical = useMemo(() => {
    const joints = rig.state.joints;
    const depthCache = new Map<JointId, number>();
    const jointOrder = new Map<JointId, number>(JOINT_IDS.map((jointId, index) => [jointId, index]));

    const getDepth = (jointId: JointId | null): number => {
      if (!jointId) {
        return 0;
      }
      const cached = depthCache.get(jointId);
      if (cached !== undefined) {
        return cached;
      }
      const parentId = joints[jointId]?.parentId ?? null;
      const depth = parentId ? getDepth(parentId) + 1 : 0;
      depthCache.set(jointId, depth);
      return depth;
    };

    return rig.state.overlays
      .map((overlay, index) => {
        const parentDepth = getDepth(overlay.parentJointId);
        const childDepth = getDepth(overlay.childJointId);
        const parentOrder = overlay.parentJointId ? (jointOrder.get(overlay.parentJointId) ?? 999) : 999;
        const childOrder = overlay.childJointId ? (jointOrder.get(overlay.childJointId) ?? 999) : 999;
        return {
          overlay,
          parentDepth,
          childDepth,
          indentLevel: Math.max(0, parentDepth),
          parentOrder,
          childOrder,
          index,
        };
      })
      .sort((a, b) => {
        if (a.parentDepth !== b.parentDepth) return a.parentDepth - b.parentDepth;
        if (a.parentOrder !== b.parentOrder) return a.parentOrder - b.parentOrder;
        if (a.childDepth !== b.childDepth) return a.childDepth - b.childDepth;
        if (a.childOrder !== b.childOrder) return a.childOrder - b.childOrder;
        return a.index - b.index;
      });
  }, [rig.state.joints, rig.state.overlays]);

  const appendFixEntry = useCallback(
    (title: string, details: string, status: "open" | "resolved" = "open") => {
      const now = new Date().toISOString();
      setFixLog((prev) => [
        {
          id: `${now}-${Math.random().toString(16).slice(2)}`,
          createdAt: now,
          title: title.trim() || "Untitled fix",
          details: details.trim(),
          status,
        },
        ...prev,
      ]);
    },
    []
  );

  const handleNegativeToggleKey = useCallback(
    (
      event: React.KeyboardEvent<HTMLInputElement>,
      currentValue: number,
      applyValue: (nextValue: number) => void
    ) => {
      if (event.key !== "-") {
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey || event.shiftKey) {
        return;
      }
      event.preventDefault();
      applyValue(-currentValue);
    },
    []
  );

  const handleAddFixNote = useCallback(() => {
    if (!fixTitle.trim() && !fixDetails.trim()) {
      setTransferStatus("Enter a fix title or details first.");
      return;
    }
    appendFixEntry(
      fixTitle || `Fix on ${selectedJointId}`,
      `${fixDetails || "No details"} (joint=${selectedJointId})`,
      "open"
    );
    setFixTitle("");
    setFixDetails("");
    setTransferStatus("Fix note added.");
  }, [appendFixEntry, fixDetails, fixTitle, selectedJointId]);

  const handleToggleFixResolved = useCallback((id: string) => {
    setFixLog((prev) =>
      prev.map((entry) =>
        entry.id === id
          ? {
              ...entry,
              status: entry.status === "open" ? "resolved" : "open",
            }
          : entry
      )
    );
  }, []);

  const handleDeleteFix = useCallback((id: string) => {
    setFixLog((prev) => prev.filter((entry) => entry.id !== id));
  }, []);

  const createMirroredOverlay = useCallback(
    (overlay: SvgOverlay, options?: { force?: boolean }): SvgOverlay | null => {
      if (!options?.force && !autoCloneLimbUploads) {
        return null;
      }
      const mirroredParentJointId = overlay.parentJointId
        ? getMirroredJointId(overlay.parentJointId)
        : null;
      const mirroredChildJointId = overlay.childJointId
        ? getMirroredJointId(overlay.childJointId)
        : null;
      if (!mirroredParentJointId && !mirroredChildJointId) {
        return null;
      }
      return {
        ...overlay,
        id: generateOverlayId(),
        name: `${overlay.name} (mirror)`,
        parentJointId: mirroredParentJointId ?? overlay.parentJointId,
        childJointId: mirroredChildJointId ?? overlay.childJointId,
        offset: {
          x: -overlay.offset.x,
          y: overlay.offset.y,
        },
        childOffset: {
          x: -overlay.childOffset.x,
          y: overlay.childOffset.y,
        },
        rotation: -overlay.rotation,
        flipX: !overlay.flipX,
      };
    },
    [autoCloneLimbUploads]
  );

  const handleMirrorOverlayClone = useCallback(
    (overlay: SvgOverlay) => {
      const mirroredOverlay = createMirroredOverlay(overlay, { force: true });
      if (!mirroredOverlay) {
        setOverlayStatus(`${overlay.name} has no mirrored joint mapping.`);
        return;
      }
      rig.addOverlay(mirroredOverlay);
      setActiveOverlayId(mirroredOverlay.id);
      appendFixEntry(
        "Overlay mirrored",
        `${overlay.name} mirrored to ${mirroredOverlay.name}.`,
        "resolved"
      );
      setOverlayStatus(`${overlay.name} mirrored to ${mirroredOverlay.parentJointId ?? "opposite side"}.`);
    },
    [appendFixEntry, createMirroredOverlay, rig]
  );

  useEffect(() => {
    if (!rig.state.overlays.length) {
      setActiveOverlayId(null);
      return;
    }
    setActiveOverlayId((prev) =>
      prev && rig.state.overlays.some((overlay) => overlay.id === prev)
        ? prev
        : rig.state.overlays[0].id
    );
  }, [rig.state.overlays]);

  useEffect(() => {
    for (const overlay of rig.state.overlays) {
      if (overlay.parentJointId) {
        continue;
      }
      const parentJointId = selectedJointId;
      rig.updateOverlay(overlay.id, {
        parentJointId,
        childJointId: overlay.childJointId ?? DEFAULT_CHILD_BY_PARENT[parentJointId] ?? null,
      });
    }
  }, [rig, rig.state.overlays, selectedJointId]);

  const applyImportedOverlay = useCallback(
    (params: {
      overlayName: string;
      dataUrl: string;
      anchorPreset: { parentJointId: JointId; childJointId: JointId | null };
      removedArtifactCount: number;
      source: "upload" | "url";
    }) => {
      const { anchorPreset, dataUrl, overlayName, removedArtifactCount, source } = params;
      clearMasksForJoint(anchorPreset.parentJointId);
      const overlay = createSvgOverlay({
        id: generateOverlayId(),
        name: overlayName,
        dataUrl,
        parentJointId: anchorPreset.parentJointId,
      });
      if (anchorPreset.childJointId) {
        overlay.childJointId = anchorPreset.childJointId;
      }
      rig.addOverlay(overlay);
      const mirroredOverlay = createMirroredOverlay(overlay);
      if (mirroredOverlay) {
        rig.addOverlay(mirroredOverlay);
      }
      const artifactNote =
        removedArtifactCount > 0
          ? ` Removed ${removedArtifactCount} detached artifact${removedArtifactCount === 1 ? "" : "s"}.`
          : "";
      const sourceLabel = source === "url" ? "via URL" : "from upload";
      const actionLabel = source === "url" ? "added" : "uploaded";
      setActiveOverlayId(overlay.id);
      appendFixEntry(
        "Overlay added",
        mirroredOverlay
          ? `Added ${overlay.name} ${sourceLabel} with mirrored clone ${mirroredOverlay.name}.`
          : `Added ${overlay.name} ${sourceLabel} centered on ${anchorPreset.parentJointId}.`,
        "resolved"
      );
      setOverlayStatus(
        mirroredOverlay
          ? `${overlay.name} ${actionLabel} and mirrored to ${mirroredOverlay.parentJointId ?? "opposite side"}.${artifactNote}`
          : anchorPreset.childJointId
            ? `${overlay.name} anchored ${anchorPreset.parentJointId} -> ${anchorPreset.childJointId}.${artifactNote}`
            : `${overlay.name} centered on ${anchorPreset.parentJointId}.${artifactNote}`
      );
    },
    [appendFixEntry, clearMasksForJoint, createMirroredOverlay, rig]
  );

  const handleOverlayFileUpload = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (!file) {
        return;
      }
      setOverlayStatus("Loading overlay...");
      try {
        const rawSvgText = await file.text();
        const sanitized = sanitizeDetachedSvgArtifacts(rawSvgText);
        const dataUrl = svgTextToDataUrl(sanitized.svgText);
        const overlayName = file.name || "overlay.svg";
        const anchorPreset = resolveOverlayAnchors(overlayName, overlaySpawnJointId);
        applyImportedOverlay({
          overlayName,
          dataUrl,
          anchorPreset,
          removedArtifactCount: sanitized.removedCount,
          source: "upload",
        });
      } catch (error) {
        setOverlayStatus(error instanceof Error ? error.message : "Overlay upload failed.");
      } finally {
        if (event.target) {
          event.target.value = "";
        }
      }
    },
    [applyImportedOverlay, overlaySpawnJointId]
  );

  const handleOverlayUrlSubmit = useCallback(async () => {
    const trimmed = overlayUrlInput.trim();
    if (!trimmed) {
      setOverlayStatus("Paste an SVG URL or data URI first.");
      return;
    }
    setOverlayStatus("Loading overlay...");
    try {
      let svgText: string | null = null;
      let dataUrl = trimmed;
      const overlayName = extractOverlayName(trimmed);
      const anchorPreset = resolveOverlayAnchors(overlayName, overlaySpawnJointId);
      if (trimmed.startsWith("data:")) {
        svgText = decodeSvgDataUri(trimmed);
      } else {
        const response = await fetch(trimmed);
        if (!response.ok) {
          throw new Error(`Failed to fetch overlay (${response.status})`);
        }
        svgText = await response.text();
      }
      let removedCount = 0;
      if (svgText !== null) {
        const sanitized = sanitizeDetachedSvgArtifacts(svgText);
        dataUrl = svgTextToDataUrl(sanitized.svgText);
        removedCount = sanitized.removedCount;
      }
      applyImportedOverlay({
        overlayName,
        dataUrl,
        anchorPreset,
        removedArtifactCount: removedCount,
        source: "url",
      });
      setOverlayUrlInput("");
    } catch (error) {
      setOverlayStatus(error instanceof Error ? error.message : "Failed to load overlay.");
    }
  }, [applyImportedOverlay, overlaySpawnJointId, overlayUrlInput]);

  const handleOverlayAnchorDragMove = useCallback(
    (overlayId: string, anchor: "parent" | "child", x: number, y: number) => {
      if (!overlayEditingEnabled) {
        return;
      }
      const overlay = rig.state.overlays.find((entry) => entry.id === overlayId);
      if (!overlay) {
        return;
      }
      const jointId = anchor === "parent" ? overlay.parentJointId : overlay.childJointId;
      if (anchor === "parent") {
        if (!jointId) {
          rig.updateOverlay(overlayId, { offset: { x, y } });
          return;
        }
        const jointWorld = rig.worldTransforms[jointId];
        const local = inverseRotateVec2(
          subVec2({ x, y }, jointWorld.worldPosition),
          jointWorld.worldRotationDeg
        );
        rig.updateOverlay(overlayId, { offset: local });
      } else {
        if (!jointId) {
          return;
        }
        const jointWorld = rig.worldTransforms[jointId];
        const local = inverseRotateVec2(
          subVec2({ x, y }, jointWorld.worldPosition),
          jointWorld.worldRotationDeg
        );
        rig.updateOverlay(overlayId, { childOffset: local });
      }
    },
    [overlayEditingEnabled, rig]
  );

  const handleOverlayAnchorDragEnd = useCallback(
    (overlayId: string, anchor: "parent" | "child") => {
      if (!overlayEditingEnabled) {
        return;
      }
      const overlay = rig.state.overlays.find((entry) => entry.id === overlayId);
      if (!overlay) {
        return;
      }
      setOverlayStatus(`Moved ${overlay.name} ${anchor} anchor.`);
    },
    [overlayEditingEnabled, rig.state.overlays]
  );

  const handleToggleJointEnabled = useCallback(
    (jointId: JointId, enabled: boolean) => {
      setJointEnabled((prev) => ({ ...prev, [jointId]: enabled }));
      if (!enabled) {
        rig.clearIkTarget(jointId);
        rig.clearIkPoleTarget(jointId);
        rig.removePin(jointId, "world");
        rig.removePin(jointId, "ground");
      }
      appendFixEntry(
        enabled ? "Joint enabled" : "Joint disabled",
        `${jointId} was ${enabled ? "enabled" : "disabled"} in viewport editing.`,
        "resolved"
      );
    },
    [appendFixEntry, rig]
  );

  const setAllJointsEnabled = useCallback(
    (enabled: boolean) => {
      const next = Object.fromEntries(JOINT_IDS.map((jointId) => [jointId, enabled])) as Partial<
        Record<JointId, boolean>
      >;
      setJointEnabled(next);
      if (!enabled) {
        for (const jointId of JOINT_IDS) {
          rig.clearIkTarget(jointId);
          rig.clearIkPoleTarget(jointId);
          rig.removePin(jointId, "world");
          rig.removePin(jointId, "ground");
        }
      }
      appendFixEntry(
        enabled ? "Enabled all joints" : "Disabled all joints",
        enabled ? "All joints are active for editing." : "All joints disabled for troubleshooting.",
        "resolved"
      );
    },
    [appendFixEntry, rig]
  );
  const setAllJointVisibility = useCallback((visible: boolean) => {
    setJointVisibility(
      Object.fromEntries(JOINT_IDS.map((jointId) => [jointId, visible])) as Partial<Record<JointId, boolean>>
    );
  }, []);
  const setAllSkeletonVisibility = useCallback((visible: boolean) => {
    setSkeletonVisibility(
      Object.fromEntries(JOINT_IDS.map((jointId) => [jointId, visible])) as Partial<Record<JointId, boolean>>
    );
  }, []);

  const handleJointDrag = useCallback(
    (jointId: JointId, x: number, y: number) => {
      if (jointEnabled[jointId] === false) {
        return;
      }
      if (rig.state.mode === "FK") {
        if (jointId === "root") {
          const nextX = groundRootXEnabled ? x : rootJoint.localTranslation.x;
          const nextY = groundRootYEnabled ? rootJoint.localTranslation.y : y;
          rig.fkSetTranslation("root", nextX, nextY);
          return;
        }
        const fkDrag = fkDragRotationRef.current;
        if (!fkDrag || fkDrag.jointId !== jointId) {
          return;
        }
        const currentPointerAngleDeg = angleDegFrom(fkDrag.pivot, { x, y });
        const incrementalDeltaDeg =
          normalizeSignedAngleDeg(currentPointerAngleDeg - fkDrag.lastPointerAngleDeg) *
          FK_ROTATION_DRAG_SENSITIVITY;
        fkDrag.lastPointerAngleDeg = currentPointerAngleDeg;
        const now = Date.now();
        const shouldResetFilter =
          fkDragDeltaFilterRef.current.jointId !== jointId ||
          now - fkDragDeltaFilterRef.current.lastMs > ROTATION_INTERPOLATION_RESET_MS;
        if (shouldResetFilter) {
          fkDragDeltaFilterRef.current = { jointId, value: incrementalDeltaDeg, lastMs: now };
        } else {
          fkDragDeltaFilterRef.current = {
            jointId,
            value:
              fkDragDeltaFilterRef.current.value +
              (incrementalDeltaDeg - fkDragDeltaFilterRef.current.value) * ROTATION_INTERPOLATION_ALPHA,
            lastMs: now,
          };
        }
        const smoothedIncrementDeg = fkDragDeltaFilterRef.current.value;
        if (Math.abs(smoothedIncrementDeg) < ROTATION_DELTA_DEADBAND_DEG) {
          return;
        }
        const nextJointRotationDeg = fkDrag.currentJointRotationDeg + smoothedIncrementDeg;
        fkDrag.currentJointRotationDeg = nextJointRotationDeg;
        rig.fkSetRotationText(jointId, nextJointRotationDeg);
        if (
          mirrorControlsEnabled &&
          fkDrag.mirroredJointId &&
          jointEnabled[fkDrag.mirroredJointId] !== false
        ) {
          const nextMirroredRotationDeg = fkDrag.currentMirroredRotationDeg - smoothedIncrementDeg;
          fkDrag.currentMirroredRotationDeg = nextMirroredRotationDeg;
          rig.fkSetRotationText(
            fkDrag.mirroredJointId,
            nextMirroredRotationDeg
          );
        }
        return;
      }
      const clamped = clampIkDragPoint(jointId, x, y);
      rig.dragMove(clamped.x, clamped.y);
    },
    [
      clampIkDragPoint,
      groundRootXEnabled,
      groundRootYEnabled,
      jointEnabled,
      mirrorControlsEnabled,
      rig,
      rig.state.mode,
      rootJoint.localTranslation.x,
      rootJoint.localTranslation.y,
    ]
  );

  const handleTargetDrag = useCallback(
    (jointId: JointId, x: number, y: number) => {
      if (jointEnabled[jointId] === false) {
        return;
      }
      if (rig.state.mode !== "IK") {
        rig.dragMove(x, y);
        return;
      }
      const clamped = clampIkDragPoint(jointId, x, y);
      rig.dragMove(clamped.x, clamped.y);
    },
    [clampIkDragPoint, jointEnabled, rig]
  );

  const handlePoleTargetDrag = useCallback(
    (jointId: JointId, x: number, y: number) => {
      if (jointEnabled[jointId] === false) {
        return;
      }
      if (rig.state.mode !== "IK") {
        return;
      }
      rig.ikSetPoleTarget(jointId, x, y);
    },
    [jointEnabled, rig]
  );
  const setSelectedPoleTarget = useCallback(
    (x: number, y: number) => {
      if (!selectedPoleJointId) {
        return;
      }
      rig.ikSetPoleTarget(selectedPoleJointId, x, y);
    },
    [rig, selectedPoleJointId]
  );

  const applyGroundRootConstraint = useCallback((targetGroundY?: number) => {
    if (!groundRootYEnabled) {
      rig.removePin("l_foot", "ground");
      rig.removePin("r_foot", "ground");
      return;
    }
    const lockedGroundY = Number.isFinite(targetGroundY ?? Number.NaN) ? (targetGroundY as number) : groundPlaneY;
    rig.setPin({ kind: "ground", jointId: "l_foot", groundY: lockedGroundY });
    rig.setPin({ kind: "ground", jointId: "r_foot", groundY: lockedGroundY });
    setGroundPlaneY(lockedGroundY);
  }, [groundPlaneY, groundRootYEnabled, rig]);

  const handleRootTranslationChange = useCallback(
    (axis: "x" | "y", value: number) => {
      if (!Number.isFinite(value)) {
        return;
      }
      if (axis === "x") {
        if (!groundRootXEnabled) {
          return;
        }
        rig.fkSetTranslation("root", value, rootJoint.localTranslation.y);
        return;
      }
      if (groundRootYEnabled) {
        applyGroundRootConstraint(groundPlaneY);
        return;
      }
      rig.fkSetTranslation("root", rootJoint.localTranslation.x, value);
    },
    [
      applyGroundRootConstraint,
      groundPlaneY,
      groundRootXEnabled,
      groundRootYEnabled,
      rig,
      rootJoint.localTranslation.x,
      rootJoint.localTranslation.y,
    ]
  );

  const setFkTranslationWithMirror = useCallback(
    (jointId: JointId, x: number, y: number) => {
      rig.fkSetTranslation(jointId, x, y);
      if (!mirrorControlsEnabled) {
        return;
      }
      const mirroredJointId = getMirroredJointId(jointId);
      if (!mirroredJointId || jointEnabled[mirroredJointId] === false) {
        return;
      }
      rig.fkSetTranslation(mirroredJointId, -x, y);
    },
    [jointEnabled, mirrorControlsEnabled, rig]
  );

  const setFkRotationWithMirror = useCallback(
    (jointId: JointId, rawDeg: number) => {
      rig.fkSetRotationText(jointId, rawDeg);
      if (!mirrorControlsEnabled) {
        return;
      }
      const mirroredJointId = getMirroredJointId(jointId);
      if (!mirroredJointId || jointEnabled[mirroredJointId] === false) {
        return;
      }
      const mirroredRaw = ((-rawDeg % 360) + 360) % 360;
      rig.fkSetRotationText(mirroredJointId, mirroredRaw);
    },
    [jointEnabled, mirrorControlsEnabled, rig]
  );

  const cycleWheelDensity = useCallback(() => {
    setWheelDensity((prev) => (prev === "minimal" ? "standard" : prev === "standard" ? "full" : "minimal"));
  }, []);

  const handleWheelRotate = useCallback(
    (deltaDeg: number) => {
      if (!Number.isFinite(deltaDeg) || Math.abs(deltaDeg) <= 1e-4 || !selectedJointEnabled) {
        return;
      }
      const scaledDeltaDeg = deltaDeg * WHEEL_ROTATION_SENSITIVITY;
      const now = Date.now();
      if (now - wheelDeltaFilterRef.current.lastMs > ROTATION_INTERPOLATION_RESET_MS) {
        wheelDeltaFilterRef.current = {
          value: scaledDeltaDeg,
          lastMs: now,
        };
      } else {
        wheelDeltaFilterRef.current = {
          value:
            wheelDeltaFilterRef.current.value +
            (scaledDeltaDeg - wheelDeltaFilterRef.current.value) * ROTATION_INTERPOLATION_ALPHA,
          lastMs: now,
        };
      }
      const smoothedDeltaDeg = wheelDeltaFilterRef.current.value;
      if (Math.abs(smoothedDeltaDeg) < ROTATION_DELTA_DEADBAND_DEG) {
        return;
      }
      if (rig.state.mode === "FK") {
        setFkRotationWithMirror(selectedJointId, selectedJoint.localRotationDegRaw + smoothedDeltaDeg);
        return;
      }

      const chain = IK_CHAIN_BY_EFFECTOR[selectedJointId];
      const chainRootId = chain?.[0];
      const chainRoot = chainRootId ? rig.worldTransforms[chainRootId]?.worldPosition : undefined;
      const pivot = chainRoot ?? selectedJointWorldPosition;
      const currentTarget = selectedTarget
        ? { x: selectedTarget.x, y: selectedTarget.y }
        : { ...selectedJointWorldPosition };
      const vector = {
        x: currentTarget.x - pivot.x,
        y: currentTarget.y - pivot.y,
      };
      const vectorLength = Math.hypot(vector.x, vector.y);
      const seeded = vectorLength <= 1e-3 ? { x: 80, y: 0 } : vector;
      const rotated = rotatePoint(seeded, smoothedDeltaDeg);
      rig.ikSetTarget(selectedJointId, pivot.x + rotated.x, pivot.y + rotated.y);
    },
    [
      rig,
      selectedJointEnabled,
      selectedJointId,
      selectedJoint.localRotationDegRaw,
      selectedJointWorldPosition,
      selectedTarget,
      setFkRotationWithMirror,
    ]
  );

  const handleWheelRotationChange = useCallback(
    (nextDeg: number) => {
      if (!Number.isFinite(nextDeg) || !selectedJointEnabled || rig.state.mode !== "FK") {
        return;
      }
      setFkRotationWithMirror(selectedJointId, nextDeg);
    },
    [rig.state.mode, selectedJointEnabled, selectedJointId, setFkRotationWithMirror]
  );

  const handleWheelXChange = useCallback(
    (nextX: number) => {
      if (!Number.isFinite(nextX) || !selectedJointEnabled) {
        return;
      }
      if (rig.state.mode === "FK") {
        if (selectedJointId === "root" && !groundRootXEnabled) {
          return;
        }
        setFkTranslationWithMirror(selectedJointId, nextX, selectedJoint.localTranslation.y);
        return;
      }
      rig.ikSetTarget(selectedJointId, nextX, wheelYValue);
    },
    [
      groundRootXEnabled,
      rig,
      selectedJoint.localTranslation.y,
      selectedJointEnabled,
      selectedJointId,
      setFkTranslationWithMirror,
      wheelYValue,
    ]
  );

  const handleWheelYChange = useCallback(
    (nextY: number) => {
      if (!Number.isFinite(nextY) || !selectedJointEnabled) {
        return;
      }
      if (rig.state.mode === "FK") {
        if (selectedJointId === "root" && groundRootYEnabled) {
          applyGroundRootConstraint();
          return;
        }
        setFkTranslationWithMirror(selectedJointId, selectedJoint.localTranslation.x, nextY);
        return;
      }
      rig.ikSetTarget(selectedJointId, wheelXValue, nextY);
    },
    [
      applyGroundRootConstraint,
      groundRootYEnabled,
      rig,
      selectedJoint.localTranslation.x,
      selectedJointEnabled,
      selectedJointId,
      setFkTranslationWithMirror,
      wheelXValue,
    ]
  );

  useEffect(() => {
    if (groundRootYEnabled) {
      if (!hasAnyFootGroundPin || Math.abs(currentGroundY - groundPlaneY) > 1e-6) {
        applyGroundRootConstraint(groundPlaneY);
      }
      return;
    }
    if (hasAnyFootGroundPin) {
      applyGroundRootConstraint();
    }
  }, [
    applyGroundRootConstraint,
    currentGroundY,
    groundPlaneY,
    groundRootYEnabled,
    hasAnyFootGroundPin,
  ]);

  const buildTransferPayload = useCallback(
    (): RigTransferPayloadV2 => ({
      version: 2,
      snapshot: toRigSnapshotV2(rig.state),
      calibration: {
        skeletonScale,
        jointEnabled,
        mirrorControlsEnabled,
        primitiveTurnoverEnabled,
        constraintSettings: rig.state.constraintSettings,
      },
      fixes: fixLog,
    }),
    [
      fixLog,
      jointEnabled,
      mirrorControlsEnabled,
      primitiveTurnoverEnabled,
      rig.state,
      skeletonScale,
    ]
  );

  const handleCopyTransfer = useCallback(
    async () => {
      const payload = buildTransferPayload();
      const text = JSON.stringify(payload, null, 2);
      setTransferInput(text);
      if (!navigator.clipboard?.writeText) {
        setTransferStatus("Transfer JSON generated below.");
        return;
      }
      try {
        await navigator.clipboard.writeText(text);
        setTransferStatus("Transfer JSON copied to clipboard.");
      } catch {
        setTransferStatus("Clipboard unavailable. Copy from the text box.");
      }
    },
    [buildTransferPayload]
  );

  const handleLoadTransfer = useCallback(() => {
    if (!transferInput.trim()) {
      setTransferStatus("Paste transfer JSON first.");
      return;
    }
    try {
      const parsed = JSON.parse(transferInput);
      let snapshot: RigSnapshotV2;
      let calibration: RigTransferPayloadV2["calibration"] | undefined;
      let loadedFixes: FixLogEntry[] | undefined;

      if (isRecord(parsed) && parsed.version === 2 && parsed.snapshot) {
        snapshot = parsed.snapshot as RigSnapshotV2;
        if (isRecord(parsed.calibration)) {
          const calibrationRecord = parsed.calibration as Record<string, unknown>;
          const jointEnabledRaw = isRecord(calibrationRecord.jointEnabled)
            ? (calibrationRecord.jointEnabled as Record<string, unknown>)
            : undefined;
          const jointEnabledFromPayload = isRecord(jointEnabledRaw)
            ? (Object.fromEntries(
                JOINT_IDS.map((jointId) => [jointId, jointEnabledRaw[jointId] !== false])
              ) as Partial<Record<JointId, boolean>>)
            : (Object.fromEntries(JOINT_IDS.map((jointId) => [jointId, true])) as Partial<
                Record<JointId, boolean>
              >);
          calibration = {
            skeletonScale: asFiniteNumber(parsed.calibration.skeletonScale) ?? 1,
            jointEnabled: jointEnabledFromPayload,
            mirrorControlsEnabled: calibrationRecord.mirrorControlsEnabled !== false,
            primitiveTurnoverEnabled: calibrationRecord.primitiveTurnoverEnabled === true,
            constraintSettings: {
              ...DEFAULT_CONSTRAINT_SETTINGS,
              ...(isRecord(calibrationRecord.constraintSettings)
                ? (calibrationRecord.constraintSettings as Partial<ConstraintSettings>)
                : {}),
            },
          };
        }
        if (Array.isArray(parsed.fixes)) {
          loadedFixes = parsed.fixes
            .filter((entry): entry is Record<string, unknown> => isRecord(entry))
            .map((entry) => ({
              id: typeof entry.id === "string" ? entry.id : `${Date.now()}-${Math.random().toString(16).slice(2)}`,
              createdAt: typeof entry.createdAt === "string" ? entry.createdAt : new Date().toISOString(),
              title: typeof entry.title === "string" ? entry.title : "Fix",
              details: typeof entry.details === "string" ? entry.details : "",
              status: entry.status === "resolved" ? "resolved" : "open",
            }));
        }
      } else if (isRecord(parsed) && parsed.version === 1 && parsed.snapshot) {
        snapshot = parsed.snapshot as RigSnapshotV2;
        if (isRecord(parsed.calibration)) {
          calibration = {
            skeletonScale: asFiniteNumber(parsed.calibration.skeletonScale) ?? 1,
            jointEnabled: Object.fromEntries(JOINT_IDS.map((jointId) => [jointId, true])) as Partial<
              Record<JointId, boolean>
            >,
            mirrorControlsEnabled: false,
            primitiveTurnoverEnabled: false,
            constraintSettings: { ...DEFAULT_CONSTRAINT_SETTINGS },
          };
        }
      } else if (isRecord(parsed) && parsed.version === 2 && parsed.joints) {
        snapshot = parsed as RigSnapshotV2;
      } else {
        snapshot = migrateLegacyPayloadToRigSnapshotV2(parsed);
      }

      rig.hydrate(fromRigSnapshotV2(snapshot));

      if (calibration) {
        setSkeletonScale(calibration.skeletonScale);
        setJointEnabled(calibration.jointEnabled);
        setMirrorControlsEnabled(calibration.mirrorControlsEnabled);
        setPrimitiveTurnoverEnabled(calibration.primitiveTurnoverEnabled === true);
        if (calibration.constraintSettings) {
          rig.setConstraintSettings(calibration.constraintSettings);
        }
      }
      if (loadedFixes) {
        setFixLog(loadedFixes);
      }

      setTransferStatus("Transfer JSON loaded.");
    } catch (error) {
      setTransferStatus(error instanceof Error ? error.message : "Invalid transfer JSON");
    }
  }, [rig, transferInput]);

  return (
    <div
      style={{
        display: "grid",
        gridTemplateColumns: showSidebar ? "320px 1fr" : "1fr",
        gap: showSidebar ? "12px" : "0",
        height: "100vh",
        background: "#ffffff",
        color: "#111111",
      }}
    >
      {showSidebar && (
      <aside
        style={{
          borderRight: "1px solid #d4d4d8",
          padding: "12px",
          overflowY: "auto",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
        }}
      >
        <div style={{ fontSize: "12px", letterSpacing: "0.08em", textTransform: "uppercase", color: "#6b7280" }}>
          Rig Core V2
        </div>
        <div style={{ marginTop: "8px", display: "flex", gap: "8px" }}>
          <button
            type="button"
            style={{
              padding: "6px 10px",
              background: rig.state.mode === "FK" ? "#8b5cf6" : "#f4f4f5",
              color: rig.state.mode === "FK" ? "white" : "#111111",
              border: `1px solid ${rig.state.mode === "FK" ? "#6d28d9" : "#d4d4d8"}`,
              cursor: "pointer",
            }}
            onClick={() => rig.setMode("FK")}
          >
            FK
          </button>
          <button
            type="button"
            style={{
              padding: "6px 10px",
              background: rig.state.mode === "IK" ? "#0f766e" : "#f4f4f5",
              color: rig.state.mode === "IK" ? "white" : "#111111",
              border: `1px solid ${rig.state.mode === "IK" ? "#115e59" : "#d4d4d8"}`,
              cursor: "pointer",
            }}
            onClick={() => rig.setMode("IK")}
          >
            IK
          </button>
        </div>

        <div style={{ marginTop: "10px", display: "flex", gap: "6px" }}>
          {availableConsoleTabs.map((tab) => (
            <button
              key={tab}
              type="button"
              style={{
                flex: 1,
                padding: "6px 8px",
                textTransform: "uppercase",
                fontSize: "11px",
                fontWeight: 700,
                background: activeConsoleTab === tab ? "#7c3aed" : "#f4f4f5",
                color: activeConsoleTab === tab ? "white" : "#111111",
                border: `1px solid ${activeConsoleTab === tab ? "#5b21b6" : "#d4d4d8"}`,
                cursor: "pointer",
              }}
              onClick={() => setActiveConsoleTab(tab)}
            >
              {tab === "slm" ? "slm" : tab}
            </button>
          ))}
        </div>

        <AnimationPanel rig={rig} active={activeConsoleTab === "animation"} />

        {activeConsoleTab === "rig" && (
          <>

        {advancedRigEnabled && (
          <>
            <label style={{ display: "block", marginTop: "12px", fontSize: "12px", color: "#6b7280" }}>
              IK Solve Mode
            </label>
            <select
              style={{ width: "100%", marginTop: "4px", background: "#ffffff", color: "#111111", border: "1px solid #d4d4d8", padding: "6px" }}
              value={rig.state.ikSolveMode}
              onChange={(event) => rig.setIkSolveMode(event.target.value as any)}
            >
              <option value="single_chain">single_chain</option>
              <option value="limbs_only">limbs_only</option>
              <option value="whole_body_graph">whole_body_graph</option>
            </select>

            <label
              style={{
                display: "flex",
                alignItems: "center",
                gap: "8px",
                marginTop: "10px",
                fontSize: "12px",
                color: "#6b7280",
              }}
            >
              <input
                type="checkbox"
                checked={rig.state.ikStretchEnabled}
                onChange={(event) => rig.setIkStretchEnabled(event.target.checked)}
              />
              Allow IK Stretch (joint drag only)
            </label>

            <div style={{ marginTop: "12px", fontSize: "12px", color: "#6b7280" }}>Constraint Toggles</div>
            <div style={{ marginTop: "6px", display: "grid", gap: "6px", fontSize: "11px", color: "#4b5563" }}>
              <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="checkbox"
                  checked={rig.state.constraintSettings.enforceRootWaistLock}
                  onChange={(event) =>
                    rig.setConstraintSettings({ enforceRootWaistLock: event.target.checked })
                  }
                />
                Root/waist lock
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="checkbox"
                  checked={rig.state.constraintSettings.allowKneeLiftWhenBothAnklesPinned}
                  onChange={(event) =>
                    rig.setConstraintSettings({
                      allowKneeLiftWhenBothAnklesPinned: event.target.checked,
                    })
                  }
                />
                Knee lift with dual ankle pins
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="checkbox"
                  checked={rig.state.constraintSettings.lockGroundedAnklesX}
                  onChange={(event) =>
                    rig.setConstraintSettings({ lockGroundedAnklesX: event.target.checked })
                  }
                />
                Grounded ankle X lock
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="checkbox"
                  checked={rig.state.constraintSettings.releaseGroundedAnkleWhenLegLifts}
                  onChange={(event) =>
                    rig.setConstraintSettings({
                      releaseGroundedAnkleWhenLegLifts: event.target.checked,
                    })
                  }
                />
                Release ankle when thigh/knee lifts
              </label>
              <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <input
                  type="checkbox"
                  checked={rig.state.constraintSettings.clampGroundedIkTargetReach}
                  onChange={(event) =>
                    rig.setConstraintSettings({
                      clampGroundedIkTargetReach: event.target.checked,
                    })
                  }
                />
                Clamp IK reach while feet grounded
              </label>
            </div>
          </>
        )}

        <label style={{ display: "block", marginTop: "12px", fontSize: "12px", color: "#6b7280" }}>
          Selected Joint
        </label>
        <select
          style={{ width: "100%", marginTop: "4px", background: "#ffffff", color: "#111111", border: "1px solid #d4d4d8", padding: "6px" }}
          value={selectedJointId}
          onChange={(event) => rig.selectJoint(event.target.value as any)}
        >
          {JOINT_IDS.map((jointId) => (
            <option key={jointId} value={jointId}>
              {formatJointLabel(jointId)}
            </option>
          ))}
        </select>
        <label
          style={{
            marginTop: "8px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "12px",
            color: "#6b7280",
          }}
        >
          <input
            type="checkbox"
            checked={mirrorControlsEnabled}
            onChange={(event) => setMirrorControlsEnabled(event.target.checked)}
          />
          Mirror Controls (symmetry default)
        </label>
        {advancedRigEnabled && (
          <label
            style={{
              marginTop: "8px",
              display: "flex",
              alignItems: "center",
              gap: "8px",
              fontSize: "12px",
              color: "#6b7280",
            }}
          >
            <input
              type="checkbox"
              checked={primitiveTurnoverEnabled}
              onChange={(event) => setPrimitiveTurnoverEnabled(event.target.checked)}
            />
            Turnover
          </label>
        )}

        <div style={{ marginTop: "12px", fontSize: "12px", color: "#6b7280" }}>FK Rotation Slider (0-360)</div>
        <input
          type="range"
          min={0}
          max={361}
          step={1}
          style={{ width: "100%", accentColor: "#8b5cf6" }}
          value={normalizedRotation}
          onChange={(event) => rig.fkSetRotationSlider(selectedJointId, Number(event.target.value))}
          disabled={rig.state.mode !== "FK" || !selectedJointEnabled}
        />

        <div style={{ marginTop: "8px", fontSize: "12px", color: "#6b7280" }}>FK Rotation Raw (text input)</div>
        <input
          type="number"
          style={{ width: "100%", background: "#ffffff", color: "#111111", border: "1px solid #d4d4d8", padding: "6px" }}
          value={selectedJoint.localRotationDegRaw}
          onChange={(event) => rig.fkSetRotationText(selectedJointId, Number(event.target.value))}
          onKeyDown={(event) =>
            handleNegativeToggleKey(event, selectedJoint.localRotationDegRaw, (next) =>
              rig.fkSetRotationText(selectedJointId, next)
            )
          }
          disabled={rig.state.mode !== "FK" || !selectedJointEnabled}
        />

        {advancedRigEnabled ? (
          <>
            <div style={{ marginTop: "12px", fontSize: "12px", color: "#6b7280" }}>Root Anchor</div>
        <input
          type="text"
          readOnly
          value="ground root (x, ground-plane)"
          style={{ width: "100%", marginTop: "4px", background: "#f4f4f5", color: "#111111", border: "1px solid #d4d4d8", padding: "6px" }}
        />

        <label style={{ marginTop: "8px", display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#6b7280" }}>
          <input
            type="checkbox"
            checked={groundRootXEnabled}
            onChange={(event) => setGroundRootXEnabled(event.target.checked)}
          />
          Root X
        </label>
        <input
          type="range"
          min={-2000}
          max={2000}
          step={1}
          style={{ width: "100%", accentColor: "#7c3aed" }}
          value={rootJoint.localTranslation.x}
          onChange={(event) => handleRootTranslationChange("x", Number(event.target.value))}
          disabled={!groundRootXEnabled}
        />
        <input
          type="number"
          style={{ width: "100%", marginTop: "4px", background: "#ffffff", color: "#111111", border: "1px solid #d4d4d8", padding: "6px" }}
          value={rootJoint.localTranslation.x}
          onChange={(event) => handleRootTranslationChange("x", Number(event.target.value))}
          onKeyDown={(event) =>
            handleNegativeToggleKey(event, rootJoint.localTranslation.x, (next) =>
              handleRootTranslationChange("x", next)
            )
          }
          disabled={!groundRootXEnabled}
        />

        <label style={{ marginTop: "8px", display: "flex", alignItems: "center", gap: "6px", fontSize: "12px", color: "#6b7280" }}>
          <input
            type="checkbox"
            checked={groundRootYEnabled}
            onChange={(event) => {
              const checked = event.target.checked;
              if (checked) {
                setGroundPlaneY(currentGroundY);
              }
              setGroundRootYEnabled(checked);
            }}
          />
          {groundRootYEnabled ? "Ground Y" : "Root Y"}
        </label>
        <input
          type="range"
          min={-2000}
          max={2000}
          step={1}
          style={{ width: "100%", accentColor: "#7c3aed" }}
          value={groundRootYEnabled ? groundPlaneY : rootJoint.localTranslation.y}
          onChange={(event) =>
            handleRootTranslationChange(
              "y",
              groundRootYEnabled ? groundPlaneY : Number(event.target.value)
            )
          }
          disabled={groundRootYEnabled}
        />
        <input
          type="number"
          style={{ width: "100%", marginTop: "4px", background: "#ffffff", color: "#111111", border: "1px solid #d4d4d8", padding: "6px" }}
          value={groundRootYEnabled ? groundPlaneY : rootJoint.localTranslation.y}
          onChange={(event) =>
            handleRootTranslationChange(
              "y",
              groundRootYEnabled ? groundPlaneY : Number(event.target.value)
            )
          }
          onKeyDown={(event) =>
            handleNegativeToggleKey(event, rootJoint.localTranslation.y, (next) =>
              handleRootTranslationChange("y", next)
            )
          }
          readOnly={groundRootYEnabled}
        />

        <div style={{ marginTop: "8px", fontSize: "11px", color: "#6b7280" }}>
          {!groundRootXEnabled
            ? groundRootYEnabled
              ? "X disabled: waist becomes horizontal root while Y keeps feet pinned to the current ground plane."
              : "X and Y disabled: waist is functional root and ground layer is off."
            : groundRootYEnabled
              ? "Ground root uses split midpoint X with feet pinned to a stable ground plane."
              : "Y disabled: no ground layer; root behaves freely in Y."}
        </div>

        <div style={{ marginTop: "8px", fontSize: "12px", color: "#6b7280" }}>Translation</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "8px" }}>
          <input
            type="range"
            min={-2000}
            max={2000}
            step={1}
            style={{ width: "100%", accentColor: "#7c3aed" }}
            value={selectedJoint.localTranslation.x}
            onChange={(event) => {
              if (selectedJointId === "root" && !groundRootXEnabled) {
                return;
              }
              setFkTranslationWithMirror(
                selectedJointId,
                Number(event.target.value),
                selectedJoint.localTranslation.y
              );
            }}
            disabled={rig.state.mode !== "FK" || !selectedJointEnabled || (selectedJointId === "root" && !groundRootXEnabled)}
          />
          <input
            type="number"
            style={{ background: "#ffffff", color: "#111111", border: "1px solid #d4d4d8", padding: "6px" }}
            value={selectedJoint.localTranslation.x}
            onChange={(event) => {
              if (selectedJointId === "root" && !groundRootXEnabled) {
                return;
              }
              setFkTranslationWithMirror(
                selectedJointId,
                Number(event.target.value),
                selectedJoint.localTranslation.y
              );
            }}
            onKeyDown={(event) =>
              handleNegativeToggleKey(event, selectedJoint.localTranslation.x, (next) =>
                setFkTranslationWithMirror(selectedJointId, next, selectedJoint.localTranslation.y)
              )
            }
            disabled={rig.state.mode !== "FK" || !selectedJointEnabled || (selectedJointId === "root" && !groundRootXEnabled)}
          />
          <input
            type="range"
            min={-2000}
            max={2000}
            step={1}
            style={{ width: "100%", accentColor: "#7c3aed" }}
            value={selectedJoint.localTranslation.y}
            onChange={(event) => {
              if (selectedJointId === "root" && groundRootYEnabled) {
                applyGroundRootConstraint();
                return;
              }
              setFkTranslationWithMirror(
                selectedJointId,
                selectedJoint.localTranslation.x,
                Number(event.target.value)
              );
            }}
            disabled={rig.state.mode !== "FK" || !selectedJointEnabled || (selectedJointId === "root" && groundRootYEnabled)}
          />
          <input
            type="number"
            style={{ background: "#ffffff", color: "#111111", border: "1px solid #d4d4d8", padding: "6px" }}
            value={selectedJoint.localTranslation.y}
            onChange={(event) => {
              if (selectedJointId === "root" && groundRootYEnabled) {
                applyGroundRootConstraint();
                return;
              }
              setFkTranslationWithMirror(
                selectedJointId,
                selectedJoint.localTranslation.x,
                Number(event.target.value)
              );
            }}
            onKeyDown={(event) =>
              handleNegativeToggleKey(event, selectedJoint.localTranslation.y, (next) =>
                setFkTranslationWithMirror(selectedJointId, selectedJoint.localTranslation.x, next)
              )
            }
            disabled={rig.state.mode !== "FK" || !selectedJointEnabled || (selectedJointId === "root" && groundRootYEnabled)}
          />
        </div>

        <div style={{ marginTop: "12px", fontSize: "12px", color: "#6b7280" }}>IK Target</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "8px" }}>
          <input
            type="range"
            min={-2000}
            max={2000}
            step={1}
            style={{ width: "100%", accentColor: "#0f766e" }}
            value={selectedTarget?.x ?? 0}
            onChange={(event) => rig.ikSetTarget(selectedJointId, Number(event.target.value), selectedTarget?.y ?? 0)}
            disabled={rig.state.mode !== "IK" || !selectedJointEnabled}
          />
          <input
            type="number"
            style={{ background: "#ffffff", color: "#111111", border: "1px solid #d4d4d8", padding: "6px" }}
            value={selectedTarget?.x ?? 0}
            onChange={(event) => rig.ikSetTarget(selectedJointId, Number(event.target.value), selectedTarget?.y ?? 0)}
            onKeyDown={(event) =>
              handleNegativeToggleKey(event, selectedTarget?.x ?? 0, (next) =>
                rig.ikSetTarget(selectedJointId, next, selectedTarget?.y ?? 0)
              )
            }
            disabled={rig.state.mode !== "IK" || !selectedJointEnabled}
          />
          <input
            type="range"
            min={-2000}
            max={2000}
            step={1}
            style={{ width: "100%", accentColor: "#0f766e" }}
            value={selectedTarget?.y ?? 0}
            onChange={(event) => rig.ikSetTarget(selectedJointId, selectedTarget?.x ?? 0, Number(event.target.value))}
            disabled={rig.state.mode !== "IK" || !selectedJointEnabled}
          />
          <input
            type="number"
            style={{ background: "#ffffff", color: "#111111", border: "1px solid #d4d4d8", padding: "6px" }}
            value={selectedTarget?.y ?? 0}
            onChange={(event) => rig.ikSetTarget(selectedJointId, selectedTarget?.x ?? 0, Number(event.target.value))}
            onKeyDown={(event) =>
              handleNegativeToggleKey(event, selectedTarget?.y ?? 0, (next) =>
                rig.ikSetTarget(selectedJointId, selectedTarget?.x ?? 0, next)
              )
            }
            disabled={rig.state.mode !== "IK" || !selectedJointEnabled}
          />
        </div>
        {selectedPoleJointId && (
          <>
            <div style={{ marginTop: "10px", fontSize: "11px", color: "#6b7280" }}>
              Pole Target ({formatJointLabel(selectedPoleJointId)})
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "8px" }}>
              <input
                type="range"
                min={-2000}
                max={2000}
                step={1}
                style={{ width: "100%", accentColor: "#a16207" }}
                value={selectedPoleXValue}
                onChange={(event) => setSelectedPoleTarget(Number(event.target.value), selectedPoleYValue)}
                disabled={rig.state.mode !== "IK" || !selectedJointEnabled}
              />
              <input
                type="number"
                style={{ background: "#ffffff", color: "#111111", border: "1px solid #d4d4d8", padding: "6px" }}
                value={selectedPoleXValue}
                onChange={(event) => setSelectedPoleTarget(Number(event.target.value), selectedPoleYValue)}
                onKeyDown={(event) =>
                  handleNegativeToggleKey(event, selectedPoleXValue, (next) =>
                    setSelectedPoleTarget(next, selectedPoleYValue)
                  )
                }
                disabled={rig.state.mode !== "IK" || !selectedJointEnabled}
              />
              <input
                type="range"
                min={-2000}
                max={2000}
                step={1}
                style={{ width: "100%", accentColor: "#a16207" }}
                value={selectedPoleYValue}
                onChange={(event) => setSelectedPoleTarget(selectedPoleXValue, Number(event.target.value))}
                disabled={rig.state.mode !== "IK" || !selectedJointEnabled}
              />
              <input
                type="number"
                style={{ background: "#ffffff", color: "#111111", border: "1px solid #d4d4d8", padding: "6px" }}
                value={selectedPoleYValue}
                onChange={(event) => setSelectedPoleTarget(selectedPoleXValue, Number(event.target.value))}
                onKeyDown={(event) =>
                  handleNegativeToggleKey(event, selectedPoleYValue, (next) =>
                    setSelectedPoleTarget(selectedPoleXValue, next)
                  )
                }
                disabled={rig.state.mode !== "IK" || !selectedJointEnabled}
              />
            </div>
          </>
        )}

        <button
          type="button"
          style={{
            marginTop: "12px",
            width: "100%",
            padding: "8px 10px",
            background: "#7c3aed",
            color: "white",
            border: "1px solid #5b21b6",
            cursor: selectedJointEnabled ? "pointer" : "not-allowed",
            opacity: selectedJointEnabled ? 1 : 0.6,
          }}
          onClick={() => rig.cyclePin(selectedJointId)}
          disabled={!selectedJointEnabled}
        >
          Cycle Pin (none/world/ground)
        </button>

        <div style={{ marginTop: "16px", fontSize: "12px", color: "#6b7280" }}>Diagnostics</div>
        <div style={{ fontSize: "12px", lineHeight: 1.6 }}>
          <div>iterations: {rig.state.diagnostics.iterations}</div>
          <div>residual: {rig.state.diagnostics.residual.toFixed(3)}</div>
          <div>solveMs: {rig.state.diagnostics.solveMs.toFixed(2)}</div>
          <div>chainsSolved: {rig.state.diagnostics.chainsSolved}</div>
          <div>globalPasses: {rig.state.diagnostics.globalPasses}</div>
        </div>

        <div style={{ marginTop: "16px", fontSize: "12px", color: "#6b7280" }}>Joint Enable/Disable</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "6px" }}>
          <button
            type="button"
            style={{
              padding: "6px 8px",
              background: "#0f766e",
              color: "white",
              border: "1px solid #115e59",
              cursor: "pointer",
            }}
            onClick={() => setAllJointsEnabled(true)}
          >
            Enable All
          </button>
          <button
            type="button"
            style={{
              padding: "6px 8px",
              background: "#7f1d1d",
              color: "white",
              border: "1px solid #991b1b",
              cursor: "pointer",
            }}
            onClick={() => setAllJointsEnabled(false)}
          >
            Disable All
          </button>
        </div>
            <div
              style={{
                marginTop: "8px",
                maxHeight: "150px",
                overflowY: "auto",
                border: "1px solid #d4d4d8",
                padding: "6px",
                background: "#ffffff",
              }}
            >
              {JOINT_IDS.map((jointId) => (
                <label
                  key={`joint-enabled-${jointId}`}
                  style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#4b5563" }}
                >
                  <input
                    type="checkbox"
                    checked={jointEnabled[jointId] !== false}
                    onChange={(event) => handleToggleJointEnabled(jointId, event.target.checked)}
                  />
                  <span>{formatJointLabel(jointId)}</span>
                </label>
              ))}
            </div>
          </>
        ) : (
          <div style={{ marginTop: "12px", fontSize: "11px", color: "#6b7280", lineHeight: 1.5 }}>
            Compact mode is active. IK mode remains available; enable `Advanced` for extra constraints, root anchoring,
            diagnostics, and joint isolation controls.
          </div>
        )}

          </>
        )}

        {activeConsoleTab === "skeletals" && (
          <>
        <div style={{ marginTop: "16px", fontSize: "12px", color: "#6b7280" }}>
          Skeletal drag is live for enabled joints, and primitives select their parent joint on click.
        </div>
        <div style={{ marginTop: "8px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
          <button
            type="button"
            style={{
              padding: "6px 8px",
              background: rig.state.mode === "FK" ? "#7c3aed" : "#f4f4f5",
              color: rig.state.mode === "FK" ? "white" : "#111111",
              border: `1px solid ${rig.state.mode === "FK" ? "#5b21b6" : "#d4d4d8"}`,
              cursor: "pointer",
              fontSize: "11px",
              fontWeight: 700,
            }}
            onClick={() => rig.setMode("FK")}
          >
            FK Edit
          </button>
          <button
            type="button"
            style={{
              padding: "6px 8px",
              background: rig.state.mode === "IK" ? "#0f766e" : "#f4f4f5",
              color: rig.state.mode === "IK" ? "white" : "#111111",
              border: `1px solid ${rig.state.mode === "IK" ? "#115e59" : "#d4d4d8"}`,
              cursor: "pointer",
              fontSize: "11px",
              fontWeight: 700,
            }}
            onClick={() => rig.setMode("IK")}
          >
            IK Edit
          </button>
        </div>
        <div style={{ marginTop: "6px", fontSize: "10px", color: "#4b5563" }}>
          {rig.state.mode === "FK"
            ? "FK: pose by rotating joints. Children follow hierarchy."
            : "IK: place joint targets. Solver adapts chain pose."}
        </div>

        <label style={{ display: "block", marginTop: "12px", fontSize: "12px", color: "#6b7280" }}>
          Selected Joint
        </label>
        <select
          style={{ width: "100%", marginTop: "4px", background: "#ffffff", color: "#111111", border: "1px solid #d4d4d8", padding: "6px" }}
          value={selectedJointId}
          onChange={(event) => rig.selectJoint(event.target.value as JointId)}
        >
          {JOINT_IDS.map((jointId) => (
            <option key={`skeletals-joint-${jointId}`} value={jointId}>
              {formatJointLabel(jointId)}
            </option>
          ))}
        </select>
        <label
          style={{
            marginTop: "8px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "12px",
            color: "#6b7280",
          }}
        >
          <input
            type="checkbox"
            checked={mirrorControlsEnabled}
            onChange={(event) => setMirrorControlsEnabled(event.target.checked)}
          />
          Mirror Controls (L/R)
        </label>
        <label
          style={{
            marginTop: "8px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "12px",
            color: "#6b7280",
          }}
        >
          <input
            type="checkbox"
            checked={primitiveTurnoverEnabled}
            onChange={(event) => setPrimitiveTurnoverEnabled(event.target.checked)}
          />
          Turnover
        </label>

        <div style={{ marginTop: "12px", fontSize: "12px", color: "#6b7280" }}>Joint Rotation (FK)</div>
        <input
          type="range"
          min={0}
          max={361}
          step={1}
          style={{ width: "100%", accentColor: "#7c3aed" }}
          value={normalizedRotation}
          onChange={(event) => setFkRotationWithMirror(selectedJointId, Number(event.target.value))}
          disabled={rig.state.mode !== "FK" || !selectedJointEnabled}
        />
        <input
          type="number"
          style={{ width: "100%", marginTop: "4px", background: "#ffffff", color: "#111111", border: "1px solid #d4d4d8", padding: "6px" }}
          value={selectedJoint.localRotationDegRaw}
          onChange={(event) => setFkRotationWithMirror(selectedJointId, Number(event.target.value))}
          onKeyDown={(event) =>
            handleNegativeToggleKey(event, selectedJoint.localRotationDegRaw, (next) =>
              setFkRotationWithMirror(selectedJointId, next)
            )
          }
          disabled={rig.state.mode !== "FK" || !selectedJointEnabled}
        />
        <div style={{ marginTop: "6px", display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px" }}>
          {([-15, -5, 5, 15] as const).map((delta) => (
            <button
              key={`fk-rot-nudge-${delta}`}
              type="button"
              style={{
                padding: "6px 4px",
                background: "#f4f4f5",
                color: "#111111",
                border: "1px solid #d4d4d8",
                cursor: rig.state.mode === "FK" && selectedJointEnabled ? "pointer" : "not-allowed",
                opacity: rig.state.mode === "FK" && selectedJointEnabled ? 1 : 0.6,
                fontSize: "11px",
              }}
              disabled={rig.state.mode !== "FK" || !selectedJointEnabled}
              onClick={() =>
                setFkRotationWithMirror(
                  selectedJointId,
                  selectedJoint.localRotationDegRaw + delta
                )
              }
            >
              {delta > 0 ? `+${delta}` : delta}
            </button>
          ))}
        </div>

        <div style={{ marginTop: "12px", fontSize: "12px", color: "#6b7280" }}>Joint Position (FK advanced)</div>
        <div style={{ marginTop: "6px", fontSize: "11px", color: "#6b7280" }}>X</div>
        <input
          type="range"
          min={-2000}
          max={2000}
          step={1}
          style={{ width: "100%", accentColor: "#7c3aed" }}
          value={selectedJoint.localTranslation.x}
          onChange={(event) => {
            if (selectedJointId === "root" && !groundRootXEnabled) {
              return;
            }
            setFkTranslationWithMirror(
              selectedJointId,
              Number(event.target.value),
              selectedJoint.localTranslation.y
            );
          }}
          disabled={rig.state.mode !== "FK" || !selectedJointEnabled || (selectedJointId === "root" && !groundRootXEnabled)}
        />
        <input
          type="number"
          style={{ width: "100%", marginTop: "4px", background: "#ffffff", color: "#111111", border: "1px solid #d4d4d8", padding: "6px" }}
          value={selectedJoint.localTranslation.x}
          onChange={(event) => {
            if (selectedJointId === "root" && !groundRootXEnabled) {
              return;
            }
            setFkTranslationWithMirror(
              selectedJointId,
              Number(event.target.value),
              selectedJoint.localTranslation.y
            );
          }}
          onKeyDown={(event) =>
            handleNegativeToggleKey(event, selectedJoint.localTranslation.x, (next) =>
              setFkTranslationWithMirror(selectedJointId, next, selectedJoint.localTranslation.y)
            )
          }
          disabled={rig.state.mode !== "FK" || !selectedJointEnabled || (selectedJointId === "root" && !groundRootXEnabled)}
        />

        <div style={{ marginTop: "8px", fontSize: "11px", color: "#6b7280" }}>Y</div>
        <input
          type="range"
          min={-2000}
          max={2000}
          step={1}
          style={{ width: "100%", accentColor: "#7c3aed" }}
          value={selectedJoint.localTranslation.y}
          onChange={(event) => {
            if (selectedJointId === "root" && groundRootYEnabled) {
              applyGroundRootConstraint();
              return;
            }
            setFkTranslationWithMirror(
              selectedJointId,
              selectedJoint.localTranslation.x,
              Number(event.target.value)
            );
          }}
          disabled={rig.state.mode !== "FK" || !selectedJointEnabled || (selectedJointId === "root" && groundRootYEnabled)}
        />
        <input
          type="number"
          style={{ width: "100%", marginTop: "4px", background: "#ffffff", color: "#111111", border: "1px solid #d4d4d8", padding: "6px" }}
          value={selectedJoint.localTranslation.y}
          onChange={(event) => {
            if (selectedJointId === "root" && groundRootYEnabled) {
              applyGroundRootConstraint();
              return;
            }
            setFkTranslationWithMirror(
              selectedJointId,
              selectedJoint.localTranslation.x,
              Number(event.target.value)
            );
          }}
          onKeyDown={(event) =>
            handleNegativeToggleKey(event, selectedJoint.localTranslation.y, (next) =>
              setFkTranslationWithMirror(selectedJointId, selectedJoint.localTranslation.x, next)
            )
          }
          disabled={rig.state.mode !== "FK" || !selectedJointEnabled || (selectedJointId === "root" && groundRootYEnabled)}
        />

        <div style={{ marginTop: "12px", fontSize: "12px", color: "#6b7280" }}>IK Target</div>
        <div style={{ marginTop: "6px", fontSize: "11px", color: "#6b7280" }}>X</div>
        <input
          type="range"
          min={-2000}
          max={2000}
          step={1}
          style={{ width: "100%", accentColor: "#0f766e" }}
          value={selectedTarget?.x ?? 0}
          onChange={(event) =>
            rig.ikSetTarget(selectedJointId, Number(event.target.value), selectedTarget?.y ?? 0)
          }
          disabled={rig.state.mode !== "IK" || !selectedJointEnabled}
        />
        <input
          type="number"
          style={{ width: "100%", marginTop: "4px", background: "#ffffff", color: "#111111", border: "1px solid #d4d4d8", padding: "6px" }}
          value={selectedTarget?.x ?? 0}
          onChange={(event) =>
            rig.ikSetTarget(selectedJointId, Number(event.target.value), selectedTarget?.y ?? 0)
          }
          onKeyDown={(event) =>
            handleNegativeToggleKey(event, selectedTarget?.x ?? 0, (next) =>
              rig.ikSetTarget(selectedJointId, next, selectedTarget?.y ?? 0)
            )
          }
          disabled={rig.state.mode !== "IK" || !selectedJointEnabled}
        />
        <div style={{ marginTop: "8px", fontSize: "11px", color: "#6b7280" }}>Y</div>
        <input
          type="range"
          min={-2000}
          max={2000}
          step={1}
          style={{ width: "100%", accentColor: "#0f766e" }}
          value={selectedTarget?.y ?? 0}
          onChange={(event) =>
            rig.ikSetTarget(selectedJointId, selectedTarget?.x ?? 0, Number(event.target.value))
          }
          disabled={rig.state.mode !== "IK" || !selectedJointEnabled}
        />
        <input
          type="number"
          style={{ width: "100%", marginTop: "4px", background: "#ffffff", color: "#111111", border: "1px solid #d4d4d8", padding: "6px" }}
          value={selectedTarget?.y ?? 0}
          onChange={(event) =>
            rig.ikSetTarget(selectedJointId, selectedTarget?.x ?? 0, Number(event.target.value))
          }
          onKeyDown={(event) =>
            handleNegativeToggleKey(event, selectedTarget?.y ?? 0, (next) =>
              rig.ikSetTarget(selectedJointId, selectedTarget?.x ?? 0, next)
            )
          }
          disabled={rig.state.mode !== "IK" || !selectedJointEnabled}
        />
        {selectedPoleJointId && (
          <>
            <div style={{ marginTop: "10px", fontSize: "11px", color: "#6b7280" }}>
              Pole Target ({formatJointLabel(selectedPoleJointId)})
            </div>
            <div style={{ marginTop: "6px", fontSize: "11px", color: "#6b7280" }}>X</div>
            <input
              type="range"
              min={-2000}
              max={2000}
              step={1}
              style={{ width: "100%", accentColor: "#a16207" }}
              value={selectedPoleXValue}
              onChange={(event) => setSelectedPoleTarget(Number(event.target.value), selectedPoleYValue)}
              disabled={rig.state.mode !== "IK" || !selectedJointEnabled}
            />
            <input
              type="number"
              style={{ width: "100%", marginTop: "4px", background: "#ffffff", color: "#111111", border: "1px solid #d4d4d8", padding: "6px" }}
              value={selectedPoleXValue}
              onChange={(event) => setSelectedPoleTarget(Number(event.target.value), selectedPoleYValue)}
              onKeyDown={(event) =>
                handleNegativeToggleKey(event, selectedPoleXValue, (next) =>
                  setSelectedPoleTarget(next, selectedPoleYValue)
                )
              }
              disabled={rig.state.mode !== "IK" || !selectedJointEnabled}
            />
            <div style={{ marginTop: "8px", fontSize: "11px", color: "#6b7280" }}>Y</div>
            <input
              type="range"
              min={-2000}
              max={2000}
              step={1}
              style={{ width: "100%", accentColor: "#a16207" }}
              value={selectedPoleYValue}
              onChange={(event) => setSelectedPoleTarget(selectedPoleXValue, Number(event.target.value))}
              disabled={rig.state.mode !== "IK" || !selectedJointEnabled}
            />
            <input
              type="number"
              style={{ width: "100%", marginTop: "4px", background: "#ffffff", color: "#111111", border: "1px solid #d4d4d8", padding: "6px" }}
              value={selectedPoleYValue}
              onChange={(event) => setSelectedPoleTarget(selectedPoleXValue, Number(event.target.value))}
              onKeyDown={(event) =>
                handleNegativeToggleKey(event, selectedPoleYValue, (next) =>
                  setSelectedPoleTarget(selectedPoleXValue, next)
                )
              }
              disabled={rig.state.mode !== "IK" || !selectedJointEnabled}
            />
          </>
        )}
        <button
          type="button"
          style={{
            marginTop: "8px",
            width: "100%",
            padding: "6px 8px",
            background: "#f4f4f5",
            color: "#111111",
            border: "1px solid #d4d4d8",
            cursor: rig.state.mode === "IK" && selectedJointEnabled ? "pointer" : "not-allowed",
            opacity: rig.state.mode === "IK" && selectedJointEnabled ? 1 : 0.6,
            fontSize: "11px",
          }}
          disabled={rig.state.mode !== "IK" || !selectedJointEnabled}
          onClick={() => rig.clearIkTarget(selectedJointId)}
        >
          Clear IK Target
        </button>
        {selectedPoleJointId && (
          <button
            type="button"
            style={{
              marginTop: "6px",
              width: "100%",
              padding: "6px 8px",
              background: "#fffbeb",
              color: "#92400e",
              border: "1px solid #f59e0b",
              cursor: rig.state.mode === "IK" && selectedJointEnabled ? "pointer" : "not-allowed",
              opacity: rig.state.mode === "IK" && selectedJointEnabled ? 1 : 0.6,
              fontSize: "11px",
            }}
            disabled={rig.state.mode !== "IK" || !selectedJointEnabled}
            onClick={() => rig.clearIkPoleTarget(selectedPoleJointId)}
          >
            Clear Pole Target
          </button>
        )}

        <div style={{ marginTop: "12px", fontSize: "12px", color: "#6b7280" }}>IK Solver</div>
        <select
          style={{ width: "100%", marginTop: "4px", background: "#ffffff", color: "#111111", border: "1px solid #d4d4d8", padding: "6px" }}
          value={rig.state.ikSolveMode}
          onChange={(event) => rig.setIkSolveMode(event.target.value as any)}
        >
          <option value="single_chain">single_chain</option>
          <option value="limbs_only">limbs_only</option>
          <option value="whole_body_graph">whole_body_graph</option>
        </select>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            marginTop: "8px",
            fontSize: "12px",
            color: "#6b7280",
          }}
        >
          <input
            type="checkbox"
            checked={rig.state.ikStretchEnabled}
            onChange={(event) => rig.setIkStretchEnabled(event.target.checked)}
          />
          Allow IK Stretch
        </label>

          </>
        )}

        {activeConsoleTab === "camera" && (
          <>
        <div style={{ marginTop: "16px", fontSize: "12px", color: "#6b7280" }}>Zoom</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px", marginTop: "4px" }}>
          {(["far", "medium", "close"] as const).map((preset) => (
            <button
              key={`zoom-${preset}`}
              type="button"
              style={{
                padding: "6px 8px",
                textTransform: "uppercase",
                background: cameraZoomPreset === preset ? "#111111" : "#f4f4f5",
                color: cameraZoomPreset === preset ? "white" : "#111111",
                border: `1px solid ${cameraZoomPreset === preset ? "#111111" : "#d4d4d8"}`,
                cursor: "pointer",
                fontSize: "11px",
                fontWeight: 700,
              }}
              onClick={() => {
                setCameraZoomPreset(preset);
                if (preset === "close") {
                  setCameraZoomMultiplier(4);
                } else if (preset === "medium") {
                  setCameraZoomMultiplier(1);
                } else {
                  setCameraZoomMultiplier(0.5);
                }
              }}
            >
              {preset}
            </button>
          ))}
        </div>
        <div style={{ marginTop: "8px", fontSize: "12px", color: "#6b7280" }}>Zoom Multiplier</div>
        <input
          type="range"
          min={0.25}
          max={4}
          step={0.01}
          value={cameraZoomMultiplier}
          onChange={(event) => setCameraZoomMultiplier(Number(event.target.value))}
          style={{ width: "100%", accentColor: "#111111", marginTop: "4px" }}
        />
        <input
          type="number"
          min={0.25}
          max={4}
          step={0.01}
          value={cameraZoomMultiplier}
          onChange={(event) => setCameraZoomMultiplier(Math.min(4, Math.max(0.25, Number(event.target.value))))}
          onKeyDown={(event) =>
            handleNegativeToggleKey(event, cameraZoomMultiplier, (next) =>
              setCameraZoomMultiplier(Math.min(4, Math.max(0.25, next)))
            )
          }
          style={{ width: "100%", marginTop: "4px", background: "#ffffff", color: "#111111", border: "1px solid #d4d4d8", padding: "6px" }}
        />

        <div style={{ marginTop: "10px", fontSize: "12px", color: "#6b7280" }}>Camera Focus</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px", marginTop: "4px" }}>
          <button
            type="button"
            style={{
              padding: "6px 8px",
              background: cameraFocusMode === "static" ? "#7c3aed" : "#f4f4f5",
              color: cameraFocusMode === "static" ? "white" : "#111111",
              border: `1px solid ${cameraFocusMode === "static" ? "#5b21b6" : "#d4d4d8"}`,
              cursor: "pointer",
              fontSize: "11px",
            }}
            onClick={() => setCameraFocusMode("static")}
          >
            Static
          </button>
          <button
            type="button"
            style={{
              padding: "6px 8px",
              background: cameraFocusMode === "root_pin" ? "#7c3aed" : "#f4f4f5",
              color: cameraFocusMode === "root_pin" ? "white" : "#111111",
              border: `1px solid ${cameraFocusMode === "root_pin" ? "#5b21b6" : "#d4d4d8"}`,
              cursor: "pointer",
              fontSize: "11px",
            }}
            onClick={() => setCameraFocusMode("root_pin")}
          >
            Root Pin Focus
          </button>
          <button
            type="button"
            style={{
              padding: "6px 8px",
              background: cameraFocusMode === "selected_joint" ? "#7c3aed" : "#f4f4f5",
              color: cameraFocusMode === "selected_joint" ? "white" : "#111111",
              border: `1px solid ${cameraFocusMode === "selected_joint" ? "#5b21b6" : "#d4d4d8"}`,
              cursor: "pointer",
              fontSize: "11px",
            }}
            onClick={() => setCameraFocusMode("selected_joint")}
          >
            Part Focus
          </button>
        </div>
        <div style={{ marginTop: "10px", fontSize: "12px", color: "#6b7280" }}>Camera Offset</div>
        <div style={{ marginTop: "6px", fontSize: "10px", color: "#4b5563" }}>
          Shift the viewport left/right and up/down without re-centering.
        </div>
        <div style={{ marginTop: "6px" }}>
          <div style={{ fontSize: "10px", color: "#6b7280" }}>X Offset</div>
          <input
            type="range"
            min={-400}
            max={400}
            step={1}
            value={cameraOffset.x}
            onChange={(event) =>
              setCameraOffset((prev) => ({ ...prev, x: Number(event.target.value) }))
            }
            style={{ width: "100%", accentColor: "#111111" }}
          />
          <input
            type="number"
            value={cameraOffset.x}
            onChange={(event) =>
              setCameraOffset((prev) => ({ ...prev, x: Number(event.target.value) }))
            }
            onKeyDown={(event) =>
              handleNegativeToggleKey(event, cameraOffset.x, (next) =>
                setCameraOffset((prev) => ({ ...prev, x: next }))
              )
            }
            style={{
              width: "100%",
              marginTop: "4px",
              background: "#ffffff",
              color: "#111111",
              border: "1px solid #d4d4d8",
              padding: "6px",
            }}
          />
        </div>
        <div style={{ marginTop: "6px" }}>
          <div style={{ fontSize: "10px", color: "#6b7280" }}>Y Offset</div>
          <input
            type="range"
            min={-400}
            max={400}
            step={1}
            value={cameraOffset.y}
            onChange={(event) =>
              setCameraOffset((prev) => ({ ...prev, y: Number(event.target.value) }))
            }
            style={{ width: "100%", accentColor: "#111111" }}
          />
          <input
            type="number"
            value={cameraOffset.y}
            onChange={(event) =>
              setCameraOffset((prev) => ({ ...prev, y: Number(event.target.value) }))
            }
            onKeyDown={(event) =>
              handleNegativeToggleKey(event, cameraOffset.y, (next) =>
                setCameraOffset((prev) => ({ ...prev, y: next }))
              )
            }
            style={{
              width: "100%",
              marginTop: "4px",
              background: "#ffffff",
              color: "#111111",
              border: "1px solid #d4d4d8",
              padding: "6px",
            }}
          />
        </div>

          </>
        )}

        {activeConsoleTab === "data" && (
          <>
        <div style={{ marginTop: "16px", fontSize: "12px", color: "#6b7280" }}>Pose Data</div>
        <textarea
          value={poseDataText}
          readOnly
          style={{
            marginTop: "8px",
            width: "100%",
            minHeight: "140px",
            resize: "vertical",
            background: "#ffffff",
            color: "#111111",
            border: "1px solid #d4d4d8",
            padding: "6px",
            fontFamily: "inherit",
            fontSize: "11px",
          }}
        />
        <button
          type="button"
          style={{
            marginTop: "8px",
            width: "100%",
            padding: "8px 10px",
            background: "#111111",
            color: "white",
            border: "1px solid #111111",
            cursor: "pointer",
          }}
          onClick={async () => {
            if (!navigator.clipboard?.writeText) {
              setTransferStatus("Clipboard unavailable. Copy pose JSON manually.");
              return;
            }
            try {
              await navigator.clipboard.writeText(poseDataText);
              setTransferStatus("Pose JSON copied to clipboard.");
            } catch {
              setTransferStatus("Clipboard unavailable. Copy pose JSON manually.");
            }
          }}
        >
          Copy Pose JSON
        </button>

        <div style={{ marginTop: "16px", fontSize: "12px", color: "#6b7280" }}>Transfer Data</div>
        <button
          type="button"
          style={{
            marginTop: "8px",
            width: "100%",
            padding: "8px 10px",
            background: "#7c3aed",
            color: "white",
            border: "1px solid #5b21b6",
            cursor: "pointer",
          }}
          onClick={handleCopyTransfer}
        >
          Copy Transfer JSON
        </button>
        <textarea
          value={transferInput}
          onChange={(event) => setTransferInput(event.target.value)}
          placeholder="Paste transfer JSON here to load..."
          style={{
            marginTop: "8px",
            width: "100%",
            minHeight: "120px",
            resize: "vertical",
            background: "#ffffff",
            color: "#111111",
            border: "1px solid #d4d4d8",
            padding: "6px",
            fontFamily: "inherit",
            fontSize: "11px",
          }}
        />
        <button
          type="button"
          style={{
            marginTop: "8px",
            width: "100%",
            padding: "8px 10px",
            background: "#0f766e",
            color: "white",
            border: "1px solid #115e59",
            cursor: "pointer",
          }}
          onClick={handleLoadTransfer}
        >
          Load Transfer JSON
        </button>
        {transferStatus && (
          <div style={{ marginTop: "6px", fontSize: "11px", color: "#4b5563" }}>{transferStatus}</div>
        )}

        <div style={{ marginTop: "16px", fontSize: "12px", color: "#6b7280" }}>Trackable Fixes</div>
        <input
          type="text"
          value={fixTitle}
          onChange={(event) => setFixTitle(event.target.value)}
          placeholder="Fix title"
          style={{
            marginTop: "6px",
            width: "100%",
            background: "#ffffff",
            color: "#111111",
            border: "1px solid #d4d4d8",
            padding: "6px",
          }}
        />
        <textarea
          value={fixDetails}
          onChange={(event) => setFixDetails(event.target.value)}
          placeholder={`Notes for ${selectedJointId}...`}
          style={{
            marginTop: "8px",
            width: "100%",
            minHeight: "72px",
            resize: "vertical",
            background: "#ffffff",
            color: "#111111",
            border: "1px solid #d4d4d8",
            padding: "6px",
            fontFamily: "inherit",
            fontSize: "11px",
          }}
        />
        <button
          type="button"
          style={{
            marginTop: "8px",
            width: "100%",
            padding: "8px 10px",
            background: "#0f766e",
            color: "white",
            border: "1px solid #115e59",
            cursor: "pointer",
          }}
          onClick={handleAddFixNote}
        >
          Add Fix Note
        </button>
        <div
          style={{
            marginTop: "8px",
            maxHeight: "180px",
            overflowY: "auto",
            border: "1px solid #d4d4d8",
            background: "#ffffff",
            padding: "6px",
          }}
        >
          {fixLog.length === 0 && (
            <div style={{ fontSize: "11px", color: "#6b7280" }}>No fixes logged yet.</div>
          )}
          {fixLog.map((entry) => (
            <div
              key={entry.id}
              style={{
                border: "1px solid #d4d4d8",
                background: "#fafafa",
                padding: "6px",
                marginBottom: "6px",
              }}
            >
              <div style={{ fontSize: "11px", color: "#111111", fontWeight: 700 }}>
                [{entry.status.toUpperCase()}] {entry.title}
              </div>
              <div style={{ fontSize: "10px", color: "#6b7280", marginTop: "2px" }}>{entry.createdAt}</div>
              <div style={{ fontSize: "11px", color: "#4b5563", marginTop: "4px" }}>{entry.details}</div>
              <div style={{ display: "flex", gap: "6px", marginTop: "6px" }}>
                <button
                  type="button"
                  style={{
                    flex: 1,
                    padding: "4px 6px",
                    background: entry.status === "open" ? "#065f46" : "#e4e4e7",
                    color: entry.status === "open" ? "white" : "#111111",
                    border: "1px solid #d4d4d8",
                    cursor: "pointer",
                    fontSize: "10px",
                  }}
                  onClick={() => handleToggleFixResolved(entry.id)}
                >
                  {entry.status === "open" ? "Mark Resolved" : "Reopen"}
                </button>
                <button
                  type="button"
                  style={{
                    flex: 1,
                    padding: "4px 6px",
                    background: "#7f1d1d",
                    color: "white",
                    border: "1px solid #991b1b",
                    cursor: "pointer",
                    fontSize: "10px",
                  }}
                  onClick={() => handleDeleteFix(entry.id)}
                >
                  Delete
                </button>
              </div>
            </div>
          ))}
        </div>
          </>
        )}

        {activeConsoleTab === "slm" && (
          <>
        <div style={{ marginTop: "16px", fontSize: "12px", color: "#6b7280" }}>Skeletal-lock-Masks</div>
        <div style={{ marginTop: "8px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px" }}>
          <button
            type="button"
            style={{
              padding: "6px 8px",
              background: skeletalMaskMode === "skeletal_only" ? "#111111" : "#f4f4f5",
              color: skeletalMaskMode === "skeletal_only" ? "white" : "#111111",
              border: `1px solid ${skeletalMaskMode === "skeletal_only" ? "#111111" : "#d4d4d8"}`,
              cursor: "pointer",
              fontSize: "10px",
              fontWeight: 700,
            }}
            onClick={() => setSkeletalMaskMode("skeletal_only")}
          >
            Skeletals
          </button>
          <button
            type="button"
            style={{
              padding: "6px 8px",
              background: skeletalMaskMode === "mask_only" ? "#111111" : "#f4f4f5",
              color: skeletalMaskMode === "mask_only" ? "white" : "#111111",
              border: `1px solid ${skeletalMaskMode === "mask_only" ? "#111111" : "#d4d4d8"}`,
              cursor: "pointer",
              fontSize: "10px",
              fontWeight: 700,
            }}
            onClick={() => setSkeletalMaskMode("mask_only")}
          >
            Masks
          </button>
          <button
            type="button"
            style={{
              padding: "6px 8px",
              background: skeletalMaskMode === "locked" ? "#111111" : "#f4f4f5",
              color: skeletalMaskMode === "locked" ? "white" : "#111111",
              border: `1px solid ${skeletalMaskMode === "locked" ? "#111111" : "#d4d4d8"}`,
              cursor: "pointer",
              fontSize: "10px",
              fontWeight: 700,
            }}
            onClick={() => setSkeletalMaskMode("locked")}
          >
            Lock Both
          </button>
        </div>
        <div style={{ marginTop: "6px", fontSize: "10px", color: "#4b5563" }}>
          {skeletalMaskMode === "skeletal_only"
            ? "Skeletals only: drag updates bones/joints, mask anchors are disabled."
            : skeletalMaskMode === "mask_only"
              ? "Masks only: drag updates mask anchors, skeletal drag is disabled."
              : "Lock both: mask and skeletal drag controls are both active."}
        </div>
        <div style={{ marginTop: "10px", border: "1px solid #d4d4d8", borderRadius: "6px", padding: "8px" }}>
          <div style={{ fontSize: "11px", fontWeight: 700, color: "#374151" }}>Visibility</div>
          <div style={{ marginTop: "8px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px" }}>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#374151" }}>
              <input type="checkbox" checked={showJoints} onChange={(event) => setShowJoints(event.target.checked)} />
              Joints (all)
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#374151" }}>
              <input type="checkbox" checked={showSkeleton} onChange={(event) => setShowSkeleton(event.target.checked)} />
              Skeleton (all)
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "6px", fontSize: "11px", color: "#374151" }}>
              <input type="checkbox" checked={showMasks} onChange={(event) => setShowMasks(event.target.checked)} />
              Masks (all)
            </label>
          </div>
          <div style={{ marginTop: "8px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: "10px", color: "#6b7280" }}>Joints by piece</div>
                <div style={{ display: "flex", gap: "4px" }}>
                  <button type="button" style={{ fontSize: "10px", padding: "2px 6px", border: "1px solid #d4d4d8", background: "#fff", cursor: "pointer" }} onClick={() => setAllJointVisibility(true)}>All</button>
                  <button type="button" style={{ fontSize: "10px", padding: "2px 6px", border: "1px solid #d4d4d8", background: "#fff", cursor: "pointer" }} onClick={() => setAllJointVisibility(false)}>None</button>
                </div>
              </div>
              <div style={{ marginTop: "4px", maxHeight: "130px", overflowY: "auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px" }}>
                {JOINT_IDS.map((jointId) => (
                  <label key={`joint-vis-${jointId}`} style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "10px", color: "#4b5563" }}>
                    <input
                      type="checkbox"
                      checked={jointVisibility[jointId] !== false}
                      onChange={(event) =>
                        setJointVisibility((prev) => ({
                          ...prev,
                          [jointId]: event.target.checked,
                        }))
                      }
                    />
                    {formatJointLabel(jointId)}
                  </label>
                ))}
              </div>
            </div>
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                <div style={{ fontSize: "10px", color: "#6b7280" }}>Skeleton by piece</div>
                <div style={{ display: "flex", gap: "4px" }}>
                  <button type="button" style={{ fontSize: "10px", padding: "2px 6px", border: "1px solid #d4d4d8", background: "#fff", cursor: "pointer" }} onClick={() => setAllSkeletonVisibility(true)}>All</button>
                  <button type="button" style={{ fontSize: "10px", padding: "2px 6px", border: "1px solid #d4d4d8", background: "#fff", cursor: "pointer" }} onClick={() => setAllSkeletonVisibility(false)}>None</button>
                </div>
              </div>
              <div style={{ marginTop: "4px", maxHeight: "130px", overflowY: "auto", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px" }}>
                {JOINT_IDS.map((jointId) => (
                  <label key={`skeleton-vis-${jointId}`} style={{ display: "flex", alignItems: "center", gap: "5px", fontSize: "10px", color: "#4b5563" }}>
                    <input
                      type="checkbox"
                      checked={skeletonVisibility[jointId] !== false}
                      onChange={(event) =>
                        setSkeletonVisibility((prev) => ({
                          ...prev,
                          [jointId]: event.target.checked,
                        }))
                      }
                    />
                    {formatJointLabel(jointId)}
                  </label>
                ))}
              </div>
            </div>
          </div>
          <div style={{ marginTop: "8px", fontSize: "10px", color: "#6b7280" }}>
            Masks by piece are controlled in the mask list below with each item Hide/Show.
          </div>
        </div>
        <label style={{ display: "block", marginTop: "10px", fontSize: "12px", color: "#6b7280" }}>
          Selected Joint
        </label>
        <select
          style={{ width: "100%", marginTop: "4px", background: "#ffffff", color: "#111111", border: "1px solid #d4d4d8", padding: "6px" }}
          value={selectedJointId}
          onChange={(event) => rig.selectJoint(event.target.value as JointId)}
        >
          {JOINT_IDS.map((jointId) => (
            <option key={`slm-joint-${jointId}`} value={jointId}>
              {formatJointLabel(jointId)}
            </option>
          ))}
        </select>
        <label
          style={{
            marginTop: "8px",
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontSize: "12px",
            color: "#6b7280",
          }}
        >
          <input
            type="checkbox"
            checked={autoCloneLimbUploads}
            onChange={(event) => setAutoCloneLimbUploads(event.target.checked)}
            disabled={!maskInteractionEnabled}
          />
          Auto clone L/R uploads (arms + legs)
        </label>
        <div style={{ marginTop: "8px", display: "flex", flexDirection: "column", gap: "8px" }}>
          <button
            type="button"
            style={{
              padding: "8px 10px",
              background: maskInteractionEnabled ? "#111111" : "#d4d4d8",
              color: maskInteractionEnabled ? "white" : "#6b7280",
              border: `1px solid ${maskInteractionEnabled ? "#111111" : "#a1a1aa"}`,
              cursor: maskInteractionEnabled ? "pointer" : "not-allowed",
            }}
            disabled={!maskInteractionEnabled}
            onClick={() => overlayFileInputRef.current?.click()}
          >
            Upload Mask (SVG)
          </button>
          <input
            ref={overlayFileInputRef}
            type="file"
            accept="image/svg+xml"
            style={{ display: "none" }}
            onChange={handleOverlayFileUpload}
          />
          <div style={{ display: "flex", gap: "6px" }}>
            <input
              type="text"
              value={overlayUrlInput}
              onChange={(event) => setOverlayUrlInput(event.target.value)}
              placeholder="Mask SVG URL or data URI"
              disabled={!maskInteractionEnabled}
              style={{
                flex: 1,
                background: maskInteractionEnabled ? "#ffffff" : "#f4f4f5",
                color: maskInteractionEnabled ? "#111111" : "#6b7280",
                border: "1px solid #d4d4d8",
                padding: "6px",
              }}
            />
            <button
              type="button"
              style={{
                padding: "8px 10px",
                background: maskInteractionEnabled ? "#d4d4d4" : "#f4f4f5",
                color: maskInteractionEnabled ? "#111111" : "#6b7280",
                border: "1px solid #a1a1aa",
                cursor: maskInteractionEnabled ? "pointer" : "not-allowed",
              }}
              disabled={!maskInteractionEnabled}
              onClick={handleOverlayUrlSubmit}
            >
              Add from URL
            </button>
          </div>
          {overlayStatus && (
            <div style={{ fontSize: "11px", color: "#4b5563" }}>{overlayStatus}</div>
          )}
        </div>
        <div style={{ marginTop: "6px", fontSize: "10px", color: "#6b7280" }}>
          Hierarchy hint: root → waist → torso → collar → nose/shoulders; hips branch from waist; knees branch from hips; feet branch from knees. Collar sits at the torso crown for a compact helmet-style neck segment.
        </div>
        <div style={{ fontSize: "10px", color: "#4b5563" }}>
          Root anchor tracks the feet split midpoint when X is enabled; disabling X shifts horizontal root behavior to the waist. Y toggle controls ground layer (on = y0 feet pin, off = no ground layer).
        </div>
        <div
          style={{
            marginTop: "8px",
            border: "1px solid #d4d4d8",
            borderRadius: "6px",
            background: maskInteractionEnabled ? "#ffffff" : "#f4f4f5",
            padding: "6px",
            maxHeight: "320px",
            overflowY: "auto",
            pointerEvents: maskInteractionEnabled ? "auto" : "none",
            opacity: maskInteractionEnabled ? 1 : 0.55,
          }}
        >
          {overlaysHierarchical.length === 0 ? (
            <div style={{ fontSize: "11px", color: "#6b7280" }}>No overlays added yet.</div>
          ) : (
            overlaysHierarchical.map(({ overlay, indentLevel }) => {
              const isActive = overlay.id === activeOverlayId;
              const scaleAtLimit =
                overlay.scale <= OVERLAY_SCALE_MIN + 1e-6 || overlay.scale >= OVERLAY_SCALE_MAX - 1e-6;
              return (
                <div
                  key={overlay.id}
                  style={{
                    border: "1px solid #d4d4d8",
                    borderRadius: "4px",
                    padding: "8px",
                    marginBottom: "6px",
                    marginLeft: `${Math.min(56, indentLevel * 10)}px`,
                    background: isActive ? "#f5f3ff" : "#ffffff",
                    cursor: "pointer",
                  }}
                  onClick={() => setActiveOverlayId(overlay.id)}
                >
                  <div
                    style={{
                      display: "flex",
                      justifyContent: "space-between",
                      gap: "8px",
                      alignItems: "flex-start",
                    }}
                  >
                    <div>
                      <div style={{ fontSize: "12px", fontWeight: 700 }}>{overlay.name}</div>
                      <div style={{ fontSize: "10px", color: "#6b7280" }}>
                        Parent {overlay.parentJointId ?? "None"} | Child {overlay.childJointId ?? "None"}
                      </div>
                    </div>
                    <div style={{ display: "flex", gap: "4px" }}>
                      <button
                        type="button"
                        style={{
                          padding: "4px 6px",
                          background: overlay.visible ? "#7c3aed" : "#a1a1aa",
                          color: "white",
                          border: "none",
                          cursor: "pointer",
                          fontSize: "10px",
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          rig.updateOverlay(overlay.id, { visible: !overlay.visible });
                          setOverlayStatus(
                            `${overlay.name} ${overlay.visible ? "hidden" : "visible"}.`
                          );
                        }}
                        >
                          {overlay.visible ? "Hide" : "Show"}
                      </button>
                      <button
                        type="button"
                        style={{
                          padding: "4px 6px",
                          background: "#0f766e",
                          color: "white",
                          border: "none",
                          cursor: "pointer",
                          fontSize: "10px",
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          handleMirrorOverlayClone(overlay);
                        }}
                      >
                        Mirror
                      </button>
                      <button
                        type="button"
                        style={{
                          padding: "4px 6px",
                          background: "#7f1d1d",
                          color: "white",
                          border: "none",
                          cursor: "pointer",
                          fontSize: "10px",
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          rig.removeOverlay(overlay.id);
                          setOverlayStatus(`${overlay.name} removed.`);
                        }}
                      >
                        Delete
                      </button>
                    </div>
                  </div>
                  <div style={{ marginTop: "6px" }}>
                    <select
                      value={overlay.parentJointId ?? selectedJointId}
                      onChange={(event) => {
                        event.stopPropagation();
                        const jointId = event.target.value as JointId;
                        const defaultChild = DEFAULT_CHILD_BY_PARENT[jointId] ?? null;
                        rig.updateOverlay(overlay.id, {
                          parentJointId: jointId,
                          childJointId: overlay.childJointId ?? defaultChild,
                        });
                        setOverlayStatus(
                          `${overlay.name} parent anchored to ${jointId}.`
                        );
                      }}
                      style={{
                        width: "100%",
                        background: "#ffffff",
                        color: "#111111",
                        border: "1px solid #d4d4d8",
                        padding: "6px",
                        fontSize: "11px",
                      }}
                    >
                      {JOINT_IDS.map((jointId) => (
                        <option key={`overlay-parent-${overlay.id}-${jointId}`} value={jointId}>
                          {formatJointLabel(jointId)}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div style={{ marginTop: "6px" }}>
                    <div style={{ fontSize: "10px", color: "#6b7280", marginBottom: "2px" }}>Child anchor (optional)</div>
                    <div style={{ display: "flex", gap: "6px" }}>
                      <select
                        value={overlay.childJointId ?? ""}
                        onChange={(event) => {
                          event.stopPropagation();
                          const childValue = event.target.value;
                          rig.updateOverlay(overlay.id, {
                            childJointId: childValue ? (childValue as JointId) : null,
                          });
                          setOverlayStatus(
                            `${overlay.name} child anchor ${childValue || "cleared"}.`
                          );
                        }}
                        style={{
                          flex: 1,
                          background: "#ffffff",
                          color: "#111111",
                          border: "1px solid #d4d4d8",
                          padding: "6px",
                          fontSize: "11px",
                        }}
                      >
                        <option value="">None</option>
                        {JOINT_IDS.map((jointId) => (
                          <option key={`overlay-child-${overlay.id}-${jointId}`} value={jointId}>
                            {formatJointLabel(jointId)}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        style={{
                          padding: "6px",
                          background: "#0f766e",
                          color: "white",
                          border: "1px solid #115e59",
                          cursor: "pointer",
                          fontSize: "11px",
                        }}
                        onClick={(event) => {
                          event.stopPropagation();
                          if (selectedJointId) {
                            const defaultChild = DEFAULT_CHILD_BY_PARENT[selectedJointId] ?? null;
                            rig.updateOverlay(overlay.id, {
                              parentJointId: selectedJointId,
                              childJointId: overlay.childJointId ?? defaultChild,
                            });
                            setOverlayStatus(
                              `${overlay.name} parent anchor set to ${selectedJointId}.`
                            );
                          }
                        }}
                      >
                        Parent = selected
                      </button>
                    </div>
                  </div>
                  <div style={{ marginTop: "6px" }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        fontSize: "10px",
                        color: "#6b7280",
                      }}
                    >
                      <span>Scale {overlay.scale.toFixed(2)}</span>
                      <span
                        style={{
                          fontSize: "8px",
                          padding: "2px 6px",
                          borderRadius: "999px",
                          border: "1px solid #d4d4d8",
                          background: scaleAtLimit ? "#111111" : "#f3f4f6",
                          color: scaleAtLimit ? "white" : "#6b7280",
                        }}
                      >
                        Vitruvian lock
                      </span>
                    </div>
                    <input
                      type="range"
                      min={OVERLAY_SCALE_MIN}
                      max={OVERLAY_SCALE_MAX}
                      step={0.01}
                      value={overlay.scale}
                      onChange={(event) => {
                        event.stopPropagation();
                        rig.updateOverlay(overlay.id, { scale: Number(event.target.value) });
                      }}
                      style={{ width: "100%", accentColor: "#6b7280" }}
                    />
                  </div>
                  <div style={{ marginTop: "6px" }}>
                    <div style={{ fontSize: "10px", color: "#6b7280" }}>Rotation (deg)</div>
                    <input
                      type="number"
                      value={overlay.rotation}
                      onChange={(event) => {
                        event.stopPropagation();
                        rig.updateOverlay(overlay.id, { rotation: Number(event.target.value) });
                      }}
                      onKeyDown={(event) =>
                        handleNegativeToggleKey(event, overlay.rotation, (next) => {
                          event.stopPropagation();
                          rig.updateOverlay(overlay.id, { rotation: next });
                        })
                      }
                      style={{
                        width: "100%",
                        background: "#ffffff",
                        color: "#111111",
                        border: "1px solid #d4d4d8",
                        padding: "6px",
                      }}
                    />
                  </div>
                  <div style={{ marginTop: "6px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                    <button
                      type="button"
                      style={{
                        padding: "6px",
                        background: overlay.flipX ? "#0f766e" : "#f4f4f5",
                        color: overlay.flipX ? "white" : "#111111",
                        border: `1px solid ${overlay.flipX ? "#115e59" : "#d4d4d8"}`,
                        cursor: "pointer",
                        fontSize: "11px",
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        const nextFlipX = !overlay.flipX;
                        rig.updateOverlay(overlay.id, { flipX: nextFlipX });
                        setOverlayStatus(`${overlay.name} horizontal flip ${nextFlipX ? "enabled" : "disabled"}.`);
                      }}
                    >
                      Flip H
                    </button>
                    <button
                      type="button"
                      style={{
                        padding: "6px",
                        background: overlay.flipY ? "#0f766e" : "#f4f4f5",
                        color: overlay.flipY ? "white" : "#111111",
                        border: `1px solid ${overlay.flipY ? "#115e59" : "#d4d4d8"}`,
                        cursor: "pointer",
                        fontSize: "11px",
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        const nextFlipY = !overlay.flipY;
                        rig.updateOverlay(overlay.id, { flipY: nextFlipY });
                        setOverlayStatus(`${overlay.name} vertical flip ${nextFlipY ? "enabled" : "disabled"}.`);
                      }}
                    >
                      Flip V
                    </button>
                  </div>
                  <div style={{ marginTop: "6px" }}>
                    <div style={{ fontSize: "10px", color: "#6b7280" }}>Offset X</div>
                    <input
                      type="range"
                      min={-2000}
                      max={2000}
                      step={1}
                      value={overlay.offset.x}
                      onChange={(event) => {
                        event.stopPropagation();
                        rig.updateOverlay(overlay.id, {
                          offset: { x: Number(event.target.value), y: overlay.offset.y },
                        });
                      }}
                      style={{ width: "100%", accentColor: "#6b7280", marginTop: "4px" }}
                    />
                    <input
                      type="number"
                      value={overlay.offset.x}
                      onChange={(event) => {
                        event.stopPropagation();
                        rig.updateOverlay(overlay.id, {
                          offset: { x: Number(event.target.value), y: overlay.offset.y },
                        });
                      }}
                      onKeyDown={(event) =>
                        handleNegativeToggleKey(event, overlay.offset.x, (next) => {
                          event.stopPropagation();
                          rig.updateOverlay(overlay.id, {
                            offset: { x: next, y: overlay.offset.y },
                          });
                        })
                      }
                      style={{
                        width: "100%",
                        background: "#ffffff",
                        color: "#111111",
                        border: "1px solid #d4d4d8",
                        padding: "6px",
                      }}
                    />
                  </div>
                  <div style={{ marginTop: "6px" }}>
                    <div style={{ fontSize: "10px", color: "#6b7280" }}>Offset Y</div>
                    <input
                      type="range"
                      min={-2000}
                      max={2000}
                      step={1}
                      value={overlay.offset.y}
                      onChange={(event) => {
                        event.stopPropagation();
                        rig.updateOverlay(overlay.id, {
                          offset: { x: overlay.offset.x, y: Number(event.target.value) },
                        });
                      }}
                      style={{ width: "100%", accentColor: "#6b7280", marginTop: "4px" }}
                    />
                    <input
                      type="number"
                      value={overlay.offset.y}
                      onChange={(event) => {
                        event.stopPropagation();
                        rig.updateOverlay(overlay.id, {
                          offset: { x: overlay.offset.x, y: Number(event.target.value) },
                        });
                      }}
                      onKeyDown={(event) =>
                        handleNegativeToggleKey(event, overlay.offset.y, (next) => {
                          event.stopPropagation();
                          rig.updateOverlay(overlay.id, {
                            offset: { x: overlay.offset.x, y: next },
                          });
                        })
                      }
                      style={{
                        width: "100%",
                        background: "#ffffff",
                        color: "#111111",
                        border: "1px solid #d4d4d8",
                        padding: "6px",
                      }}
                    />
                  </div>
                  <div style={{ marginTop: "6px" }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        fontSize: "10px",
                        color: "#6b7280",
                      }}
                    >
                      <span>Child anchorOffset</span>
                    </div>
                    <div style={{ display: "grid", gridTemplateColumns: "1fr", gap: "6px", marginTop: "4px" }}>
                      <input
                        type="range"
                        min={-2000}
                        max={2000}
                        step={1}
                        value={overlay.childOffset.x}
                        onChange={(event) => {
                          event.stopPropagation();
                          rig.updateOverlay(overlay.id, {
                            childOffset: { x: Number(event.target.value), y: overlay.childOffset.y },
                          });
                        }}
                        style={{ width: "100%", accentColor: "#6b7280" }}
                      />
                      <input
                        type="number"
                        value={overlay.childOffset.x}
                        onChange={(event) => {
                          event.stopPropagation();
                          rig.updateOverlay(overlay.id, {
                            childOffset: { x: Number(event.target.value), y: overlay.childOffset.y },
                          });
                        }}
                        onKeyDown={(event) =>
                          handleNegativeToggleKey(event, overlay.childOffset.x, (next) => {
                            event.stopPropagation();
                            rig.updateOverlay(overlay.id, {
                              childOffset: { x: next, y: overlay.childOffset.y },
                            });
                          })
                        }
                        placeholder="X"
                        style={{
                          background: "#ffffff",
                          color: "#111111",
                          border: "1px solid #d4d4d8",
                          padding: "6px",
                        }}
                      />
                      <input
                        type="range"
                        min={-2000}
                        max={2000}
                        step={1}
                        value={overlay.childOffset.y}
                        onChange={(event) => {
                          event.stopPropagation();
                          rig.updateOverlay(overlay.id, {
                            childOffset: { x: overlay.childOffset.x, y: Number(event.target.value) },
                          });
                        }}
                        style={{ width: "100%", accentColor: "#6b7280" }}
                      />
                      <input
                        type="number"
                        value={overlay.childOffset.y}
                        onChange={(event) => {
                          event.stopPropagation();
                          rig.updateOverlay(overlay.id, {
                            childOffset: { x: overlay.childOffset.x, y: Number(event.target.value) },
                          });
                        }}
                        onKeyDown={(event) =>
                          handleNegativeToggleKey(event, overlay.childOffset.y, (next) => {
                            event.stopPropagation();
                            rig.updateOverlay(overlay.id, {
                              childOffset: { x: overlay.childOffset.x, y: next },
                            });
                          })
                        }
                        placeholder="Y"
                        style={{
                          background: "#ffffff",
                          color: "#111111",
                          border: "1px solid #d4d4d8",
                          padding: "6px",
                        }}
                      />
                    </div>
                  </div>
                  <div style={{ marginTop: "6px" }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        fontSize: "10px",
                        color: "#6b7280",
                      }}
                    >
                      <span>Opacity {overlay.alpha.toFixed(2)}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.01}
                      value={overlay.alpha}
                      onChange={(event) => {
                        event.stopPropagation();
                        rig.updateOverlay(overlay.id, { alpha: Number(event.target.value) });
                      }}
                      style={{ width: "100%", accentColor: "#6b7280" }}
                    />
                  </div>
                  <div style={{ marginTop: "6px" }}>
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        fontSize: "10px",
                        color: "#6b7280",
                      }}
                    >
                      <span>Feather {overlay.feather.toFixed(1)}</span>
                    </div>
                    <input
                      type="range"
                      min={0}
                      max={OVERLAY_FEATHER_MAX}
                      step={0.1}
                      value={overlay.feather}
                      onChange={(event) => {
                        event.stopPropagation();
                        rig.updateOverlay(overlay.id, { feather: Number(event.target.value) });
                      }}
                      style={{ width: "100%", accentColor: "#6b7280" }}
                    />
                  </div>
                  <div style={{ marginTop: "6px", display: "flex", gap: "6px" }}>
                    <button
                      type="button"
                      style={{
                        flex: 1,
                        padding: "6px",
                        background: "#0f766e",
                        color: "white",
                        border: "none",
                        cursor: "pointer",
                        fontSize: "11px",
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        const jointId = overlay.parentJointId;
                        if (!jointId) {
                          setOverlayStatus(`${overlay.name} has no parent joint to place on.`);
                          return;
                        }
                        rig.placeOverlayOnJoint(overlay.id, jointId);
                        appendFixEntry(
                          "Overlay snapped",
                          `${overlay.name} aligned with ${jointId}.`,
                          "resolved"
                        );
                        setOverlayStatus(`${overlay.name} placed on ${jointId}.`);
                      }}
                    >
                      Place overlay on joint
                    </button>
                    <button
                      type="button"
                      style={{
                        flex: 1,
                        padding: "6px",
                        background: "#111111",
                        color: "white",
                        border: "none",
                        cursor: "pointer",
                        fontSize: "11px",
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        rig.resetOverlayTransform(overlay.id);
                        appendFixEntry(
                          "Overlay reset",
                          `${overlay.name} transforms reset for ${overlay.parentJointId ?? "None"}.`,
                          "resolved"
                        );
                        setOverlayStatus(`${overlay.name} transforms reset.`);
                      }}
                    >
                      Reset overlay transforms
                    </button>
                  </div>
                </div>
              );
            })
          )}
        </div>
        <div style={{ marginTop: "10px", fontSize: "12px", color: "#6b7280" }}>
          Primitive Scale
        </div>
        <input
          type="range"
          min={0.05}
          max={4}
          step={0.01}
          value={skeletonScale}
          onChange={(event) => setSkeletonScale(Math.max(0.05, Number(event.target.value)))}
          style={{ width: "100%", marginTop: "4px", accentColor: "#0f766e" }}
        />
        <input
          type="number"
          min={0.05}
          step={0.05}
          style={{ width: "100%", marginTop: "4px", background: "#ffffff", color: "#111111", border: "1px solid #d4d4d8", padding: "6px" }}
          value={skeletonScale}
          onChange={(event) => setSkeletonScale(Math.max(0.05, Number(event.target.value)))}
          onKeyDown={(event) =>
            handleNegativeToggleKey(event, skeletonScale, (next) =>
              setSkeletonScale(Math.max(0.05, next))
            )
          }
        />
          </>
        )}
      </aside>
      )}

      <main style={{ minWidth: 0, height: "100%", overflow: "hidden", position: "relative" }}>
        <div
          style={{
            position: "absolute",
            top: "12px",
            left: "12px",
            zIndex: 60,
            display: "flex",
            gap: "6px",
            alignItems: "center",
          }}
        >
          <select
            value={canvasUxPreset}
            onChange={(event) => setCanvasUxPreset(event.target.value as CanvasUxPreset)}
            style={{
              background: "rgba(17, 24, 39, 0.78)",
              color: "#f9fafb",
              border: "1px solid rgba(255,255,255,0.25)",
              borderRadius: "8px",
              padding: "6px 8px",
              fontSize: "11px",
              backdropFilter: "blur(6px)",
            }}
          >
            <option value="focus">Canvas Focus</option>
            <option value="balanced">Balanced</option>
            <option value="full">Full Controls</option>
          </select>
          <button
            type="button"
            onClick={() => setCanvasUxPreset((prev) => (prev === "focus" ? "balanced" : "focus"))}
            style={{
              padding: "6px 8px",
              borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.25)",
              background: "rgba(17, 24, 39, 0.78)",
              color: "#f9fafb",
              fontSize: "11px",
              cursor: "pointer",
              backdropFilter: "blur(6px)",
            }}
          >
            {canvasUxPreset === "focus" ? "Show Controls" : "Focus Canvas"}
          </button>
          <button
            type="button"
            onClick={cycleWheelDensity}
            style={{
              padding: "6px 8px",
              borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.25)",
              background: "rgba(17, 24, 39, 0.78)",
              color: "#f9fafb",
              fontSize: "11px",
              cursor: "pointer",
              backdropFilter: "blur(6px)",
            }}
          >
            Wheel: {activeWheelDensity}
          </button>
	          <button
            type="button"
            onClick={() => setPrimitiveTurnoverEnabled((prev) => !prev)}
            style={{
              padding: "6px 8px",
              borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.25)",
              background: primitiveTurnoverEnabled ? "rgba(15, 118, 110, 0.78)" : "rgba(17, 24, 39, 0.78)",
              color: "#f9fafb",
              fontSize: "11px",
              cursor: "pointer",
              backdropFilter: "blur(6px)",
            }}
          >
            Turnover: {primitiveTurnoverEnabled ? "On" : "Off"}
          </button>
          <button
            type="button"
            onClick={() => setAdvancedRigEnabled((prev) => !prev)}
            style={{
              padding: "6px 8px",
              borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.25)",
              background: advancedRigEnabled ? "rgba(20, 184, 166, 0.82)" : "rgba(55, 65, 81, 0.82)",
              color: "#f9fafb",
              fontSize: "11px",
              cursor: "pointer",
              backdropFilter: "blur(6px)",
            }}
          >
            Advanced: {advancedRigEnabled ? "On" : "Off"}
          </button>
        </div>

        <div style={{ position: "absolute", right: "16px", bottom: "16px", zIndex: 60 }}>
	          <CanvasCommandWheel
            mode={rig.state.mode}
            selectedJointLabel={formatJointLabel(selectedJointId)}
            rotationDeg={selectedJoint.localRotationDegRaw}
            x={wheelXValue}
            y={wheelYValue}
            mirrorEnabled={mirrorControlsEnabled}
            density={activeWheelDensity}
            disabled={!selectedJointEnabled}
            modeToggleEnabled={true}
            onRotateDelta={handleWheelRotate}
            onRotationChange={handleWheelRotationChange}
            onXChange={handleWheelXChange}
            onYChange={handleWheelYChange}
            onToggleMode={() => rig.setMode(rig.state.mode === "FK" ? "IK" : "FK")}
            onToggleMirror={() => setMirrorControlsEnabled((prev) => !prev)}
            onCyclePin={() => {
              if (!selectedJointEnabled) {
                return;
              }
              rig.cyclePin(selectedJointId);
            }}
            onClearIkTarget={() => rig.clearIkTarget(selectedJointId)}
            onCycleDensity={cycleWheelDensity}
          />
        </div>

        <SkeletonViewport
          state={rig.state}
          primitiveTurnoverEnabled={primitiveTurnoverEnabled}
          cleanFkMode={!advancedRigEnabled}
          displayTransform={{
            offsetX: cameraOffset.x,
            offsetY: cameraOffset.y,
            scale: skeletonScale,
          }}
          rootAnchorUseGroundX={groundRootXEnabled}
          rootAnchorUseGroundY={groundRootYEnabled}
          cameraZoomPreset={cameraZoomPreset}
          cameraZoomMultiplier={cameraZoomMultiplier}
          cameraFocusMode={cameraFocusMode}
          onPinchZoom={handlePinchZoom}
          jointEnabledMap={jointEnabled}
          jointsVisible={showJoints}
          skeletonVisible={showSkeleton}
          masksVisible={showMasks}
          jointVisibilityMap={jointVisibility}
          skeletonVisibilityMap={skeletonVisibility}
          className="rig-core-v2-viewport"
          overlayInteractionEnabled={overlayEditingEnabled}
          onJointClick={(jointId) => {
            if (!skeletalInteractionEnabled) {
              return;
            }
            rig.selectJoint(getClickActivationJointId(jointId));
          }}
		          onJointPointerDown={(jointId, x, y) => {
            if (!skeletalInteractionEnabled) {
              return;
            }
            if (jointEnabled[jointId] === false) {
              return;
            }
            if (rig.state.mode === "FK" && jointId !== "root") {
              const pivot = rig.worldTransforms[jointId]?.worldPosition ?? { x, y };
              const mirroredJointId =
                mirrorControlsEnabled ? getMirroredJointId(jointId) : null;
		              fkDragRotationRef.current = {
                jointId,
                pivot,
                lastPointerAngleDeg: angleDegFrom(pivot, { x, y }),
                currentJointRotationDeg: rig.state.joints[jointId].localRotationDegRaw,
                mirroredJointId,
                currentMirroredRotationDeg: mirroredJointId
                  ? rig.state.joints[mirroredJointId].localRotationDegRaw
                  : 0,
		              };
              fkDragDeltaFilterRef.current = {
                jointId,
                value: 0,
                lastMs: 0,
              };
            } else {
		              fkDragRotationRef.current = null;
		            }
            rig.dragStart(jointId, x, y, "joint");
            if (rig.state.mode !== "IK") {
              rig.selectJoint(getClickActivationJointId(jointId));
            }
          }}
          onTargetPointerDown={(jointId, x, y) => {
            if (!skeletalInteractionEnabled) {
              return;
            }
            if (jointEnabled[jointId] === false) {
              return;
            }
            rig.dragStart(jointId, x, y, "target");
          }}
          onPoleTargetPointerDown={(jointId, x, y) => {
            if (!skeletalInteractionEnabled) {
              return;
            }
            if (jointEnabled[jointId] === false) {
              return;
            }
            rig.ikSetPoleTarget(jointId, x, y);
          }}
          onJointDrag={skeletalInteractionEnabled ? handleJointDrag : undefined}
          onTargetDrag={skeletalInteractionEnabled ? handleTargetDrag : undefined}
          onPoleTargetDrag={skeletalInteractionEnabled ? handlePoleTargetDrag : undefined}
	          onDragEnd={() => {
	            fkDragRotationRef.current = null;
            fkDragDeltaFilterRef.current = { jointId: null, value: 0, lastMs: 0 };
	            rig.dragEnd();
	          }}
          onOverlayAnchorDragMove={overlayEditingEnabled ? handleOverlayAnchorDragMove : undefined}
          onOverlayAnchorDragEnd={overlayEditingEnabled ? handleOverlayAnchorDragEnd : undefined}
        />
      </main>
    </div>
  );
};
