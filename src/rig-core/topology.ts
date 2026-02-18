import { JOINT_IDS, type ChainDescriptor, type JointId } from "./types";

export const ANATOMICAL_LIMITS = {
  l_shoulder: { minDeg: -145, maxDeg: 145 },
  r_shoulder: { minDeg: -145, maxDeg: 145 },
  l_elbow: { minDeg: -170, maxDeg: 8 },
  r_elbow: { minDeg: -8, maxDeg: 170 },
  l_hip: { minDeg: -120, maxDeg: 120 },
  r_hip: { minDeg: -120, maxDeg: 120 },
  l_knee: { minDeg: -170, maxDeg: 6 },
  r_knee: { minDeg: -6, maxDeg: 170 },
  waist: { minDeg: -35, maxDeg: 35 },
  xiphoid: { minDeg: -28, maxDeg: 28 },
  collar: { minDeg: -52, maxDeg: 52 },
} as const;

export const L_ARM_CHAIN: ChainDescriptor = {
  id: "l_arm",
  joints: ["l_shoulder", "l_elbow", "l_hand"],
  effectorJointId: "l_hand",
  priority: 40,
  jointLimits: {
    l_shoulder: ANATOMICAL_LIMITS.l_shoulder,
    l_elbow: ANATOMICAL_LIMITS.l_elbow,
  },
};

export const R_ARM_CHAIN: ChainDescriptor = {
  id: "r_arm",
  joints: ["r_shoulder", "r_elbow", "r_hand"],
  effectorJointId: "r_hand",
  priority: 41,
  jointLimits: {
    r_shoulder: ANATOMICAL_LIMITS.r_shoulder,
    r_elbow: ANATOMICAL_LIMITS.r_elbow,
  },
};

export const L_LEG_CHAIN: ChainDescriptor = {
  id: "l_leg",
  joints: ["l_hip", "l_knee", "l_foot"],
  effectorJointId: "l_foot",
  priority: 20,
  jointLimits: {
    l_hip: ANATOMICAL_LIMITS.l_hip,
    l_knee: ANATOMICAL_LIMITS.l_knee,
  },
};

export const R_LEG_CHAIN: ChainDescriptor = {
  id: "r_leg",
  joints: ["r_hip", "r_knee", "r_foot"],
  effectorJointId: "r_foot",
  priority: 21,
  jointLimits: {
    r_hip: ANATOMICAL_LIMITS.r_hip,
    r_knee: ANATOMICAL_LIMITS.r_knee,
  },
};

export const SPINE_CHAIN: ChainDescriptor = {
  id: "spine",
  joints: ["root", "waist", "xiphoid", "collar", "neck"],
  effectorJointId: "neck",
  priority: 30,
  jointLimits: {
    waist: ANATOMICAL_LIMITS.waist,
    xiphoid: ANATOMICAL_LIMITS.xiphoid,
    collar: ANATOMICAL_LIMITS.collar,
  },
};

export const L_HAND_FULL_BODY_CHAIN: ChainDescriptor = {
  id: "l_hand_full_body",
  joints: ["root", "waist", "xiphoid", "collar", "l_shoulder", "l_elbow", "l_hand"],
  effectorJointId: "l_hand",
  priority: 10,
  jointLimits: {
    waist: ANATOMICAL_LIMITS.waist,
    xiphoid: ANATOMICAL_LIMITS.xiphoid,
    collar: ANATOMICAL_LIMITS.collar,
    l_shoulder: ANATOMICAL_LIMITS.l_shoulder,
    l_elbow: ANATOMICAL_LIMITS.l_elbow,
  },
};

export const R_HAND_FULL_BODY_CHAIN: ChainDescriptor = {
  id: "r_hand_full_body",
  joints: ["root", "waist", "xiphoid", "collar", "r_shoulder", "r_elbow", "r_hand"],
  effectorJointId: "r_hand",
  priority: 11,
  jointLimits: {
    waist: ANATOMICAL_LIMITS.waist,
    xiphoid: ANATOMICAL_LIMITS.xiphoid,
    collar: ANATOMICAL_LIMITS.collar,
    r_shoulder: ANATOMICAL_LIMITS.r_shoulder,
    r_elbow: ANATOMICAL_LIMITS.r_elbow,
  },
};

export const L_FOOT_FULL_BODY_CHAIN: ChainDescriptor = {
  id: "l_foot_full_body",
  joints: ["root", "l_hip", "l_knee", "l_foot"],
  effectorJointId: "l_foot",
  priority: 12,
  jointLimits: {
    l_hip: ANATOMICAL_LIMITS.l_hip,
    l_knee: ANATOMICAL_LIMITS.l_knee,
  },
};

export const R_FOOT_FULL_BODY_CHAIN: ChainDescriptor = {
  id: "r_foot_full_body",
  joints: ["root", "r_hip", "r_knee", "r_foot"],
  effectorJointId: "r_foot",
  priority: 13,
  jointLimits: {
    r_hip: ANATOMICAL_LIMITS.r_hip,
    r_knee: ANATOMICAL_LIMITS.r_knee,
  },
};

export const L_HAND_SINGLE_CHAIN_ASSIST: ChainDescriptor = {
  id: "l_hand_single_chain_assist",
  joints: ["waist", "xiphoid", "collar", "l_shoulder", "l_elbow", "l_hand"],
  effectorJointId: "l_hand",
  priority: 14,
  jointLimits: {
    waist: ANATOMICAL_LIMITS.waist,
    xiphoid: ANATOMICAL_LIMITS.xiphoid,
    collar: ANATOMICAL_LIMITS.collar,
    l_shoulder: ANATOMICAL_LIMITS.l_shoulder,
    l_elbow: ANATOMICAL_LIMITS.l_elbow,
  },
};

export const R_HAND_SINGLE_CHAIN_ASSIST: ChainDescriptor = {
  id: "r_hand_single_chain_assist",
  joints: ["waist", "xiphoid", "collar", "r_shoulder", "r_elbow", "r_hand"],
  effectorJointId: "r_hand",
  priority: 15,
  jointLimits: {
    waist: ANATOMICAL_LIMITS.waist,
    xiphoid: ANATOMICAL_LIMITS.xiphoid,
    collar: ANATOMICAL_LIMITS.collar,
    r_shoulder: ANATOMICAL_LIMITS.r_shoulder,
    r_elbow: ANATOMICAL_LIMITS.r_elbow,
  },
};

export const LIMB_CHAINS: ChainDescriptor[] = [L_ARM_CHAIN, R_ARM_CHAIN, L_LEG_CHAIN, R_LEG_CHAIN];
export const WHOLE_BODY_ORDER: ChainDescriptor[] = [L_LEG_CHAIN, R_LEG_CHAIN, SPINE_CHAIN, L_ARM_CHAIN, R_ARM_CHAIN];
export const ALL_CHAINS: ChainDescriptor[] = [...LIMB_CHAINS, SPINE_CHAIN];

export const FULL_BODY_CHAIN_BY_EFFECTOR: Partial<Record<JointId, ChainDescriptor>> = {
  l_hand: L_HAND_FULL_BODY_CHAIN,
  r_hand: R_HAND_FULL_BODY_CHAIN,
  l_foot: L_FOOT_FULL_BODY_CHAIN,
  r_foot: R_FOOT_FULL_BODY_CHAIN,
  neck: SPINE_CHAIN,
};

export const SINGLE_CHAIN_ASSIST_BY_EFFECTOR: Partial<Record<JointId, ChainDescriptor>> = {
  l_hand: L_HAND_SINGLE_CHAIN_ASSIST,
  r_hand: R_HAND_SINGLE_CHAIN_ASSIST,
};

export const IK_CHAIN_BY_EFFECTOR: Partial<Record<JointId, JointId[]>> = {
  l_hand: L_ARM_CHAIN.joints,
  r_hand: R_ARM_CHAIN.joints,
  l_foot: L_LEG_CHAIN.joints,
  r_foot: R_LEG_CHAIN.joints,
  neck: SPINE_CHAIN.joints,
};

export const IK_POLE_JOINT_BY_EFFECTOR: Partial<Record<JointId, JointId>> = {
  l_hand: "l_elbow",
  r_hand: "r_elbow",
  l_foot: "l_knee",
  r_foot: "r_knee",
};

export const MIRRORED_JOINT_MAP: Partial<Record<JointId, JointId>> = {
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

export const DEFAULT_CHILD_BY_PARENT: Partial<Record<JointId, JointId>> = {
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

export const ACTIVATION_PARENT_BY_CHILD: Partial<Record<JointId, JointId>> = {
  l_hand: "l_elbow",
  r_hand: "r_elbow",
  l_foot: "l_knee",
  r_foot: "r_knee",
};

const LEG_EFFECTOR_JOINT_SET = new Set<JointId>(["l_foot", "r_foot"]);

export const getMirroredJointId = (jointId: JointId): JointId | null =>
  MIRRORED_JOINT_MAP[jointId] ?? null;

export const getActivationJointId = (jointId: JointId): JointId =>
  ACTIVATION_PARENT_BY_CHILD[jointId] ?? jointId;

export const isLegEffector = (jointId: JointId): boolean => LEG_EFFECTOR_JOINT_SET.has(jointId);

export const createJointBooleanMap = (value: boolean): Partial<Record<JointId, boolean>> =>
  Object.fromEntries(JOINT_IDS.map((jointId) => [jointId, value])) as Partial<Record<JointId, boolean>>;
