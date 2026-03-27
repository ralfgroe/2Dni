export default function QuickStartGuide({ onClose }) {
  return (
    <div style={{ position: 'absolute', inset: 0, zIndex: 20, background: '#f8f9fa', overflowY: 'auto', overflowX: 'hidden' }}>
      <div style={{ maxWidth: 640, margin: '0 auto', padding: '48px 32px 80px' }}>
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, color: '#1a1a2e', margin: 0 }}>Quick Start Guide</h1>
          <p style={{ fontSize: 13, color: '#6c757d', marginTop: 8 }}>Everything you need to start creating with 2Dni</p>
        </div>

        <Section number="1" title="The Interface">
          <P>2Dni has three panels. You can resize them by dragging the dividers.</P>
          <LayoutDiagram />
        </Section>

        <Section number="2" title="Adding Your First Node">
          <P><B>Right-click</B> anywhere in the Node Graph to open the toolbox. Pick a geometry node to drop it onto the canvas.</P>
          <ToolboxDiagram />
          <Steps>
            <Step>Right-click in the Node Graph to open the toolbox</Step>
            <Step>Select <B>Rectangle</B> from the Geometry category</Step>
            <Step>Click the new node to select it — its parameters appear on the right</Step>
          </Steps>
        </Section>

        <Section number="3" title="Connecting Nodes">
          <P>Nodes have <B>input ports</B> (top) and <B>output ports</B> (bottom). Drag from an output to an input to connect them. Data flows top to bottom.</P>
          <ConnectionDiagram />
          <Example title="Round a rectangle">
            <Step>Add a <B>Rectangle</B> node</Step>
            <Step>Add a <B>Radius</B> node below it</Step>
            <Step>Drag from Rectangle's output to Radius's input</Step>
            <Step>Select Radius and adjust the corner radius slider</Step>
          </Example>
        </Section>

        <Section number="4" title="Transform & Color">
          <P>Use <B>Transform</B> to move, rotate, and scale. When selected, you can <B>click and drag geometry directly</B> in the Viewport.</P>
          <P>Use <B>Color</B> to set fill, stroke, and opacity.</P>
          <ChainDiagram nodes={['Rectangle','Radius','Transform','Color']} />
          <Tip>The Transform node lets you drag geometry in the Viewport — no sliders needed.</Tip>
        </Section>

        <Section number="5" title="Combining Geometry">
          <P><B>Merge</B> combines multiple streams into one. <B>Boolean</B> lets you subtract, intersect, or unite two shapes.</P>
          <MergeDiagram />
          <Example title="Cut a circle out of a rectangle">
            <Step>Add a <B>Rectangle</B> and a <B>Circle</B></Step>
            <Step>Connect both to a <B>Boolean</B> node</Step>
            <Step>Set the operation to <B>Subtract</B></Step>
          </Example>
        </Section>

        <Section number="6" title="Copies & Patterns">
          <P><B>Copy Rotate</B> creates rotated copies around a center — perfect for snowflakes and gears. <B>Copy Move</B> repeats in a row. <B>Mirror</B> reflects across an axis.</P>
          <CopyRotateDiagram />
        </Section>

        <Section number="7" title="Layers & Stacking">
          <P>Use the <B>Layer</B> node to control z-order when shapes overlap. Assign levels 0–4, then merge. Higher layers render in front.</P>
          <LayersDiagram />
        </Section>

        <Section number="8" title="Exporting Your Work">
          <P>Add an <B>Export</B> node at the end of your chain and choose a format:</P>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginTop: 12 }}>
            <FormatCard label="SVG" desc="Vector graphics for web & print" />
            <FormatCard label="PNG" desc="Raster image with transparency" />
            <FormatCard label="OBJ" desc="3D polygon mesh (Blender, Maya)" />
            <FormatCard label="GEO" desc="Houdini native geometry" />
          </div>
        </Section>

        <Section number="9" title="Keyboard & Mouse Shortcuts">
          <div style={{ display: 'grid', gridTemplateColumns: 'auto 1fr', gap: '6px 16px', marginTop: 8, fontSize: 12, color: '#495057' }}>
            <Kbd>Right-click</Kbd><span>Open toolbox (Node Graph)</span>
            <Kbd>Ctrl + Z</Kbd><span>Undo</span>
            <Kbd>Alt + drag</Kbd><span>Pan the Viewport</span>
            <Kbd>Scroll wheel</Kbd><span>Zoom in / out</span>
            <Kbd>D</Kbd><span>Toggle display flag on a node</span>
            <Kbd>B</Kbd><span>Bypass a node</span>
            <Kbd>T</Kbd><span>Template (ghost overlay) a node</span>
            <Kbd>Delete</Kbd><span>Remove selected node</span>
          </div>
        </Section>

        <Section number="10" title="Tips & Tricks">
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
            <Tip>Hover over any node in the toolbox to see a description of what it does.</Tip>
            <Tip>Use <B>arrow keys</B> to navigate the toolbox, press <B>Enter</B> to add.</Tip>
            <Tip><B>Split</B> separates compound geometry into individual pieces you can color independently.</Tip>
            <Tip><B>Point Transform</B> lets you select and drag individual vertices for precise control.</Tip>
          </div>
        </Section>

        <div style={{ textAlign: 'center', marginTop: 48 }}>
          <button onClick={onClose} style={{ padding: '12px 40px', fontSize: 14, fontWeight: 600, color: '#fff', background: '#4263eb', border: 'none', borderRadius: 8, cursor: 'pointer' }}
            onMouseEnter={(e) => (e.target.style.background = '#3b5bdb')}
            onMouseLeave={(e) => (e.target.style.background = '#4263eb')}>
            Start Creating
          </button>
          <p style={{ fontSize: 11, color: '#adb5bd', marginTop: 12 }}>You can reopen this guide anytime from the splash screen.</p>
        </div>
      </div>
    </div>
  );
}

/* ========================================
   SVG Node illustration helpers
   ======================================== */

const N = { w: 120, h: 32, r: 14, port: 8, body: '#e9ecef', border: '#1a1a2e', portFill: '#339af0', text: '#1a1a2e', flagW: 14 };

function SvgNode({ x, y, label, selected, inputs = 1, outputs = 1 }) {
  const bx = x - N.w / 2, by = y - N.h / 2;
  return (
    <g>
      <rect x={bx} y={by} width={N.w} height={N.h} rx={N.r} fill={N.body} stroke={selected ? '#339af0' : N.border} strokeWidth={selected ? 2.5 : 1.8} />
      <line x1={bx + N.flagW + 2} y1={by + 2} x2={bx + N.flagW + 2} y2={by + N.h - 2} stroke={N.border} strokeWidth={1.2} />
      <line x1={bx + N.flagW * 2 + 4} y1={by + 2} x2={bx + N.flagW * 2 + 4} y2={by + N.h - 2} stroke={N.border} strokeWidth={1.2} />
      <line x1={bx + N.w - N.flagW - 2} y1={by + 2} x2={bx + N.w - N.flagW - 2} y2={by + N.h - 2} stroke={N.border} strokeWidth={1.2} />
      <rect x={bx + 1} y={by + 1} width={N.flagW} height={N.h - 2} rx={N.r - 1} fill="#dee2e6" />
      <rect x={bx + N.flagW + 3} y={by + 1} width={N.flagW} height={N.h - 2} fill="#dee2e6" />
      <rect x={bx + N.w - N.flagW - 1} y={by + 1} width={N.flagW} height={N.h - 2} rx={N.r - 1} fill="#dee2e6" />
      <text x={x + 2} y={y + 4} textAnchor="middle" fontSize="10" fontWeight="600" fill={N.text} fontFamily="system-ui">{label}</text>
      {Array.from({ length: inputs }).map((_, i) => {
        const px = inputs === 1 ? x : x - 12 + (i * 24);
        return <circle key={`i${i}`} cx={px} cy={by} r={N.port / 2} fill={N.portFill} stroke={N.border} strokeWidth={1.2} />;
      })}
      {Array.from({ length: outputs }).map((_, i) => {
        const px = outputs === 1 ? x : x - 12 + (i * 24);
        return <circle key={`o${i}`} cx={px} cy={by + N.h} r={N.port / 2} fill={N.portFill} stroke={N.border} strokeWidth={1.2} />;
      })}
    </g>
  );
}

function SvgWire({ x1, y1, x2, y2 }) {
  const my = (y1 + y2) / 2;
  return <path d={`M${x1},${y1} C${x1},${my} ${x2},${my} ${x2},${y2}`} fill="none" stroke="#339af0" strokeWidth={1.5} />;
}

function Illust({ width, height, children, style }) {
  return (
    <div style={{ margin: '14px 0', background: '#fff', border: '1px solid #dee2e6', borderRadius: 10, overflow: 'hidden', ...style }}>
      <svg width="100%" viewBox={`0 0 ${width} ${height}`} style={{ display: 'block' }}>{children}</svg>
    </div>
  );
}

/* ========================================
   Diagram illustrations
   ======================================== */

function LayoutDiagram() {
  return (
    <Illust width={520} height={100}>
      <rect x={10} y={10} width={150} height={80} rx={6} fill="#dbe4ff" stroke="#4263eb" strokeWidth={1.5} strokeDasharray="4 2" />
      <text x={85} y={45} textAnchor="middle" fontSize="11" fontWeight="700" fill="#4263eb" fontFamily="system-ui">Viewport</text>
      <text x={85} y={60} textAnchor="middle" fontSize="8" fill="#748ffc" fontFamily="system-ui">See your geometry</text>

      <rect x={170} y={10} width={190} height={80} rx={6} fill="#e9ecef" stroke="#495057" strokeWidth={1.5} strokeDasharray="4 2" />
      <text x={265} y={45} textAnchor="middle" fontSize="11" fontWeight="700" fill="#495057" fontFamily="system-ui">Node Graph</text>
      <text x={265} y={60} textAnchor="middle" fontSize="8" fill="#868e96" fontFamily="system-ui">Build with nodes</text>

      <rect x={370} y={10} width={140} height={80} rx={6} fill="#fff3bf" stroke="#e67700" strokeWidth={1.5} strokeDasharray="4 2" />
      <text x={440} y={45} textAnchor="middle" fontSize="11" fontWeight="700" fill="#e67700" fontFamily="system-ui">Parameters</text>
      <text x={440} y={60} textAnchor="middle" fontSize="8" fill="#f08c00" fontFamily="system-ui">Adjust settings</text>
    </Illust>
  );
}

function ToolboxDiagram() {
  return (
    <Illust width={520} height={150}>
      <rect x={180} y={8} width={180} height={134} rx={8} fill="#fff" stroke="#dee2e6" strokeWidth={1.5} />
      <rect x={180} y={8} width={180} height={24} rx={8} fill="#f1f3f5" />
      <rect x={180} y={24} width={180} height={8} fill="#f1f3f5" />
      <text x={190} y={25} fontSize="10" fill="#868e96" fontFamily="system-ui">Search nodes...</text>

      <text x={190} y={48} fontSize="8" fontWeight="700" fill="#adb5bd" fontFamily="system-ui">GEOMETRY</text>
      <rect x={190} y={53} width={160} height={18} rx={4} fill="#4263eb" />
      <text x={200} y={66} fontSize="10" fill="#fff" fontWeight="600" fontFamily="system-ui">Rectangle</text>
      <text x={200} y={86} fontSize="10" fill="#495057" fontFamily="system-ui">Circle</text>
      <text x={200} y={102} fontSize="10" fill="#495057" fontFamily="system-ui">Polygon</text>

      <text x={190} y={122} fontSize="8" fontWeight="700" fill="#adb5bd" fontFamily="system-ui">TRANSFORM</text>
      <text x={200} y={138} fontSize="10" fill="#495057" fontFamily="system-ui">Boolean</text>

      <g transform="translate(100, 80)">
        <circle cx={0} cy={0} r={20} fill="#fff" stroke="#dee2e6" strokeWidth={1.5} />
        <text x={0} y={4} textAnchor="middle" fontSize="16" fill="#868e96" fontFamily="system-ui">+</text>
      </g>
      <text x={100} y={118} textAnchor="middle" fontSize="8" fill="#adb5bd" fontFamily="system-ui">Right-click</text>
      <path d="M120,78 L175,55" fill="none" stroke="#adb5bd" strokeWidth={1} strokeDasharray="3 2" markerEnd="url(#arrowGray)" />
      <defs><marker id="arrowGray" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#adb5bd" /></marker></defs>
    </Illust>
  );
}

function ConnectionDiagram() {
  return (
    <Illust width={520} height={140}>
      <SvgNode x={220} y={30} label="Rectangle" outputs={1} inputs={0} />
      <SvgWire x1={220} y1={46} x2={220} y2={80} />
      <SvgNode x={220} y={96} label="Radius" inputs={1} outputs={1} />
      <text x={300} y={83} fontSize="9" fill="#868e96" fontFamily="system-ui">input port (top)</text>
      <path d="M298,81 L226,81" fill="none" stroke="#adb5bd" strokeWidth={0.8} markerEnd="url(#arrowSmall)" />
      <text x={300} y={115} fontSize="9" fill="#868e96" fontFamily="system-ui">output port (bottom)</text>
      <path d="M298,113 L226,113" fill="none" stroke="#adb5bd" strokeWidth={0.8} markerEnd="url(#arrowSmall)" />
      <g transform="translate(128, 62)">
        <text x={0} y={0} fontSize="9" fontWeight="600" fill="#4263eb" fontFamily="system-ui">drag to connect</text>
        <path d="M76,-3 L90,-3" fill="none" stroke="#4263eb" strokeWidth={1} markerEnd="url(#arrowBlue)" />
      </g>
      <defs>
        <marker id="arrowBlue" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#4263eb" /></marker>
        <marker id="arrowSmall" markerWidth="5" markerHeight="5" refX="4" refY="2.5" orient="auto"><path d="M0,0 L5,2.5 L0,5" fill="#adb5bd" /></marker>
      </defs>
    </Illust>
  );
}

function ChainDiagram({ nodes }) {
  const spacing = 56;
  const startY = 28;
  const cx = 260;
  const h = startY + (nodes.length - 1) * spacing + 28;
  return (
    <Illust width={520} height={h}>
      {nodes.map((label, i) => {
        const y = startY + i * spacing;
        return (
          <g key={i}>
            {i > 0 && <SvgWire x1={cx} y1={y - spacing + 16} x2={cx} y2={y - 16} />}
            <SvgNode x={cx} y={y} label={label} inputs={i > 0 ? 1 : 0} outputs={i < nodes.length - 1 ? 1 : 1} />
          </g>
        );
      })}
    </Illust>
  );
}

function MergeDiagram() {
  return (
    <Illust width={520} height={160}>
      <SvgNode x={200} y={28} label="Rectangle" inputs={0} outputs={1} />
      <SvgNode x={320} y={28} label="Circle" inputs={0} outputs={1} />
      <SvgWire x1={200} y1={44} x2={248} y2={96} />
      <SvgWire x1={320} y1={44} x2={272} y2={96} />
      <SvgNode x={260} y={112} label="Boolean" inputs={2} outputs={1} />
      <text x={260} y={148} textAnchor="middle" fontSize="8" fill="#868e96" fontFamily="system-ui">Two inputs → one combined output</text>
    </Illust>
  );
}

function CopyRotateDiagram() {
  const cx = 260, cy = 65, r = 40;
  return (
    <Illust width={520} height={130}>
      {Array.from({ length: 8 }).map((_, i) => {
        const angle = (i * 360) / 8 * (Math.PI / 180);
        const px = cx + Math.cos(angle) * r;
        const py = cy + Math.sin(angle) * r;
        return <rect key={i} x={px - 8} y={py - 5} width={16} height={10} rx={2} fill={i === 0 ? '#4263eb' : '#dbe4ff'} stroke={i === 0 ? '#364fc7' : '#748ffc'} strokeWidth={1} transform={`rotate(${(i * 360) / 8}, ${px}, ${py})`} />;
      })}
      <circle cx={cx} cy={cy} r={2} fill="#e03131" />
      <text x={cx} y={cy + r + 20} textAnchor="middle" fontSize="9" fill="#868e96" fontFamily="system-ui">Copy Rotate — 8 copies around center</text>
    </Illust>
  );
}

function LayersDiagram() {
  return (
    <Illust width={520} height={100}>
      <rect x={160} y={20} width={80} height={60} rx={6} fill="#dbe4ff" stroke="#748ffc" strokeWidth={1.2} opacity={0.7} />
      <text x={200} y={55} textAnchor="middle" fontSize="9" fill="#4263eb" fontFamily="system-ui">Layer 0</text>
      <rect x={200} y={15} width={80} height={60} rx={6} fill="#ffe3e3" stroke="#ff6b6b" strokeWidth={1.2} opacity={0.8} />
      <text x={240} y={50} textAnchor="middle" fontSize="9" fill="#e03131" fontFamily="system-ui">Layer 1</text>
      <rect x={240} y={10} width={80} height={60} rx={6} fill="#d3f9d8" stroke="#51cf66" strokeWidth={1.2} opacity={0.9} />
      <text x={280} y={45} textAnchor="middle" fontSize="9" fill="#2b8a3e" fontFamily="system-ui">Layer 2</text>
      <path d="M340,40 L380,40" stroke="#adb5bd" strokeWidth={1} markerEnd="url(#arrowGray2)" />
      <text x={385} y={37} fontSize="8" fill="#868e96" fontFamily="system-ui">Higher layers</text>
      <text x={385} y={47} fontSize="8" fill="#868e96" fontFamily="system-ui">render on top</text>
      <defs><marker id="arrowGray2" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto"><path d="M0,0 L6,3 L0,6" fill="#adb5bd" /></marker></defs>
    </Illust>
  );
}

/* ========================================
   Text & layout helpers
   ======================================== */

function Section({ number, title, children }) {
  return (
    <div style={{ marginBottom: 32 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
        <span style={{ width: 28, height: 28, borderRadius: '50%', background: '#4263eb', color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 13, fontWeight: 700, flexShrink: 0 }}>{number}</span>
        <h2 style={{ fontSize: 17, fontWeight: 700, color: '#1a1a2e', margin: 0 }}>{title}</h2>
      </div>
      <div style={{ paddingLeft: 40 }}>{children}</div>
    </div>
  );
}
function P({ children }) { return <p style={{ fontSize: 13, lineHeight: 1.7, color: '#495057', margin: '0 0 10px' }}>{children}</p>; }
function B({ children }) { return <span style={{ fontWeight: 600, color: '#1a1a2e' }}>{children}</span>; }
function Tip({ children }) { return <div style={{ padding: '10px 14px', background: '#e7f5ff', borderLeft: '3px solid #4263eb', borderRadius: '0 6px 6px 0', fontSize: 12, lineHeight: 1.6, color: '#364fc7', marginTop: 4 }}>{children}</div>; }
function Steps({ children }) { return <ol style={{ margin: '10px 0 0', paddingLeft: 20, fontSize: 12, lineHeight: 2, color: '#495057' }}>{children}</ol>; }
function Step({ children }) { return <li>{children}</li>; }
function Example({ title, children }) { return <div style={{ marginTop: 12, padding: '12px 14px', background: '#fff', border: '1px solid #dee2e6', borderRadius: 8 }}><div style={{ fontSize: 11, fontWeight: 700, color: '#868e96', textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 6 }}>Example: {title}</div><ol style={{ margin: 0, paddingLeft: 18, fontSize: 12, lineHeight: 2, color: '#495057' }}>{children}</ol></div>; }
function FormatCard({ label, desc }) { return <div style={{ padding: '10px 12px', background: '#fff', border: '1px solid #dee2e6', borderRadius: 6 }}><div style={{ fontSize: 13, fontWeight: 700, color: '#1a1a2e' }}>{label}</div><div style={{ fontSize: 11, color: '#868e96', marginTop: 2 }}>{desc}</div></div>; }
function Kbd({ children }) { return <span style={{ display: 'inline-block', padding: '2px 8px', background: '#fff', border: '1px solid #dee2e6', borderRadius: 4, fontSize: 11, fontFamily: 'monospace', fontWeight: 600, color: '#495057', textAlign: 'center' }}>{children}</span>; }
