import {
  BackgroundShadowSettings,
  ConstraintSettings,
  ControlMode,
  IkSolverId,
  DEFAULT_BACKGROUND_SHADOW_SETTINGS,
  DEFAULT_CONSTRAINT_SETTINGS,
  DEFAULT_IMAGE_FILTER_SETTINGS,
  ImageFilterSettings,
  IkSolveMode,
  IkPoleTarget,
  IkTarget,
  JointId,
  JointState,
  JOINT_IDS,
  PinConstraint,
  RigSceneLayers,
  RigState,
  SceneImageLayer,
  SceneLayerFitMode,
  SkeletonVersion,
  SvgOverlay,
  createInitialRigState,
} from "./types";
import { cloneJoints, computeWorldTransforms } from "./graph";
import {
  normalizeImageFilterSettings,
  normalizeLayerBlendMode,
  normalizeOverlayAlpha,
  normalizeOverlayFeather,
  normalizeOverlayScale,
} from "./overlay";

export type RigSnapshotV2 = {
  version: 2 | 3;
  mode: ControlMode;
  ikSolveMode: IkSolveMode;
  ikSolver?: IkSolverId;
  ikStretchEnabled: boolean;
  constraintSettings: ConstraintSettings;
  skeletonVersion?: SkeletonVersion;
  joints: Record<JointId, JointState>;
  pins: PinConstraint[];
  ikTargets: Record<JointId, IkTarget | undefined>;
  ikPoleTargets: Record<JointId, IkPoleTarget | undefined>;
  overlays: SvgOverlay[];
  selectedJointId: JointId | null;
  sceneLayers?: RigSceneLayers;
};

const LEGACY_PIVOT_TO_JOINT: Partial<Record<string, JointId>> = {
  waist: "waist",
  torso: "torso",
  collar: "collar",
  neck: "neck",
  l_shoulder: "l_shoulder",
  l_elbow: "l_elbow",
  l_hand: "l_hand",
  r_shoulder: "r_shoulder",
  r_elbow: "r_elbow",
  r_hand: "r_hand",
  l_hip: "l_hip",
  l_knee: "l_knee",
  l_foot: "l_foot",
  r_hip: "r_hip",
  r_knee: "r_knee",
  r_foot: "r_foot",
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const asNumber = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const asJointId = (value: unknown): JointId | undefined =>
  typeof value === "string" && (JOINT_IDS as string[]).includes(value) ? (value as JointId) : undefined;

const parseControlMode = (value: unknown): ControlMode | undefined =>
  value === "FK" || value === "IK" ? value : undefined;

const parseIkSolveMode = (value: unknown): IkSolveMode | undefined =>
  value === "single_chain" || value === "limbs_only" || value === "whole_body_graph" ? value : undefined;

const parseSkeletonVersion = (
  value: unknown,
  fallback: SkeletonVersion
): SkeletonVersion => (value === "v1" || value === "v2" ? value : fallback);

const parseConstraintSettings = (value: unknown): ConstraintSettings => {
  if (!isRecord(value)) {
    return { ...DEFAULT_CONSTRAINT_SETTINGS };
  }
  return {
    enforceRootWaistLock:
      typeof value.enforceRootWaistLock === "boolean"
        ? value.enforceRootWaistLock
        : DEFAULT_CONSTRAINT_SETTINGS.enforceRootWaistLock,
    allowKneeLiftWhenBothAnklesPinned:
      typeof value.allowKneeLiftWhenBothAnklesPinned === "boolean"
        ? value.allowKneeLiftWhenBothAnklesPinned
        : DEFAULT_CONSTRAINT_SETTINGS.allowKneeLiftWhenBothAnklesPinned,
    lockGroundedAnklesX:
      typeof value.lockGroundedAnklesX === "boolean"
        ? value.lockGroundedAnklesX
        : DEFAULT_CONSTRAINT_SETTINGS.lockGroundedAnklesX,
    releaseGroundedAnkleWhenLegLifts:
      typeof value.releaseGroundedAnkleWhenLegLifts === "boolean"
        ? value.releaseGroundedAnkleWhenLegLifts
        : DEFAULT_CONSTRAINT_SETTINGS.releaseGroundedAnkleWhenLegLifts,
    clampGroundedIkTargetReach:
      typeof value.clampGroundedIkTargetReach === "boolean"
        ? value.clampGroundedIkTargetReach
        : DEFAULT_CONSTRAINT_SETTINGS.clampGroundedIkTargetReach,
    fkFrictionOff:
      typeof value.fkFrictionOff === "boolean"
        ? value.fkFrictionOff
        : DEFAULT_CONSTRAINT_SETTINGS.fkFrictionOff,
    ikFrictionOff:
      typeof value.ikFrictionOff === "boolean"
        ? value.ikFrictionOff
        : DEFAULT_CONSTRAINT_SETTINGS.ikFrictionOff,
  };
};

const clonePins = (pins: PinConstraint[]): PinConstraint[] => pins.map((pin) => ({ ...pin }));

const parseFitMode = (value: unknown): SceneLayerFitMode =>
  value === "contain" || value === "stretch" || value === "cover" ? value : "cover";

const parseFilters = (
  value: unknown,
  fallback: ImageFilterSettings = DEFAULT_IMAGE_FILTER_SETTINGS
): ImageFilterSettings =>
  isRecord(value)
    ? normalizeImageFilterSettings(
        {
          brightness: asNumber(value.brightness),
          contrast: asNumber(value.contrast),
          saturate: asNumber(value.saturate),
          hueRotateDeg: asNumber(value.hueRotateDeg),
          blurPx: asNumber(value.blurPx),
          grayscale: asNumber(value.grayscale),
          sepia: asNumber(value.sepia),
          invert: asNumber(value.invert),
        },
        fallback
      )
    : normalizeImageFilterSettings(undefined, fallback);

const parseSceneLayer = (
  value: unknown,
  fallback: SceneImageLayer
): SceneImageLayer => {
  if (!isRecord(value)) {
    return {
      ...fallback,
      filters: { ...fallback.filters },
      transform: { ...fallback.transform },
    };
  }
  const transform = isRecord(value.transform) ? value.transform : {};
  return {
    name: typeof value.name === "string" ? value.name : fallback.name,
    dataUrl: typeof value.dataUrl === "string" ? value.dataUrl : null,
    visible: typeof value.visible === "boolean" ? value.visible : fallback.visible,
    alpha: normalizeOverlayAlpha(asNumber(value.alpha) ?? fallback.alpha),
    blendMode: normalizeLayerBlendMode(value.blendMode, fallback.blendMode),
    filters: parseFilters(value.filters, fallback.filters),
    transform: {
      x: asNumber(transform.x) ?? fallback.transform.x,
      y: asNumber(transform.y) ?? fallback.transform.y,
      rotation: asNumber(transform.rotation) ?? fallback.transform.rotation,
      scaleX: asNumber(transform.scaleX) ?? fallback.transform.scaleX,
      scaleY: asNumber(transform.scaleY) ?? fallback.transform.scaleY,
    },
    fitMode: parseFitMode(value.fitMode),
  };
};

const parseBackgroundShadow = (
  value: unknown,
  fallback: BackgroundShadowSettings
): BackgroundShadowSettings => {
  if (!isRecord(value)) {
    return { ...fallback };
  }
  return {
    enabled: typeof value.enabled === "boolean" ? value.enabled : fallback.enabled,
    alpha: normalizeOverlayAlpha(asNumber(value.alpha) ?? fallback.alpha),
    blurPx: asNumber(value.blurPx) ?? fallback.blurPx,
    offsetX: asNumber(value.offsetX) ?? fallback.offsetX,
    offsetY: asNumber(value.offsetY) ?? fallback.offsetY,
  };
};

const parseOverlay = (value: unknown): SvgOverlay | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const id = typeof value.id === "string" ? value.id : undefined;
  const name = typeof value.name === "string" ? value.name : undefined;
  const dataUrl = typeof value.dataUrl === "string" ? value.dataUrl : undefined;
  const parentJointId = value.parentJointId === null ? null : asJointId(value.parentJointId) ?? null;
  const childJointId = value.childJointId === null ? null : asJointId(value.childJointId) ?? null;
  const offsetRecord = isRecord(value.offset)
    ? { x: asNumber(value.offset.x), y: asNumber(value.offset.y) }
    : { x: undefined, y: undefined };
  const childOffsetRecord = isRecord(value.childOffset)
    ? { x: asNumber(value.childOffset.x), y: asNumber(value.childOffset.y) }
    : { x: undefined, y: undefined };

  if (!dataUrl) {
    return undefined;
  }

  return {
    id:
      id ??
      `overlay-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    name: name ?? "overlay",
    dataUrl,
    parentJointId,
    childJointId,
    offset: {
      x: offsetRecord.x ?? 0,
      y: offsetRecord.y ?? 0,
    },
    childOffset: {
      x: childOffsetRecord.x ?? 0,
      y: childOffsetRecord.y ?? 0,
    },
    segmentRestLength: asNumber(value.segmentRestLength) ?? null,
    segmentRestAngleDeg: asNumber(value.segmentRestAngleDeg) ?? null,
    rotation: asNumber(value.rotation) ?? 0,
    scale: normalizeOverlayScale(asNumber(value.scale) ?? 1),
    flipX: typeof value.flipX === "boolean" ? value.flipX : false,
    flipY: typeof value.flipY === "boolean" ? value.flipY : false,
    visible: typeof value.visible === "boolean" ? value.visible : true,
    alpha: normalizeOverlayAlpha(asNumber(value.alpha) ?? 1),
    feather: normalizeOverlayFeather(asNumber(value.feather) ?? 0),
    blendMode: normalizeLayerBlendMode(value.blendMode, "multiply"),
    filters: parseFilters(value.filters, normalizeImageFilterSettings({ grayscale: 1, contrast: 1.1 })),
  };
};

const parseOverlays = (value: unknown): SvgOverlay[] =>
  Array.isArray(value)
    ? value
        .map((entry) => parseOverlay(entry))
        .filter((overlay): overlay is SvgOverlay => Boolean(overlay))
    : [];

const cloneIkTargets = (
  ikTargets: Record<JointId, IkTarget | undefined>
): Record<JointId, IkTarget | undefined> => {
  const next = {} as Record<JointId, IkTarget | undefined>;
  for (const jointId of JOINT_IDS) {
    const target = ikTargets[jointId];
    next[jointId] = target ? { ...target } : undefined;
  }
  return next;
};

const cloneIkPoleTargets = (
  ikPoleTargets: Record<JointId, IkPoleTarget | undefined>
): Record<JointId, IkPoleTarget | undefined> => {
  const next = {} as Record<JointId, IkPoleTarget | undefined>;
  for (const jointId of JOINT_IDS) {
    const target = ikPoleTargets[jointId];
    next[jointId] = target ? { ...target } : undefined;
  }
  return next;
};

const cloneOverlays = (overlays: SvgOverlay[]): SvgOverlay[] =>
  overlays.map((overlay) => ({
    ...overlay,
    offset: { ...overlay.offset },
    childOffset: { ...overlay.childOffset },
    filters: { ...overlay.filters },
  }));

const cloneSceneLayers = (sceneLayers: RigSceneLayers): RigSceneLayers => ({
  background: {
    ...sceneLayers.background,
    filters: { ...sceneLayers.background.filters },
    transform: { ...sceneLayers.background.transform },
  },
  foreground: {
    ...sceneLayers.foreground,
    filters: { ...sceneLayers.foreground.filters },
    transform: { ...sceneLayers.foreground.transform },
  },
  backgroundShadow: { ...sceneLayers.backgroundShadow },
});

export const cloneRigState = (state: RigState): RigState => ({
  mode: state.mode,
  ikSolveMode: state.ikSolveMode,
  ikSolver: state.ikSolver,
  ikStretchEnabled: state.ikStretchEnabled,
  constraintSettings: { ...state.constraintSettings },
  skeletonVersion: state.skeletonVersion,
  joints: cloneJoints(state.joints),
  pins: clonePins(state.pins),
  ikTargets: cloneIkTargets(state.ikTargets),
  ikPoleTargets: cloneIkPoleTargets(state.ikPoleTargets),
  overlays: cloneOverlays(state.overlays),
  selectedJointId: state.selectedJointId,
  sceneLayers: cloneSceneLayers(state.sceneLayers),
});

export const toRigSnapshotV2 = (state: RigState): RigSnapshotV2 => ({
  version: 3,
  mode: state.mode,
  ikSolveMode: state.ikSolveMode,
  ikSolver: state.ikSolver,
  ikStretchEnabled: state.ikStretchEnabled,
  constraintSettings: { ...state.constraintSettings },
  skeletonVersion: state.skeletonVersion,
  joints: cloneJoints(state.joints),
  pins: clonePins(state.pins),
  ikTargets: cloneIkTargets(state.ikTargets),
  ikPoleTargets: cloneIkPoleTargets(state.ikPoleTargets),
  overlays: cloneOverlays(state.overlays),
  selectedJointId: state.selectedJointId,
  sceneLayers: cloneSceneLayers(state.sceneLayers),
});

const parsePin = (value: unknown): PinConstraint | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const jointId = asJointId(value.jointId);
  if (!jointId) {
    return undefined;
  }

  if (value.kind === "world") {
    const x = asNumber(value.x);
    const y = asNumber(value.y);
    if (x === undefined || y === undefined) {
      return undefined;
    }
    return {
      kind: "world",
      jointId,
      x,
      y,
      lockX: Boolean(value.lockX),
      lockY: Boolean(value.lockY),
    };
  }

  if (value.kind === "ground") {
    const groundY = asNumber(value.groundY);
    if (groundY === undefined) {
      return undefined;
    }
    return {
      kind: "ground",
      jointId,
      groundY,
    };
  }

  return undefined;
};

const parseJoint = (jointId: JointId, value: unknown, fallback: JointState): JointState => {
  if (!isRecord(value)) {
    return fallback;
  }

  const parentIdRaw = value.parentId;
  const parentId = parentIdRaw === null ? null : asJointId(parentIdRaw);
  const localRotationDegRaw = asNumber(value.localRotationDegRaw);
  const localTranslation = isRecord(value.localTranslation)
    ? { x: asNumber(value.localTranslation.x), y: asNumber(value.localTranslation.y) }
    : { x: undefined, y: undefined };
  const length = asNumber(value.length);

  return {
    id: jointId,
    parentId: parentId === undefined ? fallback.parentId : parentId,
    localRotationDegRaw: localRotationDegRaw ?? fallback.localRotationDegRaw,
    localTranslation: {
      x: localTranslation.x ?? fallback.localTranslation.x,
      y: localTranslation.y ?? fallback.localTranslation.y,
    },
    length: length ?? fallback.length,
  };
};

export const fromRigSnapshotV2 = (snapshot: unknown): RigState => {
  const fallback = createInitialRigState();
  if (
    !isRecord(snapshot) ||
    !("version" in snapshot) ||
    (snapshot.version !== 2 && snapshot.version !== 3)
  ) {
    return fallback;
  }

  const mode = parseControlMode(snapshot.mode) ?? fallback.mode;
  const ikSolveMode = parseIkSolveMode(snapshot.ikSolveMode) ?? fallback.ikSolveMode;
  const ikStretchEnabled = Boolean(snapshot.ikStretchEnabled);
  const ikSolver = snapshot.ikSolver === "ccd" || snapshot.ikSolver === "hybrid" ? snapshot.ikSolver : "fabrik";
  const constraintSettings = parseConstraintSettings(snapshot.constraintSettings);
  const skeletonVersion = parseSkeletonVersion(snapshot.skeletonVersion, fallback.skeletonVersion);
  const selectedJointId = snapshot.selectedJointId === null ? null : asJointId(snapshot.selectedJointId) ?? null;

  const joints = cloneJoints(fallback.joints);
  const snapshotJoints = isRecord(snapshot.joints) ? snapshot.joints : undefined;
  if (snapshotJoints) {
    for (const jointId of JOINT_IDS) {
      joints[jointId] = parseJoint(jointId, snapshotJoints[jointId], joints[jointId]);
    }
  }

  const pins = Array.isArray(snapshot.pins)
    ? snapshot.pins.map(parsePin).filter((pin): pin is PinConstraint => Boolean(pin))
    : [];

  const ikTargets = cloneIkTargets(fallback.ikTargets);
  const snapshotTargets = isRecord(snapshot.ikTargets) ? snapshot.ikTargets : undefined;
  if (snapshotTargets) {
    for (const jointId of JOINT_IDS) {
      const target = snapshotTargets[jointId];
      if (!isRecord(target)) {
        continue;
      }
      const x = asNumber(target.x);
      const y = asNumber(target.y);
      if (x === undefined || y === undefined) {
        continue;
      }
      ikTargets[jointId] = {
        jointId,
        x,
        y,
        active: Boolean(target.active),
      };
    }
  }

  const ikPoleTargets = cloneIkPoleTargets(fallback.ikPoleTargets);
  const snapshotPoleTargets = isRecord(snapshot.ikPoleTargets) ? snapshot.ikPoleTargets : undefined;
  if (snapshotPoleTargets) {
    for (const jointId of JOINT_IDS) {
      const target = snapshotPoleTargets[jointId];
      if (!isRecord(target)) {
        continue;
      }
      const x = asNumber(target.x);
      const y = asNumber(target.y);
      if (x === undefined || y === undefined) {
        continue;
      }
      ikPoleTargets[jointId] = {
        jointId,
        x,
        y,
        active: Boolean(target.active),
      };
    }
  }

  const snapshotOverlays = parseOverlays(snapshot.overlays);
  const rawSceneLayers = isRecord(snapshot.sceneLayers) ? snapshot.sceneLayers : undefined;
  const sceneLayers: RigSceneLayers = {
    background: parseSceneLayer(rawSceneLayers?.background, fallback.sceneLayers.background),
    foreground: parseSceneLayer(rawSceneLayers?.foreground, fallback.sceneLayers.foreground),
    backgroundShadow: parseBackgroundShadow(
      rawSceneLayers?.backgroundShadow,
      fallback.sceneLayers.backgroundShadow
    ),
  };

  return {
    mode,
    ikSolveMode,
    ikSolver,
    ikStretchEnabled,
    skeletonVersion,
    constraintSettings,
    joints,
    pins,
    ikTargets,
    ikPoleTargets,
    overlays: snapshotOverlays.length ? snapshotOverlays : cloneOverlays(fallback.overlays),
    selectedJointId,
    sceneLayers,
  };
};

const parseLegacyIkTarget = (value: unknown, jointId: JointId): IkTarget | undefined => {
  if (!isRecord(value)) {
    return undefined;
  }
  const x = asNumber(value.x);
  const y = asNumber(value.y);
  if (x === undefined || y === undefined) {
    return undefined;
  }
  return {
    jointId,
    x,
    y,
    active: Boolean(value.active ?? true),
  };
};

const parseLegacyPins = (
  legacy: Record<string, unknown>,
  joints: Record<JointId, JointState>
): PinConstraint[] => {
  const parsedPins: PinConstraint[] = [];

  if (Array.isArray(legacy.pins)) {
    for (const pinValue of legacy.pins) {
      const pin = parsePin(pinValue);
      if (pin) {
        parsedPins.push(pin);
      }
    }
  }

  if (Array.isArray(legacy.activePins) && legacy.activePins.length) {
    const world = computeWorldTransforms(joints);
    for (const pinId of legacy.activePins) {
      const jointId = asJointId(pinId);
      if (!jointId) {
        continue;
      }
      if (parsedPins.some((pin) => pin.jointId === jointId)) {
        continue;
      }
      parsedPins.push({
        kind: "world",
        jointId,
        x: world[jointId].worldPosition.x,
        y: world[jointId].worldPosition.y,
        lockX: true,
        lockY: true,
      });
    }
  }

  return parsedPins;
};

export const migrateLegacyPayloadToRigSnapshotV2 = (payload: unknown): RigSnapshotV2 => {
  const base = createInitialRigState();
  const joints = cloneJoints(base.joints);
  const ikTargets = cloneIkTargets(base.ikTargets);
  const ikPoleTargets = cloneIkPoleTargets(base.ikPoleTargets);

  const legacy = isRecord(payload) ? payload : {};
  const pivotOffsets = isRecord(legacy.pivotOffsets) ? legacy.pivotOffsets : {};

  for (const [legacyKey, jointId] of Object.entries(LEGACY_PIVOT_TO_JOINT)) {
    if (!jointId) {
      continue;
    }
    const rawDeg = asNumber(pivotOffsets[legacyKey]);
    if (rawDeg === undefined) {
      continue;
    }
    joints[jointId] = {
      ...joints[jointId],
      localRotationDegRaw: rawDeg,
    };
  }

  const rootX = asNumber(legacy.x_offset);
  const rootY = asNumber(legacy.y_offset);
  if (rootX !== undefined || rootY !== undefined) {
    joints.root = {
      ...joints.root,
      localTranslation: {
        x: rootX ?? joints.root.localTranslation.x,
        y: rootY ?? joints.root.localTranslation.y,
      },
    };
  }

  const mode: ControlMode = legacy.isIKEnabled ? "IK" : "FK";
  const ikSolveMode = parseIkSolveMode(legacy.ikSolveMode) ?? "single_chain";

  if (isRecord(legacy.ikConstraints)) {
    const left = parseLegacyIkTarget(legacy.ikConstraints.l_hand_anchor, "l_hand");
    const right = parseLegacyIkTarget(legacy.ikConstraints.r_hand_anchor, "r_hand");
    if (left) {
      ikTargets[left.jointId] = left;
    }
    if (right) {
      ikTargets[right.jointId] = right;
    }
  }

  if (isRecord(legacy.ikTargets)) {
    for (const jointId of JOINT_IDS) {
      const parsedTarget = parseLegacyIkTarget(legacy.ikTargets[jointId], jointId);
      if (parsedTarget) {
        ikTargets[jointId] = parsedTarget;
      }
    }
  }

  const pins = parseLegacyPins(legacy, joints);

  return {
    version: 3,
    mode,
    ikSolveMode,
    ikSolver: "fabrik",
    ikStretchEnabled: false,
    constraintSettings: { ...DEFAULT_CONSTRAINT_SETTINGS },
    skeletonVersion: "v1",
    joints,
    pins,
    ikTargets,
    ikPoleTargets,
    overlays: [],
    selectedJointId: asJointId(legacy.selectedJointId) ?? null,
    sceneLayers: {
      background: parseSceneLayer(undefined, base.sceneLayers.background),
      foreground: parseSceneLayer(undefined, base.sceneLayers.foreground),
      backgroundShadow: parseBackgroundShadow(
        undefined,
        DEFAULT_BACKGROUND_SHADOW_SETTINGS
      ),
    },
  };
};
