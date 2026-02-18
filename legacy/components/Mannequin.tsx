
import React, { useMemo, useEffect } from 'react';
import { Bone, COLORS } from './Bone';
import { ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT, RIGGING, DEFAULT_VISUAL_ANCHORS, DEFAULT_TEXTURE_VIEWBOXES } from '../constants';
import { WalkingEnginePose, WalkingEngineProportions, WalkingEnginePivotOffsets, Vector2D, MaskTransform, GlobalPositions, PartVisualAnchors, HardcodedAssetsMap, TextureViewBox } from '../types';
import { getScaledDimension as getKinematicDimension } from '../utils/kinematics';

interface MannequinProps {
  pose: WalkingEnginePose;
  pivotOffsets: WalkingEnginePivotOffsets;
  props: WalkingEngineProportions;
  showPivots: boolean;
  showLabels: boolean;
  baseUnitH: number;
  onAnchorMouseDown: (boneKey: keyof WalkingEnginePivotOffsets, clientX: number, clientY: number, e: React.MouseEvent | React.TouchEvent) => void;
  onBodyMouseDown: (
    boneKey: keyof WalkingEnginePivotOffsets,
    clientX: number,
    clientY: number,
    e: React.MouseEvent | React.TouchEvent,
    partKey?: keyof WalkingEngineProportions
  ) => void;
  draggingBoneKey: keyof WalkingEnginePivotOffsets | null;
  selectedBoneKeys: Set<keyof WalkingEnginePivotOffsets>;
  isPaused: boolean;
  maskImage?: string | null;
  maskTransform?: MaskTransform;
  partTextures?: Partial<Record<keyof WalkingEngineProportions, string>>;
  maskTransforms?: Partial<Record<keyof WalkingEngineProportions, MaskTransform>>;
  partCustomPaths?: Partial<Record<keyof WalkingEngineProportions, string>>;
  partScales?: Partial<Record<keyof WalkingEngineProportions, number>>;
  partOffsets?: Partial<Record<keyof WalkingEngineProportions, { x: number; y: number; rotation: number }>>;
  isGhost?: boolean;
  showRig?: boolean;
  renderMode?: 'full' | 'skeleton_only';
  materialMode?: 'default' | 'clear';
  rigVisuals?: {
    showJoints?: boolean;
    showIKTargets?: boolean;
    lineWeight?: number;
    jointRadius?: number;
    hideLimbBlocks?: boolean;
    clipToEdge?: boolean;
  };
  overrideProps?: WalkingEngineProportions;
  onPositionsUpdate?: (positions: GlobalPositions) => void;
  activePins?: (keyof WalkingEnginePivotOffsets)[];
  ikTargets?: Partial<Record<'l_hand_anchor' | 'r_hand_anchor', { active: boolean; x: number; y: number }>>;
  ikEnabled?: boolean;
  ghostType?: 'ik' | 'fk' | 'static' | null;
  ghostOpacity?: number;
  partZOrder: Record<keyof WalkingEngineProportions, number>;
  headpieceContrastLevel?: 'none' | 'low' | 'medium' | 'high';
  anchorFitEnabled?: boolean;
  visualAnchorOverrides?: Partial<Record<keyof WalkingEngineProportions, PartVisualAnchors>>;
  hardcodedAssets?: HardcodedAssetsMap;
  textureViewBoxOverrides?: Partial<Record<keyof WalkingEngineProportions, TextureViewBox>>;
  showPrimitives?: boolean;
}

export const partDefinitions: Partial<Record<keyof WalkingEngineProportions, any>> = {
    head: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.HEAD, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.HEAD_WIDTH, variant: 'head-wedge', drawsUpwards: true, label: 'Head', boneKey: 'neck' },
    collar: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.COLLAR, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.COLLAR_WIDTH, variant: 'collar-horizontal-oval-shape', drawsUpwards: true, label: 'Collar', boneKey: 'collar' },
    torso: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.TORSO, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.TORSO_WIDTH, variant: 'torso-teardrop-pointy-down', drawsUpwards: true, label: 'Torso', boneKey: 'torso' },
    waist: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.WAIST, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.WAIST_WIDTH, variant: 'waist-teardrop-pointy-up', drawsUpwards: true, label: 'Waist', boneKey: 'waist' },
    r_upper_arm: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.UPPER_ARM, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LIMB_WIDTH_ARM, variant: 'limb-tapered', label: 'R.Bicep', boneKey: 'r_shoulder', anchorPosition: 'start' },
    r_lower_arm: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LOWER_ARM, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LIMB_WIDTH_FOREARM, variant: 'limb-tapered', label: 'R.Forearm', boneKey: 'r_elbow', anchorPosition: 'start' },
    r_hand: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.HAND, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.HAND_WIDTH, variant: 'hand-foot-arrowhead-shape', label: 'R.Hand', boneKey: 'r_hand' },
    l_upper_arm: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.UPPER_ARM, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LIMB_WIDTH_ARM, variant: 'limb-tapered', label: 'L.Bicep', boneKey: 'l_shoulder', anchorPosition: 'start' },
    l_lower_arm: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LOWER_ARM, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LIMB_WIDTH_FOREARM, variant: 'limb-tapered', label: 'L.Forearm', boneKey: 'l_elbow', anchorPosition: 'start' },
    l_hand: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.HAND, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.HAND_WIDTH, variant: 'hand-foot-arrowhead-shape', label: 'L.Hand', boneKey: 'l_hand' },
    r_upper_leg: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_UPPER, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LIMB_WIDTH_THIGH, variant: 'limb-tapered', label: 'R.Thigh', boneKey: 'r_hip' },
    r_lower_leg: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_LOWER, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LIMB_WIDTH_CALF, variant: 'limb-tapered', label: 'R.Calf', boneKey: 'r_knee', anchorPosition: 'start' },
    r_foot: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.FOOT + ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.TOE, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.FOOT_WIDTH, variant: 'foot-block-shape', label: 'R.Foot', boneKey: 'r_foot' },
    l_upper_leg: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_UPPER, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LIMB_WIDTH_THIGH, variant: 'limb-tapered', label: 'L.Thigh', boneKey: 'l_hip' },
    l_lower_leg: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_LOWER, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LIMB_WIDTH_CALF, variant: 'limb-tapered', label: 'L.Calf', boneKey: 'l_knee', anchorPosition: 'start' },
    l_foot: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.FOOT + ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.TOE, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.FOOT_WIDTH, variant: 'foot-block-shape', label: 'L.Foot', boneKey: 'l_foot' },
};

const rotateVec = (vec: Vector2D, angleDeg: number): Vector2D => {
  const r = angleDeg * Math.PI / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: vec.x * c - vec.y * s, y: vec.y * c + vec.x * s };
};
const addVec = (v1: Vector2D, v2: Vector2D): Vector2D => ({ x: v1.x + v2.x, y: v1.y + v2.y });

const LIMB_PART_KEYS: Set<keyof WalkingEngineProportions> = new Set([
  'l_upper_arm', 'r_upper_arm',
  'l_lower_arm', 'r_lower_arm',
  'l_upper_leg', 'r_upper_leg',
  'l_lower_leg', 'r_lower_leg',
  'l_hand', 'r_hand',
  'l_foot', 'r_foot',
]);

export const Mannequin: React.FC<MannequinProps> = ({
  pose, pivotOffsets, props, showPivots, showLabels, baseUnitH,
  onAnchorMouseDown, onBodyMouseDown, draggingBoneKey, selectedBoneKeys, isPaused,
  maskImage, maskTransform, partTextures, maskTransforms, partCustomPaths, partScales, partOffsets, isGhost = false, showRig = false, renderMode = 'full', materialMode = 'default', rigVisuals, overrideProps, onPositionsUpdate, activePins = [], ikTargets,
  ikEnabled = false,
  ghostType, ghostOpacity = 0.6, partZOrder, headpieceContrastLevel = 'none', anchorFitEnabled = true, visualAnchorOverrides, hardcodedAssets, textureViewBoxOverrides, showPrimitives = true
}) => {
    const activeProps = useMemo(() => overrideProps || JSON.parse(JSON.stringify(props)), [props, overrideProps]);
    const renderOrder = useMemo(() => (Object.keys(partZOrder) as (keyof WalkingEngineProportions)[]).sort((a, b) => partZOrder[a] - partZOrder[b]), [partZOrder]);
    const isSkeletonOnly = renderMode === 'skeleton_only' && !isGhost;
    const resolvedMaskOverlayTransform = maskTransform ?? { x: 0, y: 0, rotation: 0, scale: 1, mode: 'project' };

    const calculations = useMemo(() => {
        const trans: GlobalPositions = {};
        const lengthScaleOverrides: Partial<Record<keyof WalkingEngineProportions, number>> = {};
        const getRot = (key: keyof WalkingEnginePivotOffsets) => ((pose as any)[key] || 0) + ((pivotOffsets as any)[key] || 0);

        const waistLen = getKinematicDimension(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.WAIST, baseUnitH, activeProps, 'waist', 'h');
        const torsoLen = getKinematicDimension(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.TORSO, baseUnitH, activeProps, 'torso', 'h');
        const collarLen = getKinematicDimension(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.COLLAR, baseUnitH, activeProps, 'collar', 'h');
        
        const waistRootPos: Vector2D = { x: 0, y: 0 }; 
        const waistRot = getRot('waist');

        const torsoRot = waistRot + getRot('torso');
        const torsoBasePos = addVec(waistRootPos, rotateVec({ x: 0, y: -waistLen }, waistRot));
        trans.torso = { position: torsoBasePos, rotation: torsoRot };
        // Waist now represents the torso-bottom hip socket where legs sprout.
        trans.waist = { position: torsoBasePos, rotation: torsoRot };

        const collarRot = torsoRot + getRot('collar');
        trans.collar = { position: addVec(trans.torso.position, rotateVec({ x: 0, y: -torsoLen }, torsoRot)), rotation: collarRot };
        
        const neckRot = collarRot + getRot('neck');
        trans.head = { position: addVec(trans.collar.position, rotateVec({ x: 0, y: -collarLen }, collarRot)), rotation: neckRot };

        ['r', 'l'].forEach(side => {
            const sidePrefix = side === 'r' ? 'r_' : 'l_';
            const sx = (side === 'r' ? RIGGING.R_SHOULDER_X_OFFSET_FROM_COLLAR_CENTER : RIGGING.L_SHOULDER_X_OFFSET_FROM_COLLAR_CENTER) * baseUnitH;
            const sy = RIGGING.SHOULDER_Y_OFFSET_FROM_COLLAR_END * baseUnitH;
            const shoulderRootPos = addVec(trans.collar.position, rotateVec({ x: sx, y: sy }, collarRot));
            
            const upArmKey = (sidePrefix + 'upper_arm') as keyof WalkingEngineProportions;
            const lowArmKey = (sidePrefix + 'lower_arm') as keyof WalkingEngineProportions;
            const handKey = (sidePrefix + 'hand') as keyof WalkingEngineProportions;
            
            const upArmLen = getKinematicDimension(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.UPPER_ARM, baseUnitH, activeProps, upArmKey, 'h');
            const lowArmLen = getKinematicDimension(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LOWER_ARM, baseUnitH, activeProps, lowArmKey, 'h');
            const anchorKey = side === 'r' ? 'r_hand_anchor' : 'l_hand_anchor';
            const ikTarget = ikEnabled ? (ikTargets as any)?.[anchorKey] : null;
            const maxStretch = typeof ikTarget?.stretch === 'number' ? Math.max(1, ikTarget.stretch) : 1;
            const maxDist = upArmLen + lowArmLen;
            const distToTarget = (ikTarget && ikTarget.active && maxDist > 0.0001)
              ? Math.hypot(ikTarget.x - shoulderRootPos.x, ikTarget.y - shoulderRootPos.y)
              : 0;
            const requiredStretch = distToTarget > maxDist ? distToTarget / maxDist : 1;
            const stretchScale = ikTarget && ikTarget.active && requiredStretch > 1
              ? Math.min(requiredStretch, maxStretch)
              : 1;
            lengthScaleOverrides[upArmKey] = stretchScale;
            lengthScaleOverrides[lowArmKey] = stretchScale;
            const effectiveUpArmLen = upArmLen * stretchScale;
            const effectiveLowArmLen = lowArmLen * stretchScale;

            const shRot = collarRot + getRot((sidePrefix + 'shoulder') as any); 
            const elRot = shRot + getRot((sidePrefix + 'elbow') as any);
            const wrRot = elRot + getRot((sidePrefix + 'hand') as any);

            trans[upArmKey] = { position: shoulderRootPos, rotation: shRot };
            const elbowPos = addVec(shoulderRootPos, rotateVec({ x: 0, y: effectiveUpArmLen }, shRot));
            trans[lowArmKey] = { position: elbowPos, rotation: elRot };
            const wristPos = addVec(elbowPos, rotateVec({ x: 0, y: effectiveLowArmLen }, elRot));
            trans[handKey] = { position: wristPos, rotation: wrRot };
        });

        const waistFrameWidth = getKinematicDimension(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.TORSO_WIDTH, baseUnitH, activeProps, 'torso', 'w');
        const referenceThighWidth = getKinematicDimension(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LIMB_WIDTH_THIGH, baseUnitH, activeProps, 'l_upper_leg', 'w');
        const hipSeparation = Math.max(0, waistFrameWidth - referenceThighWidth);
        const hipHalfSeparation = hipSeparation * 0.5;

        ['r', 'l'].forEach(side => {
            const sidePrefix = side === 'r' ? 'r_' : 'l_';
            const upLegKey = (sidePrefix + 'upper_leg') as keyof WalkingEngineProportions;
            const lowLegKey = (sidePrefix + 'lower_leg') as keyof WalkingEngineProportions;
            const footKey = (sidePrefix + 'foot') as keyof WalkingEngineProportions;

            const thighLen = getKinematicDimension(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_UPPER, baseUnitH, activeProps, upLegKey, 'h');
            const calfLen = getKinematicDimension(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_LOWER, baseUnitH, activeProps, lowLegKey, 'h');
            
            const hiRot = torsoRot + getRot((sidePrefix + 'hip') as any); 
            const knRot = hiRot + getRot((sidePrefix + 'knee') as any);
            const anRot = knRot + getRot((sidePrefix + 'foot') as any);

            const hipX = (side === 'r' ? 1 : -1) * hipHalfSeparation;
            const hipRootBase = trans.torso?.position ?? waistRootPos;
            const hipRootPos = addVec(hipRootBase, rotateVec({ x: hipX, y: 0 }, torsoRot));

            trans[upLegKey] = { position: hipRootPos, rotation: hiRot };
            const kneePos = addVec(hipRootPos, rotateVec({ x: 0, y: thighLen }, hiRot));
            trans[lowLegKey] = { position: kneePos, rotation: knRot };
            const anklePos = addVec(kneePos, rotateVec({ x: 0, y: calfLen }, knRot));
            trans[footKey] = { position: anklePos, rotation: anRot };
        });

    return { transforms: trans, finalProps: activeProps, waistLen, torsoLen, collarLen, lengthScaleOverrides };
  }, [pose, pivotOffsets, baseUnitH, activeProps, ikTargets, ikEnabled]);

    useEffect(() => { onPositionsUpdate?.(calculations.transforms); }, [calculations.transforms, onPositionsUpdate]);

    const renderRig = () => {
        const t = calculations.transforms;
        const getPos = (key: keyof WalkingEngineProportions): Vector2D => t[key]?.position || { x: 0, y: 0 };

    const waistLen = calculations.waistLen ?? 0;
    const waistRot = t.waist?.rotation ?? 0;
    const navelPoint = addVec(t.waist.position, rotateVec({ x: 0, y: -waistLen * 0.3 }, waistRot));
    const lFootDefinition = partDefinitions.l_foot;
    const rFootDefinition = partDefinitions.r_foot;
    const lFootLen = lFootDefinition
      ? getKinematicDimension(lFootDefinition.rawH, baseUnitH, calculations.finalProps, 'l_foot', 'h')
      : 0;
    const rFootLen = rFootDefinition
      ? getKinematicDimension(rFootDefinition.rawH, baseUnitH, calculations.finalProps, 'r_foot', 'h')
      : 0;
    const lFootTip = addVec(getPos('l_foot'), rotateVec({ x: 0, y: lFootLen }, t.l_foot?.rotation ?? 0));
    const rFootTip = addVec(getPos('r_foot'), rotateVec({ x: 0, y: rFootLen }, t.r_foot?.rotation ?? 0));

    const dragonLines = [
        { p1: navelPoint, p2: getPos('torso') },
        { p1: getPos('torso'), p2: getPos('collar') },
        { p1: getPos('collar'), p2: getPos('head') },
        { p1: getPos('collar'), p2: getPos('l_upper_arm') },
        { p1: getPos('collar'), p2: getPos('r_upper_arm') },
        { p1: getPos('waist'), p2: getPos('l_upper_leg') },
        { p1: getPos('waist'), p2: getPos('r_upper_leg') },
        { p1: getPos('l_upper_arm'), p2: getPos('l_lower_arm') },
        { p1: getPos('l_lower_arm'), p2: getPos('l_hand') },
        { p1: getPos('r_upper_arm'), p2: getPos('r_lower_arm') },
        { p1: getPos('r_lower_arm'), p2: getPos('r_hand') },
        { p1: getPos('l_upper_leg'), p2: getPos('l_lower_leg') },
        { p1: getPos('l_lower_leg'), p2: getPos('l_foot') },
        { p1: getPos('l_foot'), p2: lFootTip },
        { p1: getPos('r_upper_leg'), p2: getPos('r_lower_leg') },
        { p1: getPos('r_lower_leg'), p2: getPos('r_foot') },
        { p1: getPos('r_foot'), p2: rFootTip },
    ];
    const jointNodes = [
        { key: 'root', pos: navelPoint, color: '#f472b6' },
        { key: 'waist', pos: getPos('waist'), color: '#a78bfa' },
        { key: 'torso', pos: getPos('torso'), color: '#a78bfa' },
        { key: 'collar', pos: getPos('collar'), color: '#a78bfa' },
        { key: 'head', pos: getPos('head'), color: '#a78bfa' },
        { key: 'l_shoulder', pos: getPos('l_upper_arm'), color: '#a78bfa' },
        { key: 'l_elbow', pos: getPos('l_lower_arm'), color: '#a78bfa' },
        { key: 'l_wrist', pos: getPos('l_hand'), color: '#a78bfa' },
        { key: 'r_shoulder', pos: getPos('r_upper_arm'), color: '#a78bfa' },
        { key: 'r_elbow', pos: getPos('r_lower_arm'), color: '#a78bfa' },
        { key: 'r_wrist', pos: getPos('r_hand'), color: '#a78bfa' },
        { key: 'l_hip', pos: getPos('l_upper_leg'), color: '#a78bfa' },
        { key: 'l_knee', pos: getPos('l_lower_leg'), color: '#a78bfa' },
        { key: 'l_ankle', pos: getPos('l_foot'), color: '#a78bfa' },
        { key: 'r_hip', pos: getPos('r_upper_leg'), color: '#a78bfa' },
        { key: 'r_knee', pos: getPos('r_lower_leg'), color: '#a78bfa' },
        { key: 'r_ankle', pos: getPos('r_foot'), color: '#a78bfa' },
    ];
    const lineWeight = Math.max(0.5, rigVisuals?.lineWeight ?? (isSkeletonOnly ? 1 : 2.5));
    const jointRadius = Math.max(1.5, rigVisuals?.jointRadius ?? (isSkeletonOnly ? 2.4 : 3));
    const shouldRenderJoints = rigVisuals?.showJoints ?? true;
    const shouldRenderIKTargets = rigVisuals?.showIKTargets ?? true;

    return (
        <g opacity={isSkeletonOnly ? 1 : 0.75} pointerEvents="none" stroke="#a78bfa" strokeWidth={lineWeight} strokeLinecap="round" strokeLinejoin="round">
            {dragonLines.map((l, i) => (
                <line key={i} x1={l.p1.x} y1={l.p1.y} x2={l.p2.x} y2={l.p2.y} />
            ))}
            {shouldRenderJoints && jointNodes.map(node => (
                <circle key={node.key} cx={node.pos.x} cy={node.pos.y} r={jointRadius} fill={node.color} stroke="#0f172a" strokeWidth={isSkeletonOnly ? 0.8 : 1.5} />
            ))}
            {shouldRenderIKTargets && (Object.entries(ikTargets || {}) as Array<['l_hand_anchor' | 'r_hand_anchor', { active: boolean; x: number; y: number }]>)
                .filter(([, target]) => target.active)
                .map(([targetKey, target]) => (
                    <g key={targetKey} transform={`translate(${target.x}, ${target.y})`} stroke="#f59e0b" fill="none">
                        <line x1={-8} y1={0} x2={8} y2={0} strokeWidth={1.2} />
                        <line x1={0} y1={-8} x2={0} y2={8} strokeWidth={1.2} />
                        <circle cx={0} cy={0} r={5} strokeWidth={1.1} strokeDasharray="2 2" />
                    </g>
                ))}
        </g>
    );
  };

    const renderHardcodedAssets = (priority: 'top' | 'bottom') => {
        if (isGhost || isSkeletonOnly || !hardcodedAssets) return null;

        const entries = Object.entries(hardcodedAssets);
        if (!entries.length) return null;

        const shouldAttachToTip = (anchorPoint?: string) => {
            if (!anchorPoint) return false;
            const normalized = anchorPoint.toLowerCase();
            return ['wrist', 'ankle', 'toe', 'hand', 'foot', 'tip'].some(token => normalized.includes(token));
        };

        return entries.map(([assetKey, asset]) => {
            const hostKey = asset.host_line;
            const hostDefinition = partDefinitions[hostKey];
            const hostTransform = calculations.transforms[hostKey];
            if (!hostDefinition || !hostTransform) return null;
            if ((asset.render_priority ?? 'top') !== priority) return null;
            if (asset.mode === 'hidden') return null;

            const hostLength = getKinematicDimension(hostDefinition.rawH, baseUnitH, calculations.finalProps, hostKey, 'h');
            const hostWidth = getKinematicDimension(hostDefinition.rawW, baseUnitH, calculations.finalProps, hostKey, 'w');
            const widthScale = asset.proportions?.width ?? 1;
            const lengthScale = asset.proportions?.length ?? 1;
            const renderWidth = hostWidth * widthScale;
            const renderLength = hostLength * lengthScale;

            const localOffset = asset.offset ?? {};
            const normalizedOffset = asset.normalized_offset ?? {};
            const offsetX = (localOffset.x ?? 0) + (normalizedOffset.x ?? 0) * hostWidth;
            const offsetY = (localOffset.y ?? 0) + (normalizedOffset.y ?? 0) * hostLength;
            const offsetRotation = localOffset.rotation ?? 0;
            const anchorAttach = asset.anchor_attach ?? (shouldAttachToTip(asset.anchor_point) ? 'tip' : 'root');
            const anchorY = anchorAttach === 'tip' ? hostLength : 0;

            const visualLogic = asset.visual_logic ?? 'fill_visible';
            const isWireframe = visualLogic === 'wireframe';
            const maskMode = asset.mode ?? 'project';
            const assetMaskTransform = isWireframe
                ? undefined
                : { x: 0, y: 0, rotation: 0, scale: 1, mode: maskMode } as MaskTransform;
            const texture = isWireframe ? undefined : asset.texture;

            return (
                <g
                    key={`hardcoded-${assetKey}`}
                    transform={`translate(${hostTransform.position.x}, ${hostTransform.position.y}) rotate(${hostTransform.rotation}) translate(0, ${anchorY}) translate(${offsetX}, ${offsetY}) rotate(${offsetRotation})`}
                    opacity={Math.max(0, Math.min(1, asset.alpha ?? 1))}
                >
                    <Bone
                        rotation={0}
                        length={renderLength}
                        width={renderWidth}
                        variant={hostDefinition.variant}
                        proportionKey={hostKey}
                        drawsUpwards={hostDefinition.drawsUpwards}
                        showPivots={false}
                        showLabel={false}
                        colorClass={isWireframe ? 'fill-none' : 'fill-slate-200/80'}
                        isGhost={false}
                        maskImage={texture}
                        maskTransform={assetMaskTransform}
                        disableBaseFill={visualLogic === 'mask_only'}
                        strokeWidthOverride={1.5}
                        visualAnchors={asset.visual_anchors}
                        textureViewBox={asset.texture_viewbox}
                        anchorFitEnabled={anchorFitEnabled}
                    />
                </g>
            );
        });
    };

    return (
        <g style={isGhost ? { opacity: ghostOpacity, pointerEvents: 'none' } : {}}>
            {renderHardcodedAssets('bottom')}
            {!isSkeletonOnly && renderOrder.map(partKey => {
                const p = partDefinitions[partKey];
                const t = calculations.transforms[partKey];
                if (!p || !t) return null;
                const transform = maskTransforms?.[partKey];
                if (transform?.mode === 'hidden') return null;
                const isClearMaterialMode = materialMode === 'clear';
                
                const textureSource = partTextures?.[partKey] || maskImage;
                const customPath = partCustomPaths?.[partKey];
                const rawOffset = partOffsets?.[partKey];
                const offset = { x: rawOffset?.x ?? 0, y: rawOffset?.y ?? 0, rotation: rawOffset?.rotation ?? 0 };
                const scale = partScales?.[partKey] ?? 1;
                const hasTexture = !!textureSource;
                const anchors = visualAnchorOverrides?.[partKey] ?? DEFAULT_VISUAL_ANCHORS[partKey];
                const textureViewBox = textureViewBoxOverrides?.[partKey] ?? DEFAULT_TEXTURE_VIEWBOXES[partKey];
                const shouldHideLimbBlock = rigVisuals?.hideLimbBlocks && LIMB_PART_KEYS.has(partKey);
                const shouldRenderMaskImages = !isClearMaterialMode;
                const effectiveTexture = (shouldHideLimbBlock || !shouldRenderMaskImages) ? undefined : textureSource;
                const lengthScale = calculations.lengthScaleOverrides?.[partKey] ?? 1;
                const baseLength = getKinematicDimension(p.rawH, baseUnitH, calculations.finalProps, partKey, 'h') * lengthScale;
                const baseWidth = getKinematicDimension(p.rawW, baseUnitH, calculations.finalProps, partKey, 'w');
                const frameScale = Math.max(0.0001, scale);
                const renderLength = baseLength * frameScale;
                const renderWidth = baseWidth * frameScale;
                const maskFilter = partKey === 'head' && headpieceContrastLevel !== 'none'
                    ? `url(#contrast-${headpieceContrastLevel})`
                    : undefined;
                const colorClass = isGhost
                    ? "fill-none"
                    : shouldHideLimbBlock
                      ? "fill-none"
                      : isClearMaterialMode
                        ? "fill-slate-100/70"
                        : (partKey === 'collar' ? 'fill-olive' : 'fill-slate-800');

                const overlayDimension = Math.max(300, Math.max(renderWidth, renderLength) * 2);
                const overlayOffset = -overlayDimension / 2;

                return (
                    <g key={partKey} transform={`translate(${t.position.x}, ${t.position.y}) rotate(${t.rotation})`}>
                        <Bone 
                            rotation={0}
                            length={renderLength}
                            width={renderWidth}
                            variant={p.variant}
                            proportionKey={partKey}
                            drawsUpwards={p.drawsUpwards}
                            label={p.label}
                            boneKey={p.boneKey}
                            showPivots={showPivots && !isGhost}
                            showLabel={showLabels && !isGhost}
                            onAnchorMouseDown={onAnchorMouseDown}
                            onBodyMouseDown={onBodyMouseDown}
                            isBeingDragged={!isGhost && draggingBoneKey === p.boneKey}
                            isSelected={p.boneKey ? selectedBoneKeys.has(p.boneKey) : false}
                            isPausedAndPivotsVisible={true} 
                            colorClass={colorClass}
                            isPinned={!isGhost && activePins.includes(p.boneKey)}
                        isGhost={isGhost}
                        ghostType={ghostType}
                        maskImage={effectiveTexture}
                        maskTransform={(shouldHideLimbBlock || !shouldRenderMaskImages) ? undefined : transform}
                            customPath={customPath}
                            anchorPosition={p.anchorPosition ?? 'end'}
                            visualOffset={offset}
                            visualScale={1}
                            clipToEdge={rigVisuals?.clipToEdge ?? true}
                            forceRenderBase={showPrimitives}
                            showFill={!showPrimitives}
                            disableBaseFill={shouldRenderMaskImages && hasTexture}
                            strokeWidthOverride={shouldRenderMaskImages && hasTexture ? 2.2 : undefined}
                            visualAnchors={anchors}
                            textureViewBox={textureViewBox}
                            anchorFitEnabled={anchorFitEnabled}
                            maskFilter={maskFilter}
                        />
                        {partKey === 'head' && maskImage && (
                            <g
                                transform={`translate(${resolvedMaskOverlayTransform.x}, ${resolvedMaskOverlayTransform.y}) rotate(${resolvedMaskOverlayTransform.rotation}) scale(${resolvedMaskOverlayTransform.scale})`}
                                opacity="0.9"
                            >
                                <image
                                    href={maskImage}
                                    x={overlayOffset}
                                    y={overlayOffset}
                                    width={overlayDimension}
                                    height={overlayDimension}
                                    preserveAspectRatio="xMidYMid meet"
                                    pointerEvents="none"
                                />
                            </g>
                        )}
                    </g>
                );
            })}
            {renderHardcodedAssets('top')}
            {showRig && renderRig()}
        </g>
    );
};
