
import React, { useId, useMemo } from 'react';
// Added WalkingEngineProportions to imports
import { Vector2D, WalkingEnginePivotOffsets, MaskTransform, WalkingEngineProportions, PartVisualAnchors, TextureViewBox } from '../types';

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
  onAnchorMouseDown?: (boneKey: keyof WalkingEnginePivotOffsets, clientX: number, clientY: number, e: React.MouseEvent | React.TouchEvent) => void;
  onBodyMouseDown?: (
    boneKey: keyof WalkingEnginePivotOffsets,
    clientX: number,
    clientY: number,
    e: React.MouseEvent | React.TouchEvent,
    partKey?: keyof WalkingEngineProportions
  ) => void;
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
  visualOffset?: { x: number; y: number; rotation: number };
  visualScale?: number;
  anchorPosition?: 'start' | 'end';
  disableBaseFill?: boolean;
  strokeWidthOverride?: number;
  visualAnchors?: PartVisualAnchors;
  textureViewBox?: TextureViewBox;
  anchorFitEnabled?: boolean;
  maskFilter?: string;
  clipToEdge?: boolean;
  forceRenderBase?: boolean;
  showFill?: boolean;
}

export const COLORS = {
  ANCHOR_RED: "#fb7185", // Bitruvius rose-400
  SELECTION: "#D1D5DB",
  SELECTION_HIGHLIGHT: "#fb7185",
  RIDGE: "#334155", // slate-700
  PIN_HIGHLIGHT: "#a78bfa", // violet-400
  DEFAULT_FILL: "#0f172a", // slate-900
  FOCUS_RING: "#E5E7EB",
  IK_HIGHLIGHT: "#a78bfa",
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
  proportionKey,
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
  visualOffset = { x: 0, y: 0, rotation: 0 },
  visualScale = 1,
  anchorPosition = 'end',
  disableBaseFill = false,
  strokeWidthOverride,
  visualAnchors,
  textureViewBox,
  anchorFitEnabled = true,
  maskFilter,
  clipToEdge = true,
  forceRenderBase = false,
  showFill = true,
}) => {

  const getBonePath = (
    boneLength: number,
    boneWidth: number,
    variant: string,
    drawsUpwards: boolean,
    geometry?: { topWidthRatio: number; bottomWidthRatio: number },
  ): string => {
    const effectiveLength = drawsUpwards ? -boneLength : boneLength;
    const halfWidth = boneWidth / 2;

    switch (variant) {
      case 'head-wedge':
        const topWidthRatio = geometry?.topWidthRatio ?? 0.5;
        const bottomWidthRatio = geometry?.bottomWidthRatio ?? 1.0;
        const topWidth = boneWidth * topWidthRatio;
        const baseWidth = boneWidth * bottomWidthRatio;
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

  const headGeometry = useMemo(() => {
    if (maskTransform?.geometry !== 'tapered') return undefined;
    const topWidthRatio = typeof maskTransform.topWidth === 'number' ? maskTransform.topWidth : 0.5;
    const bottomWidthRatio = typeof maskTransform.bottomWidth === 'number' ? maskTransform.bottomWidth : 1.0;
    return {
      topWidthRatio: Math.max(0, topWidthRatio),
      bottomWidthRatio: Math.max(0, bottomWidthRatio),
    };
  }, [maskTransform?.geometry, maskTransform?.topWidth, maskTransform?.bottomWidth]);

  const clipSeed = useId().replace(/:/g, '');
  const clipId = useMemo(() => `bone-clip-${boneKey ?? 'part'}-${clipSeed}`, [boneKey, clipSeed]);
  const bonePathData = useMemo(() => {
    if (customPath) return customPath;
    return getBonePath(length, width, variant, drawsUpwards, headGeometry);
  }, [length, width, variant, drawsUpwards, customPath, headGeometry]);

  const visualEndPoint = drawsUpwards ? -length : length;
  const transform = (offset.x !== 0 || offset.y !== 0)
    ? `translate(${offset.x}, ${offset.y}) rotate(${rotation})`
    : `rotate(${rotation})`;
  const anchorTransformY = anchorPosition === 'start' ? 0 : visualEndPoint;

  const resolvedAnchors = visualAnchors ?? { parent: { x: 0.5, y: 0.0 }, child: { x: 0.5, y: 1.0 } };
  const resolvedViewBox = textureViewBox ?? { width: 1000, height: 1000 };
  const imageViewBoxX = resolvedViewBox.x ?? 0;
  const imageViewBoxY = resolvedViewBox.y ?? 0;
  const imageViewBoxWidth = Math.max(1, resolvedViewBox.width);
  const imageViewBoxHeight = Math.max(1, resolvedViewBox.height);
  const visualFrameTransform = useMemo(() => {
    const ops: string[] = [];
    if (visualOffset.x !== 0 || visualOffset.y !== 0) ops.push(`translate(${visualOffset.x}, ${visualOffset.y})`);
    if (visualOffset.rotation !== 0) ops.push(`rotate(${visualOffset.rotation})`);
    if (visualScale !== 1) ops.push(`scale(${visualScale})`);
    return ops.join(' ');
  }, [visualOffset.x, visualOffset.y, visualOffset.rotation, visualScale]);
  const manualTransform: MaskTransform = {
    x: maskTransform?.x ?? 0,
    y: maskTransform?.y ?? 0,
    rotation: maskTransform?.rotation ?? 0,
    scale: maskTransform?.scale ?? 1,
    scaleX: maskTransform?.scaleX,
    scaleY: maskTransform?.scaleY,
    mode: maskTransform?.mode ?? 'project',
    geometry: maskTransform?.geometry,
    topWidth: maskTransform?.topWidth,
    bottomWidth: maskTransform?.bottomWidth,
  };
  const postOffsetX = manualTransform.x;
  const postOffsetY = manualTransform.y;
  const postRotation = manualTransform.rotation;
  const postScaleX = Math.max(0.0001, manualTransform.scale * (manualTransform.scaleX ?? 1));
  const postScaleY = Math.max(0.0001, manualTransform.scale * (manualTransform.scaleY ?? 1));

  const imageFitTransform = useMemo(() => {
    if (!anchorFitEnabled) {
      const fallbackScale = Math.abs(visualEndPoint) / imageViewBoxHeight;
      return {
        x: -imageViewBoxWidth / 2,
        y: drawsUpwards ? -Math.abs(visualEndPoint) : 0,
        rotation: 0,
        scale: Math.max(0.0001, fallbackScale),
      };
    }

    const sourceParent = {
      x: imageViewBoxX + resolvedAnchors.parent.x * imageViewBoxWidth,
      y: imageViewBoxY + resolvedAnchors.parent.y * imageViewBoxHeight,
    };
    const sourceChild = {
      x: imageViewBoxX + resolvedAnchors.child.x * imageViewBoxWidth,
      y: imageViewBoxY + resolvedAnchors.child.y * imageViewBoxHeight,
    };

    const sourceVector = {
      x: sourceChild.x - sourceParent.x,
      y: sourceChild.y - sourceParent.y,
    };
    const sourceLength = Math.hypot(sourceVector.x, sourceVector.y);
    const targetVector = { x: 0, y: visualEndPoint };
    const targetLength = Math.max(0.0001, Math.hypot(targetVector.x, targetVector.y));
    const fitScale = sourceLength > 0.0001 ? targetLength / sourceLength : targetLength / imageViewBoxHeight;

    const sourceAngle = Math.atan2(sourceVector.y, sourceVector.x);
    const targetAngle = Math.atan2(targetVector.y, targetVector.x);
    const fitRotation = (targetAngle - sourceAngle) * (180 / Math.PI);

    const rad = fitRotation * (Math.PI / 180);
    const cos = Math.cos(rad);
    const sin = Math.sin(rad);
    const parentX = sourceParent.x * fitScale;
    const parentY = sourceParent.y * fitScale;
    const rotatedParentX = parentX * cos - parentY * sin;
    const rotatedParentY = parentX * sin + parentY * cos;

    return {
      x: -rotatedParentX,
      y: -rotatedParentY,
      rotation: fitRotation,
      scale: fitScale,
    };
  }, [
    anchorFitEnabled,
    drawsUpwards,
    imageViewBoxHeight,
    imageViewBoxX,
    imageViewBoxY,
    imageViewBoxWidth,
    resolvedAnchors.child.x,
    resolvedAnchors.child.y,
    resolvedAnchors.parent.x,
    resolvedAnchors.parent.y,
    visualEndPoint,
  ]);

  const ghostColor = ghostType === 'ik' 
      ? COLORS.GHOST_IK 
      : ghostType === 'fk' 
      ? COLORS.GHOST_FK 
      : COLORS.GHOST_STATIC; 

  const boneStrokeColor = isGhost ? "none" : COLORS.RIDGE;
  const boneStrokeWidth = isGhost ? 0 : (strokeWidthOverride ?? 1.5);
  
  const isProjectMode = manualTransform.mode === 'project';
  const isCoverMode = manualTransform.mode === 'cover';
  const shouldRenderMask = !!maskImage && !isGhost;
  const shouldRenderBase = (forceRenderBase || (!shouldRenderMask || !isProjectMode)) && !isCoverMode && !disableBaseFill && showFill;
  const shouldRenderStroke = !isCoverMode && !shouldRenderMask;
  const shouldClipMask = isCoverMode || (isProjectMode && clipToEdge);

  return (
    <g transform={transform} className={colorClass} style={isSelected && !isGhost ? { filter: `drop-shadow(0 0 8px ${COLORS.SELECTION_HIGHLIGHT})` } : {}}>
      <g transform={visualFrameTransform || undefined}>
        {visible && (
          <>
            <defs>
              <clipPath id={clipId}>
                <path d={bonePathData} />
              </clipPath>
            </defs>

            <g
              onMouseDown={(e) => { if (isPausedAndPivotsVisible && onBodyMouseDown && boneKey) { onBodyMouseDown(boneKey, e.clientX, e.clientY, e, proportionKey); } }}
              onTouchStart={(e) => { if (isPausedAndPivotsVisible && onBodyMouseDown && boneKey) { onBodyMouseDown(boneKey, e.touches[0].clientX, e.touches[0].clientY, e, proportionKey); } }}
              className={isPausedAndPivotsVisible && onBodyMouseDown ? (isBeingDragged ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'}
            >
              {shouldRenderBase && (
                <path
                  d={bonePathData}
                  fill={isGhost ? ghostColor : "currentColor"}
                />
              )}
              {shouldRenderMask ? (
                <g clipPath={shouldClipMask ? `url(#${clipId})` : undefined}>
                  <g transform={`translate(${imageFitTransform.x}, ${imageFitTransform.y}) rotate(${imageFitTransform.rotation}) scale(${imageFitTransform.scale})`}>
                    <g transform={`translate(${postOffsetX}, ${postOffsetY}) rotate(${postRotation}) scale(${postScaleX}, ${postScaleY})`}>
                      <image
                        href={maskImage}
                        x={imageViewBoxX}
                        y={imageViewBoxY}
                        width={imageViewBoxWidth}
                        height={imageViewBoxHeight}
                        preserveAspectRatio="xMidYMid meet"
                        style={maskFilter ? { filter: maskFilter } : undefined}
                      />
                    </g>
                  </g>
                </g>
              ) : null}
            </g>

            {shouldRenderStroke && (
              <path
                d={bonePathData}
                fill="none"
                stroke={boneStrokeColor}
                strokeWidth={boneStrokeWidth}
                paintOrder="stroke"
                className="pointer-events-none"
              />
            )}

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
          <g className="animate-pulse-red" transform={`translate(0, ${anchorTransformY})`}>
            <circle 
              cx="0" cy="0" r={4.5} 
              fill={COLORS.ANCHOR_RED} 
              stroke="#020617"
              strokeWidth="1.5"
              className={isPausedAndPivotsVisible ? (isBeingDragged ? 'cursor-grabbing' : 'cursor-grab') : 'cursor-default'} 
              onMouseDown={(e) => isPausedAndPivotsVisible && onAnchorMouseDown(boneKey, e.clientX, e.clientY, e)}
              onTouchStart={(e) => isPausedAndPivotsVisible && onAnchorMouseDown(boneKey, e.touches[0].clientX, e.touches[0].clientY, e)}
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
    </g>
  );
};
