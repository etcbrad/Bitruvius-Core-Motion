export type JumpFallPhase = "grounded" | "jumping" | "falling";

// Jump/fall simulation module kept standalone so it can be wired into the rig loop
// after IK tuning is finalized.

export type JumpFallState = {
  enabled: boolean;
  phase: JumpFallPhase;
  verticalVelocity: number;
  gravity: number;
  jumpImpulse: number;
  terminalVelocity: number;
  coyoteTimeMs: number;
  lastGroundedAtMs: number | null;
};

export type JumpFallStepInput = {
  state: JumpFallState;
  dtMs: number;
  nowMs: number;
  jumpRequested: boolean;
  rootY: number;
  groundY: number;
  footGrounded?: boolean;
};

export type JumpFallStepOutput = {
  state: JumpFallState;
  rootY: number;
};

export const DEFAULT_JUMP_FALL_STATE: JumpFallState = {
  enabled: false,
  phase: "grounded",
  verticalVelocity: 0,
  gravity: 2200,
  jumpImpulse: 900,
  terminalVelocity: 2400,
  coyoteTimeMs: 110,
  lastGroundedAtMs: null,
};

const canJump = (state: JumpFallState, nowMs: number): boolean => {
  if (state.phase === "grounded") {
    return true;
  }
  if (state.lastGroundedAtMs === null) {
    return false;
  }
  return nowMs - state.lastGroundedAtMs <= state.coyoteTimeMs;
};

export const stepJumpFall = (input: JumpFallStepInput): JumpFallStepOutput => {
  const { dtMs, nowMs, jumpRequested, groundY, footGrounded = false } = input;
  const dtSec = Math.max(0, dtMs) / 1000;
  const state = { ...input.state };
  let rootY = input.rootY;

  if (!state.enabled || dtSec <= 0) {
    return { state, rootY };
  }

  if (jumpRequested && canJump(state, nowMs)) {
    state.phase = "jumping";
    state.verticalVelocity = -Math.abs(state.jumpImpulse);
    state.lastGroundedAtMs = null;
  }

  state.verticalVelocity = Math.min(
    state.terminalVelocity,
    state.verticalVelocity + Math.abs(state.gravity) * dtSec
  );

  rootY += state.verticalVelocity * dtSec;

  if ((rootY >= groundY || footGrounded) && state.verticalVelocity >= 0) {
    rootY = groundY;
    state.phase = "grounded";
    state.verticalVelocity = 0;
    state.lastGroundedAtMs = nowMs;
    return { state, rootY };
  }

  state.phase = state.verticalVelocity < 0 ? "jumping" : "falling";
  return { state, rootY };
};
