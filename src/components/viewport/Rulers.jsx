import { useMemo } from 'react';

const RULER_SIZE = 20;
const TICK_COLOR = '#94a3b8';
const TEXT_COLOR = '#64748b';
const BG_COLOR = '#f8fafc';
const BORDER_COLOR = '#e2e8f0';

const UNITS = {
  px: { label: 'px', scale: 1 },
  mm: { label: 'mm', scale: 3.7795275591 }, // 1mm = ~3.78px at 96dpi
  cm: { label: 'cm', scale: 37.795275591 },
  in: { label: 'in', scale: 96 },
};

function getTickSpacing(viewRange, availablePixels, unit) {
  const unitScale = UNITS[unit]?.scale || 1;
  const unitsVisible = viewRange / unitScale;
  const pixelsPerUnit = availablePixels / unitsVisible;
  
  // Find a nice tick spacing (1, 2, 5, 10, 20, 50, 100, etc.)
  const niceSteps = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000];
  const targetTickCount = availablePixels / 50; // aim for ~50px between major ticks
  const idealStep = unitsVisible / targetTickCount;
  
  let step = niceSteps[0];
  for (const s of niceSteps) {
    if (s >= idealStep) {
      step = s;
      break;
    }
    step = s;
  }
  
  return { step, pixelsPerUnit, unitScale };
}

function HorizontalRuler({ viewBox, width, unit = 'px' }) {
  const ticks = useMemo(() => {
    const { step, pixelsPerUnit, unitScale } = getTickSpacing(viewBox.w, width, unit);
    const startUnit = Math.floor(viewBox.x / unitScale / step) * step;
    const endUnit = Math.ceil((viewBox.x + viewBox.w) / unitScale / step) * step;
    
    const result = [];
    for (let u = startUnit; u <= endUnit; u += step) {
      const worldX = u * unitScale;
      const screenX = ((worldX - viewBox.x) / viewBox.w) * width;
      if (screenX >= 0 && screenX <= width) {
        result.push({ x: screenX, label: u, major: true });
      }
      
      // Add minor ticks
      const minorStep = step / 5;
      for (let m = 1; m < 5; m++) {
        const minorU = u + m * minorStep;
        const minorWorldX = minorU * unitScale;
        const minorScreenX = ((minorWorldX - viewBox.x) / viewBox.w) * width;
        if (minorScreenX >= 0 && minorScreenX <= width && minorScreenX < screenX + (step * pixelsPerUnit) - 5) {
          result.push({ x: minorScreenX, label: null, major: false });
        }
      }
    }
    return result;
  }, [viewBox, width, unit]);

  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: RULER_SIZE,
        right: 0,
        height: RULER_SIZE,
        backgroundColor: BG_COLOR,
        borderBottom: `1px solid ${BORDER_COLOR}`,
        overflow: 'hidden',
        userSelect: 'none',
        zIndex: 10,
      }}
    >
      <svg width="100%" height={RULER_SIZE}>
        {ticks.map((tick, i) => (
          <g key={i}>
            <line
              x1={tick.x}
              y1={tick.major ? RULER_SIZE - 10 : RULER_SIZE - 5}
              x2={tick.x}
              y2={RULER_SIZE}
              stroke={TICK_COLOR}
              strokeWidth={tick.major ? 1 : 0.5}
            />
            {tick.major && tick.label !== null && (
              <text
                x={tick.x + 3}
                y={RULER_SIZE - 12}
                fontSize={9}
                fill={TEXT_COLOR}
              >
                {tick.label}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

function VerticalRuler({ viewBox, height, unit = 'px' }) {
  const ticks = useMemo(() => {
    const { step, pixelsPerUnit, unitScale } = getTickSpacing(viewBox.h, height, unit);
    const startUnit = Math.floor(viewBox.y / unitScale / step) * step;
    const endUnit = Math.ceil((viewBox.y + viewBox.h) / unitScale / step) * step;
    
    const result = [];
    for (let u = startUnit; u <= endUnit; u += step) {
      const worldY = u * unitScale;
      const screenY = ((worldY - viewBox.y) / viewBox.h) * height;
      if (screenY >= 0 && screenY <= height) {
        result.push({ y: screenY, label: u, major: true });
      }
      
      // Add minor ticks
      const minorStep = step / 5;
      for (let m = 1; m < 5; m++) {
        const minorU = u + m * minorStep;
        const minorWorldY = minorU * unitScale;
        const minorScreenY = ((minorWorldY - viewBox.y) / viewBox.h) * height;
        if (minorScreenY >= 0 && minorScreenY <= height && minorScreenY < screenY + (step * pixelsPerUnit) - 5) {
          result.push({ y: minorScreenY, label: null, major: false });
        }
      }
    }
    return result;
  }, [viewBox, height, unit]);

  return (
    <div
      style={{
        position: 'absolute',
        top: RULER_SIZE,
        left: 0,
        width: RULER_SIZE,
        bottom: 0,
        backgroundColor: BG_COLOR,
        borderRight: `1px solid ${BORDER_COLOR}`,
        overflow: 'hidden',
        userSelect: 'none',
        zIndex: 10,
      }}
    >
      <svg width={RULER_SIZE} height="100%">
        {ticks.map((tick, i) => (
          <g key={i}>
            <line
              x1={tick.major ? RULER_SIZE - 10 : RULER_SIZE - 5}
              y1={tick.y}
              x2={RULER_SIZE}
              y2={tick.y}
              stroke={TICK_COLOR}
              strokeWidth={tick.major ? 1 : 0.5}
            />
            {tick.major && tick.label !== null && (
              <text
                x={2}
                y={tick.y + 3}
                fontSize={9}
                fill={TEXT_COLOR}
                transform={`rotate(-90, 2, ${tick.y + 3})`}
              >
                {tick.label}
              </text>
            )}
          </g>
        ))}
      </svg>
    </div>
  );
}

function CornerBox({ unit, onUnitChange }) {
  return (
    <div
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        width: RULER_SIZE,
        height: RULER_SIZE,
        backgroundColor: BG_COLOR,
        borderRight: `1px solid ${BORDER_COLOR}`,
        borderBottom: `1px solid ${BORDER_COLOR}`,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        cursor: 'pointer',
        zIndex: 12,
      }}
      onClick={onUnitChange}
      title={`Units: ${UNITS[unit]?.label || 'px'} (click to change)`}
    >
      <span style={{ fontSize: 8, color: TEXT_COLOR, fontWeight: 500 }}>
        {UNITS[unit]?.label || 'px'}
      </span>
    </div>
  );
}

export default function Rulers({ viewBox, width, height, unit = 'px', onUnitChange }) {
  return (
    <>
      <CornerBox unit={unit} onUnitChange={onUnitChange} />
      <HorizontalRuler viewBox={viewBox} width={width - RULER_SIZE} unit={unit} />
      <VerticalRuler viewBox={viewBox} height={height - RULER_SIZE} unit={unit} />
    </>
  );
}

export { RULER_SIZE, UNITS };
