# 2Dni

A procedural, node-based 2D graphics tool inspired by Houdini. Create and manipulate 2D vector graphics by chaining nodes together in a live, non-destructive, fully parametric design environment.

## Getting Started

```bash
npm install
npm run dev
```

Open **http://localhost:5173** in your browser.

## Usage

- **Right-click** the node graph (bottom panel) to add nodes from the palette
- **Tab** key opens the node search palette
- **Drag** between output and input ports to connect nodes
- **Click** a node to select it and edit parameters in the right panel
- **Alt+drag** or **middle-click drag** to pan the viewport
- **Scroll wheel** to zoom the viewport
- **Delete** key removes selected nodes
- **Save/Load** buttons in the toolbar persist projects as JSON files

## Node Types

| Node | Category | Description |
|---|---|---|
| Line | Geometry | Straight line with length, angle, weight, color |
| Rectangle | Geometry | Rectangle with size, position, fill, stroke |
| Transform | Transform | Translate, rotate, scale incoming geometry |
| Text | Geometry | Vector text with font, size, weight, color |
| Code | Utility | JavaScript code editor for geometry manipulation |
| Boolean | Geometry | Union, subtract, intersect, exclude operations |
| Radius | Geometry | Round corners of incoming geometry |
| Export | Output | Export graph result as SVG or PNG |

## Adding Custom Nodes

Drop a new `.json` file in the `node-definitions/` folder following the schema, and add a matching runtime in `src/nodes/`. The node appears automatically — no core code changes needed.

## Tech Stack

- React (Vite)
- React Flow (node graph)
- Zustand (state management)
- Tailwind CSS v4 (styling)
- Paper.js (boolean operations)
- Monaco Editor (code node)
