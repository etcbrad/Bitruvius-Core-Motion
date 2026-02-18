import { describe, expect, it } from "vitest";
import { createInitialRigReducerState, rigReducer } from "./reducer";
import { computeWorldTransforms } from "./graph";

describe("rigReducer selection intent", () => {
  it("SELECT_JOINT updates only selection state", () => {
    const state = createInitialRigReducerState({ mode: "IK" });

    const next = rigReducer(state, {
      type: "SELECT_JOINT",
      jointId: "l_hand",
    });

    expect(next.selectedJointId).toBe("l_hand");
    expect(next.dragState).toBeNull();
    expect(next.ikTargets.l_hand).toBeUndefined();
  });

  it("SELECT_JOINT preserves rigid translation cache when joints are unchanged", () => {
    const state = createInitialRigReducerState({ mode: "FK" });
    const next = rigReducer(state, {
      type: "SELECT_JOINT",
      jointId: "l_hand",
    });

    expect(next.joints).toBe(state.joints);
    expect(next.rigidLocalTranslations).toBe(state.rigidLocalTranslations);
  });

  it("DRAG_START in IK selects handle without mutating target", () => {
    const state = createInitialRigReducerState({ mode: "IK" });

    const next = rigReducer(state, {
      type: "DRAG_START",
      jointId: "l_hand",
      x: 120,
      y: -40,
      handle: "joint",
    });

    expect(next.dragState?.jointId).toBe("l_hand");
    expect(next.ikTargets.l_hand).toBeUndefined();
  });

  it("DRAG_MOVE in IK seeds and updates target once dragging begins", () => {
    const state = createInitialRigReducerState({ mode: "IK" });
    const started = rigReducer(state, {
      type: "DRAG_START",
      jointId: "l_hand",
      x: 120,
      y: -40,
      handle: "joint",
    });

    const moved = rigReducer(started, {
      type: "DRAG_MOVE",
      x: 128,
      y: -36,
    });

    expect(moved.ikTargets.l_hand).toMatchObject({
      jointId: "l_hand",
      x: 128,
      y: -36,
      active: true,
    });
  });

  it("IK_SET_TARGET clamps grounded reach in core reducer path", () => {
    const state = createInitialRigReducerState({ mode: "IK" });
    const world = computeWorldTransforms(state.joints);
    const withGroundedFoot = {
      ...state,
      pins: [
        ...state.pins,
        {
          kind: "ground" as const,
          jointId: "l_foot" as const,
          groundY: world.l_foot.worldPosition.y,
        },
      ],
    };

    const farX = 5000;
    const farY = -5000;
    const next = rigReducer(withGroundedFoot, {
      type: "IK_SET_TARGET",
      jointId: "l_hand",
      x: farX,
      y: farY,
    });
    const target = next.ikTargets.l_hand;
    expect(target?.active).toBe(true);
    const clamped =
      Math.abs((target?.x ?? farX) - farX) > 1e-6 ||
      Math.abs((target?.y ?? farY) - farY) > 1e-6;
    expect(clamped).toBe(true);
  });

  it("IK friction-off toggle bypasses grounded reach clamp", () => {
    const base = createInitialRigReducerState({ mode: "IK" });
    const state = {
      ...base,
      constraintSettings: {
        ...base.constraintSettings,
        ikFrictionOff: true,
      },
    };
    const world = computeWorldTransforms(state.joints);
    const withGroundedFoot = {
      ...state,
      pins: [
        ...state.pins,
        {
          kind: "ground" as const,
          jointId: "l_foot" as const,
          groundY: world.l_foot.worldPosition.y,
        },
      ],
    };

    const farX = 5000;
    const farY = -5000;
    const next = rigReducer(withGroundedFoot, {
      type: "IK_SET_TARGET",
      jointId: "l_hand",
      x: farX,
      y: farY,
    });
    expect(next.ikTargets.l_hand).toMatchObject({
      active: true,
      x: farX,
      y: farY,
    });
  });

  it("IK_CLEAR_TARGET is a no-op when no target exists", () => {
    const state = createInitialRigReducerState({ mode: "IK" });
    const next = rigReducer(state, {
      type: "IK_CLEAR_TARGET",
      jointId: "l_hand",
    });
    expect(next).toBe(state);
  });

  it("IK_CLEAR_POLE_TARGET is a no-op when no pole target exists", () => {
    const state = createInitialRigReducerState({ mode: "IK" });
    const next = rigReducer(state, {
      type: "IK_CLEAR_POLE_TARGET",
      jointId: "l_elbow",
    });
    expect(next).toBe(state);
  });

  it("updates background and foreground scene layers", () => {
    const state = createInitialRigReducerState();

    const withBackground = rigReducer(state, {
      type: "SCENE_LAYER_UPDATE",
      layer: "background",
      patch: {
        alpha: 0.5,
        blendMode: "multiply",
      },
    });
    const withShadow = rigReducer(withBackground, {
      type: "SCENE_BACKGROUND_SHADOW_UPDATE",
      patch: {
        alpha: 0.4,
        blurPx: 6,
      },
    });

    expect(withBackground.sceneLayers.background.alpha).toBe(0.5);
    expect(withBackground.sceneLayers.background.blendMode).toBe("multiply");
    expect(withShadow.sceneLayers.backgroundShadow.alpha).toBe(0.4);
    expect(withShadow.sceneLayers.backgroundShadow.blurPx).toBe(6);
  });

  it("applies runtime pelvis damping for landing settle", () => {
    const state = createInitialRigReducerState({ mode: "FK" });
    const next = rigReducer(state, {
      type: "RUNTIME_DAMP_PELVIS",
      rootY: state.joints.root.localTranslation.y + 12,
      waistTarget: { x: state.joints.waist.localTranslation.x, y: -6 },
      lHipTarget: { x: state.joints.l_hip.localTranslation.x, y: 8 },
      rHipTarget: { x: state.joints.r_hip.localTranslation.x, y: 8 },
      alpha: 0.5,
    });

    expect(next.joints.root.localTranslation.y).not.toBe(state.joints.root.localTranslation.y);
    expect(next.joints.l_hip.localTranslation.y).not.toBe(state.joints.l_hip.localTranslation.y);
    expect(next.joints.r_hip.localTranslation.y).not.toBe(state.joints.r_hip.localTranslation.y);
  });
});
