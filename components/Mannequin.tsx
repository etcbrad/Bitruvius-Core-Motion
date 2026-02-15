
import React, { useMemo, useEffect } from 'react';
import { Bone, COLORS } from './Bone';
import { ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT, RIGGING } from '../constants';
import { WalkingEnginePose, WalkingEngineProportions, WalkingEnginePivotOffsets, Vector2D, MaskTransform, GlobalPositions } from '../types';
import { getScaledDimension as getKinematicDimension } from '../utils/kinematics';

interface MannequinProps {
  pose: WalkingEnginePose;
  pivotOffsets: WalkingEnginePivotOffsets;
  props: WalkingEngineProportions;
  showPivots: boolean;
  showLabels: boolean;
  baseUnitH: number;
  onAnchorMouseDown: (boneKey: keyof WalkingEnginePivotOffsets, clientX: number, e: React.MouseEvent | React.TouchEvent) => void;
  onBodyMouseDown: (boneKey: keyof WalkingEnginePivotOffsets, clientX: number, e: React.MouseEvent | React.TouchEvent) => void;
  draggingBoneKey: keyof WalkingEnginePivotOffsets | null;
  selectedBoneKeys: Set<keyof WalkingEnginePivotOffsets>;
  isPaused: boolean;
  maskImage?: string | null;
  partTextures?: Partial<Record<keyof WalkingEngineProportions, string>>;
  maskTransforms?: Partial<Record<keyof WalkingEngineProportions, MaskTransform>>;
  partCustomPaths?: Partial<Record<keyof WalkingEngineProportions, string>>;
  isGhost?: boolean;
  showRig?: boolean;
  overrideProps?: WalkingEngineProportions;
  onPositionsUpdate?: (positions: GlobalPositions) => void;
  activePins?: (keyof WalkingEnginePivotOffsets)[];
  ghostType?: 'ik' | 'fk' | 'static' | null;
  ghostOpacity?: number;
  partZOrder: Record<keyof WalkingEngineProportions, number>;
}

export const partDefinitions: Record<keyof WalkingEngineProportions, any> = {
    head: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.HEAD, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.HEAD_WIDTH, variant: 'head-wedge', drawsUpwards: true, label: 'Head', boneKey: 'neck' },
    collar: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.COLLAR, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.COLLAR_WIDTH, variant: 'collar-horizontal-oval-shape', drawsUpwards: true, label: 'Collar', boneKey: 'collar' },
    torso: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.TORSO, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.TORSO_WIDTH, variant: 'torso-teardrop-pointy-down', drawsUpwards: true, label: 'Torso', boneKey: 'torso' },
    waist: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.WAIST, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.WAIST_WIDTH, variant: 'waist-teardrop-pointy-up', drawsUpwards: true, label: 'Waist', boneKey: 'waist' },
    r_upper_arm: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.UPPER_ARM, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LIMB_WIDTH_ARM, variant: 'deltoid-shape', label: 'R.Bicep', boneKey: 'r_shoulder' },
    r_lower_arm: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LOWER_ARM, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LIMB_WIDTH_FOREARM, variant: 'limb-tapered', label: 'R.Forearm', boneKey: 'r_elbow' },
    r_hand: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.HAND, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.HAND_WIDTH, variant: 'hand-foot-arrowhead-shape', label: 'R.Hand', boneKey: 'r_hand' },
    l_upper_arm: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.UPPER_ARM, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LIMB_WIDTH_ARM, variant: 'deltoid-shape', label: 'L.Bicep', boneKey: 'l_shoulder' },
    l_lower_arm: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LOWER_ARM, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LIMB_WIDTH_FOREARM, variant: 'limb-tapered', label: 'L.Forearm', boneKey: 'l_elbow' },
    l_hand: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.HAND, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.HAND_WIDTH, variant: 'hand-foot-arrowhead-shape', label: 'L.Hand', boneKey: 'l_hand' },
    r_upper_leg: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_UPPER, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LIMB_WIDTH_THIGH, variant: 'limb-tapered', label: 'R.Thigh', boneKey: 'r_hip' },
    r_lower_leg: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_LOWER, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LIMB_WIDTH_CALF, variant: 'limb-tapered', label: 'R.Calf', boneKey: 'r_knee' },
    r_foot: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.FOOT, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.FOOT_WIDTH, variant: 'foot-block-shape', label: 'R.Foot', boneKey: 'r_foot' },
    r_toe: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.TOE, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.TOE_WIDTH, variant: 'toe-rounded-cap', label: 'R.Toe', boneKey: 'r_toe' },
    l_upper_leg: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_UPPER, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LIMB_WIDTH_THIGH, variant: 'limb-tapered', label: 'L.Thigh', boneKey: 'l_hip' },
    l_lower_leg: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_LOWER, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LIMB_WIDTH_CALF, variant: 'limb-tapered', label: 'L.Calf', boneKey: 'l_knee' },
    l_foot: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.FOOT, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.FOOT_WIDTH, variant: 'foot-block-shape', label: 'L.Foot', boneKey: 'l_foot' },
    l_toe: { rawH: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.TOE, rawW: ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.TOE_WIDTH, variant: 'toe-rounded-cap', label: 'L.Toe', boneKey: 'l_toe' },
};

const rotateVec = (vec: Vector2D, angleDeg: number): Vector2D => {
  const r = angleDeg * Math.PI / 180;
  const c = Math.cos(r);
  const s = Math.sin(r);
  return { x: vec.x * c - vec.y * s, y: vec.y * c + vec.x * s };
};
const addVec = (v1: Vector2D, v2: Vector2D): Vector2D => ({ x: v1.x + v2.x, y: v1.y + v2.y });

export const Mannequin: React.FC<MannequinProps> = ({
  pose, pivotOffsets, props, showPivots, showLabels, baseUnitH,
  onAnchorMouseDown, onBodyMouseDown, draggingBoneKey, selectedBoneKeys, isPaused,
  maskImage, partTextures, maskTransforms, partCustomPaths, isGhost = false, showRig = false, overrideProps, onPositionsUpdate, activePins = [],
  ghostType, ghostOpacity = 0.6, partZOrder
}) => {
    const activeProps = useMemo(() => overrideProps || JSON.parse(JSON.stringify(props)), [props, overrideProps]);
    const renderOrder = useMemo(() => (Object.keys(partZOrder) as (keyof WalkingEngineProportions)[]).sort((a, b) => partZOrder[a] - partZOrder[b]), [partZOrder]);

    const calculations = useMemo(() => {
        const trans: GlobalPositions = {};
        const getRot = (key: keyof WalkingEnginePivotOffsets) => ((pose as any)[key] || 0) + ((pivotOffsets as any)[key] || 0);

        const waistLen = getKinematicDimension(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.WAIST, baseUnitH, activeProps, 'waist', 'h');
        const torsoLen = getKinematicDimension(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.TORSO, baseUnitH, activeProps, 'torso', 'h');
        const collarLen = getKinematicDimension(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.COLLAR, baseUnitH, activeProps, 'collar', 'h');
        
        const waistPos: Vector2D = { x: 0, y: 0 }; 
        const waistRot = getRot('waist');
        trans.waist = { position: waistPos, rotation: waistRot };

        const torsoRot = waistRot + getRot('torso');
        trans.torso = { position: addVec(waistPos, rotateVec({ x: 0, y: -waistLen }, waistRot)), rotation: torsoRot };

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

            const shRot = collarRot + getRot((sidePrefix + 'shoulder') as any); 
            const elRot = shRot + getRot((sidePrefix + 'elbow') as any);
            const wrRot = elRot + getRot((sidePrefix + 'hand') as any);

            trans[upArmKey] = { position: shoulderRootPos, rotation: shRot };
            const elbowPos = addVec(shoulderRootPos, rotateVec({ x: 0, y: upArmLen }, shRot));
            trans[lowArmKey] = { position: elbowPos, rotation: elRot };
            const wristPos = addVec(elbowPos, rotateVec({ x: 0, y: lowArmLen }, elRot));
            trans[handKey] = { position: wristPos, rotation: wrRot };
        });

        ['r', 'l'].forEach(side => {
            const sidePrefix = side === 'r' ? 'r_' : 'l_';
            const upLegKey = (sidePrefix + 'upper_leg') as keyof WalkingEngineProportions;
            const lowLegKey = (sidePrefix + 'lower_leg') as keyof WalkingEngineProportions;
            const footKey = (sidePrefix + 'foot') as keyof WalkingEngineProportions;
            const toeKey = (sidePrefix + 'toe') as keyof WalkingEngineProportions;

            const thighLen = getKinematicDimension(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_UPPER, baseUnitH, activeProps, upLegKey, 'h');
            const calfLen = getKinematicDimension(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.LEG_LOWER, baseUnitH, activeProps, lowLegKey, 'h');
            const footLen = getKinematicDimension(ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT.FOOT, baseUnitH, activeProps, footKey, 'h');
            
            const hiRot = waistRot + getRot((sidePrefix + 'hip') as any); 
            const knRot = hiRot + getRot((sidePrefix + 'knee') as any);
            const anRot = knRot + getRot((sidePrefix + 'foot') as any);
            const toRot = anRot + getRot((sidePrefix + 'toe') as any);

            trans[upLegKey] = { position: waistPos, rotation: hiRot };
            const kneePos = addVec(waistPos, rotateVec({ x: 0, y: thighLen }, hiRot));
            trans[lowLegKey] = { position: kneePos, rotation: knRot };
            const anklePos = addVec(kneePos, rotateVec({ x: 0, y: calfLen }, knRot));
            trans[footKey] = { position: anklePos, rotation: anRot };
            const toePos = addVec(anklePos, rotateVec({ x: 0, y: footLen }, anRot));
            trans[toeKey] = { position: toePos, rotation: toRot };
        });

        return { transforms: trans, finalProps: activeProps };
    }, [pose, pivotOffsets, baseUnitH, activeProps]);

    useEffect(() => { onPositionsUpdate?.(calculations.transforms); }, [calculations.transforms, onPositionsUpdate]);

    // Helper to safely render the structural rig by checking for undefined transformations.
    const renderRig = () => {
        const t = calculations.transforms;
        const getPos = (key: keyof WalkingEngineProportions): Vector2D => t[key]?.position || { x: 0, y: 0 };

        const rigLines = [
            // Spine
            { p1: getPos('waist'), p2: getPos('torso') },
            { p1: getPos('torso'), p2: getPos('collar') },
            { p1: getPos('collar'), p2: getPos('head') },
            // Shoulders
            { p1: getPos('collar'), p2: getPos('l_upper_arm') },
            { p1: getPos('collar'), p2: getPos('r_upper_arm') },
            // L Arm
            { p1: getPos('l_upper_arm'), p2: getPos('l_lower_arm') },
            { p1: getPos('l_lower_arm'), p2: getPos('l_hand') },
            // R Arm
            { p1: getPos('r_upper_arm'), p2: getPos('r_lower_arm') },
            { p1: getPos('r_lower_arm'), p2: getPos('r_hand') },
            // L Leg
            { p1: getPos('waist'), p2: getPos('l_lower_leg') },
            { p1: getPos('l_lower_leg'), p2: getPos('l_foot') },
            { p1: getPos('l_foot'), p2: getPos('l_toe') },
            // R Leg
            { p1: getPos('waist'), p2: getPos('r_lower_leg') },
            { p1: getPos('r_lower_leg'), p2: getPos('r_foot') },
            { p1: getPos('r_foot'), p2: getPos('r_toe') },
        ];

        return (
            <g opacity="0.4" pointerEvents="none">
                {rigLines.map((l, i) => (
                    <line key={i} x1={l.p1.x} y1={l.p1.y} x2={l.p2.x} y2={l.p2.y} stroke="#94a3b8" strokeWidth="4" strokeLinecap="round" />
                ))}
                {Object.values(t).map((tp: any, i) => {
                    // Added safety check for tp and position
                    if (!tp?.position) return null;
                    return (
                        <circle key={i} cx={tp.position.x} cy={tp.position.y} r="3" fill="#38bdf8" />
                    );
                })}
            </g>
        );
    };

    return (
        <g style={isGhost ? { opacity: ghostOpacity, pointerEvents: 'none' } : {}}>
            {showRig && renderRig()}
            {renderOrder.map(partKey => {
                const p = partDefinitions[partKey];
                const t = calculations.transforms[partKey];
                if (!p || !t) return null;
                const transform = maskTransforms?.[partKey];
                const texture = partTextures?.[partKey] || maskImage;
                const customPath = partCustomPaths?.[partKey];
                
                return (
                    <g key={partKey} transform={`translate(${t.position.x}, ${t.position.y}) rotate(${t.rotation})`}>
                        <Bone 
                            rotation={0}
                            length={getKinematicDimension(p.rawH, baseUnitH, calculations.finalProps, partKey, 'h')}
                            width={getKinematicDimension(p.rawW, baseUnitH, calculations.finalProps, partKey, 'w')}
                            variant={p.variant}
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
                            colorClass={isGhost ? "fill-none" : (partKey === 'collar' ? 'fill-olive' : 'fill-slate-800')}
                            isPinned={!isGhost && activePins.includes(p.boneKey)}
                            isGhost={isGhost}
                            ghostType={ghostType}
                            maskImage={texture}
                            maskTransform={transform}
                            customPath={customPath}
                        />
                    </g>
                );
            })}
        </g>
    );
};
