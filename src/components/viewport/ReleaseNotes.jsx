// Release notes for 2Dni. Add a new <Release> block at the top each time we
// ship new nodes or notable changes, and bump LATEST_RELEASE_DATE below.
export const LATEST_RELEASE_DATE = 'June 24, 2026';

export default function ReleaseNotes({ onClose }) {
  return (
    <div
      data-scrollable
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 20,
        background: '#f8f9fa',
        overflowY: 'auto',
        overflowX: 'hidden',
        WebkitOverflowScrolling: 'touch',
        overscrollBehavior: 'contain',
        willChange: 'scroll-position',
      }}
    >
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '48px 32px 80px' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1a1a2e', margin: 0 }}>Release Notes</h1>
          <p style={{ fontSize: 13, color: '#6c757d', marginTop: 8 }}>What's new in 2Dni</p>
        </div>

        <Release version="June 24, 2026" title="Flat-screen TV sized by screen diagonal">
          <Item name="Flat-screen TV (Furniture)" tag="new">
            The <b>Furniture</b> node's <b>Living</b> category now has a
            <b>Flat-screen TV</b>. Buying a 42" TV? Type <b>42</b> in the
            <b>TV diagonal</b> field and you get an accurate <b>16:9</b> top-view
            footprint — a slim screen panel with a small stand behind it, drawn
            at real-world size like every other piece.
          </Item>
          <Item name="Resize any placed TV" tag="new">
            Select a placed TV and change its <b>diagonal</b> in the toolbar to
            resize it in place — handy for trying a 55" vs. an 85" against the
            same wall. Rotate it with the ring handle (or <b>[</b> / <b>]</b>) to
            face any direction.
          </Item>
        </Release>

        <Release version="June 23, 2026" title="Furniture node + Floorplan cleanups">
          <Item name="Furniture node" tag="new">
            A new <b>Furniture</b> node for dropping <b>dimensionally accurate</b>
            CAD symbols into your plans. Pick a category and a piece, then click to
            place it; drag to move, use the rotate handle to spin it, and the little
            × to delete. Every symbol is drawn at <b>real-world size</b> (in meters,
            scaled by Screen Units / Meter) so it reads true against your walls.
          </Item>
          <Item name="A full starter catalog" tag="new">
            Six categories out of the box — <b>Beds</b> (single → king, nightstand,
            wardrobe), <b>Bath</b> (toilet, vanity &amp; pedestal sinks, tub,
            shower), <b>Living</b> (3-seat sofa, loveseat, armchair, coffee table,
            TV unit), <b>Dining</b> (4- and 6-seat tables), <b>Kitchen</b> (range,
            fridge, sink, island) and <b>Laundry</b> (washer, dryer, water heater).
          </Item>
          <Item name="Dimension a window after placing it" tag="new">
            Windows (and plain openings) now expose a <b>width dimension</b> you can
            double-click to set an exact size after they're on the wall — doors stay
            at their standard widths.
          </Item>
          <Item name="Centerline walls only" tag="changed">
            The Floorplan node's <b>Double-line</b> and <b>Outline</b> wall styles
            have been removed; walls now always render as a clean <b>centerline</b>.
            This sidesteps the corner-joining issues those filled styles had and
            keeps walls crisp and dimensionable.
          </Item>
          <Item name="Steadier dimensioning" tag="fixed">
            Cleaned up a stray Paper.js project setup that could leave the shared
            geometry context in the wrong state — part of keeping wall dimensioning
            reliable when you switch between nodes.
          </Item>
        </Release>

        <Release version="June 22, 2026" title="Floorplan: one-click wall dimensioning & dimensionable openings">
          <Item name="Click a wall to dimension it" tag="new">
            In the <b>Floorplan</b> node's Dimension mode you can now <b>click a
            wall edge once</b> to dimension its full length — no more picking both
            endpoints. Hover highlights the segment, and a single click drops the
            dimension with the axis inferred automatically. The classic
            <b>two-point pick still works</b> for everything else.
          </Item>
          <Item name="Dimension an opening's width" tag="new">
            Place an <b>opening</b> roughly on a wall, then <b>double-click its
            width dimension</b> to type an exact size — exactly the way you set its
            distance from the wall. The width dimension sits on the opposite wall
            side so it never collides with the locating dimension, and you can drag
            either label in and out to tidy the layout.
          </Item>
        </Release>

        <Release version="June 20, 2026" title="Floorplan polish: element dimensions, tidy params & true wall color">
          <Item name="Dimension door & window position" tag="new">
            Placed elements now carry a <b>locating dimension</b> measured from the
            nearest wall corner to the <b>near edge of the opening</b> — so you read
            exactly how much bare wall is left, no subtracting half the door width.
            Double-click the value to type an exact distance and the element slides
            to match.
          </Item>
          <Item name="Drag element dimensions in & out" tag="new">
            Grab an element dimension's label and <b>pull it perpendicular to the
            wall</b> to tidy your layout, just like the wall dimensions. The offset
            is remembered per element, and the dimensions now <b>stay on the canvas
            in every tool</b> (Draw, Dimension, Elements).
          </Item>
          <Item name="Walls keep your Wall Color" tag="fixed">
            Dimensioned walls no longer turn blue — they always render in your
            chosen <b>Wall Color</b>. Only a genuine over-constrained conflict still
            flags the walls red; normal constraint status is shown by the dimension
            labels instead.
          </Item>
          <Item name="Collapsible parameter sections" tag="new">
            Long node parameter lists can now be organized into <b>Houdini-style
            collapsible folders</b>. The <b>Floorplan</b> node groups its settings
            into <b>Walls</b>, <b>Drawing</b>, <b>Elements</b>, <b>Scale &amp;
            Units</b> and <b>Dimensions</b> — and the raw data fields are tucked
            away since they're edited right on the canvas.
          </Item>
        </Release>

        <Release version="June 19, 2026" title="Floorplan elements: doors, windows & openings">
          <Item name="Wall-hosted elements library" tag="new">
            The <b>Floorplan</b> node has a new <b>Elements</b> tool. Pick
            <b>Door</b>, <b>Window</b> or <b>Opening</b> and click a wall to drop
            it in. Elements are <b>hosted on the wall</b> — they remember which
            wall segment they sit on, so when you dimension or drag that wall, the
            door slides and rotates right along with it.
          </Item>
          <Item name="Real openings cut into the wall" tag="new">
            Each element cuts a <b>true opening</b> in the wall — the wall breaks
            at the gap in both <b>Centerline</b> and <b>Double-line</b> styles, and
            the CAD symbol is drawn in the gap: a door leaf with a dashed swing
            arc, a window's double glass line, or a plain opening with jambs.
          </Item>
          <Item name="Slide, size in meters, flip & delete" tag="new">
            Drag an element's marker to <b>slide it along the wall</b> (it hops
            between segments), double-click to set its <b>width in meters</b>, use
            the door's rotate handle to flip the <b>hinge and swing</b>, and the
            little × to remove it. Openings that no longer fit their wall flag
            <b>red</b> and clamp to stay on the segment.
          </Item>
        </Release>

        <Release version="June 18, 2026" title="Floorplan node + in-node dimensioning & scale">
          <Item name="Floorplan node" tag="new">
            A node built for sketching simple architectural plans. Draw several
            <b>disconnected wall runs</b> in a single node — click to place
            corners, then press <b>Enter</b> (or double-click) to finish a wall
            and start a new one. Walls render with an adjustable
            <b>Wall Thickness</b> and color.
          </Item>
          <Item name="Centerline & double-line walls" tag="new">
            Switch <b>Wall Style</b> between a thin dimensionable
            <b>Centerline</b> and presentation-ready <b>Double-line</b> walls
            (filled bands with crisp mitered corners and square ends).
          </Item>
          <Item name="Ortho lock & grid snap" tag="new">
            <b>Ortho Lock</b> keeps walls perfectly horizontal/vertical (hold
            Shift to toggle per-segment) and <b>Snap to Grid</b> locks corners to
            the grid — both on by default since floorplans are mostly orthogonal.
            Drag any corner afterward to adjust.
          </Item>
          <Item name="Dimension walls right in the node" tag="new">
            Flip the in-viewport toolbar from <b>Draw</b> to <b>Dimension</b> and
            place SolidWorks-style <b>Linear</b>, <b>Angle</b> and <b>Relation</b>
            dimensions on your walls — no separate Dimension node needed. Typing a
            new value <b>drives the walls</b> (the corners move to satisfy it), and
            the sketch is colored blue / black / red for under- / fully- /
            over-defined, just like a CAD sketch.
          </Item>
          <Item name="Work in real-world meters at a chosen scale" tag="new">
            Floorplans read in <b>meters</b>. Set <b>Screen Units / Meter</b> to
            map drawing size to real length and pick a <b>Drawing Scale</b>
            (1:10 … 1:200) as a printing/label hint. Dimensions are typed and
            shown in meters while the geometry stays a comfortable on-screen size;
            the scale ratio is label-only and never resizes your drawing.
          </Item>
        </Release>

        <Release version="June 17, 2026" title="Color upgrades, Null node & smarter wiring">
          <Item name="Random Colors per island" tag="new">
            The <b>Color</b> node can now give every separate island its own
            color. Turn on <b>Random Colors</b> and each disconnected piece —
            Voronoi cells, scattered shapes, a group of paths — gets a distinct
            fill. A <b>Color Seed</b> keeps the palette stable and lets you
            shuffle.
          </Item>
          <Item name="Constrain the palette (Base Hue + Hue Range)" tag="new">
            Limit the random colors to a slice of the color wheel: set a
            <b>Base Hue</b> and a <b>Hue Range</b> for, say, random reds or a
            blues-and-purples family. Full range gives the whole rainbow.
            <b>Saturation</b> and <b>Lightness</b> dial in the mood.
          </Item>
          <Item name="Split overlaps into regions" tag="new">
            Self-intersecting curves like a Spirograph or Lissajous can be split
            into the distinct regions their crossings create. Turn on
            <b>Split Overlaps Into Regions</b> with Random Colors and each
            enclosed area — every petal of a flower curve — becomes its own
            colored cell.
          </Item>
          <Item name="Null node" tag="new">
            A Houdini-style pass-through that outputs its input unchanged — handy
            as a stable reference/bookmark in your network. You can <b>rename</b>
            it and give it a <b>node color</b> in the parameter panel to mark
            special points in the flow.
          </Item>
          <Item name="One connection per input" tag="improved">
            Dragging a wire into an already-connected input now <b>replaces</b>
            the old connection instead of stacking a second one — just like
            Houdini. Swapping which node feeds another is a single drag.
          </Item>
        </Release>

        <Release version="June 17, 2026" title="Dimension node — rebuilt on a real constraint solver">
          <Item name="Parametric Dimensions (CAD)" tag="new">
            The <b>Dimension</b> node is back, rebuilt from the ground up on a true
            geometric constraint solver — the way SolidWorks works. Feed it a
            shape (try the Polyline node), select the node, then place dimensions
            in the viewport and type a value to drive the geometry.
          </Item>
          <Item name="Solves the whole sketch at once" tag="new">
            Every vertex is a variable; your dimensions plus auto-inferred
            Horizontal / Vertical / fixed-angle relations are equations solved
            together. Editing one dimension changes <i>only what it must</i> —
            undimensioned diagonals and already-set edges stay put.
          </Item>
          <Item name="Status colors (blue / black / red)" tag="new">
            The sketch is colored by definition state, just like SolidWorks:
            <b>blue</b> = under-defined (free to move), <b>black</b> = fully
            defined, <b>red</b> = over-defined. A status badge in the viewport
            toolbar shows the current state.
          </Item>
          <Item name="Over-defined dimensions flagged, not forced" tag="new">
            A dimension that can't be satisfied without breaking an earlier one —
            or that adds no new information — turns <b>red with an X</b> and is
            not applied, so your set dimensions never silently change.
          </Item>
          <Item name="Fillets stay cosmetic" tag="fixed">
            Adding or editing a corner <b>radius/fillet</b> no longer disturbs
            your linear dimensions. The solver runs on a stable skeleton of the
            sketch and bakes fillets on top purely for display — so the radius
            can't shift, detach, or red-flag your other dimensions.
          </Item>
          <Item name="Cleaner viewport toolbar" tag="improved">
            The dimension toolbar is now a single compact row pinned next to the
            grid toggle (no more stage clutter), and Linear dimensions
            auto-orient to the edge you pick — no extra axis buttons to fuss with.
          </Item>
          <Item name="Linear, angle, radius, diameter & relations" tag="new">
            Place linear dimensions, corner angles, circle radius/diameter,
            fillet corners, and lock edges Horizontal or Vertical with the
            Relation tool. Drag any value to reposition it; double-click to edit.
          </Item>
        </Release>

        <Release version="June 17, 2026" title="Polyline grid snap & higher-contrast grid">
          <Item name="Snap to Grid (Polyline)" tag="new">
            The Polyline node now has a <b>Snap to Grid</b> toggle: placed points,
            the live preview, and dragged points lock to the viewport grid —
            perfect for clean floorplan sketching.
          </Item>
          <Item name="Higher-contrast grid" tag="improved">
            The viewport grid is darker and adds heavier major lines every five
            cells, with crisp non-scaling strokes so it stays readable at any
            zoom.
          </Item>
        </Release>

        <Release version="June 14, 2026" title="Polish & quality-of-life">
          <Item name="Bolder viewport grid" tag="improved">
            The background grid lines are heavier and clearer, so the canvas is
            easier to read at a glance.
          </Item>
          <Item name="2D tab icon" tag="improved">
            The browser tab now shows the 2Dni pixel "2D" mark instead of the
            default placeholder favicon.
          </Item>
          <Item name="Smooth overlay scrolling" tag="fixed">
            Two-finger trackpad scrolling in the Release Notes and Quick Start
            Guide is smooth now — the node graph no longer hijacks the gesture.
          </Item>
        </Release>

        <Release version="June 13, 2026" title="Dashes, selection & cleaner styling">
          <Item name="Dashes node" tag="new">
            Converts any continuous path into real, separate dash or dot pieces of
            geometry along its length. Each piece is its own selectable element, with
            controls for style (dashed / dotted), dash length, gap length and rounded
            caps. Pair it with the Split Select or Delete nodes to work on individual
            dashes.
          </Item>
          <Item name="Delete node" tag="new">
            Click pieces in the viewport (like Illustrator's white-arrow selection) to
            mark them for deletion — marked pieces turn red and everything else passes
            through. Great for trimming individual dashes, traced regions or
            composition pieces.
          </Item>
          <Item name="Split Select node" tag="new">
            Interactively splits geometry into two outputs. Click components to send
            them to the second output ("Selected"); everything else flows out the first
            ("Rest"). Perfect for separating regions of a traced image or composition.
          </Item>
          <Item name="Accurate component picking" tag="improved">
            Selection in the Split Select and Delete overlays now resolves to the piece
            nearest your cursor, so picking is precise even when zoomed in on tightly
            packed dashes.
          </Item>
          <Item name="Rounded dashes everywhere" tag="fixed">
            Rounded dash/dot ends now survive through the whole graph — Noise Deform,
            Transform, Copy Move, Copy Rotate, Subdivide, Resample, Scatter, Symmetry,
            Align and Select all preserve stroke caps instead of flattening them.
          </Item>
          <Item name="Color node simplified" tag="changed">
            The Color node now focuses on fill, stroke and width and preserves any
            stroke styling the geometry already carries. Use the Dashes node for real
            dashed / dotted lines.
          </Item>
        </Release>

        <Release version="Earlier in June 2026" title="Procedural power-ups">
          <Item name="Noise Deform — multiple algorithms" tag="improved">
            Choose between Perlin, Simplex, Worley, Value, Ridged and Curl noise for
            varied, Houdini-style distortion.
          </Item>
          <Item name="Copy Move — Direction 2" tag="improved">
            Build full 2D grids of copies from a single node with a SolidWorks-style
            "Direction 2" toggle.
          </Item>
          <Item name="Fuse node — global welding" tag="improved">
            Welds coincident points across all paths (not just consecutive segments) and
            self-closes open paths whose endpoints meet, so radii apply cleanly.
          </Item>
          <Item name="Strange Attractor node" tag="new">
            Generate De Jong, Clifford and Lorenz attractors with adjustable coefficients,
            point or line rendering, and presets that retune the sliders automatically.
          </Item>
          <Item name="Trace & Resample" tag="new">
            Trace converts PNG/JPEG images into vectors with control over colors,
            complexity and corner rounding. Resample adds evenly spaced control points
            along geometry.
          </Item>
        </Release>

        <div style={{ textAlign: 'center', marginTop: 48 }}>
          <button onClick={onClose} style={{ padding: '12px 40px', fontSize: 14, fontWeight: 600, color: '#fff', background: '#4263eb', border: 'none', borderRadius: 8, cursor: 'pointer' }}
            onMouseEnter={(e) => (e.target.style.background = '#3b5bdb')}
            onMouseLeave={(e) => (e.target.style.background = '#4263eb')}>
            Back
          </button>
          <p style={{ fontSize: 11, color: '#adb5bd', marginTop: 12 }}>You can reopen these notes anytime from the splash screen.</p>
        </div>
      </div>
    </div>
  );
}

function Release({ version, title, children }) {
  return (
    <div style={{ marginBottom: 36 }}>
      <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, marginBottom: 4, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 18, fontWeight: 700, color: '#1a1a2e', margin: 0 }}>{title}</h2>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#868e96' }}>{version}</span>
      </div>
      <div style={{ height: 1, background: '#dee2e6', margin: '10px 0 18px' }} />
      <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>{children}</div>
    </div>
  );
}

const TAG_STYLES = {
  new: { bg: '#d3f9d8', color: '#2b8a3e' },
  improved: { bg: '#dbe4ff', color: '#3b5bdb' },
  fixed: { bg: '#fff3bf', color: '#e67700' },
  changed: { bg: '#f1f3f5', color: '#495057' },
};

function Item({ name, tag, children }) {
  const ts = TAG_STYLES[tag] || TAG_STYLES.changed;
  return (
    <div style={{ padding: '14px 16px', background: '#fff', border: '1px solid #dee2e6', borderRadius: 8 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: 14, fontWeight: 700, color: '#1a1a2e' }}>{name}</span>
        {tag && (
          <span style={{ fontSize: 10, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 0.5, padding: '2px 8px', borderRadius: 999, background: ts.bg, color: ts.color }}>
            {tag}
          </span>
        )}
      </div>
      <p style={{ fontSize: 13, lineHeight: 1.7, color: '#495057', margin: 0 }}>{children}</p>
    </div>
  );
}
