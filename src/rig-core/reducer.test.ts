import { describe, expect, it } from "vitest";
import { createInitialRigReducerState, rigReducer } from "./reducer";

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

  it("DRAG_START in IK still seeds an IK target", () => {
    const state = createInitialRigReducerState({ mode: "IK" });

    const next = rigReducer(state, {
      type: "DRAG_START",
      jointId: "l_hand",
      x: 120,
      y: -40,
      handle: "joint",
    });

    expect(next.dragState?.jointId).toBe("l_hand");
    expect(next.ikTargets.l_hand).toMatchObject({
      jointId: "l_hand",
      x: 120,
      y: -40,
      active: true,
    });
  });
});
