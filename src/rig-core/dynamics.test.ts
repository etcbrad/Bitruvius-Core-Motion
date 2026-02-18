import { describe, expect, it } from "vitest";
import { DEFAULT_JUMP_FALL_STATE, stepJumpFall } from "./dynamics";

describe("stepJumpFall", () => {
  it("keeps state unchanged when disabled", () => {
    const out = stepJumpFall({
      state: { ...DEFAULT_JUMP_FALL_STATE, enabled: false },
      dtMs: 16,
      nowMs: 0,
      jumpRequested: true,
      rootY: 0,
      groundY: 0,
    });
    expect(out.rootY).toBe(0);
    expect(out.state.phase).toBe("grounded");
  });

  it("starts jump and transitions to falling over time", () => {
    const initial = { ...DEFAULT_JUMP_FALL_STATE, enabled: true, phase: "grounded" as const };
    const jumped = stepJumpFall({
      state: initial,
      dtMs: 16,
      nowMs: 16,
      jumpRequested: true,
      rootY: 0,
      groundY: 0,
    });
    expect(jumped.state.phase).toBe("jumping");
    expect(jumped.rootY).toBeLessThan(0);

    const later = stepJumpFall({
      state: jumped.state,
      dtMs: 1200,
      nowMs: 1216,
      jumpRequested: false,
      rootY: jumped.rootY,
      groundY: 0,
    });
    expect(later.state.phase === "falling" || later.state.phase === "grounded").toBe(true);
  });

  it("lands early when foot contact is reported while descending", () => {
    const airborne = {
      ...DEFAULT_JUMP_FALL_STATE,
      enabled: true,
      phase: "falling" as const,
      verticalVelocity: 320,
    };
    const out = stepJumpFall({
      state: airborne,
      dtMs: 16,
      nowMs: 16,
      jumpRequested: false,
      rootY: -14,
      groundY: 0,
      footGrounded: true,
    });
    expect(out.state.phase).toBe("grounded");
    expect(out.state.verticalVelocity).toBe(0);
    expect(out.rootY).toBe(0);
  });
});
