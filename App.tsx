
import React, { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { WalkingEnginePose, WalkingEnginePivotOffsets, WalkingEngineProportions, Vector2D, MaskTransform, GlobalPositions, PhysicsState, Keyframe } from './types';
import { ANATOMY_RAW_RELATIVE_TO_BASE_HEAD_UNIT } from './constants'; 
import { Mannequin } from './components/Mannequin';
import { SystemLogger } from './components/SystemLogger';
import { Timeline } from './components/Timeline';
import { ProceduralAsciiBackground } from './components/ProceduralAsciiBackground';
import { Intertitle } from './components/Intertitle';
import { lerpAngleShortestPath } from './utils/kinematics';

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

const INITIAL_CHALLENGE_POSE: WalkingEnginePivotOffsets = {
  waist: 0, torso: 0, collar: 0, neck: 0,
  l_shoulder: -75, l_elbow: 0, l_hand: 0,
  r_shoulder: 75, r_elbow: 0, r_hand: 0,
  l_hip: 0, l_knee: 0, l_foot: 0, l_toe: 0,
  r_hip: 0, r_knee: 0, r_foot: 0, r_toe: 0
};

const JOINT_KEYS: (keyof WalkingEnginePivotOffsets)[] = [
  'waist', 'torso', 'collar', 'neck',
  'l_shoulder', 'l_elbow', 'l_hand',
  'r_shoulder', 'r_elbow', 'r_hand',
  'l_hip', 'l_knee', 'l_foot', 'l_toe',
  'r_hip', 'r_knee', 'r_foot', 'r_toe'
];

const PROP_KEYS: (keyof WalkingEngineProportions)[] = [
  'head', 'collar', 'torso', 'waist',
  'l_upper_arm', 'l_lower_arm', 'l_hand',
  'r_upper_arm', 'r_lower_arm', 'r_hand',
  'l_upper_leg', 'l_lower_leg', 'l_foot', 'l_toe',
  'r_upper_leg', 'r_lower_leg', 'r_foot', 'r_toe'
];

const ATOMIC_PROPS = Object.fromEntries(PROP_KEYS.map(k => [k, { w: 1, h: 1 }])) as WalkingEngineProportions;

const JOINT_CHILD_MAP: Partial<Record<keyof WalkingEnginePivotOffsets, keyof WalkingEnginePivotOffsets>> = {
    waist: 'torso', torso: 'collar', collar: 'neck',
    l_shoulder: 'l_elbow', l_elbow: 'l_hand',
    r_shoulder: 'r_elbow', r_elbow: 'r_hand',
    l_hip: 'l_knee', l_knee: 'l_foot', l_foot: 'l_toe',
    r_hip: 'r_knee', r_knee: 'r_foot', r_foot: 'r_toe',
};

const INITIAL_RENDER_ORDER: (keyof WalkingEngineProportions)[] = [
    'waist', 'torso', 'l_upper_leg', 'r_upper_leg', 'l_lower_leg', 'r_lower_leg', 'l_foot', 'r_foot', 'l_toe', 'r_toe', 
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
  const [partTextures, setPartTextures] = useState<Partial<Record<keyof WalkingEngineProportions, string>>>({});
  const [maskTransforms, setMaskTransforms] = useState<Partial<Record<keyof WalkingEngineProportions, MaskTransform>>>({});
  const [partCustomPaths, setPartCustomPaths] = useState<Partial<Record<keyof WalkingEngineProportions, string>>>({});
  const [activeShapeEditorKey, setActiveShapeEditorKey] = useState<keyof WalkingEngineProportions | null>(null);
  const [backgroundImage] = useState<string | null>(null);
  const [backgroundTransform] = useState<MaskTransform>({ x: 0, y: 0, rotation: 0, scale: 1, mode: 'cover' });
  const [viewBoxCenter, setViewBoxCenter] = useState<Vector2D>({ x: 0, y: 0 });
  const [intertitleText] = useState("PROMETHEUS_V2");
  const [isIntertitleVisible] = useState(false);
  const [intertitleFontSize] = useState(4);
  const [intertitleStyle] = useState<IntertitleStyle>('page');
  const [pivotOffsets, setPivotOffsets] = useState<WalkingEnginePivotOffsets>(INITIAL_CHALLENGE_POSE);
  const [props] = useState<WalkingEngineProportions>(ATOMIC_PROPS);
  const [previewPivotOffsets, setPreviewPivotOffsets] = useState<WalkingEnginePivotOffsets | null>(null);
  const [staticGhostPose, setStaticGhostPose] = useState<WalkingEnginePivotOffsets | null>(null);
  const [predictiveGhostingEnabled, setPredictiveGhostingEnabled] = useState(true);
  const [showRig, setShowRig] = useState(false);
  const [jointFriction] = useState(50);
  const [isTransitioning, setIsTransitioning] = useState(false);
  const [keyframes, setKeyframes] = useState<Keyframe[]>([]);
  const [partZOrder] = useState(INITIAL_Z_ORDER);
  const [showLabels, setShowLabels] = useState(false);
  const [isAutoCaptureEnabled, setIsAutoCaptureEnabled] = useState(false);
  const autoCaptureStartPoseRef = useRef<WalkingEnginePivotOffsets | null>(null);
  const [recordingHistory, setRecordingHistory] = useState<HistoryState[]>([]);
  const draggingBoneKeyRef = useRef<keyof WalkingEnginePivotOffsets | null>(null);
  const lastClientXRef = useRef(0);
  const isInteractingRef = useRef(false);
  const transitionAnimationRef = useRef<number | null>(null);
  const transitionStartTimeRef = useRef<number | null>(null);

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

  const handleInteractionMove = useCallback((clientX: number) => {
    if (!isCalibrated || isTransitioning || !draggingBoneKeyRef.current) return;
    if (!isInteractingRef.current) isInteractingRef.current = true;
    const boneKey = draggingBoneKeyRef.current;
    const updateFunc = predictiveGhostingEnabled ? setPreviewPivotOffsets : setPivotOffsets;
    let baseOffsets = predictiveGhostingEnabled ? (previewPivotOffsets || pivotOffsets) : pivotOffsets;
    const frictionFactor = 1 - (jointFriction / 125);
    const dragDelta = (clientX - lastClientXRef.current) * frictionFactor;
    const newValue = baseOffsets[boneKey] + dragDelta;
    baseOffsets = { ...baseOffsets, [boneKey]: newValue };
    baseOffsets = applyChainReaction(boneKey, dragDelta, baseOffsets);
    lastClientXRef.current = clientX;
    updateFunc(baseOffsets);
  }, [isCalibrated, isTransitioning, jointFriction, applyChainReaction, predictiveGhostingEnabled, pivotOffsets, previewPivotOffsets]);

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
    isInteractingRef.current = false;
  }, [isAutoCaptureEnabled, handleAddKeyframe, predictiveGhostingEnabled, previewPivotOffsets, pivotOffsets, jointFriction, animatePoseTransition]);

  const startDrag = useCallback((key: keyof WalkingEnginePivotOffsets, clientX: number) => {
    if (!isCalibrated || isTransitioning) return;
    if (isAutoCaptureEnabled) autoCaptureStartPoseRef.current = { ...pivotOffsets };
    if (predictiveGhostingEnabled) { setPreviewPivotOffsets({ ...pivotOffsets }); setStaticGhostPose({ ...pivotOffsets }); }
    draggingBoneKeyRef.current = key;
    lastClientXRef.current = clientX;
  }, [isCalibrated, isTransitioning, pivotOffsets, isAutoCaptureEnabled, predictiveGhostingEnabled]);

  const handleULCUpload = (partKey: keyof WalkingEngineProportions, e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (re) => {
            const result = re.target?.result as string;
            setPartTextures(prev => ({ ...prev, [partKey]: result }));
            setMaskTransforms(prev => ({ ...prev, [partKey]: { x: 0, y: 0, rotation: 0, scale: 1, mode: 'project' } }));
            addLog(`ULC: Bound content to ${partKey.toUpperCase()}`);
        };
        reader.readAsDataURL(file);
    }
  };

  const sortedFKJoints = useMemo(() => {
    return JOINT_KEYS.sort((a, b) => (a === 'waist' ? -1 : b === 'waist' ? 1 : 0));
  }, []);

  useEffect(() => {
    const onMove = (e: MouseEvent) => handleInteractionMove(e.clientX);
    const onUp = () => handleInteractionEnd();
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, [handleInteractionMove, handleInteractionEnd]);

  useEffect(() => {
    if (allJointPositions.waist) setViewBoxCenter(allJointPositions.waist.position);
  }, [allJointPositions]);

  return (
    <div className="flex h-full w-full bg-[#020617] font-mono text-slate-200 overflow-hidden select-none">
      {isConsoleVisible && (
        <div className="w-96 border-r border-slate-800 bg-slate-900/50 backdrop-blur-md p-4 flex flex-col gap-4 custom-scrollbar overflow-y-auto z-50">
          <div className="flex justify-between items-center border-b border-slate-800 pb-2">
            <h1 className="text-2xl font-black tracking-widest uppercase italic text-white">PROMETHEUS<span className="text-sky-500">_V2</span></h1>
          </div>
          <div className="border-b border-slate-800">
            <div className="flex">{(['fk', 'perf', 'layers', 'animation', 'studio'] as const).map(tab => (<button key={tab} onClick={() => setActiveControlTab(tab)} className={`flex-1 text-[10px] py-2 font-bold transition-colors ${activeControlTab === tab ? 'bg-slate-800 text-sky-400 border-b-2 border-sky-500' : 'text-slate-500 opacity-50'}`}>{tab.toUpperCase()}</button>))}</div>
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
                      <input type="range" min="-180" max="180" step="1" value={(previewPivotOffsets || pivotOffsets)[k]} onMouseDown={() => startDrag(k, 0)} onChange={(e) => {
                          const val = parseInt(e.target.value);
                          const current = previewPivotOffsets || pivotOffsets;
                          const delta = val - current[k];
                          let next = { ...current, [k]: val };
                          next = applyChainReaction(k, delta, next);
                          (predictiveGhostingEnabled ? setPreviewPivotOffsets : setPivotOffsets)(next);
                      }} onMouseUp={handleInteractionEnd} className="w-full accent-sky-500 h-1 cursor-ew-resize" />
                    </div>
                  ))}
                </div>
              </div>
            )}
            {activeControlTab === 'perf' && (
                <div className="flex flex-col gap-4 pt-4">
                    <div className="text-xs font-bold text-slate-400 uppercase border-b border-slate-800 pb-1">Engine Controls</div>
                    <button onClick={() => setPredictiveGhostingEnabled(v => !v)} className={`w-full text-[10px] font-bold py-1 border ${predictiveGhostingEnabled ? 'bg-sky-500 text-white border-sky-500' : 'bg-slate-800 border-slate-700'}`}>GHOSTING: {predictiveGhostingEnabled ? 'ON' : 'OFF'}</button>
                    <button onClick={() => setShowRig(v => !v)} className={`w-full text-[10px] font-bold py-1 border ${showRig ? 'bg-sky-500 text-white border-sky-500' : 'bg-slate-800 border-slate-700'}`}>STRUCTURE RIG: {showRig ? 'VISIBLE' : 'HIDDEN'}</button>
                    <button onClick={() => setShowLabels(v => !v)} className={`w-full text-[10px] font-bold py-1 border ${showLabels ? 'bg-sky-500 text-white border-sky-500' : 'bg-slate-800 border-slate-700'}`}>LABELS: {showLabels ? 'ON' : 'OFF'}</button>
                </div>
            )}
            {activeControlTab === 'layers' && (
                <div className="flex flex-col gap-2 pt-4">
                    <div className="text-xs font-bold text-slate-400 uppercase border-b border-slate-800 pb-1">ULC System</div>
                    <div className="flex flex-col gap-2 h-[500px] overflow-y-auto custom-scrollbar">
                        {INITIAL_RENDER_ORDER.map(key => (
                            <div key={key} className="flex flex-col gap-1 mb-1">
                                <div className="p-2 border border-slate-800 rounded bg-slate-900/20 flex justify-between items-center">
                                    <span className="text-[10px] font-bold uppercase">{key.replace(/_/g, ' ')}</span>
                                    <div className="flex gap-2">
                                        <button 
                                            onClick={() => setActiveShapeEditorKey(activeShapeEditorKey === key ? null : key)}
                                            className={`text-[8px] px-2 py-1 border border-slate-700 hover:bg-slate-800 transition-colors uppercase font-bold ${activeShapeEditorKey === key ? 'bg-sky-500 text-white' : ''}`}
                                        >
                                            SHAPE
                                        </button>
                                        <label className="text-[8px] px-2 py-1 border border-slate-700 hover:bg-slate-800 cursor-pointer transition-colors uppercase font-bold">
                                            UPLOAD
                                            <input type="file" accept="image/*" className="hidden" onChange={(e) => handleULCUpload(key, e)} />
                                        </label>
                                    </div>
                                </div>
                                {activeShapeEditorKey === key && (
                                    <div className="p-2 border border-slate-800 bg-slate-900/40 rounded-b">
                                        <div className="text-[8px] text-slate-500 uppercase mb-1 flex justify-between">
                                            <span>SVG Path (d attribute)</span>
                                            <button onClick={() => setPartCustomPaths(p => ({ ...p, [key]: undefined }))} className="text-red-500 hover:underline">RESET</button>
                                        </div>
                                        <textarea 
                                            className="w-full h-24 bg-black text-sky-400 text-[10px] p-2 rounded border border-slate-800 focus:border-sky-500 outline-none font-mono"
                                            placeholder="M 0 0 L 10 10 ..."
                                            value={partCustomPaths[key] || ''}
                                            onChange={(e) => setPartCustomPaths(p => ({ ...p, [key]: e.target.value }))}
                                        />
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}
          </div>
          <SystemLogger logs={recordingHistory} isVisible={true} onLogMouseEnter={setOnionSkinData} onLogMouseLeave={() => setOnionSkinData(null)} onLogClick={()=>{}} selectedLogIndex={null} />
        </div>
      )}
      <div className="flex-1 relative flex items-center justify-center bg-black overflow-hidden" onClick={() => !isCalibrated && animatePoseTransition(T_POSE, 500, () => {setIsCalibrated(true); setIsConsoleVisible(true);})}>
        {!isCalibrated && <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-50 animate-pulse"><span className="text-6xl font-black uppercase tracking-tighter text-white">CLICK TO ACTIVATE RIG</span></div>}
        <svg viewBox={`${viewBoxCenter.x - 500} ${viewBoxCenter.y - 700} 1000 1400`} className="w-full h-full drop-shadow-2xl overflow-visible relative">
          <defs>
              <pattern id="smallGrid" width="10" height="10" patternUnits="userSpaceOnUse"><path d="M 10 0 L 0 0 0 10" fill="none" stroke="#1e293b" strokeWidth="0.5"/></pattern>
              <pattern id="grid" width="100" height="100" patternUnits="userSpaceOnUse"><rect width="100" height="100" fill="url(#smallGrid)"/><path d="M 100 0 L 0 0 0 100" fill="none" stroke="#334155" strokeWidth="1"/></pattern>
          </defs>
          <rect x="-2000" y="-2000" width="4000" height="4000" fill="url(#grid)" />
          {backgroundImage && (<image href={backgroundImage} x="-1000" y="-1000" width="2000" height="2000" transform={`translate(${backgroundTransform.x}, ${backgroundTransform.y}) rotate(${backgroundTransform.rotation}) scale(${backgroundTransform.scale})`} />)}
          <g transform={`translate(${physicsState.position.x}, ${physicsState.position.y}) rotate(${bodyRotation})`}>
            {staticGhostPose && <Mannequin pose={RESTING_BASE_POSE} pivotOffsets={staticGhostPose} props={props} isGhost={true} ghostOpacity={0.2} showPivots={false} showLabels={false} baseUnitH={baseH} onAnchorMouseDown={()=>{}} onBodyMouseDown={()=>{}} draggingBoneKey={null} selectedBoneKeys={new Set()} isPaused={true} partZOrder={partZOrder} />}
            {onionSkinData && <Mannequin pose={RESTING_BASE_POSE} pivotOffsets={onionSkinData.pivotOffsets} props={onionSkinData.props} isGhost={true} ghostOpacity={0.3} showPivots={false} showLabels={false} baseUnitH={baseH} onAnchorMouseDown={()=>{}} onBodyMouseDown={()=>{}} draggingBoneKey={null} selectedBoneKeys={new Set()} isPaused={true} partZOrder={partZOrder} />}
            <Mannequin 
                pose={RESTING_BASE_POSE} 
                pivotOffsets={previewPivotOffsets || pivotOffsets} 
                props={props} 
                showPivots={isCalibrated} 
                showLabels={showLabels} 
                showRig={showRig}
                baseUnitH={baseH} 
                onAnchorMouseDown={(k, x) => startDrag(k, x)} 
                onBodyMouseDown={(k, x) => startDrag(k, x)} 
                draggingBoneKey={null} 
                selectedBoneKeys={new Set()} 
                isPaused={true} 
                partTextures={partTextures} 
                maskTransforms={maskTransforms} 
                partCustomPaths={partCustomPaths}
                onPositionsUpdate={setAllJointPositions} 
                partZOrder={partZOrder} 
            />
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
