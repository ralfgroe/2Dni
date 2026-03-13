export function exportSVG(geometry, params) {
  const {
    canvasWidth = 1920,
    canvasHeight = 1080,
    backgroundColor = '#ffffff',
    filename = 'export',
  } = params;

  const svgContent = geometryToSVGString(geometry);

  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}">
  <rect width="${canvasWidth}" height="${canvasHeight}" fill="${backgroundColor}" />
  <g transform="translate(${canvasWidth / 2}, ${canvasHeight / 2})">
    ${svgContent}
  </g>
</svg>`;

  downloadFile(svg, `${filename}.svg`, 'image/svg+xml');
}

export function exportPNG(geometry, params) {
  const {
    canvasWidth = 1920,
    canvasHeight = 1080,
    backgroundColor = '#ffffff',
    filename = 'export',
  } = params;

  const svgContent = geometryToSVGString(geometry);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvasWidth}" height="${canvasHeight}" viewBox="0 0 ${canvasWidth} ${canvasHeight}">
  <rect width="${canvasWidth}" height="${canvasHeight}" fill="${backgroundColor}" />
  <g transform="translate(${canvasWidth / 2}, ${canvasHeight / 2})">
    ${svgContent}
  </g>
</svg>`;

  const img = new Image();
  const blob = new Blob([svg], { type: 'image/svg+xml;charset=utf-8' });
  const url = URL.createObjectURL(blob);

  img.onload = () => {
    const canvas = document.createElement('canvas');
    canvas.width = canvasWidth;
    canvas.height = canvasHeight;
    const ctx = canvas.getContext('2d');
    ctx.drawImage(img, 0, 0);
    URL.revokeObjectURL(url);

    canvas.toBlob((pngBlob) => {
      if (pngBlob) {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(pngBlob);
        a.download = `${filename}.png`;
        a.click();
        URL.revokeObjectURL(a.href);
      }
    }, 'image/png');
  };

  img.src = url;
}

function geometryToSVGString(geo) {
  if (!geo) return '';

  switch (geo.type) {
    case 'line':
      return `<line x1="${geo.x1}" y1="${geo.y1}" x2="${geo.x2}" y2="${geo.y2}" stroke="${geo.stroke}" stroke-width="${geo.strokeWidth}" />`;

    case 'rect':
      return `<rect x="${geo.x}" y="${geo.y}" width="${geo.width}" height="${geo.height}" fill="${geo.fill}" stroke="${geo.stroke}" stroke-width="${geo.strokeWidth}" />`;

    case 'ellipse':
      return `<ellipse cx="${geo.cx}" cy="${geo.cy}" rx="${geo.rx}" ry="${geo.ry}" fill="${geo.fill}" stroke="${geo.stroke}" stroke-width="${geo.strokeWidth}" />`;

    case 'arc':
      return `<path d="${geo.pathData}" fill="${geo.fill}" stroke="${geo.stroke}" stroke-width="${geo.strokeWidth}" />`;

    case 'roundedRect': {
      const corners = geo.corners || [geo.rx, geo.rx, geo.rx, geo.rx];
      const d = exportRoundedRectPath(geo.x, geo.y, geo.width, geo.height, corners);
      return `<path d="${d}" fill="${geo.fill}" stroke="${geo.stroke}" stroke-width="${geo.strokeWidth}" />`;
    }

    case 'text': {
      const anchor = geo.textAlign === 'center' ? 'middle'
        : geo.textAlign === 'right' ? 'end' : 'start';
      const strokeAttr = geo.stroke && geo.stroke !== 'none'
        ? ` stroke="${geo.stroke}" stroke-width="${geo.strokeWidth || 0}" paint-order="stroke"`
        : '';
      return `<text x="0" y="${geo.fontSize}" font-family="${geo.fontFamily}" font-size="${geo.fontSize}" font-weight="${geo.fontWeight}" font-style="${geo.fontStyle || 'normal'}" letter-spacing="${geo.letterSpacing || 0}" text-anchor="${anchor}" fill="${geo.fill}"${strokeAttr}>${escapeXml(geo.content)}</text>`;
    }

    case 'group': {
      const { translate_x = 0, translate_y = 0, rotate = 0, scale_x = 1, scale_y = 1, pivot_x = 0, pivot_y = 0 } = geo.transform || {};
      const childSvg = (geo.children || []).map(geometryToSVGString).join('\n    ');
      return `<g transform="translate(${translate_x}, ${translate_y}) rotate(${rotate}, ${pivot_x}, ${pivot_y}) scale(${scale_x}, ${scale_y})">\n    ${childSvg}\n  </g>`;
    }

    case 'boolean': {
      const childSvg = (geo.children || []).map(geometryToSVGString).join('\n    ');
      return `<g>\n    ${childSvg}\n  </g>`;
    }

    case 'booleanResult':
      return `<path d="${geo.pathData}" fill="${geo.fill}" stroke="${geo.stroke}" stroke-width="${geo.strokeWidth}" />`;

    case 'export':
      return geometryToSVGString(geo.geometry);

    default:
      return '';
  }
}

function escapeXml(str) {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function downloadFile(content, filename, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function exportRoundedRectPath(x, y, w, h, corners) {
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
