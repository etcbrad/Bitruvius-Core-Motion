import { ConstraintSettings, ControlMode, IkSolveMode, JointId, PinConstraint, RigAction, SvgOverlay } from "./types";

export const RigActions = {
  setMode: (mode: ControlMode): RigAction => ({ type: "SET_MODE", mode }),
  setIkSolveMode: (ikSolveMode: IkSolveMode): RigAction => ({ type: "SET_IK_SOLVE_MODE", ikSolveMode }),
  setIkStretchEnabled: (enabled: boolean): RigAction => ({ type: "SET_IK_STRETCH_ENABLED", enabled }),
  setConstraintSettings: (patch: Partial<ConstraintSettings>): RigAction => ({
    type: "SET_CONSTRAINT_SETTINGS",
    patch,
  }),
  selectJoint: (jointId: JointId | null): RigAction => ({
    type: "SELECT_JOINT",
    jointId,
  }),
  fkSetRotationSlider: (jointId: JointId, sliderDeg: number): RigAction => ({
    type: "FK_SET_ROTATION_SLIDER",
    jointId,
    sliderDeg,
  }),
  fkSetRotationText: (jointId: JointId, rawDeg: number): RigAction => ({
    type: "FK_SET_ROTATION_TEXT",
    jointId,
    rawDeg,
  }),
  fkSetTranslation: (jointId: JointId, x: number, y: number): RigAction => ({
    type: "FK_SET_TRANSLATION",
    jointId,
    x,
    y,
  }),
  ikSetTarget: (jointId: JointId, x: number, y: number): RigAction => ({
    type: "IK_SET_TARGET",
    jointId,
    x,
    y,
  }),
  ikSetPoleTarget: (jointId: JointId, x: number, y: number): RigAction => ({
    type: "IK_SET_POLE_TARGET",
    jointId,
    x,
    y,
  }),
  ikClearPoleTarget: (jointId: JointId): RigAction => ({
    type: "IK_CLEAR_POLE_TARGET",
    jointId,
  }),
  pinSet: (pin: PinConstraint): RigAction => ({
    type: "PIN_SET",
    pin,
  }),
  pinRemove: (jointId: JointId, kind: "world" | "ground"): RigAction => ({
    type: "PIN_REMOVE",
    jointId,
    kind,
  }),
  addOverlay: (overlay: SvgOverlay): RigAction => ({
    type: "OVERLAY_ADD",
    overlay,
  }),
  updateOverlay: (overlayId: string, patch: Partial<SvgOverlay>): RigAction => ({
    type: "OVERLAY_UPDATE",
    overlayId,
    patch,
  }),
  removeOverlay: (overlayId: string): RigAction => ({
    type: "OVERLAY_REMOVE",
    overlayId,
  }),
  placeOverlayOnJoint: (overlayId: string, jointId: JointId): RigAction => ({
    type: "OVERLAY_PLACE_ON_JOINT",
    overlayId,
    jointId,
  }),
  resetOverlayTransform: (overlayId: string): RigAction => ({
    type: "OVERLAY_RESET",
    overlayId,
  }),
  dragStart: (jointId: JointId, x: number, y: number, handle: "joint" | "target" | "bone"): RigAction => ({
    type: "DRAG_START",
    jointId,
    x,
    y,
    handle,
  }),
  dragMove: (x: number, y: number): RigAction => ({
    type: "DRAG_MOVE",
    x,
    y,
  }),
  dragEnd: (): RigAction => ({ type: "DRAG_END" }),
} as const;
