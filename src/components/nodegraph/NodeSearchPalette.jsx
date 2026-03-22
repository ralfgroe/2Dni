import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useNodeRegistryStore } from '../../store/nodeRegistryStore';

export default function NodeSearchPalette({ position, onSelect, onClose }) {
  const [query, setQuery] = useState('');
  const [descriptionDef, setDescriptionDef] = useState(null);
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef(null);
  const scrollRef = useRef(null);
  const paletteRef = useRef(null);
  const trackRef = useRef(null);
  const thumbRef = useRef(null);
  const rafRef = useRef(null);
  const hoverTimerRef = useRef(null);
  const [clampedTop, setClampedTop] = useState(position.y);
  const categories = useNodeRegistryStore((s) => s.categories);
  const getDefinitionsByCategory = useNodeRegistryStore((s) => s.getDefinitionsByCategory);
  const getAllDefinitions = useNodeRegistryStore((s) => s.getAllDefinitions);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

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

  const scheduleSyncThumb = useCallback(() => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null;
      syncThumb();
    });
  }, [syncThumb]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    syncThumb();
    el.addEventListener('scroll', scheduleSyncThumb, { passive: true });
    const observer = new ResizeObserver(syncThumb);
    observer.observe(el);
    return () => {
      el.removeEventListener('scroll', scheduleSyncThumb);
      observer.disconnect();
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
    };
  }, [syncThumb, scheduleSyncThumb]);

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

  const flatList = useMemo(() => {
    const list = [];
    for (const cat of orderedCategories) {
      if (groupedFiltered[cat]) {
        for (const def of groupedFiltered[cat]) {
          list.push(def);
        }
      }
    }
    return list;
  }, [orderedCategories, groupedFiltered]);

  useEffect(() => {
    setSelectedIndex(-1);
  }, [query]);

  const handleKeyDown = useCallback((e) => {
    if (e.key === 'Escape') {
      onClose();
      return;
    }
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSelectedIndex((prev) => {
        const next = prev < flatList.length - 1 ? prev + 1 : 0;
        scrollToItem(next);
        return next;
      });
      return;
    }
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSelectedIndex((prev) => {
        const next = prev > 0 ? prev - 1 : flatList.length - 1;
        scrollToItem(next);
        return next;
      });
      return;
    }
    if (e.key === 'Enter') {
      e.preventDefault();
      if (selectedIndex >= 0 && selectedIndex < flatList.length) {
        onSelect(flatList[selectedIndex]);
      } else if (flatList.length === 1) {
        onSelect(flatList[0]);
      }
      return;
    }
  }, [flatList, selectedIndex, onSelect, onClose]);

  useEffect(() => {
    if (selectedIndex >= 0 && flatList[selectedIndex]) {
      setDescriptionDef(flatList[selectedIndex]);
    }
  }, [selectedIndex, flatList]);

  const scrollToItem = useCallback((index) => {
    const el = scrollRef.current;
    if (!el) return;
    const buttons = el.querySelectorAll('[data-node-btn]');
    if (buttons[index]) {
      buttons[index].scrollIntoView({ block: 'nearest' });
    }
  }, []);

  const handleMouseEnter = useCallback((def) => {
    clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setDescriptionDef(def);
      setSelectedIndex(-1);
    }, 60);
  }, []);

  const handleMouseLeave = useCallback(() => {
    clearTimeout(hoverTimerRef.current);
    hoverTimerRef.current = setTimeout(() => {
      setDescriptionDef(null);
    }, 100);
  }, []);

  useEffect(() => {
    return () => clearTimeout(hoverTimerRef.current);
  }, []);

  const stopWheel = useCallback((e) => {
    e.stopPropagation();
  }, []);

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />

      <div
        ref={paletteRef}
        className="absolute z-50 w-56 rounded-lg border border-border-primary bg-bg-panel shadow-xl"
        style={{ left: position.x, top: clampedTop }}
        onWheel={stopWheel}
      >
        <div style={{ padding: '8px 8px 8px 12px' }}>
          <input
            ref={inputRef}
            type="text"
            placeholder="Search nodes..."
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full rounded border border-border-primary bg-bg-primary py-1.5 pr-2.5 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
            style={{ paddingLeft: '15px' }}
          />
        </div>

        <div className="relative" style={{ maxHeight: '256px' }}>
          <div style={{ overflow: 'hidden', maxHeight: '256px' }}>
            <div
              ref={scrollRef}
              className="max-h-64 pb-1.5"
              style={{
                paddingLeft: '12px',
                overflowY: 'scroll',
                marginRight: '-20px',
                paddingRight: '32px',
              }}
            >
            {Object.keys(groupedFiltered).length === 0 && (
              <div className="px-2 py-3 text-center text-xs text-text-muted">
                No matching nodes
              </div>
            )}

            {(() => {
              let flatIdx = 0;
              return orderedCategories.map((cat) => (
                <div key={cat}>
                  <div className="pt-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-text-muted" style={{ paddingLeft: '16px' }}>
                    {cat}
                  </div>
                  {groupedFiltered[cat].map((def) => {
                    const idx = flatIdx++;
                    const isKbSelected = idx === selectedIndex;
                    return (
                      <button
                        key={def.id}
                        data-node-btn
                        onClick={() => onSelect(def)}
                        onMouseEnter={() => handleMouseEnter(def)}
                        onMouseLeave={handleMouseLeave}
                        className={`flex w-full items-center gap-2 rounded py-1.5 pr-4 text-left text-xs transition-colors ${
                          isKbSelected
                            ? 'bg-accent text-white'
                            : selectedIndex >= 0
                              ? 'text-text-secondary'
                              : 'text-text-secondary hover:bg-accent hover:text-white'
                        }`}
                        style={{ paddingLeft: '16px' }}
                      >
                        <span className="font-medium">{def.label}</span>
                      </button>
                    );
                  })}
                </div>
              ));
            })()}
          </div>
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

        {descriptionDef && (
          <div className="border-t border-border-primary" style={{ padding: '8px 10px 10px 12px' }}>
            <p className="text-[10px] leading-snug text-text-muted">
              {descriptionDef.description}
            </p>
          </div>
        )}
      </div>
    </>
  );
}
