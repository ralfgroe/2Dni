# 2Dni — Planning Document

## Vision

2Dni is a procedural, node-based 2D graphics tool inspired by the workflow of Houdini (SideFX). It allows designers to create and manipulate 2D vector graphics by chaining nodes together, where each node performs a specific function. The result is a live, non-destructive, fully parametric design environment — sitting conceptually between Adobe Illustrator and Figma, but driven entirely by a node graph.

There is no render stage. The viewport is always live. The final output is an exported file (SVG or other formats) produced by an Export node in the graph.

---

## Target User

Designers familiar with node-based thinking, or designers willing to learn it. The tool should feel approachable for Figma users while rewarding deeper exploration for users with a Houdini or procedural mindset.

---

## Core Principles

- **Procedural first** — every operation is a node. Nothing is destructive.
- **Live and interactive** — the viewport updates in real time as nodes and parameters change.
- **Extensible by design** — nodes are defined as JSON files in a `/nodes` folder. New nodes can be added without modifying the core application.
- **Direct manipulation** — objects in the viewport have handles (gimbals) for interactive transformation alongside the parameter panel.
- **Open media types** — the node system is architected to support vector geometry, pixel data, text, and code operations as the app grows.

---

## Application Architecture

### Tech Stack

| Layer | Technology |
|---|---|
| Framework | React (via Vite) |
| Node Graph | React Flow |
| State Management | Zustand |
| Styling | Tailwind CSS |
| File I/O | Browser File System API (local, V1) |
| Build Tool | Vite |

### Project Folder Structure

```
2Dni/
├── public/
├── src/
│   ├── app/                  # App shell, layout, theme
│   ├── components/
│   │   ├── viewport/         # Canvas / preview area
│   │   ├── nodegraph/        # React Flow graph panel
│   │   ├── parameters/       # Parameter panel (right side)
│   │   └── ui/               # Shared UI components
│   ├── nodes/                # Node runtime logic (JS)
│   ├── store/                # Zustand state stores
│   ├── hooks/                # Custom React hooks
│   └── utils/                # Helpers, geometry math, SVG utils
├── node-definitions/         # JSON node definition files (the plugin folder)
│   ├── line.json
│   ├── rectangle.json
│   ├── transform.json
│   ├── text.json
│   ├── code.json
│   ├── boolean.json
│   ├── radius.json
│   └── export.json
├── PLANNING.md
├── TASKS.md
├── .cursorrules
└── package.json
```

---

## UI Layout

### Three-Panel Layout (Resizable)

```
┌─────────────────────────────────────────────────┐
│  Toolbar / Menu Bar                             │
├─────────────────────────┬───────────────────────┤
│                         │                       │
│      VIEWPORT           │   PARAMETER PANEL     │
│   (main stage)          │   (selected node)     │
│                         │                       │
│   Live SVG preview      │   Inputs, sliders,    │
│   with handles/gimbals  │   dropdowns, values   │
│                         │                       │
├─────────────────────────┴───────────────────────┤
│                                                 │
│            NODE GRAPH PANEL                     │
│         (React Flow canvas)                     │
│                                                 │
└─────────────────────────────────────────────────┘
```

- All three panels are **resizable** via draggable dividers
- Panel sizes are persisted in local storage
- Both **dark and light themes** supported, toggled from the toolbar
- Node graph panel can be collapsed to maximize the viewport

### Viewport Behavior
- Infinite canvas, pannable and zoomable
- Selected objects show **transform handles (gimbal)** for direct manipulation
- Handles update node parameters in real time (bidirectional binding)
- Grid overlay optional (toggleable)

### Node Graph Behavior
- Nodes are added via a right-click context menu or a searchable node palette (Tab key)
- Connections are drawn by dragging from output ports to input ports
- Selected node highlights its output in the viewport
- Node graph uses React Flow's built-in minimap, zoom, and pan

---

## Node System Architecture

### How Nodes Are Loaded

At startup, the app scans the `/node-definitions/` folder and loads all `.json` files. Each JSON file defines a node's metadata, parameters, input/output ports, and a reference to its runtime logic file in `/src/nodes/`. This makes the system fully extensible — dropping a new JSON + JS pair into the folders registers a new node with no code changes to the core app.

### Node JSON Structure

```json
{
  "id": "rectangle",
  "label": "Rectangle",
  "category": "Geometry",
  "description": "Creates a 2D rectangle with configurable size, fill, and stroke.",
  "inputs": [
    { "id": "geometry_in", "label": "Geometry In", "type": "geometry", "required": false }
  ],
  "outputs": [
    { "id": "geometry_out", "label": "Geometry Out", "type": "geometry" }
  ],
  "parameters": [
    { "id": "width", "label": "Width", "type": "number", "default": 200, "min": 1, "max": 4000 },
    { "id": "height", "label": "Height", "type": "number", "default": 100, "min": 1, "max": 4000 },
    { "id": "fill_color", "label": "Fill Color", "type": "color", "default": "#ffffff" },
    { "id": "stroke_color", "label": "Stroke Color", "type": "color", "default": "#000000" },
    { "id": "stroke_width", "label": "Stroke Width", "type": "number", "default": 1, "min": 0, "max": 100 }
  ],
  "runtime": "rectangle"
}
```

### Data Types Flowing Through Connections

| Type | Description |
|---|---|
| `geometry` | Vector path data (SVG path commands) |
| `number` | Scalar numeric value |
| `color` | Color value (hex, rgba) |
| `text` | String / text content |
| `code` | Code string (for wrangle nodes) |
| `any` | Untyped, accepts all |

Connection ports are color-coded by type and enforce type compatibility (with optional loose mode).

---

## V1 Node Set

### 1. Line Node
Creates a straight line on the XY grid.
- **Parameters:** Length, Angle/Orientation, Line Weight, Color
- **Viewport:** Click to select, drag handles to adjust length and angle interactively via gimbal
- **Output:** `geometry`

### 2. Rectangle Node
Creates a 2D rectangle.
- **Parameters:** Width, Height, X/Y Position, Fill Color, Stroke Color, Stroke Weight
- **Viewport:** Resize handles on corners and edges
- **Output:** `geometry`

### 3. Transform Node
Applies transformations to incoming geometry. Analogous to Houdini's Transform SOP.
- **Parameters:** Translate X/Y, Rotate (degrees), Scale X/Y, Pivot Point
- **Input:** `geometry`
- **Output:** `geometry`
- **Viewport:** Shows transform gimbal on the selected geometry

### 4. Text Node
Creates vector text using system fonts.
- **Parameters:** Text content, Font Family (system fonts), Font Size, Font Weight, Color, Convert to Outlines (boolean)
- **Output:** `geometry` (as SVG text or outlined paths)

### 5. Code Node (Wrangle)
Reads the current geometry data from upstream nodes and allows manipulation via JavaScript code.
- **Parameters:** Code editor (Monaco or CodeMirror), with access to the geometry object via a defined API
- **Input:** `geometry` (or `any`)
- **Output:** `geometry` (or `any`)
- **Note:** Sandboxed execution environment

### 6. Boolean Node
Combines or subtracts two geometry inputs.
- **Parameters:** Operation (Union, Subtract, Intersect, Exclude)
- **Inputs:** `geometry` A, `geometry` B
- **Output:** `geometry`
- **Library:** Uses `paper.js` or `polybool` for boolean path operations

### 7. Radius Node
Rounds selected points/corners of incoming geometry. Inspired by Houdini's group-based point selection.
- **Parameters:** Radius amount, Point selection field (by index, or interactive click-to-select in viewport)
- **Input:** `geometry`
- **Output:** `geometry`

### 8. Export Node
Terminal node that exports the result of the graph.
- **Parameters:** Format (SVG, PNG), Filename, Canvas Size, Background Color
- **Action:** Export button triggers file download
- **Input:** `geometry`
- **Output:** none (terminal)

---

## Theming

- CSS custom properties for all colors, spacing, and typography
- Dark theme: near-black backgrounds, muted node colors, bright connection lines
- Light theme: light grey backgrounds, clean white panels
- Theme toggle stored in local storage

---

## V1 Scope Boundaries

**In scope for V1:**
- All 8 starter nodes
- Resizable three-panel layout
- Live viewport with gimbal handles
- JSON-driven node registration system
- Dark and light theme
- Local SVG export via Export node
- Save/load project as JSON file

**Out of scope for V1 (future):**
- Cloud save / collaboration
- Pixel/raster node types
- Animation / timeline
- Rive export
- Node packaging / marketplace
- Electron desktop wrapper
- Version history / undo stack beyond basic undo

---

## Key Dependencies

```json
{
  "react": "^18",
  "react-dom": "^18",
  "reactflow": "^11",
  "zustand": "^4",
  "tailwindcss": "^3",
  "@monaco-editor/react": "^4",
  "paper": "^0.12",
  "vite": "^5"
}
```

---

*Document version: 0.1 — Initial planning draft*
