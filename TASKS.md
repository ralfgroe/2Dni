# 2Dni — Task List

Tasks are organized in phases. Complete each phase before moving to the next. Within a phase, tasks should be done roughly in order.

---

## Phase 1 — Project Scaffold

- [x] Initialize Vite + React project named `2Dni`
- [x] Install dependencies: React Flow, Zustand, Tailwind CSS, Monaco Editor, Paper.js
- [x] Set up Tailwind with dark/light theme configuration using CSS custom properties
- [x] Set up basic folder structure as defined in PLANNING.md
- [x] Create empty placeholder components: `Viewport`, `NodeGraph`, `ParameterPanel`
- [x] Implement resizable three-panel layout (top-left viewport, top-right parameters, bottom node graph) using a resizable panel library or custom drag dividers
- [x] Add theme toggle button to toolbar (dark/light), persist in localStorage
- [x] Confirm app runs in browser with empty panels and correct layout

---

## Phase 2 — Node Registration System

- [x] Create the `/node-definitions/` folder and write the JSON schema for node definitions (see PLANNING.md for structure)
- [x] Build a `NodeLoader` utility that reads all JSON files from `/node-definitions/` at startup and registers them into the app's node registry
- [x] Create a Zustand store for the node registry (`useNodeRegistryStore`)
- [x] Create a Zustand store for the active graph state (`useGraphStore`): nodes, edges, selected node
- [x] Confirm that adding a new JSON file to `/node-definitions/` makes a new node type appear in the app without any other code changes

---

## Phase 3 — Node Graph Panel

- [x] Integrate React Flow into the `NodeGraph` component
- [x] Render registered node types as draggable React Flow nodes
- [x] Implement connection drawing between output and input ports
- [x] Color-code ports by data type (geometry, number, color, text, code)
- [x] Add right-click context menu to add nodes (searchable list of all registered nodes)
- [x] Add Tab key shortcut to open node search palette
- [x] Selecting a node updates the `ParameterPanel` to show that node's parameters
- [x] Add React Flow minimap and zoom/pan controls
- [x] Style nodes to match the app theme (dark/light)

---

## Phase 4 — Parameter Panel

- [x] Build a dynamic `ParameterPanel` component that reads the selected node's parameter definitions from its JSON and renders the appropriate input controls
- [x] Implement input control types: `number` (with min/max slider), `color` (color picker), `text` (text input), `boolean` (toggle), `select` (dropdown)
- [x] Changing a parameter value updates the Zustand graph store and triggers a viewport re-render
- [x] Parameter panel shows node name and category at the top
- [x] Empty state when no node is selected

---

## Phase 5 — Viewport & Live Preview

- [x] Set up the `Viewport` component as an SVG canvas (pannable, zoomable)
- [x] Build a graph evaluation engine: traverses the node graph from inputs to outputs and computes the resulting geometry
- [x] Render the evaluated SVG geometry in the viewport in real time
- [x] Implement viewport grid overlay (toggleable from toolbar)
- [x] Implement selection of objects in viewport (click to select, highlights the corresponding node in the graph)

---

## Phase 6 — Gimbal / Direct Manipulation

- [x] When an object is selected in the viewport, show transform handles (gimbal)
- [x] Dragging handles updates the corresponding node parameters in real time (bidirectional binding with parameter panel)
- [x] Implement handles for: move (translate), rotate, scale
- [x] Line node: endpoint drag handles for length and angle
- [x] Rectangle node: corner and edge handles for width/height

---

## Phase 7 — V1 Node Implementations

Implement each node as a JSON definition + runtime logic pair:

- [x] **Line Node** — length, angle, line weight, color; gimbal handles for endpoints
- [x] **Rectangle Node** — width, height, position, fill, stroke, stroke weight; corner/edge handles
- [x] **Transform Node** — translate XY, rotate, scale XY, pivot; gimbal overlay on geometry
- [x] **Text Node** — text content, system font picker, size, weight, color, convert-to-outlines toggle
- [x] **Code Node (Wrangle)** — Monaco editor, sandboxed JS execution, geometry API access
- [x] **Boolean Node** — union/subtract/intersect/exclude; two geometry inputs; integrate Paper.js boolean operations
- [x] **Radius Node** — radius amount, point selection by index or interactive viewport click; round selected corners
- [x] **Export Node** — format selector (SVG/PNG), filename, canvas size, background color, export button triggers download

---

## Phase 8 — Save / Load

- [x] Implement "Save Project" — serializes the full graph state (nodes, edges, parameters) to a JSON file and triggers browser download
- [x] Implement "Load Project" — reads a previously saved JSON file and restores the full graph state
- [x] Add save/load buttons to the toolbar
- [x] Confirm round-trip: save a graph, reload the app, load the file, get identical result

---

## Phase 9 — Polish & QA

- [x] Test all 8 nodes individually and in combination
- [x] Test resizable panels at various screen sizes
- [x] Test dark and light themes across all components
- [x] Test export (SVG) output in Illustrator and browser
- [x] Test save/load round trip
- [x] Fix any layout or rendering issues
- [x] Add basic error handling: invalid connections, missing inputs, code node errors
- [x] Add loading state for node definitions at startup
- [x] Write a brief README.md with setup instructions

---

## Backlog (Post-V1)

- [ ] Undo / redo stack
- [ ] Copy / paste nodes
- [ ] Node grouping / subnetworks
- [ ] More node types: Ellipse, Polygon, Gradient, Image, Merge, Noise, Grid
- [ ] Animation / timeline panel
- [ ] Rive export
- [ ] Electron desktop wrapper
- [ ] Node package / plugin system (external contributors)
- [ ] Cloud save and collaboration
- [ ] Snap to grid / alignment guides
- [ ] Node graph comments / sticky notes

---

*Document version: 0.1 — Initial task draft*
