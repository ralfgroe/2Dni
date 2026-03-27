import { evaluateGraph } from './evaluateGraph';
import { resolveAllNodesAtFrame } from './interpolation';

function renderFrameToSVGString(nodes, edges, definitions, displayNodeId, allKeyframes, frame, width, height, viewBox) {
  const animated = resolveAllNodesAtFrame(nodes, allKeyframes, frame);
  const results = evaluateGraph(animated, edges, definitions, displayNodeId);

  const nodesWithDownstream = new Set();
  for (const edge of edges) nodesWithDownstream.add(edge.source);

  const geoToRender = [];

  if (displayNodeId) {
    let geo = results.get(displayNodeId);
    if (geo && geo.__multiOutput) {
      const parts = Object.entries(geo).filter(([k]) => k !== '__multiOutput').map(([, v]) => v).filter(Boolean);
      geo = parts.length > 0 ? { type: 'group', children: parts, bounds: parts[0].bounds } : null;
    }
    if (geo && geo.type === 'export' && geo.geometry) geo = geo.geometry;
    if (geo) geoToRender.push(geo);
  } else {
    for (const node of animated) {
      if (nodesWithDownstream.has(node.id)) continue;
      let geo = results.get(node.id);
      if (!geo || geo.type === 'export') continue;
      if (geo.__multiOutput) {
        const parts = Object.entries(geo).filter(([k]) => k !== '__multiOutput').map(([, v]) => v).filter(Boolean);
        if (parts.length === 0) continue;
        geo = { type: 'group', children: parts, bounds: parts[0].bounds };
      }
      geoToRender.push(geo);
    }
  }

  const geoSvgParts = geoToRender.map((geo) => geoToSvgString(geo));

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${viewBox.x} ${viewBox.y} ${viewBox.w} ${viewBox.h}">
  <rect x="${viewBox.x}" y="${viewBox.y}" width="${viewBox.w}" height="${viewBox.h}" fill="white"/>
  ${geoSvgParts.join('\n  ')}
</svg>`;
}

function geoToSvgString(geo) {
  if (!geo) return '';
  switch (geo.type) {
    case 'rect':
      return `<rect x="${geo.x}" y="${geo.y}" width="${geo.width}" height="${geo.height}" fill="${geo.fill || '#fff'}" stroke="${geo.stroke || '#000'}" stroke-width="${geo.strokeWidth ?? 1}" opacity="${geo.opacity ?? 1}" />`;
    case 'roundedRect': {
      const corners = geo.corners || [0, 0, 0, 0];
      const r = corners[0] || geo.rx || 0;
      return `<rect x="${geo.x}" y="${geo.y}" width="${geo.width}" height="${geo.height}" rx="${r}" fill="${geo.fill || '#fff'}" stroke="${geo.stroke || '#000'}" stroke-width="${geo.strokeWidth ?? 1}" opacity="${geo.opacity ?? 1}" />`;
    }
    case 'ellipse':
      return `<ellipse cx="${(geo.x || 0) + (geo.width || 0) / 2}" cy="${(geo.y || 0) + (geo.height || 0) / 2}" rx="${(geo.width || 0) / 2}" ry="${(geo.height || 0) / 2}" fill="${geo.fill || '#fff'}" stroke="${geo.stroke || '#000'}" stroke-width="${geo.strokeWidth ?? 1}" opacity="${geo.opacity ?? 1}" />`;
    case 'booleanResult':
      return `<path d="${geo.pathData}" fill="${geo.fill || 'none'}" stroke="${geo.stroke || '#000'}" stroke-width="${geo.strokeWidth ?? 1}" opacity="${geo.opacity ?? 1}" />`;
    case 'group':
    case 'boolean':
      return `<g opacity="${geo.opacity ?? 1}">${(geo.children || []).map(geoToSvgString).join('')}</g>`;
    case 'line':
      return `<line x1="${geo.x1}" y1="${geo.y1}" x2="${geo.x2}" y2="${geo.y2}" stroke="${geo.stroke || '#000'}" stroke-width="${geo.strokeWidth ?? 1}" opacity="${geo.opacity ?? 1}" />`;
    case 'text':
      return `<text x="${geo.x || 0}" y="${geo.y || 0}" font-family="${geo.fontFamily || 'sans-serif'}" font-size="${geo.fontSize || 24}" fill="${geo.fill || '#000'}" opacity="${geo.opacity ?? 1}">${geo.content || ''}</text>`;
    default:
      return '';
  }
}

function svgStringToCanvas(svgString, width, height) {
  return new Promise((resolve, reject) => {
    const img = new Image();
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        ctx.fillStyle = 'white';
        ctx.fillRect(0, 0, width, height);
        ctx.drawImage(img, 0, 0, width, height);
        URL.revokeObjectURL(url);
        resolve(canvas);
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err);
      }
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('Failed to render SVG frame to image'));
    };
    img.src = url;
  });
}

export async function exportAnimatedMP4(
  nodes, edges, definitions, displayNodeId,
  allKeyframes, duration, fps,
  width, height, viewBox,
  onProgress = () => {}
) {
  if (!window.HME || typeof window.HME.createH264MP4Encoder !== 'function') {
    throw new Error('H264 encoder not loaded. Please refresh the page and try again.');
  }

  const encoder = await window.HME.createH264MP4Encoder();

  encoder.width = width;
  encoder.height = height;
  encoder.frameRate = fps;
  encoder.quantizationParameter = 18;
  encoder.initialize();

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');

  for (let frame = 0; frame <= duration; frame++) {
    onProgress(frame, duration);

    const svgStr = renderFrameToSVGString(
      nodes, edges, definitions, displayNodeId,
      allKeyframes, frame, width, height, viewBox
    );

    const frameCanvas = await svgStringToCanvas(svgStr, width, height);

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, width, height);
    ctx.drawImage(frameCanvas, 0, 0);

    const imageData = ctx.getImageData(0, 0, width, height);
    encoder.addFrameRgba(imageData.data);
  }

  encoder.finalize();

  const mp4Data = encoder.FS.readFile(encoder.outputFilename);
  encoder.delete();

  const blob = new Blob([mp4Data], { type: 'video/mp4' });

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'animation.mp4';
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);

  return blob;
}
