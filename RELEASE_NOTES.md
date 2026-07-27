# Release Notes

## v0.5.0 — July 2026

### New Features

#### Rulers and Guidelines
- **Rulers**: Toggle rulers in the viewport toolbar to display horizontal and vertical rulers with configurable units (px, mm, cm, in)
- **Guidelines**: Drag from rulers to create guidelines, just like in Adobe Illustrator
- **Guideline Controls**: Hover over a guideline to reveal move, delete, and magnetic toggle controls (positioned at edges to avoid obstructing geometry)
- **Ruler Snap Toggle**: New magnet button below the ruler button to enable/disable snapping to ruler tick marks
- **Geometry Snapping**: Magnetic guidelines snap to geometry control points including corners, edges, and center points
- **Independent Snap Controls**: Ruler snap (global) and geometry snap (per-guideline) work independently
- **Crosshair Snapping**: Shapes snap to guideline intersections with priority over single guidelines
- **Clear All**: Double-click the corner box to remove all guidelines at once

#### Center Point Handles
- **Rectangle Center**: Rectangles now display a center point handle for moving by center
- **Circle/Ellipse Center**: Circles and ellipses also have center point handles
- **Center Snap Points**: Center points are included in snap targets for precise alignment

#### Pane Swapping
- **Swap Button**: Hover over resize handles to reveal a Houdini-style swap button
- **Quick Reorganization**: Click to instantly swap the contents of adjacent panes

#### Rectangle Tool Improvements
- **Stroke Toggle**: New "Stroke Enabled" parameter to work with fill only

#### Text Node Improvements
- **Position Parameters**: Text nodes now have X and Y position parameters
- **Draggable Text**: Text can be moved by dragging the blue handle in the viewport
- **Outline Positioning**: "Convert to Outlines" now preserves the original text position

#### Precision Improvements
- **Sub-pixel Positioning**: Removed pixel snapping for precise geometry placement
- **Smooth Scaling**: Scaling operations no longer snap to pixel boundaries

#### UI Improvements
- **Renamed Xform Category**: The "Transform" category is now "Xform" to avoid confusion with the Transform node when searching
- **Persistent Selection**: Objects stay selected after moving — click empty space to deselect
- **Edge-positioned Controls**: Guideline controls appear at viewport edges (left for horizontal, top for vertical) to avoid obstructing geometry

### Bug Fixes
- Fixed node palette appearing after connecting nodes
- Fixed text node not being draggable via viewport handles
- Fixed outlined text jumping to origin when converted
- Fixed guideline controls disappearing when clicked
- Fixed vertical ruler number visibility
- Fixed non-magnetic guidelines incorrectly snapping to geometry
- Fixed selection being lost after moving objects
- Fixed guidelines rendering behind geometry overlays (now always on top)

### UI Improvements
- Cleaner resize handles (removed vertical line/dot)
- Guideline controls with color-coded icons (blue=move, red=delete, orange=magnetic)
- Fade-in animation for guideline controls
- Hover hysteresis to prevent control flickering

---

## v0.4.0 — Previous Release

- Initial node-based geometry editor
- Basic shapes: Rectangle, Ellipse, Line, Arc, Polygon
- Boolean operations: Union, Subtract, Intersect
- Transformations: Translate, Rotate, Scale
- Text rendering with font support
- SVG, PNG, GIF, and MP4 export
- AI assistant for natural language geometry generation
- Dark mode support
