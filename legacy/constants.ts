
import { PartName, Pose, Vector2D, JointLimits, WalkingEngineProportions, PartVisualAnchors, TextureViewBox } from './types';

export const SCALE_FACTOR = 1;
export const BASE_HEAD_UNIT = 50;

// Vitruvian-inspired proportions (ratios relative to 1 head height)
export const ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT = {
  HEAD: 1.0,
  HEAD_WIDTH: 0.9,
  HEAD_NECK_GAP_OFFSET: 0.0,
  COLLAR: 0.5,
  COLLAR_WIDTH: 2.0, // shoulders span roughly ~2 head widths
  TORSO: 2.5,
  TORSO_WIDTH: 1.1,
  WAIST: 1.0,
  WAIST_WIDTH: 1.0,
  UPPER_ARM: 1.5,
  LOWER_ARM: 1.4,
  HAND: 0.5,
  LEG_UPPER: 2.0,
  LEG_LOWER: 2.0,
  FOOT: 0.6,
  TOE: 0.2,
  SHOULDER_WIDTH: 1.8,
  HIP_WIDTH: 1.0,
  ROOT_SIZE: 0.25,
  LIMB_WIDTH_ARM: 0.24,
  LIMB_WIDTH_FOREARM: 0.22,
  LIMB_WIDTH_THIGH: 0.30,
  LIMB_WIDTH_CALF: 0.26,
  HAND_WIDTH: 0.18,
  FOOT_WIDTH: 0.30,
  TOE_WIDTH: 0.2,
  EFFECTOR_WIDTH: 0.1,
};

export const RIGGING = {
  // Bitruvius shoulders are offset significantly from the neck base
  L_SHOULDER_X_OFFSET_FROM_COLLAR_CENTER: -0.73, 
  R_SHOULDER_X_OFFSET_FROM_COLLAR_CENTER: 0.73,
  // Seat shoulders halfway up the collar to align with side "S" centers.
  SHOULDER_Y_OFFSET_FROM_COLLAR_END: -(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.COLLAR * 0.5),
  COLLAR_OFFSET_Y: 0.0,
};

// Normalized (0..1) anchors in each texture's viewBox space.
export const DEFAULT_VISUAL_ANCHORS: Record<keyof WalkingEngineProportions, PartVisualAnchors> = {
  head: { parent: { x: 0.5, y: 0.95 }, child: { x: 0.5, y: 0.08 } },
  collar: { parent: { x: 0.5, y: 0.72 }, child: { x: 0.5, y: 0.24 } },
  torso: { parent: { x: 0.5, y: 0.9 }, child: { x: 0.5, y: 0.18 } },
  waist: { parent: { x: 0.5, y: 0.5 }, child: { x: 0.5, y: 0.5 } },
  l_upper_arm: { parent: { x: 0.5, y: 0.12 }, child: { x: 0.5, y: 0.95 } },
  l_lower_arm: { parent: { x: 0.5, y: 0.12 }, child: { x: 0.5, y: 0.95 } },
  l_hand: { parent: { x: 0.5, y: 0.14 }, child: { x: 0.5, y: 0.95 } },
  r_upper_arm: { parent: { x: 0.5, y: 0.12 }, child: { x: 0.5, y: 0.95 } },
  r_lower_arm: { parent: { x: 0.5, y: 0.12 }, child: { x: 0.5, y: 0.95 } },
  r_hand: { parent: { x: 0.5, y: 0.14 }, child: { x: 0.5, y: 0.95 } },
  l_upper_leg: { parent: { x: 0.5, y: 0.15 }, child: { x: 0.5, y: 0.94 } },
  l_lower_leg: { parent: { x: 0.5, y: 0.12 }, child: { x: 0.5, y: 0.95 } },
  l_foot: { parent: { x: 0.5, y: 0.16 }, child: { x: 0.5, y: 0.95 } },
  l_toe: { parent: { x: 0.5, y: 0.16 }, child: { x: 0.5, y: 0.95 } },
  r_upper_leg: { parent: { x: 0.5, y: 0.15 }, child: { x: 0.5, y: 0.94 } },
  r_lower_leg: { parent: { x: 0.5, y: 0.12 }, child: { x: 0.5, y: 0.95 } },
  r_foot: { parent: { x: 0.5, y: 0.16 }, child: { x: 0.5, y: 0.95 } },
  r_toe: { parent: { x: 0.5, y: 0.16 }, child: { x: 0.5, y: 0.95 } },
};

export const DEFAULT_TEXTURE_VIEWBOXES: Record<keyof WalkingEngineProportions, TextureViewBox> = {
  head: { width: 1504, height: 1504 },
  collar: { width: 1800, height: 1275 },
  torso: { width: 1504, height: 1504 },
  waist: { width: 1800, height: 1800 },
  l_upper_arm: { width: 1800, height: 1800 },
  l_lower_arm: { width: 1800, height: 1800 },
  l_hand: { width: 1504, height: 1504 },
  r_upper_arm: { width: 1800, height: 1800 },
  r_lower_arm: { width: 1800, height: 1800 },
  r_hand: { width: 1504, height: 1504 },
  l_upper_leg: { width: 1800, height: 1800 },
  l_lower_leg: { width: 1800, height: 1800 },
  l_foot: { width: 1504, height: 1504 },
  l_toe: { width: 320, height: 223 },
  r_upper_leg: { width: 1800, height: 1800 },
  r_lower_leg: { width: 1800, height: 1800 },
  r_foot: { width: 1504, height: 1504 },
  r_toe: { width: 320, height: 223 },
};

export const MANNEQUIN_LOCAL_FLOOR_Y = 
    ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_UPPER + 
    ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_LOWER +
    ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.FOOT;

export const GROUND_STRIP_HEIGHT_RAW_H_UNIT = 0.2;
export const GROUND_STRIP_COLOR = '#1e293b'; 

type RotationValues = Omit<Pose, 'root' | 'offsets'>;

export const BASE_ROTATIONS: RotationValues = {
  bodyRotation: 0, torso: 0, waist: 0, collar: 0, head: 0,
  lShoulder: 0, lForearm: 0, lWrist: 0,
  rShoulder: 0, rForearm: 0, rWrist: 0,
  lThigh: 0, lCalf: 0, lAnkle: 0,
  rThigh: 0, rCalf: 0, rAnkle: 0,
};

export const RESET_POSE: Pose = {
  root: { x: 0, y: 0 }, 
  ...BASE_ROTATIONS,
  offsets: {
    [PartName.Collar]: {x: 0, y: RIGGING.COLLAR_OFFSET_Y}
  },
};

export const JOINT_LIMITS: JointLimits = {
  [PartName.Waist]: { min: -180, max: 180 }, 
  [PartName.Torso]: { min: -180, max: 180 },
  [PartName.Collar]: { min: -180, max: 180 },
  [PartName.Head]: { min: -180, max: 180 },
  [PartName.RShoulder]: { min: -180, max: 180 }, 
  rForearm: { min: -180, max: 180 },         
  [PartName.RWrist]: { min: -180, max: 180 }, 
  [PartName.LShoulder]: { min: -180, max: 180 }, 
  lForearm: { min: -180, max: 180 },          
  [PartName.LWrist]: { min: -180, max: 180 }, 
  [PartName.RThigh]: { min: -180, max: 180 }, 
  rCalf: { min: -180, max: 180 },           
  [PartName.RAnkle]: { min: -180, max: 180 }, 
  [PartName.LThigh]: { min: -180, max: 180 },
  lCalf: { min: -180, max: 180 },
  lAnkle: { min: -180, max: 180 },
};
