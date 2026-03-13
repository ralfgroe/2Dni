export const PORT_COLORS = {
  geometry: '#4dabf7',
  number: '#69db7c',
  color: '#f783ac',
  text: '#ffd43b',
  code: '#da77f2',
  any: '#adb5bd',
};

export function getPortColor(type) {
  return PORT_COLORS[type] || PORT_COLORS.any;
}
