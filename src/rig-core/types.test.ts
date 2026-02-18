import { describe, expect, it } from "vitest";
import { createInitialRigState, DEFAULT_CONSTRAINT_SETTINGS } from "./types";

describe("createInitialRigState", () => {
  it("boots with FK mode and default constraints", () => {
    const state = createInitialRigState();
    expect(state.mode).toBe("FK");
    expect(state.constraintSettings).toEqual(DEFAULT_CONSTRAINT_SETTINGS);
    expect(state.selectedJointId).toBe("xiphoid");
    expect(state.pins).toHaveLength(1);
    expect(state.pins[0]).toMatchObject({
      kind: "world",
      jointId: "root",
      lockX: true,
      lockY: true,
    });
    expect(state.sceneLayers.background.name).toBe("Background");
    expect(state.sceneLayers.foreground.blendMode).toBe("screen");
    expect(state.sceneLayers.backgroundShadow.enabled).toBe(true);
  });

  it("respects seed overrides while preserving defaults", () => {
    const state = createInitialRigState({
      constraintSettings: {
        ...DEFAULT_CONSTRAINT_SETTINGS,
        lockGroundedAnklesX: false,
      },
    });
    expect(state.constraintSettings.lockGroundedAnklesX).toBe(false);
    expect(state.constraintSettings.enforceRootWaistLock).toBe(
      DEFAULT_CONSTRAINT_SETTINGS.enforceRootWaistLock
    );
  });

  it("anchors both hips to root for center-origin leg chains", () => {
    const state = createInitialRigState();
    expect(state.joints.l_hip.parentId).toBe("root");
    expect(state.joints.r_hip.parentId).toBe("root");
  });
});
