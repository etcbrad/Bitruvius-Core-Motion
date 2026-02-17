import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { normalizeSignedAngleDeg } from "../rig-core/graph";
import { fromRigSnapshotV2, toRigSnapshotV2, type RigSnapshotV2 } from "../rig-core/serialize";
import {
  JOINT_IDS,
  type IkPoleTarget,
  type IkTarget,
  type JointId,
  type JointState,
  type PinConstraint,
  type RigState,
  type SvgOverlay,
} from "../rig-core/types";
import type { RigAdapter } from "./useRigAdapter";

type AnimationPanelProps = {
  rig: RigAdapter;
  active: boolean;
};

type AnimationKeyframe = {
  id: string;
  name: string;
  snapshot: RigSnapshotV2;
  durationToNextMs: number;
};

type SegmentResolution = {
  fromIndex: number;
  toIndex: number;
  localT: number;
};

const DEFAULT_SEGMENT_DURATION_MS = 400;
const MIN_SEGMENT_DURATION_MS = 40;
const MAX_SEGMENT_DURATION_MS = 10_000;
const DEFAULT_TIMELINE_FPS = 24;
const MIN_TIMELINE_FPS = 1;
const MAX_TIMELINE_FPS = 120;
const DEFAULT_TARGET_FPS = 60;
const MAX_TARGET_FPS = 60;
const MIN_AUTO_TWEEN_FRAMES = 2;
const MAX_AUTO_TWEEN_FRAMES = 48;
const DEFAULT_AUTO_TWEEN_FRAMES = 24;
const DEFAULT_INTERPOLATION = 0.65;

const createKeyframeId = (): string =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `anim-kf-${Date.now()}-${Math.random().toString(16).slice(2)}`;

const clampDurationMs = (value: number): number => {
  if (!Number.isFinite(value)) {
    return DEFAULT_SEGMENT_DURATION_MS;
  }
  return Math.max(MIN_SEGMENT_DURATION_MS, Math.min(MAX_SEGMENT_DURATION_MS, Math.round(value)));
};

const clampFps = (value: number): number => {
  if (!Number.isFinite(value)) {
    return DEFAULT_TIMELINE_FPS;
  }
  return Math.max(MIN_TIMELINE_FPS, Math.min(MAX_TIMELINE_FPS, Math.round(value)));
};

const clampTargetFps = (value: number): number => {
  if (!Number.isFinite(value)) {
    return DEFAULT_TARGET_FPS;
  }
  return Math.max(1, Math.min(MAX_TARGET_FPS, Math.round(value)));
};

const clampTweenFrames = (value: number): number => {
  if (!Number.isFinite(value)) {
    return DEFAULT_AUTO_TWEEN_FRAMES;
  }
  return Math.max(MIN_AUTO_TWEEN_FRAMES, Math.min(MAX_AUTO_TWEEN_FRAMES, Math.round(value)));
};

const clampInterpolation = (value: number): number => {
  if (!Number.isFinite(value)) {
    return DEFAULT_INTERPOLATION;
  }
  return Math.max(0, Math.min(1, value));
};

const modulo = (value: number, divisor: number): number => ((value % divisor) + divisor) % divisor;

const lerp = (start: number, end: number, t: number): number => start + (end - start) * t;

const lerpAngleShortestPath = (startDeg: number, endDeg: number, t: number): number =>
  startDeg + normalizeSignedAngleDeg(endDeg - startDeg) * t;

const easeInOutCubic = (t: number): number => {
  if (t <= 0) {
    return 0;
  }
  if (t >= 1) {
    return 1;
  }
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
};

const clonePin = (pin: PinConstraint): PinConstraint =>
  pin.kind === "world" ? { ...pin } : { ...pin };

const cloneOverlay = (overlay: SvgOverlay): SvgOverlay => ({
  ...overlay,
  offset: { ...overlay.offset },
  childOffset: { ...overlay.childOffset },
});

const cloneRigState = (state: RigState): RigState => {
  const joints = {} as Record<JointId, JointState>;
  const ikTargets = {} as Record<JointId, IkTarget | undefined>;
  const ikPoleTargets = {} as Record<JointId, IkPoleTarget | undefined>;

  for (const jointId of JOINT_IDS) {
    const joint = state.joints[jointId];
    joints[jointId] = {
      ...joint,
      localTranslation: { ...joint.localTranslation },
    };

    const target = state.ikTargets[jointId];
    ikTargets[jointId] = target ? { ...target } : undefined;

    const poleTarget = state.ikPoleTargets[jointId];
    ikPoleTargets[jointId] = poleTarget ? { ...poleTarget } : undefined;
  }

  return {
    mode: state.mode,
    ikSolveMode: state.ikSolveMode,
    ikStretchEnabled: state.ikStretchEnabled,
    constraintSettings: { ...state.constraintSettings },
    joints,
    pins: state.pins.map(clonePin),
    ikTargets,
    ikPoleTargets,
    selectedJointId: state.selectedJointId,
    overlays: state.overlays.map(cloneOverlay),
  };
};

const interpolateRigState = (start: RigState, end: RigState, rawT: number): RigState => {
  const t = Math.max(0, Math.min(1, rawT));
  const next = cloneRigState(start);
  next.mode = "FK";

  for (const jointId of JOINT_IDS) {
    const startJoint = start.joints[jointId];
    const endJoint = end.joints[jointId];
    next.joints[jointId] = {
      ...startJoint,
      localRotationDegRaw: lerpAngleShortestPath(
        startJoint.localRotationDegRaw,
        endJoint.localRotationDegRaw,
        t
      ),
      localTranslation: {
        x: lerp(startJoint.localTranslation.x, endJoint.localTranslation.x, t),
        y: lerp(startJoint.localTranslation.y, endJoint.localTranslation.y, t),
      },
    };
  }

  next.selectedJointId = end.selectedJointId ?? start.selectedJointId;
  return next;
};

const getTotalDurationMs = (keyframes: AnimationKeyframe[], loopEnabled: boolean): number => {
  if (keyframes.length < 2) {
    return 0;
  }
  const segmentCount = loopEnabled ? keyframes.length : keyframes.length - 1;
  let total = 0;
  for (let index = 0; index < segmentCount; index += 1) {
    total += clampDurationMs(keyframes[index].durationToNextMs);
  }
  return total;
};

const resolveSegmentAtTime = (
  timeMs: number,
  keyframes: AnimationKeyframe[],
  loopEnabled: boolean,
  totalDurationMs: number
): SegmentResolution | null => {
  if (keyframes.length < 2 || totalDurationMs <= 0) {
    return null;
  }

  const segmentCount = loopEnabled ? keyframes.length : keyframes.length - 1;
  const resolvedTime = loopEnabled
    ? modulo(timeMs, totalDurationMs)
    : Math.max(0, Math.min(totalDurationMs, timeMs));

  let cursor = 0;
  for (let index = 0; index < segmentCount; index += 1) {
    const duration = clampDurationMs(keyframes[index].durationToNextMs);
    const segmentEnd = cursor + duration;
    const isLast = index === segmentCount - 1;
    if (resolvedTime <= segmentEnd || isLast) {
      const local = duration <= 0 ? 1 : Math.max(0, Math.min(1, (resolvedTime - cursor) / duration));
      return {
        fromIndex: index,
        toIndex: index + 1 < keyframes.length ? index + 1 : 0,
        localT: local,
      };
    }
    cursor = segmentEnd;
  }

  return null;
};

const getTimelineOffsetForKeyframe = (
  keyframes: AnimationKeyframe[],
  keyframeIndex: number,
  loopEnabled: boolean
): number => {
  if (keyframes.length < 2 || keyframeIndex <= 0) {
    return 0;
  }
  const nonLoopMax = Math.max(0, keyframes.length - 1);
  const segmentCount = loopEnabled
    ? Math.min(keyframeIndex, keyframes.length)
    : Math.min(keyframeIndex, nonLoopMax);

  let offset = 0;
  for (let index = 0; index < segmentCount; index += 1) {
    offset += clampDurationMs(keyframes[index].durationToNextMs);
  }
  return offset;
};

export const AnimationPanel: React.FC<AnimationPanelProps> = ({ rig, active }) => {
  const [keyframes, setKeyframes] = useState<AnimationKeyframe[]>([]);
  const [selectedKeyframeId, setSelectedKeyframeId] = useState<string | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [loopEnabled, setLoopEnabled] = useState(false);
  const [autoTweenEnabled, setAutoTweenEnabled] = useState(true);
  const [autoTweenFrames, setAutoTweenFrames] = useState(DEFAULT_AUTO_TWEEN_FRAMES);
  const [animationInterpolation, setAnimationInterpolation] = useState(DEFAULT_INTERPOLATION);
  const [timelineFps, setTimelineFps] = useState(DEFAULT_TIMELINE_FPS);
  const [targetFps, setTargetFps] = useState<number | null>(DEFAULT_TARGET_FPS);
  const [playbackTimeMs, setPlaybackTimeMs] = useState(0);
  const [status, setStatus] = useState("");

  const playbackRafRef = useRef<number | null>(null);
  const playbackStartMsRef = useRef(0);
  const lastFrameAtRef = useRef<number | null>(null);
  const playbackTimeRef = useRef(0);

  const selectedKeyframeIndex = useMemo(
    () => keyframes.findIndex((frame) => frame.id === selectedKeyframeId),
    [keyframes, selectedKeyframeId]
  );

  const keyframeStates = useMemo(
    () => keyframes.map((frame) => fromRigSnapshotV2(frame.snapshot)),
    [keyframes]
  );

  const totalDurationMs = useMemo(
    () => getTotalDurationMs(keyframes, loopEnabled),
    [keyframes, loopEnabled]
  );
  const defaultDurationMs = useMemo(
    () => clampDurationMs(Math.round((autoTweenFrames / Math.max(1, timelineFps)) * 1000)),
    [autoTweenFrames, timelineFps]
  );

  useEffect(() => {
    playbackTimeRef.current = playbackTimeMs;
  }, [playbackTimeMs]);

  useEffect(() => {
    if (selectedKeyframeId && keyframes.some((frame) => frame.id === selectedKeyframeId)) {
      return;
    }
    setSelectedKeyframeId(keyframes[0]?.id ?? null);
  }, [keyframes, selectedKeyframeId]);

  useEffect(() => {
    if (isPlaying && rig.state.dragState) {
      setIsPlaying(false);
      setStatus("Playback paused while editing.");
    }
  }, [isPlaying, rig.state.dragState]);

  useEffect(() => {
    if (keyframes.length >= 2 && totalDurationMs > 0) {
      if (playbackTimeRef.current > totalDurationMs) {
        playbackTimeRef.current = totalDurationMs;
        setPlaybackTimeMs(totalDurationMs);
      }
      return;
    }
    if (playbackTimeRef.current !== 0) {
      playbackTimeRef.current = 0;
      setPlaybackTimeMs(0);
    }
    if (isPlaying) {
      setIsPlaying(false);
    }
  }, [isPlaying, keyframes.length, totalDurationMs]);

  const cancelPlayback = useCallback(() => {
    if (playbackRafRef.current !== null) {
      cancelAnimationFrame(playbackRafRef.current);
      playbackRafRef.current = null;
    }
  }, []);

  useEffect(() => () => cancelPlayback(), [cancelPlayback]);

  const applyPoseAtTime = useCallback(
    (timeMs: number) => {
      if (!keyframeStates.length) {
        return;
      }

      if (keyframeStates.length === 1 || totalDurationMs <= 0) {
        rig.hydrate(cloneRigState(keyframeStates[0]));
        return;
      }

      const segment = resolveSegmentAtTime(timeMs, keyframes, loopEnabled, totalDurationMs);
      if (!segment) {
        rig.hydrate(cloneRigState(keyframeStates[keyframeStates.length - 1]));
        return;
      }

      if (!autoTweenEnabled) {
        const targetIndex = segment.localT >= 1 ? segment.toIndex : segment.fromIndex;
        rig.hydrate(cloneRigState(keyframeStates[targetIndex]));
        return;
      }

      const startState = keyframeStates[segment.fromIndex];
      const endState = keyframeStates[segment.toIndex];
      const easedT = easeInOutCubic(segment.localT);
      const interpolatedT = lerp(segment.localT, easedT, animationInterpolation);
      rig.hydrate(interpolateRigState(startState, endState, interpolatedT));
    },
    [animationInterpolation, autoTweenEnabled, keyframeStates, keyframes, loopEnabled, rig, totalDurationMs]
  );

  useEffect(() => {
    if (!isPlaying) {
      cancelPlayback();
      return;
    }

    if (keyframes.length < 2 || totalDurationMs <= 0) {
      setIsPlaying(false);
      return;
    }

    const tick = (nowMs: number) => {
      const frameIntervalMs = targetFps ? 1000 / targetFps : 0;
      if (
        frameIntervalMs > 0 &&
        lastFrameAtRef.current !== null &&
        nowMs - lastFrameAtRef.current < frameIntervalMs
      ) {
        playbackRafRef.current = requestAnimationFrame(tick);
        return;
      }
      lastFrameAtRef.current = nowMs;

      const elapsed = nowMs - playbackStartMsRef.current;
      let nextTime = elapsed;
      let playbackComplete = false;

      if (loopEnabled) {
        nextTime = modulo(elapsed, totalDurationMs);
      } else if (elapsed >= totalDurationMs) {
        nextTime = totalDurationMs;
        playbackComplete = true;
      }

      playbackTimeRef.current = nextTime;
      setPlaybackTimeMs(nextTime);
      applyPoseAtTime(nextTime);

      if (playbackComplete) {
        const lastState = keyframeStates[keyframeStates.length - 1];
        if (lastState) {
          rig.hydrate(cloneRigState(lastState));
        }
        setIsPlaying(false);
        setStatus("Playback complete.");
        return;
      }

      playbackRafRef.current = requestAnimationFrame(tick);
    };

    lastFrameAtRef.current = null;
    playbackRafRef.current = requestAnimationFrame(tick);
    return cancelPlayback;
  }, [
    applyPoseAtTime,
    cancelPlayback,
    isPlaying,
    keyframeStates,
    keyframes.length,
    loopEnabled,
    rig,
    targetFps,
    totalDurationMs,
  ]);

  const handleCaptureKeyframe = useCallback(() => {
    setIsPlaying(false);
    const snapshot = toRigSnapshotV2(rig.state);
    const keyframe: AnimationKeyframe = {
      id: createKeyframeId(),
      name: `Pose ${keyframes.length + 1}`,
      snapshot,
      durationToNextMs: defaultDurationMs,
    };
    setKeyframes((prev) => [...prev, keyframe]);
    setSelectedKeyframeId(keyframe.id);
    setStatus(`${keyframe.name} captured.`);
  }, [defaultDurationMs, keyframes.length, rig.state]);

  const handleUpdateSelected = useCallback(() => {
    if (!selectedKeyframeId) {
      setStatus("Select a keyframe to update.");
      return;
    }
    const selected = keyframes.find((frame) => frame.id === selectedKeyframeId);
    if (!selected) {
      setStatus("Select a keyframe to update.");
      return;
    }

    setIsPlaying(false);
    const snapshot = toRigSnapshotV2(rig.state);
    setKeyframes((prev) =>
      prev.map((frame) => (frame.id === selectedKeyframeId ? { ...frame, snapshot } : frame))
    );
    setStatus(`${selected.name} updated from current pose.`);
  }, [keyframes, selectedKeyframeId, rig.state]);

  const handleApplySelected = useCallback(() => {
    if (selectedKeyframeIndex < 0) {
      setStatus("Select a keyframe to apply.");
      return;
    }
    const target = keyframeStates[selectedKeyframeIndex];
    const targetFrame = keyframes[selectedKeyframeIndex];
    if (!target || !targetFrame) {
      setStatus("Select a keyframe to apply.");
      return;
    }

    setIsPlaying(false);
    rig.hydrate(cloneRigState(target));
    const nextTime = getTimelineOffsetForKeyframe(keyframes, selectedKeyframeIndex, loopEnabled);
    playbackTimeRef.current = nextTime;
    setPlaybackTimeMs(nextTime);
    setStatus(`${targetFrame.name} applied.`);
  }, [keyframeStates, keyframes, loopEnabled, rig, selectedKeyframeIndex]);

  const handleDeleteSelected = useCallback(() => {
    if (!selectedKeyframeId) {
      setStatus("Select a keyframe to delete.");
      return;
    }

    setIsPlaying(false);
    setKeyframes((prev) => prev.filter((frame) => frame.id !== selectedKeyframeId));
    setStatus("Keyframe deleted.");
  }, [selectedKeyframeId]);

  const handleInsertInBetween = useCallback(() => {
    if (selectedKeyframeIndex < 0 || keyframes.length < 2) {
      setStatus("Select a source keyframe with an outgoing segment.");
      return;
    }
    const hasOutgoing = loopEnabled ? true : selectedKeyframeIndex < keyframes.length - 1;
    if (!hasOutgoing) {
      setStatus("Selected keyframe has no outgoing segment.");
      return;
    }

    const nextIndex =
      selectedKeyframeIndex + 1 < keyframes.length ? selectedKeyframeIndex + 1 : 0;
    const insertAt = selectedKeyframeIndex + 1;
    const startState = keyframeStates[selectedKeyframeIndex];
    const endState = keyframeStates[nextIndex];
    const source = keyframes[selectedKeyframeIndex];
    if (!startState || !endState || !source) {
      setStatus("Unable to create in-between frame.");
      return;
    }

    const splitDuration = clampDurationMs(source.durationToNextMs);
    const leadingDuration = clampDurationMs(Math.round(splitDuration / 2));
    const trailingDuration = clampDurationMs(splitDuration - leadingDuration);
    const midpointT = lerp(0.5, easeInOutCubic(0.5), animationInterpolation);
    const midpointSnapshot = toRigSnapshotV2(interpolateRigState(startState, endState, midpointT));
    const generated: AnimationKeyframe = {
      id: createKeyframeId(),
      name: `In-between ${selectedKeyframeIndex + 1}.${insertAt + 1}`,
      snapshot: midpointSnapshot,
      durationToNextMs: trailingDuration,
    };

    setIsPlaying(false);
    setKeyframes((prev) => {
      const next = [...prev];
      next[selectedKeyframeIndex] = {
        ...next[selectedKeyframeIndex],
        durationToNextMs: leadingDuration,
      };
      next.splice(insertAt, 0, generated);
      return next;
    });
    setSelectedKeyframeId(generated.id);
    setStatus("Inserted in-between keyframe.");
  }, [animationInterpolation, keyframeStates, keyframes, loopEnabled, selectedKeyframeIndex]);

  const moveSelectedKeyframe = useCallback(
    (direction: -1 | 1) => {
      if (selectedKeyframeIndex < 0) {
        return;
      }
      const nextIndex = selectedKeyframeIndex + direction;
      if (nextIndex < 0 || nextIndex >= keyframes.length) {
        return;
      }

      const nextSelectionId = keyframes[nextIndex].id;
      setKeyframes((prev) => {
        const next = [...prev];
        const temp = next[selectedKeyframeIndex];
        next[selectedKeyframeIndex] = next[nextIndex];
        next[nextIndex] = temp;
        return next;
      });
      setSelectedKeyframeId(nextSelectionId);
      setStatus("Keyframe order updated.");
    },
    [keyframes, selectedKeyframeIndex]
  );

  const handleDurationChange = useCallback((keyframeId: string, nextValue: number) => {
    const duration = clampDurationMs(nextValue);
    setKeyframes((prev) =>
      prev.map((frame) =>
        frame.id === keyframeId ? { ...frame, durationToNextMs: duration } : frame
      )
    );
  }, []);

  const handleNameChange = useCallback((keyframeId: string, nextName: string) => {
    setKeyframes((prev) =>
      prev.map((frame) => (frame.id === keyframeId ? { ...frame, name: nextName } : frame))
    );
  }, []);

  const handleTogglePlayback = useCallback(() => {
    if (isPlaying) {
      setIsPlaying(false);
      setStatus("Playback paused.");
      return;
    }

    if (keyframes.length < 2) {
      setStatus("Capture at least two keyframes to play animation.");
      return;
    }

    if (totalDurationMs <= 0) {
      setStatus("Increase keyframe timing before playback.");
      return;
    }

    if (!loopEnabled && playbackTimeRef.current >= totalDurationMs - 1) {
      playbackTimeRef.current = 0;
      setPlaybackTimeMs(0);
      applyPoseAtTime(0);
    }

    lastFrameAtRef.current = null;
    playbackStartMsRef.current = performance.now() - playbackTimeRef.current;
    setIsPlaying(true);
    setStatus("Playback running.");
  }, [applyPoseAtTime, isPlaying, keyframes.length, loopEnabled, totalDurationMs]);

  const handleRewind = useCallback(() => {
    setIsPlaying(false);
    playbackTimeRef.current = 0;
    setPlaybackTimeMs(0);
    applyPoseAtTime(0);
    setStatus("Rewound to start.");
  }, [applyPoseAtTime]);

  const handleScrub = useCallback(
    (rawTimeMs: number) => {
      if (totalDurationMs <= 0) {
        return;
      }
      const nextTime = Math.max(0, Math.min(totalDurationMs, rawTimeMs));
      setIsPlaying(false);
      playbackTimeRef.current = nextTime;
      setPlaybackTimeMs(nextTime);
      applyPoseAtTime(nextTime);
    },
    [applyPoseAtTime, totalDurationMs]
  );

  return (
    <div style={{ display: active ? "block" : "none" }}>
      <div style={{ marginTop: "16px", fontSize: "12px", color: "#6b7280" }}>Animation</div>
      <div style={{ marginTop: "6px", fontSize: "10px", color: "#4b5563", lineHeight: 1.4 }}>
        Pose-to-pose interpolation with auto tweens and per-segment timing.
      </div>

      <div style={{ marginTop: "8px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
        <button
          type="button"
          style={{
            padding: "6px 8px",
            background: "#111111",
            color: "white",
            border: "1px solid #111111",
            cursor: "pointer",
            fontSize: "11px",
          }}
          onClick={handleCaptureKeyframe}
        >
          Capture Pose
        </button>
        <button
          type="button"
          style={{
            padding: "6px 8px",
            background: selectedKeyframeIndex >= 0 ? "#0f766e" : "#f4f4f5",
            color: selectedKeyframeIndex >= 0 ? "white" : "#6b7280",
            border: `1px solid ${selectedKeyframeIndex >= 0 ? "#115e59" : "#d4d4d8"}`,
            cursor: selectedKeyframeIndex >= 0 ? "pointer" : "not-allowed",
            fontSize: "11px",
          }}
          disabled={selectedKeyframeIndex < 0}
          onClick={handleUpdateSelected}
        >
          Update Selected
        </button>
        <button
          type="button"
          style={{
            padding: "6px 8px",
            background: keyframes.length >= 2 && selectedKeyframeIndex >= 0 ? "#a16207" : "#f4f4f5",
            color: keyframes.length >= 2 && selectedKeyframeIndex >= 0 ? "white" : "#6b7280",
            border: `1px solid ${keyframes.length >= 2 && selectedKeyframeIndex >= 0 ? "#92400e" : "#d4d4d8"}`,
            cursor: keyframes.length >= 2 && selectedKeyframeIndex >= 0 ? "pointer" : "not-allowed",
            fontSize: "11px",
          }}
          disabled={keyframes.length < 2 || selectedKeyframeIndex < 0}
          onClick={handleInsertInBetween}
        >
          Insert In-Between
        </button>
        <button
          type="button"
          style={{
            padding: "6px 8px",
            background: selectedKeyframeIndex >= 0 ? "#7c3aed" : "#f4f4f5",
            color: selectedKeyframeIndex >= 0 ? "white" : "#6b7280",
            border: `1px solid ${selectedKeyframeIndex >= 0 ? "#5b21b6" : "#d4d4d8"}`,
            cursor: selectedKeyframeIndex >= 0 ? "pointer" : "not-allowed",
            fontSize: "11px",
          }}
          disabled={selectedKeyframeIndex < 0}
          onClick={handleApplySelected}
        >
          Apply Selected
        </button>
        <button
          type="button"
          style={{
            padding: "6px 8px",
            background: selectedKeyframeIndex >= 0 ? "#7f1d1d" : "#f4f4f5",
            color: selectedKeyframeIndex >= 0 ? "white" : "#6b7280",
            border: `1px solid ${selectedKeyframeIndex >= 0 ? "#991b1b" : "#d4d4d8"}`,
            cursor: selectedKeyframeIndex >= 0 ? "pointer" : "not-allowed",
            fontSize: "11px",
          }}
          disabled={selectedKeyframeIndex < 0}
          onClick={handleDeleteSelected}
        >
          Delete Selected
        </button>
      </div>

      <div style={{ marginTop: "8px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
        <button
          type="button"
          style={{
            padding: "6px 8px",
            background:
              selectedKeyframeIndex > 0
                ? "#f4f4f5"
                : "#fafafa",
            color: selectedKeyframeIndex > 0 ? "#111111" : "#9ca3af",
            border: "1px solid #d4d4d8",
            cursor: selectedKeyframeIndex > 0 ? "pointer" : "not-allowed",
            fontSize: "11px",
          }}
          disabled={selectedKeyframeIndex <= 0}
          onClick={() => moveSelectedKeyframe(-1)}
        >
          Move Up
        </button>
        <button
          type="button"
          style={{
            padding: "6px 8px",
            background:
              selectedKeyframeIndex >= 0 && selectedKeyframeIndex < keyframes.length - 1
                ? "#f4f4f5"
                : "#fafafa",
            color:
              selectedKeyframeIndex >= 0 && selectedKeyframeIndex < keyframes.length - 1
                ? "#111111"
                : "#9ca3af",
            border: "1px solid #d4d4d8",
            cursor:
              selectedKeyframeIndex >= 0 && selectedKeyframeIndex < keyframes.length - 1
                ? "pointer"
                : "not-allowed",
            fontSize: "11px",
          }}
          disabled={selectedKeyframeIndex < 0 || selectedKeyframeIndex >= keyframes.length - 1}
          onClick={() => moveSelectedKeyframe(1)}
        >
          Move Down
        </button>
      </div>

      <div style={{ marginTop: "12px", fontSize: "12px", color: "#6b7280" }}>Playback</div>
      <div style={{ marginTop: "6px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
        <button
          type="button"
          style={{
            padding: "6px 8px",
            background: isPlaying ? "#7f1d1d" : "#0f766e",
            color: "white",
            border: `1px solid ${isPlaying ? "#991b1b" : "#115e59"}`,
            cursor: "pointer",
            fontSize: "11px",
          }}
          onClick={handleTogglePlayback}
        >
          {isPlaying ? "Pause" : "Play"}
        </button>
        <button
          type="button"
          style={{
            padding: "6px 8px",
            background: "#111111",
            color: "white",
            border: "1px solid #111111",
            cursor: "pointer",
            fontSize: "11px",
          }}
          onClick={handleRewind}
        >
          Rewind
        </button>
      </div>

      <label
        style={{
          marginTop: "8px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          fontSize: "11px",
          color: "#4b5563",
        }}
      >
        <input
          type="checkbox"
          checked={autoTweenEnabled}
          onChange={(event) => setAutoTweenEnabled(event.target.checked)}
        />
        Auto Tween (interpolate between keyframes)
      </label>
      <label
        style={{
          marginTop: "6px",
          display: "flex",
          alignItems: "center",
          gap: "8px",
          fontSize: "11px",
          color: "#4b5563",
        }}
      >
        <input
          type="checkbox"
          checked={loopEnabled}
          onChange={(event) => setLoopEnabled(event.target.checked)}
        />
        Loop timeline (last keyframe to first)
      </label>

      <div style={{ marginTop: "8px", fontSize: "11px", color: "#6b7280" }}>
        Interpolation {animationInterpolation.toFixed(2)}
      </div>
      <input
        type="range"
        min={0}
        max={1}
        step={0.01}
        value={animationInterpolation}
        onChange={(event) => setAnimationInterpolation(clampInterpolation(Number(event.target.value)))}
        style={{ width: "100%", marginTop: "4px", accentColor: "#7c3aed" }}
      />

      <div style={{ marginTop: "8px", fontSize: "11px", color: "#6b7280" }}>
        Auto Tween Frames {autoTweenFrames}
      </div>
      <input
        type="range"
        min={MIN_AUTO_TWEEN_FRAMES}
        max={MAX_AUTO_TWEEN_FRAMES}
        step={1}
        value={autoTweenFrames}
        onChange={(event) => setAutoTweenFrames(clampTweenFrames(Number(event.target.value)))}
        style={{ width: "100%", marginTop: "4px", accentColor: "#a16207" }}
      />

      <div style={{ marginTop: "8px", fontSize: "11px", color: "#6b7280" }}>Timing FPS</div>
      <input
        type="number"
        min={MIN_TIMELINE_FPS}
        max={MAX_TIMELINE_FPS}
        value={timelineFps}
        onChange={(event) => setTimelineFps(clampFps(Number(event.target.value)))}
        style={{
          width: "100%",
          marginTop: "4px",
          background: "#ffffff",
          color: "#111111",
          border: "1px solid #d4d4d8",
          padding: "6px",
        }}
      />

      <div style={{ marginTop: "8px", fontSize: "11px", color: "#6b7280" }}>Playback FPS Cap</div>
      <input
        type="range"
        min={0}
        max={MAX_TARGET_FPS}
        step={1}
        value={targetFps ?? 0}
        onChange={(event) => {
          const raw = Number(event.target.value);
          setTargetFps(raw <= 0 ? null : clampTargetFps(raw));
        }}
        style={{ width: "100%", marginTop: "4px", accentColor: "#0f766e" }}
      />
      <div style={{ marginTop: "4px", fontSize: "10px", color: "#6b7280" }}>
        {targetFps ? `${targetFps} fps` : "Uncapped"}
      </div>

      <div style={{ marginTop: "10px", fontSize: "11px", color: "#6b7280" }}>Timeline</div>
      <input
        type="range"
        min={0}
        max={Math.max(totalDurationMs, 1)}
        step={1}
        value={Math.min(playbackTimeMs, Math.max(totalDurationMs, 1))}
        disabled={totalDurationMs <= 0}
        onChange={(event) => handleScrub(Number(event.target.value))}
        style={{ width: "100%", marginTop: "4px", accentColor: "#7c3aed" }}
      />
      <div
        style={{
          marginTop: "4px",
          display: "flex",
          justifyContent: "space-between",
          fontSize: "10px",
          color: "#6b7280",
        }}
      >
        <span>{(playbackTimeMs / 1000).toFixed(2)}s</span>
        <span>{(totalDurationMs / 1000).toFixed(2)}s</span>
      </div>
      {totalDurationMs > 0 && (
        <div
          style={{
            marginTop: "6px",
            border: "1px solid #d4d4d8",
            background: "#fafafa",
            height: "16px",
            display: "flex",
            overflow: "hidden",
          }}
        >
          {(loopEnabled ? keyframes : keyframes.slice(0, -1)).map((frame, index) => {
            const duration = clampDurationMs(frame.durationToNextMs);
            const widthPercent = (duration / totalDurationMs) * 100;
            return (
              <div
                key={`timeline-segment-${frame.id}-${index}`}
                style={{
                  width: `${widthPercent}%`,
                  background: index % 2 === 0 ? "#ddd6fe" : "#c4b5fd",
                  borderRight: "1px solid #a78bfa",
                }}
              />
            );
          })}
        </div>
      )}

      <div
        style={{
          marginTop: "8px",
          maxHeight: "260px",
          overflowY: "auto",
          border: "1px solid #d4d4d8",
          background: "#ffffff",
          padding: "6px",
        }}
      >
        {keyframes.length === 0 && (
          <div style={{ fontSize: "11px", color: "#6b7280" }}>
            No keyframes yet. Capture a pose to start.
          </div>
        )}

        {keyframes.map((frame, index) => {
          const selected = frame.id === selectedKeyframeId;
          const hasOutgoingSegment = loopEnabled ? keyframes.length > 1 : index < keyframes.length - 1;
          const durationMs = clampDurationMs(frame.durationToNextMs);
          const tweenFrameCount = hasOutgoingSegment
            ? Math.max(0, Math.round((durationMs / 1000) * timelineFps) - 1)
            : 0;

          return (
            <button
              key={frame.id}
              type="button"
              onClick={() => setSelectedKeyframeId(frame.id)}
              style={{
                width: "100%",
                textAlign: "left",
                border: `1px solid ${selected ? "#7c3aed" : "#d4d4d8"}`,
                background: selected ? "#f5f3ff" : "#fafafa",
                padding: "6px",
                marginBottom: "6px",
                cursor: "pointer",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                <div
                  style={{
                    minWidth: "22px",
                    height: "22px",
                    borderRadius: "4px",
                    background: selected ? "#7c3aed" : "#111111",
                    color: "white",
                    fontSize: "10px",
                    fontWeight: 700,
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  {index + 1}
                </div>
                <input
                  type="text"
                  value={frame.name}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => handleNameChange(frame.id, event.target.value)}
                  style={{
                    flex: 1,
                    background: "#ffffff",
                    color: "#111111",
                    border: "1px solid #d4d4d8",
                    padding: "4px 6px",
                    fontSize: "11px",
                  }}
                />
              </div>

              <div style={{ marginTop: "6px", fontSize: "10px", color: "#6b7280" }}>
                {hasOutgoingSegment
                  ? `to ${index + 1 < keyframes.length ? keyframes[index + 1].name || `Pose ${index + 2}` : keyframes[0]?.name || "Pose 1"}`
                  : "end frame (no outgoing tween)"}
              </div>

              <input
                type="range"
                min={MIN_SEGMENT_DURATION_MS}
                max={MAX_SEGMENT_DURATION_MS}
                step={10}
                value={durationMs}
                onClick={(event) => event.stopPropagation()}
                onChange={(event) => handleDurationChange(frame.id, Number(event.target.value))}
                style={{
                  width: "100%",
                  marginTop: "4px",
                  accentColor: "#7c3aed",
                  opacity: hasOutgoingSegment ? 1 : 0.4,
                }}
              />

              <div style={{ marginTop: "4px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "6px" }}>
                <input
                  type="number"
                  min={MIN_SEGMENT_DURATION_MS}
                  max={MAX_SEGMENT_DURATION_MS}
                  step={10}
                  value={durationMs}
                  onClick={(event) => event.stopPropagation()}
                  onChange={(event) => handleDurationChange(frame.id, Number(event.target.value))}
                  style={{
                    width: "100%",
                    background: "#ffffff",
                    color: "#111111",
                    border: "1px solid #d4d4d8",
                    padding: "4px 6px",
                    fontSize: "11px",
                    opacity: hasOutgoingSegment ? 1 : 0.4,
                  }}
                />
                <div
                  style={{
                    fontSize: "10px",
                    color: "#6b7280",
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "flex-end",
                  }}
                >
                  {hasOutgoingSegment
                    ? `${tweenFrameCount} in-between @ ${timelineFps}fps`
                    : "-"}
                </div>
              </div>
            </button>
          );
        })}
      </div>

      {status && <div style={{ marginTop: "6px", fontSize: "11px", color: "#4b5563" }}>{status}</div>}
    </div>
  );
};
