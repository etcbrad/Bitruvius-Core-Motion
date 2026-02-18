import {
  ChainDescriptor,
  ConstraintSettings,
  DEFAULT_CONSTRAINT_SETTINGS,
  JointId,
  JointState,
  PinConstraint,
  IkSolverId,
  RigSolveDiagnostics,
  RigSolverSettings,
  RigState,
  Vec2,
  DEFAULT_SOLVER_SETTINGS,
  EMPTY_DIAGNOSTICS,
} from "../types";
import {
  addVec2,
  cloneJoints,
  computeWorldTransforms,
  inverseRotateVec2,
  lengthVec2,
  normalizeVec2,
  scaleVec2,
  subVec2,
} from "../graph";
import { applyPinsToWorldTransforms } from "../pins";
import { commitChainPositionsToJoints, solveFabrikChain } from "./fabrik";
import { solveCcdChain } from "./ccd";
import type { SoftStretchConfig } from "./stretch";
import {
  buildPinsWithGroundedAnkleXLocks,
  clampIkTargetForGroundedReach,
} from "../constraints/groundPins";
import {
  ALL_CHAINS,
  FULL_BODY_CHAIN_BY_EFFECTOR,
  LIMB_CHAINS,
  SINGLE_CHAIN_ASSIST_BY_EFFECTOR,
  WHOLE_BODY_ORDER,
} from "../topology";

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

const CHAIN_SOFT_STRETCH: Record<string, Omit<SoftStretchConfig, "enabled">> = {
  l_arm: { maxStretchRatio: 1.32, curveStrength: 0.55 },
  r_arm: { maxStretchRatio: 1.32, curveStrength: 0.55 },
  l_leg: { maxStretchRatio: 1.12, curveStrength: 0.48 },
  r_leg: { maxStretchRatio: 1.12, curveStrength: 0.48 },
  spine: { maxStretchRatio: 1.18, curveStrength: 0.6 },
};

const DEFAULT_SOFT_STRETCH_CHAIN_PROFILE: Omit<SoftStretchConfig, "enabled"> = {
  maxStretchRatio: 1.24,
  curveStrength: 0.55,
};

const CHAIN_DEFAULT_BEND_SIGN: Record<string, number> = {
  l_arm: 1,
  r_arm: -1,
  l_leg: 1,
  r_leg: -1,
};

const chainBendSignMemory = new Map<string, number>();

const ROOT_MOTION_ROOT_WEIGHT = 0.58;
const ROOT_MOTION_BRANCH_WEIGHTS = {
  waist: 0.56,
  l_hip: 0.22,
  r_hip: 0.22,
} as const;

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

const resolvePrimaryEffectorJoint = (
  state: RigState,
  runtimeOptions: IkSolveRuntimeOptions
): JointId | null => {
  const manipulated = runtimeOptions.manipulatedJointId ?? null;
  if (manipulated && FULL_BODY_CHAIN_BY_EFFECTOR[manipulated]) {
    return manipulated;
  }
  if (state.selectedJointId && FULL_BODY_CHAIN_BY_EFFECTOR[state.selectedJointId]) {
    const selectedTarget = state.ikTargets[state.selectedJointId];
    if (selectedTarget?.active) {
      return state.selectedJointId;
    }
  }
  const preferredOrder: JointId[] = ["l_hand", "r_hand", "l_foot", "r_foot", "neck"];
  for (const jointId of preferredOrder) {
    if (state.ikTargets[jointId]?.active && FULL_BODY_CHAIN_BY_EFFECTOR[jointId]) {
      return jointId;
    }
  }
  return null;
};

const resolveChainSetForMode = (
  state: RigState,
  runtimeOptions: IkSolveRuntimeOptions
): ChainDescriptor[] => {
  const primaryEffector = resolvePrimaryEffectorJoint(state, runtimeOptions);
  const primaryFullBodyChain = primaryEffector ? FULL_BODY_CHAIN_BY_EFFECTOR[primaryEffector] : undefined;

  if (state.ikSolveMode === "single_chain") {
    if (primaryEffector && SINGLE_CHAIN_ASSIST_BY_EFFECTOR[primaryEffector]) {
      return [SINGLE_CHAIN_ASSIST_BY_EFFECTOR[primaryEffector] as ChainDescriptor];
    }
    const selected = resolveSelectedSingleChain(state);
    return selected ? [selected] : [];
  }
  if (state.ikSolveMode === "limbs_only") {
    return [...LIMB_CHAINS];
  }
  if (!primaryFullBodyChain) {
    return [...WHOLE_BODY_ORDER];
  }
  return [primaryFullBodyChain, ...WHOLE_BODY_ORDER];
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
  pins: PinConstraint[],
  constraintSettings: ConstraintSettings
): Vec2 | undefined => {
  const explicitTarget = state.ikTargets[chain.effectorJointId];
  if (explicitTarget?.active) {
    return clampIkTargetForGroundedReach(
      state.joints,
      pins,
      chain.effectorJointId,
      { x: explicitTarget.x, y: explicitTarget.y },
      state.ikStretchEnabled,
      constraintSettings
    );
  }
  return resolvePinnedTarget(state, chain, pins);
};

const applyDirectRootTarget = (
  state: RigState,
  joints: Record<JointId, JointState>,
  pins: PinConstraint[]
): Record<JointId, JointState> => {
  const rootTarget = state.ikTargets.root;
  if (!rootTarget?.active) {
    return joints;
  }

  let x = rootTarget.x;
  let y = rootTarget.y;
  for (const pin of pins) {
    if (pin.jointId !== "root") {
      continue;
    }
    if (pin.kind === "world") {
      if (pin.lockX) {
        x = pin.x;
      }
      if (pin.lockY) {
        y = pin.y;
      }
    } else {
      y = pin.groundY;
    }
  }

  if (
    Math.abs(joints.root.localTranslation.x - x) <= 1e-6 &&
    Math.abs(joints.root.localTranslation.y - y) <= 1e-6
  ) {
    return joints;
  }

  const next = cloneJoints(joints);
  next.root = {
    ...next.root,
    localTranslation: { x, y },
  };
  return next;
};

const resolveChainSoftStretch = (
  chain: ChainDescriptor,
  allowStretch: boolean
): Partial<SoftStretchConfig> => ({
  enabled: allowStretch,
  ...(CHAIN_SOFT_STRETCH[chain.id] ?? DEFAULT_SOFT_STRETCH_CHAIN_PROFILE),
});

const observeBendSign = (root: Vec2, mid: Vec2, effector: Vec2): number => {
  const rootToEffector = subVec2(effector, root);
  const rootToMid = subVec2(mid, root);
  const signedArea =
    rootToEffector.x * rootToMid.y - rootToEffector.y * rootToMid.x;
  if (Math.abs(signedArea) <= 1e-4) {
    return 0;
  }
  return signedArea > 0 ? 1 : -1;
};

const resolvePoleTarget = (
  state: RigState,
  chain: ChainDescriptor,
  joints: Record<JointId, JointState>,
  target: Vec2
): Vec2 | undefined => {
  if (chain.joints.length !== 3) {
    return undefined;
  }
  const poleJointId = chain.joints[1];
  const poleTarget = state.ikPoleTargets[poleJointId];
  if (poleTarget?.active) {
    return { x: poleTarget.x, y: poleTarget.y };
  }

  const world = computeWorldTransforms(joints);
  const rootPoint = world[chain.joints[0]]?.worldPosition;
  const midPoint = world[chain.joints[1]]?.worldPosition;
  const effectorPoint = world[chain.joints[2]]?.worldPosition;
  if (!rootPoint || !midPoint || !effectorPoint) {
    return undefined;
  }

  // Pole sign memory mirrors a common open-source trick: retain bend side between frames
  // to prevent elbow/knee flips when the chain approaches straight alignment.
  const observedSign = observeBendSign(rootPoint, midPoint, effectorPoint);
  if (observedSign !== 0) {
    chainBendSignMemory.set(chain.id, observedSign);
  }
  const bendSign =
    observedSign ||
    chainBendSignMemory.get(chain.id) ||
    CHAIN_DEFAULT_BEND_SIGN[chain.id] ||
    1;

  const aimVectorRaw = subVec2(target, rootPoint);
  const fallbackVectorRaw = subVec2(effectorPoint, rootPoint);
  const aimVector =
    lengthVec2(aimVectorRaw) > 1e-5
      ? normalizeVec2(aimVectorRaw)
      : normalizeVec2(fallbackVectorRaw);
  if (lengthVec2(aimVector) <= 1e-5) {
    return { ...midPoint };
  }

  const chainSpan = Math.max(1, lengthVec2(fallbackVectorRaw));
  const alongDistance = Math.max(24, chainSpan * 0.46);
  const poleDistance = Math.max(20, chainSpan * 0.62);
  const poleBase = addVec2(rootPoint, scaleVec2(aimVector, alongDistance));
  const perpendicular = {
    x: -aimVector.y * bendSign,
    y: aimVector.x * bendSign,
  };
  return addVec2(poleBase, scaleVec2(perpendicular, poleDistance));
};

const rememberSolvedBendSign = (
  chain: ChainDescriptor,
  solvedPositions: Partial<Record<JointId, Vec2>>
): void => {
  if (chain.joints.length !== 3) {
    return;
  }
  const rootPoint = solvedPositions[chain.joints[0]];
  const midPoint = solvedPositions[chain.joints[1]];
  const effectorPoint = solvedPositions[chain.joints[2]];
  if (!rootPoint || !midPoint || !effectorPoint) {
    return;
  }
  const sign = observeBendSign(rootPoint, midPoint, effectorPoint);
  if (sign !== 0) {
    chainBendSignMemory.set(chain.id, sign);
  }
};

const solveChain = (
  state: RigState,
  joints: Record<JointId, JointState>,
  chain: ChainDescriptor,
  settings: RigSolverSettings,
  runtimeOptions: IkSolveRuntimeOptions,
  pins: PinConstraint[]
): SolveChainResult | null => {
  const constraintSettings = {
    ...DEFAULT_CONSTRAINT_SETTINGS,
    ...(runtimeOptions.constraintSettings ?? {}),
  };
  const target = resolveChainTargetWithPins(
    { ...state, joints },
    chain,
    pins,
    constraintSettings
  );
  if (!target) {
    return null;
  }

  const world = computeWorldTransforms(joints);
  const chainStretchAllowed = Boolean(runtimeOptions.allowStretch);
  const solved = solveFabrikChain({
    chain: chain.joints,
    joints,
    world,
    target,
    poleTarget: resolvePoleTarget(state, chain, joints, target),
    pins,
    jointLimits: chain.jointLimits,
    maxIterations: settings.maxIterations,
    epsilon: settings.epsilon,
    allowStretch: chainStretchAllowed,
    softStretch: resolveChainSoftStretch(chain, chainStretchAllowed),
  });
  rememberSolvedBendSign(chain, solved.positions);

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

const solveChainCcd = (
  state: RigState,
  joints: Record<JointId, JointState>,
  chain: ChainDescriptor,
  settings: RigSolverSettings,
  runtimeOptions: IkSolveRuntimeOptions,
  pins: PinConstraint[]
): SolveChainResult | null => {
  const constraintSettings = {
    ...DEFAULT_CONSTRAINT_SETTINGS,
    ...(runtimeOptions.constraintSettings ?? {}),
  };
  const target = resolveChainTargetWithPins(
    { ...state, joints },
    chain,
    pins,
    constraintSettings
  );
  if (!target) {
    return null;
  }

  const world = computeWorldTransforms(joints);
  const chainStretchAllowed = Boolean(runtimeOptions.allowStretch);
  const solved = solveCcdChain({
    chain: chain.joints,
    joints,
    world,
    target,
    poleTarget: resolvePoleTarget(state, chain, joints, target),
    pins,
    jointLimits: chain.jointLimits,
    maxIterations: settings.maxIterations,
    epsilon: settings.epsilon,
    allowStretch: chainStretchAllowed,
    softStretch: resolveChainSoftStretch(chain, chainStretchAllowed),
  });
  rememberSolvedBendSign(chain, solved.positions);

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

type IkSolverFn = (
  state: RigState,
  solverSettings: Partial<RigSolverSettings> | undefined,
  runtimeOptions: IkSolveRuntimeOptions
) => { joints: Record<JointId, JointState>; diagnostics: RigSolveDiagnostics };

const solveRigWithFabrik: IkSolverFn = (
  state,
  solverSettings,
  runtimeOptions
): { joints: Record<JointId, JointState>; diagnostics: RigSolveDiagnostics } => {
  const settings: RigSolverSettings = {
    ...DEFAULT_SOLVER_SETTINGS,
    ...solverSettings,
  };
  const constraintSettings = {
    ...DEFAULT_CONSTRAINT_SETTINGS,
    ...(runtimeOptions.constraintSettings ?? {}),
  };
  const pinsForSolve = constraintSettings.ikFrictionOff
    ? state.pins
    : buildPinsWithGroundedAnkleXLocks(
        state.joints,
        state.pins,
        runtimeOptions.manipulatedJointId ?? null,
        constraintSettings
      );

  const startMs = nowMs();
  let workingJoints = applyDirectRootTarget(state, state.joints, pinsForSolve);
  let maxResidual = 0;
  let totalIterations = 0;
  let chainsSolved = 0;
  let globalPasses = 0;

  const chains = resolveChainSetForMode(state, runtimeOptions);
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

const solveRigWithCcd: IkSolverFn = (
  state,
  solverSettings,
  runtimeOptions
): { joints: Record<JointId, JointState>; diagnostics: RigSolveDiagnostics } => {
  const settings: RigSolverSettings = {
    ...DEFAULT_SOLVER_SETTINGS,
    ...solverSettings,
  };
  const constraintSettings = {
    ...DEFAULT_CONSTRAINT_SETTINGS,
    ...(runtimeOptions.constraintSettings ?? {}),
  };
  const pinsForSolve = constraintSettings.ikFrictionOff
    ? state.pins
    : buildPinsWithGroundedAnkleXLocks(
        state.joints,
        state.pins,
        runtimeOptions.manipulatedJointId ?? null,
        constraintSettings
      );

  const startMs = nowMs();
  let workingJoints = applyDirectRootTarget(state, state.joints, pinsForSolve);
  let maxResidual = 0;
  let totalIterations = 0;
  let chainsSolved = 0;
  let globalPasses = 0;

  const chains = resolveChainSetForMode(state, runtimeOptions);
  if (!chains.length) {
    return {
      joints: workingJoints,
      diagnostics: { ...EMPTY_DIAGNOSTICS, solveMs: nowMs() - startMs },
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
        const solved = solveChainCcd(state, workingJoints, chain, settings, runtimeOptions, pinsForSolve);
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
      const solved = solveChainCcd(state, workingJoints, chain, settings, runtimeOptions, pinsForSolve);
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

const solveRigWithHybrid: IkSolverFn = (
  state,
  solverSettings,
  runtimeOptions
): { joints: Record<JointId, JointState>; diagnostics: RigSolveDiagnostics } => {
  // First pass: FABRIK full solve.
  const fabrikResult = solveRigWithFabrik(state, solverSettings, runtimeOptions);
  const baseDiagnostics = fabrikResult.diagnostics;

  // Second pass: CCD refinement on limbs to sharpen elbows/knees/hips.
  const settings: RigSolverSettings = {
    ...DEFAULT_SOLVER_SETTINGS,
    ...solverSettings,
  };
  const constraintSettings = {
    ...DEFAULT_CONSTRAINT_SETTINGS,
    ...(runtimeOptions.constraintSettings ?? {}),
  };
  const pinsForSolve = constraintSettings.ikFrictionOff
    ? state.pins
    : buildPinsWithGroundedAnkleXLocks(
        fabrikResult.joints,
        state.pins,
        runtimeOptions.manipulatedJointId ?? null,
        constraintSettings
      );

  let workingJoints = fabrikResult.joints;
  let maxResidual = baseDiagnostics.residual;
  let totalIterations = baseDiagnostics.iterations;
  let chainsSolved = baseDiagnostics.chainsSolved;

  for (const chain of LIMB_CHAINS) {
    const solved = solveChainCcd(state, workingJoints, chain, settings, runtimeOptions, pinsForSolve);
    if (!solved) {
      continue;
    }
    workingJoints = solved.joints;
    maxResidual = Math.max(maxResidual, solved.residual);
    totalIterations += solved.iterations;
    chainsSolved += 1;
  }

  const diagnostics: RigSolveDiagnostics = {
    iterations: totalIterations,
    residual: maxResidual,
    solveMs: baseDiagnostics.solveMs, // keep original timing; hybrid refinement is negligible for UX.
    chainsSolved,
    globalPasses: baseDiagnostics.globalPasses,
  };

  return {
    joints: workingJoints,
    diagnostics,
  };
};

const applyRootPelvisDistribution = (
  state: RigState,
  solvedJoints: Record<JointId, JointState>,
  runtimeOptions: IkSolveRuntimeOptions
): Record<JointId, JointState> => {
  const rootManipulated =
    runtimeOptions.manipulatedJointId === "root" || Boolean(state.ikTargets.root?.active);
  if (!rootManipulated) {
    return solvedJoints;
  }

  const beforeWorld = computeWorldTransforms(state.joints);
  const afterWorld = computeWorldTransforms(solvedJoints);
  const rootDelta = subVec2(afterWorld.root.worldPosition, beforeWorld.root.worldPosition);
  if (lengthVec2(rootDelta) <= 1e-5) {
    return solvedJoints;
  }

  const next = cloneJoints(solvedJoints);
  const branchDelta = scaleVec2(rootDelta, 1 - ROOT_MOTION_ROOT_WEIGHT);
  const rootPortion = scaleVec2(rootDelta, ROOT_MOTION_ROOT_WEIGHT);
  next.root = {
    ...next.root,
    localTranslation: addVec2(state.joints.root.localTranslation, rootPortion),
  };

  const rootRotation = computeWorldTransforms(next).root.worldRotationDeg;
  const applyBranchDelta = (jointId: "waist" | "l_hip" | "r_hip", weight: number): void => {
    const joint = next[jointId];
    if (!joint || joint.parentId !== "root") {
      return;
    }
    const localDelta = inverseRotateVec2(scaleVec2(branchDelta, weight), rootRotation);
    next[jointId] = {
      ...joint,
      localTranslation: addVec2(joint.localTranslation, localDelta),
    };
  };

  applyBranchDelta("waist", ROOT_MOTION_BRANCH_WEIGHTS.waist);
  applyBranchDelta("l_hip", ROOT_MOTION_BRANCH_WEIGHTS.l_hip);
  applyBranchDelta("r_hip", ROOT_MOTION_BRANCH_WEIGHTS.r_hip);
  return next;
};

const SOLVER_REGISTRY: Record<IkSolverId, IkSolverFn> = {
  fabrik: solveRigWithFabrik,
  ccd: solveRigWithCcd,
  hybrid: solveRigWithHybrid,
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

  const solverId: IkSolverId = state.ikSolver ?? "fabrik";
  const solver = SOLVER_REGISTRY[solverId] ?? solveRigWithFabrik;
  const solved = solver(state, solverSettings, runtimeOptions);
  return {
    joints: applyRootPelvisDistribution(state, solved.joints, runtimeOptions),
    diagnostics: solved.diagnostics,
  };
};
