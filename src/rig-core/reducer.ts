import {
  DEFAULT_CONSTRAINT_SETTINGS,
  DragState,
  EMPTY_DIAGNOSTICS,
  JointId,
  JointState,
  JOINT_IDS,
  RigAction,
  RigSolveDiagnostics,
  RigState,
  Vec2,
  DEFAULT_SOLVER_SETTINGS,
  createInitialRigState,
} from "./types";
import { setFkRotationSlider, setFkRotationText, setFkTranslation } from "./fk";
import { applyPinsToJointState, removePin, upsertPin } from "./pins";
import { solveRigInIkMode } from "./ik/modes";
import { applyOverlayPatch, resetOverlayTransform } from "./overlay";
import { cloneJoints } from "./graph";

export type RigReducerState = RigState & {
  dragState: DragState | null;
  diagnostics: RigSolveDiagnostics;
  rigidLocalTranslations: Record<JointId, Vec2>;
};

const withFreshDiagnostics = (state: RigReducerState): RigReducerState => ({
  ...state,
  diagnostics: EMPTY_DIAGNOSTICS,
});

const cloneLocalTranslations = (joints: Record<JointId, { localTranslation: Vec2 }>): Record<JointId, Vec2> => {
  const next = {} as Record<JointId, Vec2>;
  for (const jointId of JOINT_IDS) {
    next[jointId] = { ...joints[jointId].localTranslation };
  }
  return next;
};

const restoreRigidSegmentTranslations = (state: RigReducerState): Record<JointId, JointState> => {
  const next = cloneJoints(state.joints);
  for (const jointId of JOINT_IDS) {
    if (!next[jointId].parentId) {
      continue;
    }
    next[jointId] = {
      ...next[jointId],
      localTranslation: { ...state.rigidLocalTranslations[jointId] },
    };
  }
  return next;
};

const maybeRunIkSolve = (state: RigReducerState, shouldRun: boolean): RigReducerState => {
  if (!shouldRun || state.mode !== "IK") {
    return state;
  }

  const allowStretch = state.ikStretchEnabled && state.dragState?.handle === "joint";
  const manipulatedJointId =
    state.dragState && (state.dragState.handle === "joint" || state.dragState.handle === "target")
      ? state.dragState.jointId
      : null;
  const solved = solveRigInIkMode(state, DEFAULT_SOLVER_SETTINGS, {
    allowStretch,
    manipulatedJointId,
    constraintSettings: state.constraintSettings,
  });
  return {
    ...state,
    joints: solved.joints,
    diagnostics: solved.diagnostics,
  };
};

const enforceRootWaistLock = (state: RigReducerState): RigReducerState => {
  if (!state.constraintSettings.enforceRootWaistLock) {
    return state;
  }
  const waist = state.joints.waist;
  if (waist.localTranslation.x === 0 && waist.localTranslation.y === 0) {
    return state;
  }
  const joints = cloneJoints(state.joints);
  joints.root = {
    ...joints.root,
    localTranslation: {
      x: joints.root.localTranslation.x + waist.localTranslation.x,
      y: joints.root.localTranslation.y + waist.localTranslation.y,
    },
  };
  joints.waist = {
    ...joints.waist,
    localTranslation: { x: 0, y: 0 },
  };
  return {
    ...state,
    joints,
  };
};

const updateDragState = (dragState: DragState | null, x: number, y: number): DragState | null => {
  if (!dragState) {
    return null;
  }
  return {
    ...dragState,
    current: { x, y },
  };
};

const setTargetForJoint = (state: RigReducerState, jointId: JointId, x: number, y: number): RigReducerState => ({
  ...state,
  ikTargets: {
    ...state.ikTargets,
    [jointId]: {
      jointId,
      x,
      y,
      active: true,
    },
  },
});

const setPoleTargetForJoint = (
  state: RigReducerState,
  jointId: JointId,
  x: number,
  y: number
): RigReducerState => ({
  ...state,
  ikPoleTargets: {
    ...state.ikPoleTargets,
    [jointId]: {
      jointId,
      x,
      y,
      active: true,
    },
  },
});

export const createInitialRigReducerState = (seed?: Partial<RigState>): RigReducerState => {
  const initial = createInitialRigState(seed);
  return {
    ...initial,
    dragState: null,
    diagnostics: EMPTY_DIAGNOSTICS,
    rigidLocalTranslations: cloneLocalTranslations(initial.joints),
  };
};

export const rigReducer = (state: RigReducerState, action: RigAction): RigReducerState => {
  let nextState = state;
  let shouldRunIkSolve = false;

  switch (action.type) {
    case "HYDRATE_STATE": {
      nextState = {
        ...action.state,
        ikStretchEnabled: action.state.ikStretchEnabled ?? false,
        constraintSettings: {
          ...DEFAULT_CONSTRAINT_SETTINGS,
          ...(action.state.constraintSettings ?? {}),
        },
        dragState: null,
        diagnostics: EMPTY_DIAGNOSTICS,
        rigidLocalTranslations: cloneLocalTranslations(action.state.joints),
      };
      shouldRunIkSolve = nextState.mode === "IK";
      break;
    }

    case "SET_MODE": {
      if (action.mode === state.mode) {
        return state;
      }
      nextState = {
        ...state,
        mode: action.mode,
      };
      shouldRunIkSolve = action.mode === "IK";
      if (action.mode === "FK") {
        nextState = withFreshDiagnostics(nextState);
      }
      break;
    }

    case "SET_IK_SOLVE_MODE": {
      if (action.ikSolveMode === state.ikSolveMode) {
        return state;
      }
      nextState = {
        ...state,
        ikSolveMode: action.ikSolveMode,
      };
      shouldRunIkSolve = nextState.mode === "IK";
      break;
    }

    case "SET_IK_STRETCH_ENABLED": {
      if (action.enabled === state.ikStretchEnabled) {
        return state;
      }
      const restoringRigid = state.ikStretchEnabled && !action.enabled;
      nextState = {
        ...state,
        ikStretchEnabled: action.enabled,
        joints: restoringRigid ? restoreRigidSegmentTranslations(state) : state.joints,
      };
      shouldRunIkSolve = nextState.mode === "IK";
      break;
    }

    case "SET_CONSTRAINT_SETTINGS": {
      nextState = {
        ...state,
        constraintSettings: {
          ...state.constraintSettings,
          ...action.patch,
        },
      };
      shouldRunIkSolve = nextState.mode === "IK";
      break;
    }

    case "SELECT_JOINT": {
      if (action.jointId === state.selectedJointId) {
        return state;
      }
      nextState = {
        ...state,
        selectedJointId: action.jointId,
      };
      break;
    }

    case "FK_SET_ROTATION_SLIDER": {
      if (state.mode !== "FK") {
        return state;
      }
      nextState = withFreshDiagnostics({
        ...state,
        joints: setFkRotationSlider(
          state.joints,
          action.jointId,
          action.sliderDeg,
          state.pins,
          state.constraintSettings
        ),
      });
      break;
    }

    case "FK_SET_ROTATION_TEXT": {
      if (state.mode !== "FK") {
        return state;
      }
      nextState = withFreshDiagnostics({
        ...state,
        joints: setFkRotationText(
          state.joints,
          action.jointId,
          action.rawDeg,
          state.pins,
          state.constraintSettings
        ),
      });
      break;
    }

    case "FK_SET_TRANSLATION": {
      const isRootTranslation = action.jointId === "root";
      if (state.mode !== "FK" && !isRootTranslation) {
        return state;
      }
      nextState = withFreshDiagnostics({
        ...state,
        joints: setFkTranslation(
          state.joints,
          action.jointId,
          action.x,
          action.y,
          state.pins,
          state.constraintSettings
        ),
      });
      shouldRunIkSolve = state.mode === "IK" && isRootTranslation;
      break;
    }

    case "IK_SET_TARGET": {
      nextState = setTargetForJoint(state, action.jointId, action.x, action.y);
      shouldRunIkSolve = nextState.mode === "IK";
      break;
    }

    case "IK_SET_POLE_TARGET": {
      nextState = setPoleTargetForJoint(state, action.jointId, action.x, action.y);
      shouldRunIkSolve = nextState.mode === "IK";
      break;
    }

    case "IK_CLEAR_TARGET": {
      nextState = {
        ...state,
        ikTargets: {
          ...state.ikTargets,
          [action.jointId]: undefined,
        },
      };
      shouldRunIkSolve = nextState.mode === "IK";
      break;
    }

    case "IK_CLEAR_POLE_TARGET": {
      nextState = {
        ...state,
        ikPoleTargets: {
          ...state.ikPoleTargets,
          [action.jointId]: undefined,
        },
      };
      shouldRunIkSolve = nextState.mode === "IK";
      break;
    }

    case "PIN_SET": {
      const pins = upsertPin(state.pins, action.pin);
      nextState = {
        ...state,
        pins,
      };
      if (nextState.mode === "FK") {
        nextState = withFreshDiagnostics({
          ...nextState,
          joints: applyPinsToJointState(nextState.joints, pins),
        });
      } else {
        shouldRunIkSolve = true;
      }
      break;
    }

    case "PIN_REMOVE": {
      const pins = removePin(state.pins, action.jointId, action.kind);
      nextState = {
        ...state,
        pins,
      };
      if (nextState.mode === "FK") {
        nextState = withFreshDiagnostics({
          ...nextState,
          joints: applyPinsToJointState(nextState.joints, pins),
        });
      } else {
        shouldRunIkSolve = true;
      }
      break;
    }

    case "DRAG_START": {
      nextState = {
        ...state,
        selectedJointId: action.jointId,
        dragState: {
          jointId: action.jointId,
          handle: action.handle,
          start: { x: action.x, y: action.y },
          current: { x: action.x, y: action.y },
        },
      };

      if (state.mode === "IK" && action.handle !== "bone") {
        nextState = setTargetForJoint(nextState, action.jointId, action.x, action.y);
        shouldRunIkSolve = true;
      }
      break;
    }

    case "DRAG_MOVE": {
      if (!state.dragState) {
        return state;
      }

      nextState = {
        ...state,
        dragState: updateDragState(state.dragState, action.x, action.y),
      };

      if (state.mode === "IK") {
        if (state.dragState.handle !== "bone") {
          nextState = setTargetForJoint(nextState, state.dragState.jointId, action.x, action.y);
          shouldRunIkSolve = true;
        }
      } else if (state.dragState.handle === "bone") {
        nextState = withFreshDiagnostics({
          ...nextState,
          joints: setFkTranslation(
            state.joints,
            state.dragState.jointId,
            action.x,
            action.y,
            state.pins,
            state.constraintSettings
          ),
        });
      }
      break;
    }

    case "DRAG_END": {
      if (!state.dragState) {
        return state;
      }
      nextState = {
        ...state,
        dragState: null,
      };
      break;
    }

    case "OVERLAY_ADD": {
      nextState = {
        ...state,
        overlays: [...state.overlays, action.overlay],
      };
      break;
    }

    case "OVERLAY_UPDATE": {
      nextState = {
        ...state,
        overlays: state.overlays.map((overlay) =>
          overlay.id === action.overlayId ? applyOverlayPatch(overlay, action.patch) : overlay
        ),
      };
      break;
    }

    case "OVERLAY_REMOVE": {
      nextState = {
        ...state,
        overlays: state.overlays.filter((overlay) => overlay.id !== action.overlayId),
      };
      break;
    }

    case "OVERLAY_PLACE_ON_JOINT": {
      nextState = {
        ...state,
        overlays: state.overlays.map((overlay) =>
          overlay.id === action.overlayId
            ? {
                ...overlay,
                parentJointId: action.jointId,
                offset: { x: 0, y: 0 },
                rotation: 0,
              }
            : overlay
        ),
      };
      break;
    }

    case "OVERLAY_RESET": {
      nextState = {
        ...state,
        overlays: state.overlays.map((overlay) =>
          overlay.id === action.overlayId ? resetOverlayTransform(overlay) : overlay
        ),
      };
      break;
    }

    default: {
      return state;
    }
  }

  const solved = enforceRootWaistLock(maybeRunIkSolve(nextState, shouldRunIkSolve));
  if (!solved.ikStretchEnabled) {
    return {
      ...solved,
      rigidLocalTranslations: cloneLocalTranslations(solved.joints),
    };
  }
  return solved;
};
