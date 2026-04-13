# 2Dni

A browser-based 2D design tool with a node-based workflow for creating and manipulating geometry.

## Features

- **Node-based editor** — Connect geometry nodes in a visual flow to build complex 2D designs
- **Parametric geometry** — Lines, rectangles, ellipses, arcs, and more with adjustable parameters
- **AI assistant** — Describe what you want in natural language and let AI generate geometry code
- **Live canvas preview** — See your designs rendered in real time on an interactive canvas
- **Export** — Save your work as SVG, PNG, GIF, or MP4
- **Dark mode** — Toggle between light and dark themes
- **Resizable panels** — Customize your workspace layout

## Prerequisites

- [Node.js](https://nodejs.org/) (v18 or later)
- npm (included with Node.js)

## Getting Started

```bash
# Clone the repository
git clone git@github.com:ralfgroe/2Dni.git
cd 2Dni

# Install dependencies
npm install

# Start the development server
npm run dev
```

Then open **http://localhost:5173** in your browser.

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start the Vite dev server |
| `npm run build` | Build for production |
| `npm run preview` | Preview the production build |
| `npm run lint` | Run ESLint |
| `npm run deploy` | Build and deploy to GitHub Pages |

## Dependencies

| Package | Purpose |
|---------|---------|
| [React](https://react.dev/) | UI framework |
| [ReactFlow](https://reactflow.dev/) | Node-based graph editor |
| [Zustand](https://zustand.docs.pmnd.rs/) | State management |
| [Paper.js](http://paperjs.org/) | 2D vector graphics rendering |
| [Monaco Editor](https://microsoft.github.io/monaco-editor/) | Code editor for geometry scripts |
| [Tailwind CSS](https://tailwindcss.com/) | Styling |
| [opentype.js](https://opentype.js.org/) | Font parsing and text rendering |
| [gif.js](https://github.com/jnordberg/gif.js) | GIF export |
| [h264-mp4-encoder](https://github.com/nicknamenamenick/h264-mp4-encoder) | MP4 video export |
| [react-resizable-panels](https://github.com/bvaughn/react-resizable-panels) | Resizable layout panels |

## License

MIT
