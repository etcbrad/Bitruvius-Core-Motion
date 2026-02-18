import {
  DEFAULT_BACKGROUND_SHADOW_SETTINGS,
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
import { clampIkTargetForGroundedReach } from "./constraints/groundPins";
import {
  applyOverlayPatch,
  applySceneLayerPatch,
  calibrateOverlaySegmentRestPose,
  createDefaultBackgroundLayer,
  createDefaultForegroundLayer,
  resetOverlayTransform,
} from "./overlay";
import { cloneJoints, computeWorldTransforms } from "./graph";

export type RigReducerState = RigState & {
  dragState: DragState | null;
  diagnostics: RigSolveDiagnostics;
  rigidLocalTranslations: Record<JointId, Vec2>;
};

const ACTION_POINT_EPSILON = 1e-3;
const hasPointDelta = (a: Vec2, b: Vec2, epsilon = ACTION_POINT_EPSILON): boolean =>
  Math.abs(a.x - b.x) > epsilon || Math.abs(a.y - b.y) > epsilon;

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
  const frictionOffForMode =
    state.mode === "FK"
      ? state.constraintSettings.fkFrictionOff
      : state.constraintSettings.ikFrictionOff;
  if (!state.constraintSettings.enforceRootWaistLock || frictionOffForMode) {
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
  if (!hasPointDelta(dragState.current, { x, y })) {
    return dragState;
  }
  return {
    ...dragState,
    current: { x, y },
  };
};

const setTargetForJoint = (state: RigReducerState, jointId: JointId, x: number, y: number): RigReducerState => {
  const clampedTarget = clampIkTargetForGroundedReach(
    state.joints,
    state.pins,
    jointId,
    { x, y },
    state.ikStretchEnabled,
    state.constraintSettings
  );
  const nextX = clampedTarget.x;
  const nextY = clampedTarget.y;
  const existing = state.ikTargets[jointId];
  if (
    existing &&
    existing.active &&
    Math.abs(existing.x - nextX) <= ACTION_POINT_EPSILON &&
    Math.abs(existing.y - nextY) <= ACTION_POINT_EPSILON
  ) {
    return state;
  }
  return {
    ...state,
    ikTargets: {
      ...state.ikTargets,
      [jointId]: {
        jointId,
        x: nextX,
        y: nextY,
        active: true,
      },
    },
  };
};

const setPoleTargetForJoint = (
  state: RigReducerState,
  jointId: JointId,
  x: number,
  y: number
): RigReducerState => {
  const existing = state.ikPoleTargets[jointId];
  if (
    existing &&
    existing.active &&
    Math.abs(existing.x - x) <= ACTION_POINT_EPSILON &&
    Math.abs(existing.y - y) <= ACTION_POINT_EPSILON
  ) {
    return state;
  }
  return {
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
  };
};

export const createInitialRigReducerState = (seed?: Partial<RigState>): RigReducerState => {
  const initial = createInitialRigState(seed);
  const world = computeWorldTransforms(initial.joints);
  return {
    ...initial,
    overlays: initial.overlays.map((overlay) => calibrateOverlaySegmentRestPose(overlay, world)),
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
      const hydrated = createInitialRigState(action.state);
      const world = computeWorldTransforms(hydrated.joints);
      nextState = {
        ...hydrated,
        ikStretchEnabled: hydrated.ikStretchEnabled ?? false,
        constraintSettings: {
          ...DEFAULT_CONSTRAINT_SETTINGS,
          ...(hydrated.constraintSettings ?? {}),
        },
        ikSolver: hydrated.ikSolver ?? "fabrik",
        skeletonVersion: hydrated.skeletonVersion ?? "v1",
        overlays: hydrated.overlays.map((overlay) => calibrateOverlaySegmentRestPose(overlay, world)),
        dragState: null,
        diagnostics: EMPTY_DIAGNOSTICS,
        rigidLocalTranslations: cloneLocalTranslations(hydrated.joints),
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

    case "SET_SKELETON_VERSION": {
      if (action.version === state.skeletonVersion) {
        return state;
      }
      nextState = {
        ...state,
        skeletonVersion: action.version,
      };
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

    case "SET_IK_SOLVER": {
      if (action.solver === state.ikSolver) {
        return state;
      }
      nextState = {
        ...state,
        ikSolver: action.solver,
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
      const withTarget = setTargetForJoint(state, action.jointId, action.x, action.y);
      if (withTarget === state) {
        return state;
      }
      nextState = withTarget;
      shouldRunIkSolve = nextState.mode === "IK";
      break;
    }

    case "IK_SET_POLE_TARGET": {
      const withPoleTarget = setPoleTargetForJoint(state, action.jointId, action.x, action.y);
      if (withPoleTarget === state) {
        return state;
      }
      nextState = withPoleTarget;
      shouldRunIkSolve = nextState.mode === "IK";
      break;
    }

    case "IK_CLEAR_TARGET": {
      if (!state.ikTargets[action.jointId]) {
        return state;
      }
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
      if (!state.ikPoleTargets[action.jointId]) {
        return state;
      }
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
      break;
    }

    case "DRAG_MOVE": {
      if (!state.dragState) {
        return state;
      }

      const updatedDragState = updateDragState(state.dragState, action.x, action.y);
      const sameDragPoint = updatedDragState === state.dragState;
      nextState = sameDragPoint
        ? state
        : {
            ...state,
            dragState: updatedDragState,
          };

      if (state.mode === "IK") {
        if (state.dragState.handle !== "bone") {
          const withTarget = setTargetForJoint(nextState, state.dragState.jointId, action.x, action.y);
          if (withTarget !== nextState) {
            nextState = withTarget;
            shouldRunIkSolve = true;
          } else if (sameDragPoint) {
            return state;
          }
        } else if (sameDragPoint) {
          return state;
        }
      } else if (state.dragState.handle === "bone") {
        if (sameDragPoint) {
          return state;
        }
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
      const world = computeWorldTransforms(state.joints);
      nextState = {
        ...state,
        overlays: [...state.overlays, calibrateOverlaySegmentRestPose(action.overlay, world)],
      };
      break;
    }

    case "OVERLAY_UPDATE": {
      const world = computeWorldTransforms(state.joints);
      nextState = {
        ...state,
        overlays: state.overlays.map((overlay) =>
          overlay.id === action.overlayId
            ? calibrateOverlaySegmentRestPose(applyOverlayPatch(overlay, action.patch), world)
            : overlay
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
      const world = computeWorldTransforms(state.joints);
      nextState = {
        ...state,
        overlays: state.overlays.map((overlay) =>
          overlay.id === action.overlayId
            ? calibrateOverlaySegmentRestPose(
                {
                  ...overlay,
                  parentJointId: action.jointId,
                  offset: { x: 0, y: 0 },
                  rotation: 0,
                },
                world
              )
            : overlay
        ),
      };
      break;
    }

    case "OVERLAY_RESET": {
      const world = computeWorldTransforms(state.joints);
      nextState = {
        ...state,
        overlays: state.overlays.map((overlay) =>
          overlay.id === action.overlayId
            ? calibrateOverlaySegmentRestPose(resetOverlayTransform(overlay), world)
            : overlay
        ),
      };
      break;
    }

    case "SCENE_LAYER_SET_IMAGE": {
      nextState = {
        ...state,
        sceneLayers: {
          ...state.sceneLayers,
          [action.layer]: {
            ...state.sceneLayers[action.layer],
            dataUrl: action.dataUrl,
            name: action.name ?? state.sceneLayers[action.layer].name,
          },
        },
      };
      break;
    }

    case "SCENE_LAYER_UPDATE": {
      nextState = {
        ...state,
        sceneLayers: {
          ...state.sceneLayers,
          [action.layer]: applySceneLayerPatch(state.sceneLayers[action.layer], action.patch),
        },
      };
      break;
    }

    case "SCENE_BACKGROUND_SHADOW_UPDATE": {
      nextState = {
        ...state,
        sceneLayers: {
          ...state.sceneLayers,
          backgroundShadow: {
            ...state.sceneLayers.backgroundShadow,
            ...action.patch,
          },
        },
      };
      break;
    }

    case "SCENE_LAYER_RESET": {
      if (action.layer === "all") {
        nextState = {
          ...state,
          sceneLayers: {
            background: createDefaultBackgroundLayer(),
            foreground: createDefaultForegroundLayer(),
            backgroundShadow: { ...DEFAULT_BACKGROUND_SHADOW_SETTINGS },
          },
        };
      } else {
        nextState = {
          ...state,
          sceneLayers: {
            ...state.sceneLayers,
            [action.layer]:
              action.layer === "background"
                ? createDefaultBackgroundLayer()
                : createDefaultForegroundLayer(),
          },
        };
      }
      break;
    }

    case "RUNTIME_DAMP_PELVIS": {
      const alpha = Math.max(0, Math.min(1, action.alpha));
      if (alpha <= 0) {
        return state;
      }

      const blend = (current: Vec2, target: Vec2): Vec2 => ({
        x: current.x + (target.x - current.x) * alpha,
        y: current.y + (target.y - current.y) * alpha,
      });

      const joints = cloneJoints(state.joints);
      let changed = false;

      if (Math.abs(joints.root.localTranslation.y - action.rootY) > 1e-4) {
        joints.root = {
          ...joints.root,
          localTranslation: {
            x: joints.root.localTranslation.x,
            y: action.rootY,
          },
        };
        changed = true;
      }

      const applyBlendForJoint = (
        jointId: JointId,
        target: Vec2
      ): void => {
        const current = joints[jointId].localTranslation;
        const next = blend(current, target);
        if (Math.abs(next.x - current.x) <= 1e-4 && Math.abs(next.y - current.y) <= 1e-4) {
          return;
        }
        joints[jointId] = {
          ...joints[jointId],
          localTranslation: next,
        };
        changed = true;
      };

      applyBlendForJoint("waist", action.waistTarget);
      applyBlendForJoint("l_hip", action.lHipTarget);
      applyBlendForJoint("r_hip", action.rHipTarget);

      if (!changed) {
        return state;
      }

      const nextJoints =
        state.mode === "FK" ? applyPinsToJointState(joints, state.pins) : joints;
      nextState = withFreshDiagnostics({
        ...state,
        joints: nextJoints,
      });
      shouldRunIkSolve = state.mode === "IK";
      break;
    }

    default: {
      return state;
    }
  }

  const solved = enforceRootWaistLock(maybeRunIkSolve(nextState, shouldRunIkSolve));
  if (!solved.ikStretchEnabled) {
    const rigidLocalTranslations =
      solved.joints === state.joints
        ? state.rigidLocalTranslations
        : cloneLocalTranslations(solved.joints);
    if (rigidLocalTranslations === solved.rigidLocalTranslations) {
      return solved;
    }
    return {
      ...solved,
      rigidLocalTranslations,
    };
  }
  return solved;
};
