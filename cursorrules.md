# 2Dni — Cursor Rules

## Project Overview

2Dni is a procedural, node-based 2D vector graphics tool built with React, Vite, React Flow, and Zustand. It is inspired by Houdini (SideFX) but designed for 2D graphic design. Nodes are defined as JSON files in `/node-definitions/` and loaded dynamically at startup. The app has no render stage — the viewport is always live.

Always refer to `PLANNING.md` for architecture decisions and `TASKS.md` for current build priorities.

---

## Tech Stack

- **React 18** with functional components and hooks only. No class components.
- **Vite** as the build tool.
- **React Flow v11** for the node graph panel.
- **Zustand** for all global state management. No Redux, no Context API for app state.
- **Tailwind CSS** for styling. Use CSS custom properties for theme colors.
- **Monaco Editor** for the Code (Wrangle) node.
- **Paper.js** for boolean geometry operations.

---

## Code Style

- Use **TypeScript** for all source files (`.tsx`, `.ts`).
- Use **named exports** for all components and utilities. No default exports except for pages.
- Use **arrow functions** for components: `const MyComponent = () => { ... }`
- Keep components small and focused. If a component exceeds ~150 lines, split it.
- Use **descriptive variable names**. Avoid abbreviations unless they are universally understood (e.g., `id`, `x`, `y`).
- Always define **prop types** using TypeScript interfaces, not inline types.
- Place interfaces at the top of the file, above the component.

---

## File & Folder Conventions

- Components live in `/src/components/`, organized by panel: `viewport/`, `nodegraph/`, `parameters/`, `ui/`
- Zustand stores live in `/src/store/`, one file per store domain.
- Node runtime logic lives in `/src/nodes/`, one file per node type.
- Node definitions (JSON) live in `/node-definitions/`, one file per node type.
- Utility functions live in `/src/utils/`.
- Custom hooks live in `/src/hooks/`.
- File names use **PascalCase** for components (`ParameterPanel.tsx`), **camelCase** for utilities and hooks (`useNodeRegistry.ts`, `svgUtils.ts`).

---

## Node System Rules

- Never hardcode node types into the core application logic. All node types must come from the JSON registry.
- The node loader (`/src/utils/nodeLoader.ts`) is the single source of truth for available nodes.
- Each node JSON file must follow the schema defined in `PLANNING.md` exactly.
- Each node JSON must reference a `runtime` key that maps to a file in `/src/nodes/`.
- Node runtime files must export a single function: `execute(inputs, parameters) => output`
- When adding a new node, create the JSON definition first, then the runtime logic. Never the other way around.

---

## State Management Rules

- All graph state (nodes, edges, parameters, selected node) lives in `useGraphStore`.
- All registered node type definitions live in `useNodeRegistryStore`.
- UI state (theme, panel sizes, viewport zoom/pan) lives in `useUIStore`.
- Never pass graph state through React props more than one level deep. Use the Zustand store directly in components that need it.
- Store actions should be colocated with the store definition, not in components.

---

## Styling Rules

- Use Tailwind utility classes for layout and spacing.
- Use CSS custom properties (defined in `index.css`) for all theme colors: backgrounds, text, borders, node colors, port colors.
- Never hardcode color hex values in component files.
- Dark theme is the default. Light theme swaps the custom property values.
- Node port colors by type: geometry = blue, number = green, color = orange, text = yellow, code = purple, any = grey.

---

## Viewport & Geometry Rules

- The viewport renders an SVG element. All geometry is represented as SVG path data internally.
- The graph evaluation engine traverses nodes from source to terminal (Export node) and computes output geometry.
- Viewport updates must be triggered reactively — any parameter change or graph change should re-evaluate the affected subgraph automatically.
- Gimbal handles are SVG overlay elements rendered on top of the main geometry. They must not be included in export output.

---

## Performance Rules

- Memoize expensive graph evaluation steps using `useMemo` or Zustand selectors.
- Only re-evaluate nodes that are downstream of a changed node (dirty flagging).
- Avoid re-rendering the entire node graph on every parameter change. Use Zustand's selective subscriptions.

---

## Do Nots

- Do not use `useEffect` for state synchronization between stores. Use Zustand's subscribe API instead.
- Do not put business logic inside React components. Components render; utilities and stores compute.
- Do not import Paper.js into components directly. All boolean geometry operations go through `/src/utils/geometryUtils.ts`.
- Do not copy Houdini's UI directly. The layout is inspired by it but must be original in visual design.
- Do not write inline styles except for dynamic values (e.g., panel widths during resize).
- Do not use `any` TypeScript type except in the Code node sandbox context where it is unavoidable.

---

## When in Doubt

- Refer to `PLANNING.md` for architecture decisions.
- Refer to `TASKS.md` for what to build next.
- Keep the node system open and data-driven. If you find yourself writing a switch statement on node types in core app code, stop and refactor to use the registry instead.
- Build the smallest working version of each feature first, then expand.
