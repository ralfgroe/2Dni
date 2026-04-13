import { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import { useNodeRegistryStore } from '../../store/nodeRegistryStore';

export default function NodeSearchPalette({ position, onSelect, onClose }) {
  const [query, setQuery] = useState('');
  const [selectedIndex, setSelectedIndex] = useState(-1);
  const inputRef = useRef(null);
  const scrollRef = useRef(null);
  const paletteRef = useRef(null);
  const isScrollingRef = useRef(false);
  const scrollTimerRef = useRef(null);
  const [isScrolling, setIsScrolling] = useState(false);
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
    const estimatedHeight = rect.height + 60;
    const maxTop = parentRect.height - estimatedHeight - 100;
    if (position.y > maxTop) {
      setClampedTop(Math.max(0, maxTop));
    } else {
      setClampedTop(position.y);
    }
  }, [position.x, position.y]);

  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;

    const onScroll = () => {
      isScrollingRef.current = true;
      setIsScrolling(true);
      clearTimeout(scrollTimerRef.current);
      scrollTimerRef.current = setTimeout(() => {
        isScrollingRef.current = false;
        setIsScrolling(false);
      }, 800);
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      clearTimeout(scrollTimerRef.current);
    };
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

  const scrollToItem = useCallback((index) => {
    const el = scrollRef.current;
    if (!el) return;
    const buttons = el.querySelectorAll('[data-node-btn]');
    if (buttons[index]) {
      buttons[index].scrollIntoView({ block: 'nearest' });
    }
  }, []);

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
  }, [flatList, selectedIndex, onSelect, onClose, scrollToItem]);

  const handleMouseEnter = useCallback((idx) => {
    if (isScrollingRef.current) return;
    setSelectedIndex(idx);
  }, []);

  const handleMouseLeave = useCallback(() => {
    if (isScrollingRef.current) return;
    setSelectedIndex(-1);
  }, []);

  const stopWheel = useCallback((e) => {
    e.stopPropagation();
  }, []);

  const descriptionDef = selectedIndex >= 0 ? flatList[selectedIndex] : null;

  return (
    <>
      <div className="fixed inset-0 z-40" onClick={onClose} />

      <div
        ref={paletteRef}
        data-node-palette
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

        <div
          ref={scrollRef}
          className="max-h-64 pb-1.5"
          style={{
            paddingLeft: '12px',
            paddingRight: '6px',
            overflowY: 'auto',
            scrollbarWidth: 'thin',
            scrollbarColor: '#c1c1c1 transparent',
            overscrollBehavior: 'contain',
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
                  const isActive = idx === selectedIndex;
                    return (
                      <button
                        key={def.id}
                        data-node-btn
                        onClick={() => onSelect(def)}
                        onMouseEnter={() => handleMouseEnter(idx)}
                        onMouseLeave={handleMouseLeave}
                        className={`flex w-full items-center gap-2 rounded py-1.5 pr-4 text-left text-xs text-text-secondary ${
                          isActive ? 'bg-accent text-white' : ''
                        }`}
                        style={{ paddingLeft: '16px', pointerEvents: isScrolling ? 'none' : 'auto' }}
                      >
                      <span className="font-medium">{def.label}</span>
                    </button>
                  );
                })}
              </div>
            ));
          })()}
        </div>

        <div className="border-t border-border-primary" style={{ padding: '8px 10px 10px 12px', minHeight: '48px' }}>
          {descriptionDef ? (
            <p className="text-[10px] leading-snug text-text-muted">
              {descriptionDef.description}
            </p>
          ) : (
            <p className="text-[10px] leading-snug text-text-muted" style={{ opacity: 0 }}>&nbsp;</p>
          )}
        </div>
      </div>
    </>
  );
}
