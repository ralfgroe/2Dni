# Quick Start Guide

Get up and running with 2Dni in minutes.

## Online Demo

The fastest way to try 2Dni is the live demo — no installation required:

**[ralfgroe.github.io/2Dni](https://ralfgroe.github.io/2Dni/)**

## Local Installation

```bash
git clone git@github.com:ralfgroe/2Dni.git
cd 2Dni
npm install
npm run dev
```

Open **http://localhost:5173** in your browser.

## Basic Workflow

### 1. Create Geometry Nodes

- Click the **+** button in the node graph to open the node palette
- Select a geometry type (Rectangle, Ellipse, Line, Text, etc.)
- Adjust parameters in the node's panel

### 2. Connect Nodes

- Drag from an output port to an input port to connect nodes
- Use Boolean operations (Union, Subtract, Intersect) to combine shapes
- Chain transformations (Translate, Rotate, Scale) for complex designs

### 3. Use the Viewport

- **Pan**: Click and drag on empty space
- **Zoom**: Scroll wheel or pinch gesture
- **Select**: Click on geometry to select it
- **Move/Scale**: Drag the blue handles to transform selected geometry

### 4. Rulers and Guidelines

- Click the **ruler icon** in the viewport toolbar to show rulers
- **Drag from a ruler** into the viewport to create a guideline
- Guidelines have three controls (hover to reveal):
  - **Blue (Move)**: Drag to reposition the guideline
  - **Red (Delete)**: Click to remove the guideline
  - **Orange (Magnetic)**: Toggle snapping behavior
- Magnetic guidelines snap to ruler tick marks and geometry control points
- Double-click the corner box to clear all guidelines

### 5. Snapping

- Click the **magnet icon** to toggle global snap-to-points
- When enabled, geometry handles snap to other control points
- Magnetic guidelines provide additional snap targets at intersections (crosshairs)

### 6. Pane Layout

- Drag the resize handles between panels to adjust sizes
- Hover over a resize handle to reveal the **swap button**
- Click the swap button to exchange the contents of adjacent panes

### 7. Export Your Work

- Click **Save** to download your project as JSON
- Use the export options for SVG, PNG, GIF, or MP4 output

## Tips

- Use the **Grid** toggle for visual alignment reference
- The **AI assistant** can generate geometry from natural language descriptions
- Text nodes support "Convert to Outlines" for path-based text manipulation
- Rectangle nodes have a "Stroke Enabled" toggle to work with fill only
