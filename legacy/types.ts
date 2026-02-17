export enum PartName {
  Torso = 'torso',
  Waist = 'waist',
  Collar = 'collar',
  Head = 'head',
  RShoulder = 'rShoulder',
  RElbow = 'rElbow',
  RWrist = 'rWrist',
  LShoulder = 'lShoulder',
  LElbow = 'lElbow',
  LWrist = 'lWrist',
  RThigh = 'rThigh',
  RSkin = 'rSkin',
  RAnkle = 'rAnkle',
  LThigh = 'lThigh',
  LSkin = 'lCalf',
  LAnkle = 'lAnkle',
}

export type Vector2D = { x: number; y: number; };

export type MaskTransform = {
  x: number;
  y: number;
  rotation: number;
  scale: number;
  // Optional non-uniform scaling (multiplies `scale` on that axis).
  scaleX?: number;
  scaleY?: number;
  mode: 'cover' | 'project' | 'hidden';
  // Optional geometry controls for the underlying Primitive shape (used by head, etc.).
  geometry?: 'tapered';
  topWidth?: number;     // Ratio of `width` at the far end (0..n).
  bottomWidth?: number;  // Ratio of `width` at the root end (0..n).
};

export type VisualAnchor = {
  x: number;
  y: number;
};

export type PartVisualAnchors = {
  parent: VisualAnchor;
  child: VisualAnchor;
};

export type TextureViewBox = {
  x?: number;
  y?: number;
  width: number;
  height: number;
};

export type HardcodedAssetConfig = {
  host_line: keyof WalkingEngineProportions;
  anchor_point?: string;
  anchor_attach?: 'root' | 'tip';
  render_priority?: 'top' | 'bottom';
  proportions?: {
    width?: number;
    length?: number;
  };
  normalized_offset?: {
    x?: number; // Multiplied by host width.
    y?: number; // Multiplied by host length.
  };
  offset?: {
    x?: number;
    y?: number;
    rotation?: number;
  };
  texture?: string;
  mode?: 'cover' | 'project' | 'hidden';
  visual_logic?: 'fill_visible' | 'mask_only' | 'wireframe';
  alpha?: number;
  visual_anchors?: PartVisualAnchors;
  texture_viewbox?: TextureViewBox;
};

export type HardcodedAssetsMap = Record<string, HardcodedAssetConfig>;

export type WalkingEnginePose = {
  waist: number;
  neck: number; collar: number; torso: number;
  l_shoulder: number; r_shoulder: number;
  l_elbow: number; r_elbow: number;
  l_hand: number; r_hand: number;
  l_hip: number; r_hip: number;
  l_knee: number; r_knee: number;
  l_foot: number; r_foot: number;
  l_toe: number; r_toe: number;
  stride_phase: number;
  y_offset: number;
  x_offset: number;
};

export type WalkingEngineGait = {
  intensity: number;
  frequency: number;
  stride: number;
  lean: number;
  upper_body_lean: number;
  hip_sway: number;
  waist_twist: number;
  arm_swing: number;
  arm_spread: number;
  elbow_bend: number;
  gravity: number;
  verticality: number;
  kick_up_force: number;
  foot_roll: number;
  hover_height: number;
  toe_bend: number;
  torso_swivel: number;
  head_spin: number;
};

export type WalkingEnginePivotOffsets = {
  waist: number;
  neck: number; collar: number; torso: number;
  l_shoulder: number; r_shoulder: number;
  l_elbow: number; r_elbow: number;
  l_hand: number; r_hand: number;
  l_hip: number; r_hip: number;
  l_knee: number; r_knee: number;
  l_foot: number; r_foot: number;
  l_toe: number; r_toe: number;
};

export type WalkingEngineProportions = {
  head: { w: number; h: number };
  collar: { w: number; h: number };
  torso: { w: number; h: number };
  waist: { w: number; h: number };
  l_upper_arm: { w: number; h: number };
  l_lower_arm: { w: number; h: number };
  l_hand: { w: number; h: number };
  r_upper_arm: { w: number; h: number };
  r_lower_arm: { w: number; h: number };
  r_hand: { w: number; h: number };
  l_upper_leg: { w: number; h: number };
  l_lower_leg: { w: number; h: number };
  l_foot: { w: number; h: number };
  l_toe: { w: number; h: number };
  r_upper_leg: { w: number; h: number };
  r_lower_leg: { w: number; h: number };
  r_foot: { w: number; h: number };
  r_toe: { w: number; h: number };
};

export type GlobalPositions = Partial<Record<keyof WalkingEngineProportions, { position: Vector2D; rotation: number }>>;

export type JointLimits = {
  [key: string]: { min: number; max: number };
};

export type Pose = {
  root: Vector2D;
  bodyRotation: number;
  torso: number;
  waist: number;
  collar: number;
  head: number;
  lShoulder: number;
  lForearm: number;
  lWrist: number;
  rShoulder: number;
  rForearm: number;
  rWrist: number;
  lThigh: number;
  lCalf: number;
  lAnkle: number;
  rThigh: number;
  rCalf: number;
  rAnkle: number;
  offsets?: { [key: string]: Vector2D };
};

export type AnchorName = PartName | 'root' | 'lFootTip' | 'rFootTip';

// Mapping between PartName enum and Pose object keys for kinematic operations.
export const partNameToPoseKey: Record<string, keyof Pose> = {
  [PartName.Torso]: 'torso',
  [PartName.Waist]: 'waist',
  [PartName.Collar]: 'collar',
  [PartName.Head]: 'head',
  [PartName.RShoulder]: 'rShoulder',
  [PartName.RElbow]: 'rForearm' as any,
  [PartName.RWrist]: 'rWrist',
  [PartName.LShoulder]: 'lShoulder',
  [PartName.LElbow]: 'lForearm' as any,
  [PartName.LWrist]: 'lWrist',
  [PartName.RThigh]: 'rThigh',
  [PartName.RSkin]: 'rCalf' as any,
  [PartName.RAnkle]: 'rAnkle',
  [PartName.LThigh]: 'lThigh',
  [PartName.LSkin]: 'lCalf' as any,
  [PartName.LAnkle]: 'lAnkle',
};

// --- NEW DYNAMICS ENGINE TYPES ---

export type PhysicsState = {
  position: Vector2D;
  velocity: Vector2D;
  angularVelocity: number;
  worldGravity: Vector2D;
};

// A specific instruction to change the physics pivot during a clip.
export type AnimationPivotEvent = {
  time: number; // 0.0 to 1.0, relative to clip duration
  newPivot: keyof WalkingEnginePivotOffsets;
};

// Represents a single keyframe pose in an animation sequence.
export type Keyframe = {
  id: string;
  name: string;
  pose: WalkingEnginePivotOffsets;
  durationToNext: number; // in milliseconds
};

// A single, self-contained piece of motion.
export type AnimationClip = {
  id: string;
  name: string;
  duration: number; // in milliseconds
  startPose: WalkingEnginePivotOffsets;
  endPose: WalkingEnginePivotOffsets;
  easing?: 'linear' | 'ease-in' | 'ease-out' | 'elastic';
  pivotEvents?: AnimationPivotEvent[];
  // Optional: Add initial impulse forces for jumps, etc.
  // startImpulse?: { force: Vector2D; angular: number; };
};

export type MotionEnginePose = {
  [key: string]: number | Vector2D;
};

// Defines the behavior of a joint in a kinematic chain reaction.
export type JointChainBehaviors = Partial<Record<keyof WalkingEnginePivotOffsets, {
    b?: number; // Bend Factor (flexes, child follows parent)
    s?: number; // Stretch Factor (extends, child counter-rotates parent)
    l?: boolean; // Lead
}>>;
