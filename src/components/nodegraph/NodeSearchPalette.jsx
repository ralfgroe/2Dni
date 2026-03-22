import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useNodeRegistryStore } from '../../store/nodeRegistryStore';

export default function NodeSearchPalette({ position, onSelect, onClose }) {
  const [query, setQuery] = useState('');
  const [hoveredDef, setHoveredDef] = useState(null);
  const inputRef = useRef(null);
  const scrollRef = useRef(null);
  const paletteRef = useRef(null);
  const trackRef = useRef(null);
  const thumbRef = useRef(null);
  const [clampedTop, setClampedTop] = useState(position.y);
  const categories = useNodeRegistryStore((s) => s.categories);
  const getDefinitionsByCategory = useNodeRegistryStore((s) => s.getDefinitionsByCategory);
  const getAllDefinitions = useNodeRegistryStore((s) => s.getAllDefinitions);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleKey = (e) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [onClose]);

  useEffect(() => {
    const el = paletteRef.current;
    if (!el) return;
    const rect = el.getBoundingClientRect();
    const parent = el.offsetParent;
    const parentRect = parent ? parent.getBoundingClientRect() : { top: 0, height: window.innerHeight };
    const maxTop = parentRect.height - rect.height;
    if (position.y > maxTop) {
      setClampedTop(Math.max(0, maxTop));
    } else {
      setClampedTop(position.y);
    }
  });

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const handleWheel = (e) => {
      e.preventDefault();
      e.stopPropagation();
      el.scrollTop += e.deltaY;
    };
    el.addEventListener('wheel', handleWheel, { passive: false });
    return () => el.removeEventListener('wheel', handleWheel);
  }, []);

  const syncThumb = useCallback(() => {
    const el = scrollRef.current;
    const track = trackRef.current;
    const thumb = thumbRef.current;
    if (!el || !track || !thumb) return;
    const { scrollTop, scrollHeight, clientHeight } = el;
    const needsScroll = scrollHeight > clientHeight;
    track.style.display = needsScroll ? '' : 'none';
    if (!needsScroll) return;
    const thumbH = Math.max(24, (clientHeight / scrollHeight) * clientHeight);
    const maxScroll = scrollHeight - clientHeight;
    const thumbT = maxScroll > 0 ? (scrollTop / maxScroll) * (clientHeight - thumbH) : 0;
    thumb.style.height = thumbH + 'px';
    thumb.style.top = thumbT + 'px';
  }, []);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    syncThumb();
    el.addEventListener('scroll', syncThumb, { passive: true });
    const observer = new ResizeObserver(syncThumb);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', syncThumb);
      observer.disconnect();
    };
  }, [syncThumb]);

  useEffect(() => {
    syncThumb();
  });

  const handleThumbDrag = useCallback((e) => {
    e.preventDefault();
    const el = scrollRef.current;
    if (!el) return;
    const startY = e.clientY;
    const startScroll = el.scrollTop;
    const { scrollHeight, clientHeight } = el;
    const thumbH = Math.max(24, (clientHeight / scrollHeight) * clientHeight);
    const maxScroll = scrollHeight - clientHeight;
    const ratio = maxScroll / (clientHeight - thumbH);

    const onMove = (me) => {
      const dy = me.clientY - startY;
      el.scrollTop = Math.min(maxScroll, Math.max(0, startScroll + dy * ratio));
    };
    const onUp = () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
  }, []);

  const filtered = useMemo(() => {
    const all = getAllDefinitions();
    if (!query.trim()) return all;
    const q = query.toLowerCase();
    return all.filter(
      (d) =>
        d.label.toLowerCase().includes(q) ||
        d.category.toLowerCase().includes(q) ||
        d.description.toLowerCase().includes(q)
    );
  }, [query, getAllDefinitions]);

  const groupedFiltered = useMemo(() => {
    const groups = {};
    for (const def of filtered) {
      if (!groups[def.category]) groups[def.category] = [];
      groups[def.category].push(def);
    }
    for (const cat of Object.keys(groups)) {
      groups[cat].sort((a, b) => (a.sortOrder ?? 99) - (b.sortOrder ?? 99) || a.label.localeCompare(b.label));
    }
    return groups;
  }, [filtered]);

  const categoryOrder = ['Geometry', 'Transform', 'Appearance', 'I/O'];
  const orderedCategories = useMemo(() => {
    const present = Object.keys(groupedFiltered);
    const ordered = categoryOrder.filter((c) => present.includes(c));
    for (const c of present) {
      if (!ordered.includes(c)) ordered.push(c);
    }
    return ordered;
  }, [groupedFiltered]);

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />

      <div
        ref={paletteRef}
        className="absolute z-50 w-56 rounded-lg border border-border-primary bg-bg-panel shadow-xl"
        style={{ left: position.x, top: clampedTop }}
      >
        <div style={{ padding: '8px 8px 8px 12px' }}>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search nodes..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded border border-border-primary bg-bg-primary py-1.5 pr-2.5 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
            style={{ paddingLeft: '15px' }}
          />
        </div>

        <div className="relative" style={{ maxHeight: '256px' }}>
          <div
            ref={scrollRef}
            className="max-h-64 pb-1.5 palette-hide-scrollbar"
            style={{
              paddingLeft: '12px',
              paddingRight: '12px',
              overflowY: 'auto',
              scrollbarWidth: 'none',
              msOverflowStyle: 'none',
            }}
          >
            {Object.keys(groupedFiltered).length === 0 && (
              <div className="px-2 py-3 text-center text-xs text-text-muted">
                No matching nodes
              </div>
            )}

            {orderedCategories.map((cat) => (
              <div key={cat}>
                <div className="pt-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-text-muted" style={{ paddingLeft: '16px' }}>
                  {cat}
                </div>
                {groupedFiltered[cat].map((def) => (
                  <button
                    key={def.id}
                    onClick={() => onSelect(def)}
                    onMouseEnter={() => setHoveredDef(def)}
                    onMouseLeave={() => setHoveredDef(null)}
                    className="flex w-full items-center gap-2 rounded py-1.5 pr-4 text-left text-xs text-text-secondary transition-colors hover:bg-accent hover:text-white"
                    style={{ paddingLeft: '16px' }}
                  >
                    <span className="font-medium">{def.label}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>

          <div
            ref={trackRef}
            style={{
              position: 'absolute',
              top: 0,
              right: '2px',
              width: '6px',
              height: '100%',
              borderRadius: '3px',
              background: '#f0f0f0',
              pointerEvents: 'none',
            }}
          >
            <div
              ref={thumbRef}
              onMouseDown={handleThumbDrag}
              style={{
                position: 'absolute',
                top: 0,
                width: '6px',
                height: 24,
                borderRadius: '3px',
                background: '#c1c1c1',
                cursor: 'pointer',
                pointerEvents: 'auto',
              }}
            />
          </div>
        </div>

        {hoveredDef && (
          <div className="border-t border-border-primary" style={{ padding: '8px 10px 10px 12px' }}>
            <p className="text-[10px] leading-snug text-text-muted">{hoveredDef.description}</p>
          </div>
        )}
      </div>
    </>
  );
}
