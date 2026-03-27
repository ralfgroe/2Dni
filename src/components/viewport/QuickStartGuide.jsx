export default function QuickStartGuide({ onClose }) {
  return (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        zIndex: 20,
        background: '#f8f9fa',
        overflowY: 'auto',
        overflowX: 'hidden',
      }}
    >
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '48px 32px 80px' }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1a1a2e', margin: 0 }}>
            Quick Start Guide
          </h1>
          <p style={{ fontSize: 13, color: '#6c757d', marginTop: 8 }}>
            Everything you need to start creating with 2Dni
          </p>
        </div>

        {/* Section 1 */}
        <Section number="1" title="The Interface">
          <P>
            2Dni has three panels: the <B>Viewport</B> (left) shows your geometry,
            the <B>Node Graph</B> (center) is where you build your creation by
            connecting nodes, and the <B>Parameters</B> panel (right) shows
            controls for the selected node.
          </P>
          <Tip>You can resize any panel by dragging the dividers between them.</Tip>
        </Section>

        {/* Section 2 */}
        <Section number="2" title="Adding Your First Node">
          <P>
            <B>Right-click</B> anywhere in the Node Graph to open the toolbox.
            You'll see categories like Geometry, Transform, Appearance, and I/O.
          </P>
          <P>
            Click <B>Rectangle</B> to drop your first geometry node. A shape
            immediately appears in the Viewport. Click the node to select it and
            see its parameters on the right.
          </P>
          <Steps>
            <Step>Right-click in the Node Graph → select <B>Rectangle</B></Step>
            <Step>Click the node to select it</Step>
            <Step>Adjust Width, Height, and position with the sliders</Step>
          </Steps>
        </Section>

        {/* Section 3 */}
        <Section number="3" title="Connecting Nodes">
          <P>
            Nodes have <B>input ports</B> (top) and <B>output ports</B> (bottom).
            Drag from an output port to an input port to connect them. Data flows
            top to bottom.
          </P>
          <Example title="Round a rectangle">
            <Step>Add a <B>Rectangle</B> node</Step>
            <Step>Add a <B>Radius</B> node below it</Step>
            <Step>Drag from Rectangle's output to Radius's input</Step>
            <Step>Select the Radius node and adjust the corner radius</Step>
          </Example>
        </Section>

        {/* Section 4 */}
        <Section number="4" title="Transform & Color">
          <P>
            Use the <B>Transform</B> node to move, rotate, and scale geometry.
            When a Transform node is selected, you can <B>click and drag the
            geometry directly</B> in the Viewport to move it.
          </P>
          <P>
            Use the <B>Color</B> node to set fill color, stroke color, stroke
            width, and opacity for your shapes.
          </P>
          <Example title="Colored, rotated rectangle">
            <Step>Rectangle → Radius → Transform → Color</Step>
            <Step>Rotate the shape using the Transform slider</Step>
            <Step>Pick a fill color in the Color node</Step>
          </Example>
        </Section>

        {/* Section 5 */}
        <Section number="5" title="Combining Geometry">
          <P>
            The <B>Merge</B> node combines multiple geometry streams into one.
            Connect several shapes into a single Merge to layer them together.
          </P>
          <P>
            The <B>Boolean</B> node lets you subtract, intersect, or unite
            two shapes — great for cutting holes or creating complex outlines.
          </P>
          <Example title="Cut a circle out of a rectangle">
            <Step>Add a Rectangle and a Circle</Step>
            <Step>Connect both to a <B>Boolean</B> node</Step>
            <Step>Set the operation to <B>Subtract</B></Step>
          </Example>
        </Section>

        {/* Section 6 */}
        <Section number="6" title="Copies & Patterns">
          <P>
            <B>Copy Rotate</B> creates rotated copies of geometry around a center
            point — perfect for snowflakes, gears, or flower patterns.
          </P>
          <P>
            <B>Copy Move</B> creates translated copies in a row — useful for
            repeating elements.
          </P>
          <P>
            <B>Mirror</B> reflects geometry across an axis to create symmetry.
          </P>
        </Section>

        {/* Section 7 */}
        <Section number="7" title="Layers & Stacking">
          <P>
            Use the <B>Layer</B> node to control which geometry renders on top
            when shapes overlap. Assign a layer level (0–4) to each stream, then
            merge them. Higher layers render in front — combine with transparency
            in the Color node for beautiful layered effects.
          </P>
        </Section>

        {/* Section 8 */}
        <Section number="8" title="Exporting Your Work">
          <P>
            Add an <B>Export</B> node at the end of your chain. Connect your
            final geometry to it and choose a format:
          </P>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
            <FormatCard label="SVG" desc="Vector graphics for web & print" />
            <FormatCard label="PNG" desc="Raster image with transparency" />
            <FormatCard label="OBJ" desc="3D polygon mesh (Blender, Maya)" />
            <FormatCard label="GEO" desc="Houdini native geometry" />
          </div>
        </Section>

        {/* Section 9 */}
        <Section number="9" title="Keyboard & Mouse Shortcuts">
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', marginTop: 8, fontSize: 12, color: '#495057' }}>
            <Kbd>Right-click</Kbd><span>Open toolbox (Node Graph)</span>
            <Kbd>Ctrl + Z</Kbd><span>Undo</span>
            <Kbd>Alt + drag</Kbd><span>Pan the Viewport</span>
            <Kbd>Scroll wheel</Kbd><span>Zoom in/out</span>
            <Kbd>D</Kbd><span>Toggle display flag on a node</span>
            <Kbd>B</Kbd><span>Bypass a node</span>
            <Kbd>T</Kbd><span>Template (ghost overlay) a node</span>
            <Kbd>Delete</Kbd><span>Remove selected node</span>
          </div>
        </Section>

        {/* Section 10 */}
        <Section number="10" title="Tips & Tricks">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
            <Tip>Hover over any node in the toolbox to see a description of what it does.</Tip>
            <Tip>Use the arrow keys to navigate the toolbox, then press Enter to add a node.</Tip>
            <Tip>
              The <B>Split</B> node separates compound geometry (e.g. from Boolean)
              into individual pieces you can color and transform independently.
            </Tip>
            <Tip>
              <B>Point Transform</B> lets you select and drag individual points of
              your geometry for precise control.
            </Tip>
          </div>
        </Section>

        {/* Close button */}
        <div style={{ textAlign: 'center', marginTop: 48 }}>
          <button
            onClick={onClose}
            style={{
              padding: '12px 40px',
              fontSize: 14,
              fontWeight: 600,
              color: '#fff',
              background: '#4263eb',
              border: 'none',
              borderRadius: 8,
              cursor: 'pointer',
              transition: 'background 0.15s',
            }}
            onMouseEnter={(e) => (e.target.style.background = '#3b5bdb')}
            onMouseLeave={(e) => (e.target.style.background = '#4263eb')}
          >
            Start Creating
          </button>
          <p style={{ fontSize: 11, color: '#adb5bd', marginTop: 12 }}>
            You can reopen this guide anytime from the splash screen.
          </p>
        </div>
      </div>
    </div>
  );
}

function Section({ number, title, children }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <span
          style={{
            width: 28, height: 28, borderRadius: '50%',
            background: '#4263eb', color: '#fff',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 700, flexShrink: 0,
          }}
        >
          {number}
        </span>
        <h2 style={{ fontSize: 17, fontWeight: 700, color: '#1a1a2e', margin: 0 }}>
          {title}
        </h2>
      </div>
      <div style={{ paddingLeft: 40 }}>
        {children}
      </div>
    </div>
  );
}

function P({ children }) {
  return (
    <p style={{ fontSize: 13, lineHeight: 1.7, color: '#495057', margin: '0 0 10px' }}>
      {children}
    </p>
  );
}

function B({ children }) {
  return <span style={{ fontWeight: 600, color: '#1a1a2e' }}>{children}</span>;
}

function Tip({ children }) {
  return (
    <div
      style={{
        padding: '10px 14px',
        background: '#e7f5ff',
        borderLeft: '3px solid #4263eb',
        borderRadius: '0 6px 6px 0',
        fontSize: 12,
        lineHeight: 1.6,
        color: '#364fc7',
        marginTop: 4,
      }}
    >
      {children}
    </div>
  );
}

function Steps({ children }) {
  return (
    <ol style={{ margin: '10px 0 0', paddingLeft: 20, fontSize: 12, lineHeight: 2, color: '#495057' }}>
      {children}
    </ol>
  );
}

function Step({ children }) {
  return <li>{children}</li>;
}

function Example({ title, children }) {
  return (
    <div
      style={{
        marginTop: 12,
        padding: '12px 14px',
        background: '#fff',
        border: '1px solid #dee2e6',
        borderRadius: 8,
      }}
    >
      <div style={{ fontSize: 11, fontWeight: 700, color: '#868e96', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>
        Example: {title}
      </div>
      <ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 2, color: '#495057' }}>
        {children}
      </ol>
    </div>
  );
}

function FormatCard({ label, desc }) {
  return (
    <div
      style={{
        padding: '10px 12px',
        background: '#fff',
        border: '1px solid #dee2e6',
        borderRadius: 6,
      }}
    >
      <div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a2e' }}>{label}</div>
      <div style={{ fontSize: 11, color: '#868e96', marginTop: 2 }}>{desc}</div>
    </div>
  );
}

function Kbd({ children }) {
  return (
    <span
      style={{
        display: 'inline-block',
        padding: '2px 8px',
        background: '#fff',
        border: '1px solid #dee2e6',
        borderRadius: 4,
        fontSize: 11,
        fontFamily: 'monospace',
        fontWeight: 600,
        color: '#495057',
        textAlign: 'center',
      }}
    >
      {children}
    </span>
  );
}
