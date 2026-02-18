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

type JointDepthMap = Partial<Record<JointId, number>>;

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

const resolveJointDepth = (
  jointId: JointId,
  parentByJoint: Partial<Record<JointId, JointId | null>>,
  memo: JointDepthMap
): number => {
  const cached = memo[jointId];
  if (cached !== undefined) {
    return cached;
  }

  const parentId = parentByJoint[jointId];
  const depth = parentId ? resolveJointDepth(parentId, parentByJoint, memo) + 1 : 0;
  memo[jointId] = depth;
  return depth;
};

const buildWorldJointDepthMap = (world: RigWorldTransforms): JointDepthMap => {
  const parentByJoint: Partial<Record<JointId, JointId | null>> = {};
  for (const jointId of JOINT_IDS) {
    parentByJoint[jointId] = world[jointId].parentId;
  }

  const depthByJoint: JointDepthMap = {};
  for (const jointId of JOINT_IDS) {
    resolveJointDepth(jointId, parentByJoint, depthByJoint);
  }
  return depthByJoint;
};

export const sortPinsByJointDepth = (
  pins: PinConstraint[],
  depthByJoint: JointDepthMap
): PinConstraint[] => {
  if (pins.length < 2) {
    return pins;
  }
  return pins
    .map((pin, index) => ({
      pin,
      index,
      depth: depthByJoint[pin.jointId] ?? Number.MAX_SAFE_INTEGER,
    }))
    .sort((a, b) => a.depth - b.depth || a.index - b.index)
    .map((entry) => entry.pin);
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

  const orderedPins = sortPinsByJointDepth(pins, buildWorldJointDepthMap(world));
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

  for (const pin of orderedPins) {
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
