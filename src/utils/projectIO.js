import { useGraphStore } from '../store/graphStore';
import { useAnimationStore } from '../store/animationStore';

export function saveProject() {
  const { nodes, edges, displayNodeId } = useGraphStore.getState();
  const { duration, fps, loop, keyframes } = useAnimationStore.getState();

  const project = {
    version: '1.1',
    app: '2Dni',
    savedAt: new Date().toISOString(),
    nodes,
    edges,
    displayNodeId,
    animation: {
      duration,
      fps,
      loop,
      keyframes,
      resolution: useAnimationStore.getState().resolution,
    },
  };

  const json = JSON.stringify(project, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = '2Dni-project.json';
  a.click();
  URL.revokeObjectURL(url);
}

export function loadProject() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = '.json';
    input.onchange = (e) => {
      const file = e.target.files[0];
      if (!file) return resolve(false);
      const reader = new FileReader();
      reader.onload = (ev) => {
        try {
          const project = JSON.parse(ev.target.result);
          if (project.app !== '2Dni') {
            alert('Not a valid 2Dni project file.');
            return resolve(false);
          }
          const { setNodes, setEdges, setDisplayNode, selectNode, syncNextNodeId } = useGraphStore.getState();
          selectNode(null);
          setNodes(project.nodes || []);
          setEdges(project.edges || []);
          syncNextNodeId();
          if (project.displayNodeId) setDisplayNode(project.displayNodeId);

          if (project.animation) {
            useAnimationStore.getState().loadAnimationState(project.animation);
          }

          resolve(true);
        } catch {
          alert('Failed to parse project file.');
          resolve(false);
        }
      };
      reader.readAsText(file);
    };
    input.click();
  });
}
