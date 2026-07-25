import { Fragment, useEffect, useState } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useNodeRegistryStore } from './store/nodeRegistryStore';
import { useGraphStore } from './store/graphStore';
import Toolbar from './components/ui/Toolbar';
import Viewport from './components/viewport/Viewport';
import NodeGraph from './components/nodegraph/NodeGraph';
import ParameterPanel from './components/parameters/ParameterPanel';
import './App.css';

// Content that can live in any pane. The layout order is stored as a list of
// these keys, so panes can be swapped without touching each panel's own size.
const PANE_CONTENT = {
  viewport: { render: () => <Viewport />, defaultSize: 40, min: 20 },
  nodegraph: { render: () => <NodeGraph />, defaultSize: 35, min: 15 },
  params: { render: () => <ParameterPanel />, defaultSize: 25, min: 12 },
};

const DEFAULT_ORDER = ['viewport', 'nodegraph', 'params'];

function ResizeHandle({ direction = 'horizontal', onSwap }) {
  const isVertical = direction === 'vertical';
  return (
    <Separator
      className={`
        group relative flex items-center justify-center
        ${isVertical ? 'h-1.5 cursor-row-resize' : 'w-1.5 cursor-col-resize'}
        bg-border-primary transition-colors hover:bg-accent
      `}
    >
      {onSwap && (
        <button
          type="button"
          title="Swap the two panes"
          aria-label="Swap the two panes"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            onSwap();
          }}
          className={`
            absolute z-10 flex items-center justify-center rounded-full
            border border-border-primary bg-bg-secondary text-text-secondary
            opacity-0 shadow transition-all
            group-hover:opacity-100 hover:bg-accent hover:text-white
            ${isVertical ? 'h-4 w-6 cursor-pointer' : 'h-6 w-4 cursor-pointer'}
          `}
        >
          <svg
            width="12"
            height="12"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.5"
            strokeLinecap="round"
            strokeLinejoin="round"
            style={isVertical ? { transform: 'rotate(90deg)' } : undefined}
          >
            <polyline points="17 1 21 5 17 9" />
            <path d="M3 5h18" />
            <polyline points="7 23 3 19 7 15" />
            <path d="M21 19H3" />
          </svg>
        </button>
      )}
    </Separator>
  );
}

export default function App() {
  const loadDefinitions = useNodeRegistryStore((s) => s.loadDefinitions);
  const loaded = useNodeRegistryStore((s) => s.loaded);
  const undo = useGraphStore((s) => s.undo);

  const [order, setOrder] = useState(DEFAULT_ORDER);

  const swapPanes = (leftIndex) => {
    setOrder((prev) => {
      const next = [...prev];
      [next[leftIndex], next[leftIndex + 1]] = [next[leftIndex + 1], next[leftIndex]];
      return next;
    });
  };

  useEffect(() => {
    if (!loaded) loadDefinitions();
  }, [loaded, loadDefinitions]);

  useEffect(() => {
    const handleGlobalUndo = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key === 'z') {
        e.preventDefault();
        undo();
      }
    };
    window.addEventListener('keydown', handleGlobalUndo);
    return () => window.removeEventListener('keydown', handleGlobalUndo);
  }, [undo]);

  return (
    <div className="flex h-full flex-col">
      <Toolbar />

      {/* key tied to the order so panels remount cleanly when swapped */}
      <Group
        key={order.join('-')}
        direction="horizontal"
        autoSaveId="2dni-layout-h2"
      >
        {order.map((paneKey, index) => {
          const pane = PANE_CONTENT[paneKey];
          return (
            <Fragment key={paneKey}>
              <Panel defaultSize={pane.defaultSize} min={pane.min}>
                {pane.render()}
              </Panel>
              {index < order.length - 1 && (
                <ResizeHandle
                  direction="horizontal"
                  onSwap={() => swapPanes(index)}
                />
              )}
            </Fragment>
          );
        })}
      </Group>
    </div>
  );
}
