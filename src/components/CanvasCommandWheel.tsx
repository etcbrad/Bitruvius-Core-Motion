import React, { useRef } from "react";

export type CanvasWheelDensity = "minimal" | "standard" | "full";

type CanvasCommandWheelProps = {
  mode: "FK" | "IK";
  selectedJointLabel: string;
  rotationDeg: number;
  x: number;
  y: number;
  mirrorEnabled: boolean;
  density: CanvasWheelDensity;
  disabled?: boolean;
  modeToggleEnabled?: boolean;
  onRotateDelta: (deltaDeg: number) => void;
  onRotationChange: (nextDeg: number) => void;
  onXChange: (nextX: number) => void;
  onYChange: (nextY: number) => void;
  onToggleMode: () => void;
  onToggleMirror: () => void;
  onCyclePin: () => void;
  onClearIkTarget: () => void;
  onCycleDensity: () => void;
};

const clampSlider = (value: number): number => {
  if (!Number.isFinite(value)) {
    return 0;
  }
  return Math.max(-2000, Math.min(2000, value));
};

const RING_DELTA_SMOOTHING_ALPHA = 0.42;
const RING_DELTA_DEADBAND_DEG = 0.06;

const angleBetween = (clientX: number, clientY: number, rect: DOMRect): number => {
  const centerX = rect.left + rect.width * 0.5;
  const centerY = rect.top + rect.height * 0.5;
  return (Math.atan2(clientY - centerY, clientX - centerX) * 180) / Math.PI;
};

export const CanvasCommandWheel: React.FC<CanvasCommandWheelProps> = ({
  mode,
  selectedJointLabel,
  rotationDeg,
  x,
  y,
  mirrorEnabled,
  density,
  disabled = false,
  modeToggleEnabled = true,
  onRotateDelta,
  onRotationChange,
  onXChange,
  onYChange,
  onToggleMode,
  onToggleMirror,
  onCyclePin,
  onClearIkTarget,
  onCycleDensity,
}) => {
  const ringRef = useRef<HTMLDivElement | null>(null);
  const lastAngleRef = useRef<number | null>(null);
  const smoothedDeltaRef = useRef(0);
  const normalizedRotation = ((rotationDeg % 360) + 360) % 360;

  const startRingDrag = (event: React.PointerEvent<HTMLDivElement>) => {
    if (disabled || !ringRef.current) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    const rect = ringRef.current.getBoundingClientRect();
    lastAngleRef.current = angleBetween(event.clientX, event.clientY, rect);
    smoothedDeltaRef.current = 0;

    const handleMove = (moveEvent: PointerEvent) => {
      if (!ringRef.current || lastAngleRef.current === null) {
        return;
      }
      const moveRect = ringRef.current.getBoundingClientRect();
      const nextAngle = angleBetween(moveEvent.clientX, moveEvent.clientY, moveRect);
      let delta = nextAngle - lastAngleRef.current;
      if (delta > 180) {
        delta -= 360;
      } else if (delta < -180) {
        delta += 360;
      }
      const smoothedDelta =
        smoothedDeltaRef.current + (delta - smoothedDeltaRef.current) * RING_DELTA_SMOOTHING_ALPHA;
      smoothedDeltaRef.current = smoothedDelta;
      if (Math.abs(smoothedDelta) > RING_DELTA_DEADBAND_DEG) {
        onRotateDelta(smoothedDelta);
      }
      lastAngleRef.current = nextAngle;
    };

    const handleUp = () => {
      lastAngleRef.current = null;
      smoothedDeltaRef.current = 0;
      window.removeEventListener("pointermove", handleMove);
      window.removeEventListener("pointerup", handleUp);
    };

    window.addEventListener("pointermove", handleMove);
    window.addEventListener("pointerup", handleUp);
  };

  const showExtended = density !== "minimal";
  const showFull = density === "full";

  return (
    <div
      style={{
        width: 220,
        padding: "10px",
        borderRadius: "14px",
        border: "1px solid rgba(255, 255, 255, 0.28)",
        background: "rgba(17, 24, 39, 0.74)",
        color: "#f9fafb",
        backdropFilter: "blur(10px)",
        boxShadow: "0 12px 30px rgba(0, 0, 0, 0.3)",
        pointerEvents: "auto",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          fontSize: "10px",
          letterSpacing: "0.07em",
          textTransform: "uppercase",
          color: "#d1d5db",
          marginBottom: "8px",
        }}
      >
        <span>{selectedJointLabel}</span>
        <span>{mode}</span>
      </div>

      <div
        ref={ringRef}
        onPointerDown={startRingDrag}
        style={{
          position: "relative",
          width: 180,
          height: 180,
          margin: "0 auto",
          borderRadius: "999px",
          border: "18px solid rgba(236, 253, 245, 0.28)",
          background:
            "radial-gradient(circle at center, rgba(17, 24, 39, 0.92) 0%, rgba(17, 24, 39, 0.78) 55%, rgba(17, 24, 39, 0.88) 100%)",
          cursor: disabled ? "not-allowed" : "grab",
          touchAction: "none",
          userSelect: "none",
        }}
      >
        <div
          style={{
            position: "absolute",
            top: "50%",
            left: "50%",
            width: 84,
            transform: "translate(-50%, -50%)",
            display: "grid",
            gap: "7px",
          }}
        >
          <input
            type="range"
            min={-2000}
            max={2000}
            step={1}
            value={clampSlider(x)}
            onChange={(event) => onXChange(Number(event.target.value))}
            disabled={disabled}
            style={{ width: "100%", accentColor: "#a78bfa" }}
            aria-label="X axis"
          />
          <input
            className="slider-vertical"
            type="range"
            min={-2000}
            max={2000}
            step={1}
            value={clampSlider(y)}
            onChange={(event) => onYChange(Number(event.target.value))}
            disabled={disabled}
            style={{ width: "100%", height: 54, accentColor: "#14b8a6" }}
            aria-label="Y axis"
          />
        </div>
        <div
          style={{
            position: "absolute",
            bottom: 8,
            left: "50%",
            transform: "translateX(-50%)",
            fontSize: "9px",
            color: "#d1d5db",
          }}
        >
          Rot {rotationDeg.toFixed(1)}
        </div>
      </div>

      <div style={{ marginTop: "8px", fontSize: "10px", color: "#d1d5db" }}>
        Rotation {mode === "FK" ? "" : "(FK only)"}
      </div>
      <input
        type="range"
        min={0}
        max={361}
        step={1}
        value={normalizedRotation}
        onChange={(event) => onRotationChange(Number(event.target.value))}
        disabled={disabled || mode !== "FK"}
        style={{
          width: "100%",
          marginTop: "4px",
          accentColor: "#a78bfa",
          cursor: disabled || mode !== "FK" ? "not-allowed" : "pointer",
        }}
        aria-label="Rotation"
      />

	      {showExtended && (
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px", marginTop: "10px" }}>
          <button
            type="button"
            onClick={onToggleMode}
            disabled={disabled || !modeToggleEnabled}
            style={{
              padding: "6px 8px",
              borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.2)",
              background: modeToggleEnabled ? "rgba(124, 58, 237, 0.28)" : "rgba(55, 65, 81, 0.36)",
              color: "#f9fafb",
              fontSize: "10px",
              cursor: disabled || !modeToggleEnabled ? "not-allowed" : "pointer",
            }}
          >
            {modeToggleEnabled ? "Mode" : "FK Lock"}
          </button>
          <button
            type="button"
            onClick={onToggleMirror}
            disabled={disabled}
            style={{
              padding: "6px 8px",
              borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.2)",
              background: mirrorEnabled ? "rgba(20, 184, 166, 0.32)" : "rgba(55, 65, 81, 0.5)",
              color: "#f9fafb",
              fontSize: "10px",
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            Mirror
          </button>
          <button
            type="button"
            onClick={onCyclePin}
            disabled={disabled}
            style={{
              padding: "6px 8px",
              borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.2)",
              background: "rgba(15, 118, 110, 0.35)",
              color: "#f9fafb",
              fontSize: "10px",
              cursor: disabled ? "not-allowed" : "pointer",
            }}
          >
            Pin
          </button>
          <button
            type="button"
            onClick={onClearIkTarget}
            disabled={disabled || mode !== "IK"}
            style={{
              padding: "6px 8px",
              borderRadius: "8px",
              border: "1px solid rgba(255,255,255,0.2)",
              background: mode === "IK" ? "rgba(127, 29, 29, 0.42)" : "rgba(55, 65, 81, 0.36)",
              color: "#f9fafb",
              fontSize: "10px",
              cursor: disabled || mode !== "IK" ? "not-allowed" : "pointer",
            }}
          >
            Clear IK
          </button>
        </div>
      )}

      {showFull && (
        <button
          type="button"
          onClick={onCycleDensity}
          disabled={disabled}
          style={{
            marginTop: "8px",
            width: "100%",
            padding: "6px 8px",
            borderRadius: "8px",
            border: "1px solid rgba(255,255,255,0.2)",
            background: "rgba(17, 24, 39, 0.45)",
            color: "#e5e7eb",
            fontSize: "10px",
            cursor: disabled ? "not-allowed" : "pointer",
          }}
        >
          Density: {density}
        </button>
      )}
    </div>
  );
};
