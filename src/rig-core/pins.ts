import {
  JointId,
  JointState,
  JOINT_IDS,
  PinConstraint,
  RigWorldTransforms,
  Vec2,
} from "./types";
import {
  bakeWorldPositionsIntoJointTranslations,
  buildChildMap,
  cloneJoints,
  computeWorldTransforms,
} from "./graph";

type PinProjectionResult = {
  world: RigWorldTransforms;
  appliedPins: number;
};

const collectDescendants = (
  rootJointId: JointId,
  childMap: Record<JointId, JointId[]>,
  acc: JointId[]
): void => {
  const children = childMap[rootJointId];
  for (const childId of children) {
    acc.push(childId);
    collectDescendants(childId, childMap, acc);
  }
};

export const upsertPin = (pins: PinConstraint[], nextPin: PinConstraint): PinConstraint[] => {
  const filtered = pins.filter((pin) => !(pin.jointId === nextPin.jointId && pin.kind === nextPin.kind));
  return [...filtered, nextPin];
};

export const removePin = (pins: PinConstraint[], jointId: JointId, kind: "world" | "ground"): PinConstraint[] =>
  pins.filter((pin) => !(pin.jointId === jointId && pin.kind === kind));

export const findPin = (
  pins: PinConstraint[],
  jointId: JointId,
  kind?: "world" | "ground"
): PinConstraint | undefined => pins.find((pin) => pin.jointId === jointId && (kind ? pin.kind === kind : true));

export const applyPinsToWorldTransforms = (
  world: RigWorldTransforms,
  pins: PinConstraint[]
): PinProjectionResult => {
  if (!pins.length) {
    return { world, appliedPins: 0 };
  }

  const nextWorld = {} as RigWorldTransforms;
  for (const jointId of JOINT_IDS) {
    nextWorld[jointId] = {
      ...world[jointId],
      worldPosition: { ...world[jointId].worldPosition },
    };
  }

  const childMap = buildChildMap(
    JOINT_IDS.reduce((acc, jointId) => {
      acc[jointId] = {
        id: jointId,
        parentId: world[jointId].parentId,
        localRotationDegRaw: 0,
        localTranslation: { x: 0, y: 0 },
        length: 0,
      };
      return acc;
    }, {} as Record<JointId, JointState>)
  );

  let appliedPins = 0;

  for (const pin of pins) {
    const current = nextWorld[pin.jointId];
    if (!current) {
      continue;
    }

    let dx = 0;
    let dy = 0;

    if (pin.kind === "world") {
      if (pin.lockX) {
        dx = pin.x - current.worldPosition.x;
      }
      if (pin.lockY) {
        dy = pin.y - current.worldPosition.y;
      }
    } else {
      dy = pin.groundY - current.worldPosition.y;
    }

    if (Math.abs(dx) <= 1e-8 && Math.abs(dy) <= 1e-8) {
      continue;
    }

    const descendants: JointId[] = [];
    collectDescendants(pin.jointId, childMap, descendants);
    const affected = [pin.jointId, ...descendants];

    for (const affectedJointId of affected) {
      const original = nextWorld[affectedJointId];
      nextWorld[affectedJointId] = {
        ...original,
        worldPosition: {
          x: original.worldPosition.x + dx,
          y: original.worldPosition.y + dy,
        },
      };
    }

    appliedPins += 1;
  }

  return { world: nextWorld, appliedPins };
};

export const applyPinsToJointState = (
  joints: Record<JointId, JointState>,
  pins: PinConstraint[]
): Record<JointId, JointState> => {
  if (!pins.length) {
    return joints;
  }

  const clonedJoints = cloneJoints(joints);
  const world = computeWorldTransforms(clonedJoints);
  const projected = applyPinsToWorldTransforms(world, pins).world;
  const projectedPositions = JOINT_IDS.reduce((acc, jointId) => {
    acc[jointId] = { ...projected[jointId].worldPosition };
    return acc;
  }, {} as Record<JointId, Vec2>);

  return bakeWorldPositionsIntoJointTranslations(clonedJoints, projectedPositions);
};
