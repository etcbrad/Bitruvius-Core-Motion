import { useCallback, useMemo, useReducer, type Dispatch } from "react";
import {
  ConstraintSettings,
  DEFAULT_CONSTRAINT_SETTINGS,
  IkSolveMode,
  JointId,
  PinConstraint,
  RigAction,
  RigState,
  RigWorldTransforms,
  SvgOverlay,
  createInitialRigState,
} from "../rig-core/types";
import { computeWorldTransforms } from "../rig-core/graph";
import { applyPinsToWorldTransforms } from "../rig-core/pins";
import { rigReducer, createInitialRigReducerState, type RigReducerState } from "../rig-core/reducer";
import { DEFAULT_OVERLAYS } from "../rig-core/defaultOverlays";

const baseInitialState = createInitialRigState();

const DEFAULT_RIG_SNAPSHOT: RigState = {
  mode: "FK",
  ikSolveMode: "single_chain",
  ikStretchEnabled: false,
  constraintSettings: {
    ...DEFAULT_CONSTRAINT_SETTINGS,
  },
  joints: baseInitialState.joints,
  pins: baseInitialState.pins,
  ikTargets: baseInitialState.ikTargets,
  ikPoleTargets: baseInitialState.ikPoleTargets,
  overlays: DEFAULT_OVERLAYS,
  selectedJointId: "xiphoid",
};

export type RigAdapter = {
  state: RigReducerState;
  worldTransforms: RigWorldTransforms;
  dispatch: Dispatch<RigAction>;
  hydrate: (nextState: RigState) => void;
  setMode: (mode: RigState["mode"]) => void;
  setIkSolveMode: (ikSolveMode: RigState["ikSolveMode"]) => void;
  setIkStretchEnabled: (enabled: boolean) => void;
  setConstraintSettings: (patch: Partial<ConstraintSettings>) => void;
  selectJoint: (jointId: JointId | null) => void;
  fkSetRotationSlider: (jointId: JointId, sliderDeg: number) => void;
  fkSetRotationText: (jointId: JointId, rawDeg: number) => void;
  fkSetTranslation: (jointId: JointId, x: number, y: number) => void;
  dragJointToWorldPosition: (jointId: JointId, x: number, y: number) => void;
  ikSetTarget: (jointId: JointId, x: number, y: number) => void;
  ikSetPoleTarget: (jointId: JointId, x: number, y: number) => void;
  clearIkTarget: (jointId: JointId) => void;
  clearIkPoleTarget: (jointId: JointId) => void;
  setPin: (pin: PinConstraint) => void;
  removePin: (jointId: JointId, kind: "world" | "ground") => void;
  cyclePin: (jointId: JointId) => void;
  dragStart: (jointId: JointId, x: number, y: number, handle: "joint" | "target" | "bone") => void;
  dragMove: (x: number, y: number) => void;
  dragEnd: () => void;
  addOverlay: (overlay: SvgOverlay) => void;
  updateOverlay: (overlayId: string, patch: Partial<SvgOverlay>) => void;
  removeOverlay: (overlayId: string) => void;
  placeOverlayOnJoint: (overlayId: string, jointId: JointId) => void;
  resetOverlayTransform: (overlayId: string) => void;
};

export const useRigAdapter = (initialState?: Partial<RigState>): RigAdapter => {
  const seedState: RigState = {
    ...DEFAULT_RIG_SNAPSHOT,
    ...(initialState ?? {}),
  };
  const [state, dispatch] = useReducer(rigReducer, seedState, createInitialRigReducerState);

  const worldTransforms = useMemo(() => {
    const world = computeWorldTransforms(state.joints);
    return applyPinsToWorldTransforms(world, state.pins).world;
  }, [state.joints, state.pins]);

  const hydrate = useCallback(
    (nextState: RigState) => {
      dispatch({ type: "HYDRATE_STATE", state: nextState });
    },
    [dispatch]
  );

  const setMode = useCallback(
    (mode: RigState["mode"]) => {
      dispatch({ type: "SET_MODE", mode });
    },
    [dispatch]
  );

  const setIkSolveMode = useCallback(
    (ikSolveMode: RigState["ikSolveMode"]) => {
      dispatch({ type: "SET_IK_SOLVE_MODE", ikSolveMode });
    },
    [dispatch]
  );

  const setIkStretchEnabled = useCallback(
    (enabled: boolean) => {
      dispatch({ type: "SET_IK_STRETCH_ENABLED", enabled });
    },
    [dispatch]
  );

  const setConstraintSettings = useCallback(
    (patch: Partial<ConstraintSettings>) => {
      dispatch({ type: "SET_CONSTRAINT_SETTINGS", patch });
    },
    [dispatch]
  );

  const selectJoint = useCallback(
    (jointId: JointId | null) => {
      dispatch({ type: "SELECT_JOINT", jointId });
    },
    [dispatch]
  );

  const fkSetRotationSlider = useCallback(
    (jointId: JointId, sliderDeg: number) => {
      dispatch({ type: "FK_SET_ROTATION_SLIDER", jointId, sliderDeg });
    },
    [dispatch]
  );

  const fkSetRotationText = useCallback(
    (jointId: JointId, rawDeg: number) => {
      dispatch({ type: "FK_SET_ROTATION_TEXT", jointId, rawDeg });
    },
    [dispatch]
  );

  const fkSetTranslation = useCallback(
    (jointId: JointId, x: number, y: number) => {
      dispatch({ type: "FK_SET_TRANSLATION", jointId, x, y });
    },
    [dispatch]
  );

  const dragJointToWorldPosition = useCallback(
    (jointId: JointId, x: number, y: number) => {
      if (state.mode === "IK") {
        dispatch({ type: "IK_SET_TARGET", jointId, x, y });
        return;
      }
      dispatch({ type: "FK_SET_TRANSLATION", jointId, x, y });
    },
    [dispatch, state.mode]
  );

  const ikSetTarget = useCallback(
    (jointId: JointId, x: number, y: number) => {
      dispatch({ type: "IK_SET_TARGET", jointId, x, y });
    },
    [dispatch]
  );

  const ikSetPoleTarget = useCallback(
    (jointId: JointId, x: number, y: number) => {
      dispatch({ type: "IK_SET_POLE_TARGET", jointId, x, y });
    },
    [dispatch]
  );

  const clearIkTarget = useCallback(
    (jointId: JointId) => {
      dispatch({ type: "IK_CLEAR_TARGET", jointId });
    },
    [dispatch]
  );

  const clearIkPoleTarget = useCallback(
    (jointId: JointId) => {
      dispatch({ type: "IK_CLEAR_POLE_TARGET", jointId });
    },
    [dispatch]
  );

  const setPin = useCallback(
    (pin: PinConstraint) => {
      dispatch({ type: "PIN_SET", pin });
    },
    [dispatch]
  );

  const removePin = useCallback(
    (jointId: JointId, kind: "world" | "ground") => {
      dispatch({ type: "PIN_REMOVE", jointId, kind });
    },
    [dispatch]
  );

  const cyclePin = useCallback(
    (jointId: JointId) => {
      const worldPin = state.pins.find((pin) => pin.jointId === jointId && pin.kind === "world");
      const groundPin = state.pins.find((pin) => pin.jointId === jointId && pin.kind === "ground");
      const jointPosition = worldTransforms[jointId].worldPosition;

      if (!worldPin && !groundPin) {
        dispatch({
          type: "PIN_SET",
          pin: {
            kind: "world",
            jointId,
            x: jointPosition.x,
            y: jointPosition.y,
            lockX: true,
            lockY: true,
          },
        });
        return;
      }

      if (worldPin) {
        dispatch({ type: "PIN_REMOVE", jointId, kind: "world" });
        dispatch({
          type: "PIN_SET",
          pin: {
            kind: "ground",
            jointId,
            groundY: jointPosition.y,
          },
        });
        return;
      }

      dispatch({ type: "PIN_REMOVE", jointId, kind: "ground" });
    },
    [dispatch, state.pins, worldTransforms]
  );

  const dragStart = useCallback(
    (jointId: JointId, x: number, y: number, handle: "joint" | "target" | "bone") => {
      dispatch({ type: "DRAG_START", jointId, x, y, handle });
    },
    [dispatch]
  );

  const dragMove = useCallback(
    (x: number, y: number) => {
      dispatch({ type: "DRAG_MOVE", x, y });
    },
    [dispatch]
  );

  const dragEnd = useCallback(
    () => {
      dispatch({ type: "DRAG_END" });
    },
    [dispatch]
  );

  const addOverlay = useCallback(
    (overlay: SvgOverlay) => {
      dispatch({ type: "OVERLAY_ADD", overlay });
    },
    [dispatch]
  );

  const updateOverlay = useCallback(
    (overlayId: string, patch: Partial<SvgOverlay>) => {
      dispatch({ type: "OVERLAY_UPDATE", overlayId, patch });
    },
    [dispatch]
  );

  const removeOverlay = useCallback(
    (overlayId: string) => {
      dispatch({ type: "OVERLAY_REMOVE", overlayId });
    },
    [dispatch]
  );

  const placeOverlayOnJoint = useCallback(
    (overlayId: string, jointId: JointId) => {
      dispatch({ type: "OVERLAY_PLACE_ON_JOINT", overlayId, jointId });
    },
    [dispatch]
  );

  const resetOverlayTransform = useCallback(
    (overlayId: string) => {
      dispatch({ type: "OVERLAY_RESET", overlayId });
    },
    [dispatch]
  );

  return {
    state,
    worldTransforms,
    dispatch,
    hydrate,
    setMode,
    setIkSolveMode,
    setIkStretchEnabled,
    setConstraintSettings,
    selectJoint,
    fkSetRotationSlider,
    fkSetRotationText,
    fkSetTranslation,
    dragJointToWorldPosition,
    ikSetTarget,
    ikSetPoleTarget,
    clearIkTarget,
    clearIkPoleTarget,
    setPin,
    removePin,
    cyclePin,
    dragStart,
    dragMove,
    dragEnd,
    addOverlay,
    updateOverlay,
    removeOverlay,
    placeOverlayOnJoint,
    resetOverlayTransform,
  };
};
