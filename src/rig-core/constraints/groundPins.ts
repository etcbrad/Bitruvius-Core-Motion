import { computeWorldTransforms } from "../graph";
import { applyPinsToWorldTransforms } from "../pins";
import { IK_CHAIN_BY_EFFECTOR, isLegEffector } from "../topology";
import {
  DEFAULT_CONSTRAINT_SETTINGS,
  type ConstraintSettings,
  type JointId,
  type JointState,
  type PinConstraint,
  type Vec2,
} from "../types";

const ANKLE_JOINT_IDS: JointId[] = ["l_foot", "r_foot"];
const GROUND_LIFT_EPSILON = 1e-3;
const MAX_GROUND_PINNED_IK_STRETCH_RATIO = 1.75;

const getLegAnkleForJoint = (jointId: JointId): JointId | null => {
  if (jointId === "l_hip" || jointId === "l_knee" || jointId === "l_foot") {
    return "l_foot";
  }
  if (jointId === "r_hip" || jointId === "r_knee" || jointId === "r_foot") {
    return "r_foot";
  }
  return null;
};

export const releaseGroundedAnklePinsIfLifted = (
  joints: Record<JointId, JointState>,
  pins: PinConstraint[],
  manipulatedJointId: JointId | null | undefined,
  constraintSettings: ConstraintSettings
): PinConstraint[] => {
  if (!constraintSettings.releaseGroundedAnkleWhenLegLifts || !manipulatedJointId) {
    return pins;
  }

  const ankleId = getLegAnkleForJoint(manipulatedJointId);
  if (!ankleId || manipulatedJointId === ankleId) {
    return pins;
  }

  const groundPin = pins.find(
    (pin): pin is Extract<PinConstraint, { kind: "ground" }> =>
      pin.kind === "ground" && pin.jointId === ankleId
  );
  if (!groundPin) {
    return pins;
  }

  const pinsWithoutAnkle = pins.filter((pin) => pin.jointId !== ankleId);
  const previewWorld = applyPinsToWorldTransforms(computeWorldTransforms(joints), pinsWithoutAnkle).world;
  const previewAnkleY = previewWorld[ankleId]?.worldPosition.y;
  if (previewAnkleY === undefined || previewAnkleY >= groundPin.groundY - GROUND_LIFT_EPSILON) {
    return pins;
  }

  return pinsWithoutAnkle;
};

export const buildPinsWithGroundedAnkleXLocks = (
  joints: Record<JointId, JointState>,
  pins: PinConstraint[],
  manipulatedJointId: JointId | null | undefined,
  constraintSettings: ConstraintSettings
): PinConstraint[] => {
  if (!constraintSettings.lockGroundedAnklesX) {
    return pins;
  }

  const groundedAnklePins = pins.filter(
    (pin): pin is Extract<PinConstraint, { kind: "ground" }> =>
      pin.kind === "ground" && ANKLE_JOINT_IDS.includes(pin.jointId)
  );
  if (!groundedAnklePins.length) {
    return pins;
  }

  const world = computeWorldTransforms(joints);
  const projected = applyPinsToWorldTransforms(world, pins).world;
  const xLockPins: PinConstraint[] = [];

  for (const groundPin of groundedAnklePins) {
    if (groundPin.jointId === manipulatedJointId) {
      continue;
    }
    const existingWorldPin = pins.find(
      (pin) => pin.kind === "world" && pin.jointId === groundPin.jointId && pin.lockX
    );
    if (existingWorldPin) {
      continue;
    }
    const ankleWorld = projected[groundPin.jointId]?.worldPosition;
    if (!ankleWorld) {
      continue;
    }
    xLockPins.push({
      kind: "world",
      jointId: groundPin.jointId,
      x: ankleWorld.x,
      y: ankleWorld.y,
      lockX: true,
      lockY: false,
    });
  }

  return xLockPins.length ? [...pins, ...xLockPins] : pins;
};

export const clampIkTargetForGroundedReach = (
  joints: Record<JointId, JointState>,
  pins: PinConstraint[],
  jointId: JointId,
  target: Vec2,
  ikStretchEnabled: boolean,
  constraintSettings: ConstraintSettings
): Vec2 => {
  const settings = { ...DEFAULT_CONSTRAINT_SETTINGS, ...constraintSettings };
  if (settings.ikFrictionOff || !settings.clampGroundedIkTargetReach) {
    return target;
  }

  const hasAnyFootGroundPin = pins.some(
    (pin) =>
      pin.kind === "ground" &&
      (pin.jointId === "l_foot" || pin.jointId === "r_foot")
  );
  if (!hasAnyFootGroundPin) {
    return target;
  }

  const chain = IK_CHAIN_BY_EFFECTOR[jointId];
  if (!chain || chain.length < 2) {
    return target;
  }

  const projectedWorld = applyPinsToWorldTransforms(
    computeWorldTransforms(joints),
    pins
  ).world;
  const rootWorld = projectedWorld[chain[0]]?.worldPosition;
  if (!rootWorld) {
    return target;
  }

  let baseReach = 0;
  for (let index = 1; index < chain.length; index += 1) {
    const childId = chain[index];
    const local = joints[childId]?.localTranslation;
    if (!local) {
      continue;
    }
    baseReach += Math.hypot(local.x, local.y);
  }

  const stretchMultiplier =
    ikStretchEnabled && !isLegEffector(jointId)
      ? MAX_GROUND_PINNED_IK_STRETCH_RATIO
      : 1;
  const maxReach = baseReach * stretchMultiplier;
  if (maxReach <= 0) {
    return target;
  }

  const dx = target.x - rootWorld.x;
  const dy = target.y - rootWorld.y;
  const distance = Math.hypot(dx, dy);
  if (!Number.isFinite(distance) || distance <= maxReach) {
    return target;
  }

  const t = maxReach / distance;
  return {
    x: rootWorld.x + dx * t,
    y: rootWorld.y + dy * t,
  };
};
