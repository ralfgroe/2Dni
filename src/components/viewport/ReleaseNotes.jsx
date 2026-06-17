// Release notes for 2Dni. Add a new <Release> block at the top each time we
// ship new nodes or notable changes, and bump LATEST_RELEASE_DATE below.
export const LATEST_RELEASE_DATE = 'June 16, 2026';

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

        <Release version="June 16, 2026" title="Parametric Dimensions (CAD)">
          <Item name="Dimension node" tag="new">
            A SolidWorks-style sketch tool: connect a shape, then place dimensions
            in the viewport and type a number to drive the geometry. Supports
            <b> Linear</b> (with Smart / Horizontal / Vertical / Aligned axis lock),
            <b> Radius</b>, <b>Diameter</b>, and <b>Angle</b>. Double-click a value on
            the canvas to edit it; drag a value to reposition it.
          </Item>
          <Item name="Smart edge push/pull" tag="new">
            Editing a linear dimension moves only the dimensioned edge — interior
            features (like a centered arc) stay put and curved segments keep their
            shape instead of distorting.
          </Item>
          <Item name="Circle &amp; ellipse driving" tag="new">
            A linear dimension on a circle scales it cleanly; add a horizontal and a
            vertical dimension to turn a circle into an ellipse. Angle dimensions
            open or close the angle between two lines.
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
