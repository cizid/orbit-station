// Pixel-art drawing helpers shared by the map, the furniture and the sprites.
// Everything is drawn on 1x canvases and scaled up with nearest-neighbour, so only whole pixels here.

export const C = {
  void: '#04060c', hull: '#0b0f17', hullLine: '#1b2638',
  wallCap: '#4b5d7b', wallCapHi: '#6f84a6', wallCapLo: '#34425b',
  face: '#1f2a44', face2: '#27345a', faceLine: '#141c30', faceLight: '#3a4c7a',
  floorA: '#18212f', floorB: '#1b2535', floorLine: '#111925', floorHall: '#1e293b', floorHall2: '#222e42',
  metal: '#6b7a92', metalDark: '#2c3646', metalLight: '#a5b3c7', white: '#e9eff6',
  cyan: '#3de0c8', violet: '#8a6bff', orange: '#ff9a4a', blue: '#6ec1ff', red: '#ff4d4d', green: '#5de6a0', yellow: '#ffd23f',
};

export const hexToRgb = hex => { const n = parseInt(hex.slice(1), 16); return [n >> 16, (n >> 8) & 255, n & 255]; };
export function shade(hex, f) {
  const ch = hexToRgb(hex).map(v => Math.max(0, Math.min(255, Math.round(f > 0 ? v + (255 - v) * f : v * (1 + f)))));
  return `rgb(${ch[0]},${ch[1]},${ch[2]})`;
}

export const makeCanvas = (w, h) => { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; };

// filled rect with whole-pixel coordinates
export function rect(g, x, y, w, h, c) {
  g.fillStyle = c;
  g.fillRect(Math.round(x), Math.round(y), w, h);
}

// A box seen from slightly above. (x, y, w, h) is its footprint on the floor, d its height in pixels:
// the top face is lifted by d and the front face fills the gap below it.
export function cube(g, x, y, w, h, d, top, front, side = null) {
  rect(g, x, y - d, w, h, top);
  rect(g, x, y - d + h, w, d, front);
  rect(g, x, y - d, w, 1, shade(top.startsWith('#') ? top : '#888888', 0.25));
  if (side) { rect(g, x + w - 1, y - d + h, 1, d, side); }
  rect(g, x, y + h - 1, w, 1, 'rgba(0,0,0,.35)');
}

export const noise = i => { const x = Math.sin(i * 127.1 + 311.7) * 43758.5453; return x - Math.floor(x); };

// ---------------------------------------------------------------- 3x5 pixel font
const FONT = {
  A: [2,5,7,5,5], B: [6,5,6,5,6], C: [3,4,4,4,3], D: [6,5,5,5,6], E: [7,4,6,4,7], F: [7,4,6,4,4],
  G: [3,4,5,5,3], H: [5,5,7,5,5], I: [7,2,2,2,7], J: [1,1,1,5,2], K: [5,5,6,5,5], L: [4,4,4,4,7],
  M: [5,7,7,5,5], N: [6,5,5,5,5], O: [2,5,5,5,2], P: [6,5,6,4,4], Q: [2,5,5,6,3], R: [6,5,6,5,5],
  S: [3,4,2,1,6], T: [7,2,2,2,2], U: [5,5,5,5,7], V: [5,5,5,5,2], W: [5,5,7,7,5], X: [5,5,2,5,5],
  Y: [5,5,2,2,2], Z: [7,1,2,4,7],
  0: [7,5,5,5,7], 1: [2,6,2,2,7], 2: [6,1,2,4,7], 3: [6,1,2,1,6], 4: [5,5,7,1,1],
  5: [7,4,6,1,6], 6: [3,4,7,5,7], 7: [7,1,2,2,2], 8: [7,5,7,5,7], 9: [7,5,7,1,6],
  '-': [0,0,7,0,0], _: [0,0,0,0,7], '.': [0,0,0,0,2], ' ': [0,0,0,0,0],
};
export const textWidth = s => s.length * 4 - 1;
export function text(g, s, x, y, color) {
  g.fillStyle = color;
  for (const ch of s) {
    const gl = FONT[ch] || FONT['-'];
    for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
      if ((gl[r] >> (2 - c)) & 1) g.fillRect(Math.round(x + c), Math.round(y + r), 1, 1);
    }
    x += 4;
  }
}
