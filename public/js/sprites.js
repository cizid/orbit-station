import { makeCanvas, shade } from './art.js';

// Pixel characters, drawn at runtime: 16x24 body plus a 1px outline margin.
// type: 'astro' | 'robot'   dir: 'down' (front) | 'up' (back) | 'side' (facing right; flip for left)
// frame: 0 idle, 1 / 2 the two walk poses (also the mid-air hop poses), 3 working (arms forward)

export const SPRITE_W = 18, SPRITE_H = 26;
const cache = new Map();

function outline(cv, col = [10, 14, 22]) {
  const g = cv.getContext('2d'), w = cv.width, h = cv.height;
  const src = g.getImageData(0, 0, w, h), out = new ImageData(new Uint8ClampedArray(src.data), w, h);
  const a = (x, y) => (x < 0 || y < 0 || x >= w || y >= h) ? 0 : src.data[(y * w + x) * 4 + 3];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    if (a(x, y) || !(a(x - 1, y) || a(x + 1, y) || a(x, y - 1) || a(x, y + 1))) continue;
    out.data.set([...col, 255], (y * w + x) * 4);
  }
  g.putImageData(out, 0, 0);
}

const W1 = '#eef3f9', W2 = '#cfd8e3', W3 = '#9fb0c2', DK = '#3a4658', VIS = '#0b1a30', GLOW = '#7df3ff';

// ------------------------------------------------------------------ astronaut
function astro(r, m, col, dir, f) {
  const lUp = f === 1, rUp = f === 2, work = f === 3, dk = shade(col, -0.4), lt = shade(col, 0.35);
  const swingL = lUp ? 1 : 0, swingR = rUp ? 1 : 0;
  if (dir === 'down') {
    r(1, 9, 2, 7, col); r(13, 9, 2, 7, col);                                   // backpack sticking out behind the arms
    r(5, 17, 3, lUp ? 4 : 5, W1); r(5, lUp ? 21 : 22, 3, 2, DK);               // legs and boots
    r(8, 17, 3, rUp ? 4 : 5, W2); r(8, rUp ? 21 : 22, 3, 2, DK);
    r(2, work ? 11 : 10 + swingL, 2, work ? 4 : 6, W1); r(12, work ? 11 : 10 + swingR, 2, work ? 4 : 6, W2);
    if (work) { r(4, 14, 3, 2, DK); r(9, 14, 3, 2, DK); } else { r(2, 16 + swingL, 2, 1, DK); r(12, 16 + swingR, 2, 1, DK); }
    r(4, 9, 8, 8, W1); r(11, 9, 1, 8, W3); r(4, 15, 8, 2, col); r(4, 15, 8, 1, lt);
    r(6, 10, 4, 3, '#0b0f17'); r(7, 11, 2, 1, GLOW); r(6, 10, 4, 1, col);
    r(5, 0, 6, 1, W2); r(4, 1, 8, 1, W1); r(3, 2, 10, 6, W1); r(4, 8, 8, 1, W3); r(12, 2, 1, 6, W3);
    r(4, 3, 8, 4, VIS); r(5, 4, 2, 1, GLOW); r(5, 5, 1, 1, GLOW); r(4, 3, 8, 1, '#16304a');
  } else if (dir === 'up') {
    r(5, 17, 3, lUp ? 4 : 5, W1); r(5, lUp ? 21 : 22, 3, 2, DK);
    r(8, 17, 3, rUp ? 4 : 5, W2); r(8, rUp ? 21 : 22, 3, 2, DK);
    r(2, work ? 9 : 10 + swingL, 2, work ? 4 : 6, W1); r(12, work ? 9 : 10 + swingR, 2, work ? 4 : 6, W2);
    if (work) { r(2, 8, 2, 2, DK); r(12, 8, 2, 2, DK); } else { r(2, 16 + swingL, 2, 1, DK); r(12, 16 + swingR, 2, 1, DK); }
    r(3, 9, 10, 8, col); r(3, 9, 10, 1, lt); r(3, 16, 10, 1, dk);                // backpack covers the whole back
    r(5, 10, 2, 5, shade(col, -0.2)); r(9, 10, 2, 5, shade(col, -0.2)); r(7, 12, 2, 1, dk);
    r(5, 0, 6, 1, W2); r(4, 1, 8, 1, W1); r(3, 2, 10, 6, W1); r(4, 8, 8, 1, W3); r(3, 2, 1, 6, W3);
    r(7, 1, 2, 1, col); r(6, 6, 4, 1, W2);
  } else {
    const lead = lUp ? 1 : rUp ? -1 : 0;
    r(2, 9, 4, 8, col); r(2, 9, 4, 1, lt);                                       // backpack on the far side
    r(6 - lead, 17, 3, lUp ? 4 : 5, W2); r(6 - lead, lUp ? 21 : 22, 4, 2, DK);
    r(7 + lead, 17, 3, rUp ? 4 : 5, W1); r(7 + lead, rUp ? 21 : 22, 4, 2, DK);
    r(5, 9, 7, 8, W1); r(5, 9, 1, 8, W3); r(5, 15, 7, 2, col); r(9, 11, 2, 2, '#0b0f17');
    const ax = work ? 10 : 7 + (lUp ? 1 : rUp ? -1 : 0);
    r(ax, 10, 2, work ? 4 : 6, W2); r(ax, work ? 14 : 16, 2, 1, DK);
    r(5, 0, 6, 1, W2); r(4, 1, 8, 1, W1); r(3, 2, 10, 6, W1); r(4, 8, 8, 1, W3); r(3, 2, 1, 6, W3);
    r(7, 3, 6, 4, VIS); r(11, 4, 1, 1, GLOW); r(10, 5, 1, 1, GLOW); r(7, 3, 6, 1, '#16304a');
  }
}

// ---------------------------------------------------------------------- robot
const SH = '#e4eaf1', SH2 = '#aab6c4', ME = '#9aa7b5', ME2 = '#5b6878';
function robot(r, m, col, dir, f) {
  const lUp = f === 1, rUp = f === 2, work = f === 3, dk = shade(col, -0.4), lt = shade(col, 0.35);
  if (dir === 'down') {
    r(3, 19, 3, lUp ? 2 : 3, ME2); r(2, lUp ? 21 : 22, 5, 2, DK);
    r(10, 19, 3, rUp ? 2 : 3, ME2); r(9, rUp ? 21 : 22, 5, 2, DK);
    r(1, work ? 13 : 12 + (lUp ? 1 : 0), 2, work ? 4 : 6, ME); r(13, work ? 13 : 12 + (rUp ? 1 : 0), 2, work ? 4 : 6, ME);
    r(3, 11, 10, 8, SH); r(12, 11, 1, 8, SH2); r(3, 14, 10, 2, col); r(3, 14, 10, 1, lt);
    r(5, 16, 6, 3, '#0b0f17'); r(6, 17, 1, 1, GLOW); r(8, 17, 1, 1, '#ffc233'); r(10, 17, 1, 1, col);
    r(5, 3, 6, 1, SH); r(4, 4, 8, 1, SH); r(3, 5, 10, 5, SH); r(12, 5, 1, 5, SH2); r(3, 10, 10, 1, col);
    r(4, 5, 7, 4, '#0b0f17'); r(5, 6, 5, 2, GLOW); r(7, 6, 1, 1, '#ffffff'); r(11, 4, 1, 1, '#ffc233');
    r(10, 0, 1, 3, ME2); r(9, 0, 3, 1, col);
  } else if (dir === 'up') {
    r(3, 19, 3, lUp ? 2 : 3, ME2); r(2, lUp ? 21 : 22, 5, 2, DK);
    r(10, 19, 3, rUp ? 2 : 3, ME2); r(9, rUp ? 21 : 22, 5, 2, DK);
    r(1, work ? 11 : 12 + (lUp ? 1 : 0), 2, work ? 4 : 6, ME); r(13, work ? 11 : 12 + (rUp ? 1 : 0), 2, work ? 4 : 6, ME);
    r(3, 11, 10, 8, SH); r(3, 11, 1, 8, SH2); r(3, 14, 10, 2, col); r(5, 16, 6, 2, '#0b0f17'); r(6, 17, 4, 1, dk);
    r(5, 3, 6, 1, SH); r(4, 4, 8, 1, SH); r(3, 5, 10, 5, SH); r(3, 5, 1, 5, SH2); r(3, 10, 10, 1, col);
    r(7, 5, 2, 4, col); r(6, 6, 4, 1, lt); r(10, 0, 1, 3, ME2); r(9, 0, 3, 1, col);
  } else {
    const lead = lUp ? 1 : rUp ? -1 : 0;
    r(5 - lead, 19, 3, lUp ? 2 : 3, ME2); r(4 - lead, lUp ? 21 : 22, 5, 2, DK);
    r(8 + lead, 19, 3, rUp ? 2 : 3, ME2); r(7 + lead, rUp ? 21 : 22, 5, 2, DK);
    r(4, 11, 9, 8, SH); r(4, 11, 1, 8, SH2); r(4, 14, 9, 2, col); r(5, 16, 5, 2, '#0b0f17');
    r(work ? 11 : 6 + lead, work ? 13 : 12, 2, work ? 4 : 6, ME);
    r(5, 3, 6, 1, SH); r(4, 4, 8, 1, SH); r(3, 5, 10, 5, SH); r(3, 5, 1, 5, SH2); r(3, 10, 10, 1, col);
    r(8, 5, 5, 4, '#0b0f17'); r(10, 6, 2, 2, GLOW); r(10, 6, 1, 1, '#ffffff');
    r(5, 0, 1, 3, ME2); r(4, 0, 3, 1, col);
  }
}

export function sprite(type, color, dir, frame) {
  const key = `${type}|${color}|${dir}|${frame}`;
  let cv = cache.get(key);
  if (cv) return cv;
  cv = makeCanvas(SPRITE_W, SPRITE_H);
  const g = cv.getContext('2d');
  const r = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(x + 1, y + 1, w, h); };
  (type === 'astro' ? astro : robot)(r, null, color, dir, frame);
  outline(cv);
  cache.set(key, cv);
  return cv;
}
