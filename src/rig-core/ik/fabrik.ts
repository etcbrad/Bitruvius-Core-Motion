import {
  JointId,
  JointLimitDeg,
  JointState,
  PinConstraint,
  RigWorldTransforms,
  Vec2,
} from "../types";
import {
  addVec2,
  angleDegOfVec2,
  clamp,
  cloneJoints,
  computeWorldTransforms,
  distanceVec2,
  getSegmentLength,
  inverseRotateVec2,
  normalizeSignedAngleDeg,
  normalizeVec2,
  scaleVec2,
  subVec2,
} from "../graph";

export type FabrikSolveInput = {
  chain: JointId[];
  joints: Record<JointId, JointState>;
  world: RigWorldTransforms;
  target: Vec2;
  poleTarget?: Vec2;
  pins: PinConstraint[];
  jointLimits?: Partial<Record<JointId, JointLimitDeg>>;
  maxIterations: number;
  epsilon: number;
  allowStretch?: boolean;
};

export type FabrikSolveResult = {
  positions: Partial<Record<JointId, Vec2>>;
  residual: number;
  iterations: number;
  reachable: boolean;
};

const safeDirection = (from: Vec2, to: Vec2): Vec2 => {
  const delta = subVec2(to, from);
  const normalized = normalizeVec2(delta);
  if (Math.abs(normalized.x) <= 1e-8 && Math.abs(normalized.y) <= 1e-8) {
    return { x: 0, y: 1 };
  }
  return normalized;
};

const projectRootToPins = (root: Vec2, rootJointId: JointId, pins: PinConstraint[]): Vec2 => {
  let projected = { ...root };
  for (const pin of pins) {
    if (pin.jointId !== rootJointId) {
      continue;
    }
    if (pin.kind === "world") {
      if (pin.lockX) {
        projected.x = pin.x;
      }
      if (pin.lockY) {
        projected.y = pin.y;
      }
    } else {
      projected.y = pin.groundY;
    }
  }
  return projected;
};

const enforceJointLimits = (
  chain: JointId[],
  positions: Vec2[],
  segmentLengths: number[],
  jointLimits: Partial<Record<JointId, JointLimitDeg>> | undefined
): void => {
  if (!jointLimits || chain.length < 3) {
    return;
  }

  for (let index = 1; index < chain.length - 1; index += 1) {
    const jointId = chain[index];
    const limits = jointLimits[jointId];
    if (!limits) {
      continue;
    }

    const parentPoint = positions[index - 1];
    const jointPoint = positions[index];
    const childPoint = positions[index + 1];
    const parentVector = subVec2(jointPoint, parentPoint);
    const childVector = subVec2(childPoint, jointPoint);
    if (distanceVec2(parentPoint, jointPoint) <= 1e-8 || distanceVec2(jointPoint, childPoint) <= 1e-8) {
      continue;
    }

    const parentAngle = angleDegOfVec2(parentVector);
    const childAngle = angleDegOfVec2(childVector);
    const localAngle = normalizeSignedAngleDeg(childAngle - parentAngle);
    const clampedLocalAngle = clamp(localAngle, limits.minDeg, limits.maxDeg);
    if (Math.abs(clampedLocalAngle - localAngle) <= 1e-6) {
      continue;
    }

    const desiredWorldAngle = parentAngle + clampedLocalAngle;
    const desiredChild = addVec2(
      jointPoint,
      scaleVec2(
        {
          x: Math.cos((desiredWorldAngle * Math.PI) / 180),
          y: Math.sin((desiredWorldAngle * Math.PI) / 180),
        },
        segmentLengths[index]
      )
    );

    const delta = subVec2(desiredChild, childPoint);
    positions[index + 1] = desiredChild;
    for (let downstream = index + 2; downstream < positions.length; downstream += 1) {
      positions[downstream] = addVec2(positions[downstream], delta);
    }
  }
};

const applyChainPins = (chain: JointId[], positions: Vec2[], pins: PinConstraint[]): void => {
  const indexByJoint = new Map<JointId, number>();
  chain.forEach((jointId, index) => indexByJoint.set(jointId, index));

  for (const pin of pins) {
    const chainIndex = indexByJoint.get(pin.jointId);
    if (chainIndex === undefined) {
      continue;
    }
    const current = positions[chainIndex];
    if (pin.kind === "world") {
      positions[chainIndex] = {
        x: pin.lockX ? pin.x : current.x,
        y: pin.lockY ? pin.y : current.y,
      };
      continue;
    }
    positions[chainIndex] = {
      ...current,
      y: pin.groundY,
    };
  }
};

const buildPositionMap = (chain: JointId[], positions: Vec2[]): Partial<Record<JointId, Vec2>> => {
  const byJoint: Partial<Record<JointId, Vec2>> = {};
  for (let index = 0; index < chain.length; index += 1) {
    byJoint[chain[index]] = { ...positions[index] };
  }
  return byJoint;
};

const enforcePoleTargetForThreeJointChain = (
  positions: Vec2[],
  segmentLengths: number[],
  poleTarget: Vec2 | undefined
): void => {
  if (!poleTarget || positions.length !== 3 || segmentLengths.length !== 2) {
    return;
  }

  const root = positions[0];
  const effector = positions[2];
  const upperLength = segmentLengths[0];
  const lowerLength = segmentLengths[1];
  const rootToEffector = subVec2(effector, root);
  const distance = Math.hypot(rootToEffector.x, rootToEffector.y);
  if (!Number.isFinite(distance) || distance <= 1e-8) {
    return;
  }

  const maxReach = upperLength + lowerLength;
  const minReach = Math.abs(upperLength - lowerLength);
  const clampedDistance = clamp(distance, minReach + 1e-6, maxReach - 1e-6);
  const dir = { x: rootToEffector.x / distance, y: rootToEffector.y / distance };
  const a = (upperLength * upperLength - lowerLength * lowerLength + clampedDistance * clampedDistance) / (2 * clampedDistance);
  const hSquared = upperLength * upperLength - a * a;
  if (!Number.isFinite(hSquared) || hSquared <= 0) {
    return;
  }
  const h = Math.sqrt(hSquared);
  const basePoint = addVec2(root, scaleVec2(dir, a));
  const perpendicular = { x: -dir.y, y: dir.x };
  const candidateA = addVec2(basePoint, scaleVec2(perpendicular, h));
  const candidateB = addVec2(basePoint, scaleVec2(perpendicular, -h));
  const distanceToA = distanceVec2(candidateA, poleTarget);
  const distanceToB = distanceVec2(candidateB, poleTarget);
  positions[1] = distanceToA <= distanceToB ? candidateA : candidateB;
};

export const solveFabrikChain = ({
  chain,
  joints,
  world,
  target,
  poleTarget,
  pins,
  jointLimits,
  maxIterations,
  epsilon,
  allowStretch = false,
}: FabrikSolveInput): FabrikSolveResult => {
  if (chain.length < 2) {
    return {
      positions: {},
      residual: 0,
      iterations: 0,
      reachable: true,
    };
  }

  const positions = chain.map((jointId) => ({ ...world[jointId].worldPosition }));
  const baseSegmentLengths: number[] = [];
  for (let index = 0; index < chain.length - 1; index += 1) {
    const parentId = chain[index];
    const childId = chain[index + 1];
    baseSegmentLengths.push(getSegmentLength(joints, parentId, childId));
  }

  let root = projectRootToPins(positions[0], chain[0], pins);
  const distToTargetFromRoot = distanceVec2(root, target);
  const baseChainLength = baseSegmentLengths.reduce((acc, value) => acc + value, 0);

  const segmentLengths =
    allowStretch && baseChainLength > 1e-8 && distToTargetFromRoot > baseChainLength + 1e-8
      ? baseSegmentLengths.map((length) => Math.max(1e-5, length * (distToTargetFromRoot / baseChainLength)))
      : baseSegmentLengths;

  const chainLength = segmentLengths.reduce((acc, value) => acc + value, 0);
  const reachable = distToTargetFromRoot <= chainLength + 1e-8;

  const enforceFromRoot = () => {
    positions[0] = { ...root };
    for (let index = 1; index < positions.length; index += 1) {
      const direction = safeDirection(positions[index - 1], positions[index]);
      positions[index] = addVec2(positions[index - 1], scaleVec2(direction, segmentLengths[index - 1]));
    }
  };

  if (!reachable) {
    const direction = safeDirection(root, target);
    positions[0] = { ...root };
    for (let index = 1; index < positions.length; index += 1) {
      positions[index] = addVec2(positions[index - 1], scaleVec2(direction, segmentLengths[index - 1]));
    }
    applyChainPins(chain, positions, pins);
    root = projectRootToPins(positions[0], chain[0], pins);
    enforceFromRoot();
    enforcePoleTargetForThreeJointChain(positions, segmentLengths, poleTarget);
    applyChainPins(chain, positions, pins);
    const residual = distanceVec2(positions[positions.length - 1], target);
    return {
      positions: buildPositionMap(chain, positions),
      residual,
      iterations: 1,
      reachable,
    };
  }

  let residual = Number.POSITIVE_INFINITY;
  let iterations = 0;

  for (let iteration = 0; iteration < Math.max(1, maxIterations); iteration += 1) {
    iterations = iteration + 1;

    positions[positions.length - 1] = { ...target };
    for (let index = positions.length - 2; index >= 0; index -= 1) {
      const direction = safeDirection(positions[index + 1], positions[index]);
      positions[index] = addVec2(positions[index + 1], scaleVec2(direction, segmentLengths[index]));
    }

    root = projectRootToPins(root, chain[0], pins);
    positions[0] = { ...root };
    for (let index = 1; index < positions.length; index += 1) {
      const direction = safeDirection(positions[index - 1], positions[index]);
      positions[index] = addVec2(positions[index - 1], scaleVec2(direction, segmentLengths[index - 1]));
    }

    enforcePoleTargetForThreeJointChain(positions, segmentLengths, poleTarget);
    enforceJointLimits(chain, positions, segmentLengths, jointLimits);
    applyChainPins(chain, positions, pins);
    root = projectRootToPins(positions[0], chain[0], pins);
    enforceFromRoot();
    applyChainPins(chain, positions, pins);

    residual = distanceVec2(positions[positions.length - 1], target);
    if (residual <= epsilon) {
      break;
    }
  }

  return {
    positions: buildPositionMap(chain, positions),
    residual,
    iterations,
    reachable,
  };
};

export const commitChainPositionsToJoints = (
  joints: Record<JointId, JointState>,
  chain: JointId[],
  solvedPositions: Partial<Record<JointId, Vec2>>,
  options: { allowStretch?: boolean; jointLimits?: Partial<Record<JointId, JointLimitDeg>> } = {}
): Record<JointId, JointState> => {
  if (chain.length < 2) {
    return joints;
  }

  const next = cloneJoints(joints);
  const rootId = chain[0];
  const rootPos = solvedPositions[rootId];
  if (rootPos && !next[rootId].parentId) {
    next[rootId] = {
      ...next[rootId],
      localTranslation: { ...rootPos },
    };
  }

  for (let index = 0; index < chain.length - 1; index += 1) {
    const jointId = chain[index];
    const childId = chain[index + 1];
    const parentPoint = solvedPositions[jointId];
    const childPoint = solvedPositions[childId];
    if (!parentPoint || !childPoint) {
      continue;
    }

    const desiredWorldVector = subVec2(childPoint, parentPoint);
    if (Math.abs(desiredWorldVector.x) <= 1e-8 && Math.abs(desiredWorldVector.y) <= 1e-8) {
      continue;
    }

    const bindVector = next[childId].localTranslation;
    const bindAngle = angleDegOfVec2(
      Math.abs(bindVector.x) <= 1e-8 && Math.abs(bindVector.y) <= 1e-8 ? { x: 0, y: 1 } : bindVector
    );
    const desiredWorldAngle = angleDegOfVec2(desiredWorldVector);
    const worldNow = computeWorldTransforms(next);
    const parentParentId = next[jointId].parentId;
    const parentParentWorldRotation = parentParentId ? worldNow[parentParentId].worldRotationDeg : 0;
    const requiredLocalRotation = desiredWorldAngle - bindAngle - parentParentWorldRotation;
    const limits = options.jointLimits?.[jointId];
    const limitedLocalRotation =
      limits
        ? clamp(
            normalizeSignedAngleDeg(requiredLocalRotation),
            limits.minDeg,
            limits.maxDeg
          )
        : requiredLocalRotation;

    next[jointId] = {
      ...next[jointId],
      localRotationDegRaw: ((limitedLocalRotation % 360) + 360) % 360,
    };
  }

  if (!options.allowStretch) {
    return next;
  }

  const worldAfterRotation = computeWorldTransforms(next);

  for (let index = 1; index < chain.length; index += 1) {
    const jointId = chain[index];
    const parentId = next[jointId].parentId;
    const jointPoint = solvedPositions[jointId];
    if (!parentId || !jointPoint) {
      continue;
    }

    const parentPoint = solvedPositions[parentId] ?? worldAfterRotation[parentId].worldPosition;
    const parentRotation = worldAfterRotation[parentId].worldRotationDeg;
    const nextLocalTranslation = inverseRotateVec2(subVec2(jointPoint, parentPoint), parentRotation);

    next[jointId] = {
      ...next[jointId],
      localTranslation: nextLocalTranslation,
    };
  }

  return next;
};
