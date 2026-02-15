
import React, { useMemo } from 'react';
// Added WalkingEngineProportions to imports
import { Vector2D, WalkingEnginePivotOffsets, MaskTransform, WalkingEngineProportions } from '../types';

export interface BoneProps { 
  rotation: number;
  length: number;
  width?: number;
  variant?: 'diamond' | 'waist-teardrop-pointy-up' | 'torso-teardrop-pointy-down' | 'collar-horizontal-oval-shape' | 'deltoid-shape' | 'limb-tapered' | 'head-wedge' | 'hand-foot-arrowhead-shape' | 'foot-block-shape' | 'toe-rounded-cap';
  showPivots: boolean;
  visible?: boolean;
  offset?: Vector2D;
  children?: React.ReactNode;
  drawsUpwards?: boolean;
  colorClass?: string;
  showLabel?: boolean;
  label?: string;
  boneKey?: keyof WalkingEnginePivotOffsets;
  proportionKey?: keyof WalkingEngineProportions;
  onAnchorMouseDown?: (boneKey: keyof WalkingEnginePivotOffsets, clientX: number, e: React.MouseEvent | React.TouchEvent) => void;
  onBodyMouseDown?: (boneKey: keyof WalkingEnginePivotOffsets, clientX: number, e: React.MouseEvent | React.TouchEvent) => void;
  isBeingDragged?: boolean;
  isPausedAndPivotsVisible?: boolean;
  patternFillId?: string;
  isPinned?: boolean;
  isGhost?: boolean;
  ghostType?: 'ik' | 'fk' | 'static' | null;
  isSelected?: boolean;
  isUnderTension?: boolean;
  maskImage?: string | null;
  maskTransform?: MaskTransform;
  customPath?: string;
}

export const COLORS = {
  ANCHOR_RED: "#fb7185", // Prometheus rose-400
  SELECTION: "#D1D5DB",
  SELECTION_HIGHLIGHT: "#fb7185",
  RIDGE: "#334155", // slate-700
  PIN_HIGHLIGHT: "#38bdf8", // sky-400
  DEFAULT_FILL: "#0f172a", // slate-900
  FOCUS_RING: "#E5E7EB",
  IK_HIGHLIGHT: "#38bdf8",
  GHOST_IK: "#a855f7",
  GHOST_FK: "#a3e635",
  GHOST_STATIC: "#9CA3AF",
};

export const Bone: React.FC<BoneProps> = ({
  rotation,
  length,
  width = 15,
  variant = 'diamond',
  showPivots = true,
  visible = true,
  offset = { x: 0, y: 0 },
  children,
  drawsUpwards = false,
  colorClass = "fill-slate-800",
  showLabel = false,
  label,
  boneKey,
  onAnchorMouseDown,
  onBodyMouseDown,
  isBeingDragged = false,
  isPausedAndPivotsVisible = false,
  isPinned = false,
  isGhost = false,
  ghostType = null,
  isSelected = false,
  maskImage,
  maskTransform,
  customPath,
}) => {

  const getBonePath = (boneLength: number, boneWidth: number, variant: string, drawsUpwards: boolean): string => {
    const effectiveLength = drawsUpwards ? -boneLength : boneLength;
    const halfWidth = boneWidth / 2;

    switch (variant) {
      case 'head-wedge':
        const topWidth = boneWidth * 1.4;
        const baseWidth = boneWidth * 0.4;
        const headEffectiveLength = -boneLength;
        return `M ${-baseWidth / 2},0 L ${baseWidth / 2},0 L ${topWidth / 2},${headEffectiveLength} L ${-topWidth / 2},${headEffectiveLength} Z`;

      case 'collar-horizontal-oval-shape':
        const collarVisHeight = boneLength;
        const collarBaseWidth = boneWidth;
        const collarTopWidth = collarBaseWidth * 0.8; 
        return `M ${collarBaseWidth / 2},0 C ${collarBaseWidth * 0.3},${-collarVisHeight * 0.3} ${collarTopWidth * 0.7},${-collarVisHeight * 0.6} ${collarTopWidth / 2},${-collarVisHeight} L ${-collarTopWidth / 2},${-collarVisHeight} C ${-collarTopWidth * 0.7},${-collarVisHeight * 0.6} ${-collarBaseWidth * 0.3},${-collarVisHeight * 0.3} ${-collarBaseWidth / 2},0 Z`;

      case 'waist-teardrop-pointy-up':
        const wHeight = boneLength;
        const wWidth = boneWidth;
        const wTopWidthRatio = 0.8; 
        return `M ${wWidth / 2},0 L ${wWidth * wTopWidthRatio / 2},${-wHeight} L ${-wWidth * wTopWidthRatio / 2},${-wHeight} L ${-wWidth / 2},0 Z`;

      case 'torso-teardrop-pointy-down':
        const tHeight = boneLength;
        const tWidth = boneWidth;
        const tBaseWidthRatio = 0.8; 
        return `M ${tWidth * tBaseWidthRatio / 2},0 L ${tWidth / 2},${-tHeight} L ${-tWidth / 2},${-tHeight} L ${-tWidth * tBaseWidthRatio / 2},0 Z`;

      case 'deltoid-shape':
        const dHeight = boneLength;
        const shoulderWidth = boneWidth; 
        return `M ${shoulderWidth / 2} 0
                C ${shoulderWidth / 2} ${dHeight * 0.2} ${shoulderWidth * 1.2 / 2} ${dHeight * 0.4} ${shoulderWidth * 1.2 / 2} ${dHeight * 0.7}
                L 0 ${dHeight}
                L ${-shoulderWidth * 1.2 / 2} ${dHeight * 0.7}
                C ${-shoulderWidth * 1.2 / 2} ${dHeight * 0.4} ${-shoulderWidth / 2} ${dHeight * 0.2} ${-shoulderWidth / 2} 0 Z`;

      case 'limb-tapered':
        const taperedWidth = boneWidth;
        const taperedEndWidth = taperedWidth * 0.75;
        return `M ${taperedWidth / 2},0 L ${taperedEndWidth / 2},${effectiveLength} L ${-taperedEndWidth / 2},${effectiveLength} L ${-taperedWidth / 2},0 Z`;
      
      case 'foot-block-shape':
        const footBaseW = boneWidth;
        const footEndW = boneWidth * 1.6;
        return `M ${footBaseW / 2},0 L ${footEndW / 2},${effectiveLength} L ${-footEndW / 2},${effectiveLength} L ${-footBaseW / 2},0 Z`;

      case 'toe-rounded-cap':
        const toeBaseW = boneWidth * 1.6;
        return `M ${toeBaseW / 2},0 L 0,${effectiveLength} L ${-toeBaseW / 2},0 Z`;

      case 'hand-foot-arrowhead-shape':
        const handFootWidth = boneWidth;
        const basePointX = handFootWidth * 0.3; 
        return `M ${-basePointX},0 L ${basePointX},0 L 0,${effectiveLength} Z`;

      default:
        const defaultWidth = boneWidth;
        const split = effectiveLength * 0.4;
        return `M 0 0 L ${defaultWidth / 2} ${split} L 0 ${effectiveLength} L ${-defaultWidth / 2} ${split} Z`;
    }
  };

  const clipId = useMemo(() => `bone-clip-${boneKey || Math.random()}`, [boneKey]);
  const bonePathData = useMemo(() => {
    if (customPath) return customPath;
    return getBonePath(length, width, variant, drawsUpwards);
  }, [length, width, variant, drawsUpwards, customPath]);

  const visualEndPoint = drawsUpwards ? -length : length;
  const transform = (offset.x !== 0 || offset.y !== 0)
    ? `translate(${offset.x}, ${offset.y}) rotate(${rotation})`
    : `rotate(${rotation})`;

  const ghostColor = ghostType === 'ik' 
      ? COLORS.GHOST_IK 
      : ghostType === 'fk' 
      ? COLORS.GHOST_FK 
      : COLORS.GHOST_STATIC; 

  const boneStrokeColor = isGhost ? "none" : COLORS.RIDGE;
  const boneStrokeWidth = isGhost ? 0 : 1.5;
  
  const isProjectMode = maskTransform?.mode === 'project';
  const groupClipPath = maskImage && maskTransform && isProjectMode ? `url(#${clipId})` : undefined;

  return (
    <g transform={transform} className={colorClass} style={isSelected && !isGhost ? { filter: `drop-shadow(0 0 8px ${COLORS.SELECTION_HIGHLIGHT})` } : {}}>
       {visible && (
        <>
          <defs>
            <clipPath id={clipId}>
              <path d={bonePathData} />
            </clipPath>
          </defs>

          <g 
            clipPath={groupClipPath}
            onMouseDown={(e) => { if (isPausedAndPivotsVisible && onBodyMouseDown && boneKey) { onBodyMouseDown(boneKey, e.clientX, e); } }}
            onTouchStart={(e) => { if (isPausedAndPivotsVisible && onBodyMouseDown && boneKey) { onBodyMouseDown(boneKey, e.touches[0].clientX, e); } }}
            className={isPausedAndPivotsVisible && onBodyMouseDown ? (isBeingDragged ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'}
           >
            {(!maskImage || !isProjectMode) && (
              <path
                d={bonePathData}
                fill={isGhost ? ghostColor : "currentColor"}
              />
            )}
            {maskImage && maskTransform && !isGhost ? (
              <image
                href={maskImage}
                transform={`translate(${maskTransform.x}, ${ (drawsUpwards ? -length/2 : length/2) + maskTransform.y}) rotate(${maskTransform.rotation}) scale(${maskTransform.scale})`}
                x="-100" y="-100" width="200" height="200"
                preserveAspectRatio="xMidYMid slice"
              />
            ) : null}
          </g>

          <path
            d={bonePathData}
            fill="none"
            stroke={boneStrokeColor}
            strokeWidth={boneStrokeWidth}
            paintOrder="stroke"
            className="pointer-events-none"
          />

          {showLabel && label && (
            <text x={width / 2 + 8} y={visualEndPoint / 2} 
                  className="fill-slate-500 text-[8px] font-mono select-none opacity-60 tracking-tighter uppercase pointer-events-none">
              {label}
            </text>
          )}
        </>
      )}

      <g transform={`translate(0, ${visualEndPoint})`}>{children}</g>

      {showPivots && !isGhost && visible && boneKey && onAnchorMouseDown && (
        <g className="animate-pulse-red">
          <circle 
            cx="0" cy="0" r={4.5} 
            fill={COLORS.ANCHOR_RED} 
            stroke="#020617"
            strokeWidth="1.5"
            className={isPausedAndPivotsVisible ? (isBeingDragged ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'} 
            onMouseDown={(e) => isPausedAndPivotsVisible && onAnchorMouseDown(boneKey, e.clientX, e)}
            onTouchStart={(e) => isPausedAndPivotsVisible && onAnchorMouseDown(boneKey, e.touches[0].clientX, e)}
          />
          {isPinned && (
              <circle
                  cx="0" cy="0" r={9}
                  fill="none"
                  stroke={COLORS.PIN_HIGHLIGHT}
                  strokeWidth="2"
                  style={{ filter: `drop-shadow(0 0 5px ${COLORS.PIN_HIGHLIGHT})`}}
              />
          )}
        </g>
      )}
    </g>
  );
};
