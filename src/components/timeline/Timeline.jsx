import { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { useAnimationStore, RESOLUTION_PRESETS } from '../../store/animationStore';
import { useGraphStore } from '../../store/graphStore';
import { useNodeRegistryStore } from '../../store/nodeRegistryStore';
import { EASING_OPTIONS } from '../../utils/interpolation';
import { exportAnimatedMP4 } from '../../utils/animatedExport';

export default function Timeline() {
  const enabled = useAnimationStore((s) => s.enabled);
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
  const goToStart = useAnimationStore((s) => s.goToStart);
  const goToEnd = useAnimationStore((s) => s.goToEnd);
  const allKeyframes = useAnimationStore((s) => s.keyframes);
  const removeKeyframe = useAnimationStore((s) => s.removeKeyframe);
  const setKeyframeEasing = useAnimationStore((s) => s.setKeyframeEasing);
  const removeAllKeyframes = useAnimationStore((s) => s.removeAllKeyframes);
  const moveKeyframesAtFrame = useAnimationStore((s) => s.moveKeyframesAtFrame);
  const resolution = useAnimationStore((s) => s.resolution);
  const setResolution = useAnimationStore((s) => s.setResolution);
  const getResolution = useAnimationStore((s) => s.getResolution);
  const showCameraFrame = useAnimationStore((s) => s.showCameraFrame);
  const setShowCameraFrame = useAnimationStore((s) => s.setShowCameraFrame);

  const [contextMenu, setContextMenu] = useState(null);
  const [exporting, setExporting] = useState(false);
  const [exportProgress, setExportProgress] = useState(0);
  const [readyBlob, setReadyBlob] = useState(null);
  const [editingField, setEditingField] = useState(null);
  const [kfDrag, setKfDrag] = useState(null);
  const scrubberRef = useRef(null);
  const kfDragRef = useRef(null);

  const allKeyframeFrames = useMemo(() => {
    const frameSet = new Set();
    for (const nodeKfs of Object.values(allKeyframes)) {
      for (const paramKfs of Object.values(nodeKfs)) {
        for (const f of Object.keys(paramKfs)) frameSet.add(Number(f));
      }
    }
    return [...frameSet].sort((a, b) => a - b);
  }, [allKeyframes]);

  const keyframeDetails = useMemo(() => {
    const details = {};
    for (const [nodeId, nodeKfs] of Object.entries(allKeyframes)) {
      for (const [paramId, paramKfs] of Object.entries(nodeKfs)) {
        for (const f of Object.keys(paramKfs)) {
          const fn = Number(f);
          if (!details[fn]) details[fn] = [];
          details[fn].push({ nodeId, paramId, ...paramKfs[f] });
        }
      }
    }
    return details;
  }, [allKeyframes]);

  const handleScrub = useCallback((e) => {
    const bar = scrubberRef.current;
    if (!bar) return;
    const rect = bar.getBoundingClientRect();
    const x = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
    setCurrentFrame(Math.round(x * duration));
  }, [duration, setCurrentFrame]);

  const handleScrubDown = useCallback((e) => {
    if (e.button !== 0) return;
    handleScrub(e);
    const onMove = (ev) => handleScrub(ev);
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [handleScrub]);

  const handleKfDragDown = useCallback((e, frame) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const bar = scrubberRef.current;
    if (!bar) return;
    kfDragRef.current = { fromFrame: frame, currentFrame: frame };
    setKfDrag({ from: frame, to: frame });
    const onMove = (ev) => {
      const rect = bar.getBoundingClientRect();
      const x = Math.max(0, Math.min(1, (ev.clientX - rect.left) / rect.width));
      const newFrame = Math.round(x * duration);
      if (kfDragRef.current) kfDragRef.current.currentFrame = newFrame;
      setKfDrag({ from: frame, to: newFrame });
      setCurrentFrame(newFrame);
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      if (kfDragRef.current) {
        const { fromFrame, currentFrame: toFrame } = kfDragRef.current;
        if (fromFrame !== toFrame) {
          moveKeyframesAtFrame(fromFrame, toFrame);
        }
        kfDragRef.current = null;
      }
      setKfDrag(null);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, [duration, setCurrentFrame, moveKeyframesAtFrame]);

  const handleKeyframeContextMenu = useCallback((e, frame) => {
    e.preventDefault();
    e.stopPropagation();
    const details = keyframeDetails[frame];
    if (!details || details.length === 0) return;
    setContextMenu({ x: e.clientX, y: e.clientY, frame, details });
  }, [keyframeDetails]);

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

  if (!enabled) return null;

  const pct = duration > 0 ? (currentFrame / duration) * 100 : 0;
  const hasKeys = allKeyframeFrames.length > 0;

  const handleExport = async () => {
    try {
      const gNodes = useGraphStore.getState().nodes;
      const gEdges = useGraphStore.getState().edges;
      const gDisplay = useGraphStore.getState().displayNodeId;
      const defs = useNodeRegistryStore.getState().definitions;
      const res = getResolution();

      const svgEl = document.getElementById('viewport-svg');
      let camViewBox;
      if (svgEl) {
        const vbAttr = svgEl.getAttribute('viewBox');
        if (vbAttr) {
          const vb = vbAttr.split(' ').map(Number);
          const vbx = vb[0], vby = vb[1], vbw = vb[2], vbh = vb[3];
          const aspect = res.width / res.height;
          const vbAspect = vbw / vbh;
          let fw, fh;
          if (vbAspect > aspect) { fh = vbh * 0.85; fw = fh * aspect; }
          else { fw = vbw * 0.85; fh = fw / aspect; }
          const cx = vbx + vbw / 2, cy = vby + vbh / 2;
          camViewBox = { x: cx - fw / 2, y: cy - fh / 2, w: fw, h: fh };
        }
      }
      if (!camViewBox) {
        const aspect = res.width / res.height;
        const hw = 400, hh = hw / aspect;
        camViewBox = { x: -hw, y: -hh, w: hw * 2, h: hh * 2 };
      }

      setExporting(true);
      const blob = await exportAnimatedMP4(
        gNodes, gEdges, defs, gDisplay,
        allKeyframes, duration, fps,
        res.width, res.height, camViewBox,
        (f, total) => setExportProgress(f / total)
      );
      setReadyBlob(blob);
    } catch (e) {
      console.error('Export failed:', e);
      alert('Export failed: ' + (e.message || e));
    } finally {
      setExporting(false);
      setExportProgress(0);
    }
  };

  const handleSaveFile = async () => {
    if (!readyBlob) return;
    try {
      if (window.showSaveFilePicker) {
        const handle = await window.showSaveFilePicker({
          suggestedName: 'animation.mp4',
          types: [{ description: 'MP4 Video', accept: { 'video/mp4': ['.mp4'] } }],
        });
        const writable = await handle.createWritable();
        await writable.write(readyBlob);
        await writable.close();
      } else {
        const url = URL.createObjectURL(readyBlob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'animation.mp4';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        setTimeout(() => URL.revokeObjectURL(url), 5000);
      }
    } catch (e) {
      if (e.name !== 'AbortError') {
        console.error('Save failed:', e);
        alert('Save failed: ' + e.message);
      }
    }
    setReadyBlob(null);
  };

  return (
    <div className="playbar-wrap">
      {/* Row 1: Full-width scrubber */}
      <div className="pb-scrubber-row">
        <span className="pb-label" style={{ fontSize: 8, minWidth: 20, textAlign: 'right' }}>0</span>
        <div
          ref={scrubberRef}
          className="pb-scrubber"
          onMouseDown={handleScrubDown}
        >
          <ScrubberTicks duration={duration} fps={fps} />

          {allKeyframeFrames.map((f) => {
            const isDragging = kfDrag && kfDrag.from === f;
            const displayFrame = isDragging ? kfDrag.to : f;
            const x = duration > 0 ? (displayFrame / duration) * 100 : 0;
            return (
              <div
                key={f}
                className="pb-kf"
                style={{
                  left: `${x}%`,
                  cursor: isDragging ? 'grabbing' : 'grab',
                  opacity: isDragging ? 0.8 : 1,
                  background: isDragging ? '#fbbf24' : undefined,
                }}
                onMouseDown={(e) => handleKfDragDown(e, f)}
                onContextMenu={(e) => handleKeyframeContextMenu(e, f)}
                title={`Frame ${displayFrame} — drag to move, right-click to edit`}
              />
            );
          })}

          <div className="pb-playhead" style={{ left: `${pct}%` }}>
            <div className="pb-playhead-flag" />
            <div className="pb-playhead-line" />
          </div>
        </div>
        <FrameField
          value={duration}
          onChange={(v) => setDuration(v)}
          width={40}
          title="Duration — click to edit, scroll to adjust (max 500)"
        />
      </div>

      {/* Row 2: Transport controls and settings */}
      <div className="pb-controls-row">
        <div className="pb-group">
          <button onClick={goToStart} title="Go to start (Home)" className="pb-btn"><SkipBackIcon /></button>
          <button onClick={() => playing ? pause() : play()} title={playing ? 'Pause (Space)' : 'Play (Space)'} className="pb-btn pb-play">
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <button onClick={stop} title="Stop" className="pb-btn"><StopIcon /></button>
          <button onClick={goToEnd} title="Go to end (End)" className="pb-btn"><SkipFwdIcon /></button>
        </div>

        <div className="pb-sep" />

        <span className="pb-label" style={{ fontSize: 8 }}>Frame</span>
        <FrameField
          value={currentFrame}
          onChange={(v) => setCurrentFrame(v)}
          width={36}
          title="Current frame"
        />

        <div className="pb-sep" />

        <span className="pb-label">FPS</span>
        <FrameField value={fps} onChange={(v) => setFps(v)} width={28} title="Frames per second" />

        <button
          onClick={() => setLoop(!loop)}
          title={loop ? 'Loop: On' : 'Loop: Off'}
          className={`pb-btn ${loop ? 'pb-active' : ''}`}
        >
          <LoopIcon />
        </button>

        <div style={{ flex: 1 }} />

        <select
          value={resolution}
          onChange={(e) => setResolution(e.target.value)}
          title="Export resolution"
          style={{
            height: 18, fontSize: 9, borderRadius: 2, padding: '0 2px',
            background: 'var(--bg-primary)', color: 'var(--text-secondary)',
            border: '1px solid var(--border-primary)', outline: 'none',
            cursor: 'pointer', flexShrink: 0,
          }}
        >
          {RESOLUTION_PRESETS.map((p) => (
            <option key={p.id} value={p.id}>{p.label}</option>
          ))}
        </select>

        <button
          onClick={() => setShowCameraFrame(!showCameraFrame)}
          title={showCameraFrame ? 'Hide camera frame' : 'Show camera frame'}
          className={`pb-btn ${showCameraFrame ? 'pb-active' : ''}`}
        >
          <CameraIcon />
        </button>

        {readyBlob ? (
          <button
            onClick={handleSaveFile}
            className="pb-btn"
            title="Save animation.mp4"
            style={{ color: 'var(--accent)', fontWeight: 700, width: 'auto', padding: '0 6px', fontSize: 9 }}
          >
            Save
          </button>
        ) : exporting ? (
          <span className="pb-label" style={{ color: 'var(--accent)' }}>
            {Math.round(exportProgress * 100)}%
          </span>
        ) : (
          <button
            onClick={handleExport}
            className="pb-btn"
            title="Export animation as MP4"
          >
            <ExportIcon />
          </button>
        )}
      </div>

      {/* Context menu for keyframe editing */}
      {contextMenu && (
        <div
          className="fixed z-[9999] rounded border border-border-primary bg-bg-primary shadow-lg py-1"
          style={{ left: contextMenu.x, top: contextMenu.y - 10, minWidth: 180, transform: 'translateY(-100%)' }}
        >
          <div className="px-3 py-1 text-[10px] font-semibold text-text-secondary border-b border-border-primary">
            Frame {contextMenu.frame} — {contextMenu.details.length} key(s)
          </div>
          <div className="px-3 py-1 text-[9px] text-text-muted uppercase tracking-wide">Easing</div>
          {EASING_OPTIONS.map((opt) => (
            <button
              key={opt.id}
              className="block w-full text-left px-3 py-1 text-[11px] text-text-primary hover:bg-bg-tertiary"
              onClick={() => {
                for (const d of contextMenu.details) {
                  setKeyframeEasing(d.nodeId, d.paramId, contextMenu.frame, opt.id);
                }
                setContextMenu(null);
              }}
            >
              {opt.label}
            </button>
          ))}
          <div className="border-t border-border-primary mt-1 pt-1">
            <button
              className="block w-full text-left px-3 py-1 text-[11px] text-red-400 hover:bg-bg-tertiary"
              onClick={() => {
                for (const d of contextMenu.details) {
                  removeKeyframe(d.nodeId, d.paramId, contextMenu.frame);
                }
                setContextMenu(null);
              }}
            >
              Delete keyframe(s) at frame {contextMenu.frame}
            </button>
          </div>
        </div>
      )}

      <style>{`
        .playbar-wrap {
          display: flex;
          flex-direction: column;
          background: var(--bg-secondary);
          user-select: none;
          font-size: 10px;
        }
        .pb-scrubber-row {
          display: flex;
          align-items: center;
          gap: 4px;
          padding: 4px 8px 2px 8px;
        }
        .pb-controls-row {
          display: flex;
          align-items: center;
          gap: 2px;
          padding: 0 8px 4px 8px;
        }
        .pb-group { display: flex; align-items: center; gap: 1px; }
        .pb-sep { width: 1px; height: 16px; background: var(--border-primary); margin: 0 4px; flex-shrink: 0; }
        .pb-btn {
          display: flex; align-items: center; justify-content: center;
          width: 20px; height: 20px; border-radius: 3px; flex-shrink: 0;
          color: var(--text-muted); transition: all 0.1s;
          background: none; border: none; cursor: pointer; padding: 0;
        }
        .pb-btn:hover { background: var(--bg-tertiary); color: var(--text-primary); }
        .pb-play { color: var(--text-primary); }
        .pb-play:hover { color: var(--accent); }
        .pb-active { color: var(--accent) !important; }
        .pb-label { color: var(--text-muted); font-size: 9px; letter-spacing: 0.03em; flex-shrink: 0; }

        .pb-scrubber {
          flex: 1; height: 22px; position: relative; cursor: pointer;
          background: var(--bg-primary); border-radius: 3px;
          border: 1px solid var(--border-primary);
          min-width: 60px;
        }
        .pb-kf {
          position: absolute; top: 50%; width: 8px; height: 8px;
          transform: translate(-50%, -50%) rotate(45deg);
          background: #f59e0b; border: 1px solid #b45309;
          z-index: 4; cursor: grab; pointer-events: auto;
        }
        .pb-kf::before {
          content: ''; position: absolute;
          top: -6px; left: -6px; right: -6px; bottom: -6px;
          cursor: grab;
        }
        .pb-kf:active { cursor: grabbing; }
        .pb-playhead {
          position: absolute; top: 0; bottom: 0; z-index: 3; pointer-events: none;
          transform: translateX(-50%);
        }
        .pb-playhead-flag {
          width: 8px; height: 6px; background: var(--accent);
          clip-path: polygon(0 0, 100% 0, 50% 100%);
          margin-left: -3px;
        }
        .pb-playhead-line {
          width: 2px; background: var(--accent);
          position: absolute; top: 6px; bottom: 0; left: -0.5px;
        }
      `}</style>
    </div>
  );
}

function FrameField({ value, onChange, readOnly, width = 32, highlight, title }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');

  const handleWheel = useCallback((e) => {
    if (readOnly || !onChange) return;
    e.preventDefault();
    const delta = e.deltaY < 0 ? 10 : -10;
    onChange(value + delta);
  }, [readOnly, onChange, value]);

  if (readOnly || !onChange) {
    return (
      <span
        className="pb-label"
        style={{ minWidth: width, textAlign: 'center', fontVariantNumeric: 'tabular-nums' }}
        title={title}
      >
        {value}
      </span>
    );
  }

  if (editing) {
    return (
      <input
        autoFocus
        type="number"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => { onChange(parseInt(draft) || 0); setEditing(false); }}
        onKeyDown={(e) => { if (e.key === 'Enter') { onChange(parseInt(draft) || 0); setEditing(false); } if (e.key === 'Escape') setEditing(false); }}
        style={{
          width, height: 18, border: '1px solid var(--accent)', borderRadius: 2,
          background: 'var(--bg-primary)', color: 'var(--text-primary)', fontSize: 10,
          textAlign: 'center', outline: 'none', padding: 0,
          fontVariantNumeric: 'tabular-nums',
        }}
      />
    );
  }

  return (
    <span
      onClick={() => { setDraft(String(value)); setEditing(true); }}
      onWheel={handleWheel}
      style={{
        minWidth: width, textAlign: 'center', cursor: 'text', borderRadius: 2,
        padding: '1px 2px', fontVariantNumeric: 'tabular-nums',
        background: 'var(--bg-primary)',
        border: '1px solid var(--border-primary)',
        color: 'var(--text-primary)',
        fontSize: 10,
      }}
      title={title}
    >
      {value}
    </span>
  );
}

function ScrubberTicks({ duration, fps }) {
  const ticks = [];
  if (duration <= 0) return null;
  const step = Math.max(fps, 1);
  for (let f = 0; f <= duration; f += step) {
    const pct = (f / duration) * 100;
    ticks.push(
      <div key={f} style={{
        position: 'absolute', left: `${pct}%`, top: 0, bottom: 0, width: 1,
        background: 'var(--border-primary)', opacity: 0.4,
      }}>
        <span style={{
          position: 'absolute', bottom: 1, left: 2,
          fontSize: 7, color: 'var(--text-muted)', lineHeight: 1,
        }}>
          {f}
        </span>
      </div>
    );
  }
  return <>{ticks}</>;
}

function PlayIcon() {
  return <svg width="10" height="10" viewBox="0 0 10 10"><polygon points="1,0 10,5 1,10" fill="currentColor"/></svg>;
}
function PauseIcon() {
  return <svg width="10" height="10" viewBox="0 0 10 10"><rect x="1" y="0" width="3" height="10" rx="0.5" fill="currentColor"/><rect x="6" y="0" width="3" height="10" rx="0.5" fill="currentColor"/></svg>;
}
function StopIcon() {
  return <svg width="8" height="8" viewBox="0 0 8 8"><rect x="0" y="0" width="8" height="8" rx="1" fill="currentColor"/></svg>;
}
function SkipBackIcon() {
  return <svg width="10" height="10" viewBox="0 0 10 10"><rect x="0" y="1" width="1.5" height="8" fill="currentColor"/><polygon points="9,1 3,5 9,9" fill="currentColor"/></svg>;
}
function SkipFwdIcon() {
  return <svg width="10" height="10" viewBox="0 0 10 10"><polygon points="1,1 7,5 1,9" fill="currentColor"/><rect x="8.5" y="1" width="1.5" height="8" fill="currentColor"/></svg>;
}
function LoopIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 12 12" fill="none" stroke="currentColor" strokeWidth="1.4">
      <path d="M1 7.5a4.5 4.5 0 0 0 8 1M11 4.5a4.5 4.5 0 0 0-8-1"/>
      <polyline points="9,10 9,8 11,8.5" fill="currentColor" stroke="none"/>
      <polyline points="3,2 3,4 1,3.5" fill="currentColor" stroke="none"/>
    </svg>
  );
}
function ExportIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.2">
      <path d="M5 1v5M3 4l2 2 2-2M1 7v1.5a.5.5 0 00.5.5h7a.5.5 0 00.5-.5V7"/>
    </svg>
  );
}
function CameraIcon() {
  return (
    <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
      <rect x="1" y="2" width="8" height="6" rx="0.5"/>
      <rect x="2.5" y="3.5" width="5" height="3" rx="0.3" strokeDasharray="1 0.5"/>
    </svg>
  );
}
