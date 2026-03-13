import opentype from 'opentype.js';

const fontCache = new Map();
const failedFonts = new Set();

const FONTSOURCE_CDN = 'https://cdn.jsdelivr.net/fontsource/fonts';

const FONT_ID_MAP = {
  'Arial':              'arimo',
  'Helvetica':          'arimo',
  'Times New Roman':    'tinos',
  'Georgia':            'tinos',
  'Garamond':           'eb-garamond',
  'Courier New':        'cousine',
  'Verdana':            'open-sans',
  'Tahoma':             'open-sans',
  'Trebuchet MS':       'open-sans',
  'Impact':             'oswald',
  'Comic Sans MS':      'comic-neue',
  'Palatino Linotype':  'eb-garamond',
  'Lucida Console':     'cousine',
  'Lucida Sans Unicode':'open-sans',
  'Gill Sans':          'lato',
  'Century Gothic':     'raleway',
  'Segoe UI':           'open-sans',
  'Calibri':            'carlito',
  'Cambria':            'caladea',
  'Consolas':           'cousine',
  'Franklin Gothic Medium': 'libre-franklin',
  'Futura':             'raleway',
  'Rockwell':           'rokkitt',
  'Candara':            'open-sans',
};

function getFontUrl(fontFamily, weight = '400') {
  const id = FONT_ID_MAP[fontFamily];
  if (!id) return null;
  return `${FONTSOURCE_CDN}/${id}@latest/latin-${weight}-normal.woff`;
}

export function getFontSync(fontFamily) {
  return fontCache.get(fontFamily) || null;
}

export async function loadFont(fontFamily) {
  if (fontCache.has(fontFamily)) return fontCache.get(fontFamily);
  if (failedFonts.has(fontFamily)) return null;

  const url = getFontUrl(fontFamily);
  if (!url) {
    failedFonts.add(fontFamily);
    return null;
  }

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const buffer = await response.arrayBuffer();
    const font = opentype.parse(buffer);
    fontCache.set(fontFamily, font);
    return font;
  } catch (e) {
    console.error(`[FontLoader] Failed to load "${fontFamily}" from ${url}:`, e);
    failedFonts.add(fontFamily);
    return null;
  }
}

export function textToPathData(font, text, fontSize, letterSpacing = 0) {
  if (!font || !text) return null;

  const path = font.getPath(text, 0, 0, fontSize, {
    letterSpacing: letterSpacing / fontSize,
  });

  const pathData = path.toPathData(2);
  if (!pathData) return null;

  const bb = path.getBoundingBox();

  return {
    pathData,
    bounds: {
      x: bb.x1,
      y: bb.y1,
      width: bb.x2 - bb.x1,
      height: bb.y2 - bb.y1,
    },
  };
}
