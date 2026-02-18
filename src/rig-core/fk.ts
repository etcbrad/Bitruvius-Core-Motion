import { ConstraintSettings, DEFAULT_CONSTRAINT_SETTINGS, JointId, JointState, PinConstraint } from "./types";
import { cloneJoints, normalizeSignedAngleDeg, rotateVec2 } from "./graph";
import { applyPinsToJointState } from "./pins";
import {
  buildPinsWithGroundedAnkleXLocks,
  releaseGroundedAnklePinsIfLifted,
} from "./constraints/groundPins";

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

  if (jointId === "root") {
    // Root pivot rotates lower body only; keep upper body branch static.
    counterRotateChildBranch(joints, "root", "waist", deltaDeg);
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
  if (settings.fkFrictionOff) {
    return next;
  }
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
  if (settings.fkFrictionOff) {
    return next;
  }
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
  if (settings.fkFrictionOff) {
    return next;
  }
  const liftAwarePins = releaseGroundedAnklePinsIfLifted(next, pins, jointId, settings);
  const adjustedPins = buildPinsWithGroundedAnkleXLocks(next, liftAwarePins, jointId, settings);
  return applyPinsToJointState(next, adjustedPins);
};
