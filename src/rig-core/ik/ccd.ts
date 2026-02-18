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
  degToRad,
  distanceVec2,
  getSegmentLength,
  normalizeSignedAngleDeg,
  normalizeVec2,
  rotateVec2,
  subVec2,
} from "../graph";
import { resolveSoftStretchRatio, type SoftStretchConfig } from "./stretch";

export type CcdSolveInput = {
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
  softStretch?: Partial<SoftStretchConfig>;
};

export type CcdSolveResult = {
  positions: Partial<Record<JointId, Vec2>>;
  residual: number;
  iterations: number;
};

const rotateAround = (point: Vec2, pivot: Vec2, angleDeg: number): Vec2 => {
  const s = Math.sin(degToRad(angleDeg));
  const c = Math.cos(degToRad(angleDeg));
  const translated = subVec2(point, pivot);
  const rotated = {
    x: translated.x * c - translated.y * s,
    y: translated.x * s + translated.y * c,
  };
  return addVec2(pivot, rotated);
};

const applyPins = (chain: JointId[], positions: Vec2[], pins: PinConstraint[]): void => {
  const indexByJoint = new Map<JointId, number>();
  chain.forEach((jointId, idx) => indexByJoint.set(jointId, idx));
  for (const pin of pins) {
    const idx = indexByJoint.get(pin.jointId);
    if (idx === undefined) continue;
    const current = positions[idx];
    if (pin.kind === "world") {
      positions[idx] = {
        x: pin.lockX ? pin.x : current.x,
        y: pin.lockY ? pin.y : current.y,
      };
    } else {
      positions[idx] = { ...current, y: pin.groundY };
    }
  }
};

const projectRootToPins = (root: Vec2, chainRootId: JointId, pins: PinConstraint[]): Vec2 => {
  let projected = { ...root };
  for (const pin of pins) {
    if (pin.jointId !== chainRootId) continue;
    if (pin.kind === "world") {
      if (pin.lockX) projected.x = pin.x;
      if (pin.lockY) projected.y = pin.y;
    } else {
      projected.y = pin.groundY;
    }
  }
  return projected;
};

const enforcePoleForThreeJointChain = (
  positions: Vec2[],
  segmentLengths: number[],
  poleTarget?: Vec2
): void => {
  if (!poleTarget || positions.length !== 3) {
    return;
  }
  const root = positions[0];
  const effector = positions[2];
  const rootToEff = subVec2(effector, root);
  const dir = normalizeVec2(rootToEff);
  const a = segmentLengths[0];
  const b = segmentLengths[1];
  const base = addVec2(root, { x: dir.x * a, y: dir.y * a });
  const perp = { x: -dir.y, y: dir.x };
  const candidateA = addVec2(base, { x: perp.x * b, y: perp.y * b });
  const candidateB = addVec2(base, { x: -perp.x * b, y: -perp.y * b });
  const distA = distanceVec2(candidateA, poleTarget);
  const distB = distanceVec2(candidateB, poleTarget);
  positions[1] = distA <= distB ? candidateA : candidateB;
};

export const solveCcdChain = ({
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
  softStretch,
}: CcdSolveInput): CcdSolveResult => {
  if (chain.length < 2) {
    return { positions: {}, residual: 0, iterations: 0 };
  }

  const positions = chain.map((jointId) => ({ ...world[jointId].worldPosition }));
  const baseSegmentLengths: number[] = [];
  for (let i = 0; i < chain.length - 1; i += 1) {
    baseSegmentLengths.push(getSegmentLength(joints, chain[i], chain[i + 1]));
  }

  const rootPinned = projectRootToPins(positions[0], chain[0], pins);
  positions[0] = rootPinned;

  const totalLength = baseSegmentLengths.reduce((acc, v) => acc + v, 0);
  const distToTarget = distanceVec2(rootPinned, target);
  const stretchRatio =
    allowStretch && totalLength > 1e-8
      ? resolveSoftStretchRatio(distToTarget, totalLength, {
          enabled: true,
          ...softStretch,
        })
      : 1;
  const segmentLengths = baseSegmentLengths.map((len) => Math.max(1e-5, len * stretchRatio));

  let residual = distanceVec2(positions[positions.length - 1], target);
  let iterations = 0;

  for (let iter = 0; iter < Math.max(1, maxIterations); iter += 1) {
    iterations = iter + 1;

    for (let pivotIndex = chain.length - 2; pivotIndex >= 0; pivotIndex -= 1) {
      const pivot = positions[pivotIndex];
      const effector = positions[chain.length - 1];
      const toEffector = subVec2(effector, pivot);
      const toTarget = subVec2(target, pivot);
      const effLen = Math.hypot(toEffector.x, toEffector.y);
      const tgtLen = Math.hypot(toTarget.x, toTarget.y);
      if (effLen <= 1e-8 || tgtLen <= 1e-8) {
        continue;
      }
      const dot = toEffector.x * toTarget.x + toEffector.y * toTarget.y;
      const det = toEffector.x * toTarget.y - toEffector.y * toTarget.x;
      const deltaDeg = normalizeSignedAngleDeg((Math.atan2(det, dot) * 180) / Math.PI);

      for (let j = pivotIndex + 1; j < positions.length; j += 1) {
        positions[j] = rotateAround(positions[j], pivot, deltaDeg);
      }

      const limits = jointLimits?.[chain[pivotIndex]];
      if (limits && pivotIndex > 0 && pivotIndex < chain.length - 1) {
        const parentVec = subVec2(positions[pivotIndex], positions[pivotIndex - 1]);
        const childVec = subVec2(positions[pivotIndex + 1], positions[pivotIndex]);
        if (Math.hypot(parentVec.x, parentVec.y) > 1e-8 && Math.hypot(childVec.x, childVec.y) > 1e-8) {
          const parentAngle = angleDegOfVec2(parentVec);
          const childAngle = angleDegOfVec2(childVec);
          const localAngle = normalizeSignedAngleDeg(childAngle - parentAngle);
          const clamped = clamp(localAngle, limits.minDeg, limits.maxDeg);
          const correction = clamped - localAngle;
          if (Math.abs(correction) > 1e-5) {
            for (let j = pivotIndex + 1; j < positions.length; j += 1) {
              positions[j] = rotateAround(positions[j], positions[pivotIndex], correction);
            }
          }
        }
      }
    }

    enforcePoleForThreeJointChain(positions, segmentLengths, poleTarget);
    applyPins(chain, positions, pins);
    positions[0] = projectRootToPins(positions[0], chain[0], pins);
    residual = distanceVec2(positions[positions.length - 1], target);
    if (residual <= epsilon) {
      break;
    }
  }

  const map: Partial<Record<JointId, Vec2>> = {};
  chain.forEach((jointId, idx) => {
    map[jointId] = { ...positions[idx] };
  });

  return { positions: map, residual, iterations };
};
