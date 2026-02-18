import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CanvasCommandWheel } from "../components/CanvasCommandWheel";
import { SkeletonViewport } from "../components/SkeletonViewport";
import { normalizeAngleDeg, normalizeSignedAngleDeg, inverseRotateVec2, subVec2 } from "../rig-core/graph";
import { AnimationPanel } from "./AnimationPanel";
import {
  DEFAULT_JUMP_FALL_STATE,
  stepJumpFall,
  type JumpFallPhase,
  type JumpFallState,
} from "../rig-core/dynamics";
import {
  DEFAULT_CONSTRAINT_SETTINGS,
  JOINT_IDS,
  type ConstraintSettings,
  type JointId,
  type SvgOverlay,
  type Vec2,
} from "../rig-core/types";
import {
  cloneRigState,
  fromRigSnapshotV2,
  migrateLegacyPayloadToRigSnapshotV2,
  toRigSnapshotV2,
  type RigSnapshotV2,
} from "../rig-core/serialize";
import {
  ACTIVATION_PARENT_BY_CHILD,
  DEFAULT_CHILD_BY_PARENT,
  IK_CHAIN_BY_EFFECTOR,
  IK_POLE_JOINT_BY_EFFECTOR,
  createJointBooleanMap,
  getMirroredJointId,
} from "../rig-core/topology";
import { clampIkTargetForGroundedReach } from "../rig-core/constraints/groundPins";
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
type ConsoleTab = "rig" | "animation" | "model" | "camera" | "data" | "slm";
type ModuleId = ConsoleTab;
type SideConsoleTab = "exports" | "data" | "performance";
type ModuleWindowState = {
  x: number;
  y: number;
  width: number;
  height: number;
  minimized: boolean;
};
type SkeletalMaskMode = "skeletal_only" | "mask_only" | "locked";
type MaskConsoleSection = "maskControls" | "maskList" | "maskDetails" | "maskFilters";
type CanvasUxPreset = "focus" | "balanced" | "full";
type WheelPrimaryTool = "rotate" | "translate" | "zoom";
type CanvasWorkflowMode = "pose" | "compose" | "rotate" | "ik" | "play" | "animation";
type IkCanvasScopeMode = "limb" | "upper" | "lower" | "full";
type IkCanvasLimbScope = "l_arm" | "r_arm" | "l_leg" | "r_leg";
type RigAuditWindow = Window &
  typeof globalThis & {
    render_game_to_text?: () => string;
    advanceTime?: (ms: number) => Promise<void>;
  };
const GROUND_ROOT_Y = 0;
const DEFAULT_CONSOLE_TAB: ConsoleTab = "animation";
const DEFAULT_SIDE_CONSOLE_TAB: SideConsoleTab = "exports";
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
const DEFAULT_CANVAS_UX_PRESET: CanvasUxPreset = "balanced";
const DEFAULT_WHEEL_LAYERS = 2 as const;
const DEFAULT_WHEEL_AXIS_LOCK = "xy" as const;
const DEFAULT_WHEEL_PRECISION = "coarse" as const;
const DEFAULT_WHEEL_PRIMARY_TOOL: WheelPrimaryTool = "rotate";
const DEFAULT_CANVAS_MENU_OPEN: Record<CanvasWorkflowMode, boolean> = {
  pose: true,
  compose: false,
  rotate: false,
  ik: true,
  play: false,
  animation: false,
};
const CANVAS_WORKFLOW_ORDER: CanvasWorkflowMode[] = [
  "pose",
  "compose",
  "rotate",
  "ik",
  "play",
  "animation",
];
const SIDE_CONSOLE_TAB_LABELS: Record<SideConsoleTab, string> = {
  exports: "Exports",
  data: "Data",
  performance: "Performance",
};
const CANVAS_WORKFLOW_LABELS: Record<CanvasWorkflowMode, string> = {
  pose: "Pose",
  compose: "Compose",
  rotate: "Rotate",
  ik: "IK",
  play: "Play",
  animation: "Animation",
};
const CANVAS_WORKFLOW_DESCRIPTIONS: Record<CanvasWorkflowMode, string> = {
  pose: "FK pose + XY control",
  compose: "Mask + skeleton together",
  rotate: "FK rotation-focused",
  ik: "IK targeting mode",
  play: "Live runtime preview",
  animation: "Timeline + interpolation",
};
const CANVAS_WORKFLOW_ACCENTS: Record<CanvasWorkflowMode, string> = {
  pose: "#2563eb",
  compose: "#c2410c",
  rotate: "#7c3aed",
  ik: "#0f766e",
  play: "#0891b2",
  animation: "#d97706",
};
const IK_CANVAS_SCOPE_LABELS: Record<IkCanvasScopeMode, string> = {
  limb: "Limb",
  upper: "Upper",
  lower: "Lower",
  full: "Full",
};
const IK_CANVAS_LIMB_LABELS: Record<IkCanvasLimbScope, string> = {
  l_arm: "L Arm",
  r_arm: "R Arm",
  l_leg: "L Leg",
  r_leg: "R Leg",
};
const IK_CANVAS_LIMB_SCOPE_JOINTS: Record<IkCanvasLimbScope, JointId[]> = {
  l_arm: ["root", "waist", "xiphoid", "collar", "l_shoulder", "l_elbow", "l_hand"],
  r_arm: ["root", "waist", "xiphoid", "collar", "r_shoulder", "r_elbow", "r_hand"],
  l_leg: ["root", "waist", "l_hip", "l_knee", "l_foot"],
  r_leg: ["root", "waist", "r_hip", "r_knee", "r_foot"],
};
const IK_CANVAS_SCOPE_JOINTS: Record<Exclude<IkCanvasScopeMode, "limb">, JointId[]> = {
  upper: [
    "root",
    "waist",
    "xiphoid",
    "torso",
    "collar",
    "neck",
    "l_shoulder",
    "l_elbow",
    "l_hand",
    "r_shoulder",
    "r_elbow",
    "r_hand",
  ],
  lower: ["root", "waist", "l_hip", "l_knee", "l_foot", "r_hip", "r_knee", "r_foot"],
  full: [...JOINT_IDS],
};
const IK_CANVAS_LIMB_SCOPE_EFFECTOR: Record<IkCanvasLimbScope, JointId> = {
  l_arm: "l_hand",
  r_arm: "r_hand",
  l_leg: "l_foot",
  r_leg: "r_foot",
};
const IK_CANVAS_SCOPE_EFFECTORS: Record<Exclude<IkCanvasScopeMode, "limb">, JointId[]> = {
  upper: ["l_hand", "r_hand", "neck"],
  lower: ["l_foot", "r_foot"],
  full: ["l_hand", "r_hand", "l_foot", "r_foot", "neck"],
};
const WORKFLOW_SHORTCUT_MODE_BY_CODE: Record<string, CanvasWorkflowMode> = {
  Digit1: "pose",
  Digit2: "compose",
  Digit3: "rotate",
  Digit4: "ik",
  Digit5: "play",
  Digit6: "animation",
  Numpad1: "pose",
  Numpad2: "compose",
  Numpad3: "rotate",
  Numpad4: "ik",
  Numpad5: "play",
  Numpad6: "animation",
};
const MODULE_LAYOUT_STORAGE_KEY = "rigcore.moduleLayout.v1";
const MODULE_DEFAULTS: Record<ModuleId, { width: number; height: number }> = {
  rig: { width: 320, height: 620 },
  animation: { width: 320, height: 360 },
  model: { width: 340, height: 660 },
  camera: { width: 320, height: 540 },
  data: { width: 340, height: 620 },
  slm: { width: 340, height: 680 },
};
const JUMP_TOGGLE_KEY = "KeyJ";
const JUMP_TRIGGER_KEY = "Space";
const JUMP_FOOT_CONTACT_EPSILON = 4;
const JUMP_AUTO_PIN_JOINT_IDS: JointId[] = ["l_foot", "r_foot"];
const LANDING_ROOT_DAMPING = 0.42;
const LANDING_PELVIS_DAMPING = 0.26;
const FK_ROTATION_DRAG_SENSITIVITY = 0.45;
const WHEEL_ROTATION_SENSITIVITY = 0.6;
const ROTATION_DELTA_DEADBAND_DEG = 0.08;
const ROTATION_INTERPOLATION_ALPHA = 0.36;
const ROTATION_INTERPOLATION_RESET_MS = 120;
const ROTATION_GLITCH_MAX_SPEED_DEG_PER_SEC = 520;
const ROTATION_GLITCH_MIN_STEP_DEG = 3.2;
const FK_ROTATION_MIN_RADIUS = 12;
const SVG_ARTIFACT_MAIN_OVERLAP_MARGIN_RATIO = 0.18;
const SVG_ARTIFACT_MAX_MAIN_AREA_RATIO = 0.08;
const SVG_ARTIFACT_MAX_VIEWBOX_AREA_RATIO = 0.01;
const SVG_ARTIFACT_MIN_CENTER_DISTANCE_RATIO = 0.55;
const getClickActivationJointId = (jointId: JointId): JointId =>
  ACTIVATION_PARENT_BY_CHILD[jointId] ?? jointId;
const clampNumber = (value: number, min: number, max: number): number =>
  Math.min(max, Math.max(min, value));

const clampRotationDeltaForElapsed = (deltaDeg: number, elapsedMs: number): number => {
  const safeElapsedMs = Math.max(1, elapsedMs);
  const maxDelta =
    ROTATION_GLITCH_MIN_STEP_DEG +
    (ROTATION_GLITCH_MAX_SPEED_DEG_PER_SEC * safeElapsedMs) / 1000;
  return clampNumber(deltaDeg, -maxDelta, maxDelta);
};

const formatJointLabel = (jointId: JointId): string => {
  if (jointId === "root") return "waist";
  if (jointId === "waist") return "navel";
  if (jointId === "neck") return "nose";
  return jointId;
};

const asFiniteNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;
const roundAuditValue = (value: number): number => Math.round(value * 100) / 100;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const HOVER_HELP_DEFAULT_TEXT =
  "Hover any control for usage tips. Model hover is intentionally excluded so hints stay focused on tools.";
const HOVER_HELP_INTERACTIVE_SELECTOR =
  "button,input,select,textarea,[role='button'],[role='switch'],[data-hover-help]";
const HOVER_HELP_SKIP_SELECTOR = "[data-hover-help-skip='true']";
const HOVER_HELP_RULES: Array<{ pattern: RegExp; tip: string }> = [
  {
    pattern: /\bfk\b|rotation|rotate/,
    tip: "FK mode rotates joints directly through the hierarchy. Start broad at parent joints, then refine children for cleaner arcs.",
  },
  {
    pattern: /\bik\b|target|pole/,
    tip: "IK mode moves targets while the solver distributes motion. Double-click a target to keep sticky tracking, then press Escape to release.",
  },
  {
    pattern: /scope|limb|upper|lower|full/,
    tip: "Scope controls which body region you are editing. Use limb for precision, upper or lower for regional passes, and full for whole-body balancing.",
  },
  {
    pattern: /apply scope/,
    tip: "Apply Scope commits the current scope settings and re-anchors active targets to the current pose so transitions stay stable.",
  },
  {
    pattern: /activate scope targets/,
    tip: "Activate Scope Targets creates or refreshes effectors at their live world positions. Use it before dragging if targets are missing.",
  },
  {
    pattern: /reset scope filters/,
    tip: "Reset Scope Filters restores joint enablement and visibility across the whole rig. Use this if parts of the body seem hidden or locked out.",
  },
  {
    pattern: /solver|fabrik|ccd|hybrid/,
    tip: "Solver changes how IK converges. FABRIK is stable, CCD can be more aggressive, and Hybrid is experimental for mixed behavior.",
  },
  {
    pattern: /stretch/,
    tip: "Stretch allows temporary extension while dragging. Keep it off for strict segment lengths and turn it on for stylized pushes.",
  },
  {
    pattern: /friction off/,
    tip: "Friction Off removes damping constraints for freer motion. Re-enable it when you want grounded or physically constrained behavior.",
  },
  {
    pattern: /clamp|reach/,
    tip: "Reach clamp prevents grounded targets from exceeding practical distance. Disable only when you intentionally need exaggerated reach.",
  },
  {
    pattern: /root\/waist lock|root waist lock/,
    tip: "Root or waist lock stabilizes trunk behavior while limbs move. Keep it on for grounded poses and disable for looser torso drift.",
  },
  {
    pattern: /mirror controls|mirror/,
    tip: "Mirror controls applies matching edits to left and right sides. Use it for quick symmetry, then disable for asymmetrical polish.",
  },
  {
    pattern: /turnover/,
    tip: "Turnover adjusts visual stacking so limb overlaps read correctly from the current view. Toggle it when occlusion looks wrong.",
  },
  {
    pattern: /skeletal|mask|lock both|visibility/,
    tip: "These controls determine whether skeleton edits, mask edits, or both are active and visible. Use them to avoid accidental cross-edits.",
  },
  {
    pattern: /precision|grounded|expressive/,
    tip: "Presets apply bundled IK behavior profiles. Start with Precision, switch to Grounded for planted feet, or use Expressive for looser motion.",
  },
  {
    pattern: /play|jump/,
    tip: "Play mode previews runtime jump and landing behavior from your current pose baseline. Trigger it to test motion continuity.",
  },
  {
    pattern: /view|rings|console/,
    tip: "These controls tune interface density and wheel complexity. Use them to trade clarity against available controls while posing.",
  },
];

const normalizeHoverHelpText = (value: string): string => value.replace(/\s+/g, " ").trim();

const finalizeHoverHelpSentence = (value: string): string => {
  const normalized = normalizeHoverHelpText(value);
  if (!normalized) {
    return "";
  }
  return /[.!?]$/.test(normalized) ? normalized : `${normalized}.`;
};

const readAssociatedControlLabel = (element: HTMLElement): string | null => {
  if (
    !(element instanceof HTMLInputElement) &&
    !(element instanceof HTMLSelectElement) &&
    !(element instanceof HTMLTextAreaElement)
  ) {
    return null;
  }
  for (const label of Array.from(element.labels ?? [])) {
    const text = normalizeHoverHelpText(label.textContent ?? "");
    if (text) {
      return text;
    }
  }
  return null;
};

const getHoverHelpLabel = (element: HTMLElement): string => {
  const explicitLabel = normalizeHoverHelpText(
    element.getAttribute("data-hover-help-key") ??
      element.getAttribute("aria-label") ??
      element.getAttribute("name") ??
      element.getAttribute("id") ??
      ""
  );
  if (explicitLabel) {
    return explicitLabel;
  }
  const associated = readAssociatedControlLabel(element);
  if (associated) {
    return associated;
  }
  const title = normalizeHoverHelpText(element.getAttribute("title") ?? "");
  if (title) {
    return title;
  }
  const text = normalizeHoverHelpText(element.textContent ?? "");
  if (text) {
    return text;
  }
  return "this control";
};

const buildHoverHelpFromElement = (element: HTMLElement): string => {
  const explicitHelp = normalizeHoverHelpText(element.getAttribute("data-hover-help") ?? "");
  if (explicitHelp) {
    return explicitHelp;
  }

  const label = getHoverHelpLabel(element);
  const normalizedLabel = label.toLowerCase();
  const matchedRule = HOVER_HELP_RULES.find((rule) => rule.pattern.test(normalizedLabel));
  if (matchedRule) {
    return matchedRule.tip;
  }

  const title = normalizeHoverHelpText(element.getAttribute("title") ?? "");
  if (title) {
    return `${finalizeHoverHelpSentence(title)} Use it to guide your current pose without leaving the active workflow.`;
  }

  const quotedLabel = label === "this control" ? "this control" : `"${label}"`;
  if (element instanceof HTMLInputElement) {
    if (element.type === "checkbox") {
      return `Toggle ${quotedLabel} on or off. Keep it enabled when you want this behavior to persist while editing.`;
    }
    if (element.type === "range") {
      return `Drag ${quotedLabel} for quick coarse adjustment. Pair it with numeric fields for precise final values.`;
    }
    if (element.type === "number") {
      return `Type an exact value for ${quotedLabel}. Small increments usually produce cleaner pose refinement.`;
    }
    return `Adjust ${quotedLabel} to tune this setting. Changes apply immediately to the current state.`;
  }
  if (element instanceof HTMLSelectElement) {
    return `Use ${quotedLabel} to switch modes or options. The selected choice applies immediately.`;
  }
  if (element instanceof HTMLTextAreaElement) {
    return `Edit ${quotedLabel} content directly here. Apply or load actions commit it into the rig state.`;
  }
  return `Use ${quotedLabel} to trigger this action. Check the canvas response immediately after clicking.`;
};

const parseModuleLayout = (value: unknown): Partial<Record<ModuleId, ModuleWindowState>> => {
  if (!isRecord(value)) {
    return {};
  }
  const next: Partial<Record<ModuleId, ModuleWindowState>> = {};
  (Object.keys(MODULE_DEFAULTS) as ModuleId[]).forEach((moduleId) => {
    const entry = value[moduleId];
    if (!isRecord(entry)) {
      return;
    }
    const x = typeof entry.x === "number" && Number.isFinite(entry.x) ? entry.x : null;
    const y = typeof entry.y === "number" && Number.isFinite(entry.y) ? entry.y : null;
    const width = typeof entry.width === "number" && Number.isFinite(entry.width) ? entry.width : null;
    const height = typeof entry.height === "number" && Number.isFinite(entry.height) ? entry.height : null;
    const minimized = entry.minimized === true;
    if (x === null || y === null || width === null || height === null) {
      return;
    }
    next[moduleId] = { x, y, width, height, minimized };
  });
  return next;
};

const isEditableTarget = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) {
    return false;
  }
  const tag = target.tagName;
  return (
    target.isContentEditable ||
    tag === "INPUT" ||
    tag === "TEXTAREA" ||
    tag === "SELECT"
  );
};

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

type RotationPreview = {
  jointId: JointId;
  pivot: Vec2;
  points: Vec2[];
};

type RotationDragState = {
  jointId: JointId;
  pivot: Vec2;
  baseVec: Vec2;
  accumulatedDelta: number;
};

type JumpAnchorPose = {
  rootY: number;
  waist: Vec2;
  lHip: Vec2;
  rHip: Vec2;
};

type JumpFrameSnapshot = {
  mode: "FK" | "IK";
  rootX: number;
  rootY: number;
  waistLocal: Vec2;
  lHipLocal: Vec2;
  rHipLocal: Vec2;
  groundY: number;
  leftFootY: number;
  rightFootY: number;
  leftFootGroundPinned: boolean;
  rightFootGroundPinned: boolean;
  rootIkTargetX: number;
};

const buildRotationPreviewPoints = (baseVec: Vec2, pivot: Vec2, delta: number): Vec2[] => {
  const steps = 5;
  const points: Vec2[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const progress = step / steps;
    const angle = delta * progress;
    const rotated = rotatePoint(baseVec, angle);
    points.push({ x: pivot.x + rotated.x, y: pivot.y + rotated.y });
  }
  return points;
};

export const RigCoreV2Shell: React.FC = () => {
  const rig = useRigAdapter();
  const [skeletonScale, setSkeletonScale] = useState(1);
  const [jointEnabled, setJointEnabled] = useState<Partial<Record<JointId, boolean>>>(() =>
    createJointBooleanMap(true)
  );
  const [jointVisibility, setJointVisibility] = useState<Partial<Record<JointId, boolean>>>(() =>
    createJointBooleanMap(true)
  );
  const [skeletonVisibility, setSkeletonVisibility] = useState<Partial<Record<JointId, boolean>>>(() =>
    createJointBooleanMap(true)
  );
  const [showJoints, setShowJoints] = useState(true);
  const [showSkeleton, setShowSkeleton] = useState(true);
  const [showMasks, setShowMasks] = useState(true);
  const [hoverHelpText, setHoverHelpText] = useState(HOVER_HELP_DEFAULT_TEXT);
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
  const [activeSideConsoleTab, setActiveSideConsoleTab] =
    useState<SideConsoleTab>(DEFAULT_SIDE_CONSOLE_TAB);
  const [advancedRigEnabled, setAdvancedRigEnabled] = useState(DEFAULT_ADVANCED_RIG_ENABLED);
  const [floatingModules, setFloatingModules] = useState<Partial<Record<ModuleId, ModuleWindowState>>>({});
  const hoverHelpElementRef = useRef<HTMLElement | null>(null);
  const mainCanvasRef = useRef<HTMLDivElement | null>(null);
  const [canvasBounds, setCanvasBounds] = useState<DOMRect | null>(null);
  const moduleDragRef = useRef<{
    id: ModuleId;
    offsetX: number;
    offsetY: number;
  } | null>(null);
  const moduleDragIntentRef = useRef<{
    id: ModuleId;
    startX: number;
    startY: number;
    dragged: boolean;
  } | null>(null);
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
  const [wheelLayers, setWheelLayers] = useState<1 | 2 | 3>(DEFAULT_WHEEL_LAYERS);
  const [wheelAxisLock, setWheelAxisLock] = useState<"xy" | "x" | "y">(DEFAULT_WHEEL_AXIS_LOCK);
  const [wheelPrecision, setWheelPrecision] = useState<"coarse" | "fine">(DEFAULT_WHEEL_PRECISION);
  const [wheelPrimaryTool, setWheelPrimaryTool] = useState<WheelPrimaryTool>(DEFAULT_WHEEL_PRIMARY_TOOL);
  const [canvasMenuOpen, setCanvasMenuOpen] = useState<Record<CanvasWorkflowMode, boolean>>(
    DEFAULT_CANVAS_MENU_OPEN
  );
  const [ikCanvasScopeMode, setIkCanvasScopeMode] = useState<IkCanvasScopeMode>("limb");
  const [ikCanvasLimbScope, setIkCanvasLimbScope] = useState<IkCanvasLimbScope>("l_arm");
  const [ikCanvasIsolateScope, setIkCanvasIsolateScope] = useState(true);
  const [ikCanvasHideNonScope, setIkCanvasHideNonScope] = useState(false);
  const [ikCanvasAutoActivateTargets, setIkCanvasAutoActivateTargets] = useState(true);
  const [ikStickyTargetJointId, setIkStickyTargetJointId] = useState<JointId | null>(null);
  const [rotationPreview, setRotationPreview] = useState<RotationPreview | null>(null);
  const [groundPlaneY, setGroundPlaneY] = useState(GROUND_ROOT_Y);
  const [cameraOffset, setCameraOffset] = useState({ x: 0, y: 0 });
  const [jumpFallEnabled, setJumpFallEnabled] = useState(false);
  const [jumpPhase, setJumpPhase] = useState<JumpFallPhase>("grounded");
  const jumpRequestedRef = useRef(false);
  const jumpFallStateRef = useRef<JumpFallState>({
    ...DEFAULT_JUMP_FALL_STATE,
    enabled: false,
  });
  const jumpAnchorPoseRef = useRef<JumpAnchorPose>({
    rootY: 0,
    waist: { x: 0, y: 0 },
    lHip: { x: 0, y: 0 },
    rHip: { x: 0, y: 0 },
  });
  const jumpRuntimeYRef = useRef(0);
  const jumpLastMsRef = useRef<number | null>(null);
  const jumpPrevPhaseRef = useRef<JumpFallPhase>("grounded");
  const jumpFrameSnapshotRef = useRef<JumpFrameSnapshot | null>(null);
  const jumpAutoGroundPinsRef = useRef<Set<JointId>>(new Set());
  const jumpRafRef = useRef<number | null>(null);
  const rigOpsRef = useRef({
    ikSetTarget: rig.ikSetTarget,
    fkSetTranslation: rig.fkSetTranslation,
    dispatch: rig.dispatch,
  });
  const rigAuditStateRef = useRef(rig.state);
  const rigAuditWorldRef = useRef(rig.worldTransforms);
  const rotationDragRef = useRef<RotationDragState | null>(null);
  const fkDragRotationRef = useRef<{
    jointId: JointId;
    pivot: { x: number; y: number };
    lastPointerAngleDeg: number;
    lastSampleMs: number;
    currentJointRotationDeg: number;
    mirroredJointId: JointId | null;
    currentMirroredRotationDeg: number;
    previewBaseVec: Vec2;
    previewAccumulatedDeltaDeg: number;
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
  const overlayAnchorMoveCacheRef = useRef<Map<string, Vec2>>(new Map());
  const previousAdvancedRigEnabledRef = useRef(advancedRigEnabled);
  const availableConsoleTabs = useMemo<ConsoleTab[]>(
    () => ["rig", "animation", "camera", "data", "slm"],
    []
  );
  const isModuleFloating = useCallback(
    (moduleId: ModuleId) => Boolean(floatingModules[moduleId]),
    [floatingModules]
  );
  const floatingModuleIds = useMemo(
    () => Object.keys(floatingModules) as ModuleId[],
    [floatingModules]
  );
  const minimizedModuleIds = useMemo(
    () => floatingModuleIds.filter((moduleId) => floatingModules[moduleId]?.minimized),
    [floatingModuleIds, floatingModules]
  );
  const availableSidebarTabs = useMemo(
    () => availableConsoleTabs.filter((tab) => !isModuleFloating(tab)),
    [availableConsoleTabs, isModuleFloating]
  );
  useEffect(() => {
    if (!availableConsoleTabs.includes(activeConsoleTab)) {
      setActiveConsoleTab("rig");
    }
  }, [activeConsoleTab, availableConsoleTabs]);
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const raw = window.localStorage.getItem(MODULE_LAYOUT_STORAGE_KEY);
    if (!raw) {
      return;
    }
    try {
      const parsed = JSON.parse(raw);
      const layout = parseModuleLayout(parsed);
      if (Object.keys(layout).length > 0) {
        setFloatingModules(layout);
      }
    } catch {
      // Ignore malformed storage.
    }
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    window.localStorage.setItem(MODULE_LAYOUT_STORAGE_KEY, JSON.stringify(floatingModules));
  }, [floatingModules]);
  useEffect(() => {
    if (!isModuleFloating(activeConsoleTab)) {
      return;
    }
    const nextTab = availableConsoleTabs.find((tab) => !isModuleFloating(tab));
    if (nextTab) {
      setActiveConsoleTab(nextTab);
    }
  }, [activeConsoleTab, availableConsoleTabs, isModuleFloating]);
  useEffect(() => {
    const updateBounds = () => {
      setCanvasBounds(mainCanvasRef.current?.getBoundingClientRect() ?? null);
    };
    updateBounds();
    window.addEventListener("resize", updateBounds);
    return () => window.removeEventListener("resize", updateBounds);
  }, [canvasUxPreset]);
  useEffect(() => {
    if (previousAdvancedRigEnabledRef.current && !advancedRigEnabled) {
      fkDragRotationRef.current = null;
      fkDragDeltaFilterRef.current = { jointId: null, value: 0, lastMs: 0 };
      wheelDeltaFilterRef.current = { value: 0, lastMs: 0 };
      rig.dragEnd();
    }
    previousAdvancedRigEnabledRef.current = advancedRigEnabled;
  }, [advancedRigEnabled, rig]);
  useEffect(() => {
    rigOpsRef.current = {
      ikSetTarget: rig.ikSetTarget,
      fkSetTranslation: rig.fkSetTranslation,
      dispatch: rig.dispatch,
    };
  }, [rig.dispatch, rig.fkSetTranslation, rig.ikSetTarget]);
  useEffect(() => {
    rigAuditStateRef.current = rig.state;
    rigAuditWorldRef.current = rig.worldTransforms;
  }, [rig.state, rig.worldTransforms]);
  const renderGameToText = useCallback(() => {
    const state = rigAuditStateRef.current;
    const world = rigAuditWorldRef.current;
    const activeTargets = JOINT_IDS.flatMap((jointId) => {
      const target = state.ikTargets[jointId];
      if (!target?.active) {
        return [];
      }
      return [
        {
          jointId,
          x: roundAuditValue(target.x),
          y: roundAuditValue(target.y),
        },
      ];
    });
    const activePoleTargets = JOINT_IDS.flatMap((jointId) => {
      const target = state.ikPoleTargets[jointId];
      if (!target?.active) {
        return [];
      }
      return [
        {
          jointId,
          x: roundAuditValue(target.x),
          y: roundAuditValue(target.y),
        },
      ];
    });
    const payload = {
      coordinateSystem: "origin near torso root, +x right, +y down",
      mode: state.mode,
      ikSolveMode: state.ikSolveMode,
      ikSolver: state.ikSolver,
      selectedJointId: state.selectedJointId,
      drag:
        state.dragState === null
          ? null
          : {
              jointId: state.dragState.jointId,
              handle: state.dragState.handle,
              current: {
                x: roundAuditValue(state.dragState.current.x),
                y: roundAuditValue(state.dragState.current.y),
              },
            },
      diagnostics: {
        iterations: state.diagnostics.iterations,
        residual: roundAuditValue(state.diagnostics.residual),
        solveMs: roundAuditValue(state.diagnostics.solveMs),
        chainsSolved: state.diagnostics.chainsSolved,
        globalPasses: state.diagnostics.globalPasses,
      },
      joints: JOINT_IDS.map((jointId) => {
        const joint = state.joints[jointId];
        const worldJoint = world[jointId];
        return {
          id: jointId,
          local: {
            x: roundAuditValue(joint.localTranslation.x),
            y: roundAuditValue(joint.localTranslation.y),
            rotationDeg: roundAuditValue(joint.localRotationDegRaw),
          },
          world: {
            x: roundAuditValue(worldJoint.worldPosition.x),
            y: roundAuditValue(worldJoint.worldPosition.y),
            rotationDeg: roundAuditValue(worldJoint.worldRotationDeg),
          },
        };
      }),
      ikTargets: activeTargets,
      ikPoleTargets: activePoleTargets,
      pins: state.pins.map((pin) =>
        pin.kind === "world"
          ? {
              kind: pin.kind,
              jointId: pin.jointId,
              x: roundAuditValue(pin.x),
              y: roundAuditValue(pin.y),
              lockX: pin.lockX,
              lockY: pin.lockY,
            }
          : {
              kind: pin.kind,
              jointId: pin.jointId,
              groundY: roundAuditValue(pin.groundY),
            }
      ),
      overlays: state.overlays
        .filter((overlay) => overlay.visible)
        .map((overlay) => ({
          id: overlay.id,
          name: overlay.name,
          parentJointId: overlay.parentJointId,
          childJointId: overlay.childJointId,
          offset: {
            x: roundAuditValue(overlay.offset.x),
            y: roundAuditValue(overlay.offset.y),
          },
          childOffset: {
            x: roundAuditValue(overlay.childOffset.x),
            y: roundAuditValue(overlay.childOffset.y),
          },
          rotation: roundAuditValue(overlay.rotation),
          scale: roundAuditValue(overlay.scale),
        })),
    };
    return JSON.stringify(payload);
  }, []);
  const advanceTime = useCallback((ms: number): Promise<void> => {
    if (typeof window === "undefined") {
      return Promise.resolve();
    }
    const durationMs = Number.isFinite(ms) ? Math.max(0, ms) : 0;
    if (durationMs <= 0) {
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      const start = performance.now();
      const tick = (now: number) => {
        if (now - start >= durationMs) {
          resolve();
          return;
        }
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }, []);
  useEffect(() => {
    if (typeof window === "undefined") {
      return;
    }
    const auditWindow = window as RigAuditWindow;
    auditWindow.render_game_to_text = renderGameToText;
    auditWindow.advanceTime = advanceTime;
    return () => {
      if (auditWindow.render_game_to_text === renderGameToText) {
        delete auditWindow.render_game_to_text;
      }
      if (auditWindow.advanceTime === advanceTime) {
        delete auditWindow.advanceTime;
      }
    };
  }, [advanceTime, renderGameToText]);
  const handlePinchZoom = useCallback((scaleMultiplier: number) => {
    if (!Number.isFinite(scaleMultiplier) || scaleMultiplier <= 0) {
      return;
    }
    setCameraZoomMultiplier((prev) => {
      const next = prev * scaleMultiplier;
      return Math.min(4, Math.max(0.05, next));
    });
  }, []);

  const getCanvasBounds = useCallback(() => mainCanvasRef.current?.getBoundingClientRect() ?? null, []);

  const setHoverHelpFromElement = useCallback((element: HTMLElement | null) => {
    if (hoverHelpElementRef.current === element) {
      return;
    }
    hoverHelpElementRef.current = element;
    if (!element) {
      setHoverHelpText(HOVER_HELP_DEFAULT_TEXT);
      return;
    }
    setHoverHelpText(buildHoverHelpFromElement(element));
  }, []);

  const resolveHoverHelpElement = useCallback((target: EventTarget | null): HTMLElement | null => {
    if (!(target instanceof HTMLElement)) {
      return null;
    }
    if (target.closest(HOVER_HELP_SKIP_SELECTOR)) {
      return null;
    }
    const interactive = target.closest(HOVER_HELP_INTERACTIVE_SELECTOR);
    return interactive instanceof HTMLElement ? interactive : null;
  }, []);

  const handleHoverHelpMouseMove = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      setHoverHelpFromElement(resolveHoverHelpElement(event.target));
    },
    [resolveHoverHelpElement, setHoverHelpFromElement]
  );

  const handleHoverHelpMouseLeave = useCallback(() => {
    setHoverHelpFromElement(null);
  }, [setHoverHelpFromElement]);

  const handleHoverHelpFocusCapture = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      setHoverHelpFromElement(resolveHoverHelpElement(event.target));
    },
    [resolveHoverHelpElement, setHoverHelpFromElement]
  );

  const handleHoverHelpBlurCapture = useCallback(
    (event: React.FocusEvent<HTMLDivElement>) => {
      const nextTarget = event.relatedTarget;
      if (!(nextTarget instanceof HTMLElement) || !event.currentTarget.contains(nextTarget)) {
        setHoverHelpFromElement(null);
      }
    },
    [setHoverHelpFromElement]
  );

  const openModuleWindow = useCallback(
    (moduleId: ModuleId, pointerX: number, pointerY: number) => {
      const bounds = getCanvasBounds();
      const { width, height } = MODULE_DEFAULTS[moduleId];
      const defaultX = bounds
        ? clampNumber(pointerX - bounds.left - width / 2, 8, Math.max(8, bounds.width - width - 8))
        : 24;
      const defaultY = bounds
        ? clampNumber(pointerY - bounds.top - 24, 8, Math.max(8, bounds.height - height - 8))
        : 24;
      setFloatingModules((prev) => {
        if (prev[moduleId]) {
          return prev;
        }
        return {
          ...prev,
          [moduleId]: {
            x: defaultX,
            y: defaultY,
            width,
            height,
            minimized: false,
          },
        };
      });
      return {
        x: defaultX,
        y: defaultY,
        width,
        height,
        bounds,
      };
    },
    [getCanvasBounds]
  );

  const updateModulePosition = useCallback(
    (moduleId: ModuleId, x: number, y: number) => {
      const bounds = getCanvasBounds();
      setFloatingModules((prev) => {
        const current = prev[moduleId];
        if (!current) {
          return prev;
        }
        const maxX = bounds ? Math.max(0, bounds.width - current.width) : x;
        const maxY = bounds ? Math.max(0, bounds.height - current.height) : y;
        return {
          ...prev,
          [moduleId]: {
            ...current,
            x: clampNumber(x, 0, maxX),
            y: clampNumber(y, 0, maxY),
          },
        };
      });
    },
    [getCanvasBounds]
  );

  const closeModuleWindow = useCallback((moduleId: ModuleId) => {
    setFloatingModules((prev) => {
      if (!prev[moduleId]) {
        return prev;
      }
      const next = { ...prev };
      delete next[moduleId];
      return next;
    });
  }, []);

  const setModuleMinimized = useCallback((moduleId: ModuleId, minimized: boolean) => {
    setFloatingModules((prev) => {
      const current = prev[moduleId];
      if (!current) {
        return prev;
      }
      return {
        ...prev,
        [moduleId]: {
          ...current,
          minimized,
        },
      };
    });
  }, []);

  const startModuleDrag = useCallback(
    (
      moduleId: ModuleId,
      event: { button: number; clientX: number; clientY: number; preventDefault: () => void },
      presetPosition?: { x: number; y: number }
    ) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      const bounds = getCanvasBounds();
      if (!bounds) {
        return;
      }
      const current = floatingModules[moduleId];
      const baseX = presetPosition?.x ?? current?.x ?? 0;
      const baseY = presetPosition?.y ?? current?.y ?? 0;
      moduleDragRef.current = {
        id: moduleId,
        offsetX: event.clientX - bounds.left - baseX,
        offsetY: event.clientY - bounds.top - baseY,
      };
      const handleMove = (moveEvent: PointerEvent) => {
        if (!moduleDragRef.current || moduleDragRef.current.id !== moduleId) {
          return;
        }
        const nextX = moveEvent.clientX - bounds.left - moduleDragRef.current.offsetX;
        const nextY = moveEvent.clientY - bounds.top - moduleDragRef.current.offsetY;
        updateModulePosition(moduleId, nextX, nextY);
      };
      const handleUp = () => {
        moduleDragRef.current = null;
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
      };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [floatingModules, getCanvasBounds, updateModulePosition]
  );

  const handleSidebarModulePointerDown = useCallback(
    (moduleId: ModuleId, event: React.PointerEvent) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      moduleDragIntentRef.current = {
        id: moduleId,
        startX: event.clientX,
        startY: event.clientY,
        dragged: false,
      };
      const handleMove = (moveEvent: PointerEvent) => {
        const intent = moduleDragIntentRef.current;
        if (!intent || intent.id !== moduleId) {
          return;
        }
        const deltaX = moveEvent.clientX - intent.startX;
        const deltaY = moveEvent.clientY - intent.startY;
        if (!intent.dragged && Math.hypot(deltaX, deltaY) > 6) {
          intent.dragged = true;
          const created = openModuleWindow(moduleId, intent.startX, intent.startY);
          setFloatingModules((prev) => ({
            ...prev,
            [moduleId]: {
              ...(prev[moduleId] ?? {
                x: created.x,
                y: created.y,
                width: created.width,
                height: created.height,
                minimized: false,
              }),
              minimized: false,
            },
          }));
          startModuleDrag(
            moduleId,
            {
              button: 0,
              clientX: moveEvent.clientX,
              clientY: moveEvent.clientY,
              preventDefault: () => moveEvent.preventDefault(),
            },
            { x: created.x, y: created.y }
          );
        }
      };
      const handleUp = () => {
        window.removeEventListener("pointermove", handleMove);
        window.removeEventListener("pointerup", handleUp);
        if (moduleDragIntentRef.current?.id === moduleId) {
          moduleDragIntentRef.current = null;
        }
      };
      window.addEventListener("pointermove", handleMove);
      window.addEventListener("pointerup", handleUp);
    },
    [openModuleWindow, startModuleDrag]
  );

  const handleSidebarModulePointerUp = useCallback(
    (moduleId: ModuleId) => {
      const intent = moduleDragIntentRef.current;
      if (!intent || intent.id !== moduleId) {
        return;
      }
      const wasDragged = intent.dragged;
      moduleDragIntentRef.current = null;
      if (!wasDragged) {
        setActiveConsoleTab(moduleId);
      }
    },
    []
  );


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
  const solvedTargetDisplayPositions = useMemo((): Partial<Record<JointId, Vec2>> => {
    if (rig.state.mode !== "IK" || rig.state.ikSolveMode !== "whole_body_graph") {
      return {};
    }
    const clampedTargets: Partial<Record<JointId, Vec2>> = {};
    for (const jointId of JOINT_IDS) {
      const target = rig.state.ikTargets[jointId];
      if (!target?.active) {
        continue;
      }
      const solved = rig.worldTransforms[jointId]?.worldPosition;
      if (!solved) {
        continue;
      }
      clampedTargets[jointId] = { x: solved.x, y: solved.y };
    }
    return clampedTargets;
  }, [rig.state.ikSolveMode, rig.state.ikTargets, rig.state.mode, rig.worldTransforms]);
  const selectedTargetInput = selectedTarget ?? selectedJointWorldPosition;
  const selectedTargetInputX = selectedTargetInput.x;
  const selectedTargetInputY = selectedTargetInput.y;
  const rootJoint = rig.state.joints.root;
  const selectedWorldPin = useMemo(
    () => rig.state.pins.find((pin) => pin.jointId === selectedJointId && pin.kind === "world"),
    [rig.state.pins, selectedJointId]
  );
  const selectedGroundPin = useMemo(
    () => rig.state.pins.find((pin) => pin.jointId === selectedJointId && pin.kind === "ground"),
    [rig.state.pins, selectedJointId]
  );
  const selectedPinMode: "none" | "world" | "ground" = selectedWorldPin
    ? "world"
    : selectedGroundPin
      ? "ground"
      : "none";
  const setSelectedPinMode = useCallback(
    (mode: "none" | "world" | "ground") => {
      if (!selectedJointEnabled) {
        return;
      }
      if (mode === "none") {
        if (selectedWorldPin) {
          rig.removePin(selectedJointId, "world");
        }
        if (selectedGroundPin) {
          rig.removePin(selectedJointId, "ground");
        }
        return;
      }
      const jointPosition = rig.worldTransforms[selectedJointId].worldPosition;
      if (mode === "world") {
        if (selectedGroundPin) {
          rig.removePin(selectedJointId, "ground");
        }
        rig.setPin({
          kind: "world",
          jointId: selectedJointId,
          x: jointPosition.x,
          y: jointPosition.y,
          lockX: true,
          lockY: true,
        });
        return;
      }
      if (selectedWorldPin) {
        rig.removePin(selectedJointId, "world");
      }
      rig.setPin({
        kind: "ground",
        jointId: selectedJointId,
        groundY: jointPosition.y,
      });
    },
    [rig, selectedGroundPin, selectedJointEnabled, selectedJointId, selectedWorldPin]
  );
  const rootIkTarget = rig.state.ikTargets.root;
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
  const leftFootGroundPinned = useMemo(
    () => rig.state.pins.some((pin) => pin.kind === "ground" && pin.jointId === "l_foot"),
    [rig.state.pins]
  );
  const rightFootGroundPinned = useMemo(
    () => rig.state.pins.some((pin) => pin.kind === "ground" && pin.jointId === "r_foot"),
    [rig.state.pins]
  );
  const hasAnyFootGroundPin = leftFootGroundPinned || rightFootGroundPinned;
  useEffect(() => {
    jumpFrameSnapshotRef.current = {
      mode: rig.state.mode,
      rootX: rootJoint.localTranslation.x,
      rootY: rootJoint.localTranslation.y,
      waistLocal: { ...rig.state.joints.waist.localTranslation },
      lHipLocal: { ...rig.state.joints.l_hip.localTranslation },
      rHipLocal: { ...rig.state.joints.r_hip.localTranslation },
      groundY: currentGroundY,
      leftFootY: leftFootWorld.y,
      rightFootY: rightFootWorld.y,
      leftFootGroundPinned,
      rightFootGroundPinned,
      rootIkTargetX: rootIkTarget?.x ?? rootJoint.localTranslation.x,
    };
  }, [
    currentGroundY,
    leftFootGroundPinned,
    leftFootWorld.y,
    rightFootGroundPinned,
    rightFootWorld.y,
    rig.state.joints.l_hip.localTranslation,
    rig.state.joints.r_hip.localTranslation,
    rig.state.joints.waist.localTranslation,
    rig.state.mode,
    rootIkTarget?.x,
    rootJoint.localTranslation.x,
    rootJoint.localTranslation.y,
  ]);
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }
      if (event.code === JUMP_TOGGLE_KEY) {
        event.preventDefault();
        setJumpFallEnabled((prev) => !prev);
        return;
      }
      if (event.code === JUMP_TRIGGER_KEY && jumpFallEnabled) {
        event.preventDefault();
        jumpRequestedRef.current = true;
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [jumpFallEnabled]);
  useEffect(() => {
    const removeAutoGroundPins = () => {
      for (const jointId of JUMP_AUTO_PIN_JOINT_IDS) {
        if (!jumpAutoGroundPinsRef.current.has(jointId)) {
          continue;
        }
        rigOpsRef.current.dispatch({ type: "PIN_REMOVE", jointId, kind: "ground" });
        jumpAutoGroundPinsRef.current.delete(jointId);
      }
    };

    const ensureAutoGroundPin = (
      jointId: JointId,
      groundY: number,
      hasAnyGroundPin: boolean
    ) => {
      if (hasAnyGroundPin || jumpAutoGroundPinsRef.current.has(jointId)) {
        return;
      }
      rigOpsRef.current.dispatch({
        type: "PIN_SET",
        pin: {
          kind: "ground",
          jointId,
          groundY,
        },
      });
      jumpAutoGroundPinsRef.current.add(jointId);
    };

    if (!jumpFallEnabled) {
      jumpRequestedRef.current = false;
      jumpLastMsRef.current = null;
      jumpPrevPhaseRef.current = "grounded";
      setJumpPhase("grounded");
      jumpFallStateRef.current = {
        ...DEFAULT_JUMP_FALL_STATE,
        enabled: false,
      };
      if (jumpRafRef.current !== null) {
        cancelAnimationFrame(jumpRafRef.current);
        jumpRafRef.current = null;
      }
      removeAutoGroundPins();
      return;
    }

    const snapshotAtStart = jumpFrameSnapshotRef.current;
    if (snapshotAtStart) {
      jumpAnchorPoseRef.current = {
        rootY: snapshotAtStart.rootY,
        waist: { ...snapshotAtStart.waistLocal },
        lHip: { ...snapshotAtStart.lHipLocal },
        rHip: { ...snapshotAtStart.rHipLocal },
      };
      jumpRuntimeYRef.current = 0;
    }
    jumpLastMsRef.current = null;
    jumpPrevPhaseRef.current = "grounded";
    setJumpPhase("grounded");
    jumpFallStateRef.current = {
      ...DEFAULT_JUMP_FALL_STATE,
      enabled: true,
      phase: "grounded",
      lastGroundedAtMs:
        typeof performance !== "undefined" && typeof performance.now === "function"
          ? performance.now()
          : Date.now(),
    };

    const tick = (nowMs: number) => {
      const snapshot = jumpFrameSnapshotRef.current;
      if (!snapshot) {
        jumpRafRef.current = requestAnimationFrame(tick);
        return;
      }

      const previousMs = jumpLastMsRef.current ?? nowMs;
      const dtMs = Math.max(1, Math.min(48, nowMs - previousMs));
      jumpLastMsRef.current = nowMs;

      const footGrounded =
        Math.abs(snapshot.leftFootY - snapshot.groundY) <= JUMP_FOOT_CONTACT_EPSILON ||
        Math.abs(snapshot.rightFootY - snapshot.groundY) <= JUMP_FOOT_CONTACT_EPSILON;

      const stepped = stepJumpFall({
        state: jumpFallStateRef.current,
        dtMs,
        nowMs,
        jumpRequested: jumpRequestedRef.current,
        rootY: jumpRuntimeYRef.current,
        groundY: 0,
        footGrounded,
      });
      jumpRequestedRef.current = false;
      jumpFallStateRef.current = stepped.state;
      jumpRuntimeYRef.current = stepped.rootY;

      if (stepped.state.phase === "grounded") {
        ensureAutoGroundPin("l_foot", snapshot.leftFootY, snapshot.leftFootGroundPinned);
        ensureAutoGroundPin("r_foot", snapshot.rightFootY, snapshot.rightFootGroundPinned);
      } else {
        removeAutoGroundPins();
      }

      const anchor = jumpAnchorPoseRef.current;
      const justLanded =
        jumpPrevPhaseRef.current !== "grounded" && stepped.state.phase === "grounded";
      let targetRootY = anchor.rootY + stepped.rootY;
      if (justLanded) {
        targetRootY =
          snapshot.rootY + (targetRootY - snapshot.rootY) * LANDING_ROOT_DAMPING;
      }

      if (snapshot.mode === "IK") {
        rigOpsRef.current.ikSetTarget("root", snapshot.rootIkTargetX, targetRootY);
      } else {
        rigOpsRef.current.fkSetTranslation("root", snapshot.rootX, targetRootY);
      }

      if (justLanded) {
        rigOpsRef.current.dispatch({
          type: "RUNTIME_DAMP_PELVIS",
          rootY: targetRootY,
          waistTarget: anchor.waist,
          lHipTarget: anchor.lHip,
          rHipTarget: anchor.rHip,
          alpha: LANDING_PELVIS_DAMPING,
        });
      }

      if (jumpPrevPhaseRef.current !== stepped.state.phase) {
        setJumpPhase(stepped.state.phase);
      }
      jumpPrevPhaseRef.current = stepped.state.phase;
      jumpRafRef.current = requestAnimationFrame(tick);
    };

    jumpRafRef.current = requestAnimationFrame(tick);
    return () => {
      if (jumpRafRef.current !== null) {
        cancelAnimationFrame(jumpRafRef.current);
        jumpRafRef.current = null;
      }
      removeAutoGroundPins();
    };
  }, [jumpFallEnabled]);
  const clampIkDragPoint = useCallback(
    (jointId: JointId, x: number, y: number): { x: number; y: number } => {
      return clampIkTargetForGroundedReach(
        rig.state.joints,
        rig.state.pins,
        jointId,
        { x, y },
        rig.state.ikStretchEnabled,
        rig.state.constraintSettings
      );
    },
    [
      rig.state.ikStretchEnabled,
      rig.state.joints,
      rig.state.pins,
      rig.state.constraintSettings,
    ]
  );
  const clearIkStickyTarget = useCallback(() => {
    setIkStickyTargetJointId(null);
  }, []);
  const toggleIkStickyTarget = useCallback(
    (jointId: JointId, x: number, y: number) => {
      if (rig.state.mode !== "IK") {
        return;
      }
      if (jointEnabled[jointId] === false) {
        return;
      }
      if (ikStickyTargetJointId === jointId) {
        setIkStickyTargetJointId(null);
        return;
      }
      const clamped = clampIkDragPoint(jointId, x, y);
      rig.selectJoint(jointId);
      rig.ikSetTarget(jointId, clamped.x, clamped.y);
      setIkStickyTargetJointId(jointId);
    },
    [clampIkDragPoint, ikStickyTargetJointId, jointEnabled, rig]
  );
  const handleIkStickyViewportPointerMove = useCallback(
    (x: number, y: number, event: React.PointerEvent<SVGSVGElement>) => {
      if (event.pointerType === "touch") {
        return;
      }
      if (rig.state.mode !== "IK" || !ikStickyTargetJointId || rig.state.dragState) {
        return;
      }
      if (jointEnabled[ikStickyTargetJointId] === false) {
        setIkStickyTargetJointId(null);
        return;
      }
      const clamped = clampIkDragPoint(ikStickyTargetJointId, x, y);
      rig.ikSetTarget(ikStickyTargetJointId, clamped.x, clamped.y);
    },
    [clampIkDragPoint, ikStickyTargetJointId, jointEnabled, rig]
  );
  useEffect(() => {
    if (rig.state.mode === "IK") {
      return;
    }
    setIkStickyTargetJointId(null);
  }, [rig.state.mode]);
  useEffect(() => {
    const handleEscapeToStopStickyIk = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || !ikStickyTargetJointId) {
        return;
      }
      event.preventDefault();
      setIkStickyTargetJointId(null);
    };
    window.addEventListener("keydown", handleEscapeToStopStickyIk);
    return () => window.removeEventListener("keydown", handleEscapeToStopStickyIk);
  }, [ikStickyTargetJointId]);
  const normalizedRotation = useMemo(
    () => normalizeAngleDeg(selectedJoint.localRotationDegRaw),
    [selectedJoint.localRotationDegRaw]
  );
  const dataModuleVisible =
    activeSideConsoleTab === "data" || activeSideConsoleTab === "exports";
  const poseDataText = useMemo(
    () => (dataModuleVisible ? JSON.stringify(toRigSnapshotV2(rig.state), null, 2) : ""),
    [dataModuleVisible, rig.state]
  );
  const overlaySpawnJointId: JointId = rig.state.selectedJointId ?? "waist";
  const slmModuleVisible = false;
  const modelModuleVisible = false;
  const activeCanvasWorkflow = useMemo<CanvasWorkflowMode>(() => {
    if (jumpFallEnabled) {
      return "play";
    }
    if (canvasMenuOpen.animation) {
      return "animation";
    }
    if (rig.state.mode === "IK") {
      return "ik";
    }
    if (skeletalMaskMode === "locked" || skeletalMaskMode === "mask_only") {
      return "compose";
    }
    if (wheelPrimaryTool === "rotate") {
      return "rotate";
    }
    return "pose";
  }, [canvasMenuOpen.animation, jumpFallEnabled, rig.state.mode, skeletalMaskMode, wheelPrimaryTool]);
  const composeCanvasMenuActive =
    canvasMenuOpen.compose || activeCanvasWorkflow === "compose";
  const effectiveInteractionMode: SkeletalMaskMode = useMemo(() => {
    if (composeCanvasMenuActive) {
      return "locked";
    }
    return skeletalMaskMode;
  }, [
    composeCanvasMenuActive,
    skeletalMaskMode,
  ]);
  const showSidebar = canvasUxPreset !== "focus";
  const activeWheelLayers: 1 | 2 | 3 = useMemo(() => {
    if (canvasUxPreset === "focus") {
      return 1;
    }
    if (canvasUxPreset === "full") {
      return 3;
    }
    return wheelLayers;
  }, [canvasUxPreset, wheelLayers]);
  const wheelControlMode = useMemo(() => {
    if (wheelPrimaryTool === "zoom") {
      return "scalar" as const;
    }
    if (wheelPrimaryTool === "translate") {
      return "xy" as const;
    }
    return "rotate" as const;
  }, [wheelPrimaryTool]);
  const wheelPrimarySegments = useMemo(
    () => [
      { id: "rotate", label: "Rot", active: wheelPrimaryTool === "rotate" },
      { id: "translate", label: "XY", active: wheelPrimaryTool === "translate" },
      { id: "zoom", label: "Zoom", active: wheelPrimaryTool === "zoom" },
    ],
    [wheelPrimaryTool]
  );
  const skeletalInteractionEnabled = effectiveInteractionMode !== "mask_only";
  const maskInteractionEnabled = effectiveInteractionMode !== "skeletal_only";
  const overlayEditingEnabled = maskInteractionEnabled && composeCanvasMenuActive;
  const activeOverlay = useMemo(
    () => rig.state.overlays.find((overlay) => overlay.id === activeOverlayId) ?? null,
    [activeOverlayId, rig.state.overlays]
  );
  const activeOverlayIndex = useMemo(() => {
    if (!activeOverlayId) {
      return -1;
    }
    return rig.state.overlays.findIndex((overlay) => overlay.id === activeOverlayId);
  }, [activeOverlayId, rig.state.overlays]);
  const cycleActiveOverlay = useCallback(
    (direction: "prev" | "next") => {
      if (rig.state.overlays.length === 0) {
        return;
      }
      if (!activeOverlayId || activeOverlayIndex < 0) {
        setActiveOverlayId(rig.state.overlays[0].id);
        return;
      }
      const delta = direction === "next" ? 1 : -1;
      const nextIndex =
        (activeOverlayIndex + delta + rig.state.overlays.length) % rig.state.overlays.length;
      setActiveOverlayId(rig.state.overlays[nextIndex].id);
    },
    [activeOverlayId, activeOverlayIndex, rig.state.overlays]
  );
  const anyCanvasMenuOpen = useMemo(
    () => CANVAS_WORKFLOW_ORDER.some((mode) => canvasMenuOpen[mode]),
    [canvasMenuOpen]
  );
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
      const cacheKey = `${overlayId}:${anchor}`;
      const previousPoint = overlayAnchorMoveCacheRef.current.get(cacheKey);
      if (
        previousPoint &&
        Math.abs(previousPoint.x - x) < 0.35 &&
        Math.abs(previousPoint.y - y) < 0.35
      ) {
        return;
      }
      overlayAnchorMoveCacheRef.current.set(cacheKey, { x, y });
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
      overlayAnchorMoveCacheRef.current.delete(`${overlayId}:${anchor}`);
      const overlay = rig.state.overlays.find((entry) => entry.id === overlayId);
      if (!overlay) {
        return;
      }
      setOverlayStatus(`Moved ${overlay.name} ${anchor} anchor.`);
    },
    [overlayEditingEnabled, rig.state.overlays]
  );
  useEffect(() => {
    if (!overlayEditingEnabled) {
      overlayAnchorMoveCacheRef.current.clear();
    }
  }, [overlayEditingEnabled]);

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
      const next = createJointBooleanMap(enabled);
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
    setJointVisibility(createJointBooleanMap(visible));
  }, []);
  const setAllSkeletonVisibility = useCallback((visible: boolean) => {
    setSkeletonVisibility(createJointBooleanMap(visible));
  }, []);
  const resolveIkCanvasScopeJointIds = useCallback(
    (scopeMode: IkCanvasScopeMode, limbScope: IkCanvasLimbScope): JointId[] =>
      scopeMode === "limb"
        ? IK_CANVAS_LIMB_SCOPE_JOINTS[limbScope]
        : IK_CANVAS_SCOPE_JOINTS[scopeMode],
    []
  );
  const resolveIkCanvasScopeEffectors = useCallback(
    (scopeMode: IkCanvasScopeMode, limbScope: IkCanvasLimbScope): JointId[] =>
      scopeMode === "limb"
        ? [IK_CANVAS_LIMB_SCOPE_EFFECTOR[limbScope]]
        : IK_CANVAS_SCOPE_EFFECTORS[scopeMode],
    []
  );
  const activateIkTargetsForScope = useCallback(
    (scopeMode: IkCanvasScopeMode, limbScope: IkCanvasLimbScope) => {
      const effectors = resolveIkCanvasScopeEffectors(scopeMode, limbScope);
      const nextState = cloneRigState(rig.state);
      nextState.mode = "IK";
      for (const effectorJointId of effectors) {
        const worldPosition = rig.worldTransforms[effectorJointId]?.worldPosition;
        if (!worldPosition) {
          continue;
        }
        nextState.ikTargets[effectorJointId] = {
          jointId: effectorJointId,
          x: worldPosition.x,
          y: worldPosition.y,
          active: true,
        };
      }
      rig.hydrate(nextState);
    },
    [resolveIkCanvasScopeEffectors, rig]
  );
  const applyIkCanvasScope = useCallback(
    (
      scopeMode: IkCanvasScopeMode = ikCanvasScopeMode,
      limbScope: IkCanvasLimbScope = ikCanvasLimbScope
    ) => {
      const scopeJointIds = resolveIkCanvasScopeJointIds(scopeMode, limbScope);
      const solveMode =
        scopeMode === "limb"
          ? "single_chain"
          : scopeMode === "lower"
            ? "limbs_only"
            : "whole_body_graph";
      const focusJoint: JointId =
        scopeMode === "limb"
          ? IK_CANVAS_LIMB_SCOPE_EFFECTOR[limbScope]
          : scopeMode === "upper"
            ? "neck"
            : scopeMode === "lower"
              ? selectedJointId === "r_hip" || selectedJointId === "r_knee" || selectedJointId === "r_foot"
                ? "r_foot"
                : "l_foot"
              : selectedJointId;

      setWheelPrimaryTool("translate");

      const nextState = cloneRigState(rig.state);
      nextState.mode = "IK";
      nextState.ikSolveMode = solveMode;
      nextState.selectedJointId = focusJoint;

      const anchoredTargetJointIds = new Set<JointId>();
      for (const jointId of JOINT_IDS) {
        if (nextState.ikTargets[jointId]?.active) {
          anchoredTargetJointIds.add(jointId);
        }
      }
      if (ikCanvasAutoActivateTargets) {
        const scopeEffectors = resolveIkCanvasScopeEffectors(scopeMode, limbScope);
        for (const jointId of scopeEffectors) {
          anchoredTargetJointIds.add(jointId);
        }
      }
      if (ikCanvasIsolateScope) {
        for (const jointId of IK_CANVAS_SCOPE_EFFECTORS.full) {
          anchoredTargetJointIds.add(jointId);
        }
      }
      for (const jointId of anchoredTargetJointIds) {
        const worldPosition = rig.worldTransforms[jointId]?.worldPosition;
        if (!worldPosition) {
          continue;
        }
        nextState.ikTargets[jointId] = {
          jointId,
          x: worldPosition.x,
          y: worldPosition.y,
          active: true,
        };
      }
      rig.hydrate(nextState);

      if (ikCanvasIsolateScope) {
        const nextEnabled = createJointBooleanMap(false);
        for (const jointId of scopeJointIds) {
          nextEnabled[jointId] = true;
        }
        setJointEnabled(nextEnabled);
      } else {
        setJointEnabled(createJointBooleanMap(true));
      }

      if (ikCanvasHideNonScope) {
        const nextVisibility = createJointBooleanMap(false);
        for (const jointId of scopeJointIds) {
          nextVisibility[jointId] = true;
        }
        setJointVisibility(nextVisibility);
        setSkeletonVisibility(nextVisibility);
      } else {
        setAllJointVisibility(true);
        setAllSkeletonVisibility(true);
      }
    },
    [
      ikCanvasAutoActivateTargets,
      ikCanvasHideNonScope,
      ikCanvasIsolateScope,
      ikCanvasLimbScope,
      ikCanvasScopeMode,
      resolveIkCanvasScopeEffectors,
      resolveIkCanvasScopeJointIds,
      rig,
      selectedJointId,
      setAllJointVisibility,
      setAllSkeletonVisibility,
    ]
  );
  const applyIkCanvasPreset = useCallback(
    (preset: "precision" | "expressive" | "grounded") => {
      rig.setMode("IK");
      setWheelPrimaryTool("translate");
      if (preset === "precision") {
        rig.setIkSolveMode("single_chain");
        rig.setIkSolver("fabrik");
        rig.setIkStretchEnabled(false);
        rig.setConstraintSettings({
          ikFrictionOff: false,
          clampGroundedIkTargetReach: true,
          enforceRootWaistLock: true,
          allowKneeLiftWhenBothAnklesPinned: true,
          lockGroundedAnklesX: true,
          releaseGroundedAnkleWhenLegLifts: true,
        });
        return;
      }
      if (preset === "grounded") {
        rig.setIkSolveMode("limbs_only");
        rig.setIkSolver("fabrik");
        rig.setIkStretchEnabled(false);
        rig.setConstraintSettings({
          ikFrictionOff: false,
          clampGroundedIkTargetReach: true,
          enforceRootWaistLock: true,
          allowKneeLiftWhenBothAnklesPinned: false,
          lockGroundedAnklesX: true,
          releaseGroundedAnkleWhenLegLifts: true,
        });
        return;
      }
      rig.setIkSolveMode("whole_body_graph");
      rig.setIkSolver("hybrid");
      rig.setIkStretchEnabled(true);
      rig.setConstraintSettings({
        ikFrictionOff: true,
        clampGroundedIkTargetReach: false,
        enforceRootWaistLock: false,
        allowKneeLiftWhenBothAnklesPinned: true,
        lockGroundedAnklesX: false,
        releaseGroundedAnkleWhenLegLifts: false,
      });
    },
    [rig]
  );

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
          rotationDragRef.current = null;
          setRotationPreview(null);
          return;
        }
        const fkDrag = fkDragRotationRef.current;
        if (!fkDrag || fkDrag.jointId !== jointId) {
          return;
        }
        const now = Date.now();
        const currentPointerAngleDeg = angleDegFrom(fkDrag.pivot, { x, y });
        const pointerRadius = Math.hypot(x - fkDrag.pivot.x, y - fkDrag.pivot.y);
        if (pointerRadius < FK_ROTATION_MIN_RADIUS) {
          fkDrag.lastPointerAngleDeg = currentPointerAngleDeg;
          fkDrag.lastSampleMs = now;
          return;
        }
        const rawIncrementalDeltaDeg =
          normalizeSignedAngleDeg(currentPointerAngleDeg - fkDrag.lastPointerAngleDeg) *
          FK_ROTATION_DRAG_SENSITIVITY;
        fkDrag.lastPointerAngleDeg = currentPointerAngleDeg;
        const elapsedMs = Math.max(1, now - fkDrag.lastSampleMs);
        fkDrag.lastSampleMs = now;
        const incrementalDeltaDeg = clampRotationDeltaForElapsed(rawIncrementalDeltaDeg, elapsedMs);
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
        fkDrag.previewAccumulatedDeltaDeg += smoothedIncrementDeg;
        setRotationPreview({
          jointId,
          pivot: fkDrag.pivot,
          points: buildRotationPreviewPoints(
            fkDrag.previewBaseVec,
            fkDrag.pivot,
            fkDrag.previewAccumulatedDeltaDeg
          ),
        });
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
      rotationDragRef.current = null;
      setRotationPreview(null);
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
  const setSelectedTarget = useCallback(
    (x: number, y: number) => {
      if (!selectedJointEnabled || rig.state.mode !== "IK") {
        return;
      }
      rig.ikSetTarget(selectedJointId, x, y);
    },
    [rig, selectedJointEnabled, selectedJointId]
  );
  const clearSelectedTarget = useCallback(() => {
    if (!selectedJointEnabled) {
      return;
    }
    rig.clearIkTarget(selectedJointId);
  }, [rig, selectedJointEnabled, selectedJointId]);
  const clearSelectedPoleTarget = useCallback(() => {
    if (!selectedPoleJointId || !selectedJointEnabled) {
      return;
    }
    rig.clearIkPoleTarget(selectedPoleJointId);
  }, [rig, selectedJointEnabled, selectedPoleJointId]);

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

  const startRotationPreview = useCallback(() => {
    if (!selectedJointId || !selectedJointEnabled) {
      return;
    }
    const pivotTransform = rig.worldTransforms[selectedJointId];
    if (!pivotTransform) {
      setRotationPreview(null);
      rotationDragRef.current = null;
      return;
    }
    const pivot = pivotTransform.worldPosition;
    const childJointId =
      JOINT_IDS.find((candidate) => rig.state.joints[candidate].parentId === selectedJointId) ?? null;
    const childPosition = childJointId ? rig.worldTransforms[childJointId]?.worldPosition : null;
    let baseVec = { x: 48, y: 0 };
    if (childPosition) {
      const vector = subVec2(childPosition, pivot);
      if (Number.isFinite(vector.x) && Number.isFinite(vector.y)) {
        baseVec = vector;
      }
    }
    rotationDragRef.current = {
      jointId: selectedJointId,
      pivot,
      baseVec,
      accumulatedDelta: 0,
    };
    setRotationPreview({
      jointId: selectedJointId,
      pivot,
      points: buildRotationPreviewPoints(baseVec, pivot, 0),
    });
  }, [rig.state.joints, rig.worldTransforms, selectedJointEnabled, selectedJointId]);

  const clearRotationPreview = useCallback(() => {
    rotationDragRef.current = null;
    setRotationPreview(null);
  }, []);

  const applyWheelRotationDelta = useCallback(
    (deltaDeg: number) => {
      if (!Number.isFinite(deltaDeg) || Math.abs(deltaDeg) <= 1e-4 || !selectedJointEnabled) {
        return;
      }
      if (rig.state.mode === "FK") {
        setFkRotationWithMirror(selectedJointId, selectedJoint.localRotationDegRaw + deltaDeg);
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
      const rotated = rotatePoint(seeded, deltaDeg);
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

  const commitRotationPreview = useCallback(() => {
    const dragState = rotationDragRef.current;
    if (!dragState) {
      clearRotationPreview();
      return;
    }
    const delta = dragState.accumulatedDelta;
    if (Math.abs(delta) >= ROTATION_DELTA_DEADBAND_DEG) {
      applyWheelRotationDelta(delta);
    }
    clearRotationPreview();
  }, [applyWheelRotationDelta, clearRotationPreview]);

  const cycleWheelLayers = useCallback(() => {
    setWheelLayers((prev) => (prev === 1 ? 2 : prev === 2 ? 3 : 1));
  }, []);

  const applyCanvasWorkflow = useCallback(
    (mode: CanvasWorkflowMode) => {
      if (mode !== "play" && jumpFallEnabled) {
        setJumpFallEnabled(false);
      }
      if (mode === "pose") {
        rig.setMode("FK");
        setSkeletalMaskMode("skeletal_only");
        setWheelPrimaryTool("translate");
        setWheelAxisLock(DEFAULT_WHEEL_AXIS_LOCK);
        return;
      }
      if (mode === "compose") {
        rig.setMode("FK");
        setSkeletalMaskMode("locked");
        setWheelPrimaryTool("translate");
        setWheelAxisLock(DEFAULT_WHEEL_AXIS_LOCK);
        setShowMasks(true);
        setShowSkeleton(true);
        return;
      }
      if (mode === "rotate") {
        rig.setMode("FK");
        setSkeletalMaskMode("skeletal_only");
        setWheelPrimaryTool("rotate");
        return;
      }
      if (mode === "ik") {
        rig.setMode("IK");
        setSkeletalMaskMode("skeletal_only");
        setWheelPrimaryTool("translate");
        setWheelAxisLock(DEFAULT_WHEEL_AXIS_LOCK);
        return;
      }
      if (mode === "animation") {
        rig.setMode("FK");
        setSkeletalMaskMode("skeletal_only");
        setWheelPrimaryTool("translate");
        setWheelAxisLock(DEFAULT_WHEEL_AXIS_LOCK);
        return;
      }
      rig.setMode("IK");
      setSkeletalMaskMode("skeletal_only");
      setWheelPrimaryTool("zoom");
      setCameraFocusMode("root_pin");
      setJumpFallEnabled(true);
    },
    [jumpFallEnabled, rig]
  );
  const handleCanvasWorkflowButtonClick = useCallback(
    (mode: CanvasWorkflowMode) => {
      applyCanvasWorkflow(mode);
      setCanvasMenuOpen((prev) => ({
        ...prev,
        [mode]: !prev[mode],
      }));
    },
    [applyCanvasWorkflow]
  );
  useEffect(() => {
    const handleWorkflowShortcut = (event: KeyboardEvent) => {
      if (isEditableTarget(event.target)) {
        return;
      }
      if (event.ctrlKey || event.metaKey || event.altKey) {
        return;
      }
      const workflowMode = WORKFLOW_SHORTCUT_MODE_BY_CODE[event.code];
      if (!workflowMode) {
        return;
      }
      event.preventDefault();
      applyCanvasWorkflow(workflowMode);
      setCanvasMenuOpen((prev) => ({
        ...prev,
        [workflowMode]: true,
      }));
    };
    window.addEventListener("keydown", handleWorkflowShortcut);
    return () => window.removeEventListener("keydown", handleWorkflowShortcut);
  }, [applyCanvasWorkflow]);

  const handleWheelRotateDragStart = useCallback(() => {
    startRotationPreview();
  }, [startRotationPreview]);

  const handleWheelRotateDragEnd = useCallback(() => {
    commitRotationPreview();
  }, [commitRotationPreview]);

  useEffect(() => {
    clearRotationPreview();
  }, [selectedJointId, clearRotationPreview]);

  const handleWheelRotate = useCallback(
    (deltaDeg: number) => {
      if (!Number.isFinite(deltaDeg) || Math.abs(deltaDeg) <= 1e-4 || !selectedJointEnabled) {
        return;
      }
      const scaledDeltaDeg = deltaDeg * WHEEL_ROTATION_SENSITIVITY;
      const now = Date.now();
      const elapsedMs =
        wheelDeltaFilterRef.current.lastMs > 0
          ? Math.max(1, now - wheelDeltaFilterRef.current.lastMs)
          : 16;
      const boundedScaledDeltaDeg = clampRotationDeltaForElapsed(scaledDeltaDeg, elapsedMs);
      if (now - wheelDeltaFilterRef.current.lastMs > ROTATION_INTERPOLATION_RESET_MS) {
        wheelDeltaFilterRef.current = {
          value: boundedScaledDeltaDeg,
          lastMs: now,
        };
      } else {
        wheelDeltaFilterRef.current = {
          value:
            wheelDeltaFilterRef.current.value +
            (boundedScaledDeltaDeg - wheelDeltaFilterRef.current.value) * ROTATION_INTERPOLATION_ALPHA,
          lastMs: now,
        };
      }
      const smoothedDeltaDeg = wheelDeltaFilterRef.current.value;
      if (Math.abs(smoothedDeltaDeg) < ROTATION_DELTA_DEADBAND_DEG) {
        return;
      }
      const dragState = rotationDragRef.current;
      if (dragState && dragState.jointId === selectedJointId) {
        dragState.accumulatedDelta += smoothedDeltaDeg;
        setRotationPreview({
          jointId: dragState.jointId,
          pivot: dragState.pivot,
          points: buildRotationPreviewPoints(dragState.baseVec, dragState.pivot, dragState.accumulatedDelta),
        });
        return;
      }
      applyWheelRotationDelta(smoothedDeltaDeg);
    },
    [applyWheelRotationDelta, selectedJointEnabled, selectedJointId]
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
  const handleWheelScalarChange = useCallback((nextValue: number) => {
    setCameraZoomMultiplier(Math.min(4, Math.max(0.25, nextValue)));
  }, []);
  const handleWheelNudge = useCallback((direction: "forward" | "back") => {
    const step = wheelPrecision === "fine" ? 0.05 : 0.12;
    const signed = direction === "forward" ? step : -step;
    if (wheelControlMode === "rotate") {
      handleWheelRotate((direction === "forward" ? 1 : -1) * (wheelPrecision === "fine" ? 1.2 : 2.8));
      return;
    }
    if (wheelControlMode === "scalar") {
      setCameraZoomMultiplier((prev) => Math.min(4, Math.max(0.25, prev + signed)));
      return;
    }
    if (wheelAxisLock !== "y") {
      handleWheelXChange(wheelXValue + (direction === "forward" ? 12 : -12));
    }
    if (wheelAxisLock !== "x") {
      handleWheelYChange(wheelYValue + (direction === "forward" ? 12 : -12));
    }
  }, [
    handleWheelRotate,
    handleWheelXChange,
    handleWheelYChange,
    wheelAxisLock,
    wheelControlMode,
    wheelPrecision,
    wheelXValue,
    wheelYValue,
  ]);

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
            : createJointBooleanMap(true);
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
            jointEnabled: createJointBooleanMap(true),
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

  const isFkMode = rig.state.mode === "FK";
  const isIkMode = rig.state.mode === "IK";

  const moduleTitles: Record<ModuleId, string> = {
    rig: "Rig",
    animation: "Animation",
    model: "Model",
    camera: "Camera",
    data: "Data",
    slm: "SLM",
  };
  const sideConsoleTabs: SideConsoleTab[] = ["exports", "data", "performance"];
  const sideConsolePanel = (
    <aside
      style={{
        borderRight: "1px solid #d4d4d8",
        padding: "12px",
        overflowY: "auto",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
      }}
    >
      <div style={{ fontSize: "12px", letterSpacing: "0.08em", textTransform: "uppercase", color: "#6b7280" }}>
        Side Console
      </div>
      <div style={{ marginTop: "4px", fontSize: "10px", color: "#9ca3af", letterSpacing: "0.03em" }}>
        Exports, data, and performance only.
      </div>
      <div style={{ marginTop: "10px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px" }}>
        {sideConsoleTabs.map((tab) => (
          <button
            key={`side-console-tab-${tab}`}
            type="button"
            onClick={() => setActiveSideConsoleTab(tab)}
            style={{
              padding: "6px 8px",
              textTransform: "uppercase",
              fontSize: "10px",
              fontWeight: 700,
              borderRadius: "8px",
              background: activeSideConsoleTab === tab ? "#111111" : "#f4f4f5",
              color: activeSideConsoleTab === tab ? "#f9fafb" : "#111111",
              border: `1px solid ${activeSideConsoleTab === tab ? "#111111" : "#d4d4d8"}`,
              cursor: "pointer",
            }}
          >
            {SIDE_CONSOLE_TAB_LABELS[tab]}
          </button>
        ))}
      </div>
      <div
        aria-live="polite"
        role="status"
        style={{
          marginTop: "10px",
          borderRadius: "10px",
          border: "1px solid rgba(148, 163, 184, 0.45)",
          background: "rgba(15, 23, 42, 0.92)",
          boxShadow: "0 10px 24px rgba(2, 6, 23, 0.45)",
          padding: "8px 10px",
        }}
      >
        <div
          style={{
            fontSize: "10px",
            color: "#94a3b8",
            letterSpacing: "0.05em",
            textTransform: "uppercase",
            marginBottom: "2px",
          }}
        >
          Hover Help
        </div>
        <div style={{ fontSize: "12px", lineHeight: 1.35, color: "#e2e8f0" }}>{hoverHelpText}</div>
      </div>

      {activeSideConsoleTab === "exports" && (
        <>
          <div style={{ marginTop: "16px", fontSize: "12px", color: "#6b7280" }}>Exports</div>
          <button
            type="button"
            style={{
              marginTop: "8px",
              width: "100%",
              padding: "8px 10px",
              background: "#111111",
              color: "#ffffff",
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
          <button
            type="button"
            style={{
              marginTop: "8px",
              width: "100%",
              padding: "8px 10px",
              background: "#7c3aed",
              color: "#ffffff",
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
              color: "#ffffff",
              border: "1px solid #115e59",
              cursor: "pointer",
            }}
            onClick={handleLoadTransfer}
          >
            Load Transfer JSON
          </button>
        </>
      )}

      {activeSideConsoleTab === "data" && (
        <>
          <div style={{ marginTop: "16px", fontSize: "12px", color: "#6b7280" }}>Pose Data</div>
          <textarea
            value={poseDataText}
            readOnly
            style={{
              marginTop: "8px",
              width: "100%",
              minHeight: "320px",
              resize: "vertical",
              background: "#ffffff",
              color: "#111111",
              border: "1px solid #d4d4d8",
              padding: "6px",
              fontFamily: "inherit",
              fontSize: "11px",
            }}
          />
        </>
      )}

      {activeSideConsoleTab === "performance" && (
        <>
          <div style={{ marginTop: "16px", fontSize: "12px", color: "#6b7280" }}>
            Runtime Diagnostics
          </div>
          <div
            style={{
              marginTop: "8px",
              border: "1px solid #e5e7eb",
              borderRadius: "8px",
              padding: "8px",
              background: "#fafafa",
              fontSize: "11px",
              lineHeight: 1.6,
              color: "#111827",
            }}
          >
            <div>mode: {rig.state.mode}</div>
            <div>solve mode: {rig.state.ikSolveMode}</div>
            <div>solver: {rig.state.ikSolver}</div>
            <div>iterations: {rig.state.diagnostics.iterations}</div>
            <div>residual: {rig.state.diagnostics.residual.toFixed(3)}</div>
            <div>solve ms: {rig.state.diagnostics.solveMs.toFixed(2)}</div>
            <div>chains solved: {rig.state.diagnostics.chainsSolved}</div>
            <div>global passes: {rig.state.diagnostics.globalPasses}</div>
          </div>
          <div style={{ marginTop: "10px", fontSize: "11px", color: "#6b7280" }}>
            Constraint quick toggles
          </div>
          <div style={{ marginTop: "6px", display: "grid", gap: "6px" }}>
            <label style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "11px", color: "#4b5563" }}>
              <input
                type="checkbox"
                checked={rig.state.ikStretchEnabled}
                onChange={(event) => rig.setIkStretchEnabled(event.target.checked)}
              />
              IK stretch
            </label>
            <label style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "11px", color: "#4b5563" }}>
              <input
                type="checkbox"
                checked={rig.state.constraintSettings.ikFrictionOff}
                onChange={(event) =>
                  rig.setConstraintSettings({ ikFrictionOff: event.target.checked })
                }
              />
              IK friction off
            </label>
            <label style={{ display: "flex", gap: "8px", alignItems: "center", fontSize: "11px", color: "#4b5563" }}>
              <input
                type="checkbox"
                checked={rig.state.constraintSettings.clampGroundedIkTargetReach}
                onChange={(event) =>
                  rig.setConstraintSettings({
                    clampGroundedIkTargetReach: event.target.checked,
                  })
                }
              />
              Clamp grounded IK reach
            </label>
          </div>
        </>
      )}

      {transferStatus && (
        <div style={{ marginTop: "12px", fontSize: "11px", color: "#4b5563" }}>
          {transferStatus}
        </div>
      )}
    </aside>
  );
  const modelContent = (
    <>
      <div style={{ marginTop: "6px", fontSize: "12px", color: "#6b7280" }}>Mode</div>
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
          <option key={`model-joint-${jointId}`} value={jointId}>
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

      {isFkMode && (
        <>
          <div style={{ marginTop: "12px", fontSize: "12px", color: "#6b7280" }}>Joint Rotation (FK)</div>
          <input
            type="range"
            min={0}
            max={361}
            step={1}
            style={{ width: "100%", accentColor: "#7c3aed" }}
            value={normalizedRotation}
            onChange={(event) => setFkRotationWithMirror(selectedJointId, Number(event.target.value))}
            disabled={!selectedJointEnabled}
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
            disabled={!selectedJointEnabled}
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
                  cursor: selectedJointEnabled ? "pointer" : "not-allowed",
                  opacity: selectedJointEnabled ? 1 : 0.6,
                  fontSize: "11px",
                }}
                disabled={!selectedJointEnabled}
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
        </>
      )}

      {isIkMode && (
        <>
          <div style={{ marginTop: "12px", fontSize: "12px", color: "#6b7280" }}>IK Quick Controls</div>
          <div style={{ marginTop: "4px", fontSize: "10px", color: "#4b5563" }}>
            Drag target handles on canvas first. Use numbers only for precision.
          </div>
          <div style={{ marginTop: "8px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
            <input
              type="number"
              style={{ background: "#ffffff", color: "#111111", border: "1px solid #d4d4d8", padding: "6px" }}
              value={selectedTargetInputX}
              onChange={(event) => setSelectedTarget(Number(event.target.value), selectedTargetInputY)}
              onKeyDown={(event) =>
                handleNegativeToggleKey(event, selectedTargetInputX, (next) =>
                  setSelectedTarget(next, selectedTargetInputY)
                )
              }
              disabled={!selectedJointEnabled}
              aria-label="IK target X"
            />
            <input
              type="number"
              style={{ background: "#ffffff", color: "#111111", border: "1px solid #d4d4d8", padding: "6px" }}
              value={selectedTargetInputY}
              onChange={(event) => setSelectedTarget(selectedTargetInputX, Number(event.target.value))}
              onKeyDown={(event) =>
                handleNegativeToggleKey(event, selectedTargetInputY, (next) =>
                  setSelectedTarget(selectedTargetInputX, next)
                )
              }
              disabled={!selectedJointEnabled}
              aria-label="IK target Y"
            />
          </div>
          <div style={{ marginTop: "6px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
            <button
              type="button"
              style={{
                padding: "6px 8px",
                background: "#f4f4f5",
                color: "#111111",
                border: "1px solid #d4d4d8",
                cursor: selectedJointEnabled ? "pointer" : "not-allowed",
                opacity: selectedJointEnabled ? 1 : 0.6,
                fontSize: "11px",
              }}
              onClick={() => setSelectedTarget(selectedJointWorldPosition.x, selectedJointWorldPosition.y)}
              disabled={!selectedJointEnabled}
            >
              Set To Joint
            </button>
            <button
              type="button"
              style={{
                padding: "6px 8px",
                background: "#f4f4f5",
                color: "#111111",
                border: "1px solid #d4d4d8",
                cursor: selectedJointEnabled ? "pointer" : "not-allowed",
                opacity: selectedJointEnabled ? 1 : 0.6,
                fontSize: "11px",
              }}
              onClick={clearSelectedTarget}
              disabled={!selectedJointEnabled}
            >
              Clear Target
            </button>
          </div>
          {selectedPoleJointId && (
            <>
              <div style={{ marginTop: "8px", fontSize: "11px", color: "#6b7280" }}>
                Pole ({formatJointLabel(selectedPoleJointId)})
              </div>
              <div style={{ marginTop: "6px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
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
                  disabled={!selectedJointEnabled}
                  aria-label="IK pole X"
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
                  disabled={!selectedJointEnabled}
                  aria-label="IK pole Y"
                />
              </div>
              <div style={{ marginTop: "6px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                <button
                  type="button"
                  style={{
                    padding: "6px 8px",
                    background: "#f4f4f5",
                    color: "#111111",
                    border: "1px solid #d4d4d8",
                    cursor: selectedJointEnabled ? "pointer" : "not-allowed",
                    opacity: selectedJointEnabled ? 1 : 0.6,
                    fontSize: "11px",
                  }}
                  onClick={() =>
                    selectedPoleWorldPosition && setSelectedPoleTarget(selectedPoleWorldPosition.x, selectedPoleWorldPosition.y)
                  }
                  disabled={!selectedJointEnabled || !selectedPoleWorldPosition}
                >
                  Set Pole To Joint
                </button>
                <button
                  type="button"
                  style={{
                    padding: "6px 8px",
                    background: "#f4f4f5",
                    color: "#111111",
                    border: "1px solid #d4d4d8",
                    cursor: selectedJointEnabled ? "pointer" : "not-allowed",
                    opacity: selectedJointEnabled ? 1 : 0.6,
                    fontSize: "11px",
                  }}
                  onClick={clearSelectedPoleTarget}
                  disabled={!selectedJointEnabled}
                >
                  Clear Pole
                </button>
              </div>
            </>
          )}
        </>
      )}

      <div style={{ marginTop: "14px", fontSize: "12px", color: "#6b7280" }}>Skeletal-lock-Masks</div>
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

      <div style={{ marginTop: "10px", border: "1px solid #d4d4d8", borderRadius: "6px", padding: "8px", background: "#ffffff" }}>
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
        </div>
        <div style={{ marginTop: "8px", fontSize: "10px", color: "#6b7280" }}>
          Masks by piece are controlled in the mask list below with each item Hide/Show.
        </div>
    </>
  );
  const renderModuleFrame = (moduleId: ModuleId, content: React.ReactNode) => {
    const moduleState = floatingModules[moduleId];
    if (moduleState?.minimized) {
      return null;
    }
    if (!moduleState) {
      return <>{content}</>;
    }
    const left = (canvasBounds?.left ?? 0) + moduleState.x;
    const top = (canvasBounds?.top ?? 0) + moduleState.y;
    return (
      <div
        style={{
          position: "fixed",
          left,
          top,
          width: moduleState.width,
          height: moduleState.height,
          borderRadius: "10px",
          border: "1px solid #d4d4d8",
          background: "#ffffff",
          boxShadow: "0 18px 30px rgba(15, 23, 42, 0.16)",
          fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace",
          zIndex: 90,
          overflow: "hidden",
        }}
      >
        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "6px 8px",
            background: "#111111",
            color: "#ffffff",
            fontSize: "11px",
            textTransform: "uppercase",
            letterSpacing: "0.08em",
            cursor: "grab",
          }}
          onPointerDown={(event) => startModuleDrag(moduleId, event)}
        >
          <div>{moduleTitles[moduleId]}</div>
          <div style={{ display: "flex", gap: "6px" }}>
            <button
              type="button"
              style={{
                border: "none",
                background: "rgba(255,255,255,0.2)",
                color: "white",
                padding: "2px 6px",
                cursor: "pointer",
                fontSize: "10px",
              }}
              onClick={(event) => {
                event.stopPropagation();
                setModuleMinimized(moduleId, true);
              }}
            >
              Min
            </button>
            <button
              type="button"
              style={{
                border: "none",
                background: "rgba(255,255,255,0.2)",
                color: "white",
                padding: "2px 6px",
                cursor: "pointer",
                fontSize: "10px",
              }}
              onClick={(event) => {
                event.stopPropagation();
                closeModuleWindow(moduleId);
              }}
            >
              Close
            </button>
          </div>
        </div>
        <div
          style={{
            height: moduleState.height - 34,
            overflowY: "auto",
            padding: "8px",
          }}
        >
          {content}
        </div>
      </div>
    );
  };

  return (
    <div
      onMouseMoveCapture={handleHoverHelpMouseMove}
      onMouseLeave={handleHoverHelpMouseLeave}
      onFocusCapture={handleHoverHelpFocusCapture}
      onBlurCapture={handleHoverHelpBlurCapture}
      style={{
        display: "grid",
        gridTemplateColumns: showSidebar ? "320px 1fr" : "1fr",
        gap: showSidebar ? "12px" : "0",
        height: "100vh",
        background: "#ffffff",
        color: "#111111",
      }}
    >
      {showSidebar && sideConsolePanel}
      {/* eslint-disable-next-line no-constant-binary-expression */}
      {false && showSidebar && (
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
        <div
          style={{
            marginTop: "8px",
            display: "flex",
            gap: "10px",
            flexWrap: "wrap",
            alignItems: "center",
          }}
        >
          <div
            style={{
              borderRadius: "999px",
              border: `1px solid ${isFkMode ? "#a855f7" : "#0f766e"}`,
              background: isFkMode ? "rgba(167, 139, 250, 0.2)" : "rgba(16, 185, 129, 0.2)",
              padding: "4px 10px",
              fontSize: "10px",
              fontWeight: 700,
              color: "#111111",
            }}
          >
            {isFkMode ? "FK Mode" : "IK Mode"} active
          </div>
          <div style={{ fontSize: "10px", color: "#6b7280", maxWidth: "220px" }}>
            {isFkMode
              ? "Rotation + translation controls appear below so you can stay in FK."
              : "Drag IK targets and poles below to guide limbs in IK."}
          </div>
        </div>
        <div style={{ marginTop: "4px", display: "flex", gap: "8px", flexWrap: "wrap" }}>
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

        {!isModuleFloating("model") && (
          <div
            style={{
              marginTop: "12px",
              border: "1px solid #e5e7eb",
              borderRadius: "10px",
              padding: "10px",
              background: "#fafafa",
            }}
          >
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                fontSize: "12px",
                letterSpacing: "0.08em",
                textTransform: "uppercase",
                color: "#6b7280",
                cursor: "grab",
              }}
              onPointerDown={(event) => handleSidebarModulePointerDown("model", event)}
              onPointerUp={() => {
                if (moduleDragIntentRef.current?.id === "model") {
                  moduleDragIntentRef.current = null;
                }
              }}
            >
              <div>Model</div>
              <div style={{ fontSize: "10px", color: "#9ca3af" }}>Drag to float</div>
            </div>
            {modelContent}
          </div>
        )}

        <div
          style={{
            marginTop: "10px",
            display: "flex",
            gap: "6px",
            flexWrap: "wrap",
          }}
        >
          {availableSidebarTabs.map((tab) => (
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
              onPointerDown={(event) => handleSidebarModulePointerDown(tab, event)}
              onPointerUp={() => handleSidebarModulePointerUp(tab)}
            >
              {tab === "slm" ? "slm" : tab}
            </button>
          ))}
        </div>

        {(activeConsoleTab === "animation" || isModuleFloating("animation")) &&
          renderModuleFrame("animation", <AnimationPanel rig={rig} active />)}

        {(activeConsoleTab === "rig" || isModuleFloating("rig")) &&
          renderModuleFrame(
            "rig",
            <>

        {advancedRigEnabled && (
          <>
            <div style={{ marginTop: "12px", fontSize: "11px", color: "#6b7280" }}>
              IK quick setup
            </div>
            <label style={{ display: "block", marginTop: "6px", fontSize: "12px", color: "#6b7280" }}>
              IK Solve Mode
            </label>
            <select
              style={{ width: "100%", marginTop: "4px", background: "#ffffff", color: "#111111", border: "1px solid #d4d4d8", padding: "6px" }}
              value={rig.state.ikSolveMode}
              onChange={(event) => rig.setIkSolveMode(event.target.value as any)}
            >
              <option value="single_chain">Single Chain</option>
              <option value="limbs_only">Limbs Only</option>
              <option value="whole_body_graph">Pure IK (Whole Body)</option>
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

            <details style={{ marginTop: "10px", border: "1px solid #d4d4d8", borderRadius: "6px", padding: "8px", background: "#ffffff" }}>
              <summary style={{ fontSize: "11px", fontWeight: 700, color: "#374151", cursor: "pointer" }}>
                Advanced IK Engine
              </summary>
              <label style={{ display: "block", marginTop: "10px", fontSize: "12px", color: "#6b7280" }}>
                IK Solver
              </label>
              <select
                style={{ width: "100%", marginTop: "4px", background: "#ffffff", color: "#111111", border: "1px solid #d4d4d8", padding: "6px" }}
                value={rig.state.ikSolver}
                onChange={(event) => rig.setIkSolver(event.target.value as any)}
              >
                <option value="fabrik">FABRIK</option>
                <option value="ccd">CCD</option>
                <option value="hybrid">Hybrid (Experimental)</option>
              </select>

              <div style={{ marginTop: "10px", fontSize: "11px", color: "#6b7280" }}>Constraint Toggles</div>
              <div style={{ marginTop: "6px", display: "grid", gap: "6px", fontSize: "11px", color: "#4b5563" }}>
                <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <input
                    type="checkbox"
                    checked={rig.state.constraintSettings.fkFrictionOff}
                    onChange={(event) =>
                      rig.setConstraintSettings({ fkFrictionOff: event.target.checked })
                    }
                  />
                  FK friction off (free rotate/translate)
                </label>
                <label style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                  <input
                    type="checkbox"
                    checked={rig.state.constraintSettings.ikFrictionOff}
                    onChange={(event) =>
                      rig.setConstraintSettings({ ikFrictionOff: event.target.checked })
                    }
                  />
                  IK/hybrid friction off
                </label>
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
            </details>
            </>
          )}

        {advancedRigEnabled ? (
          <>
            <div style={{ marginTop: "12px", fontSize: "12px", color: "#6b7280" }}>Root Anchor</div>
        <input
          type="text"
          readOnly
          value="root anchor (x, y)"
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
          Root Y
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
              ? "X disabled: waist becomes horizontal root while Root Y stays pinned."
              : "X and Y disabled: waist is functional root and Root Y is unlocked."
            : groundRootYEnabled
              ? "Root anchor uses split midpoint X while Root Y stays pinned."
              : "Y disabled: Root Y is unlocked and follows root translation."}
        </div>
        <div style={{ marginTop: "12px", fontSize: "11px", color: "#6b7280" }}>
          {isFkMode
            ? "FK controls below keep joint rotation and translation in focus."
            : "Switch back to FK if you need those translation sliders."}
        </div>
        {isFkMode && (
          <>
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
                disabled={
                  rig.state.mode !== "FK" ||
                  !selectedJointEnabled ||
                  (selectedJointId === "root" && !groundRootXEnabled)
                }
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
                disabled={
                  rig.state.mode !== "FK" ||
                  !selectedJointEnabled ||
                  (selectedJointId === "root" && !groundRootXEnabled)
                }
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
                disabled={
                  rig.state.mode !== "FK" ||
                  !selectedJointEnabled ||
                  (selectedJointId === "root" && groundRootYEnabled)
                }
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
                disabled={
                  rig.state.mode !== "FK" ||
                  !selectedJointEnabled ||
                  (selectedJointId === "root" && groundRootYEnabled)
                }
              />
            </div>
          </>
        )}

        {isIkMode && (
          <>
            <div style={{ marginTop: "12px", fontSize: "12px", color: "#6b7280" }}>IK Target</div>
            <div style={{ marginTop: "4px", fontSize: "10px", color: "#6b7280" }}>
              Drag handles on canvas, then fine-tune numbers if needed.
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginTop: "8px" }}>
              <input
                type="number"
                style={{ background: "#ffffff", color: "#111111", border: "1px solid #d4d4d8", padding: "6px" }}
                value={selectedTargetInputX}
                onChange={(event) => setSelectedTarget(Number(event.target.value), selectedTargetInputY)}
                onKeyDown={(event) =>
                  handleNegativeToggleKey(event, selectedTargetInputX, (next) =>
                    setSelectedTarget(next, selectedTargetInputY)
                  )
                }
                disabled={rig.state.mode !== "IK" || !selectedJointEnabled}
                aria-label="IK target X"
              />
              <input
                type="number"
                style={{ background: "#ffffff", color: "#111111", border: "1px solid #d4d4d8", padding: "6px" }}
                value={selectedTargetInputY}
                onChange={(event) => setSelectedTarget(selectedTargetInputX, Number(event.target.value))}
                onKeyDown={(event) =>
                  handleNegativeToggleKey(event, selectedTargetInputY, (next) =>
                    setSelectedTarget(selectedTargetInputX, next)
                  )
                }
                disabled={rig.state.mode !== "IK" || !selectedJointEnabled}
                aria-label="IK target Y"
              />
            </div>
            <div style={{ marginTop: "8px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
              <button
                type="button"
                style={{
                  padding: "6px 8px",
                  background: "#f4f4f5",
                  color: "#111111",
                  border: "1px solid #d4d4d8",
                  cursor: selectedJointEnabled ? "pointer" : "not-allowed",
                  opacity: selectedJointEnabled ? 1 : 0.6,
                }}
                onClick={() => setSelectedTarget(selectedJointWorldPosition.x, selectedJointWorldPosition.y)}
                disabled={!selectedJointEnabled}
              >
                Set To Joint
              </button>
              <button
                type="button"
                style={{
                  padding: "6px 8px",
                  background: "#f4f4f5",
                  color: "#111111",
                  border: "1px solid #d4d4d8",
                  cursor: selectedJointEnabled ? "pointer" : "not-allowed",
                  opacity: selectedJointEnabled ? 1 : 0.6,
                }}
                onClick={clearSelectedTarget}
                disabled={!selectedJointEnabled}
              >
                Clear Target
              </button>
            </div>
            {selectedPoleJointId && (
              <>
                <div style={{ marginTop: "10px", fontSize: "11px", color: "#6b7280" }}>
                  Pole Target ({formatJointLabel(selectedPoleJointId)})
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
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
                    aria-label="IK pole X"
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
                    aria-label="IK pole Y"
                  />
                </div>
                <div style={{ marginTop: "8px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                  <button
                    type="button"
                    style={{
                      padding: "6px 8px",
                      background: "#f4f4f5",
                      color: "#111111",
                      border: "1px solid #d4d4d8",
                      cursor: selectedJointEnabled ? "pointer" : "not-allowed",
                      opacity: selectedJointEnabled ? 1 : 0.6,
                    }}
                    onClick={() => selectedPoleWorldPosition && setSelectedPoleTarget(selectedPoleWorldPosition.x, selectedPoleWorldPosition.y)}
                    disabled={!selectedJointEnabled || !selectedPoleWorldPosition}
                  >
                    Set To Joint
                  </button>
                  <button
                    type="button"
                    style={{
                      padding: "6px 8px",
                      background: "#f4f4f5",
                      color: "#111111",
                      border: "1px solid #d4d4d8",
                      cursor: selectedJointEnabled ? "pointer" : "not-allowed",
                      opacity: selectedJointEnabled ? 1 : 0.6,
                    }}
                    onClick={clearSelectedPoleTarget}
                    disabled={!selectedJointEnabled}
                  >
                    Clear Pole
                  </button>
                </div>
              </>
            )}
          </>
        )}

        <div style={{ marginTop: "12px", fontSize: "12px", color: "#6b7280" }}>Pin Mode</div>
        <div style={{ marginTop: "6px", display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "6px" }}>
          {(["none", "world", "ground"] as const).map((mode) => {
            const active = selectedPinMode === mode;
            return (
              <button
                key={`pin-mode-${mode}`}
                type="button"
                style={{
                  padding: "8px 6px",
                  textTransform: "capitalize",
                  background: active ? "#7c3aed" : "#f4f4f5",
                  color: active ? "white" : "#111111",
                  border: `1px solid ${active ? "#5b21b6" : "#d4d4d8"}`,
                  cursor: selectedJointEnabled ? "pointer" : "not-allowed",
                  opacity: selectedJointEnabled ? 1 : 0.6,
                }}
                onClick={() => setSelectedPinMode(mode)}
                disabled={!selectedJointEnabled}
              >
                {mode}
              </button>
            );
          })}
        </div>

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

        {isModuleFloating("model") && renderModuleFrame("model", modelContent)}

        {(activeConsoleTab === "camera" || isModuleFloating("camera")) &&
          renderModuleFrame(
            "camera",
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

        {(activeConsoleTab === "data" || isModuleFloating("data")) &&
          renderModuleFrame(
            "data",
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

        {(activeConsoleTab === "slm" || isModuleFloating("slm")) &&
          renderModuleFrame(
            "slm",
            <>
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
          Root anchor tracks the feet split midpoint when X is enabled; disabling X shifts horizontal root behavior to the waist. Root Y toggle controls vertical pinning (on = pinned, off = unlocked).
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


      <main
        ref={mainCanvasRef}
        style={{ minWidth: 0, height: "100%", overflow: "hidden", position: "relative" }}
      >
        <div
          style={{
            position: "absolute",
            top: "12px",
            left: "12px",
            zIndex: 60,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-start",
            gap: "8px",
            width: "calc(100% - 24px)",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: "6px",
              padding: "6px",
              borderRadius: "12px",
              border: "1px solid rgba(255,255,255,0.24)",
              background: "rgba(15, 23, 42, 0.84)",
              backdropFilter: "blur(8px)",
            }}
          >
            {CANVAS_WORKFLOW_ORDER.map((mode, index) => {
              const active = activeCanvasWorkflow === mode;
              const menuOpen = canvasMenuOpen[mode];
              const accent = CANVAS_WORKFLOW_ACCENTS[mode];
              return (
                <button
                  key={`workflow-${mode}`}
                  type="button"
                  onClick={() => handleCanvasWorkflowButtonClick(mode)}
                  aria-pressed={menuOpen}
                  title={`${CANVAS_WORKFLOW_DESCRIPTIONS[mode]} (${index + 1})`}
                  style={{
                    padding: "6px 10px",
                    borderRadius: "999px",
                    border: `1px solid ${
                      active || menuOpen ? accent : "rgba(255,255,255,0.2)"
                    }`,
                    background:
                      active
                        ? accent
                        : menuOpen
                          ? "rgba(31, 41, 55, 0.92)"
                          : "rgba(17, 24, 39, 0.78)",
                    color: "#f9fafb",
                    fontSize: "11px",
                    fontWeight: 700,
                    letterSpacing: "0.01em",
                    cursor: "pointer",
                    minWidth: "62px",
                  }}
                >
                  {CANVAS_WORKFLOW_LABELS[mode]}
                  {menuOpen ? " *" : ""}
                </button>
              );
            })}
          </div>
          <div style={{ display: "flex", gap: "6px", alignItems: "center", flexWrap: "wrap" }}>
            <button
              type="button"
              onClick={() =>
                setCanvasUxPreset((prev) =>
                  prev === "focus" ? "balanced" : prev === "balanced" ? "full" : "focus"
                )
              }
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
              title="Cycle canvas view density."
            >
              View:{" "}
              {canvasUxPreset === "focus"
                ? "Focus"
                : canvasUxPreset === "balanced"
                  ? "Balanced"
                  : "Full"}
            </button>
            <button
              type="button"
              onClick={cycleWheelLayers}
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
              title="Cycle wheel rings."
            >
              Rings: {activeWheelLayers}
            </button>
            <button
              type="button"
              onClick={() =>
                setCanvasUxPreset((prev) => (prev === "focus" ? "balanced" : "focus"))
              }
              style={{
                padding: "6px 8px",
                borderRadius: "8px",
                border: "1px solid rgba(255,255,255,0.25)",
                background: showSidebar ? "rgba(20, 184, 166, 0.82)" : "rgba(17, 24, 39, 0.78)",
                color: "#f9fafb",
                fontSize: "11px",
                cursor: "pointer",
                backdropFilter: "blur(6px)",
              }}
              title="Toggle full console sidebar."
            >
              Console: {showSidebar ? "On" : "Off"}
            </button>
            <div
              style={{
                padding: "6px 10px",
                borderRadius: "8px",
                border: "1px solid rgba(255,255,255,0.2)",
                background: "rgba(17, 24, 39, 0.6)",
                color: "#cbd5e1",
                fontSize: "10px",
                letterSpacing: "0.03em",
                textTransform: "uppercase",
              }}
            >
              {CANVAS_WORKFLOW_DESCRIPTIONS[activeCanvasWorkflow]}
              {activeCanvasWorkflow === "play" ? ` (${jumpPhase})` : ""}
            </div>
            {rig.state.mode === "IK" && ikStickyTargetJointId && (
              <button
                type="button"
                onClick={clearIkStickyTarget}
                style={{
                  padding: "6px 10px",
                  borderRadius: "8px",
                  border: "1px solid rgba(16, 185, 129, 0.7)",
                  background: "rgba(6, 95, 70, 0.86)",
                  color: "#ecfdf5",
                  fontSize: "10px",
                  letterSpacing: "0.02em",
                  textTransform: "uppercase",
                  cursor: "pointer",
                }}
                title="Sticky IK active. Double-click the same joint/target or press Escape to stop."
              >
                Sticky IK: {formatJointLabel(ikStickyTargetJointId)} (Esc)
              </button>
            )}
          </div>
          {anyCanvasMenuOpen && (
            <div
              style={{
                display: "grid",
                gap: "8px",
                alignSelf: "flex-end",
                width: "min(380px, calc(100vw - 36px))",
                maxHeight: "calc(100vh - 180px)",
                overflowY: "auto",
                paddingRight: "2px",
              }}
            >
            {canvasMenuOpen.pose && (
              <div
                style={{
                  display: "grid",
                  gap: "8px",
                  padding: "8px",
                  borderRadius: "10px",
                  border: "1px solid rgba(37, 99, 235, 0.45)",
                  background: "rgba(15, 23, 42, 0.82)",
                  backdropFilter: "blur(6px)",
                }}
              >
                <div
                  style={{
                    fontSize: "10px",
                    color: "#bfdbfe",
                    textTransform: "uppercase",
                    letterSpacing: "0.05em",
                  }}
                >
                  Pose Canvas Menu
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                  <button
                    type="button"
                    onClick={() => rig.setMode("FK")}
                    style={{
                      padding: "6px 8px",
                      borderRadius: "8px",
                      border: `1px solid ${rig.state.mode === "FK" ? "rgba(167, 139, 250, 0.9)" : "rgba(255,255,255,0.25)"}`,
                      background: rig.state.mode === "FK" ? "rgba(109, 40, 217, 0.88)" : "rgba(30, 41, 59, 0.88)",
                      color: "#f9fafb",
                      fontSize: "11px",
                      cursor: "pointer",
                    }}
                  >
                    FK
                  </button>
                  <button
                    type="button"
                    onClick={() => rig.setMode("IK")}
                    style={{
                      padding: "6px 8px",
                      borderRadius: "8px",
                      border: `1px solid ${rig.state.mode === "IK" ? "rgba(20, 184, 166, 0.9)" : "rgba(255,255,255,0.25)"}`,
                      background: rig.state.mode === "IK" ? "rgba(15, 118, 110, 0.9)" : "rgba(30, 41, 59, 0.88)",
                      color: "#f9fafb",
                      fontSize: "11px",
                      cursor: "pointer",
                    }}
                  >
                    IK
                  </button>
                </div>
                <select
                  value={selectedJointId}
                  onChange={(event) => rig.selectJoint(event.target.value as JointId)}
                  style={{
                    width: "100%",
                    padding: "6px 8px",
                    borderRadius: "8px",
                    border: "1px solid rgba(255,255,255,0.25)",
                    background: "rgba(30, 41, 59, 0.9)",
                    color: "#f9fafb",
                    fontSize: "11px",
                  }}
                >
                  {JOINT_IDS.map((jointId) => (
                    <option key={`canvas-pose-joint-${jointId}`} value={jointId}>
                      {formatJointLabel(jointId)}
                    </option>
                  ))}
                </select>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                  <input
                    type="number"
                    value={wheelXValue}
                    onChange={(event) => handleWheelXChange(Number(event.target.value))}
                    style={{
                      background: "rgba(30, 41, 59, 0.9)",
                      color: "#f9fafb",
                      border: "1px solid rgba(255,255,255,0.25)",
                      borderRadius: "8px",
                      padding: "6px",
                    }}
                    aria-label="Pose X"
                  />
                  <input
                    type="number"
                    value={wheelYValue}
                    onChange={(event) => handleWheelYChange(Number(event.target.value))}
                    style={{
                      background: "rgba(30, 41, 59, 0.9)",
                      color: "#f9fafb",
                      border: "1px solid rgba(255,255,255,0.25)",
                      borderRadius: "8px",
                      padding: "6px",
                    }}
                    aria-label="Pose Y"
                  />
                </div>
                <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                  <label style={{ display: "flex", gap: "6px", alignItems: "center", fontSize: "11px", color: "#dbeafe" }}>
                    <input
                      type="checkbox"
                      checked={mirrorControlsEnabled}
                      onChange={(event) => setMirrorControlsEnabled(event.target.checked)}
                    />
                    Mirror
                  </label>
                  <label style={{ display: "flex", gap: "6px", alignItems: "center", fontSize: "11px", color: "#dbeafe" }}>
                    <input
                      type="checkbox"
                      checked={primitiveTurnoverEnabled}
                      onChange={(event) => setPrimitiveTurnoverEnabled(event.target.checked)}
                    />
                    Turnover
                  </label>
                </div>
              </div>
            )}
            {canvasMenuOpen.compose && (
            <div
              style={{
                display: "flex",
                gap: "6px",
                alignItems: "center",
                flexWrap: "wrap",
                padding: "6px",
                borderRadius: "10px",
                border: "1px solid rgba(194, 65, 12, 0.45)",
                background: "rgba(15, 23, 42, 0.82)",
                backdropFilter: "blur(6px)",
              }}
            >
              <div
                style={{
                  fontSize: "10px",
                  color: "#d1d5db",
                  textTransform: "uppercase",
                  letterSpacing: "0.04em",
                }}
              >
                Active Mask
              </div>
              {rig.state.overlays.length === 0 ? (
                <div style={{ fontSize: "10px", color: "#94a3b8" }}>
                  No overlays loaded
                </div>
              ) : (
                <>
                  <button
                    type="button"
                    onClick={() => cycleActiveOverlay("prev")}
                    style={{
                      padding: "6px 8px",
                      borderRadius: "8px",
                      border: "1px solid rgba(255,255,255,0.25)",
                      background: "rgba(30, 41, 59, 0.9)",
                      color: "#f9fafb",
                      fontSize: "11px",
                      cursor: "pointer",
                    }}
                    title="Previous overlay"
                  >
                    Prev
                  </button>
                  <select
                    value={activeOverlayId ?? ""}
                    onChange={(event) => setActiveOverlayId(event.target.value || null)}
                    style={{
                      minWidth: "180px",
                      padding: "6px 8px",
                      borderRadius: "8px",
                      border: "1px solid rgba(255,255,255,0.25)",
                      background: "rgba(30, 41, 59, 0.9)",
                      color: "#f9fafb",
                      fontSize: "11px",
                    }}
                    title="Select active overlay"
                  >
                    {rig.state.overlays.map((overlay, index) => (
                      <option key={`canvas-overlay-${overlay.id}`} value={overlay.id}>
                        {index + 1}. {overlay.name}
                        {overlay.visible ? "" : " (hidden)"}
                      </option>
                    ))}
                  </select>
                  <button
                    type="button"
                    onClick={() => cycleActiveOverlay("next")}
                    style={{
                      padding: "6px 8px",
                      borderRadius: "8px",
                      border: "1px solid rgba(255,255,255,0.25)",
                      background: "rgba(30, 41, 59, 0.9)",
                      color: "#f9fafb",
                      fontSize: "11px",
                      cursor: "pointer",
                    }}
                    title="Next overlay"
                  >
                    Next
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      if (!activeOverlay) {
                        return;
                      }
                      rig.updateOverlay(activeOverlay.id, { visible: !activeOverlay.visible });
                      setOverlayStatus(
                        `${activeOverlay.name} ${activeOverlay.visible ? "hidden" : "visible"}.`
                      );
                    }}
                    style={{
                      padding: "6px 8px",
                      borderRadius: "8px",
                      border: "1px solid rgba(255,255,255,0.25)",
                      background: activeOverlay?.visible ? "rgba(124, 58, 237, 0.88)" : "rgba(75, 85, 99, 0.88)",
                      color: "#f9fafb",
                      fontSize: "11px",
                      cursor: "pointer",
                    }}
                    title="Toggle overlay visibility"
                  >
                    {activeOverlay?.visible ? "Hide" : "Show"}
                  </button>
                </>
              )}
            </div>
          )}
          {canvasMenuOpen.ik && (
            <div
              style={{
                display: "grid",
                gap: "8px",
                padding: "8px",
                borderRadius: "10px",
                border: "1px solid rgba(15, 118, 110, 0.45)",
                background: "rgba(15, 23, 42, 0.82)",
                backdropFilter: "blur(6px)",
                alignSelf: "flex-end",
                width: "min(360px, calc(100vw - 36px))",
                maxHeight: "calc(100vh - 180px)",
                overflowY: "auto",
              }}
            >
              <div
                style={{
                  fontSize: "10px",
                  color: "#d1fae5",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                IK Canvas Controls
              </div>
              <details
                style={{
                  borderRadius: "8px",
                  border: "1px solid rgba(56, 189, 248, 0.45)",
                  background: "rgba(2, 132, 199, 0.14)",
                  padding: "6px 8px",
                  color: "#e0f2fe",
                }}
              >
                <summary
                  style={{
                    cursor: "pointer",
                    fontSize: "11px",
                    fontWeight: 700,
                    letterSpacing: "0.01em",
                    color: "#bae6fd",
                  }}
                >
                  Help Menu: IK Depth
                </summary>
                <div style={{ marginTop: "6px", display: "grid", gap: "4px", fontSize: "10px", color: "#e2e8f0" }}>
                  <div>
                    Depth is visual layering, not true Z physics. IK still solves in 2D (+x right, +y down).
                  </div>
                  <div>
                    Dotted connector: target to current joint. Longer lines mean stronger pull is pending.
                  </div>
                  <div>
                    In Whole solve mode, motion distributes through torso/waist, so depth overlap can shift more.
                  </div>
                  <div>
                    Use Turnover and scope filters to control what draws in front and reduce depth ambiguity.
                  </div>
                </div>
              </details>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ fontSize: "10px", color: "#9ca3af", textTransform: "uppercase" }}>Scope</div>
                {(["limb", "upper", "lower", "full"] as IkCanvasScopeMode[]).map((scopeMode) => (
                  <button
                    key={`ik-scope-${scopeMode}`}
                    type="button"
                    onClick={() => {
                      setIkCanvasScopeMode(scopeMode);
                      applyIkCanvasScope(scopeMode, ikCanvasLimbScope);
                    }}
                    style={{
                      padding: "5px 8px",
                      borderRadius: "8px",
                      border: `1px solid ${
                        ikCanvasScopeMode === scopeMode ? "rgba(20, 184, 166, 0.92)" : "rgba(255,255,255,0.25)"
                      }`,
                      background:
                        ikCanvasScopeMode === scopeMode ? "rgba(15, 118, 110, 0.9)" : "rgba(30, 41, 59, 0.88)",
                      color: "#f9fafb",
                      fontSize: "11px",
                      cursor: "pointer",
                    }}
                    title={`Focus IK controls on ${IK_CANVAS_SCOPE_LABELS[scopeMode].toLowerCase()} scope`}
                  >
                    {IK_CANVAS_SCOPE_LABELS[scopeMode]}
                  </button>
                ))}
              </div>
              {ikCanvasScopeMode === "limb" && (
                <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                  <div style={{ fontSize: "10px", color: "#9ca3af", textTransform: "uppercase" }}>Limb</div>
                  {(["l_arm", "r_arm", "l_leg", "r_leg"] as IkCanvasLimbScope[]).map((limbScope) => (
                    <button
                      key={`ik-limb-${limbScope}`}
                      type="button"
                      onClick={() => {
                        setIkCanvasLimbScope(limbScope);
                        applyIkCanvasScope("limb", limbScope);
                      }}
                      style={{
                        padding: "5px 8px",
                        borderRadius: "8px",
                        border: `1px solid ${
                          ikCanvasLimbScope === limbScope ? "rgba(59, 130, 246, 0.9)" : "rgba(255,255,255,0.25)"
                        }`,
                        background:
                          ikCanvasLimbScope === limbScope ? "rgba(30, 64, 175, 0.9)" : "rgba(30, 41, 59, 0.88)",
                        color: "#f9fafb",
                        fontSize: "11px",
                        cursor: "pointer",
                      }}
                    >
                      {IK_CANVAS_LIMB_LABELS[limbScope]}
                    </button>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: "10px", flexWrap: "wrap", alignItems: "center" }}>
                <label style={{ display: "flex", gap: "6px", alignItems: "center", fontSize: "11px", color: "#d1d5db" }}>
                  <input
                    type="checkbox"
                    checked={ikCanvasIsolateScope}
                    onChange={(event) => setIkCanvasIsolateScope(event.target.checked)}
                  />
                  Isolate scope joints
                </label>
                <label style={{ display: "flex", gap: "6px", alignItems: "center", fontSize: "11px", color: "#d1d5db" }}>
                  <input
                    type="checkbox"
                    checked={ikCanvasHideNonScope}
                    onChange={(event) => setIkCanvasHideNonScope(event.target.checked)}
                  />
                  Hide non-scope bones
                </label>
                <label style={{ display: "flex", gap: "6px", alignItems: "center", fontSize: "11px", color: "#d1d5db" }}>
                  <input
                    type="checkbox"
                    checked={ikCanvasAutoActivateTargets}
                    onChange={(event) => setIkCanvasAutoActivateTargets(event.target.checked)}
                  />
                  Auto-activate targets
                </label>
              </div>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => applyIkCanvasScope()}
                  style={{
                    padding: "6px 10px",
                    borderRadius: "8px",
                    border: "1px solid rgba(20, 184, 166, 0.85)",
                    background: "rgba(15, 118, 110, 0.9)",
                    color: "#f9fafb",
                    fontSize: "11px",
                    cursor: "pointer",
                  }}
                >
                  Apply Scope
                </button>
                <button
                  type="button"
                  onClick={() => {
                    activateIkTargetsForScope(ikCanvasScopeMode, ikCanvasLimbScope);
                  }}
                  style={{
                    padding: "6px 10px",
                    borderRadius: "8px",
                    border: "1px solid rgba(96, 165, 250, 0.75)",
                    background: "rgba(30, 64, 175, 0.86)",
                    color: "#f9fafb",
                    fontSize: "11px",
                    cursor: "pointer",
                  }}
                >
                  Activate Scope Targets
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAllJointsEnabled(true);
                    setAllJointVisibility(true);
                    setAllSkeletonVisibility(true);
                  }}
                  style={{
                    padding: "6px 10px",
                    borderRadius: "8px",
                    border: "1px solid rgba(255,255,255,0.3)",
                    background: "rgba(55, 65, 81, 0.88)",
                    color: "#f9fafb",
                    fontSize: "11px",
                    cursor: "pointer",
                  }}
                >
                  Reset Scope Filters
                </button>
              </div>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ fontSize: "10px", color: "#9ca3af", textTransform: "uppercase" }}>Solve Mode</div>
                {([
                  { id: "single_chain", label: "Single" },
                  { id: "limbs_only", label: "Limbs" },
                  { id: "whole_body_graph", label: "Whole" },
                ] as const).map((entry) => (
                  <button
                    key={`ik-solve-${entry.id}`}
                    type="button"
                    onClick={() => rig.setIkSolveMode(entry.id)}
                    style={{
                      padding: "5px 8px",
                      borderRadius: "8px",
                      border: `1px solid ${
                        rig.state.ikSolveMode === entry.id ? "rgba(52, 211, 153, 0.9)" : "rgba(255,255,255,0.25)"
                      }`,
                      background:
                        rig.state.ikSolveMode === entry.id ? "rgba(6, 95, 70, 0.9)" : "rgba(30, 41, 59, 0.88)",
                      color: "#f9fafb",
                      fontSize: "11px",
                      cursor: "pointer",
                    }}
                  >
                    {entry.label}
                  </button>
                ))}
                <div style={{ fontSize: "10px", color: "#9ca3af", textTransform: "uppercase", marginLeft: "8px" }}>
                  Solver
                </div>
                {([
                  { id: "fabrik", label: "FABRIK" },
                  { id: "ccd", label: "CCD" },
                  { id: "hybrid", label: "Hybrid*" },
                ] as const).map((entry) => (
                  <button
                    key={`ik-solver-${entry.id}`}
                    type="button"
                    onClick={() => rig.setIkSolver(entry.id)}
                    style={{
                      padding: "5px 8px",
                      borderRadius: "8px",
                      border: `1px solid ${
                        rig.state.ikSolver === entry.id ? "rgba(129, 140, 248, 0.9)" : "rgba(255,255,255,0.25)"
                      }`,
                      background:
                        rig.state.ikSolver === entry.id ? "rgba(67, 56, 202, 0.88)" : "rgba(30, 41, 59, 0.88)",
                      color: "#f9fafb",
                      fontSize: "11px",
                      cursor: "pointer",
                    }}
                    title={entry.id === "hybrid" ? "Hybrid is experimental." : undefined}
                  >
                    {entry.label}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                <button
                  type="button"
                  onClick={() => rig.setIkStretchEnabled(!rig.state.ikStretchEnabled)}
                  style={{
                    padding: "5px 8px",
                    borderRadius: "8px",
                    border: `1px solid ${
                      rig.state.ikStretchEnabled ? "rgba(34, 197, 94, 0.9)" : "rgba(255,255,255,0.25)"
                    }`,
                    background: rig.state.ikStretchEnabled ? "rgba(21, 128, 61, 0.88)" : "rgba(30, 41, 59, 0.88)",
                    color: "#f9fafb",
                    fontSize: "11px",
                    cursor: "pointer",
                  }}
                >
                  Stretch
                </button>
                <button
                  type="button"
                  onClick={() =>
                    rig.setConstraintSettings({
                      ikFrictionOff: !rig.state.constraintSettings.ikFrictionOff,
                    })
                  }
                  style={{
                    padding: "5px 8px",
                    borderRadius: "8px",
                    border: `1px solid ${
                      rig.state.constraintSettings.ikFrictionOff
                        ? "rgba(248, 113, 113, 0.9)"
                        : "rgba(255,255,255,0.25)"
                    }`,
                    background: rig.state.constraintSettings.ikFrictionOff
                      ? "rgba(153, 27, 27, 0.88)"
                      : "rgba(30, 41, 59, 0.88)",
                    color: "#f9fafb",
                    fontSize: "11px",
                    cursor: "pointer",
                  }}
                >
                  IK Friction Off
                </button>
                <button
                  type="button"
                  onClick={() =>
                    rig.setConstraintSettings({
                      clampGroundedIkTargetReach: !rig.state.constraintSettings.clampGroundedIkTargetReach,
                    })
                  }
                  style={{
                    padding: "5px 8px",
                    borderRadius: "8px",
                    border: `1px solid ${
                      rig.state.constraintSettings.clampGroundedIkTargetReach
                        ? "rgba(45, 212, 191, 0.9)"
                        : "rgba(255,255,255,0.25)"
                    }`,
                    background: rig.state.constraintSettings.clampGroundedIkTargetReach
                      ? "rgba(13, 148, 136, 0.88)"
                      : "rgba(30, 41, 59, 0.88)",
                    color: "#f9fafb",
                    fontSize: "11px",
                    cursor: "pointer",
                  }}
                >
                  Grounded Reach Clamp
                </button>
                <button
                  type="button"
                  onClick={() =>
                    rig.setConstraintSettings({
                      enforceRootWaistLock: !rig.state.constraintSettings.enforceRootWaistLock,
                    })
                  }
                  style={{
                    padding: "5px 8px",
                    borderRadius: "8px",
                    border: `1px solid ${
                      rig.state.constraintSettings.enforceRootWaistLock
                        ? "rgba(52, 211, 153, 0.9)"
                        : "rgba(255,255,255,0.25)"
                    }`,
                    background: rig.state.constraintSettings.enforceRootWaistLock
                      ? "rgba(6, 95, 70, 0.88)"
                      : "rgba(30, 41, 59, 0.88)",
                    color: "#f9fafb",
                    fontSize: "11px",
                    cursor: "pointer",
                  }}
                >
                  Root/Waist Lock
                </button>
                <button
                  type="button"
                  onClick={() =>
                    rig.setConstraintSettings({
                      allowKneeLiftWhenBothAnklesPinned:
                        !rig.state.constraintSettings.allowKneeLiftWhenBothAnklesPinned,
                    })
                  }
                  style={{
                    padding: "5px 8px",
                    borderRadius: "8px",
                    border: `1px solid ${
                      rig.state.constraintSettings.allowKneeLiftWhenBothAnklesPinned
                        ? "rgba(251, 191, 36, 0.9)"
                        : "rgba(255,255,255,0.25)"
                    }`,
                    background: rig.state.constraintSettings.allowKneeLiftWhenBothAnklesPinned
                      ? "rgba(180, 83, 9, 0.88)"
                      : "rgba(30, 41, 59, 0.88)",
                    color: "#f9fafb",
                    fontSize: "11px",
                    cursor: "pointer",
                  }}
                >
                  Dual-Ankle Knee Lift
                </button>
                <button
                  type="button"
                  onClick={() =>
                    rig.setConstraintSettings({
                      lockGroundedAnklesX: !rig.state.constraintSettings.lockGroundedAnklesX,
                    })
                  }
                  style={{
                    padding: "5px 8px",
                    borderRadius: "8px",
                    border: `1px solid ${
                      rig.state.constraintSettings.lockGroundedAnklesX
                        ? "rgba(147, 197, 253, 0.9)"
                        : "rgba(255,255,255,0.25)"
                    }`,
                    background: rig.state.constraintSettings.lockGroundedAnklesX
                      ? "rgba(30, 64, 175, 0.88)"
                      : "rgba(30, 41, 59, 0.88)",
                    color: "#f9fafb",
                    fontSize: "11px",
                    cursor: "pointer",
                  }}
                >
                  Grounded Ankle X Lock
                </button>
                <button
                  type="button"
                  onClick={() =>
                    rig.setConstraintSettings({
                      releaseGroundedAnkleWhenLegLifts:
                        !rig.state.constraintSettings.releaseGroundedAnkleWhenLegLifts,
                    })
                  }
                  style={{
                    padding: "5px 8px",
                    borderRadius: "8px",
                    border: `1px solid ${
                      rig.state.constraintSettings.releaseGroundedAnkleWhenLegLifts
                        ? "rgba(196, 181, 253, 0.9)"
                        : "rgba(255,255,255,0.25)"
                    }`,
                    background: rig.state.constraintSettings.releaseGroundedAnkleWhenLegLifts
                      ? "rgba(109, 40, 217, 0.88)"
                      : "rgba(30, 41, 59, 0.88)",
                    color: "#f9fafb",
                    fontSize: "11px",
                    cursor: "pointer",
                  }}
                >
                  Release Lifted Ankle
                </button>
              </div>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap", alignItems: "center" }}>
                <div style={{ fontSize: "10px", color: "#9ca3af", textTransform: "uppercase" }}>Presets</div>
                <button
                  type="button"
                  onClick={() => applyIkCanvasPreset("precision")}
                  style={{
                    padding: "5px 8px",
                    borderRadius: "8px",
                    border: "1px solid rgba(148, 163, 184, 0.65)",
                    background: "rgba(51, 65, 85, 0.88)",
                    color: "#f9fafb",
                    fontSize: "11px",
                    cursor: "pointer",
                  }}
                >
                  Precision
                </button>
                <button
                  type="button"
                  onClick={() => applyIkCanvasPreset("grounded")}
                  style={{
                    padding: "5px 8px",
                    borderRadius: "8px",
                    border: "1px solid rgba(52, 211, 153, 0.65)",
                    background: "rgba(6, 95, 70, 0.88)",
                    color: "#f9fafb",
                    fontSize: "11px",
                    cursor: "pointer",
                  }}
                >
                  Grounded
                </button>
                <button
                  type="button"
                  onClick={() => applyIkCanvasPreset("expressive")}
                  style={{
                    padding: "5px 8px",
                    borderRadius: "8px",
                    border: "1px solid rgba(196, 181, 253, 0.65)",
                    background: "rgba(76, 29, 149, 0.88)",
                    color: "#f9fafb",
                    fontSize: "11px",
                    cursor: "pointer",
                  }}
                >
                  Expressive
                </button>
              </div>
            </div>
          )}
          {canvasMenuOpen.rotate && (
            <div
              style={{
                display: "grid",
                gap: "8px",
                padding: "8px",
                borderRadius: "10px",
                border: "1px solid rgba(124, 58, 237, 0.45)",
                background: "rgba(15, 23, 42, 0.82)",
                backdropFilter: "blur(6px)",
              }}
            >
              <div
                style={{
                  fontSize: "10px",
                  color: "#ddd6fe",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Rotate Canvas Menu
              </div>
              <button
                type="button"
                onClick={() => {
                  rig.setMode("FK");
                  setWheelPrimaryTool("rotate");
                }}
                style={{
                  padding: "6px 8px",
                  borderRadius: "8px",
                  border: "1px solid rgba(167, 139, 250, 0.85)",
                  background: "rgba(109, 40, 217, 0.88)",
                  color: "#f9fafb",
                  fontSize: "11px",
                  cursor: "pointer",
                }}
              >
                FK rotation focus
              </button>
              <input
                type="range"
                min={0}
                max={361}
                step={1}
                value={normalizedRotation}
                onChange={(event) => setFkRotationWithMirror(selectedJointId, Number(event.target.value))}
                disabled={rig.state.mode !== "FK" || !selectedJointEnabled}
                style={{ width: "100%", accentColor: "#a855f7" }}
              />
              <input
                type="number"
                value={selectedJoint.localRotationDegRaw}
                onChange={(event) => setFkRotationWithMirror(selectedJointId, Number(event.target.value))}
                onKeyDown={(event) =>
                  handleNegativeToggleKey(event, selectedJoint.localRotationDegRaw, (next) =>
                    setFkRotationWithMirror(selectedJointId, next)
                  )
                }
                disabled={rig.state.mode !== "FK" || !selectedJointEnabled}
                style={{
                  width: "100%",
                  background: "rgba(30, 41, 59, 0.9)",
                  color: "#f9fafb",
                  border: "1px solid rgba(255,255,255,0.25)",
                  borderRadius: "8px",
                  padding: "6px",
                }}
              />
              <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: "6px" }}>
                {([-12, -3, 3, 12] as const).map((delta) => (
                  <button
                    key={`canvas-rot-nudge-${delta}`}
                    type="button"
                    onClick={() =>
                      setFkRotationWithMirror(
                        selectedJointId,
                        selectedJoint.localRotationDegRaw + delta
                      )
                    }
                    disabled={rig.state.mode !== "FK" || !selectedJointEnabled}
                    style={{
                      padding: "6px 4px",
                      borderRadius: "8px",
                      border: "1px solid rgba(255,255,255,0.25)",
                      background: "rgba(30, 41, 59, 0.9)",
                      color: "#f9fafb",
                      fontSize: "11px",
                      cursor: rig.state.mode === "FK" && selectedJointEnabled ? "pointer" : "not-allowed",
                      opacity: rig.state.mode === "FK" && selectedJointEnabled ? 1 : 0.55,
                    }}
                  >
                    {delta > 0 ? `+${delta}` : delta}
                  </button>
                ))}
              </div>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() =>
                    setWheelAxisLock((prev) => (prev === "xy" ? "x" : prev === "x" ? "y" : "xy"))
                  }
                  style={{
                    padding: "6px 8px",
                    borderRadius: "8px",
                    border: "1px solid rgba(255,255,255,0.25)",
                    background: "rgba(30, 41, 59, 0.9)",
                    color: "#f9fafb",
                    fontSize: "11px",
                    cursor: "pointer",
                  }}
                >
                  Axis: {wheelAxisLock.toUpperCase()}
                </button>
                <button
                  type="button"
                  onClick={() =>
                    setWheelPrecision((prev) => (prev === "coarse" ? "fine" : "coarse"))
                  }
                  style={{
                    padding: "6px 8px",
                    borderRadius: "8px",
                    border: "1px solid rgba(255,255,255,0.25)",
                    background: "rgba(30, 41, 59, 0.9)",
                    color: "#f9fafb",
                    fontSize: "11px",
                    cursor: "pointer",
                  }}
                >
                  Precision: {wheelPrecision}
                </button>
              </div>
            </div>
          )}
          {canvasMenuOpen.play && (
            <div
              style={{
                display: "grid",
                gap: "8px",
                padding: "8px",
                borderRadius: "10px",
                border: "1px solid rgba(8, 145, 178, 0.45)",
                background: "rgba(15, 23, 42, 0.82)",
                backdropFilter: "blur(6px)",
              }}
            >
              <div
                style={{
                  fontSize: "10px",
                  color: "#bae6fd",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Play Canvas Menu
              </div>
              <div style={{ display: "flex", gap: "6px", flexWrap: "wrap" }}>
                <button
                  type="button"
                  onClick={() => applyCanvasWorkflow("play")}
                  style={{
                    padding: "6px 8px",
                    borderRadius: "8px",
                    border: "1px solid rgba(14, 116, 144, 0.85)",
                    background: "rgba(14, 116, 144, 0.88)",
                    color: "#f9fafb",
                    fontSize: "11px",
                    cursor: "pointer",
                  }}
                >
                  Activate runtime
                </button>
                <button
                  type="button"
                  onClick={() => setJumpFallEnabled((prev) => !prev)}
                  style={{
                    padding: "6px 8px",
                    borderRadius: "8px",
                    border: "1px solid rgba(255,255,255,0.25)",
                    background: jumpFallEnabled ? "rgba(3, 105, 161, 0.9)" : "rgba(30, 41, 59, 0.9)",
                    color: "#f9fafb",
                    fontSize: "11px",
                    cursor: "pointer",
                  }}
                >
                  Jump sim: {jumpFallEnabled ? "On" : "Off"}
                </button>
              </div>
              <div style={{ fontSize: "11px", color: "#cbd5e1" }}>
                phase: {jumpPhase} | mode: {rig.state.mode}
              </div>
            </div>
          )}
          {canvasMenuOpen.animation && (
            <div
              style={{
                display: "grid",
                gap: "8px",
                padding: "8px",
                borderRadius: "10px",
                border: "1px solid rgba(217, 119, 6, 0.45)",
                background: "rgba(15, 23, 42, 0.82)",
                backdropFilter: "blur(6px)",
              }}
            >
              <div
                style={{
                  fontSize: "10px",
                  color: "#fcd34d",
                  textTransform: "uppercase",
                  letterSpacing: "0.05em",
                }}
              >
                Animation Canvas Menu
              </div>
              <div
                style={{
                  border: "1px solid rgba(217, 119, 6, 0.45)",
                  borderRadius: "8px",
                  background: "rgba(15, 23, 42, 0.45)",
                  padding: "8px",
                }}
              >
                <AnimationPanel rig={rig} active />
              </div>
            </div>
          )}
            </div>
          )}
        </div>

        {minimizedModuleIds.length > 0 && (
          <div
            style={{
              position: "absolute",
              left: "10px",
              top: "64px",
              display: "flex",
              flexDirection: "column",
              flexWrap: "wrap",
              gap: "6px",
              maxHeight: "70%",
              zIndex: 70,
            }}
          >
            {minimizedModuleIds.map((moduleId) => (
              <button
                key={`minimized-${moduleId}`}
                type="button"
                style={{
                  width: "42px",
                  height: "42px",
                  borderRadius: "10px",
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "rgba(17, 24, 39, 0.8)",
                  color: "#f9fafb",
                  fontSize: "10px",
                  fontWeight: 700,
                  textTransform: "uppercase",
                  cursor: "pointer",
                }}
                onClick={() => setModuleMinimized(moduleId, false)}
                title={moduleTitles[moduleId]}
              >
                {moduleTitles[moduleId].slice(0, 2)}
              </button>
            ))}
          </div>
        )}

        {canvasUxPreset !== "full" && (
          <div style={{ position: "absolute", left: "16px", bottom: "16px", zIndex: 60 }}>
            <CanvasCommandWheel
              title={`${rig.state.mode} ${formatJointLabel(selectedJointId)}`}
              subtitle={`${CANVAS_WORKFLOW_LABELS[activeCanvasWorkflow]} | ${wheelPrimaryTool}`}
              layers={activeWheelLayers}
              axisLock={wheelAxisLock}
              precision={wheelPrecision}
              controlMode={wheelControlMode}
              rotationDeg={selectedJoint.localRotationDegRaw}
              x={wheelXValue}
              y={wheelYValue}
              scalarValue={cameraZoomMultiplier}
              scalarMin={0.25}
              scalarMax={4}
              disabled={!selectedJointEnabled}
              primarySegments={wheelPrimarySegments}
              onSelectPrimary={(id) => {
                if (id === "rotate" || id === "translate" || id === "zoom") {
                  setWheelPrimaryTool(id);
                }
              }}
              onCycleAxisLock={() =>
                setWheelAxisLock((prev) => (prev === "xy" ? "x" : prev === "x" ? "y" : "xy"))
              }
              onTogglePrecision={() => setWheelPrecision((prev) => (prev === "coarse" ? "fine" : "coarse"))}
              onRotateDelta={handleWheelRotate}
              onRotateDragStart={handleWheelRotateDragStart}
              onRotateDragEnd={handleWheelRotateDragEnd}
              onXChange={handleWheelXChange}
              onYChange={handleWheelYChange}
              onScalarChange={handleWheelScalarChange}
              onNudge={handleWheelNudge}
              onReset={() => {
                setWheelAxisLock(DEFAULT_WHEEL_AXIS_LOCK);
                setWheelPrecision(DEFAULT_WHEEL_PRECISION);
                setWheelPrimaryTool(DEFAULT_WHEEL_PRIMARY_TOOL);
              }}
            />
          </div>
        )}

        <div data-hover-help-skip="true" style={{ width: "100%", height: "100%" }}>
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
            rotationPreview={rotationPreview}
            targetDisplayPositions={solvedTargetDisplayPositions}
            onJointClick={(jointId) => {
              if (!skeletalInteractionEnabled) {
                return;
              }
              rig.selectJoint(getClickActivationJointId(jointId));
            }}
            onJointPointerDown={(jointId, x, y, event) => {
              if (!skeletalInteractionEnabled) {
                return;
              }
              if (jointEnabled[jointId] === false) {
                return;
              }
              if (rig.state.mode === "IK" && ikStickyTargetJointId && ikStickyTargetJointId !== jointId) {
                setIkStickyTargetJointId(null);
              }
              if (rig.state.mode === "IK" && event.detail >= 2) {
                toggleIkStickyTarget(jointId, x, y);
                return;
              }
              if (rig.state.mode === "FK" && jointId !== "root") {
                const pivot = rig.worldTransforms[jointId]?.worldPosition ?? { x, y };
                const childJointId =
                  JOINT_IDS.find((candidate) => rig.state.joints[candidate].parentId === jointId) ?? null;
                const childPosition = childJointId
                  ? rig.worldTransforms[childJointId]?.worldPosition
                  : null;
                let previewBaseVec: Vec2 = { x: 48, y: 0 };
                if (childPosition) {
                  const vector = subVec2(childPosition, pivot);
                  if (Number.isFinite(vector.x) && Number.isFinite(vector.y)) {
                    previewBaseVec = vector;
                  }
                }
                const mirroredJointId =
                  mirrorControlsEnabled ? getMirroredJointId(jointId) : null;
                fkDragRotationRef.current = {
                  jointId,
                  pivot,
                  lastPointerAngleDeg: angleDegFrom(pivot, { x, y }),
                  lastSampleMs: Date.now(),
                  currentJointRotationDeg: rig.state.joints[jointId].localRotationDegRaw,
                  mirroredJointId,
                  currentMirroredRotationDeg: mirroredJointId
                    ? rig.state.joints[mirroredJointId].localRotationDegRaw
                    : 0,
                  previewBaseVec,
                  previewAccumulatedDeltaDeg: 0,
                };
                fkDragDeltaFilterRef.current = {
                  jointId,
                  value: 0,
                  lastMs: 0,
                };
                setRotationPreview({
                  jointId,
                  pivot,
                  points: buildRotationPreviewPoints(previewBaseVec, pivot, 0),
                });
              } else {
                fkDragRotationRef.current = null;
                rotationDragRef.current = null;
                setRotationPreview(null);
              }
              rig.selectJoint(getClickActivationJointId(jointId));
              rig.dragStart(jointId, x, y, "joint");
            }}
            onTargetPointerDown={(jointId, x, y, event) => {
              if (!skeletalInteractionEnabled) {
                return;
              }
              if (jointEnabled[jointId] === false) {
                return;
              }
              if (rig.state.mode === "IK" && ikStickyTargetJointId && ikStickyTargetJointId !== jointId) {
                setIkStickyTargetJointId(null);
              }
              if (rig.state.mode === "IK" && event.detail >= 2) {
                toggleIkStickyTarget(jointId, x, y);
                return;
              }
              rig.selectJoint(jointId);
              rig.dragStart(jointId, x, y, "target");
            }}
            onPoleTargetPointerDown={(jointId, x, y) => {
              if (!skeletalInteractionEnabled) {
                return;
              }
              if (jointEnabled[jointId] === false) {
                return;
              }
              rig.selectJoint(jointId);
              rig.ikSetPoleTarget(jointId, x, y);
            }}
            onJointDrag={skeletalInteractionEnabled ? handleJointDrag : undefined}
            onTargetDrag={skeletalInteractionEnabled ? handleTargetDrag : undefined}
            onPoleTargetDrag={skeletalInteractionEnabled ? handlePoleTargetDrag : undefined}
            onViewportPointerMove={
              skeletalInteractionEnabled ? handleIkStickyViewportPointerMove : undefined
            }
            onDragEnd={() => {
              fkDragRotationRef.current = null;
              fkDragDeltaFilterRef.current = { jointId: null, value: 0, lastMs: 0 };
              rotationDragRef.current = null;
              setRotationPreview(null);
              rig.dragEnd();
            }}
            onOverlayAnchorDragMove={overlayEditingEnabled ? handleOverlayAnchorDragMove : undefined}
            onOverlayAnchorDragEnd={overlayEditingEnabled ? handleOverlayAnchorDragEnd : undefined}
          />
        </div>
      </main>
    </div>
  );
};
