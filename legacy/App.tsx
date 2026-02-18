
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { WalkingEnginePose, WalkingEnginePivotOffsets, WalkingEngineProportions, Vector2D, MaskTransform, GlobalPositions, PhysicsState, Keyframe, PartVisualAnchors, HardcodedAssetsMap, TextureViewBox } from './types';
import { ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT, BASE_HEAD_UNIT } from './constants'; 
import { Mannequin } from './components/Mannequin';
import { SystemLogger } from './components/SystemLogger';
import { Timeline } from './components/Timeline';
import { ProceduralAsciiBackground } from './components/ProceduralAsciiBackground';
import { Intertitle } from './components/Intertitle';
import { distance, lerpAngleShortestPath, solveTwoBoneIK, getScaledDimension } from './utils/kinematics';

const T_POSE: WalkingEnginePivotOffsets = {
  waist: 0, neck: 0, collar: 0, torso: 0,
  l_shoulder: 0, r_shoulder: 0,
  l_elbow: 0, r_elbow: 0,
  l_hand: 0, r_hand: 0,
  l_hip: 0, r_hip: 0,
  l_knee: 0, r_knee: 0,
  l_foot: 0, r_foot: 0,
  l_toe: 0, r_toe: 0
};

const RESTING_BASE_POSE: WalkingEnginePose = { waist: 0, neck: 0, collar: 0, torso: 0, l_shoulder: 0, r_shoulder: 0, l_elbow: 0, r_elbow: 0, l_hand: 0, r_hand: 0, l_hip: 0, r_hip: 0, l_knee: 0, r_knee: 0, l_foot: 0, r_foot: 0, l_toe: 0, r_toe: 0, stride_phase: 0, y_offset: 0, x_offset: 0 };

const DEFAULT_POSE: WalkingEnginePivotOffsets = {
  waist: 0,
  neck: 0,
  collar: 0,
  torso: 0,
  l_shoulder: 0,
  r_shoulder: 0,
  l_elbow: 0,
  r_elbow: 0,
  l_hand: 0,
  r_hand: 0,
  l_hip: 0,
  r_hip: 0,
  l_knee: 0,
  r_knee: 0,
  l_foot: 0,
  r_foot: 0,
  l_toe: 0,
  r_toe: 0,
};

const INITIAL_CHALLENGE_POSE: WalkingEnginePivotOffsets = { ...DEFAULT_POSE };

const JOINT_KEYS: (keyof WalkingEnginePivotOffsets)[] = [
  'waist', 'torso', 'collar', 'neck',
  'l_shoulder', 'l_elbow', 'l_hand',
  'r_shoulder', 'r_elbow', 'r_hand',
  'l_hip', 'l_knee', 'l_foot',
  'r_hip', 'r_knee', 'r_foot'
];

const PROP_KEYS: (keyof WalkingEngineProportions)[] = [
  'head', 'collar', 'torso', 'waist',
  'l_upper_arm', 'l_lower_arm', 'l_hand',
  'r_upper_arm', 'r_lower_arm', 'r_hand',
  'l_upper_leg', 'l_lower_leg', 'l_foot',
  'r_upper_leg', 'r_lower_leg', 'r_foot'
];

const ATOMIC_PROPS = Object.fromEntries(PROP_KEYS.map(k => [k, { w: 1, h: 1 }])) as WalkingEngineProportions;

const DEFAULT_PART_TEXTURES: Partial<Record<keyof WalkingEngineProportions, string>> = {
  head: '/default-shapes/head2collar.svg',
  collar: '/collar.svg',
  torso: '/default-shapes/torso4holes.svg',
  waist: '/default-shapes/waist.svg',
  l_upper_arm: '/default-shapes/limbs.svg',
  r_upper_arm: '/default-shapes/limbs.svg',
  l_lower_arm: '/default-shapes/limbs.svg',
  r_lower_arm: '/default-shapes/limbs.svg',
  l_hand: '/default-shapes/handpiece.svg',
  r_hand: '/default-shapes/handpiece.svg',
  l_upper_leg: '/default-shapes/limbs.svg',
  r_upper_leg: '/default-shapes/limbs.svg',
  l_lower_leg: '/default-shapes/limbs.svg',
  r_lower_leg: '/default-shapes/limbs.svg',
  l_foot: '/default-shapes/handpiece.svg',
  r_foot: '/default-shapes/handpiece.svg',
};

const ZERO_OFFSET = { x: 0, y: 0, rotation: 0 };
const DEFAULT_PART_OFFSETS: Partial<Record<keyof WalkingEngineProportions, { x: number; y: number; rotation: number }>> = {
  head: ZERO_OFFSET,
  collar: ZERO_OFFSET,
  torso: ZERO_OFFSET,
  waist: ZERO_OFFSET,
  r_upper_arm: ZERO_OFFSET,
  r_lower_arm: ZERO_OFFSET,
  r_hand: ZERO_OFFSET,
  l_upper_arm: ZERO_OFFSET,
  l_lower_arm: ZERO_OFFSET,
  l_hand: ZERO_OFFSET,
  l_upper_leg: ZERO_OFFSET,
  r_upper_leg: ZERO_OFFSET,
  l_lower_leg: ZERO_OFFSET,
  r_lower_leg: ZERO_OFFSET,
  l_foot: ZERO_OFFSET,
  r_foot: ZERO_OFFSET,
};

const DEFAULT_PART_SCALES: Partial<Record<keyof WalkingEngineProportions, number>> = {
  head: 1,
  collar: 1,
  torso: 1,
  waist: 1,
  l_upper_arm: 1,
  r_upper_arm: 1,
  l_lower_arm: 1,
  r_lower_arm: 1,
  l_upper_leg: 1,
  r_upper_leg: 1,
  l_lower_leg: 1,
  r_lower_leg: 1,
  l_foot: 1,
  r_foot: 1,
  l_hand: 1,
  r_hand: 1,
};

const DEFAULT_MASK_TRANSFORM_BASE: MaskTransform = { x: 0, y: 0, rotation: 0, scale: 1, mode: 'project' };

const DEFAULT_MASK_TRANSFORMS: Partial<Record<keyof WalkingEngineProportions, MaskTransform>> = {
  head: { ...DEFAULT_MASK_TRANSFORM_BASE, scale: 1.5 },
  collar: { ...DEFAULT_MASK_TRANSFORM_BASE, scale: 1.4, topWidth: 1.6, bottomWidth: 0.1 },
  torso: { ...DEFAULT_MASK_TRANSFORM_BASE, scale: 1.8, scaleX: 1 },
  waist: { ...DEFAULT_MASK_TRANSFORM_BASE, scale: 1.4 },
  l_upper_arm: { ...DEFAULT_MASK_TRANSFORM_BASE },
  r_upper_arm: { ...DEFAULT_MASK_TRANSFORM_BASE },
  l_lower_arm: { ...DEFAULT_MASK_TRANSFORM_BASE },
  r_lower_arm: { ...DEFAULT_MASK_TRANSFORM_BASE },
  l_hand: { ...DEFAULT_MASK_TRANSFORM_BASE },
  r_hand: { ...DEFAULT_MASK_TRANSFORM_BASE },
  l_upper_leg: { ...DEFAULT_MASK_TRANSFORM_BASE },
  r_upper_leg: { ...DEFAULT_MASK_TRANSFORM_BASE },
  l_lower_leg: { ...DEFAULT_MASK_TRANSFORM_BASE },
  r_lower_leg: { ...DEFAULT_MASK_TRANSFORM_BASE },
  l_foot: { ...DEFAULT_MASK_TRANSFORM_BASE },
  r_foot: { ...DEFAULT_MASK_TRANSFORM_BASE },
};

const DEFAULT_HARDCODED_ASSETS: HardcodedAssetsMap = {};

const GRID_SIZE = 100;

const DEFAULT_IK_CONSTRAINTS: Record<'l_hand_anchor' | 'r_hand_anchor', IKConstraint> = {
  l_hand_anchor: { active: true, x: -24, y: -90, stretch: 1.1, bendPriority: 'outer' },
  r_hand_anchor: { active: true, x: 24, y: -90, stretch: 1.1, bendPriority: 'outer' },
};

const JOINT_CHILD_MAP: Partial<Record<keyof WalkingEnginePivotOffsets, keyof WalkingEnginePivotOffsets>> = {
    waist: 'torso', torso: 'collar', collar: 'neck',
    l_shoulder: 'l_elbow', l_elbow: 'l_hand',
    r_shoulder: 'r_elbow', r_elbow: 'r_hand',
    l_hip: 'l_knee', l_knee: 'l_foot',
    r_hip: 'r_knee', r_knee: 'r_foot',
};

const MIRROR_MAP: Partial<Record<keyof WalkingEnginePivotOffsets, { pair: keyof WalkingEnginePivotOffsets; invert?: boolean }>> = {
  l_shoulder: { pair: 'r_shoulder', invert: true },
  r_shoulder: { pair: 'l_shoulder', invert: true },
  l_elbow: { pair: 'r_elbow', invert: true },
  r_elbow: { pair: 'l_elbow', invert: true },
  l_hand: { pair: 'r_hand', invert: true },
  r_hand: { pair: 'l_hand', invert: true },
};

const MIRROR_PART_SCALE_MAP: Partial<Record<keyof WalkingEngineProportions, keyof WalkingEngineProportions>> = {
  l_upper_arm: 'r_upper_arm',
  l_lower_arm: 'r_lower_arm',
  l_hand: 'r_hand',
  l_upper_leg: 'r_upper_leg',
  l_lower_leg: 'r_lower_leg',
  l_foot: 'r_foot',
};

const MIRROR_RIGHT_LEG_OFFSET_MAP: Partial<Record<keyof WalkingEngineProportions, keyof WalkingEngineProportions>> = {
  l_upper_leg: 'r_upper_leg',
  l_lower_leg: 'r_lower_leg',
  l_foot: 'r_foot',
};

const INITIAL_RENDER_ORDER: (keyof WalkingEngineProportions)[] = [
    'torso', 'waist', 'l_upper_leg', 'r_upper_leg', 'l_lower_leg', 'r_lower_leg', 'l_foot', 'r_foot',
    'collar', 'head', 'r_upper_arm', 'l_upper_arm', 'r_lower_arm', 'l_lower_arm', 'r_hand', 'l_hand'
];

const INITIAL_Z_ORDER = Object.fromEntries(INITIAL_RENDER_ORDER.map((key, index) => [key, index])) as Record<keyof WalkingEngineProportions, number>;
const easeOutExpo = (t: number): number => t === 1 ? 1 : 1 - Math.pow(2, -10 * t);

interface HistoryState {
  pivotOffsets: WalkingEnginePivotOffsets;
  props: WalkingEngineProportions;
  timestamp: number;
  label?: string;
}

type IntertitleStyle = 'page' | 'terminal' | 'writer';

type CalibrationPoint = {
  name: string;
  x: number;
  y: number;
  rotation: number;
  gridX: number;
  gridY: number;
};

type BendPriority = 'neutral' | 'inner' | 'outer';

type IKConstraint = {
  active: boolean;
  x: number;
  y: number;
  stretch: number;
  bendPriority: BendPriority;
};

type RenderMode = 'full' | 'skeleton_only';

type RenderConstraints = {
  showMasks: boolean;
  showPrimitives: boolean;
  showJoints: boolean;
  showIKTargets: boolean;
  lineWeight: number;
  hideLimbBlocks: boolean;
  clipToEdge: boolean;
};

const DEFAULT_RENDER_CONSTRAINTS: RenderConstraints = {
  showMasks: true,
  showPrimitives: false,
  showJoints: true,
  showIKTargets: false,
  lineWeight: 2,
  hideLimbBlocks: false,
  clipToEdge: false,
};

const VIEWBOX_WIDTH = 1000;
const VIEWBOX_HEIGHT = 1400;
const TARGET_VIEWPORT_FILL = 2 / 3; // target figure height as fraction of viewport height
const AUTO_SCALE_LIMITS = { min: 0.25, max: 3 };
const FALLBACK_TEXTURE_VIEWBOX: TextureViewBox = { x: 0, y: 0, width: 1000, height: 1000 };

const App: React.FC = () => {
  const [baseH] = useState(150);
  const [isConsoleVisible, setIsConsoleVisible] = useState(false);
  const [activeControlTab, setActiveControlTab] = useState<'fk' | 'perf' | 'layers' | 'animation' | 'studio'>('fk');
  const [isCalibrated, setIsCalibrated] = useState(false);
  const [physicsState, setPhysicsState] = useState<PhysicsState>({ position: { x: 0, y: 0 }, velocity: { x: 0, y: 0 }, angularVelocity: 0, worldGravity: { x: 0, y: 9.8 } });
  const [bodyRotation] = useState(0);
  const [activePins] = useState<(keyof WalkingEnginePivotOffsets)[]>([]);
  const [allJointPositions, setAllJointPositions] = useState<GlobalPositions>({});
  const [onionSkinData, setOnionSkinData] = useState<HistoryState | null>(null);
  const [partTextures, setPartTextures] = useState<Partial<Record<keyof WalkingEngineProportions, string>>>(() => ({ ...DEFAULT_PART_TEXTURES }));
  const [maskTransforms, setMaskTransforms] = useState<Partial<Record<keyof WalkingEngineProportions, MaskTransform>>>(() => ({ ...DEFAULT_MASK_TRANSFORMS }));
  const [maskImage, setMaskImage] = useState<string | null>(null);
  const [maskTransform, setMaskTransform] = useState<MaskTransform>({ x: 0, y: 0, rotation: 0, scale: 1, mode: 'project' });
  const [partCustomPaths, setPartCustomPaths] = useState<Partial<Record<keyof WalkingEngineProportions, string>>>({});
  const [partScales, setPartScales] = useState<Partial<Record<keyof WalkingEngineProportions, number>>>(() => ({ ...DEFAULT_PART_SCALES }));
  const [partOffsets, setPartOffsets] = useState<Partial<Record<keyof WalkingEngineProportions, { x: number; y: number; rotation: number }>>>(() => ({ ...DEFAULT_PART_OFFSETS }));
  const [visualAnchorOverrides, setVisualAnchorOverrides] = useState<Partial<Record<keyof WalkingEngineProportions, PartVisualAnchors>>>({});
  const [textureViewBoxOverrides, setTextureViewBoxOverrides] = useState<Partial<Record<keyof WalkingEngineProportions, TextureViewBox>>>({});
  const [hardcodedAssets, setHardcodedAssets] = useState<HardcodedAssetsMap>(() => ({ ...DEFAULT_HARDCODED_ASSETS }));
  const [activeShapeEditorKey, setActiveShapeEditorKey] = useState<keyof WalkingEngineProportions | null>(null);
  const [expandedScaleKeys, setExpandedScaleKeys] = useState<Set<keyof WalkingEngineProportions>>(new Set());
  const [expandedShoulderKeys, setExpandedShoulderKeys] = useState<Set<keyof WalkingEngineProportions>>(new Set());
  const [backgroundImage, setBackgroundImage] = useState<string | null>(null);
  const [backgroundTransform, setBackgroundTransform] = useState<MaskTransform>({ x: 0, y: 0, rotation: 0, scale: 1, mode: 'cover' });
  const [isIKEnabled, setIsIKEnabled] = useState(false);
  const [ikConstraints, setIkConstraints] = useState<Record<'l_hand_anchor' | 'r_hand_anchor', IKConstraint>>(() => ({ ...DEFAULT_IK_CONSTRAINTS }));
  const [renderMode, setRenderMode] = useState<RenderMode>('full');
  const [renderConstraints, setRenderConstraints] = useState<RenderConstraints>(() => ({ ...DEFAULT_RENDER_CONSTRAINTS }));
  const [anchorFitEnabled, setAnchorFitEnabled] = useState(false);
  const [followWaistCenter, setFollowWaistCenter] = useState(false);
  const [isMaskDragMode, setIsMaskDragMode] = useState(false);
  const [viewBoxCenter, setViewBoxCenter] = useState<Vector2D>({ x: 0, y: -400 });
  const [intertitleText] = useState("BITRUVIUS_0.1");
  const [isIntertitleVisible] = useState(false);
  const [intertitleFontSize] = useState(4);
  const [intertitleStyle] = useState<IntertitleStyle>('page');
  const [pivotOffsets, setPivotOffsets] = useState<WalkingEnginePivotOffsets>(INITIAL_CHALLENGE_POSE);
  const [props] = useState<WalkingEngineProportions>(ATOMIC_PROPS);
  const [previewPivotOffsets, setPreviewPivotOffsets] = useState<WalkingEnginePivotOffsets | null>(null);
  const [staticGhostPose, setStaticGhostPose] = useState<WalkingEnginePivotOffsets | null>(null);
  const [predictiveGhostingEnabled, setPredictiveGhostingEnabled] = useState(true);
  const [showFKRig, setShowFKRig] = useState(false);
  const [jointFriction] = useState(50);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [keyframes, setKeyframes] = useState<Keyframe[]>([]);
  const [partZOrder] = useState(INITIAL_Z_ORDER);
  const [showLabels, setShowLabels] = useState(false);
  const [isAutoCaptureEnabled, setIsAutoCaptureEnabled] = useState(false);
  const [headpieceContrastLevel, setHeadpieceContrastLevel] = useState<'none' | 'low' | 'medium' | 'high'>('high');
  const [figureScale, setFigureScale] = useState(1);
  const autoCaptureStartPoseRef = useRef<WalkingEnginePivotOffsets | null>(null);

  const syncRightLimbScales = useCallback((scales: Partial<Record<keyof WalkingEngineProportions, number>>) => {
    const next = { ...scales };
    (Object.entries(MIRROR_PART_SCALE_MAP) as Array<[keyof WalkingEngineProportions, keyof WalkingEngineProportions]>).forEach(([leftKey, rightKey]) => {
      if (typeof next[leftKey] === 'number') next[rightKey] = next[leftKey] as number;
    });
    return next;
  }, []);

  const syncRightLegOffsets = useCallback((offsets: Partial<Record<keyof WalkingEngineProportions, { x: number; y: number; rotation: number }>>) => {
    const next = { ...offsets };
    (Object.entries(MIRROR_RIGHT_LEG_OFFSET_MAP) as Array<[keyof WalkingEngineProportions, keyof WalkingEngineProportions]>).forEach(([leftKey, rightKey]) => {
      const left = next[leftKey];
      if (!left) return;
      next[rightKey] = { ...left };
    });
    return next;
  }, []);
  const recenterAll = useCallback(() => {
    draggingBoneKeyRef.current = null;
    dragModeRef.current = null;
    isInteractingRef.current = false;
    setPartOffsets({ ...DEFAULT_PART_OFFSETS });
    setPartScales({ ...DEFAULT_PART_SCALES });
    setPartTextures({ ...DEFAULT_PART_TEXTURES });
    setMaskTransforms({ ...DEFAULT_MASK_TRANSFORMS });
    setPartCustomPaths({});
    setHardcodedAssets({ ...DEFAULT_HARDCODED_ASSETS });
    setVisualAnchorOverrides({});
    setTextureViewBoxOverrides({});
    setPivotOffsets({ ...INITIAL_CHALLENGE_POSE });
    setPreviewPivotOffsets(null);
    setStaticGhostPose(null);
    setOnionSkinData(null);
    setIsIKEnabled(false);
    setIkConstraints({ ...DEFAULT_IK_CONSTRAINTS });
    setRenderMode('full');
    setRenderConstraints({ ...DEFAULT_RENDER_CONSTRAINTS, showPrimitives: false, clipToEdge: false });
    setAnchorFitEnabled(false);
    setFollowWaistCenter(false);
    setIsMaskDragMode(false);
    setViewBoxCenter({ x: 0, y: -400 });
    setFigureScale(1);
    setActiveShapeEditorKey(null);
    setExpandedScaleKeys(new Set());
    setExpandedShoulderKeys(new Set());
    setPoseDataInput('');
    setDraggingBoneKey(null);
    setRecordingHistory(prev => [...prev.slice(-98), { timestamp: Date.now(), label: 'Calibration reset to canonical defaults' } as HistoryState]);
  }, []);
  const [recordingHistory, setRecordingHistory] = useState<HistoryState[]>(() => [{
    pivotOffsets: INITIAL_CHALLENGE_POSE,
    props: ATOMIC_PROPS,
    timestamp: Date.now(),
    label: 'System ready',
  }]);
  const [calibrationTracker, setCalibrationTracker] = useState<CalibrationPoint[]>([]);
const [poseDataInput, setPoseDataInput] = useState('');
  const draggingBoneKeyRef = useRef<keyof WalkingEnginePivotOffsets | null>(null);
  const [draggingBoneKey, setDraggingBoneKey] = useState<keyof WalkingEnginePivotOffsets | null>(null);
  const dragModeRef = useRef<'rotate' | 'hand' | 'mask' | null>(null);
  const dragMaskPartRef = useRef<keyof WalkingEngineProportions | null>(null);
  const dragMaskActionRef = useRef<'move' | 'scale' | 'scaleX'>('move');
  const lastPointerSvgRef = useRef<Vector2D | null>(null);
  const lastClientXRef = useRef(0);
  const isInteractingRef = useRef(false);
  const transitionAnimationRef = useRef<number | null>(null);
  const transitionStartTimeRef = useRef<number | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);

  const addLog = (message: string) => { setRecordingHistory(prev => [...prev.slice(-99), { timestamp: Date.now(), label: message } as HistoryState]); };
  
  const handleAddKeyframe = useCallback((customPose?: WalkingEnginePivotOffsets) => {
    const poseToAdd = customPose || pivotOffsets;
    const newKeyframe: Keyframe = { id: `kf_${Date.now()}`, name: `Pose ${keyframes.length + 1}`, pose: { ...poseToAdd }, durationToNext: 1000 };
    setKeyframes(prev => [...prev, newKeyframe]);
    addLog(`Pose captured to Timeline.`);
  }, [keyframes.length, pivotOffsets]);

  const applyChainReaction = useCallback((startingKey: keyof WalkingEnginePivotOffsets, delta: number, initialOffsets: WalkingEnginePivotOffsets): WalkingEnginePivotOffsets => {
      const newOffsets = { ...initialOffsets };
      const queue: [keyof WalkingEnginePivotOffsets, number][] = [[startingKey, delta]];
      const visited = new Set<keyof WalkingEnginePivotOffsets>();
      visited.add(startingKey);
      while (queue.length > 0) {
          const [currentKey, currentDelta] = queue.shift()!;
          let children: (keyof WalkingEnginePivotOffsets)[] = [];
          if (currentKey === 'waist') children = ['torso', 'l_hip', 'r_hip'];
          else if (currentKey === 'torso') children = ['collar'];
          else if (currentKey === 'collar') children = ['neck', 'l_shoulder', 'r_shoulder'];
          else if (JOINT_CHILD_MAP[currentKey]) children = [JOINT_CHILD_MAP[currentKey]!];
          for (const childKey of children) {
              if (visited.has(childKey)) continue;
              // Fixed: Explicitly typed factor to avoid literal comparison warnings during structural rigidity decay.
              const factor: number = 0.5; // Fixed small decay for structural rigidity
              if (factor !== 0) {
                  const childDelta = currentDelta * factor;
                  newOffsets[childKey] = (newOffsets[childKey] || 0) + childDelta;
                  queue.push([childKey, childDelta]);
                  visited.add(childKey);
              }
          }
      }
      return newOffsets;
  }, []);

  const convertClientToSvgPoint = useCallback((clientX: number, clientY: number) => {
    const svgElement = svgRef.current;
    if (!svgElement) return null;
    const rect = svgElement.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const viewBoxWidth = 1000;
    const viewBoxHeight = 1400;
    return {
      x: viewBoxCenter.x - 500 + ((clientX - rect.left) / rect.width) * viewBoxWidth,
      y: viewBoxCenter.y - 700 + ((clientY - rect.top) / rect.height) * viewBoxHeight,
    };
  }, [viewBoxCenter]);

  const localToWorldPoint = useCallback((point: Vector2D) => {
    const translatedX = point.x + physicsState.position.x;
    const translatedY = point.y + physicsState.position.y;
    const angleRad = bodyRotation * Math.PI / 180;
    const cos = Math.cos(angleRad);
    const sin = Math.sin(angleRad);
    return {
      x: translatedX * cos - translatedY * sin,
      y: translatedX * sin + translatedY * cos,
    };
  }, [physicsState.position.x, physicsState.position.y, bodyRotation]);

	  const solveHandIK = useCallback((handKey: 'l_hand' | 'r_hand', targetPoint: Vector2D, offsets: WalkingEnginePivotOffsets, constraint?: IKConstraint) => {
	    const isLeft = handKey === 'l_hand';
	    const upperArmKey = (isLeft ? 'l_upper_arm' : 'r_upper_arm') as keyof WalkingEngineProportions;
	    const lowerArmKey = (isLeft ? 'l_lower_arm' : 'r_lower_arm') as keyof WalkingEngineProportions;
	    const shoulderPivotKey = isLeft ? 'l_shoulder' : 'r_shoulder';
	    const elbowPivotKey = isLeft ? 'l_elbow' : 'r_elbow';

    const shoulderTransform = allJointPositions[upperArmKey];
    const elbowTransform = allJointPositions[lowerArmKey];
    const handTransform = allJointPositions[handKey];
    if (!shoulderTransform || !elbowTransform || !handTransform) return null;

    const len1 = distance(shoulderTransform.position, elbowTransform.position);
    const len2 = distance(elbowTransform.position, handTransform.position);
    if (len1 === 0 || len2 === 0) return null;

	    const rootWorld = localToWorldPoint(shoulderTransform.position);
	    const parentRotationWorld = (allJointPositions.collar?.rotation ?? 0) + bodyRotation;
	    const worldTarget = targetPoint;
	    const bendPriority: BendPriority = constraint?.bendPriority ?? 'outer';
	    const solveWith = (bendLeft: boolean) => solveTwoBoneIK(worldTarget, rootWorld, len1, len2, parentRotationWorld, bendLeft);
	    const outerResult = solveWith(isLeft);
	    const innerResult = solveWith(!isLeft);
	    let ikResult = outerResult;
	    if (bendPriority === 'inner') ikResult = innerResult ?? outerResult;
	    else if (bendPriority === 'neutral') {
	      if (outerResult && innerResult) {
	        const currentElbow = offsets[elbowPivotKey] || 0;
	        const deltaOuter = Math.abs(outerResult.angle2 - currentElbow);
	        const deltaInner = Math.abs(innerResult.angle2 - currentElbow);
	        ikResult = deltaInner < deltaOuter ? innerResult : outerResult;
	      } else {
	        ikResult = outerResult ?? innerResult;
	      }
	    }
	    if (!ikResult) return null;

    return {
      offsets: {
        ...offsets,
        [shoulderPivotKey]: ikResult.angle1,
        [elbowPivotKey]: ikResult.angle2,
      },
      shoulderPivotKey,
      elbowPivotKey,
    };
	  }, [allJointPositions, bodyRotation, distance, localToWorldPoint]);

	  const handleHandIKDrag = useCallback((boneKey: keyof WalkingEnginePivotOffsets, clientX: number, clientY: number) => {
	    if (!isIKEnabled || (boneKey !== 'l_hand' && boneKey !== 'r_hand')) return;
	    const svgTarget = convertClientToSvgPoint(clientX, clientY);
	    if (!svgTarget) return;
	    const worldTarget = localToWorldPoint(svgTarget);
	    const currentOffsets = predictiveGhostingEnabled ? (previewPivotOffsets || pivotOffsets) : pivotOffsets;
	    const anchorKey = boneKey === 'l_hand' ? 'l_hand_anchor' : 'r_hand_anchor';
	    const solution = solveHandIK(boneKey as 'l_hand' | 'r_hand', worldTarget, currentOffsets, ikConstraints[anchorKey]);
	    if (!solution) return;
	    const updateFunc = predictiveGhostingEnabled ? setPreviewPivotOffsets : setPivotOffsets;
	    updateFunc(solution.offsets);
	    setIkConstraints(prev => ({
	      ...prev,
	      [anchorKey]: {
	        ...prev[anchorKey],
        active: true,
        x: worldTarget.x,
        y: worldTarget.y,
      },
    }));
	  }, [convertClientToSvgPoint, isIKEnabled, localToWorldPoint, predictiveGhostingEnabled, previewPivotOffsets, pivotOffsets, setIkConstraints, setPivotOffsets, setPreviewPivotOffsets, solveHandIK, ikConstraints]);

  const animatePoseTransition = useCallback((targetPose: Partial<WalkingEnginePivotOffsets>, duration: number = 700, onComplete?: () => void) => {
    if (transitionAnimationRef.current) cancelAnimationFrame(transitionAnimationRef.current);
    const startPose = { ...pivotOffsets };
    transitionStartTimeRef.current = performance.now();
    setIsTransitioning(true);
    setStaticGhostPose(startPose);
    const animate = (now: number) => {
        const elapsed = now - transitionStartTimeRef.current!;
        const progress = Math.min(elapsed / duration, 1);
        const eased = easeOutExpo(progress);
        const newOffsets: WalkingEnginePivotOffsets = { ...startPose };
        JOINT_KEYS.forEach(key => {
            const start = startPose[key] || 0;
            const end = targetPose[key] ?? start;
            newOffsets[key] = lerpAngleShortestPath(start, end, eased);
        });
        setPivotOffsets(newOffsets);
        if (progress < 1) transitionAnimationRef.current = requestAnimationFrame(animate);
        else { setIsTransitioning(false); setStaticGhostPose(null); if (onComplete) onComplete(); }
    };
    transitionAnimationRef.current = requestAnimationFrame(animate);
  }, [pivotOffsets]);

  const handleInteractionMove = useCallback((clientX: number, clientY: number) => {
    if (!isCalibrated || isTransitioning || !draggingBoneKeyRef.current) return;
    if (!isInteractingRef.current) isInteractingRef.current = true;
    const boneKey = draggingBoneKeyRef.current;
    if (dragModeRef.current === 'mask' && dragMaskPartRef.current) {
      const nextPoint = convertClientToSvgPoint(clientX, clientY);
      const prevPoint = lastPointerSvgRef.current;
      if (!nextPoint || !prevPoint) return;
      const dx = nextPoint.x - prevPoint.x;
      const dy = nextPoint.y - prevPoint.y;
      const partKey = dragMaskPartRef.current;
      if (dragMaskActionRef.current === 'move') {
        setMaskTransforms(prev => {
          const existing = prev[partKey] ?? DEFAULT_MASK_TRANSFORMS[partKey] ?? { x: 0, y: 0, rotation: 0, scale: 1, mode: 'project' as const };
          return {
            ...prev,
            [partKey]: {
              ...existing,
              x: (existing.x ?? 0) + dx,
              y: (existing.y ?? 0) + dy,
            },
          };
        });
      } else if (dragMaskActionRef.current === 'scale') {
        setMaskTransforms(prev => {
          const existing = prev[partKey] ?? DEFAULT_MASK_TRANSFORMS[partKey] ?? { x: 0, y: 0, rotation: 0, scale: 1, mode: 'project' as const };
          const factor = 1 + (-dy * 0.01);
          const nextScale = Math.max(0.05, Math.min(20, (existing.scale ?? 1) * factor));
          return { ...prev, [partKey]: { ...existing, scale: nextScale } };
        });
      } else if (dragMaskActionRef.current === 'scaleX') {
        setMaskTransforms(prev => {
          const existing = prev[partKey] ?? DEFAULT_MASK_TRANSFORMS[partKey] ?? { x: 0, y: 0, rotation: 0, scale: 1, mode: 'project' as const };
          const baseline = existing.scaleX ?? 1;
          const sign = baseline < 0 ? -1 : 1;
          const factor = 1 + (dx * 0.01);
          const nextAbs = Math.max(0.05, Math.min(20, Math.abs(baseline) * factor));
          return { ...prev, [partKey]: { ...existing, scaleX: sign * nextAbs } };
        });
      }
      lastPointerSvgRef.current = nextPoint;
      return;
    }
    if (isIKEnabled && dragModeRef.current === 'hand' && (boneKey === 'l_hand' || boneKey === 'r_hand')) {
      handleHandIKDrag(boneKey, clientX, clientY);
      lastClientXRef.current = clientX;
      return;
    }
    const updateFunc = predictiveGhostingEnabled ? setPreviewPivotOffsets : setPivotOffsets;
    let baseOffsets = predictiveGhostingEnabled ? (previewPivotOffsets || pivotOffsets) : pivotOffsets;
    const frictionFactor = 1 - (jointFriction / 125);
    const dragDelta = (clientX - lastClientXRef.current) * frictionFactor;
    const newValue = baseOffsets[boneKey] + dragDelta;
    baseOffsets = { ...baseOffsets, [boneKey]: newValue };
    const mirror = MIRROR_MAP[boneKey];
    if (mirror) {
      const mirroredValue = mirror.invert ? -newValue : newValue;
      baseOffsets[mirror.pair] = mirroredValue;
    }
    baseOffsets = applyChainReaction(boneKey, dragDelta, baseOffsets);
    lastClientXRef.current = clientX;
    updateFunc(baseOffsets);
  }, [applyChainReaction, convertClientToSvgPoint, handleHandIKDrag, isCalibrated, isTransitioning, jointFriction, pivotOffsets, previewPivotOffsets, predictiveGhostingEnabled, syncRightLegOffsets]);

  const handleInteractionEnd = useCallback(() => {
    if (draggingBoneKeyRef.current && isAutoCaptureEnabled && autoCaptureStartPoseRef.current) {
        const finalPose = predictiveGhostingEnabled ? (previewPivotOffsets || pivotOffsets) : pivotOffsets;
        if (JSON.stringify(finalPose) !== JSON.stringify(autoCaptureStartPoseRef.current)) {
            handleAddKeyframe(finalPose);
        }
    }
    if (predictiveGhostingEnabled && draggingBoneKeyRef.current && previewPivotOffsets) {
        const targetOffsets = { ...previewPivotOffsets };
        setPreviewPivotOffsets(null);
        setStaticGhostPose(null);
        animatePoseTransition(targetOffsets, 50 + (jointFriction / 100) * 700, () => setPivotOffsets(targetOffsets));
    }
    draggingBoneKeyRef.current = null;
    dragModeRef.current = null;
    dragMaskPartRef.current = null;
    dragMaskActionRef.current = 'move';
    lastPointerSvgRef.current = null;
    setDraggingBoneKey(null);
    isInteractingRef.current = false;
  }, [isAutoCaptureEnabled, handleAddKeyframe, predictiveGhostingEnabled, previewPivotOffsets, pivotOffsets, jointFriction, animatePoseTransition]);

  const startDrag = useCallback((key: keyof WalkingEnginePivotOffsets, clientX: number, clientY: number, partKey?: keyof WalkingEngineProportions, e?: React.MouseEvent | React.TouchEvent) => {
    if (!isCalibrated || isTransitioning) return;
    if (isMaskDragMode && partKey) {
      draggingBoneKeyRef.current = key;
      setDraggingBoneKey(key);
      dragModeRef.current = 'mask';
      dragMaskPartRef.current = partKey;
      const mouseEvent = e && 'shiftKey' in e ? e : null;
      if (mouseEvent?.altKey) dragMaskActionRef.current = 'scaleX';
      else if (mouseEvent?.shiftKey) dragMaskActionRef.current = 'scale';
      else dragMaskActionRef.current = 'move';
      lastPointerSvgRef.current = convertClientToSvgPoint(clientX, clientY);
      return;
    }
    if (isAutoCaptureEnabled) autoCaptureStartPoseRef.current = { ...pivotOffsets };
    if (predictiveGhostingEnabled) { setPreviewPivotOffsets({ ...pivotOffsets }); setStaticGhostPose({ ...pivotOffsets }); }
    draggingBoneKeyRef.current = key;
    setDraggingBoneKey(key);
    dragModeRef.current = (key === 'l_hand' || key === 'r_hand') ? 'hand' : 'rotate';
    lastClientXRef.current = clientX;
  }, [convertClientToSvgPoint, isCalibrated, isMaskDragMode, isTransitioning, pivotOffsets, isAutoCaptureEnabled, predictiveGhostingEnabled, setPreviewPivotOffsets, setStaticGhostPose, setDraggingBoneKey]);

  const measureSvgTightViewBox = useCallback((svgText: string): TextureViewBox | null => {
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(svgText, 'image/svg+xml');
      const svg = doc.querySelector('svg');
      if (!svg) return null;

      const rawViewBox = svg.getAttribute('viewBox');
      if (rawViewBox) {
        const nums = rawViewBox
          .trim()
          .replace(/,/g, ' ')
          .split(/\s+/)
          .map(Number)
          .filter(n => Number.isFinite(n));
        if (nums.length >= 4) {
          return {
            x: nums[0],
            y: nums[1],
            width: Math.max(1, nums[2]),
            height: Math.max(1, nums[3]),
          };
        }
      }

      const container = document.createElement('div');
      container.style.position = 'fixed';
      container.style.left = '-10000px';
      container.style.top = '-10000px';
      container.style.width = '0';
      container.style.height = '0';
      container.style.overflow = 'hidden';
      container.style.opacity = '0';

      const liveSvg = svg.cloneNode(true) as SVGSVGElement;
      liveSvg.setAttribute('width', '1000');
      liveSvg.setAttribute('height', '1000');
      liveSvg.style.position = 'absolute';
      liveSvg.style.left = '0';
      liveSvg.style.top = '0';
      container.appendChild(liveSvg);
      document.body.appendChild(container);

      const bbox = liveSvg.getBBox();
      document.body.removeChild(container);

      return {
        x: bbox.x,
        y: bbox.y,
        width: Math.max(1, bbox.width),
        height: Math.max(1, bbox.height),
      };
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    let isCancelled = false;
    const loadDefaultSvgBBoxes = async () => {
      const entries = Object.entries(DEFAULT_PART_TEXTURES) as Array<[keyof WalkingEngineProportions, string]>;
      const svgEntries = entries
        .filter(([, src]) => typeof src === 'string' && src.startsWith('/') && src.toLowerCase().endsWith('.svg'));

      if (!svgEntries.length) return;

      const results = await Promise.all(svgEntries.map(async ([partKey, src]) => {
        try {
          const res = await fetch(src);
          if (!res.ok) return null;
          const svgText = await res.text();
          const tight = measureSvgTightViewBox(svgText);
          return tight ? { partKey, tight } : null;
        } catch {
          return null;
        }
      }));

      if (isCancelled) return;
      const next: Partial<Record<keyof WalkingEngineProportions, TextureViewBox>> = {};
      results.forEach(r => {
        if (!r) return;
        next[r.partKey] = r.tight;
      });
      if (Object.keys(next).length) {
        setTextureViewBoxOverrides(prev => ({ ...next, ...prev }));
      }
    };

    void loadDefaultSvgBBoxes();
    return () => { isCancelled = true; };
  }, [measureSvgTightViewBox]);

  const handleULCUpload = (partKey: keyof WalkingEngineProportions, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
        const reader = new FileReader();
        if (file.type === 'image/svg+xml') {
            reader.onload = (re) => {
                const svgText = (re.target?.result as string) ?? '';
                const encoded = encodeURIComponent(svgText)
                  .replace(/'/g, '%27')
                  .replace(/\"/g, '%22');
                const dataUrl = `data:image/svg+xml;charset=utf-8,${encoded}`;
                const tight = measureSvgTightViewBox(svgText);
                if (tight) setTextureViewBoxOverrides(prev => ({ ...prev, [partKey]: tight }));
                setPartTextures(prev => ({ ...prev, [partKey]: dataUrl }));
                const defaultMask = DEFAULT_MASK_TRANSFORMS[partKey] ?? { x: 0, y: 0, rotation: 0, scale: 1, mode: 'project' as const };
                setMaskTransforms(prev => ({ ...prev, [partKey]: defaultMask }));
                addLog(`ULC: Bound SVG to ${partKey.toUpperCase()}`);
            };
            reader.readAsText(file);
        } else {
            reader.onload = (re) => {
                const result = re.target?.result as string;
                setPartTextures(prev => ({ ...prev, [partKey]: result }));
                const defaultMask = DEFAULT_MASK_TRANSFORMS[partKey] ?? { x: 0, y: 0, rotation: 0, scale: 1, mode: 'project' as const };
                setMaskTransforms(prev => ({ ...prev, [partKey]: defaultMask }));
                addLog(`ULC: Bound content to ${partKey.toUpperCase()}`);
            };
            reader.readAsDataURL(file);
        }
    }
  };

  const handleMaskUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result;
      if (typeof result === 'string') {
        setMaskImage(result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleBackgroundUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const result = event.target?.result;
      if (typeof result === 'string') {
        setBackgroundImage(result);
      }
    };
    reader.readAsDataURL(file);
  };

  const sortedFKJoints = useMemo(() => {
    return JOINT_KEYS.sort((a, b) => (a === 'waist' ? -1 : b === 'waist' ? 1 : 0));
  }, []);

  const isSkeletonOnly = renderMode === 'skeleton_only';
  const shouldShowMasks = !isSkeletonOnly && renderConstraints.showMasks;
  const shouldShowRig = isIKEnabled || isSkeletonOnly || showFKRig;

  useEffect(() => {
    const onMove = (e: MouseEvent) => handleInteractionMove(e.clientX, e.clientY);
    const onUp = () => handleInteractionEnd();
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [handleInteractionMove, handleInteractionEnd]);

  useEffect(() => {
    if (!followWaistCenter) return;
    if (allJointPositions.waist) setViewBoxCenter(allJointPositions.waist.position);
  }, [allJointPositions, followWaistCenter]);

  useEffect(() => {
    const joints = Object.values(allJointPositions);
    if (!joints.length) return;

    let minY = Infinity;
    let maxY = -Infinity;
    joints.forEach(({ position }) => {
      minY = Math.min(minY, position.y);
      maxY = Math.max(maxY, position.y);
    });

    const headLen = getScaledDimension(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.HEAD, baseH, props, 'head', 'h');
    const footLen = getScaledDimension(
      ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.FOOT + ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.TOE,
      baseH,
      props,
      'l_foot',
      'h'
    );

    // Account for geometry that extends beyond joint centers.
    minY -= headLen * 0.95;
    maxY += footLen * 0.95;

    const height = Math.max(1, maxY - minY);
    const target = VIEWBOX_HEIGHT * TARGET_VIEWPORT_FILL;
    const nextScale = Math.min(AUTO_SCALE_LIMITS.max, Math.max(AUTO_SCALE_LIMITS.min, target / height));
    if (Math.abs(nextScale - figureScale) > 0.0001) setFigureScale(nextScale);
  }, [allJointPositions, baseH, props, figureScale]);

  useEffect(() => {
    const trackedKeys: Array<keyof WalkingEngineProportions | 'waist'> = ['waist', 'torso', 'collar', 'head'];
    const tracked = trackedKeys.map(key => {
      const data = allJointPositions[key as keyof GlobalPositions];
      const position = data?.position || { x: 0, y: 0 };
      const rotation = data?.rotation ?? 0;
      const gridX = Math.round(position.x / GRID_SIZE) * GRID_SIZE;
      const gridY = Math.round(position.y / GRID_SIZE) * GRID_SIZE;
      return {
        name: key === 'waist' ? 'root' : key,
        x: position.x,
        y: position.y,
        rotation,
        gridX,
        gridY,
      };
    });
    setCalibrationTracker(tracked);
  }, [allJointPositions]);

const poseDataObject = useMemo(() => ({
  timestamp: Date.now(),
  pivotOffsets: previewPivotOffsets || pivotOffsets,
  partOffsets,
  partScales,
  maskTransforms,
  visualAnchorOverrides,
  textureViewBoxOverrides,
  hardcoded_assets: hardcodedAssets,
  anchorFitEnabled,
  renderMode,
  constraints: {
    ...renderConstraints,
    showMasks: shouldShowMasks,
  },
  calibrationTracker,
  viewBoxCenter,
  ikConstraints,
  isIKEnabled,
}), [anchorFitEnabled, calibrationTracker, hardcodedAssets, maskTransforms, partOffsets, partScales, pivotOffsets, previewPivotOffsets, renderConstraints, renderMode, shouldShowMasks, viewBoxCenter, ikConstraints, isIKEnabled, visualAnchorOverrides, textureViewBoxOverrides]);

const poseDataString = useMemo(() => JSON.stringify(poseDataObject, null, 2), [poseDataObject]);
const maskDataString = useMemo(() => JSON.stringify(maskTransforms, null, 2), [maskTransforms]);

  const copyPoseData = async () => {
    try {
      await navigator.clipboard.writeText(poseDataString);
      addLog('Pose data copied to clipboard');
    } catch {
      addLog('Failed to copy pose data');
    }
  };

	  const applyPoseData = () => {
	    try {
	      const parsed = JSON.parse(poseDataInput);
	      if (parsed.pivotOffsets && typeof parsed.pivotOffsets === 'object') {
	        const merged: WalkingEnginePivotOffsets = { ...pivotOffsets, ...parsed.pivotOffsets };
	        if (typeof merged.l_toe === 'number' && Number.isFinite(merged.l_toe)) {
	          merged.l_foot = (merged.l_foot || 0) + merged.l_toe;
	          merged.l_toe = 0;
	        }
	        if (typeof merged.r_toe === 'number' && Number.isFinite(merged.r_toe)) {
	          merged.r_foot = (merged.r_foot || 0) + merged.r_toe;
	          merged.r_toe = 0;
	        }
	        setPivotOffsets(merged);
	      }
	      if (parsed.partOffsets && typeof parsed.partOffsets === 'object') {
	        setPartOffsets(prev => {
	          const merged = syncRightLegOffsets({ ...prev, ...parsed.partOffsets });
	          merged.head = { x: 0, y: 0, rotation: 0 };
	          return merged;
	        });
	      }
	      if (parsed.partScales && typeof parsed.partScales === 'object') {
	        setPartScales(prev => syncRightLimbScales({ ...prev, ...parsed.partScales }));
	      }
	      if (parsed.maskTransforms && typeof parsed.maskTransforms === 'object') {
	        setMaskTransforms(prev => {
	          const next = { ...prev };
	          Object.entries(parsed.maskTransforms as Record<string, any>).forEach(([rawKey, rawValue]) => {
	            const partKey = rawKey as keyof WalkingEngineProportions;
	            if (!PROP_KEYS.includes(partKey)) return;
	            if (!rawValue || typeof rawValue !== 'object') return;
	            const value = rawValue as Partial<MaskTransform> & Record<string, any>;
            const mode = value.mode === 'cover' || value.mode === 'project' || value.mode === 'hidden'
              ? value.mode
              : 'project';
            next[partKey] = {
              x: typeof value.x === 'number' ? value.x : 0,
              y: typeof value.y === 'number' ? value.y : 0,
              rotation: typeof value.rotation === 'number' ? value.rotation : 0,
              scale: typeof value.scale === 'number' ? value.scale : 1,
              scaleX: typeof value.scaleX === 'number' ? value.scaleX : undefined,
              scaleY: typeof value.scaleY === 'number' ? value.scaleY : undefined,
              mode,
              geometry: value.geometry === 'tapered' || value.geometry === 'inverted_triangle' || value.geometry === 'circle_base'
                ? value.geometry
                : undefined,
              topWidth: typeof value.topWidth === 'number' ? value.topWidth : undefined,
              bottomWidth: typeof value.bottomWidth === 'number' ? value.bottomWidth : undefined,
            };
	          });
          if (next.head) {
            next.head = {
              ...next.head,
              x: 0,
              y: 0,
            };
          }
          return next;
	        });
	      }
	      if (parsed.visualAnchorOverrides) setVisualAnchorOverrides(parsed.visualAnchorOverrides);
	      if (parsed.textureViewBoxOverrides && typeof parsed.textureViewBoxOverrides === 'object') {
	        setTextureViewBoxOverrides(prev => {
	          const next = { ...prev };
	          Object.entries(parsed.textureViewBoxOverrides as Record<string, any>).forEach(([rawKey, rawValue]) => {
	            const partKey = rawKey as keyof WalkingEngineProportions;
	            if (!PROP_KEYS.includes(partKey)) return;
	            if (!rawValue || typeof rawValue !== 'object') return;
	            const value = rawValue as Partial<TextureViewBox> & Record<string, any>;
	            next[partKey] = {
	              x: typeof value.x === 'number' ? value.x : 0,
	              y: typeof value.y === 'number' ? value.y : 0,
	              width: typeof value.width === 'number' ? Math.max(1, value.width) : FALLBACK_TEXTURE_VIEWBOX.width,
	              height: typeof value.height === 'number' ? Math.max(1, value.height) : FALLBACK_TEXTURE_VIEWBOX.height,
	            };
	          });
	          return next;
	        });
	      }
	      if (parsed.hardcoded_assets && typeof parsed.hardcoded_assets === 'object') setHardcodedAssets(parsed.hardcoded_assets);
	      if (parsed.hardcodedAssets && typeof parsed.hardcodedAssets === 'object') setHardcodedAssets(parsed.hardcodedAssets);
	      if (parsed.ikConstraints && typeof parsed.ikConstraints === 'object') {
	        setIkConstraints(prev => {
	          const next = { ...prev };
	          (['l_hand_anchor', 'r_hand_anchor'] as const).forEach(anchorKey => {
	            const rawValue = (parsed.ikConstraints as any)[anchorKey];
	            if (!rawValue || typeof rawValue !== 'object') return;
	            const value = rawValue as Partial<IKConstraint> & Record<string, any>;
	            const bendPriority: BendPriority = value.bendPriority === 'neutral' || value.bendPriority === 'inner' || value.bendPriority === 'outer'
	              ? value.bendPriority
	              : next[anchorKey].bendPriority;
	            next[anchorKey] = {
	              active: typeof value.active === 'boolean' ? value.active : next[anchorKey].active,
	              x: typeof value.x === 'number' ? value.x : next[anchorKey].x,
	              y: typeof value.y === 'number' ? value.y : next[anchorKey].y,
	              stretch: typeof value.stretch === 'number' ? value.stretch : next[anchorKey].stretch,
	              bendPriority,
	            };
	          });
	          return next;
	        });
	      }
      if (parsed.isIKEnabled !== undefined) setIsIKEnabled(!!parsed.isIKEnabled);
      if (parsed.anchorFitEnabled !== undefined) setAnchorFitEnabled(!!parsed.anchorFitEnabled);
      else setAnchorFitEnabled(false);
      if (parsed.viewBoxCenter && typeof parsed.viewBoxCenter === 'object') {
        const x = Number((parsed.viewBoxCenter as Record<string, any>).x);
        const y = Number((parsed.viewBoxCenter as Record<string, any>).y);
        if (Number.isFinite(x) && Number.isFinite(y)) {
          setViewBoxCenter({ x, y });
          setFollowWaistCenter(false);
        }
      }
	      if (parsed.renderMode === 'full' || parsed.renderMode === 'skeleton_only') {
	        setRenderMode(parsed.renderMode);
	      }
      if (parsed.constraints && typeof parsed.constraints === 'object') {
        setRenderConstraints(prev => ({
          showMasks: typeof parsed.constraints.showMasks === 'boolean' ? parsed.constraints.showMasks : prev.showMasks,
          showPrimitives: typeof parsed.constraints.showPrimitives === 'boolean' ? parsed.constraints.showPrimitives : prev.showPrimitives,
          showJoints: typeof parsed.constraints.showJoints === 'boolean' ? parsed.constraints.showJoints : prev.showJoints,
          showIKTargets: typeof parsed.constraints.showIKTargets === 'boolean' ? parsed.constraints.showIKTargets : prev.showIKTargets,
          lineWeight: typeof parsed.constraints.lineWeight === 'number'
            ? Math.max(0.5, Math.min(4, parsed.constraints.lineWeight))
            : prev.lineWeight,
          hideLimbBlocks: typeof parsed.constraints.hideLimbBlocks === 'boolean'
            ? parsed.constraints.hideLimbBlocks
            : prev.hideLimbBlocks,
          clipToEdge: typeof parsed.constraints.clipToEdge === 'boolean'
            ? parsed.constraints.clipToEdge
            : prev.clipToEdge,
        }));
      }
      addLog('Pose data applied');
    } catch (err) {
      addLog('Invalid pose data');
    }
  };

  useEffect(() => {
    if (!isIKEnabled) return;
    setPivotOffsets(prev => {
      let next = prev;
      Object.entries(ikConstraints).forEach(([anchorKey, constraint]) => {
	        if (!constraint.active) return;
	        const handKey = anchorKey === 'l_hand_anchor' ? 'l_hand' : 'r_hand';
	        const solution = solveHandIK(handKey, { x: constraint.x, y: constraint.y }, next, constraint);
	        if (!solution) return;
        const { offsets } = solution;
        const shoulderKey = handKey === 'l_hand' ? 'l_shoulder' : 'r_shoulder';
        const elbowKey = handKey === 'l_hand' ? 'l_elbow' : 'r_elbow';
        if (offsets[shoulderKey] !== next[shoulderKey] || offsets[elbowKey] !== next[elbowKey]) {
          next = { ...next, [shoulderKey]: offsets[shoulderKey], [elbowKey]: offsets[elbowKey] };
        }
      });
      return next;
    });
  }, [isIKEnabled, ikConstraints, solveHandIK, pivotOffsets]);

  return (
    <div className="flex h-full w-full bg-[#020617] font-mono text-slate-200 overflow-hidden select-none">
      {isConsoleVisible && (
        <div className="w-96 border-r border-slate-800 bg-slate-900/50 backdrop-blur-md p-4 flex flex-col gap-4 custom-scrollbar overflow-y-auto z-50">
          <div className="flex justify-between items-center border-b border-slate-800 pb-2">
            <h1 className="text-2xl font-black tracking-widest uppercase italic text-white">BITRUVIUS<span className="text-violet-400">_V2</span></h1>
          </div>
          <div className="border-b border-slate-800">
            <div className="flex">{(['fk', 'perf', 'layers', 'animation', 'studio'] as const).map(tab => (<button key={tab} onClick={() => setActiveControlTab(tab)} className={`flex-1 text-[10px] py-2 font-bold transition-colors ${activeControlTab === tab ? 'bg-slate-800 text-violet-400 border-b-2 border-violet-500' : 'text-slate-500 opacity-50'}`}>{tab.toUpperCase()}</button>))}</div>
          </div>
          <div className="flex-grow">
            {activeControlTab === 'fk' && (
              <div className="flex flex-col gap-4 pt-4">
                <div className="text-xs font-bold text-slate-400 uppercase border-b border-slate-800 pb-1">Skeletal Rotations</div>
                <div className="flex flex-col gap-2 pr-2 h-[400px] overflow-y-auto custom-scrollbar">
                  {sortedFKJoints.map(k => (
                    <div key={k} className={`p-1 rounded-sm ${k === 'waist' ? 'border-b border-slate-800/30 pb-2 mb-1' : ''}`}>
                      <div className="flex justify-between items-center text-[10px] uppercase font-bold text-slate-500 mb-1">
                        <span>{k === 'waist' ? 'Body Rotation' : k.replace(/_/g, ' ')}</span>
                        <span>{Math.round((previewPivotOffsets || pivotOffsets)[k])}°</span>
                      </div>
                      <input type="range" min="-180" max="180" step="1" value={(previewPivotOffsets || pivotOffsets)[k]} onMouseDown={() => startDrag(k, 0, 0)} onChange={(e) => {
                          const val = parseInt(e.target.value);
                          const current = previewPivotOffsets || pivotOffsets;
                          const delta = val - current[k];
                          let next = { ...current, [k]: val };
                          next = applyChainReaction(k, delta, next);
                          (predictiveGhostingEnabled ? setPreviewPivotOffsets : setPivotOffsets)(next);
                      }} onMouseUp={handleInteractionEnd} className="w-full accent-violet-500 h-1 cursor-ew-resize" />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {activeControlTab === 'perf' && (
                <div className="flex flex-col gap-4 pt-4">
                    <div className="text-xs font-bold text-slate-400 uppercase border-b border-slate-800 pb-1">Engine Controls</div>
                    <button onClick={() => setPredictiveGhostingEnabled(v => !v)} className={`w-full text-[10px] font-bold py-1 border ${predictiveGhostingEnabled ? 'bg-violet-600 text-white border-violet-500' : 'bg-slate-800 border-slate-700'}`}>GHOSTING: {predictiveGhostingEnabled ? 'ON' : 'OFF'}</button>
                    <button onClick={() => setShowFKRig(v => !v)} className={`w-full text-[10px] font-bold py-1 border ${showFKRig ? 'bg-violet-600 text-white border-violet-500' : 'bg-slate-800 border-slate-700'}`}>FK VISUAL RIG: {showFKRig ? 'ON' : 'OFF'}</button>
                    <button onClick={() => setShowLabels(v => !v)} className={`w-full text-[10px] font-bold py-1 border ${showLabels ? 'bg-violet-600 text-white border-violet-500' : 'bg-slate-800 border-slate-700'}`}>LABELS: {showLabels ? 'ON' : 'OFF'}</button>
                    <div className="text-xs font-bold text-slate-400 uppercase border-b border-slate-800 pb-1 mt-2">Render Mode</div>
                    <button
                      onClick={() => {
                        setRenderMode(prev => prev === 'full' ? 'skeleton_only' : 'full');
                        addLog(`Render mode ${renderMode === 'full' ? 'skeleton_only' : 'full'}`);
                      }}
                      className={`w-full text-[10px] font-bold py-1 border ${isSkeletonOnly ? 'bg-cyan-500 text-slate-950 border-cyan-300' : 'bg-slate-800 border-slate-700'}`}
                    >
                      VISUAL MODE: {isSkeletonOnly ? 'SKELETON ONLY' : 'FULL'}
                    </button>
                    <div className="grid grid-cols-2 gap-2 text-[9px]">
                      <label className="p-2 border border-slate-800 rounded bg-slate-900/30 uppercase text-slate-400 flex items-center justify-between">
                        <span>Masks</span>
                        <input
                          type="checkbox"
                          checked={renderConstraints.showMasks}
                          onChange={e => setRenderConstraints(prev => ({ ...prev, showMasks: e.target.checked }))}
                        />
                      </label>
                      <label className="p-2 border border-slate-800 rounded bg-slate-900/30 uppercase text-slate-400 flex items-center justify-between">
                        <span>Primitives</span>
                        <input
                          type="checkbox"
                          checked={renderConstraints.showPrimitives}
                          onChange={e => setRenderConstraints(prev => ({ ...prev, showPrimitives: e.target.checked }))}
                        />
                      </label>
                      <label className="p-2 border border-slate-800 rounded bg-slate-900/30 uppercase text-slate-400 flex items-center justify-between">
                        <span>Joints</span>
                        <input
                          type="checkbox"
                          checked={renderConstraints.showJoints}
                          onChange={e => setRenderConstraints(prev => ({ ...prev, showJoints: e.target.checked }))}
                        />
                      </label>
                      <label className="p-2 border border-slate-800 rounded bg-slate-900/30 uppercase text-slate-400 flex items-center justify-between">
                        <span>IK Targets</span>
                        <input
                          type="checkbox"
                          checked={renderConstraints.showIKTargets}
                          onChange={e => setRenderConstraints(prev => ({ ...prev, showIKTargets: e.target.checked }))}
                        />
                      </label>
                      <label className="p-2 border border-slate-800 rounded bg-slate-900/30 uppercase text-slate-400 flex items-center justify-between">
                        <span>Hide Limb Blocks</span>
                        <input
                          type="checkbox"
                          checked={renderConstraints.hideLimbBlocks}
                          onChange={e => setRenderConstraints(prev => ({ ...prev, hideLimbBlocks: e.target.checked }))}
                        />
                      </label>
                      <label className="p-2 border border-slate-800 rounded bg-slate-900/30 uppercase text-slate-400">
                        <span className="block mb-1">Line Weight: {renderConstraints.lineWeight.toFixed(1)}</span>
                        <input
                          type="range"
                          min="0.5"
                          max="4"
                          step="0.1"
                          value={renderConstraints.lineWeight}
                          onChange={e => setRenderConstraints(prev => ({ ...prev, lineWeight: parseFloat(e.target.value) }))}
                          className="w-full"
                        />
                      </label>
                    </div>
                    <div className="text-xs font-bold text-slate-400 uppercase border-b border-slate-800 pb-1 mt-2">Headpiece Contrast</div>
                <div className="flex flex-col gap-2">
                    {(['none', 'low', 'medium', 'high'] as const).map(level => (
                        <button 
                                key={level} 
                                onClick={() => setHeadpieceContrastLevel(level)} 
                                className={`w-full text-[10px] font-bold py-1 border uppercase transition-colors ${headpieceContrastLevel === level ? 'bg-violet-600 text-white border-violet-500' : 'bg-slate-800 border-slate-700 hover:bg-slate-700'}`}
                            >
                                {level}
                            </button>
                        ))}
                    </div>
                    <div className="text-xs font-bold text-slate-400 uppercase border-b border-slate-800 pb-1 mt-2">IK Constraints</div>
	                    <button
	                      onClick={() => {
	                        const nextEnabled = !isIKEnabled;
	                        if (nextEnabled) {
	                          setIkConstraints(prev => ({
	                            ...prev,
	                            l_hand_anchor: {
	                              ...prev.l_hand_anchor,
	                              active: true,
	                              x: allJointPositions.l_hand?.position.x ?? prev.l_hand_anchor.x,
	                              y: allJointPositions.l_hand?.position.y ?? prev.l_hand_anchor.y,
	                            },
	                            r_hand_anchor: {
	                              ...prev.r_hand_anchor,
	                              active: true,
	                              x: allJointPositions.r_hand?.position.x ?? prev.r_hand_anchor.x,
	                              y: allJointPositions.r_hand?.position.y ?? prev.r_hand_anchor.y,
	                            },
	                          }));
	                        }
	                        setIsIKEnabled(nextEnabled);
	                        addLog(`IK ${nextEnabled ? 'enabled' : 'disabled'}`);
	                      }}
	                      className={`w-full text-[10px] font-bold py-1 border ${isIKEnabled ? 'bg-amber-500 text-white border-amber-400' : 'bg-slate-800 border-slate-700'}`}
	                    >
	                      IK MODE: {isIKEnabled ? 'ON' : 'OFF'}
	                    </button>
                    <div className="grid grid-cols-2 gap-2 text-[9px]">
                        {Object.entries(ikConstraints).map(([anchorKey, constraint]) => (
                            <div key={anchorKey} className="p-2 border border-slate-800 rounded bg-slate-900/30 space-y-1">
                                <div className="text-[8px] uppercase text-slate-400 flex justify-between items-center">
                                    <span>{anchorKey.replace('_anchor', '').toUpperCase()}</span>
                                    <label className="flex items-center gap-1">
                                        <input type="checkbox" checked={constraint.active} onChange={e => setIkConstraints(prev => ({ ...prev, [anchorKey]: { ...prev[anchorKey], active: e.target.checked } }))} />
                                        <span className="text-[7px]">ACTIVE</span>
                                    </label>
                                </div>
                                <div className="flex gap-2">
                                    <label className="flex-1 text-[8px] text-slate-400">X<input type="number" value={constraint.x} onChange={e => setIkConstraints(prev => ({ ...prev, [anchorKey]: { ...prev[anchorKey], x: parseFloat(e.target.value) } }))} className="w-full bg-slate-900/60 border border-slate-800 rounded px-1 py-0.5 text-[8px] text-slate-200" /></label>
                                    <label className="flex-1 text-[8px] text-slate-400">Y<input type="number" value={constraint.y} onChange={e => setIkConstraints(prev => ({ ...prev, [anchorKey]: { ...prev[anchorKey], y: parseFloat(e.target.value) } }))} className="w-full bg-slate-900/60 border border-slate-800 rounded px-1 py-0.5 text-[8px] text-slate-200" /></label>
                                </div>
                                <div className="flex gap-2">
                                    <label className="flex-1 text-[8px] text-slate-400">Stretch<input type="range" min="0.5" max="2" step="0.05" value={constraint.stretch} onChange={e => setIkConstraints(prev => ({ ...prev, [anchorKey]: { ...prev[anchorKey], stretch: parseFloat(e.target.value) } }))} className="w-full" /></label>
                                    <label className="flex-1 text-[8px] text-slate-400">
                                      Bend
                                      <select value={constraint.bendPriority} onChange={e => setIkConstraints(prev => ({ ...prev, [anchorKey]: { ...prev[anchorKey], bendPriority: e.target.value as BendPriority } }))} className="w-full bg-slate-900/60 border border-slate-800 rounded px-1 py-0.5 text-[8px] text-slate-200">
                                        {(['neutral', 'outer', 'inner'] as BendPriority[]).map(opt => (
                                          <option key={opt} value={opt}>{opt}</option>
                                        ))}
                                      </select>
                                    </label>
                                </div>
                            </div>
                        ))}
                    </div>
                    <div id="mask-controls-placeholder" className="space-y-2 border border-slate-800 bg-slate-900/50 rounded-lg p-3 text-slate-200">
                        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest">
                            <span>Live Mask Overlay</span>
                            <button
                                onClick={() => setMaskImage(null)}
                                className="text-[9px] px-2 py-0.5 border border-red-600 rounded uppercase hover:bg-red-600/80 transition-colors"
                            >
                                Remove Mask
                            </button>
                        </div>
                        <div className="flex gap-2">
                            <label htmlFor="mask-upload" className="flex-1 text-[10px] px-2 py-1 border border-slate-700 rounded uppercase text-center cursor-pointer hover:bg-slate-800 transition-colors">
                                Upload Mask
                                <input id="mask-upload" type="file" accept="image/*" className="hidden" onChange={handleMaskUpload} />
                            </label>
                            <button
                                onClick={() => setMaskTransform({ x: 0, y: 0, rotation: 0, scale: 1, mode: 'project' })}
                                className="text-[9px] px-2 py-1 border border-slate-700 rounded uppercase hover:bg-slate-800 transition-colors"
                            >
                                Reset Transform
                            </button>
                        </div>
                        <div className="space-y-2 text-slate-300">
                            <div className="space-y-1">
                                <div className="flex items-center justify-between text-[8px] uppercase text-slate-400">
                                    <span>X Offset</span>
                                    <span>{maskTransform.x.toFixed(1)}</span>
                                </div>
                                <input
                                    type="range"
                                    min="-500"
                                    max="500"
                                    step="0.5"
                                    value={maskTransform.x}
                                    onChange={e => setMaskTransform(prev => ({ ...prev, x: parseFloat(e.target.value) }))}
                                    className="w-full accent-emerald-500 h-1 cursor-ew-resize"
                                />
                            </div>
                            <div className="space-y-1">
                                <div className="flex items-center justify-between text-[8px] uppercase text-slate-400">
                                    <span>Y Offset</span>
                                    <span>{maskTransform.y.toFixed(1)}</span>
                                </div>
                                <input
                                    type="range"
                                    min="-500"
                                    max="500"
                                    step="0.5"
                                    value={maskTransform.y}
                                    onChange={e => setMaskTransform(prev => ({ ...prev, y: parseFloat(e.target.value) }))}
                                    className="w-full accent-violet-500 h-1 cursor-ew-resize"
                                />
                            </div>
                            <div className="space-y-1">
                                <div className="flex items-center justify-between text-[8px] uppercase text-slate-400">
                                    <span>Rotation</span>
                                    <span>{maskTransform.rotation.toFixed(0)}°</span>
                                </div>
                                <input
                                    type="range"
                                    min="-180"
                                    max="180"
                                    step="1"
                                    value={maskTransform.rotation}
                                    onChange={e => setMaskTransform(prev => ({ ...prev, rotation: parseFloat(e.target.value) }))}
                                    className="w-full accent-purple-500 h-1 cursor-ew-resize"
                                />
                            </div>
                            <div className="space-y-1">
                                <div className="flex items-center justify-between text-[8px] uppercase text-slate-400">
                                    <span>Scale</span>
                                    <span>{maskTransform.scale.toFixed(2)}x</span>
                                </div>
                                <input
                                    type="range"
                                    min="0.5"
                                    max="3"
                                    step="0.05"
                                    value={maskTransform.scale}
                                    onChange={e => setMaskTransform(prev => ({ ...prev, scale: parseFloat(e.target.value) }))}
                                    className="w-full accent-pink-500 h-1 cursor-ew-resize"
                                />
                            </div>
                        </div>
                    </div>
                    <div id="background-controls-placeholder" className="space-y-2 border border-slate-800 bg-slate-900/50 rounded-lg p-3 text-slate-200">
                        <div className="flex items-center justify-between text-[10px] font-bold uppercase tracking-widest">
                            <span>Background Image</span>
                            <button
                                onClick={() => setBackgroundImage(null)}
                                className="text-[9px] px-2 py-0.5 border border-red-600 rounded uppercase hover:bg-red-600/80 transition-colors"
                            >
                                Remove Background
                            </button>
                        </div>
                        <div className="flex gap-2">
                            <label htmlFor="background-upload" className="flex-1 text-[10px] px-2 py-1 border border-slate-700 rounded uppercase text-center cursor-pointer hover:bg-slate-800 transition-colors">
                                Upload Background
                                <input id="background-upload" type="file" accept="image/*" className="hidden" onChange={handleBackgroundUpload} />
                            </label>
                            <button
                                onClick={() => setBackgroundTransform({ x: 0, y: 0, rotation: 0, scale: 1, mode: 'cover' })}
                                className="text-[9px] px-2 py-1 border border-slate-700 rounded uppercase hover:bg-slate-800 transition-colors"
                            >
                                Reset Transform
                            </button>
                        </div>
                        <div className="space-y-2 text-slate-300">
                            <div className="space-y-1">
                                <div className="flex items-center justify-between text-[8px] uppercase text-slate-400">
                                    <span>X Offset</span>
                                    <span>{backgroundTransform.x.toFixed(0)}</span>
                                </div>
                                <input
                                    type="range"
                                    min="-1000"
                                    max="1000"
                                    step="1"
                                    value={backgroundTransform.x}
                                    onChange={e => setBackgroundTransform(prev => ({ ...prev, x: parseFloat(e.target.value) }))}
                                    className="w-full accent-emerald-500 h-1 cursor-ew-resize"
                                />
                            </div>
                            <div className="space-y-1">
                                <div className="flex items-center justify-between text-[8px] uppercase text-slate-400">
                                    <span>Y Offset</span>
                                    <span>{backgroundTransform.y.toFixed(0)}</span>
                                </div>
                                <input
                                    type="range"
                                    min="-1000"
                                    max="1000"
                                    step="1"
                                    value={backgroundTransform.y}
                                    onChange={e => setBackgroundTransform(prev => ({ ...prev, y: parseFloat(e.target.value) }))}
                                    className="w-full accent-violet-500 h-1 cursor-ew-resize"
                                />
                            </div>
                            <div className="space-y-1">
                                <div className="flex items-center justify-between text-[8px] uppercase text-slate-400">
                                    <span>Rotation</span>
                                    <span>{backgroundTransform.rotation.toFixed(0)}°</span>
                                </div>
                                <input
                                    type="range"
                                    min="-360"
                                    max="360"
                                    step="1"
                                    value={backgroundTransform.rotation}
                                    onChange={e => setBackgroundTransform(prev => ({ ...prev, rotation: parseFloat(e.target.value) }))}
                                    className="w-full accent-purple-500 h-1 cursor-ew-resize"
                                />
                            </div>
                            <div className="space-y-1">
                                <div className="flex items-center justify-between text-[8px] uppercase text-slate-400">
                                    <span>Scale</span>
                                    <span>{backgroundTransform.scale.toFixed(2)}x</span>
                                </div>
                                <input
                                    type="range"
                                    min="0.2"
                                    max="5"
                                    step="0.05"
                                    value={backgroundTransform.scale}
                                    onChange={e => setBackgroundTransform(prev => ({ ...prev, scale: parseFloat(e.target.value) }))}
                                    className="w-full accent-pink-500 h-1 cursor-ew-resize"
                                />
                            </div>
                        </div>
                    </div>
                </div>
            )}
            {activeControlTab === 'layers' && (
                <div className="flex flex-col gap-2 pt-4">
                    <div className="text-xs font-bold text-slate-400 uppercase border-b border-slate-800 pb-1">ULC System</div>
                    <button
                      onClick={recenterAll}
                      className="w-full text-[10px] font-bold py-1 border border-slate-700 bg-slate-800 hover:bg-slate-700 text-slate-100 uppercase rounded"
                    >
                      RECENTER MASKS & PRIMITIVES
                    </button>
                    <button
                      onClick={() => setIsMaskDragMode(v => !v)}
                      className={`w-full text-[10px] font-bold py-1 border uppercase rounded ${
                        isMaskDragMode
                          ? 'bg-emerald-500 text-white border-emerald-400'
                          : 'bg-slate-800 hover:bg-slate-700 text-slate-100 border-slate-700'
                      }`}
                    >
                      MASK DRAG: {isMaskDragMode ? 'ON' : 'OFF'}
                    </button>
                    <div className="text-[9px] text-slate-500 uppercase">
                      Drag=move | Shift+drag=scale | Alt/Option+drag=width
                    </div>
                    <div className="flex flex-col gap-2 h-[500px] overflow-y-auto custom-scrollbar">
                        {INITIAL_RENDER_ORDER.map(key => {
                            const isScaleExpanded = expandedScaleKeys.has(key);
                            return (
                            <div key={key} className="flex flex-col gap-1 mb-1">
                                <div className="p-2 border border-slate-800 rounded bg-slate-900/20 flex justify-between items-center">
                                    <button 
                                        onClick={() => setExpandedScaleKeys(s => new Set(s.has(key) ? [...s].filter(k => k !== key) : [...s, key]))}
                                        className="text-[10px] font-bold uppercase hover:text-violet-400 transition-colors flex items-center gap-1"
                                    >
                                        <span className={`text-[8px] transition-transform ${isScaleExpanded ? 'rotate-90' : 'rotate-0'}`}>▶</span>
                                        {key.replace(/_/g, ' ')}
                                    </button>
                                    <div className="flex gap-2">
                                        <button 
                                            onClick={() => setActiveShapeEditorKey(activeShapeEditorKey === key ? null : key)}
                                            className={`text-[8px] px-2 py-1 border border-slate-700 hover:bg-slate-800 transition-colors uppercase font-bold ${activeShapeEditorKey === key ? 'bg-violet-600 text-white' : ''}`}
                                        >
                                            SHAPE
                                        </button>
                                        <label className="text-[8px] px-2 py-1 border border-slate-700 hover:bg-slate-800 cursor-pointer transition-colors uppercase font-bold">
                                            UPLOAD
                                            <input type="file" accept="image/*" className="hidden" onChange={(e) => handleULCUpload(key, e)} />
                                        </label>
                                    </div>
                                </div>
                                {isScaleExpanded && (
                                    <div className="p-2 border border-slate-800 bg-slate-900/40 rounded-b space-y-2">
                                        <div className="space-y-1">
                                            <div className="text-[8px] text-slate-500 uppercase flex justify-between">
                                                <span>Scale</span>
                                                <span>{((partScales[key] ?? 1) * 100).toFixed(0)}%</span>
                                            </div>
                                            <input 
                                                type="range" 
                                                min="0.25" 
                                                max="25" 
                                                step="0.05" 
                                                value={partScales[key] ?? 1}
                                                onChange={(e) => setPartScales(s => syncRightLimbScales({ ...s, [key]: parseFloat(e.target.value) }))}
                                                className="w-full accent-violet-500 h-1 cursor-ew-resize"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <div className="text-[8px] text-slate-500 uppercase flex justify-between">
                                                <span>X Offset</span>
                                                <span>{(partOffsets[key]?.x ?? 0).toFixed(1)}</span>
                                            </div>
                                            <input 
                                                type="range" 
                                                min="-1000" 
                                                max="1000" 
                                                step="1" 
                                                value={partOffsets[key]?.x ?? 0}
                                                onChange={(e) => setPartOffsets(s => syncRightLegOffsets({ ...s, [key]: { ...s[key], x: parseFloat(e.target.value), y: s[key]?.y ?? 0, rotation: s[key]?.rotation ?? 0 } }))}
                                                className="w-full accent-green-500 h-1 cursor-ew-resize"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <div className="text-[8px] text-slate-500 uppercase flex justify-between">
                                                <span>Y Offset</span>
                                                <span>{(partOffsets[key]?.y ?? 0).toFixed(1)}</span>
                                            </div>
                                            <input 
                                                type="range" 
                                                min="-1000" 
                                                max="1000" 
                                                step="1" 
                                                value={partOffsets[key]?.y ?? 0}
                                                onChange={(e) => setPartOffsets(s => syncRightLegOffsets({ ...s, [key]: { ...s[key], x: s[key]?.x ?? 0, y: parseFloat(e.target.value), rotation: s[key]?.rotation ?? 0 } }))}
                                                className="w-full accent-violet-500 h-1 cursor-ew-resize"
                                            />
                                        </div>
                                        <div className="space-y-1">
                                            <div className="text-[8px] text-slate-500 uppercase flex justify-between">
                                                <span>Rotation</span>
                                                <span>{(partOffsets[key]?.rotation ?? 0).toFixed(0)}°</span>
                                            </div>
                                            <input 
                                                type="range" 
                                                min="-180" 
                                                max="180" 
                                                step="1" 
                                                value={partOffsets[key]?.rotation ?? 0}
                                                onChange={(e) => setPartOffsets(s => syncRightLegOffsets({ ...s, [key]: { ...s[key], x: s[key]?.x ?? 0, y: s[key]?.y ?? 0, rotation: parseFloat(e.target.value) } }))}
                                                className="w-full accent-purple-500 h-1 cursor-ew-resize"
                                            />
                                        </div>
                                    </div>
                                )}
                                {activeShapeEditorKey === key && (
                                    <div className="p-2 border border-slate-800 bg-slate-900/40 rounded-b mt-1">
                                        <div className="text-[8px] text-slate-500 uppercase mb-1 flex justify-between">
                                            <span>SVG Path (d attribute)</span>
                                            <button onClick={() => setPartCustomPaths(p => ({ ...p, [key]: undefined }))} className="text-red-500 hover:underline">RESET</button>
                                        </div>
                                        <textarea 
                                            className="w-full h-24 bg-black text-violet-400 text-[10px] p-2 rounded border border-slate-800 focus:border-violet-500 outline-none font-mono"
                                            placeholder="M 0 0 L 10 10 ..."
                                            value={partCustomPaths[key] || ''}
                                            onChange={(e) => setPartCustomPaths(p => ({ ...p, [key]: e.target.value }))}
                                        />
                                    </div>
                                )}
                            </div>
                        );
                        })})
                    </div>
                </div>
            )}
          </div>
          <SystemLogger
            logs={recordingHistory}
            isVisible={true}
            historyCount={recordingHistory.length}
            onLogMouseEnter={setOnionSkinData}
            onLogMouseLeave={() => setOnionSkinData(null)}
            onLogClick={() => {}}
            selectedLogIndex={null}
          />
          <div className="mt-3 border border-slate-800 bg-slate-900/50 rounded-lg p-3 space-y-2">
            <div className="text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-slate-800 pb-1">Calibration Tracker</div>
            <div className="grid grid-cols-2 gap-2 text-[9px] text-slate-300">
              {calibrationTracker.map(point => (
                <div key={point.name} className="bg-slate-900/80 border border-slate-800 rounded px-2 py-1">
                  <div className="font-semibold text-[10px] uppercase text-slate-200">{point.name}</div>
                  <div className="text-slate-400">Pos: {point.x.toFixed(1)}, {point.y.toFixed(1)}</div>
                  <div className="text-slate-400">Grid: {point.gridX}, {point.gridY}</div>
                  <div className="text-slate-400">Rot: {point.rotation.toFixed(1)}°</div>
                </div>
              ))}
            </div>
            <div className="text-[9px] text-slate-400 flex justify-between">
              <span>View center</span>
              <span>{viewBoxCenter.x.toFixed(1)}, {viewBoxCenter.y.toFixed(1)}</span>
            </div>
          </div>
          <div className="mt-3 border border-slate-800 bg-slate-900/50 rounded-lg p-3 space-y-2">
            <div className="flex items-center justify-between text-xs font-bold text-slate-400 uppercase tracking-widest border-b border-slate-800 pb-1">
              <span>Pose Data</span>
              <div className="flex gap-2">
                <button onClick={copyPoseData} className="text-[9px] px-2 py-0.5 border border-slate-700 rounded text-slate-200 hover:bg-slate-800">Copy</button>
                <button onClick={applyPoseData} className="text-[9px] px-2 py-0.5 border border-slate-700 rounded text-slate-200 hover:bg-slate-800">Apply</button>
              </div>
            </div>
            <textarea
              readOnly
              value={poseDataString}
              className="w-full h-32 bg-slate-900/80 text-[10px] text-slate-100 font-mono rounded border border-slate-800 resize-none p-2"
            />
            <textarea
              placeholder="Paste pose data here to apply"
              value={poseDataInput}
              onChange={(e) => setPoseDataInput(e.target.value)}
              className="w-full h-20 bg-slate-900/80 text-[10px] text-slate-300 font-mono rounded border border-slate-800 resize-none p-2"
            />
            <div className="text-xs font-bold text-slate-400 uppercase border-b border-slate-800 pb-1 mt-2">Mask Data (read-only)</div>
            <textarea
              readOnly
              value={maskDataString}
              className="w-full h-24 bg-slate-900/80 text-[10px] text-slate-100 font-mono rounded border border-slate-800 resize-none p-2"
            />
          </div>
        </div>
      )}
      <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden" onClick={() => !isCalibrated && animatePoseTransition(T_POSE, 500, () => {setIsCalibrated(true); setIsConsoleVisible(true);})}>
        {!isCalibrated && <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-50 animate-pulse"><span className="text-6xl font-black uppercase tracking-tighter text-white">CLICK TO ACTIVATE RIG</span></div>}
        <svg ref={svgRef} viewBox={`${viewBoxCenter.x - VIEWBOX_WIDTH / 2} ${viewBoxCenter.y - VIEWBOX_HEIGHT / 2} ${VIEWBOX_WIDTH} ${VIEWBOX_HEIGHT}`} className="w-full h-full drop-shadow-2xl overflow-visible relative">
          <defs>
              <pattern id="smallGrid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" fill="none" stroke="#9ca3af" strokeWidth="0.5"/></pattern>
              <pattern id="grid" width="100" height="100" patternUnits="userSpaceOnUse"><rect width="100" height="100" fill="url(#smallGrid)"/><path d="M 100 0 L 0 0 0 100" fill="none" stroke="#d1d5db" strokeWidth="1"/></pattern>
          </defs>
          <rect x="-2000" y="-2000" width="4000" height="4000" fill="#f3f4f6" />
          {backgroundImage && (
            <image
              href={backgroundImage}
              x="-500"
              y="-500"
              width="1000"
              height="1000"
              transform={`translate(${backgroundTransform.x}, ${backgroundTransform.y}) rotate(${backgroundTransform.rotation}) scale(${backgroundTransform.scale})`}
            />
          )}
          <g transform={`translate(${physicsState.position.x}, ${physicsState.position.y}) rotate(${bodyRotation})`}>
            <g transform={`scale(${figureScale})`}>
              {staticGhostPose && <Mannequin pose={RESTING_BASE_POSE} pivotOffsets={staticGhostPose} props={props} isGhost={true} ghostOpacity={0.2} showPivots={false} showLabels={false} baseUnitH={baseH} onAnchorMouseDown={()=>{}} onBodyMouseDown={()=>{}} draggingBoneKey={null} selectedBoneKeys={new Set()} isPaused={true} partScales={partScales} partOffsets={partOffsets} partZOrder={partZOrder} headpieceContrastLevel={headpieceContrastLevel} anchorFitEnabled={anchorFitEnabled} visualAnchorOverrides={visualAnchorOverrides} textureViewBoxOverrides={textureViewBoxOverrides} showPrimitives={renderConstraints.showPrimitives} />}
              {onionSkinData && <Mannequin pose={RESTING_BASE_POSE} pivotOffsets={onionSkinData.pivotOffsets} props={onionSkinData.props} isGhost={true} ghostOpacity={0.3} showPivots={false} showLabels={false} baseUnitH={baseH} onAnchorMouseDown={()=>{}} onBodyMouseDown={()=>{}} draggingBoneKey={null} selectedBoneKeys={new Set()} isPaused={true} partScales={partScales} partOffsets={partOffsets} partZOrder={partZOrder} headpieceContrastLevel={headpieceContrastLevel} anchorFitEnabled={anchorFitEnabled} visualAnchorOverrides={visualAnchorOverrides} textureViewBoxOverrides={textureViewBoxOverrides} showPrimitives={renderConstraints.showPrimitives} />}
                <Mannequin 
                    pose={RESTING_BASE_POSE} 
                    pivotOffsets={previewPivotOffsets || pivotOffsets} 
                    props={props} 
                showPivots={isCalibrated && showFKRig} 
                showLabels={showLabels} 
                showRig={shouldShowRig}
	                renderMode={renderMode}
	                materialMode={shouldShowMasks ? 'default' : 'clear'}
	                ikTargets={ikConstraints}
	                ikEnabled={isIKEnabled}
	                rigVisuals={{
	                  showJoints: renderConstraints.showJoints,
	                  showIKTargets: renderConstraints.showIKTargets,
	                  lineWeight: renderConstraints.lineWeight,
                  hideLimbBlocks: renderConstraints.hideLimbBlocks,
                  clipToEdge: renderConstraints.clipToEdge,
                }}
                textureViewBoxOverrides={textureViewBoxOverrides}
                showPrimitives={renderConstraints.showPrimitives}
                baseUnitH={baseH} 
                onAnchorMouseDown={(k, x, y) => startDrag(k, x, y)} 
                onBodyMouseDown={(k, x, y, e, partKey) => startDrag(k, x, y, partKey, e)} 
                draggingBoneKey={draggingBoneKey} 
                selectedBoneKeys={new Set()} 
                isPaused={true} 
                    partTextures={partTextures} 
                    maskImage={maskImage}
                    maskTransform={maskTransform}
                    maskTransforms={maskTransforms} 
                    partCustomPaths={partCustomPaths}
                partScales={partScales}
                partOffsets={partOffsets}
                onPositionsUpdate={setAllJointPositions} 
                partZOrder={partZOrder}
                headpieceContrastLevel={headpieceContrastLevel}
                anchorFitEnabled={anchorFitEnabled}
                visualAnchorOverrides={visualAnchorOverrides}
                hardcodedAssets={hardcodedAssets}
            />
            </g>
          </g>
        </svg>
        {isIntertitleVisible && (
            <Intertitle text={intertitleText} speed={50} isTyping={true} fontSize={intertitleFontSize} style={intertitleStyle} opacity={1} />
        )}
      </div>
    </div>
  );
};

export default App;
