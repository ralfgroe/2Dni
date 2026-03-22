import paper from 'paper';
import { getFontSync, loadFont, textToPathData } from './fontLoader';

let paperInitialized = false;
const canvas = typeof document !== 'undefined' ? document.createElement('canvas') : null;

function ensurePaper() {
  if (!paperInitialized && canvas) {
    paper.setup(canvas);
    paperInitialized = true;
  }
}

export function flattenGeoToPathData(geo) {
  if (!geo) return null;

  ensurePaper();
  const path = geoToPaperPath(geo);
  if (!path) return null;

  const pathData = path.pathData;
  const bounds = path.bounds;
  const fill = geo.fill || '#ffffff';
  const stroke = geo.stroke || '#000000';
  const strokeWidth = geo.strokeWidth ?? 1;
  path.remove();

  return {
    type: 'booleanResult',
    pathData,
    fill,
    stroke,
    strokeWidth,
    bounds: { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height },
  };
}

export function geoToPaperPath(geo) {
  if (!geo) return null;
  ensurePaper();

  switch (geo.type) {
    case 'rect':
      return new paper.Path.Rectangle(
        new paper.Point(geo.x || 0, geo.y || 0),
        new paper.Size(geo.width, geo.height)
      );

    case 'roundedRect': {
      const corners = geo.corners || [geo.rx || 0, geo.rx || 0, geo.rx || 0, geo.rx || 0];
      const [tl, tr, br, bl] = corners;
      if (tl === tr && tr === br && br === bl) {
        return new paper.Path.Rectangle(
          new paper.Rectangle(
            new paper.Point(geo.x || 0, geo.y || 0),
            new paper.Size(geo.width, geo.height)
          ),
          new paper.Size(tl, tl)
        );
      }
      const x = geo.x || 0, y = geo.y || 0, w = geo.width, h = geo.height;
      const k = 0.5522847498;
      const path = new paper.Path();

      // Top-left corner
      if (tl > 0) {
        path.add(new paper.Segment(
          new paper.Point(x, y + tl),
          null,
          new paper.Point(0, -tl * k)
        ));
        path.add(new paper.Segment(
          new paper.Point(x + tl, y),
          new paper.Point(-tl * k, 0),
          null
        ));
      } else {
        path.add(new paper.Point(x, y));
      }

      // Top-right corner
      if (tr > 0) {
        path.add(new paper.Segment(
          new paper.Point(x + w - tr, y),
          null,
          new paper.Point(tr * k, 0)
        ));
        path.add(new paper.Segment(
          new paper.Point(x + w, y + tr),
          new paper.Point(0, -tr * k),
          null
        ));
      } else {
        path.add(new paper.Point(x + w, y));
      }

      // Bottom-right corner
      if (br > 0) {
        path.add(new paper.Segment(
          new paper.Point(x + w, y + h - br),
          null,
          new paper.Point(0, br * k)
        ));
        path.add(new paper.Segment(
          new paper.Point(x + w - br, y + h),
          new paper.Point(br * k, 0),
          null
        ));
      } else {
        path.add(new paper.Point(x + w, y + h));
      }

      // Bottom-left corner
      if (bl > 0) {
        path.add(new paper.Segment(
          new paper.Point(x + bl, y + h),
          null,
          new paper.Point(-bl * k, 0)
        ));
        path.add(new paper.Segment(
          new paper.Point(x, y + h - bl),
          new paper.Point(0, bl * k),
          null
        ));
      } else {
        path.add(new paper.Point(x, y + h));
      }

      path.closePath();
      return path;
    }

    case 'line': {
      const path = new paper.Path();
      path.add(new paper.Point(geo.x1 || 0, geo.y1 || 0));
      path.add(new paper.Point(geo.x2 || 0, geo.y2 || 0));
      return path;
    }

    case 'ellipse':
      return new paper.Path.Ellipse({
        center: new paper.Point(geo.cx, geo.cy),
        radius: new paper.Size(geo.rx, geo.ry),
      });

    case 'arc':
      return geo.pathData ? new paper.Path(geo.pathData) : null;

    case 'booleanResult': {
      if (!geo.pathData) return null;
      const compound = new paper.CompoundPath(geo.pathData);
      if (compound.children && compound.children.length > 0) return compound;
      compound.remove();
      const single = new paper.Path(geo.pathData);
      if (single.segments && single.segments.length > 0) return single;
      single.remove();
      return null;
    }

    case 'group': {
      if (!geo.children || geo.children.length === 0) return null;
      const paths = geo.children.map(geoToPaperPath).filter(Boolean);
      if (paths.length === 0) return null;
      let compound = paths[0];
      for (let i = 1; i < paths.length; i++) {
        compound = compound.unite(paths[i]);
        paths[i].remove();
      }
      if (geo.transform) {
        const t = geo.transform;
        const px = t.pivot_x || 0;
        const py = t.pivot_y || 0;
        if (px !== 0 || py !== 0) compound.translate(-px, -py);
        if (t.scale_x !== 1 || t.scale_y !== 1) {
          compound.scale(t.scale_x ?? 1, t.scale_y ?? 1, new paper.Point(0, 0));
        }
        if (t.rotate) compound.rotate(t.rotate, new paper.Point(0, 0));
        if (px !== 0 || py !== 0) compound.translate(px, py);
        if (t.translate_x || t.translate_y) {
          compound.translate(t.translate_x || 0, t.translate_y || 0);
        }
      }
      return compound;
    }

    case 'text': {
      const font = getFontSync(geo.fontFamily);
      if (!font) {
        loadFont(geo.fontFamily).then(() => {
          window.dispatchEvent(new CustomEvent('font-loaded'));
        });
        return null;
      }
      const outlined = textToPathData(font, geo.content, geo.fontSize, geo.letterSpacing || 0);
      if (!outlined || !outlined.pathData) return null;
      return new paper.CompoundPath(outlined.pathData);
    }

    case 'boolean': {
      if (!geo.children || geo.children.length === 0) return null;
      const paths = geo.children.map(geoToPaperPath).filter(Boolean);
      if (paths.length === 0) return null;
      let compound = paths[0];
      for (let i = 1; i < paths.length; i++) {
        compound = compound.unite(paths[i]);
      }
      return compound;
    }

    case 'image': {
      const ix = geo.x || 0, iy = geo.y || 0;
      const iw = geo.width || 200, ih = geo.height || 200;
      return new paper.Path.Rectangle(
        new paper.Point(ix, iy),
        new paper.Size(iw, ih)
      );
    }

    default:
      return null;
  }
}
