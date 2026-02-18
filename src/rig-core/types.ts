export type ControlMode = "FK" | "IK";
export type IkSolveMode = "single_chain" | "limbs_only" | "whole_body_graph";
export type IkSolverId = "fabrik" | "ccd" | "hybrid";

export type SkeletonVersion = "v1" | "v2";

export type JointId =
  | "root"
  | "waist"
  | "xiphoid"
  | "torso"
  | "collar"
  | "neck"
  | "l_shoulder"
  | "l_elbow"
  | "l_hand"
  | "r_shoulder"
  | "r_elbow"
  | "r_hand"
  | "l_hip"
  | "l_knee"
  | "l_foot"
  | "r_hip"
  | "r_knee"
  | "r_foot";

export type Vec2 = { x: number; y: number };

export type LayerBlendMode =
  | "normal"
  | "multiply"
  | "screen"
  | "overlay"
  | "darken"
  | "lighten"
  | "color-dodge"
  | "color-burn"
  | "hard-light"
  | "soft-light";

export type ImageFilterSettings = {
  brightness: number;
  contrast: number;
  saturate: number;
  hueRotateDeg: number;
  blurPx: number;
  grayscale: number;
  sepia: number;
  invert: number;
};

export type ImageLayerTransform = {
  x: number;
  y: number;
  rotation: number;
  scaleX: number;
  scaleY: number;
};

export type SceneLayerFitMode = "cover" | "contain" | "stretch";

export type SceneImageLayer = {
  name: string;
  dataUrl: string | null;
  visible: boolean;
  alpha: number;
  blendMode: LayerBlendMode;
  filters: ImageFilterSettings;
  transform: ImageLayerTransform;
  fitMode: SceneLayerFitMode;
};

export type BackgroundShadowSettings = {
  enabled: boolean;
  alpha: number;
  blurPx: number;
  offsetX: number;
  offsetY: number;
};

export type RigSceneLayers = {
  background: SceneImageLayer;
  foreground: SceneImageLayer;
  backgroundShadow: BackgroundShadowSettings;
};

export type JointState = {
  id: JointId;
  parentId: JointId | null;
  localRotationDegRaw: number;
  localTranslation: Vec2;
  length: number;
};

export type PinConstraint =
  | {
      kind: "world";
      jointId: JointId;
      x: number;
      y: number;
      lockX: boolean;
      lockY: boolean;
    }
  | {
      kind: "ground";
      jointId: JointId;
      groundY: number;
    };

export type IkTarget = { jointId: JointId; x: number; y: number; active: boolean };
export type IkPoleTarget = { jointId: JointId; x: number; y: number; active: boolean };

export type ConstraintSettings = {
  enforceRootWaistLock: boolean;
  allowKneeLiftWhenBothAnklesPinned: boolean;
  lockGroundedAnklesX: boolean;
  releaseGroundedAnkleWhenLegLifts: boolean;
  clampGroundedIkTargetReach: boolean;
  fkFrictionOff: boolean;
  ikFrictionOff: boolean;
};

export type RigState = {
  mode: ControlMode;
  ikSolveMode: IkSolveMode;
  ikSolver: IkSolverId;
  ikStretchEnabled: boolean;
  constraintSettings: ConstraintSettings;
  skeletonVersion: SkeletonVersion;
  joints: Record<JointId, JointState>;
  pins: PinConstraint[];
  ikTargets: Record<JointId, IkTarget | undefined>;
  ikPoleTargets: Record<JointId, IkPoleTarget | undefined>;
  selectedJointId: JointId | null;
  overlays: SvgOverlay[];
  sceneLayers: RigSceneLayers;
};

export type RigAction =
  | { type: "SET_MODE"; mode: ControlMode }
  | { type: "SET_IK_SOLVE_MODE"; ikSolveMode: IkSolveMode }
  | { type: "SET_IK_SOLVER"; solver: IkSolverId }
  | { type: "SET_IK_STRETCH_ENABLED"; enabled: boolean }
  | { type: "SET_CONSTRAINT_SETTINGS"; patch: Partial<ConstraintSettings> }
  | { type: "SET_SKELETON_VERSION"; version: SkeletonVersion }
  | { type: "SELECT_JOINT"; jointId: JointId | null }
  | { type: "FK_SET_ROTATION_SLIDER"; jointId: JointId; sliderDeg: number }
  | { type: "FK_SET_ROTATION_TEXT"; jointId: JointId; rawDeg: number }
  | { type: "FK_SET_TRANSLATION"; jointId: JointId; x: number; y: number }
  | { type: "IK_SET_TARGET"; jointId: JointId; x: number; y: number }
  | { type: "IK_SET_POLE_TARGET"; jointId: JointId; x: number; y: number }
  | { type: "PIN_SET"; pin: PinConstraint }
  | { type: "PIN_REMOVE"; jointId: JointId; kind: "world" | "ground" }
  | { type: "DRAG_START"; jointId: JointId; x: number; y: number; handle: "joint" | "target" | "bone" }
  | { type: "DRAG_MOVE"; x: number; y: number }
  | { type: "DRAG_END" }
  | { type: "IK_CLEAR_TARGET"; jointId: JointId }
  | { type: "IK_CLEAR_POLE_TARGET"; jointId: JointId }
  | { type: "OVERLAY_ADD"; overlay: SvgOverlay }
  | { type: "OVERLAY_UPDATE"; overlayId: string; patch: Partial<SvgOverlay> }
  | { type: "OVERLAY_REMOVE"; overlayId: string }
  | { type: "OVERLAY_PLACE_ON_JOINT"; overlayId: string; jointId: JointId }
  | { type: "OVERLAY_RESET"; overlayId: string }
  | { type: "SCENE_LAYER_SET_IMAGE"; layer: "background" | "foreground"; dataUrl: string | null; name?: string }
  | { type: "SCENE_LAYER_UPDATE"; layer: "background" | "foreground"; patch: Partial<SceneImageLayer> }
  | { type: "SCENE_BACKGROUND_SHADOW_UPDATE"; patch: Partial<BackgroundShadowSettings> }
  | { type: "SCENE_LAYER_RESET"; layer: "background" | "foreground" | "all" }
  | {
      type: "RUNTIME_DAMP_PELVIS";
      rootY: number;
      waistTarget: Vec2;
      lHipTarget: Vec2;
      rHipTarget: Vec2;
      alpha: number;
    }
  | { type: "HYDRATE_STATE"; state: RigState };

export type JointWorldTransform = {
  id: JointId;
  parentId: JointId | null;
  worldPosition: Vec2;
  worldRotationDeg: number;
};

export type RigWorldTransforms = Record<JointId, JointWorldTransform>;

export type JointLimitDeg = { minDeg: number; maxDeg: number };

export type ChainDescriptor = {
  id: string;
  joints: JointId[];
  effectorJointId: JointId;
  jointLimits?: Partial<Record<JointId, JointLimitDeg>>;
  priority?: number;
};

export type RigSolveDiagnostics = {
  iterations: number;
  residual: number;
  solveMs: number;
  chainsSolved: number;
  globalPasses: number;
};

export type DragState = {
  jointId: JointId;
  handle: "joint" | "target" | "bone";
  start: Vec2;
  current: Vec2;
};

export type RigSolverSettings = {
  maxIterations: number;
  epsilon: number;
  maxGlobalPasses: number;
};

export type SvgOverlay = {
  id: string;
  name: string;
  dataUrl: string;
  parentJointId: JointId | null;
  childJointId: JointId | null;
  offset: { x: number; y: number };
  childOffset: Vec2;
  segmentRestLength: number | null;
  segmentRestAngleDeg: number | null;
  rotation: number;
  scale: number;
  flipX: boolean;
  flipY: boolean;
  visible: boolean;
  alpha: number;
  feather: number;
  blendMode: LayerBlendMode;
  filters: ImageFilterSettings;
};

export const DEFAULT_SOLVER_SETTINGS: RigSolverSettings = {
  maxIterations: 20,
  epsilon: 0.5,
  maxGlobalPasses: 8,
};

export const DEFAULT_GROUND_Y = 0;
export const DEFAULT_CONSTRAINT_SETTINGS: ConstraintSettings = {
  enforceRootWaistLock: true,
  allowKneeLiftWhenBothAnklesPinned: true,
  lockGroundedAnklesX: true,
  releaseGroundedAnkleWhenLegLifts: true,
  clampGroundedIkTargetReach: true,
  fkFrictionOff: false,
  ikFrictionOff: false,
};

export const DEFAULT_IMAGE_FILTER_SETTINGS: ImageFilterSettings = {
  brightness: 1,
  contrast: 1,
  saturate: 1,
  hueRotateDeg: 0,
  blurPx: 0,
  grayscale: 0,
  sepia: 0,
  invert: 0,
};

export const DEFAULT_BACKGROUND_SCENE_LAYER: SceneImageLayer = {
  name: "Background",
  dataUrl: null,
  visible: true,
  alpha: 1,
  blendMode: "normal",
  filters: { ...DEFAULT_IMAGE_FILTER_SETTINGS },
  transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
  fitMode: "cover",
};

export const DEFAULT_FOREGROUND_SCENE_LAYER: SceneImageLayer = {
  name: "Foreground",
  dataUrl: null,
  visible: true,
  alpha: 0.65,
  blendMode: "screen",
  filters: {
    ...DEFAULT_IMAGE_FILTER_SETTINGS,
    brightness: 1.12,
    blurPx: 0.8,
  },
  transform: { x: 0, y: 0, rotation: 0, scaleX: 1, scaleY: 1 },
  fitMode: "cover",
};

export const DEFAULT_BACKGROUND_SHADOW_SETTINGS: BackgroundShadowSettings = {
  enabled: true,
  alpha: 0.22,
  blurPx: 12,
  offsetX: 0,
  offsetY: 4,
};

export const createDefaultSceneLayers = (): RigSceneLayers => ({
  background: {
    ...DEFAULT_BACKGROUND_SCENE_LAYER,
    filters: { ...DEFAULT_BACKGROUND_SCENE_LAYER.filters },
    transform: { ...DEFAULT_BACKGROUND_SCENE_LAYER.transform },
  },
  foreground: {
    ...DEFAULT_FOREGROUND_SCENE_LAYER,
    filters: { ...DEFAULT_FOREGROUND_SCENE_LAYER.filters },
    transform: { ...DEFAULT_FOREGROUND_SCENE_LAYER.transform },
  },
  backgroundShadow: { ...DEFAULT_BACKGROUND_SHADOW_SETTINGS },
});

export const JOINT_IDS: JointId[] = [
  "root",
  "waist",
  "xiphoid",
  "collar",
  "torso",
  "neck",
  "l_shoulder",
  "l_elbow",
  "l_hand",
  "r_shoulder",
  "r_elbow",
  "r_hand",
  "l_hip",
  "l_knee",
  "l_foot",
  "r_hip",
  "r_knee",
  "r_foot",
];

export const EMPTY_DIAGNOSTICS: RigSolveDiagnostics = {
  iterations: 0,
  residual: 0,
  solveMs: 0,
  chainsSolved: 0,
  globalPasses: 0,
};

type BodyLayoutProfile = {
  waistToTorsoRatio: number;
  torsoToCollarRatio: number;
  collarToNeckRatio: number;
  xiphoidAlongTrunkRatio: number;
  shoulderHalfSpanRatio: number;
  shoulderDropRatio: number;
  hipHalfSpanRatio: number;
  upperArmOutwardRatio: number;
  upperArmVerticalRatio: number;
  forearmInwardRatio: number;
  forearmVerticalRatio: number;
  thighOutwardRatio: number;
  thighVerticalRatio: number;
};

const DEFAULT_BODY_LAYOUT_PROFILE: BodyLayoutProfile = {
  waistToTorsoRatio: 1.06,
  torsoToCollarRatio: 0.88,
  collarToNeckRatio: 1.75,
  xiphoidAlongTrunkRatio: 0.5,
  shoulderHalfSpanRatio: 0.3,
  shoulderDropRatio: 0.45,
  hipHalfSpanRatio: 0.42,
  upperArmOutwardRatio: 0.42,
  upperArmVerticalRatio: 0.94,
  forearmInwardRatio: 0.22,
  forearmVerticalRatio: 1.0,
  thighOutwardRatio: 0.28,
  thighVerticalRatio: 0.98,
};

export const createDefaultJoints = (): Record<JointId, JointState> => {
  const base = 50;
  const layout = DEFAULT_BODY_LAYOUT_PROFILE;
  const lengths = {
    waist: base * 1.0,
    torso: base * 2.5,
    collar: base * 0.5,
    upperArm: base * 1.5,
    lowerArm: base * 1.4,
    hand: base * 0.5,
    upperLeg: base * 2.0,
    lowerLeg: base * 2.0,
    foot: base * 0.8,
  };
  const torsoLocal: Vec2 = { x: 0, y: -lengths.waist * layout.waistToTorsoRatio };
  const collarLocal: Vec2 = { x: 0, y: -lengths.torso * layout.torsoToCollarRatio };
  const navelToCollar: Vec2 = {
    x: torsoLocal.x + collarLocal.x,
    y: torsoLocal.y + collarLocal.y,
  };
  const xiphoidLocalFromNavel: Vec2 = {
    x: navelToCollar.x * layout.xiphoidAlongTrunkRatio,
    y: navelToCollar.y * layout.xiphoidAlongTrunkRatio,
  };
  const collarLocalFromXiphoid: Vec2 = {
    x: navelToCollar.x - xiphoidLocalFromNavel.x,
    y: navelToCollar.y - xiphoidLocalFromNavel.y,
  };
  const torsoLocalFromCollar: Vec2 = {
    x: torsoLocal.x - navelToCollar.x,
    y: torsoLocal.y - navelToCollar.y,
  };
  const neckLocal: Vec2 = { x: 0, y: -lengths.collar * layout.collarToNeckRatio };
  const shoulderHalfSpan = Math.max(
    lengths.torso * layout.shoulderHalfSpanRatio,
    lengths.waist * 0.55
  );
  const shoulderY = -lengths.collar * layout.shoulderDropRatio;
  const hipHalfSeparation = Math.max(
    lengths.waist * layout.hipHalfSpanRatio,
    lengths.torso * 0.12
  );
  const upperArmOffsetX = lengths.upperArm * layout.upperArmOutwardRatio;
  const upperArmOffsetY = lengths.upperArm * layout.upperArmVerticalRatio;
  const forearmOffsetX = lengths.lowerArm * layout.forearmInwardRatio;
  const forearmOffsetY = lengths.lowerArm * layout.forearmVerticalRatio;
  const thighOffsetX = lengths.upperLeg * layout.thighOutwardRatio;
  const thighOffsetY = lengths.upperLeg * layout.thighVerticalRatio;

  const makeJoint = (
    id: JointId,
    parentId: JointId | null,
    localTranslation: Vec2,
    length: number,
    localRotationDegRaw = 0
  ): JointState => ({
    id,
    parentId,
    localRotationDegRaw,
    localTranslation: { ...localTranslation },
    length,
  });

  const joints: Record<JointId, JointState> = {
    root: makeJoint("root", null, { x: 0, y: -200 }, 0),
    waist: makeJoint("waist", "root", { x: 0, y: 0 }, lengths.waist),
    // Xiphoid is halfway between navel (waist) and collar on the torso line.
    xiphoid: makeJoint("xiphoid", "waist", xiphoidLocalFromNavel, base * 0.2),
    collar: makeJoint("collar", "xiphoid", collarLocalFromXiphoid, lengths.collar),
    torso: makeJoint("torso", "collar", torsoLocalFromCollar, lengths.torso),
    // Nose joint at head center; collar->nose is the functional neck segment.
    // Kept short to preserve "helmet-on-torso" collar behavior.
    neck: makeJoint("neck", "collar", neckLocal, base * 0.6),
    l_shoulder: makeJoint("l_shoulder", "collar", { x: -shoulderHalfSpan, y: shoulderY }, lengths.upperArm),
    l_elbow: makeJoint(
      "l_elbow",
      "l_shoulder",
      { x: -upperArmOffsetX, y: upperArmOffsetY },
      lengths.lowerArm
    ),
    l_hand: makeJoint(
      "l_hand",
      "l_elbow",
      { x: forearmOffsetX, y: forearmOffsetY },
      lengths.hand
    ),
    r_shoulder: makeJoint("r_shoulder", "collar", { x: shoulderHalfSpan, y: shoulderY }, lengths.upperArm),
    r_elbow: makeJoint(
      "r_elbow",
      "r_shoulder",
      { x: upperArmOffsetX, y: upperArmOffsetY },
      lengths.lowerArm
    ),
    r_hand: makeJoint(
      "r_hand",
      "r_elbow",
      { x: -forearmOffsetX, y: forearmOffsetY },
      lengths.hand
    ),
    // Legs originate from the body center (root/navel pivot) for more natural IK freedom.
    l_hip: makeJoint("l_hip", "root", { x: -hipHalfSeparation, y: 0 }, lengths.upperLeg),
    l_knee: makeJoint("l_knee", "l_hip", { x: -thighOffsetX, y: thighOffsetY }, lengths.lowerLeg),
    l_foot: makeJoint("l_foot", "l_knee", { x: 0, y: lengths.lowerLeg }, lengths.foot),
    r_hip: makeJoint("r_hip", "root", { x: hipHalfSeparation, y: 0 }, lengths.upperLeg),
    r_knee: makeJoint("r_knee", "r_hip", { x: thighOffsetX, y: thighOffsetY }, lengths.lowerLeg),
    r_foot: makeJoint("r_foot", "r_knee", { x: 0, y: lengths.lowerLeg }, lengths.foot),
  };

  // Normalize the startup pose so feet rest on world X-plane (y=0)
  // and the body center (waist) sits on world Y-plane (x=0).
  const getWorldPositionIgnoringRotation = (jointId: JointId): Vec2 => {
    let x = 0;
    let y = 0;
    let current: JointId | null = jointId;
    let guard = 0;
    while (current && guard < JOINT_IDS.length + 2) {
      const joint = joints[current];
      x += joint.localTranslation.x;
      y += joint.localTranslation.y;
      current = joint.parentId;
      guard += 1;
    }
    return { x, y };
  };

  const waistWorld = getWorldPositionIgnoringRotation("waist");
  const leftFootWorld = getWorldPositionIgnoringRotation("l_foot");
  const rightFootWorld = getWorldPositionIgnoringRotation("r_foot");
  const startupGroundY = Math.max(leftFootWorld.y, rightFootWorld.y);

  joints.root = {
    ...joints.root,
    localTranslation: {
      x: joints.root.localTranslation.x - waistWorld.x,
      y: joints.root.localTranslation.y - startupGroundY,
    },
  };

  return joints;
};

const createEmptyIkTargets = (): Record<JointId, IkTarget | undefined> => {
  const targets = {} as Record<JointId, IkTarget | undefined>;
  for (const jointId of JOINT_IDS) {
    targets[jointId] = undefined;
  }
  return targets;
};

const createEmptyIkPoleTargets = (): Record<JointId, IkPoleTarget | undefined> => {
  const poleTargets = {} as Record<JointId, IkPoleTarget | undefined>;
  for (const jointId of JOINT_IDS) {
    poleTargets[jointId] = undefined;
  }
  return poleTargets;
};

const createDefaultPins = (joints: Record<JointId, JointState>): PinConstraint[] => [
  {
    kind: "world",
    jointId: "root",
    x: joints.root.localTranslation.x,
    y: joints.root.localTranslation.y,
    lockX: true,
    lockY: true,
  },
];

const withDefaultFilterSettings = (filters?: Partial<ImageFilterSettings> | null): ImageFilterSettings => ({
  ...DEFAULT_IMAGE_FILTER_SETTINGS,
  ...(filters ?? {}),
});

const withDefaultLayerTransform = (transform?: Partial<ImageLayerTransform> | null): ImageLayerTransform => ({
  ...DEFAULT_BACKGROUND_SCENE_LAYER.transform,
  ...(transform ?? {}),
});

const mergeSceneLayer = (
  fallback: SceneImageLayer,
  incoming?: Partial<SceneImageLayer> | null
): SceneImageLayer => ({
  ...fallback,
  ...(incoming ?? {}),
  filters: withDefaultFilterSettings(incoming?.filters),
  transform: withDefaultLayerTransform(incoming?.transform),
});

const mergeSceneLayers = (incoming?: Partial<RigSceneLayers>): RigSceneLayers => {
  const defaults = createDefaultSceneLayers();
  return {
    background: mergeSceneLayer(defaults.background, incoming?.background),
    foreground: mergeSceneLayer(defaults.foreground, incoming?.foreground),
    backgroundShadow: {
      ...defaults.backgroundShadow,
      ...(incoming?.backgroundShadow ?? {}),
    },
  };
};

export const createInitialRigState = (seed?: Partial<RigState>): RigState => {
  const joints = seed?.joints ?? createDefaultJoints();
  return {
    mode: seed?.mode ?? "FK",
    ikSolveMode: seed?.ikSolveMode ?? "single_chain",
    ikSolver: seed?.ikSolver ?? "fabrik",
    ikStretchEnabled: seed?.ikStretchEnabled ?? false,
    skeletonVersion: seed?.skeletonVersion ?? "v2",
    constraintSettings: {
      ...DEFAULT_CONSTRAINT_SETTINGS,
      ...(seed?.constraintSettings ?? {}),
    },
    joints,
    pins: seed?.pins ?? createDefaultPins(joints),
    ikTargets: seed?.ikTargets ?? createEmptyIkTargets(),
    ikPoleTargets: seed?.ikPoleTargets ?? createEmptyIkPoleTargets(),
    selectedJointId: seed?.selectedJointId ?? "xiphoid",
    overlays: seed?.overlays ?? [],
    sceneLayers: mergeSceneLayers(seed?.sceneLayers),
  };
};
