import { useEffect } from 'react';
import { Group, Panel, Separator } from 'react-resizable-panels';
import { useNodeRegistryStore } from './store/nodeRegistryStore';
import { useGraphStore } from './store/graphStore';
import Toolbar from './components/ui/Toolbar';
import Viewport from './components/viewport/Viewport';
import NodeGraph from './components/nodegraph/NodeGraph';
import ParameterPanel from './components/parameters/ParameterPanel';
import './App.css';

function ResizeHandle({ direction = 'horizontal' }) {
  const isVertical = direction === 'vertical';
  return (
    <Separator
      className={`
        group relative flex items-center justify-center
        ${isVertical ? 'h-1.5 cursor-row-resize' : 'w-1.5 cursor-col-resize'}
        bg-border-primary transition-colors hover:bg-accent
      `}
    >
      <div
        className={`
          rounded-full bg-text-muted transition-colors group-hover:bg-white
          ${isVertical ? 'h-0.5 w-8' : 'h-8 w-0.5'}
        `}
      />
    </Separator>
  );
}

export default function App() {
  const loadDefinitions = useNodeRegistryStore((s) => s.loadDefinitions);
  const loaded = useNodeRegistryStore((s) => s.loaded);
  const undo = useGraphStore((s) => s.undo);

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

      <Group direction="horizontal" autoSaveId="2dni-layout-h2">
        <Panel defaultSize={40} min={20}>
          <Viewport />
        </Panel>

        <ResizeHandle direction="horizontal" />

        <Panel defaultSize={35} min={15}>
          <NodeGraph />
        </Panel>

        <ResizeHandle direction="horizontal" />

        <Panel defaultSize={25} min={12}>
          <ParameterPanel />
        </Panel>
      </Group>
    </div>
  );
}
