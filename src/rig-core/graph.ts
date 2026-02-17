import { JOINT_IDS, JointId, JointState, RigWorldTransforms, Vec2 } from "./types";

export const normalizeAngleDeg = (rawDeg: number): number => {
  const normalized = ((rawDeg % 360) + 360) % 360;
  return Number.isFinite(normalized) ? normalized : 0;
};

export const normalizeSignedAngleDeg = (rawDeg: number): number => {
  const angle = normalizeAngleDeg(rawDeg);
  return angle > 180 ? angle - 360 : angle;
};

export const clamp = (value: number, min: number, max: number): number =>
  Math.max(min, Math.min(max, value));

export const degToRad = (deg: number): number => (deg * Math.PI) / 180;
export const radToDeg = (rad: number): number => (rad * 180) / Math.PI;

export const addVec2 = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x + b.x, y: a.y + b.y });
export const subVec2 = (a: Vec2, b: Vec2): Vec2 => ({ x: a.x - b.x, y: a.y - b.y });
export const scaleVec2 = (v: Vec2, scalar: number): Vec2 => ({ x: v.x * scalar, y: v.y * scalar });
export const lengthVec2 = (v: Vec2): number => Math.hypot(v.x, v.y);
export const distanceVec2 = (a: Vec2, b: Vec2): number => lengthVec2(subVec2(a, b));

export const normalizeVec2 = (v: Vec2): Vec2 => {
  const length = lengthVec2(v);
  if (length <= 1e-8) {
    return { x: 0, y: 0 };
  }
  return { x: v.x / length, y: v.y / length };
};

export const angleDegOfVec2 = (v: Vec2): number => radToDeg(Math.atan2(v.y, v.x));

export const rotateVec2 = (v: Vec2, angleDeg: number): Vec2 => {
  const angleRad = degToRad(angleDeg);
  const c = Math.cos(angleRad);
  const s = Math.sin(angleRad);
  return {
    x: v.x * c - v.y * s,
    y: v.x * s + v.y * c,
  };
};

export const inverseRotateVec2 = (v: Vec2, angleDeg: number): Vec2 => rotateVec2(v, -angleDeg);

export const cloneJoints = (joints: Record<JointId, JointState>): Record<JointId, JointState> => {
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

export const buildChildMap = (joints: Record<JointId, JointState>): Record<JointId, JointId[]> => {
  const map = {} as Record<JointId, JointId[]>;
  for (const jointId of JOINT_IDS) {
    map[jointId] = [];
  }
  for (const jointId of JOINT_IDS) {
    const parentId = joints[jointId].parentId;
    if (parentId) {
      map[parentId].push(jointId);
    }
  }
  return map;
};

export const computeWorldTransforms = (joints: Record<JointId, JointState>): RigWorldTransforms => {
  const world = {} as RigWorldTransforms;

  for (const jointId of JOINT_IDS) {
    const joint = joints[jointId];
    if (!joint.parentId) {
      world[jointId] = {
        id: jointId,
        parentId: null,
        worldPosition: { ...joint.localTranslation },
        worldRotationDeg: normalizeAngleDeg(joint.localRotationDegRaw),
      };
      continue;
    }

    const parentWorld = world[joint.parentId];
    const localRot = normalizeAngleDeg(joint.localRotationDegRaw);
    const worldRotationDeg = normalizeAngleDeg(parentWorld.worldRotationDeg + localRot);
    const rotatedOffset = rotateVec2(joint.localTranslation, parentWorld.worldRotationDeg);
    const worldPosition = addVec2(parentWorld.worldPosition, rotatedOffset);

    world[jointId] = {
      id: jointId,
      parentId: joint.parentId,
      worldPosition,
      worldRotationDeg,
    };
  }

  return world;
};

export const extractWorldPositions = (world: RigWorldTransforms): Record<JointId, Vec2> => {
  const positions = {} as Record<JointId, Vec2>;
  for (const jointId of JOINT_IDS) {
    positions[jointId] = { ...world[jointId].worldPosition };
  }
  return positions;
};

export const bakeWorldPositionsIntoJointTranslations = (
  joints: Record<JointId, JointState>,
  worldPositions: Partial<Record<JointId, Vec2>>
): Record<JointId, JointState> => {
  const next = cloneJoints(joints);
  const world = computeWorldTransforms(next);
  const resolvedWorldPositions = {} as Record<JointId, Vec2>;

  for (const jointId of JOINT_IDS) {
    const targetWorld = worldPositions[jointId] ?? world[jointId].worldPosition;
    resolvedWorldPositions[jointId] = { ...targetWorld };

    const parentId = next[jointId].parentId;
    if (!parentId) {
      next[jointId] = {
        ...next[jointId],
        localTranslation: { ...targetWorld },
      };
      continue;
    }

    const parentWorldPosition = resolvedWorldPositions[parentId];
    const parentWorldRotation = world[parentId].worldRotationDeg;
    const localTranslation = inverseRotateVec2(subVec2(targetWorld, parentWorldPosition), parentWorldRotation);

    next[jointId] = {
      ...next[jointId],
      localTranslation,
    };
  }

  return next;
};

export const getSegmentLength = (
  joints: Record<JointId, JointState>,
  parentId: JointId,
  childId: JointId
): number => {
  const byTranslation = lengthVec2(joints[childId].localTranslation);
  if (byTranslation > 1e-5) {
    return byTranslation;
  }
  return Math.max(1e-5, joints[parentId].length);
};
