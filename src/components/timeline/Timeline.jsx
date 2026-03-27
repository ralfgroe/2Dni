import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useAnimationStore } from '../../store/animationStore';
import { useGraphStore } from '../../store/graphStore';
import { useNodeRegistryStore } from '../../store/nodeRegistryStore';
import { EASING_OPTIONS } from '../../utils/interpolation';
import { exportAnimatedWebM } from '../../utils/animatedExport';

export default function Timeline() {
  const enabled = useAnimationStore((s) => s.enabled);
  const toggleEnabled = useAnimationStore((s) => s.toggleEnabled);
  const duration = useAnimationStore((s) => s.duration);
  const fps = useAnimationStore((s) => s.fps);
  const currentFrame = useAnimationStore((s) => s.currentFrame);
  const playing = useAnimationStore((s) => s.playing);
  const loop = useAnimationStore((s) => s.loop);
  const setDuration = useAnimationStore((s) => s.setDuration);
  const setFps = useAnimationStore((s) => s.setFps);
  const setCurrentFrame = useAnimationStore((s) => s.setCurrentFrame);
  const setLoop = useAnimationStore((s) => s.setLoop);
  const play = useAnimationStore((s) => s.play);
  const pause = useAnimationStore((s) => s.pause);
  const stop = useAnimationStore((s) => s.stop);
  const stepForward = useAnimationStore((s) => s.stepForward);
  const stepBackward = useAnimationStore((s) => s.stepBackward);
  const goToStart = useAnimationStore((s) => s.goToStart);
  const goToEnd = useAnimationStore((s) => s.goToEnd);
  const allKeyframes = useAnimationStore((s) => s.keyframes);
  const removeKeyframe = useAnimationStore((s) => s.removeKeyframe);
  const setKeyframeEasing = useAnimationStore((s) => s.setKeyframeEasing);
  const removeAllKeyframes = useAnimationStore((s) => s.removeAllKeyframes);
  const getAnimatedTracks = useAnimationStore((s) => s.getAnimatedTracks);

  const nodes = useGraphStore((s) => s.nodes);
  const definitions = useNodeRegistryStore((s) => s.definitions);

  const [contextMenu, setContextMenu] = useState(null);
  const [collapsed, setCollapsed] = useState({});
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const trackAreaRef = useRef(null);

  const tracks = useMemo(() => getAnimatedTracks(), [allKeyframes]);

  const nodeLabels = useMemo(() => {
    const map = {};
    for (const n of nodes) {
      const def = definitions[n.data.definitionId];
      map[n.id] = def ? `${def.label} (${n.id})` : n.id;
    }
    return map;
  }, [nodes, definitions]);

  const paramLabels = useMemo(() => {
    const map = {};
    for (const n of nodes) {
      const def = definitions[n.data.definitionId];
      if (!def) continue;
      map[n.id] = {};
      for (const p of def.parameters || []) {
        map[n.id][p.id] = p.label || p.id;
      }
    }
    return map;
  }, [nodes, definitions]);

  const groupedTracks = useMemo(() => {
    const groups = {};
    for (const t of tracks) {
      if (!groups[t.nodeId]) groups[t.nodeId] = [];
      groups[t.nodeId].push(t);
    }
    return groups;
  }, [tracks]);

  const handleScrub = useCallback((e) => {
    const area = trackAreaRef.current;
    if (!area) return;
    const rect = area.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setCurrentFrame(Math.round(x * duration));
  }, [duration, setCurrentFrame]);

  const handleScrubDown = useCallback((e) => {
    handleScrub(e);
    const onMove = (ev) => handleScrub(ev);
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [handleScrub]);

  const handleKeyframeContextMenu = useCallback((e, nodeId, paramId, frame) => {
    e.preventDefault();
    e.stopPropagation();
    setContextMenu({ x: e.clientX, y: e.clientY, nodeId, paramId, frame });
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const close = () => setContextMenu(null);
    window.addEventListener('click', close);
    return () => window.removeEventListener('click', close);
  }, [contextMenu]);

  useEffect(() => {
    if (!enabled) return;
    const handler = (e) => {
      if (e.code === 'Space' && !e.target.closest('input, textarea, select')) {
        e.preventDefault();
        playing ? pause() : play();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [enabled, playing, play, pause]);

  if (!enabled) {
    return (
      <div className="flex h-full items-center justify-center bg-bg-primary border-t border-border-primary">
        <button
          onClick={toggleEnabled}
          className="flex items-center gap-2 rounded-lg bg-accent px-4 py-2 text-xs font-medium text-white hover:bg-accent-hover transition-colors"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>
          </svg>
          Enable Animation Timeline
        </button>
      </div>
    );
  }

  const timeText = `${(currentFrame / fps).toFixed(1)}s`;
  const totalTimeText = `${(duration / fps).toFixed(1)}s`;

  return (
    <div className="flex h-full flex-col bg-bg-primary border-t border-border-primary select-none" style={{ minHeight: 0 }}>
      {/* Transport bar */}
      <div className="flex shrink-0 items-center gap-1 border-b border-border-primary px-3" style={{ height: 32 }}>
        <button onClick={goToStart} title="Go to start" className="tl-btn"><SkipBackIcon /></button>
        <button onClick={stepBackward} title="Step back" className="tl-btn"><StepBackIcon /></button>
        {playing
          ? <button onClick={pause} title="Pause" className="tl-btn tl-btn-accent"><PauseIcon /></button>
          : <button onClick={play} title="Play" className="tl-btn tl-btn-accent"><PlayIcon /></button>
        }
        <button onClick={stop} title="Stop" className="tl-btn"><StopIcon /></button>
        <button onClick={stepForward} title="Step forward" className="tl-btn"><StepFwdIcon /></button>
        <button onClick={goToEnd} title="Go to end" className="tl-btn"><SkipFwdIcon /></button>

        <div className="mx-2 h-4 w-px bg-border-primary" />

        <span className="text-[10px] text-text-secondary font-mono tabular-nums" style={{ minWidth: 90 }}>
          {currentFrame} / {duration} &middot; {timeText}
        </span>

        <div className="mx-2 h-4 w-px bg-border-primary" />

        <label className="flex items-center gap-1 text-[10px] text-text-muted">
          Dur
          <input
            type="number"
            value={duration}
            onChange={(e) => setDuration(parseInt(e.target.value) || 120)}
            className="w-12 rounded border border-border-primary bg-bg-secondary px-1 py-0.5 text-[10px] text-text-primary outline-none"
          />
        </label>

        <label className="flex items-center gap-1 text-[10px] text-text-muted">
          FPS
          <input
            type="number"
            value={fps}
            onChange={(e) => setFps(parseInt(e.target.value) || 30)}
            className="w-10 rounded border border-border-primary bg-bg-secondary px-1 py-0.5 text-[10px] text-text-primary outline-none"
          />
        </label>

        <button
          onClick={() => setLoop(!loop)}
          title={loop ? 'Loop: On' : 'Loop: Off'}
          className={`tl-btn ${loop ? 'text-accent' : ''}`}
        >
          <LoopIcon />
        </button>

        <div className="flex-1" />

        {exporting ? (
          <span className="text-[10px] text-accent font-medium">
            Exporting... {Math.round(exportProgress * 100)}%
          </span>
        ) : (
          <button
            onClick={async () => {
              const gNodes = useGraphStore.getState().nodes;
              const gEdges = useGraphStore.getState().edges;
              const gDisplay = useGraphStore.getState().displayNodeId;
              const defs = useNodeRegistryStore.getState().definitions;
              setExporting(true);
              try {
                await exportAnimatedWebM(
                  gNodes, gEdges, defs, gDisplay,
                  allKeyframes, duration, fps,
                  1280, 720,
                  (f, total) => setExportProgress(f / total)
                );
              } catch (e) {
                console.error('Export failed:', e);
              }
              setExporting(false);
              setExportProgress(0);
            }}
            disabled={tracks.length === 0}
            className="text-[10px] text-text-secondary hover:text-accent disabled:opacity-30"
            title="Export animation as WebM"
          >
            Export WebM
          </button>
        )}

        <span className="text-[10px] text-text-muted">{totalTimeText}</span>

        <button
          onClick={toggleEnabled}
          title="Disable timeline"
          className="tl-btn text-text-muted hover:text-red-400"
        >
          <svg width="10" height="10" viewBox="0 0 10 10"><path d="M1 1l8 8M9 1l-8 8" stroke="currentColor" strokeWidth="1.5"/></svg>
        </button>
      </div>

      {/* Track area */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden" style={{ minHeight: 0 }}>
        {tracks.length === 0 ? (
          <div className="flex h-full items-center justify-center text-[11px] text-text-muted">
            No keyframes yet. Select a node and click the diamond next to a slider to add one.
          </div>
        ) : (
          <div className="flex flex-col">
            {Object.entries(groupedTracks).map(([nodeId, nodeTracks]) => (
              <div key={nodeId}>
                <div
                  className="flex items-center gap-1 px-3 py-1 text-[10px] font-semibold text-text-secondary bg-bg-secondary cursor-pointer hover:bg-bg-tertiary"
                  onClick={() => setCollapsed((c) => ({ ...c, [nodeId]: !c[nodeId] }))}
                >
                  <span style={{ transform: collapsed[nodeId] ? 'rotate(-90deg)' : 'rotate(0deg)', transition: 'transform 0.15s' }}>
                    &#9662;
                  </span>
                  {nodeLabels[nodeId] || nodeId}
                  <span className="text-text-muted font-normal ml-1">({nodeTracks.length} tracks)</span>
                </div>

                {!collapsed[nodeId] && nodeTracks.map(({ paramId, frames }) => (
                  <div key={`${nodeId}_${paramId}`} className="flex items-center" style={{ height: 24 }}>
                    <div className="shrink-0 truncate text-[10px] text-text-muted pl-6 pr-2" style={{ width: 140 }}>
                      {paramLabels[nodeId]?.[paramId] || paramId}
                    </div>
                    <div
                      ref={trackAreaRef}
                      className="relative flex-1 h-full cursor-pointer"
                      onMouseDown={handleScrubDown}
                    >
                      <div className="absolute inset-0 border-b border-border-primary" style={{ opacity: 0.3 }} />

                      {Object.entries(frames).map(([frameStr, kf]) => {
                        const f = Number(frameStr);
                        const pct = duration > 0 ? (f / duration) * 100 : 0;
                        return (
                          <div
                            key={f}
                            className="absolute top-1/2 -translate-y-1/2 -translate-x-1/2 cursor-pointer"
                            style={{ left: `${pct}%` }}
                            onContextMenu={(e) => handleKeyframeContextMenu(e, nodeId, paramId, f)}
                            title={`Frame ${f}: ${kf.value.toFixed?.(2) ?? kf.value} (${kf.easing})`}
                          >
                            <svg width="10" height="10" viewBox="0 0 10 10">
                              <rect x="1" y="1" width="8" height="8" rx="1" transform="rotate(45 5 5)" fill="#f59e0b" stroke="#b45309" strokeWidth="0.8" />
                            </svg>
                          </div>
                        );
                      })}

                      {/* Playhead indicator */}
                      <div
                        className="absolute top-0 bottom-0 w-px bg-accent"
                        style={{ left: `${duration > 0 ? (currentFrame / duration) * 100 : 0}%`, pointerEvents: 'none' }}
                      />
                    </div>
                  </div>
                ))}
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Scrubber bar along bottom */}
      <div
        className="shrink-0 relative cursor-pointer bg-bg-secondary border-t border-border-primary"
        style={{ height: 16 }}
        onMouseDown={handleScrubDown}
      >
        {/* Frame ticks */}
        <FrameTicks duration={duration} fps={fps} />

        {/* Playhead */}
        <div
          className="absolute top-0 bottom-0 w-0.5 bg-accent"
          style={{ left: `${duration > 0 ? (currentFrame / duration) * 100 : 0}%` }}
        >
          <div className="absolute -top-0.5 left-1/2 -translate-x-1/2 w-2 h-2 bg-accent rounded-sm rotate-45" />
        </div>
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 rounded-lg border border-border-primary bg-bg-primary shadow-lg py-1"
          style={{ left: contextMenu.x, top: contextMenu.y, minWidth: 160 }}
        >
          <div className="px-3 py-1 text-[10px] text-text-muted border-b border-border-primary">
            Frame {contextMenu.frame}
          </div>
          <div className="px-3 py-1 text-[10px] text-text-muted">Easing:</div>
          {EASING_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              className="block w-full text-left px-3 py-1 text-[11px] text-text-primary hover:bg-bg-tertiary"
              onClick={() => {
                setKeyframeEasing(contextMenu.nodeId, contextMenu.paramId, contextMenu.frame, opt.id);
                setContextMenu(null);
              }}
            >
              {opt.label}
              {allKeyframes[contextMenu.nodeId]?.[contextMenu.paramId]?.[contextMenu.frame]?.easing === opt.id && ' *'}
            </button>
          ))}
          <div className="border-t border-border-primary mt-1 pt-1">
            <button
              className="block w-full text-left px-3 py-1 text-[11px] text-red-400 hover:bg-bg-tertiary"
              onClick={() => {
                removeKeyframe(contextMenu.nodeId, contextMenu.paramId, contextMenu.frame);
                setContextMenu(null);
              }}
            >
              Delete Keyframe
            </button>
            <button
              className="block w-full text-left px-3 py-1 text-[11px] text-red-400 hover:bg-bg-tertiary"
              onClick={() => {
                removeAllKeyframes(contextMenu.nodeId, contextMenu.paramId);
                setContextMenu(null);
              }}
            >
              Delete All Keyframes
            </button>
          </div>
        </div>
      )}

      <style>{`
        .tl-btn {
          display: flex; align-items: center; justify-content: center;
          width: 22px; height: 22px; border-radius: 4px;
          color: var(--text-secondary); transition: background 0.1s;
        }
        .tl-btn:hover { background: var(--bg-tertiary); }
        .tl-btn-accent { color: var(--accent); }
      `}</style>
    </div>
  );
}

function FrameTicks({ duration, fps }) {
  const ticks = [];
  const majorEvery = fps;
  for (let f = 0; f <= duration; f += majorEvery) {
    const pct = duration > 0 ? (f / duration) * 100 : 0;
    ticks.push(
      <div key={f} className="absolute top-0 bottom-0 flex flex-col items-center" style={{ left: `${pct}%` }}>
        <div className="w-px h-full bg-border-primary" style={{ opacity: 0.5 }} />
        <span className="absolute bottom-0 text-[7px] text-text-muted" style={{ transform: 'translateX(-50%)' }}>
          {f}
        </span>
      </div>
    );
  }
  return <>{ticks}</>;
}

function PlayIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12"><polygon points="2,0 12,6 2,12" fill="currentColor"/></svg>;
}
function PauseIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="1" width="3" height="10" fill="currentColor"/><rect x="7" y="1" width="3" height="10" fill="currentColor"/></svg>;
}
function StopIcon() {
  return <svg width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="1" width="8" height="8" rx="1" fill="currentColor"/></svg>;
}
function StepBackIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12"><rect x="1" y="2" width="2" height="8" fill="currentColor"/><polygon points="11,2 5,6 11,10" fill="currentColor"/></svg>;
}
function StepFwdIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12"><polygon points="1,2 7,6 1,10" fill="currentColor"/><rect x="9" y="2" width="2" height="8" fill="currentColor"/></svg>;
}
function SkipBackIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12"><rect x="0" y="2" width="2" height="8" fill="currentColor"/><polygon points="7,2 2,6 7,10" fill="currentColor"/><polygon points="12,2 7,6 12,10" fill="currentColor"/></svg>;
}
function SkipFwdIcon() {
  return <svg width="12" height="12" viewBox="0 0 12 12"><polygon points="0,2 5,6 0,10" fill="currentColor"/><polygon points="5,2 10,6 5,10" fill="currentColor"/><rect x="10" y="2" width="2" height="8" fill="currentColor"/></svg>;
}
function LoopIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.3">
      <path d="M1 7.5a4.5 4.5 0 0 0 8 1M11 4.5a4.5 4.5 0 0 0-8-1"/>
      <polyline points="9,10 9,8 11,8.5" fill="currentColor" stroke="none"/>
      <polyline points="3,2 3,4 1,3.5" fill="currentColor" stroke="none"/>
    </svg>
  );
}
