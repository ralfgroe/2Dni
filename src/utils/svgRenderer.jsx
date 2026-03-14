export function renderGeometry(geo, nodeId, selectedNodeId, onSelect) {
  if (!geo || geo.type === 'error') return null;

  const isSelected = nodeId === selectedNodeId;
  const handleClick = (e) => {
    e.stopPropagation();
    onSelect(nodeId);
  };

  const geoOpacity = geo.opacity != null ? geo.opacity : undefined;

  switch (geo.type) {
    case 'line':
      return (
        <g key={nodeId} onClick={handleClick} className="cursor-pointer" opacity={geoOpacity}>
          {isSelected && (
            <line
              x1={geo.x1}
              y1={geo.y1}
              x2={geo.x2}
              y2={geo.y2}
              stroke="#4263eb"
              strokeWidth={(geo.strokeWidth || 2) + 6}
              strokeLinecap="round"
              opacity={0.35}
              pointerEvents="none"
            />
          )}
          <line
            x1={geo.x1}
            y1={geo.y1}
            x2={geo.x2}
            y2={geo.y2}
            stroke={geo.stroke}
            strokeWidth={geo.strokeWidth}
            strokeLinecap="round"
          />
        </g>
      );

    case 'rect':
      return (
        <rect
          key={nodeId}
          x={geo.x}
          y={geo.y}
          width={geo.width}
          height={geo.height}
          fill={geo.fill}
          stroke={geo.stroke}
          strokeWidth={geo.strokeWidth}
          opacity={geoOpacity}
          onClick={handleClick}
          className="cursor-pointer"
          filter={isSelected ? 'url(#selection-glow)' : undefined}
        />
      );

    case 'ellipse':
      return (
        <ellipse
          key={nodeId}
          cx={geo.cx}
          cy={geo.cy}
          rx={geo.rx}
          ry={geo.ry}
          fill={geo.fill}
          stroke={geo.stroke}
          strokeWidth={geo.strokeWidth}
          opacity={geoOpacity}
          onClick={handleClick}
          className="cursor-pointer"
          filter={isSelected ? 'url(#selection-glow)' : undefined}
        />
      );

    case 'arc':
      return (
        <path
          key={nodeId}
          d={geo.pathData}
          fill={geo.fill}
          stroke={geo.stroke}
          strokeWidth={geo.strokeWidth}
          opacity={geoOpacity}
          onClick={handleClick}
          className="cursor-pointer"
          filter={isSelected ? 'url(#selection-glow)' : undefined}
        />
      );

    case 'roundedRect': {
      const d = roundedRectPath(geo.x, geo.y, geo.width, geo.height, geo.corners || [geo.rx, geo.rx, geo.rx, geo.rx]);
      return (
        <path
          key={nodeId}
          d={d}
          fill={geo.fill}
          stroke={geo.stroke}
          strokeWidth={geo.strokeWidth}
          opacity={geoOpacity}
          onClick={handleClick}
          className="cursor-pointer"
          filter={isSelected ? 'url(#selection-glow)' : undefined}
        />
      );
    }

    case 'text': {
      const anchor = geo.textAlign === 'center' ? 'middle'
        : geo.textAlign === 'right' ? 'end' : 'start';
      return (
        <text
          key={nodeId}
          x={0}
          y={geo.fontSize}
          fontFamily={geo.fontFamily}
          fontSize={geo.fontSize}
          fontWeight={geo.fontWeight}
          fontStyle={geo.fontStyle || 'normal'}
          letterSpacing={geo.letterSpacing || 0}
          textAnchor={anchor}
          fill={geo.fill}
          stroke={geo.stroke || 'none'}
          strokeWidth={geo.strokeWidth || 0}
          paintOrder="stroke"
          onClick={handleClick}
          className="cursor-pointer"
          filter={isSelected ? 'url(#selection-glow)' : undefined}
        >
          {geo.content}
        </text>
      );
    }

    case 'group': {
      const t = geo.transform || {};
      const tx = t.translate_x || 0, ty = t.translate_y || 0;
      const rot = t.rotate || 0;
      const sx = t.scale_x ?? 1, sy = t.scale_y ?? 1;
      const px = t.pivot_x || 0, py = t.pivot_y || 0;
      const hasTransform = tx !== 0 || ty !== 0 || rot !== 0 || sx !== 1 || sy !== 1;
      const transformStr = hasTransform
        ? `translate(${tx}, ${ty}) rotate(${rot}, ${px}, ${py}) scale(${sx}, ${sy})`
        : undefined;
      return (
        <g
          key={nodeId}
          transform={transformStr}
          onClick={handleClick}
          className="cursor-pointer"
          filter={isSelected ? 'url(#selection-glow)' : undefined}
        >
          {(geo.children || []).map((child, i) =>
            renderGeometry(child, `${nodeId}_child_${i}`, null, () => onSelect(nodeId))
          )}
        </g>
      );
    }

    case 'boolean': {
      return (
        <g
          key={nodeId}
          onClick={handleClick}
          className="cursor-pointer"
          filter={isSelected ? 'url(#selection-glow)' : undefined}
        >
          {(geo.children || []).map((child, i) =>
            renderGeometry(child, `${nodeId}_bool_${i}`, null, () => onSelect(nodeId))
          )}
        </g>
      );
    }

    case 'booleanResult':
      return (
        <path
          key={nodeId}
          d={geo.pathData}
          fill={geo.fill}
          stroke={geo.stroke}
          strokeWidth={geo.strokeWidth}
          opacity={geoOpacity}
          onClick={handleClick}
          className="cursor-pointer"
          filter={isSelected ? 'url(#selection-glow)' : undefined}
        />
      );

    case 'export':
      if (geo.geometry) {
        return renderGeometry(geo.geometry, nodeId, selectedNodeId, onSelect);
      }
      return null;

    default:
      return null;
  }
}

function roundedRectPath(x, y, w, h, corners) {
  const [tl, tr, br, bl] = corners;
  return [
    `M ${x + tl} ${y}`,
    `L ${x + w - tr} ${y}`,
    tr > 0 ? `A ${tr} ${tr} 0 0 1 ${x + w} ${y + tr}` : `L ${x + w} ${y}`,
    `L ${x + w} ${y + h - br}`,
    br > 0 ? `A ${br} ${br} 0 0 1 ${x + w - br} ${y + h}` : `L ${x + w} ${y + h}`,
    `L ${x + bl} ${y + h}`,
    bl > 0 ? `A ${bl} ${bl} 0 0 1 ${x} ${y + h - bl}` : `L ${x} ${y + h}`,
    `L ${x} ${y + tl}`,
    tl > 0 ? `A ${tl} ${tl} 0 0 1 ${x + tl} ${y}` : `L ${x} ${y}`,
    'Z',
  ].join(' ');
}
