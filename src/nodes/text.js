import { loadFont, textToPathData, getFontSync } from '../utils/fontLoader';

let pendingLoads = new Set();

function triggerRerender() {
  setTimeout(() => {
    const event = new CustomEvent('font-loaded');
    window.dispatchEvent(event);
  }, 50);
}

export function textRuntime(params) {
  const {
    content = 'Hello',
    font_family = 'Arial',
    font_size = 48,
    font_weight = '400',
    font_style = 'normal',
    letter_spacing = 0,
    text_align = 'left',
    fill_color = '#000000',
    stroke_color = '#000000',
    stroke_width = 0,
    to_outlines = false,
  } = params;

  const estWidth = content.length * font_size * 0.6;

  const baseGeo = {
    type: 'text',
    content,
    fontFamily: font_family,
    fontSize: font_size,
    fontWeight: font_weight,
    fontStyle: font_style,
    letterSpacing: letter_spacing,
    textAlign: text_align,
    fill: fill_color,
    stroke: stroke_width > 0 ? stroke_color : 'none',
    strokeWidth: stroke_width,
    bounds: { x: 0, y: 0, width: estWidth, height: font_size },
  };

  if (!to_outlines) return baseGeo;

  const cachedFont = getFontSync(font_family);

  if (!cachedFont) {
    const loadKey = `${font_family}`;
    if (!pendingLoads.has(loadKey)) {
      pendingLoads.add(loadKey);
      loadFont(font_family).then(() => {
        pendingLoads.delete(loadKey);
        triggerRerender();
      });
    }
    return baseGeo;
  }

  const outlined = textToPathData(cachedFont, content, font_size, letter_spacing);
  if (!outlined) return baseGeo;

  return {
    type: 'booleanResult',
    pathData: outlined.pathData,
    fill: fill_color,
    stroke: stroke_width > 0 ? stroke_color : 'none',
    strokeWidth: stroke_width,
    bounds: outlined.bounds,
  };
}
