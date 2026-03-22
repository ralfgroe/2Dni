import { useState, useRef, useEffect, useMemo } from 'react';
import { useNodeRegistryStore } from '../../store/nodeRegistryStore';

export default function NodeSearchPalette({ position, onSelect, onClose }) {
  const [query, setQuery] = useState('');
  const [hoveredDef, setHoveredDef] = useState(null);
  const inputRef = useRef(null);
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
      {/* Backdrop */}
      <div className="fixed inset-0 z-40" onClick={onClose} />

      {/* Palette */}
      <div
        className="absolute z-50 w-56 rounded-lg border border-border-primary bg-bg-panel shadow-xl"
        style={{ left: position.x, top: position.y }}
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

        <div className="max-h-64 pb-1.5 palette-scroll" style={{ paddingLeft: '12px', paddingRight: '4px', overflowY: 'scroll' }}>
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

        {hoveredDef && (
          <div className="border-t border-border-primary" style={{ padding: '8px 10px 10px 12px' }}>
            <p className="text-[10px] leading-snug text-text-muted">{hoveredDef.description}</p>
          </div>
        )}
      </div>
    </>
  );
}
