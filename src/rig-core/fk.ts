import { ConstraintSettings, DEFAULT_CONSTRAINT_SETTINGS, JointId, JointState, PinConstraint } from "./types";
import { cloneJoints, computeWorldTransforms, normalizeSignedAngleDeg, rotateVec2 } from "./graph";
import { applyPinsToJointState, applyPinsToWorldTransforms } from "./pins";

export const applySliderWrapRule = (sliderDeg: number): number => {
  if (!Number.isFinite(sliderDeg)) {
    return 0;
  }
  if (sliderDeg > 360) {
    return 1;
  }
  if (sliderDeg < 0) {
    return 0;
  }
  return sliderDeg;
};

const getPinsForFkRotation = (jointId: JointId, pins: PinConstraint[]): PinConstraint[] => {
  if (jointId !== "l_knee" && jointId !== "r_knee") {
    return pins;
  }

  const leftAnklePinned = pins.some((pin) => pin.jointId === "l_foot");
  const rightAnklePinned = pins.some((pin) => pin.jointId === "r_foot");
  if (!leftAnklePinned || !rightAnklePinned) {
    return pins;
  }

  const liftedAnkleId: JointId = jointId === "l_knee" ? "l_foot" : "r_foot";
  return pins.filter((pin) => pin.jointId !== liftedAnkleId);
};

const ANKLE_JOINT_IDS: JointId[] = ["l_foot", "r_foot"];
const GROUND_LIFT_EPSILON = 1e-3;

const getLegAnkleForJoint = (jointId: JointId): JointId | null => {
  if (jointId === "l_hip" || jointId === "l_knee" || jointId === "l_foot") {
    return "l_foot";
  }
  if (jointId === "r_hip" || jointId === "r_knee" || jointId === "r_foot") {
    return "r_foot";
  }
  return null;
};

const releaseGroundedAnklePinsIfLifted = (
  nextJoints: Record<JointId, JointState>,
  pins: PinConstraint[],
  directlyManipulatedJointId: JointId,
  settings: ConstraintSettings
): PinConstraint[] => {
  if (!settings.releaseGroundedAnkleWhenLegLifts) {
    return pins;
  }
  const ankleId = getLegAnkleForJoint(directlyManipulatedJointId);
  if (!ankleId || directlyManipulatedJointId === ankleId) {
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
  const previewWorld = applyPinsToWorldTransforms(computeWorldTransforms(nextJoints), pinsWithoutAnkle).world;
  const previewAnkleY = previewWorld[ankleId]?.worldPosition.y;
  if (previewAnkleY === undefined || previewAnkleY >= groundPin.groundY - GROUND_LIFT_EPSILON) {
    return pins;
  }

  return pinsWithoutAnkle;
};

const buildPinsWithGroundedAnkleXLocks = (
  joints: Record<JointId, JointState>,
  pins: PinConstraint[],
  directlyManipulatedJointId: JointId,
  settings: ConstraintSettings
): PinConstraint[] => {
  if (!settings.lockGroundedAnklesX) {
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
    if (groundPin.jointId === directlyManipulatedJointId) {
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

const counterRotateChildBranch = (
  joints: Record<JointId, JointState>,
  parentId: JointId,
  childId: JointId,
  deltaDeg: number
): void => {
  const child = joints[childId];
  if (!child || child.parentId !== parentId) {
    return;
  }
  joints[childId] = {
    ...child,
    // Keep this branch in place when its parent pivot rotates.
    localTranslation: rotateVec2(child.localTranslation, -deltaDeg),
    localRotationDegRaw: child.localRotationDegRaw - deltaDeg,
  };
};

const applyWaistNavelIsolation = (
  joints: Record<JointId, JointState>,
  jointId: JointId,
  deltaDeg: number
): void => {
  if (!Number.isFinite(deltaDeg) || Math.abs(deltaDeg) <= 1e-6) {
    return;
  }

  if (jointId === "waist") {
    // Navel pivot rotates upper body only; keep lower body static.
    counterRotateChildBranch(joints, "waist", "l_hip", deltaDeg);
    counterRotateChildBranch(joints, "waist", "r_hip", deltaDeg);
    return;
  }

  if (jointId === "root") {
    // Waist pivot rotates lower body only; keep upper body static.
    counterRotateChildBranch(joints, "waist", "torso", deltaDeg);
    counterRotateChildBranch(joints, "waist", "xiphoid", deltaDeg);
  }
};

export const setFkRotationSlider = (
  joints: Record<JointId, JointState>,
  jointId: JointId,
  sliderDeg: number,
  pins: PinConstraint[],
  constraintSettings: ConstraintSettings = DEFAULT_CONSTRAINT_SETTINGS
): Record<JointId, JointState> => {
  const settings = { ...DEFAULT_CONSTRAINT_SETTINGS, ...constraintSettings };
  const next = cloneJoints(joints);
  const nextRotationDeg = applySliderWrapRule(sliderDeg);
  const deltaDeg = normalizeSignedAngleDeg(nextRotationDeg - next[jointId].localRotationDegRaw);
  next[jointId] = {
    ...next[jointId],
    localRotationDegRaw: nextRotationDeg,
  };
  applyWaistNavelIsolation(next, jointId, deltaDeg);
  const rotationPins = settings.allowKneeLiftWhenBothAnklesPinned
    ? getPinsForFkRotation(jointId, pins)
    : pins;
  const liftAwarePins = releaseGroundedAnklePinsIfLifted(
    next,
    rotationPins,
    jointId,
    settings
  );
  const adjustedPins = buildPinsWithGroundedAnkleXLocks(
    next,
    liftAwarePins,
    jointId,
    settings
  );
  return applyPinsToJointState(next, adjustedPins);
};

export const setFkRotationText = (
  joints: Record<JointId, JointState>,
  jointId: JointId,
  rawDeg: number,
  pins: PinConstraint[],
  constraintSettings: ConstraintSettings = DEFAULT_CONSTRAINT_SETTINGS
): Record<JointId, JointState> => {
  const settings = { ...DEFAULT_CONSTRAINT_SETTINGS, ...constraintSettings };
  const next = cloneJoints(joints);
  const nextRotationDeg = Number.isFinite(rawDeg) ? rawDeg : next[jointId].localRotationDegRaw;
  const deltaDeg = normalizeSignedAngleDeg(nextRotationDeg - next[jointId].localRotationDegRaw);
  next[jointId] = {
    ...next[jointId],
    localRotationDegRaw: nextRotationDeg,
  };
  applyWaistNavelIsolation(next, jointId, deltaDeg);
  const rotationPins = settings.allowKneeLiftWhenBothAnklesPinned
    ? getPinsForFkRotation(jointId, pins)
    : pins;
  const liftAwarePins = releaseGroundedAnklePinsIfLifted(
    next,
    rotationPins,
    jointId,
    settings
  );
  const adjustedPins = buildPinsWithGroundedAnkleXLocks(
    next,
    liftAwarePins,
    jointId,
    settings
  );
  return applyPinsToJointState(next, adjustedPins);
};

export const setFkTranslation = (
  joints: Record<JointId, JointState>,
  jointId: JointId,
  x: number,
  y: number,
  pins: PinConstraint[],
  constraintSettings: ConstraintSettings = DEFAULT_CONSTRAINT_SETTINGS
): Record<JointId, JointState> => {
  const settings = { ...DEFAULT_CONSTRAINT_SETTINGS, ...constraintSettings };
  const next = cloneJoints(joints);
  next[jointId] = {
    ...next[jointId],
    localTranslation: { x, y },
  };
  const liftAwarePins = releaseGroundedAnklePinsIfLifted(next, pins, jointId, settings);
  const adjustedPins = buildPinsWithGroundedAnkleXLocks(next, liftAwarePins, jointId, settings);
  return applyPinsToJointState(next, adjustedPins);
};
