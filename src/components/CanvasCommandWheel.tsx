import React, { useCallback, useEffect, useMemo, useRef } from "react";

export type CanvasWheelLayers = 1 | 2 | 3;
export type CanvasWheelAxisLock = "xy" | "x" | "y";
export type CanvasWheelPrecision = "coarse" | "fine";
export type CanvasWheelControlMode = "rotate" | "xy" | "scalar";

export type CanvasWheelSegment = {
  id: string;
  label: string;
  active?: boolean;
  disabled?: boolean;
};

type CanvasCommandWheelProps = {
  title: string;
  subtitle: string;
  layers: CanvasWheelLayers;
  axisLock: CanvasWheelAxisLock;
  precision: CanvasWheelPrecision;
  controlMode: CanvasWheelControlMode;
  rotationDeg: number;
  x: number;
  y: number;
  scalarValue?: number;
  scalarMin?: number;
  scalarMax?: number;
  disabled?: boolean;
  primarySegments: CanvasWheelSegment[];
  tertiarySegments?: CanvasWheelSegment[];
  onSelectPrimary: (id: string) => void;
  onSelectTertiary?: (id: string) => void;
  onCycleAxisLock: () => void;
  onTogglePrecision: () => void;
  onRotateDelta: (deltaDeg: number) => void;
  onRotateDragStart?: () => void;
  onRotateDragEnd?: () => void;
  onXChange: (nextX: number) => void;
  onYChange: (nextY: number) => void;
  onScalarChange?: (nextValue: number) => void;
  onReset?: () => void;
  onNudge?: (direction: "forward" | "back") => void;
};

type DragState =
  | { kind: "rotate"; pointerId: number; lastAngle: number }
  | { kind: "xy"; pointerId: number; startPointerX: number; startPointerY: number; startX: number; startY: number }
  | { kind: "scalar"; pointerId: number; startPointerY: number; startValue: number };

const clamp = (value: number, min: number, max: number): number => {
  if (!Number.isFinite(value)) {
    return min;
  }
  return Math.min(max, Math.max(min, value));
};

const angleBetween = (clientX: number, clientY: number, rect: DOMRect): number => {
  const centerX = rect.left + rect.width * 0.5;
  const centerY = rect.top + rect.height * 0.5;
  return (Math.atan2(clientY - centerY, clientX - centerX) * 180) / Math.PI;
};

const segmentPosition = (index: number, count: number, radius: number): { left: number; top: number } => {
  const safeCount = Math.max(1, count);
  const angleDeg = -90 + (360 / safeCount) * index;
  const angleRad = (angleDeg * Math.PI) / 180;
  return {
    left: 50 + Math.cos(angleRad) * radius,
    top: 50 + Math.sin(angleRad) * radius,
  };
};

export const CanvasCommandWheel: React.FC<CanvasCommandWheelProps> = ({
  title,
  subtitle,
  layers,
  axisLock,
  precision,
  controlMode,
  rotationDeg,
  x,
  y,
  scalarValue,
  scalarMin = 0,
  scalarMax = 1,
  disabled = false,
  primarySegments,
  tertiarySegments,
  onSelectPrimary,
  onSelectTertiary,
  onCycleAxisLock,
  onTogglePrecision,
  onRotateDelta,
  onRotateDragStart,
  onRotateDragEnd,
  onXChange,
  onYChange,
  onScalarChange,
  onReset,
  onNudge,
}) => {
  const controlRef = useRef<HTMLDivElement | null>(null);
  const dragRef = useRef<DragState | null>(null);
  const dragMoveListenerRef = useRef<((event: PointerEvent) => void) | null>(null);
  const dragEndListenerRef = useRef<((event?: PointerEvent) => void) | null>(null);

  const clearDragListeners = useCallback(() => {
    const moveListener = dragMoveListenerRef.current;
    if (moveListener) {
      window.removeEventListener("pointermove", moveListener);
      dragMoveListenerRef.current = null;
    }
    const endListener = dragEndListenerRef.current;
    if (endListener) {
      window.removeEventListener("pointerup", endListener);
      window.removeEventListener("pointercancel", endListener);
      window.removeEventListener("blur", endListener);
      dragEndListenerRef.current = null;
    }
  }, []);

  const endDrag = useCallback(() => {
    const wasRotate = dragRef.current?.kind === "rotate";
    dragRef.current = null;
    if (wasRotate) {
      onRotateDragEnd?.();
    }
    clearDragListeners();
  }, [clearDragListeners, onRotateDragEnd]);

  useEffect(
    () => () => {
      endDrag();
    },
    [endDrag]
  );

  const normalizedRotation = ((rotationDeg % 360) + 360) % 360;
  const displayValue = useMemo(() => {
    if (controlMode === "rotate") {
      return `Rot ${normalizedRotation.toFixed(1)} deg`;
    }
    if (controlMode === "scalar") {
      const safeValue = Number.isFinite(scalarValue ?? Number.NaN) ? (scalarValue as number) : scalarMin;
      return `Value ${safeValue.toFixed(2)}`;
    }
    return `X ${x.toFixed(0)}  Y ${y.toFixed(0)}`;
  }, [controlMode, normalizedRotation, scalarMin, scalarValue, x, y]);

  const startControlDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || !controlRef.current) {
      return;
    }
    if (controlMode === "scalar" && !onScalarChange) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    clearDragListeners();
    controlRef.current.setPointerCapture?.(event.pointerId);

    const rect = controlRef.current.getBoundingClientRect();
    if (controlMode === "rotate") {
      onRotateDragStart?.();
      dragRef.current = {
        kind: "rotate",
        pointerId: event.pointerId,
        lastAngle: angleBetween(event.clientX, event.clientY, rect),
      };
    } else if (controlMode === "xy") {
      dragRef.current = {
        kind: "xy",
        pointerId: event.pointerId,
        startPointerX: event.clientX,
        startPointerY: event.clientY,
        startX: x,
        startY: y,
      };
    } else {
      const startValue = Number.isFinite(scalarValue ?? Number.NaN) ? (scalarValue as number) : scalarMin;
      dragRef.current = {
        kind: "scalar",
        pointerId: event.pointerId,
        startPointerY: event.clientY,
        startValue,
      };
    }

    const handleMove = (moveEvent: PointerEvent) => {
      if (!controlRef.current || !dragRef.current) {
        return;
      }

      const drag = dragRef.current;
      if (moveEvent.pointerId !== drag.pointerId) {
        return;
      }
      const coalesced =
        typeof moveEvent.getCoalescedEvents === "function" ? moveEvent.getCoalescedEvents() : [];
      const sample = coalesced.length ? coalesced[coalesced.length - 1] : moveEvent;
      const sampleClientX = Number.isFinite(sample.clientX) ? sample.clientX : moveEvent.clientX;
      const sampleClientY = Number.isFinite(sample.clientY) ? sample.clientY : moveEvent.clientY;
      if (drag.kind === "rotate") {
        const moveRect = controlRef.current.getBoundingClientRect();
        const nextAngle = angleBetween(sampleClientX, sampleClientY, moveRect);
        let delta = nextAngle - drag.lastAngle;
        if (delta > 180) {
          delta -= 360;
        } else if (delta < -180) {
          delta += 360;
        }
        drag.lastAngle = nextAngle;
        const precisionScale = precision === "fine" ? 0.35 : 1;
        onRotateDelta(delta * precisionScale);
        return;
      }

      if (drag.kind === "xy") {
        const xSensitivity = precision === "fine" ? 0.8 : 2.4;
        const ySensitivity = precision === "fine" ? 0.8 : 2.4;
        const pointerDeltaX = sampleClientX - drag.startPointerX;
        const pointerDeltaY = sampleClientY - drag.startPointerY;
        if (axisLock !== "y") {
          onXChange(drag.startX + pointerDeltaX * xSensitivity);
        }
        if (axisLock !== "x") {
          onYChange(drag.startY - pointerDeltaY * ySensitivity);
        }
        return;
      }

      if (!onScalarChange) {
        return;
      }
      const span = Math.max(1e-6, scalarMax - scalarMin);
      const scalarSensitivity = precision === "fine" ? span / 520 : span / 240;
      const pointerDeltaY = sampleClientY - drag.startPointerY;
      const nextValue = clamp(drag.startValue - pointerDeltaY * scalarSensitivity, scalarMin, scalarMax);
      onScalarChange(nextValue);
    };

    const handlePointerEnd = (endEvent?: PointerEvent) => {
      if (endEvent && dragRef.current && endEvent.pointerId !== dragRef.current.pointerId) {
        return;
      }
      endDrag();
    };

    dragMoveListenerRef.current = handleMove;
    dragEndListenerRef.current = handlePointerEnd;
    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handlePointerEnd);
    window.addEventListener("pointercancel", handlePointerEnd);
    window.addEventListener("blur", handlePointerEnd);
  };

  const renderRingButtons = (
    segments: CanvasWheelSegment[],
    radiusPercent: number,
    onSelect: (id: string) => void,
    sizePx: number
  ) =>
    segments.map((segment, index) => {
      const position = segmentPosition(index, segments.length, radiusPercent);
      return (
        <button
          key={segment.id}
          type="button"
          disabled={disabled || segment.disabled}
          onClick={() => onSelect(segment.id)}
          style={{
            position: "absolute",
            left: `${position.left}%`,
            top: `${position.top}%`,
            transform: "translate(-50%, -50%)",
            width: `${sizePx}px`,
            height: `${sizePx}px`,
            borderRadius: "999px",
            border: `1px solid ${segment.active ? "rgba(255,255,255,0.65)" : "rgba(255,255,255,0.25)"}`,
            background: segment.active ? "rgba(124, 58, 237, 0.58)" : "rgba(31, 41, 55, 0.72)",
            color: "#f9fafb",
            fontSize: "10px",
            lineHeight: 1.1,
            cursor: disabled || segment.disabled ? "not-allowed" : "pointer",
            opacity: disabled || segment.disabled ? 0.45 : 1,
            padding: "4px",
            textAlign: "center",
          }}
          title={segment.label}
        >
          {segment.label}
        </button>
      );
    });

  return (
    <div
      style={{
        width: 260,
        padding: "10px",
        borderRadius: "16px",
        border: "1px solid rgba(255, 255, 255, 0.28)",
        background: "rgba(17, 24, 39, 0.76)",
        color: "#f9fafb",
        backdropFilter: "blur(10px)",
        boxShadow: "0 14px 36px rgba(0, 0, 0, 0.35)",
        pointerEvents: "auto",
        opacity: disabled ? 0.72 : 1,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "baseline",
          gap: "8px",
          marginBottom: "8px",
        }}
      >
        <div style={{ fontSize: "11px", letterSpacing: "0.04em", textTransform: "uppercase", color: "#e5e7eb" }}>
          {title}
        </div>
        <div style={{ fontSize: "10px", color: "#93c5fd", textTransform: "uppercase", letterSpacing: "0.06em" }}>
          {subtitle}
        </div>
      </div>

      <div
        style={{
          position: "relative",
          width: 236,
          height: 236,
          margin: "0 auto",
          borderRadius: "999px",
          border: "1px solid rgba(255,255,255,0.18)",
          background:
            "radial-gradient(circle at center, rgba(15, 23, 42, 0.9) 0%, rgba(15, 23, 42, 0.72) 50%, rgba(15, 23, 42, 0.84) 100%)",
        }}
      >
        {layers >= 2 && renderRingButtons(primarySegments, 44, onSelectPrimary, 54)}

        {layers === 3 && tertiarySegments && tertiarySegments.length > 0 && onSelectTertiary
          ? renderRingButtons(tertiarySegments, 26, onSelectTertiary, 46)
          : null}

          <div
            ref={controlRef}
            onPointerDown={startControlDrag}
            style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: 150,
            height: 150,
            transform: "translate(-50%, -50%)",
            borderRadius: "999px",
            border: "14px solid rgba(20, 184, 166, 0.3)",
            background:
              controlMode === "rotate"
                ? "radial-gradient(circle at center, rgba(88, 28, 135, 0.4) 0%, rgba(30, 41, 59, 0.75) 75%)"
                : controlMode === "scalar"
                  ? "radial-gradient(circle at center, rgba(15, 118, 110, 0.38) 0%, rgba(30, 41, 59, 0.75) 75%)"
                  : "radial-gradient(circle at center, rgba(2, 132, 199, 0.36) 0%, rgba(30, 41, 59, 0.75) 75%)",
            cursor: disabled ? "not-allowed" : "grab",
            touchAction: "none",
            userSelect: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            padding: "14px",
            boxSizing: "border-box",
            }}
            title="Drag to adjust"
          >
          <div>
            <div style={{ fontSize: "10px", color: "#bfdbfe", letterSpacing: "0.05em", textTransform: "uppercase" }}>
              Control
            </div>
            <div style={{ marginTop: "4px", fontSize: "11px", color: "#f8fafc" }}>{displayValue}</div>
            <div style={{ marginTop: "4px", fontSize: "9px", color: "#cbd5e1" }}>
              {controlMode === "rotate"
                ? "Drag around"
                : controlMode === "scalar"
                  ? "Drag up/down"
                  : "Drag freely"}
            </div>
          </div>
        </div>

        <div
          style={{
            position: "absolute",
            right: "12%",
            bottom: "12%",
            display: "flex",
            gap: "6px",
          }}
        >
          {onNudge && (
            <>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onNudge("back");
                }}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  border: "1px solid rgba(255,255,255,0.25)",
                  background: "rgba(59, 130, 246, 0.32)",
                  color: "#f8fafc",
                  fontSize: "12px",
                  cursor: disabled ? "not-allowed" : "pointer",
                }}
                aria-label="Decrease value"
                disabled={disabled}
              >
                −
              </button>
              <button
                type="button"
                onClick={(event) => {
                  event.stopPropagation();
                  onNudge("forward");
                }}
                style={{
                  width: 24,
                  height: 24,
                  borderRadius: "50%",
                  border: "1px solid rgba(255,255,255,0.25)",
                  background: "rgba(34, 197, 94, 0.32)",
                  color: "#f8fafc",
                  fontSize: "12px",
                  cursor: disabled ? "not-allowed" : "pointer",
                }}
                aria-label="Increase value"
                disabled={disabled}
              >
                +
              </button>
            </>
          )}
        </div>

        <div
          onPointerDown={(event) => {
            event.stopPropagation();
          }}
          style={{
            position: "absolute",
            left: "50%",
            top: "50%",
            width: 86,
            height: 86,
            transform: "translate(-50%, -50%)",
            borderRadius: "999px",
            border: "1px solid rgba(255,255,255,0.3)",
            background: "rgba(15, 23, 42, 0.9)",
            display: "grid",
            gridTemplateRows: onReset ? "1fr 1fr 1fr" : "1fr 1fr",
            gap: "4px",
            alignContent: "center",
            justifyItems: "center",
            padding: "8px 6px",
            boxSizing: "border-box",
          }}
        >
          {layers >= 2 && (
            <button
              type="button"
              disabled={disabled}
              onClick={onCycleAxisLock}
              style={{
                width: "100%",
                borderRadius: "999px",
                border: "1px solid rgba(255,255,255,0.25)",
                background: "rgba(55, 65, 81, 0.65)",
                color: "#f8fafc",
                fontSize: "9px",
                cursor: disabled ? "not-allowed" : "pointer",
                padding: "3px 6px",
              }}
              title="Axis lock"
            >
              Axis {axisLock.toUpperCase()}
            </button>
          )}
          <button
            type="button"
            disabled={disabled}
            onClick={onTogglePrecision}
            style={{
              width: "100%",
              borderRadius: "999px",
              border: "1px solid rgba(255,255,255,0.25)",
              background: precision === "fine" ? "rgba(15, 118, 110, 0.65)" : "rgba(55, 65, 81, 0.65)",
              color: "#f8fafc",
              fontSize: "9px",
              cursor: disabled ? "not-allowed" : "pointer",
              padding: "3px 6px",
            }}
            title="Precision"
          >
            {precision === "fine" ? "Fine" : "Coarse"}
          </button>
          {onReset && (
            <button
              type="button"
              disabled={disabled}
              onClick={onReset}
              style={{
                width: "100%",
                borderRadius: "999px",
                border: "1px solid rgba(255,255,255,0.25)",
                background: "rgba(127, 29, 29, 0.62)",
                color: "#f8fafc",
                fontSize: "9px",
                cursor: disabled ? "not-allowed" : "pointer",
                padding: "3px 6px",
              }}
              title="Reset console"
            >
              Reset
            </button>
          )}
        </div>
      </div>
    </div>
  );
};
