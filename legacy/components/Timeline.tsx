import React, { useState, useEffect } from 'react';
import { AnimationClip } from '../types';
import './Timeline.css';

const FRAME_RATE = 24;

interface DurationEditorProps {
  clip: AnimationClip;
  onSave: (duration: number) => void;
  onCancel: () => void;
}

const DurationEditor: React.FC<DurationEditorProps> = ({ clip, onSave, onCancel }) => {
    const [ms, setMs] = useState(clip.duration);
    const [seconds, setSeconds] = useState(clip.duration / 1000);
    const [frames, setFrames] = useState(Math.round((clip.duration / 1000) * FRAME_RATE));

    const handleMsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newMs = parseInt(e.target.value, 10) || 0;
        setMs(newMs);
        setSeconds(parseFloat((newMs / 1000).toFixed(3)));
        setFrames(Math.round((newMs / 1000) * FRAME_RATE));
    };
    
    const handleSecondsChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newSeconds = parseFloat(e.target.value) || 0;
        const newMs = Math.round(newSeconds * 1000);
        setSeconds(newSeconds);
        setMs(newMs);
        setFrames(Math.round(newSeconds * FRAME_RATE));
    };

    const handleFramesChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newFrames = parseInt(e.target.value, 10) || 0;
        const newSeconds = newFrames / FRAME_RATE;
        const newMs = Math.round(newSeconds * 1000);
        setFrames(newFrames);
        setSeconds(parseFloat(newSeconds.toFixed(3)));
        setMs(newMs);
    };

    const handleSave = () => {
        onSave(ms);
    };

    return (
        <div className="duration-editor-overlay" onClick={onCancel}>
            <div className="duration-editor-modal" onClick={e => e.stopPropagation()}>
                <h3 className="editor-title">Edit Transition Time</h3>
                <div className="editor-inputs">
                    <div className="input-group">
                        <label htmlFor="ms">Milliseconds</label>
                        <input id="ms" type="number" value={ms} onChange={handleMsChange} />
                    </div>
                    <div className="input-group">
                        <label htmlFor="seconds">Seconds</label>
                        <input id="seconds" type="number" value={seconds} step="0.01" onChange={handleSecondsChange} />
                    </div>
                    <div className="input-group">
                        <label htmlFor="frames">Frames (24fps)</label>
                        <input id="frames" type="number" value={frames} onChange={handleFramesChange} />
                    </div>
                </div>
                <div className="editor-actions">
                    <button onClick={handleSave} className="editor-button save">Apply</button>
                    <button onClick={onCancel} className="editor-button cancel">Cancel</button>
                </div>
            </div>
        </div>
    );
};

interface TimelineProps {
  animationSequence: AnimationClip[];
  onPlay: () => void;
  onPause: () => void;
  onReset: () => void;
  isAnimating: boolean;
  animationTime: number;
  totalDuration: number;
  onUpdateKeyframeDuration: (keyframeId: string, newDuration: number) => void;
  onAddKeyframe: () => void;
  onUpdateKeyframe: (keyframeId: string) => void;
  onRemoveKeyframe: (keyframeId: string) => void;
  onReorderKeyframes: (draggedId: string, droppedOnId: string) => void;
}

export const Timeline: React.FC<TimelineProps> = ({ 
    animationSequence,
    onPlay,
    onPause,
    onReset,
    isAnimating,
    animationTime,
    totalDuration,
    onUpdateKeyframeDuration,
    onAddKeyframe,
    onUpdateKeyframe,
    onRemoveKeyframe,
    onReorderKeyframes,
}) => {
  const [editingClipId, setEditingClipId] = useState<string | null>(null);
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  const [draggedClipId, setDraggedClipId] = useState<string | null>(null);
  const [dropIndicator, setDropIndicator] = useState<{ id: string, side: 'left' | 'right'} | null>(null);
  
  const trackWidth = 500;
  const pixelsPerMillisecond = totalDuration > 0 ? trackWidth / totalDuration : 0;
  
  const effectiveTime = totalDuration > 0 ? animationTime % totalDuration : 0;
  const playbackHeadPosition = effectiveTime * pixelsPerMillisecond;

  const handleSaveDuration = (newDuration: number) => {
      if (editingClipId) {
          onUpdateKeyframeDuration(editingClipId, newDuration);
      }
      setEditingClipId(null);
  };
  
  const handleDragStart = (e: React.DragEvent<HTMLDivElement>, clipId: string) => {
    e.dataTransfer.setData('text/plain', clipId);
    e.dataTransfer.effectAllowed = 'move';
    setTimeout(() => setDraggedClipId(clipId), 0);
  };
  
  const handleDragOver = (e: React.DragEvent<HTMLDivElement>, clipId: string) => {
    e.preventDefault();
    if (draggedClipId && draggedClipId !== clipId) {
      const rect = e.currentTarget.getBoundingClientRect();
      const isRightHalf = e.clientX > rect.left + rect.width / 2;
      setDropIndicator({ id: clipId, side: isRightHalf ? 'right' : 'left' });
    }
  };
  
  const handleDrop = (e: React.DragEvent<HTMLDivElement>, dropOnClipId: string) => {
    e.preventDefault();
    const draggedId = e.dataTransfer.getData('text/plain');
    if (draggedId && draggedId !== dropOnClipId) {
        onReorderKeyframes(draggedId, dropOnClipId);
    }
    setDropIndicator(null);
    setDraggedClipId(null);
  };
  
  const handleDragEnd = () => {
    setDraggedClipId(null);
    setDropIndicator(null);
  };

  const editingClip = editingClipId ? animationSequence.find(c => c.id === editingClipId) : null;
  
  useEffect(() => {
    if (isAnimating) {
        setSelectedClipId(null);
    }
  }, [isAnimating]);

  return (
    <div className="timeline-container">
       {editingClip && (
        <DurationEditor 
          clip={editingClip}
          onSave={handleSaveDuration}
          onCancel={() => setEditingClipId(null)}
        />
      )}
      <div className="timeline-controls-grid">
        <div className="playback-controls">
            {isAnimating ? (
                <button onClick={onPause} className="timeline-button">❚❚</button>
            ) : (
                <button onClick={onPlay} className="timeline-button">▶</button>
            )}
            <button onClick={onReset} className="timeline-button">⟲</button>
            <span className="timeline-duration">{(totalDuration / 1000).toFixed(2)}s</span>
        </div>
        <div className="edit-controls">
            <button onClick={onAddKeyframe} className="timeline-button add" title="Add current pose as keyframe">+</button>
            {selectedClipId && (
                <>
                <button onClick={() => onUpdateKeyframe(selectedClipId)} className="timeline-button update" title="Update selected keyframe to current pose">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h5M20 20v-5h-5M4 4l5 5M20 20l-5-5" /></svg>
                </button>
                <button onClick={() => onRemoveKeyframe(selectedClipId)} className="timeline-button remove" title="Remove selected keyframe">
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                </button>
                </>
            )}
        </div>
      </div>
      <div className="timeline-track-wrapper" onDragLeave={() => setDropIndicator(null)}>
        <div className="timeline-track" style={{ width: `${trackWidth}px` }}>
          {animationSequence.map((clip, index) => {
            const left = animationSequence.slice(0, index).reduce((sum, c) => sum + (c.duration * pixelsPerMillisecond), 0);
            const width = clip.duration * pixelsPerMillisecond;
            
            const classNames = [
                'timeline-clip',
                selectedClipId === clip.id ? 'selected' : '',
                draggedClipId === clip.id ? 'dragging' : '',
            ].join(' ');

            return (
              <div
                key={clip.id}
                className={classNames}
                style={{ left: `${left}px`, width: `${width}px` }}
                title={`${clip.name} (${(clip.duration / 1000).toFixed(2)}s)`}
                draggable={!isAnimating}
                onClick={() => setSelectedClipId(clip.id === selectedClipId ? null : clip.id)}
                onDoubleClick={() => setEditingClipId(clip.id)}
                onDragStart={e => handleDragStart(e, clip.id)}
                onDragOver={e => handleDragOver(e, clip.id)}
                onDrop={e => handleDrop(e, clip.id)}
                onDragEnd={handleDragEnd}
              >
                <span className="clip-name">{clip.name}</span>
                {dropIndicator?.id === clip.id && <div className={`drop-indicator ${dropIndicator.side}`} />}
              </div>
            );
          })}
          {animationSequence.length > 0 && <div 
            className="timeline-playback-head" 
            style={{ left: `${playbackHeadPosition}px` }}
          />}
        </div>
      </div>
    </div>
  );
};