import { describe, expect, it } from "vitest";
import { createInitialRigState, DEFAULT_CONSTRAINT_SETTINGS } from "../types";
import { computeWorldTransforms } from "../graph";
import { solveRigInIkMode } from "./modes";

describe("solveRigInIkMode root distribution", () => {
  it("applies direct root target and distributes motion across pelvis branches", () => {
    const initial = createInitialRigState({
      mode: "IK",
      ikSolveMode: "whole_body_graph",
      selectedJointId: "root",
    });
    const rootStart = initial.joints.root.localTranslation;
    const state = {
      ...initial,
      pins: [],
      ikTargets: {
        ...initial.ikTargets,
        root: {
          jointId: "root" as const,
          x: rootStart.x + 80,
          y: rootStart.y + 30,
          active: true,
        },
      },
    };

    const solved = solveRigInIkMode(
      state,
      { maxIterations: 12, epsilon: 0.1, maxGlobalPasses: 6 },
      {
        manipulatedJointId: "root",
        constraintSettings: state.constraintSettings,
      }
    );

    const rootDeltaX = solved.joints.root.localTranslation.x - rootStart.x;
    const rootDeltaY = solved.joints.root.localTranslation.y - rootStart.y;
    expect(rootDeltaX).toBeGreaterThan(0);
    expect(rootDeltaX).toBeLessThan(80);
    expect(rootDeltaY).toBeGreaterThan(0);
    expect(rootDeltaY).toBeLessThan(30);

    expect(solved.joints.waist.localTranslation.x).not.toBe(initial.joints.waist.localTranslation.x);
    expect(solved.joints.l_hip.localTranslation.x).not.toBe(initial.joints.l_hip.localTranslation.x);
    expect(solved.joints.r_hip.localTranslation.x).not.toBe(initial.joints.r_hip.localTranslation.x);
  });

  it("whole-body IK hand target pulls core and opposite side with it", () => {
    const initial = createInitialRigState({
      mode: "IK",
      ikSolveMode: "whole_body_graph",
      selectedJointId: "l_hand",
    });
    const beforeWorld = computeWorldTransforms(initial.joints);
    const leftHandStart = beforeWorld.l_hand.worldPosition;
    const rightHandStart = beforeWorld.r_hand.worldPosition;

    const state = {
      ...initial,
      pins: [],
      ikTargets: {
        ...initial.ikTargets,
        l_hand: {
          jointId: "l_hand" as const,
          x: leftHandStart.x + 260,
          y: leftHandStart.y - 20,
          active: true,
        },
      },
    };

    const solved = solveRigInIkMode(
      state,
      { maxIterations: 16, epsilon: 0.1, maxGlobalPasses: 8 },
      {
        manipulatedJointId: "l_hand",
        constraintSettings: state.constraintSettings,
      }
    );
    const afterWorld = computeWorldTransforms(solved.joints);

    const coreMoved =
      Math.abs(solved.joints.waist.localRotationDegRaw - initial.joints.waist.localRotationDegRaw) > 0.5 ||
      Math.abs(solved.joints.xiphoid.localRotationDegRaw - initial.joints.xiphoid.localRotationDegRaw) > 0.5 ||
      Math.abs(solved.joints.collar.localRotationDegRaw - initial.joints.collar.localRotationDegRaw) > 0.5;
    expect(coreMoved).toBe(true);
    expect(Math.abs(afterWorld.r_hand.worldPosition.x - rightHandStart.x)).toBeGreaterThan(1);
  });

  it("single-chain hand IK allows mild torso assist without moving root", () => {
    const initial = createInitialRigState({
      mode: "IK",
      ikSolveMode: "single_chain",
      selectedJointId: "l_hand",
    });
    const beforeWorld = computeWorldTransforms(initial.joints);
    const leftHandStart = beforeWorld.l_hand.worldPosition;
    const rootStart = initial.joints.root.localTranslation;

    const state = {
      ...initial,
      pins: [],
      ikTargets: {
        ...initial.ikTargets,
        l_hand: {
          jointId: "l_hand" as const,
          x: leftHandStart.x + 180,
          y: leftHandStart.y - 10,
          active: true,
        },
      },
    };

    const solved = solveRigInIkMode(
      state,
      { maxIterations: 16, epsilon: 0.1, maxGlobalPasses: 6 },
      {
        manipulatedJointId: "l_hand",
        constraintSettings: state.constraintSettings,
      }
    );

    const torsoMoved =
      Math.abs(solved.joints.waist.localRotationDegRaw - initial.joints.waist.localRotationDegRaw) > 0.25 ||
      Math.abs(solved.joints.xiphoid.localRotationDegRaw - initial.joints.xiphoid.localRotationDegRaw) > 0.25;
    expect(torsoMoved).toBe(true);
    expect(Math.abs(solved.joints.root.localTranslation.x - rootStart.x)).toBeLessThan(0.01);
    expect(Math.abs(solved.joints.root.localTranslation.y - rootStart.y)).toBeLessThan(0.01);
  });

  it("clamps preloaded IK targets while feet are grounded unless IK friction-off is enabled", () => {
    const initial = createInitialRigState({
      mode: "IK",
      ikSolveMode: "limbs_only",
      selectedJointId: "l_hand",
    });
    const world = computeWorldTransforms(initial.joints);
    const farTarget = {
      x: world.l_hand.worldPosition.x + 900,
      y: world.l_hand.worldPosition.y - 600,
    };
    const withGroundPin = {
      ...initial,
      pins: [
        ...initial.pins,
        {
          kind: "ground" as const,
          jointId: "l_foot" as const,
          groundY: world.l_foot.worldPosition.y,
        },
      ],
      ikTargets: {
        ...initial.ikTargets,
        l_hand: {
          jointId: "l_hand" as const,
          x: farTarget.x,
          y: farTarget.y,
          active: true,
        },
      },
    };
    const frictionOffState = {
      ...withGroundPin,
      constraintSettings: {
        ...DEFAULT_CONSTRAINT_SETTINGS,
        ...withGroundPin.constraintSettings,
        ikFrictionOff: true,
      },
    };

    const clamped = solveRigInIkMode(
      withGroundPin,
      { maxIterations: 16, epsilon: 0.1, maxGlobalPasses: 6 },
      {
        manipulatedJointId: "l_hand",
        constraintSettings: withGroundPin.constraintSettings,
      }
    );
    const unclamped = solveRigInIkMode(
      frictionOffState,
      { maxIterations: 16, epsilon: 0.1, maxGlobalPasses: 6 },
      {
        manipulatedJointId: "l_hand",
        constraintSettings: frictionOffState.constraintSettings,
      }
    );

    expect(clamped.diagnostics.residual).toBeLessThan(unclamped.diagnostics.residual);
  });
});
