import { useState, useRef, useEffect, useMemo } from 'react';
import { useNodeRegistryStore } from '../../store/nodeRegistryStore';

export default function NodeSearchPalette({ position, onSelect, onClose }) {
  const [query, setQuery] = useState('');
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
    return groups;
  }, [filtered]);

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
            className="w-full rounded border border-border-primary bg-bg-primary px-2.5 py-1.5 text-xs text-text-primary outline-none placeholder:text-text-muted focus:border-accent"
          />
        </div>

        <div className="max-h-64 overflow-y-auto pb-1.5" style={{ paddingLeft: '12px', paddingRight: '4px' }}>
          {Object.keys(groupedFiltered).length === 0 && (
            <div className="px-2 py-3 text-center text-xs text-text-muted">
              No matching nodes
            </div>
          )}

          {Object.entries(groupedFiltered).map(([cat, defs]) => (
            <div key={cat}>
              <div className="px-4 pt-2 pb-1 text-[10px] font-medium uppercase tracking-wider text-text-muted">
                {cat}
              </div>
              {defs.map((def) => (
                <button
                  key={def.id}
                  onClick={() => onSelect(def)}
                  className="flex w-full items-center gap-2 rounded px-4 py-1.5 text-left text-xs text-text-secondary transition-colors hover:bg-accent hover:text-white"
                >
                  <span className="font-medium">{def.label}</span>
                </button>
              ))}
            </div>
          ))}
        </div>
      </div>
    </>
  );
}
