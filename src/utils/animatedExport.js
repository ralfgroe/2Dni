import { evaluateGraph } from './evaluateGraph';
import { resolveAllNodesAtFrame } from './interpolation';

function renderFrameToSVGString(nodes, edges, definitions, displayNodeId, allKeyframes, frame, width, height) {
  const animated = resolveAllNodesAtFrame(nodes, allKeyframes, frame);
  const results = evaluateGraph(animated, edges, definitions, displayNodeId);

  const nodesWithDownstream = new Set();
  for (const edge of edges) nodesWithDownstream.add(edge.source);

  let geoToRender = [];

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

  let minX = -width / 2, minY = -height / 2;
  let vw = width, vh = height;

  if (geoToRender.length > 0) {
    let bMinX = Infinity, bMinY = Infinity, bMaxX = -Infinity, bMaxY = -Infinity;
    for (const g of geoToRender) {
      const b = g.bounds;
      if (b) {
        bMinX = Math.min(bMinX, b.x);
        bMinY = Math.min(bMinY, b.y);
        bMaxX = Math.max(bMaxX, b.x + b.width);
        bMaxY = Math.max(bMaxY, b.y + b.height);
      }
    }
    if (bMinX < Infinity) {
      const pad = 40;
      const geoW = bMaxX - bMinX + pad * 2;
      const geoH = bMaxY - bMinY + pad * 2;
      const aspect = width / height;
      vw = Math.max(geoW, geoH * aspect);
      vh = vw / aspect;
      const cx = (bMinX + bMaxX) / 2;
      const cy = (bMinY + bMaxY) / 2;
      minX = cx - vw / 2;
      minY = cy - vh / 2;
    }
  }

  const geoSvgParts = geoToRender.map((geo, i) => {
    return geoToSvgString(geo);
  });

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="${minX} ${minY} ${vw} ${vh}">
  <rect x="${minX}" y="${minY}" width="${vw}" height="${vh}" fill="white"/>
  ${geoSvgParts.join('\n  ')}
</svg>`;
}

function geoToSvgString(geo) {
  if (!geo) return '';
  switch (geo.type) {
    case 'rect':
      return `<rect x="${geo.x}" y="${geo.y}" width="${geo.width}" height="${geo.height}" fill="${geo.fill || '#fff'}" stroke="${geo.stroke || '#000'}" stroke-width="${geo.strokeWidth ?? 1}" />`;
    case 'roundedRect': {
      const corners = geo.corners || [0, 0, 0, 0];
      const r = corners[0] || geo.rx || 0;
      return `<rect x="${geo.x}" y="${geo.y}" width="${geo.width}" height="${geo.height}" rx="${r}" fill="${geo.fill || '#fff'}" stroke="${geo.stroke || '#000'}" stroke-width="${geo.strokeWidth ?? 1}" />`;
    }
    case 'ellipse':
      return `<ellipse cx="${(geo.x || 0) + (geo.width || 0) / 2}" cy="${(geo.y || 0) + (geo.height || 0) / 2}" rx="${(geo.width || 0) / 2}" ry="${(geo.height || 0) / 2}" fill="${geo.fill || '#fff'}" stroke="${geo.stroke || '#000'}" stroke-width="${geo.strokeWidth ?? 1}" />`;
    case 'booleanResult':
      return `<path d="${geo.pathData}" fill="${geo.fill || 'none'}" stroke="${geo.stroke || '#000'}" stroke-width="${geo.strokeWidth ?? 1}" />`;
    case 'group':
    case 'boolean':
      return `<g>${(geo.children || []).map(geoToSvgString).join('')}</g>`;
    case 'line':
      return `<line x1="${geo.x1}" y1="${geo.y1}" x2="${geo.x2}" y2="${geo.y2}" stroke="${geo.stroke || '#000'}" stroke-width="${geo.strokeWidth ?? 1}" />`;
    default:
      return '';
  }
}

function svgStringToCanvas(svgString, width, height) {
  return new Promise((resolve) => {
    const img = new Image();
    const blob = new Blob([svgString], { type: 'image/svg+xml' });
    const url = URL.createObjectURL(blob);
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = 'white';
      ctx.fillRect(0, 0, width, height);
      ctx.drawImage(img, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas);
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      resolve(null);
    };
    img.src = url;
  });
}

export async function exportAnimatedWebM(
  nodes, edges, definitions, displayNodeId,
  allKeyframes, duration, fps,
  width = 1920, height = 1080,
  onProgress = () => {}
) {
  const canvasEl = document.createElement('canvas');
  canvasEl.width = width;
  canvasEl.height = height;
  const ctx = canvasEl.getContext('2d');

  const stream = canvasEl.captureStream(0);
  const recorder = new MediaRecorder(stream, {
    mimeType: 'video/webm;codecs=vp9',
    videoBitsPerSecond: 8000000,
  });

  const chunks = [];
  recorder.ondataavailable = (e) => { if (e.data.size > 0) chunks.push(e.data); };

  const done = new Promise((resolve) => {
    recorder.onstop = () => {
      const blob = new Blob(chunks, { type: 'video/webm' });
      resolve(blob);
    };
  });

  recorder.start();

  for (let frame = 0; frame <= duration; frame++) {
    onProgress(frame, duration);

    const svgStr = renderFrameToSVGString(
      nodes, edges, definitions, displayNodeId,
      allKeyframes, frame, width, height
    );

    const frameCanvas = await svgStringToCanvas(svgStr, width, height);
    if (frameCanvas) {
      ctx.clearRect(0, 0, width, height);
      ctx.drawImage(frameCanvas, 0, 0);
    }

    stream.getVideoTracks()[0].requestFrame?.();

    await new Promise((r) => setTimeout(r, 1000 / fps));
  }

  recorder.stop();
  const blob = await done;

  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = 'animation.webm';
  a.click();
  URL.revokeObjectURL(url);

  return blob;
}

export async function exportAnimatedPNGSequence(
  nodes, edges, definitions, displayNodeId,
  allKeyframes, duration, fps,
  width = 1920, height = 1080,
  onProgress = () => {}
) {
  const frames = [];

  for (let frame = 0; frame <= duration; frame++) {
    onProgress(frame, duration);

    const svgStr = renderFrameToSVGString(
      nodes, edges, definitions, displayNodeId,
      allKeyframes, frame, width, height
    );

    const canvas = await svgStringToCanvas(svgStr, width, height);
    if (canvas) {
      const blob = await new Promise((r) => canvas.toBlob(r, 'image/png'));
      frames.push({ name: `frame_${String(frame).padStart(4, '0')}.png`, blob });
    }
  }

  if (frames.length === 1) {
    const url = URL.createObjectURL(frames[0].blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = frames[0].name;
    a.click();
    URL.revokeObjectURL(url);
    return;
  }

  for (const f of frames) {
    const url = URL.createObjectURL(f.blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = f.name;
    a.click();
    URL.revokeObjectURL(url);
    await new Promise((r) => setTimeout(r, 50));
  }
}
