import {
  ChainDescriptor,
  ConstraintSettings,
  DEFAULT_CONSTRAINT_SETTINGS,
  JointId,
  JointState,
  PinConstraint,
  RigSolveDiagnostics,
  RigSolverSettings,
  RigState,
  Vec2,
  DEFAULT_SOLVER_SETTINGS,
  EMPTY_DIAGNOSTICS,
} from "../types";
import { computeWorldTransforms } from "../graph";
import { applyPinsToWorldTransforms } from "../pins";
import { commitChainPositionsToJoints, solveFabrikChain } from "./fabrik";

const ANATOMICAL_LIMITS = {
  l_shoulder: { minDeg: -145, maxDeg: 145 },
  r_shoulder: { minDeg: -145, maxDeg: 145 },
  l_elbow: { minDeg: -170, maxDeg: 8 },
  r_elbow: { minDeg: -8, maxDeg: 170 },
  l_hip: { minDeg: -120, maxDeg: 120 },
  r_hip: { minDeg: -120, maxDeg: 120 },
  l_knee: { minDeg: -170, maxDeg: 6 },
  r_knee: { minDeg: -6, maxDeg: 170 },
  waist: { minDeg: -35, maxDeg: 35 },
  xiphoid: { minDeg: -28, maxDeg: 28 },
  collar: { minDeg: -52, maxDeg: 52 },
} as const;

const L_ARM_CHAIN: ChainDescriptor = {
  id: "l_arm",
  joints: ["l_shoulder", "l_elbow", "l_hand"],
  effectorJointId: "l_hand",
  priority: 40,
  jointLimits: {
    l_shoulder: ANATOMICAL_LIMITS.l_shoulder,
    l_elbow: ANATOMICAL_LIMITS.l_elbow,
  },
};

const R_ARM_CHAIN: ChainDescriptor = {
  id: "r_arm",
  joints: ["r_shoulder", "r_elbow", "r_hand"],
  effectorJointId: "r_hand",
  priority: 41,
  jointLimits: {
    r_shoulder: ANATOMICAL_LIMITS.r_shoulder,
    r_elbow: ANATOMICAL_LIMITS.r_elbow,
  },
};

const L_LEG_CHAIN: ChainDescriptor = {
  id: "l_leg",
  joints: ["l_hip", "l_knee", "l_foot"],
  effectorJointId: "l_foot",
  priority: 20,
  jointLimits: {
    l_hip: ANATOMICAL_LIMITS.l_hip,
    l_knee: ANATOMICAL_LIMITS.l_knee,
  },
};

const R_LEG_CHAIN: ChainDescriptor = {
  id: "r_leg",
  joints: ["r_hip", "r_knee", "r_foot"],
  effectorJointId: "r_foot",
  priority: 21,
  jointLimits: {
    r_hip: ANATOMICAL_LIMITS.r_hip,
    r_knee: ANATOMICAL_LIMITS.r_knee,
  },
};

const SPINE_CHAIN: ChainDescriptor = {
  id: "spine",
  joints: ["root", "waist", "xiphoid", "collar", "neck"],
  effectorJointId: "neck",
  priority: 30,
  jointLimits: {
    waist: ANATOMICAL_LIMITS.waist,
    xiphoid: ANATOMICAL_LIMITS.xiphoid,
    collar: ANATOMICAL_LIMITS.collar,
  },
};

const LIMB_CHAINS: ChainDescriptor[] = [L_ARM_CHAIN, R_ARM_CHAIN, L_LEG_CHAIN, R_LEG_CHAIN];
const WHOLE_BODY_ORDER: ChainDescriptor[] = [L_LEG_CHAIN, R_LEG_CHAIN, SPINE_CHAIN, L_ARM_CHAIN, R_ARM_CHAIN];
const ALL_CHAINS: ChainDescriptor[] = [...LIMB_CHAINS, SPINE_CHAIN];

type SolveChainResult = {
  joints: Record<JointId, JointState>;
  residual: number;
  iterations: number;
};

type IkSolveRuntimeOptions = {
  allowStretch?: boolean;
  manipulatedJointId?: JointId | null;
  constraintSettings?: ConstraintSettings;
};

const ANKLE_JOINT_IDS: JointId[] = ["l_foot", "r_foot"];

const buildPinsWithGroundedAnkleXLocks = (
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

const nowMs = (): number =>
  typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();

const resolveSelectedSingleChain = (state: RigState): ChainDescriptor | undefined => {
  if (state.selectedJointId) {
    const bySelection = ALL_CHAINS.filter((chain) => chain.joints.includes(state.selectedJointId as JointId));
    if (bySelection.length) {
      return bySelection.sort((a, b) => (a.priority ?? 0) - (b.priority ?? 0))[0];
    }
  }

  const byActiveTarget = ALL_CHAINS.find((chain) => state.ikTargets[chain.effectorJointId]?.active);
  if (byActiveTarget) {
    return byActiveTarget;
  }

  return undefined;
};

const resolveChainSetForMode = (state: RigState): ChainDescriptor[] => {
  if (state.ikSolveMode === "single_chain") {
    const selected = resolveSelectedSingleChain(state);
    return selected ? [selected] : [];
  }
  if (state.ikSolveMode === "limbs_only") {
    return [...LIMB_CHAINS];
  }
  return [...WHOLE_BODY_ORDER];
};

const resolvePinnedTarget = (
  state: RigState,
  chain: ChainDescriptor,
  pins: PinConstraint[]
): Vec2 | undefined => {
  const world = computeWorldTransforms(state.joints);
  const base = world[chain.effectorJointId].worldPosition;
  let targetX = base.x;
  let targetY = base.y;
  let hasPin = false;

  for (const pin of pins) {
    if (pin.jointId !== chain.effectorJointId) {
      continue;
    }
    hasPin = true;
    if (pin.kind === "world") {
      if (pin.lockX) {
        targetX = pin.x;
      }
      if (pin.lockY) {
        targetY = pin.y;
      }
    } else {
      targetY = pin.groundY;
    }
  }

  if (!hasPin) {
    return undefined;
  }
  return { x: targetX, y: targetY };
};

const resolveChainTargetWithPins = (
  state: RigState,
  chain: ChainDescriptor,
  pins: PinConstraint[]
): Vec2 | undefined => {
  const explicitTarget = state.ikTargets[chain.effectorJointId];
  if (explicitTarget?.active) {
    return { x: explicitTarget.x, y: explicitTarget.y };
  }
  return resolvePinnedTarget(state, chain, pins);
};

const isLegChain = (chain: ChainDescriptor): boolean =>
  chain.effectorJointId === "l_foot" || chain.effectorJointId === "r_foot";

const resolvePoleTarget = (state: RigState, chain: ChainDescriptor): Vec2 | undefined => {
  if (chain.joints.length !== 3) {
    return undefined;
  }
  const poleJointId = chain.joints[1];
  const poleTarget = state.ikPoleTargets[poleJointId];
  if (!poleTarget?.active) {
    const world = computeWorldTransforms(state.joints);
    const currentPolePoint = world[poleJointId]?.worldPosition;
    return currentPolePoint ? { ...currentPolePoint } : undefined;
  }
  return { x: poleTarget.x, y: poleTarget.y };
};

const solveChain = (
  state: RigState,
  joints: Record<JointId, JointState>,
  chain: ChainDescriptor,
  settings: RigSolverSettings,
  runtimeOptions: IkSolveRuntimeOptions,
  pins: PinConstraint[]
): SolveChainResult | null => {
  const target = resolveChainTargetWithPins({ ...state, joints }, chain, pins);
  if (!target) {
    return null;
  }

  const world = computeWorldTransforms(joints);
  const chainStretchAllowed = Boolean(runtimeOptions.allowStretch) && !isLegChain(chain);
  const solved = solveFabrikChain({
    chain: chain.joints,
    joints,
    world,
    target,
    poleTarget: resolvePoleTarget(state, chain),
    pins,
    jointLimits: chain.jointLimits,
    maxIterations: settings.maxIterations,
    epsilon: settings.epsilon,
    allowStretch: chainStretchAllowed,
  });

  // Stretch translation rebake is gated by per-chain stretch policy.
  const nextJoints = commitChainPositionsToJoints(joints, chain.joints, solved.positions, {
    allowStretch: chainStretchAllowed,
    jointLimits: chain.jointLimits,
  });

  return {
    joints: nextJoints,
    residual: solved.residual,
    iterations: solved.iterations,
  };
};

export const solveRigInIkMode = (
  state: RigState,
  solverSettings?: Partial<RigSolverSettings>,
  runtimeOptions: IkSolveRuntimeOptions = {}
): { joints: Record<JointId, JointState>; diagnostics: RigSolveDiagnostics } => {
  if (state.mode !== "IK") {
    return {
      joints: state.joints,
      diagnostics: EMPTY_DIAGNOSTICS,
    };
  }

  const settings: RigSolverSettings = {
    ...DEFAULT_SOLVER_SETTINGS,
    ...solverSettings,
  };
  const constraintSettings = {
    ...DEFAULT_CONSTRAINT_SETTINGS,
    ...(runtimeOptions.constraintSettings ?? {}),
  };
  const pinsForSolve = buildPinsWithGroundedAnkleXLocks(
    state.joints,
    state.pins,
    runtimeOptions.manipulatedJointId ?? null,
    constraintSettings
  );

  const startMs = nowMs();
  let workingJoints = state.joints;
  let maxResidual = 0;
  let totalIterations = 0;
  let chainsSolved = 0;
  let globalPasses = 0;

  const chains = resolveChainSetForMode(state);
  if (!chains.length) {
    return {
      joints: workingJoints,
      diagnostics: {
        ...EMPTY_DIAGNOSTICS,
        solveMs: nowMs() - startMs,
      },
    };
  }

  if (state.ikSolveMode === "whole_body_graph") {
    const maxGlobalPasses = Math.max(1, settings.maxGlobalPasses);
    for (let pass = 0; pass < maxGlobalPasses; pass += 1) {
      globalPasses = pass + 1;
      let passResidual = 0;
      let passSolvedCount = 0;
      let passIterations = 0;

      for (const chain of chains) {
        const solved = solveChain(state, workingJoints, chain, settings, runtimeOptions, pinsForSolve);
        if (!solved) {
          continue;
        }
        workingJoints = solved.joints;
        passResidual = Math.max(passResidual, solved.residual);
        passIterations += solved.iterations;
        passSolvedCount += 1;
      }

      maxResidual = Math.max(maxResidual, passResidual);
      totalIterations += passIterations;
      chainsSolved += passSolvedCount;

      if (passSolvedCount === 0 || passResidual <= settings.epsilon) {
        break;
      }
    }
  } else {
    for (const chain of chains) {
      const solved = solveChain(state, workingJoints, chain, settings, runtimeOptions, pinsForSolve);
      if (!solved) {
        continue;
      }
      workingJoints = solved.joints;
      maxResidual = Math.max(maxResidual, solved.residual);
      totalIterations += solved.iterations;
      chainsSolved += 1;
    }
    globalPasses = chainsSolved ? 1 : 0;
  }

  const diagnostics: RigSolveDiagnostics = {
    iterations: totalIterations,
    residual: maxResidual,
    solveMs: nowMs() - startMs,
    chainsSolved,
    globalPasses,
  };

  return {
    joints: workingJoints,
    diagnostics,
  };
};
