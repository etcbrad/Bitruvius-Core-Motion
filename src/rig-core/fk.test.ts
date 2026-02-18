import { describe, expect, it } from "vitest";
import { computeWorldTransforms } from "./graph";
import { applySliderWrapRule, setFkRotationText } from "./fk";
import { createInitialRigState, DEFAULT_CONSTRAINT_SETTINGS } from "./types";

describe("applySliderWrapRule", () => {
  it("clamps non-finite and negative values to 0", () => {
    expect(applySliderWrapRule(Number.NaN)).toBe(0);
    expect(applySliderWrapRule(-10)).toBe(0);
  });

  it("wraps values above 360 to 1", () => {
    expect(applySliderWrapRule(361)).toBe(1);
    expect(applySliderWrapRule(999)).toBe(1);
  });

  it("passes through in-range values", () => {
    expect(applySliderWrapRule(0)).toBe(0);
    expect(applySliderWrapRule(180)).toBe(180);
    expect(applySliderWrapRule(360)).toBe(360);
  });
});

describe("waist/navel rotation isolation", () => {
  const closeTo = (a: number, b: number): boolean => Math.abs(a - b) <= 1e-3;

  it("navel (waist joint) rotates upper body while hips stay planted", () => {
    const initial = createInitialRigState();
    const before = computeWorldTransforms(initial.joints);
    const nextJoints = setFkRotationText(
      initial.joints,
      "waist",
      initial.joints.waist.localRotationDegRaw + 25,
      initial.pins,
      initial.constraintSettings
    );
    const after = computeWorldTransforms(nextJoints);

    expect(closeTo(after.l_hip.worldPosition.x, before.l_hip.worldPosition.x)).toBe(true);
    expect(closeTo(after.l_hip.worldPosition.y, before.l_hip.worldPosition.y)).toBe(true);
    expect(closeTo(after.r_hip.worldPosition.x, before.r_hip.worldPosition.x)).toBe(true);
    expect(closeTo(after.r_hip.worldPosition.y, before.r_hip.worldPosition.y)).toBe(true);

    const torsoMoved =
      !closeTo(after.torso.worldPosition.x, before.torso.worldPosition.x) ||
      !closeTo(after.torso.worldPosition.y, before.torso.worldPosition.y);
    expect(torsoMoved).toBe(true);
  });

  it("waist (root joint) rotates lower body while torso stays planted", () => {
    const initial = createInitialRigState();
    const before = computeWorldTransforms(initial.joints);
    const nextJoints = setFkRotationText(
      initial.joints,
      "root",
      initial.joints.root.localRotationDegRaw + 25,
      initial.pins,
      initial.constraintSettings
    );
    const after = computeWorldTransforms(nextJoints);

    expect(closeTo(after.torso.worldPosition.x, before.torso.worldPosition.x)).toBe(true);
    expect(closeTo(after.torso.worldPosition.y, before.torso.worldPosition.y)).toBe(true);
    expect(closeTo(after.neck.worldPosition.x, before.neck.worldPosition.x)).toBe(true);
    expect(closeTo(after.neck.worldPosition.y, before.neck.worldPosition.y)).toBe(true);

    const hipMoved =
      !closeTo(after.l_hip.worldPosition.x, before.l_hip.worldPosition.x) ||
      !closeTo(after.l_hip.worldPosition.y, before.l_hip.worldPosition.y);
    expect(hipMoved).toBe(true);
  });

  it("root rotates freely when FK friction is disabled", () => {
    const initial = createInitialRigState({
      constraintSettings: {
        ...DEFAULT_CONSTRAINT_SETTINGS,
        fkFrictionOff: true,
      },
    });
    const before = computeWorldTransforms(initial.joints);
    const nextJoints = setFkRotationText(
      initial.joints,
      "root",
      initial.joints.root.localRotationDegRaw + 25,
      initial.pins,
      initial.constraintSettings
    );
    const after = computeWorldTransforms(nextJoints);

    const torsoMoved =
      !closeTo(after.torso.worldPosition.x, before.torso.worldPosition.x) ||
      !closeTo(after.torso.worldPosition.y, before.torso.worldPosition.y);
    expect(torsoMoved).toBe(true);
  });
});
