
import { PartName, Pose, Vector2D, JointLimits } from './types';

export const SCALE_FACTOR = 1;
export const BASE_HEAD_UNIT = 50;

// Proportions aligned with Prometheus V2 (Ratios derived from 75px Head height)
export const ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT = {
  HEAD: 1.0, 
  HEAD_WIDTH: 0.8,
  HEAD_NECK_GAP_OFFSET: 0.0,
  COLLAR: 0.53, 
  COLLAR_WIDTH: 1.46, // Prometheus shoulders are 110px wide total
  TORSO: 1.06, 
  TORSO_WIDTH: 0.7, 
  WAIST: 1.06, 
  WAIST_WIDTH: 0.9, 
  UPPER_ARM: 1.06, 
  LOWER_ARM: 1.13, 
  HAND: 0.4, 
  LEG_UPPER: 1.73, 
  LEG_LOWER: 1.6, 
  FOOT: 0.4, 
  TOE: 0.26, 
  SHOULDER_WIDTH: 1.46,
  HIP_WIDTH: 0.93, // 70px wide pelvis
  ROOT_SIZE: 0.25,
  LIMB_WIDTH_ARM: 0.18,
  LIMB_WIDTH_FOREARM: 0.15,
  LIMB_WIDTH_THIGH: 0.25,
  LIMB_WIDTH_CALF: 0.22,
  HAND_WIDTH: 0.15,
  FOOT_WIDTH: 0.2,
  TOE_WIDTH: 0.2,
  EFFECTOR_WIDTH: 0.1,
};

export const RIGGING = {
  // Prometheus shoulders are offset significantly from the neck base
  L_SHOULDER_X_OFFSET_FROM_COLLAR_CENTER: -0.73, 
  R_SHOULDER_X_OFFSET_FROM_COLLAR_CENTER: 0.73,
  SHOULDER_Y_OFFSET_FROM_COLLAR_END: 0.05, // Slight drop
  COLLAR_OFFSET_Y: 0.0,
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
