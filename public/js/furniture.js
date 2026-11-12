import { T, MEET_W } from './consts.js';
import { C, rect, cube, shade, noise, text, textWidth } from './art.js';

// The six stations. Each has
//   slots:  where agents stand (tile in the room, and the way they face)
//   blocks: tiles nobody can walk through
//   draw(g, ox, oy):                    static furniture, drawn once (ox/oy = pixel position of the room's floor)
//   animate(g, ox, oy, t, occ, extra):  lights, screens and effects, drawn every frame
// Agents always stand in front of (south of) their furniture facing north, so nothing needs to hide them.

const px = (tiles) => tiles * T;
const slot = (x, y, face = 'up') => ({ x, y, face });

function plant(g, x, y, leaf = C.green) {
  rect(g, x + 4, y + 8, 8, 6, '#4d2f22'); rect(g, x + 4, y + 8, 8, 1, '#7a4b34');
  for (const [dx, dy, w, h] of [[7, 0, 2, 9], [4, 3, 3, 6], [9, 3, 3, 6], [2, 6, 3, 3], [11, 6, 3, 3]]) rect(g, x + dx, y + dy, w, h, leaf);
  rect(g, x + 7, y, 2, 2, shade(leaf, 0.4));
}

function crate(g, x, y, w = 16, h = 8, d = 12) {
  cube(g, x, y, w, h, d, '#7a6244', '#5a4630');
  rect(g, x + 2, y - d + h + 2, 2, d - 4, '#3b2d1e'); rect(g, x + w - 4, y - d + h + 2, 2, d - 4, '#3b2d1e');
  rect(g, x + 4, y - d + h + 5, w - 8, 1, '#3b2d1e');
}

// small blinking light
const lamp = (g, x, y, on, c) => rect(g, x, y, 2, 2, on ? c : '#1f2733');

// ===================================================================== gate
function drawGate(g, ox, oy) {
  const x0 = ox + px(7), w = px(4);
  // hazard-striped carpet leading to the airlock
  rect(g, x0 - 4, oy, w + 8, px(6), '#12171f');
  for (let y = 0; y < px(6); y += 8) for (let i = 0; i < 2; i++) {
    const x = i ? x0 + w + 0 : x0 - 4;
    for (let k = 0; k < 4; k++) rect(g, x + k, oy + y + ((k + y / 8) % 2) * 4, 1, 4, '#c9731f');
  }
  for (let y = 4; y < px(6); y += 16) { rect(g, x0 + 8, oy + y, 48, 1, '#2a3446'); }
  // reception desk
  cube(g, ox + px(1), oy + px(3), px(5), px(2), 14, '#4b5d7b', '#2c3646', '#1d2636');
  rect(g, ox + px(1) + 6, oy + px(3) - 14 + 3, 20, 6, '#0c2230'); rect(g, ox + px(1) + 8, oy + px(3) - 14 + 5, 12, 1, C.violet);
  rect(g, ox + px(1) + 40, oy + px(3) - 14 + 4, 6, 4, C.orange);
  // luggage and a bench
  crate(g, ox + px(13), oy + px(2) + 8, 16, 8, 12); crate(g, ox + px(14) + 2, oy + px(2) + 4, 16, 8, 12); crate(g, ox + px(13) + 4, oy + px(3), 12, 8, 8);
  cube(g, ox + px(13), oy + px(6), px(4), 8, 8, '#4a5d7e', '#2c3a52');
  plant(g, ox + px(0), oy + px(8)); plant(g, ox + px(16) + 2, oy + px(8));
}
function animateGate(g, ox, oy, t, occ, ex) {
  // sliding airlock doors on the wall face, with warning lamps
  const open = ex.gateOpen ?? 0, x0 = ox + px(7), y0 = oy - px(2) + 2, w = px(4), h = px(2) - 2;
  rect(g, x0, y0, w, h, '#05070b');
  const half = Math.round((w / 2) * (1 - open));
  for (const [x, dx] of [[x0, 0], [x0 + w - half, 1]]) {
    if (half <= 0) continue;
    rect(g, x, y0, half, h, '#56688a'); rect(g, x, y0, half, 1, '#8aa0c4');
    for (let r = 4; r < h; r += 8) rect(g, x, y0 + r, half, 1, '#3a4a63');
    rect(g, dx ? x : x + half - 2, y0, 2, h, '#2c3646');
  }
  for (let i = 0; i < 8; i++) rect(g, x0 + 2 + i * 8, y0 - 3, 4, 2, (i + Math.floor(t * 4)) % 2 ? C.orange : '#7a4414');
  lamp(g, x0 - 5, y0 + 4, open > 0.2 || Math.floor(t * 3) % 2, open > 0.2 ? C.green : C.red);
  lamp(g, x0 + w + 3, y0 + 4, open > 0.2 || Math.floor(t * 3) % 2, open > 0.2 ? C.green : C.red);
  // glowing chevrons running toward the door
  for (let i = 0; i < 5; i++) {
    const y = oy + px(5) - ((t * 20 + i * 16) % 80);
    if (y > oy + 2) { rect(g, x0 + 24, y, 16, 1, C.violet); rect(g, x0 + 28, y - 1, 8, 1, C.violet); }
  }
}

// ================================================================== archive
function drawArchive(g, ox, oy) {
  // rug under the reading table
  rect(g, ox + px(5), oy + px(4), px(8), px(5), '#1b2d3c'); rect(g, ox + px(5), oy + px(4), px(8), 1, C.cyan); rect(g, ox + px(5), oy + px(9) - 1, px(8), 1, C.cyan);
  for (let i = 0; i < 8; i++) { rect(g, ox + px(5) + i * 16 + 6, oy + px(4) + 4, 4, 4, '#244a56'); rect(g, ox + px(5) + i * 16 + 6, oy + px(9) - 8, 4, 4, '#244a56'); }
  // bookcases against the north wall
  for (let s = 0; s < 4; s++) {
    const x = ox + px(1) + s * px(4), y = oy - 6;
    rect(g, x, y, px(4) - 2, 42, '#2a3550'); rect(g, x, y, px(4) - 2, 1, '#4b5d7b'); rect(g, x + 2, y + 2, px(4) - 6, 38, '#0e1422');
    for (let r = 0; r < 3; r++) {
      const sy = y + 3 + r * 12;
      let bx = x + 3;
      for (let i = 0; bx < x + px(4) - 8; i++) {
        const w = 2 + Math.floor(noise(s * 40 + r * 9 + i) * 3), h = 6 + Math.floor(noise(s * 17 + r * 5 + i + 3) * 4);
        const col = ['#2f8f8a', '#c98a2b', '#6b7f99', '#a2503a', '#7c8f3f', '#4a6fa8', '#8a6bff'][Math.floor(noise(s * 7 + r * 3 + i) * 7)];
        rect(g, bx, sy + 10 - h, w, h, col); rect(g, bx, sy + 10 - h, w, 1, 'rgba(255,255,255,.25)');
        bx += w + (noise(i + r) < 0.2 ? 2 : 0);
      }
      rect(g, x + 2, sy + 10, px(4) - 6, 1, '#3a4a63');
    }
  }
  // reading table
  cube(g, ox + px(7), oy + px(5), px(4), px(2), 10, '#3a4c7a', '#222f50', '#18213a');
  rect(g, ox + px(7) + 4, oy + px(5) - 10 + 3, px(4) - 8, 1, C.cyan);
  plant(g, ox + px(0), oy + px(8)); plant(g, ox + px(16) + 2, oy + px(8), C.cyan);
}
function animateArchive(g, ox, oy, t, occ) {
  if (occ.size) {   // scan line sweeping over the shelves
    const x = ox + px(1) + ((t * 40) % (px(16)));
    rect(g, x, oy - 4, 2, 38, 'rgba(110,224,255,.35)'); rect(g, x - 2, oy - 4, 6, 38, 'rgba(110,224,255,.12)');
  }
  // floating holo book above the table
  const bx = ox + px(9) - 8, by = oy + px(5) - 24 + Math.round(Math.sin(t * 2) * 2);
  rect(g, bx, by, 7, 9, '#c98a2b'); rect(g, bx + 9, by, 7, 9, '#c98a2b'); rect(g, bx + 1, by + 1, 5, 7, '#fff2c8'); rect(g, bx + 10, by + 1, 5, 7, '#fff2c8');
  for (let i = 0; i < 3; i++) { rect(g, bx + 2, by + 2 + i * 2, 3, 1, '#c98a2b'); rect(g, bx + 11, by + 2 + i * 2, 3, 1, '#c98a2b'); }
  rect(g, bx - 3, by + 11, 22, 1, 'rgba(110,224,255,.5)');
  for (let i = 0; i < 4; i++) rect(g, bx + 2 + ((i * 5 + Math.floor(t * 6)) % 14), by - 3 - (i * 3 + t * 8) % 6, 1, 1, C.cyan);
}

// =================================================================== comms
function drawComms(g, ox, oy) {
  // dish platform
  rect(g, ox + px(6), oy + px(1) + 4, px(6), px(3) - 4, '#222d42');
  cube(g, ox + px(6) + 4, oy + px(3) - 2, px(6) - 8, 10, 8, '#4b5d7b', '#2c3646', '#1d2636');
  rect(g, ox + px(9) - 4, oy + px(1) + 6, 8, 6, '#56688a');
  // operator consoles
  for (const x of [1, 13]) {
    cube(g, ox + px(x), oy + px(3), px(4), px(2), 12, '#3a4c70', '#222f4c', '#18213a');
    for (let i = 0; i < 3; i++) {
      const sx = ox + px(x) + 4 + i * 20, sy = oy + px(3) - 12 - 8;
      rect(g, sx, sy, 16, 10, '#0c1a28'); rect(g, sx, sy, 16, 1, '#2f4260');
    }
  }
  // antenna masts
  for (const x of [0, 17]) { rect(g, ox + px(x) + 7, oy + px(1), 2, 26, '#5b6878'); for (let i = 0; i < 3; i++) rect(g, ox + px(x) + 3, oy + px(1) + 2 + i * 6, 10 - i * 2, 1, '#a5b3c7'); rect(g, ox + px(x) + 7, oy + px(1) - 2, 2, 2, C.red); }
}
function animateComms(g, ox, oy, t, occ) {
  const act = occ.size > 0, cx = ox + px(9), cy = oy + px(3), ang = t * (act ? 1.6 : 0.5);
  // rotating dish: the ellipse narrows and widens as it turns, with the feed horn on a short arm
  const rx = 5 + Math.round(Math.abs(Math.cos(ang)) * 13), ry = 6;
  rect(g, cx - 2, cy + 2, 4, 9, '#5b6878');
  for (let dy = -ry; dy <= ry; dy++) {
    const w = Math.round(rx * Math.sqrt(1 - (dy / ry) * (dy / ry)));
    rect(g, cx - w, cy + dy - 8, w * 2 + 1, 1, dy < -2 ? '#e9eff6' : dy < 2 ? '#a5b3c7' : '#6b7a92');
  }
  rect(g, cx - rx, cy - 8, rx * 2 + 1, 1, '#ffffff');
  const hx = cx + Math.round(Math.sin(ang) * 4);
  rect(g, hx, cy - 20, 1, 12, '#5b6878'); rect(g, hx - 1, cy - 22, 3, 2, Math.floor(t * 3) % 2 ? C.red : '#7a2a2a');
  if (act) for (let k = 0; k < 3; k++) {
    const p = (t * 1.1 + k / 3) % 1, r = 4 + p * 16;
    g.fillStyle = `rgba(155,232,255,${(1 - p) * 0.7})`;
    for (let q = -3; q <= 3; q++) g.fillRect(Math.round(cx + q * r * 0.35), Math.round(cy - 24 - r + Math.abs(q) * 2), 2, 1);
  }
  for (const x of [1, 13]) for (let i = 0; i < 3; i++) {
    const sx = ox + px(x) + 4 + i * 20, sy = oy + px(3) - 20;
    for (let l = 0; l < 3; l++) rect(g, sx + 2, sy + 2 + l * 3, 3 + Math.floor(noise(Math.floor(t * (act ? 6 : 1)) + i * 5 + l + x) * 10), 1, l === 1 ? C.orange : C.blue);
  }
}

// =================================================================== coding
const DESKS = [[1, 1], [4, 1], [11, 1], [14, 1], [1, 5], [4, 5], [11, 5], [14, 5]];   // each 3 tiles wide
function drawDesks(g, ox, oy) {
  for (const [dx, dy] of DESKS) {
    cube(g, ox + px(dx), oy + px(dy + 1), px(3), 10, 12, '#e3eaf3', '#3c4a63', '#2a3550');
    rect(g, ox + px(dx) + 6, oy + px(dy + 1) - 12 + 2, 18, 4, '#7ea6ff');       // keyboard glow strip
    rect(g, ox + px(dx) + px(3) - 10, oy + px(dy + 1) - 12 - 4, 2, 6, '#a5b3c7'); rect(g, ox + px(dx) + px(3) - 11, oy + px(dy + 1) - 12 - 6, 4, 3, C.yellow);   // lamp
  }
  // wall cabinets and plants
  for (const x of [0, 17]) cube(g, ox + px(x), oy + px(8), T, 8, 18, '#2c3646', '#1f2836');
  plant(g, ox + px(0), oy + px(2) + 2); plant(g, ox + px(17), oy + px(2) + 2, C.cyan);
}
function animateDesks(g, ox, oy, t, occ, ex) {
  const busy = new Set([...occ].map(i => ex.deskOfSlot[i]));
  DESKS.forEach(([dx, dy], i) => {
    const on = busy.has(i), x = ox + px(dx) + 4, y = oy + px(dy + 1) - 12 - 22;
    rect(g, x, y, 40, 20, on ? '#06202a' : '#0a1620'); rect(g, x, y, 40, 1, on ? C.blue : '#2f4260'); rect(g, x, y + 19, 40, 1, on ? C.blue : '#2f4260');
    for (let l = 0; l < 5; l++) {
      const len = 4 + Math.floor(noise(Math.floor(t * (on ? 5 : 0.4)) + i * 9 + l) * 24);
      rect(g, x + 3, y + 3 + l * 3, on ? len : Math.min(len, 14), 1, on ? ['#3de0c8', '#8a6bff', '#6ec1ff', '#e9eff6'][(l + i) % 4] : '#2a4a5a');
    }
    if (on && Math.floor(t * 2) % 2) rect(g, x + 36, y + 15, 2, 3, C.cyan);   // blinking cursor
  });
}

// ================================================================= workbench
function drawBench(g, ox, oy) {
  const racks = [1, 2, 3, 4, 5, 12, 13, 14, 15, 16];
  for (const x of racks) {
    cube(g, ox + px(x), oy + px(0), T, px(2), 24, '#4b5d7b', '#1c2432', '#141b27');
    for (let v = 0; v < 5; v++) rect(g, ox + px(x) + 2, oy - 20 + v * 5, T - 4, 1, '#34425b');
    rect(g, ox + px(x) + 2, oy + px(2) - 22, T - 4, 20, '#0e141e');
    for (let r = 0; r < 4; r++) rect(g, ox + px(x) + 3, oy + px(2) - 21 + r * 5, T - 6, 4, '#1a2433');
  }
  // workbench with anvil, vice, tools
  cube(g, ox + px(4), oy + px(6), px(10), px(2), 12, '#8a5a3a', '#5d3c27', '#412a1b');
  cube(g, ox + px(9) + 4, oy + px(6) + 8, 14, 8, 8, '#2c3646', '#1c2432');
  rect(g, ox + px(9), oy + px(6) - 12 - 4, 22, 4, '#2c3646'); rect(g, ox + px(9) + 6, oy + px(6) - 12 - 8, 10, 4, '#2c3646');
  rect(g, ox + px(5), oy + px(6) - 12 - 3, 8, 3, C.orange); rect(g, ox + px(6) + 2, oy + px(6) - 12 - 6, 2, 3, '#a5b3c7');
  cube(g, ox + px(0), oy + px(9) - 4, T, 6, 12, '#7a6244', '#5a4630');
  plant(g, ox + px(16) + 2, oy + px(8));
}
function animateBench(g, ox, oy, t, occ) {
  const act = occ.size > 0, rate = act ? 7 : 1.5, racks = [1, 2, 3, 4, 5, 12, 13, 14, 15, 16];
  racks.forEach((x, ri) => {
    for (let r = 0; r < 4; r++) for (let c = 0; c < 3; c++) {
      const v = Math.floor(noise(Math.floor(t * rate) + ri * 17 + r * 5 + c) * 6);
      rect(g, ox + px(x) + 4 + c * 3, oy + px(2) - 20 + r * 5, 2, 1, v === 0 ? C.red : v < 4 ? C.green : '#1f3a30');
    }
  });
  // spinning fan on the first rack, beacon on the last
  const fx = ox + px(3) + 8, fy = oy + px(2) - 28, a = Math.floor(t * (act ? 14 : 3)) % 2;
  rect(g, fx - 5, fy, 10, 1, a ? C.orange : '#7a4414'); rect(g, fx, fy - 5, 1, 10, a ? '#7a4414' : C.orange); rect(g, fx - 6, fy - 6, 12, 1, '#a5b3c7'); rect(g, fx - 6, fy + 6, 12, 1, '#a5b3c7');
  rect(g, ox + px(16) + 5, oy + px(2) - 30, 5, 4, Math.floor(t * (act ? 6 : 2)) % 2 ? C.orange : '#7a4414');
  if (act) for (let i = 0; i < 6; i++) {   // sparks off the anvil
    const p = (t * 3 + i * 0.37) % 1, x = ox + px(9) + 14 + (i - 3) * 5 * p, y = oy + px(6) - 20 - Math.sin(p * Math.PI) * 14 + p * 6;
    rect(g, x, y, 1, 1, p < 0.5 ? '#fff2c8' : C.orange);
  }
}

// =================================================================== lounge
function drawLounge(g, ox, oy) {
  // coffee bar with machine
  cube(g, ox + px(1), oy + px(1) + 8, px(6), px(1) + 8, 14, '#8a5a3a', '#5d3c27', '#412a1b');
  cube(g, ox + px(1) + 6, oy + px(1) + 6, 20, 8, 22, '#2c3646', '#1c2432', '#141b27');
  rect(g, ox + px(1) + 11, oy + px(1) + 2 - 8, 10, 6, '#0c2230'); rect(g, ox + px(1) + 12, oy + px(1) - 4, 8, 1, C.orange);
  rect(g, ox + px(1) + 14, oy + px(1) + 6, 4, 5, '#e9eff6'); rect(g, ox + px(1) + 44, oy + px(1) - 4 + 8, 5, 5, '#e9eff6'); rect(g, ox + px(1) + 62, oy + px(1) - 2 + 8, 5, 5, C.orange);
  // sofa
  const sx = ox + px(11), sy = oy + px(1);
  cube(g, sx, sy + 4, px(6), px(2), 10, '#b5503a', '#8d3b2a', '#6a2a1c');
  cube(g, sx, sy + 20, px(6), 12, 6, '#c9604a', '#b5503a');
  for (let i = 1; i < 3; i++) rect(g, sx + i * 32, sy + 20 - 6, 1, 18, '#8d3b2a');
  // wall TV above the sofa is drawn in animate
  // table and rug
  rect(g, ox + px(6), oy + px(5), px(6), px(4), '#3a2a2a'); rect(g, ox + px(6), oy + px(5), px(6), 1, C.orange);
  cube(g, ox + px(7) + 4, oy + px(6), px(3) + 8, 8, 8, '#8a5a3a', '#5d3c27');
  rect(g, ox + px(8), oy + px(6) - 10, 4, 4, '#e9eff6'); rect(g, ox + px(9) + 4, oy + px(6) - 9, 4, 4, C.orange);
  plant(g, ox + px(0), oy + px(8)); plant(g, ox + px(17), oy + px(7), C.green);
  // hanging lamps along the north side are in animate
}
function animateLounge(g, ox, oy, t, occ) {
  // wall TV
  const tx = ox + px(12), ty = oy - px(2) + 6;
  rect(g, tx, ty, 64, 22, '#0b0f17'); rect(g, tx + 2, ty + 2, 60, 18, '#10202e');
  for (let i = 0; i < 6; i++) rect(g, tx + 4 + i * 10, ty + 18 - Math.floor(4 + noise(Math.floor(t * 3) + i) * 10), 6, Math.floor(4 + noise(Math.floor(t * 3) + i) * 10), i % 2 ? C.orange : C.blue);
  // pendant lamps
  for (const x of [3, 9, 14]) {
    const lx = ox + px(x) + 6, ly = oy - px(2) + 14 + Math.round(Math.sin(t * 1.5 + x) * 1);
    rect(g, lx + 3, oy - px(2) + 2, 1, ly - (oy - px(2) + 2), '#2c3646'); rect(g, lx - 2, ly, 10, 4, C.orange); rect(g, lx, ly + 4, 6, 2, '#ffd9a0');
    g.fillStyle = 'rgba(255,170,90,.07)'; g.fillRect(lx - 14, ly + 6, 34, 26);
  }
  // steam from the machine
  for (let i = 0; i < 4; i++) {
    const p = (t * 0.7 + i / 4) % 1;
    g.fillStyle = `rgba(233,239,246,${0.5 * (1 - p)})`;
    g.fillRect(Math.round(ox + px(1) + 16 + Math.sin(p * 7 + i) * 3), Math.round(oy + px(1) - 2 - p * 14), 2, 2);
  }
}

// =================================================================== meeting room
// MEET_W x 8 tiles in the middle of the station: a long holo table, ten seats, a wall screen.
// Seats come in opposite pairs (0,1) (2,3) (4,5) (6,7) (8,9).
const DX = (MEET_W - 30) / 2;     // the furniture is laid out for 30 tiles and centred in the room
const MEET_SEATS = [[11, 2, 'down'], [11, 6, 'up'], [13, 2, 'down'], [13, 6, 'up'], [16, 2, 'down'], [16, 6, 'up'], [18, 2, 'down'], [18, 6, 'up'], [9, 4, 'right'], [20, 4, 'left']].map(([x, y, f]) => [x + DX, y, f]);
function drawMeet(g, ox0, oy) {
  const ox = ox0 + DX * T;
  for (const s of STATION_DEFS.meet.slots) {
    rect(g, ox0 + s.x * T + 2, oy + s.y * T + 7, 12, 7, '#26324a'); rect(g, ox0 + s.x * T + 2, oy + s.y * T + 7, 12, 2, '#46597d');
  }
  // table
  rect(g, ox + 164, oy + 98, 152, 4, 'rgba(0,0,0,.35)');
  rect(g, ox + 168, oy + 49, 144, 46, '#3a4a68'); rect(g, ox + 160, oy + 57, 160, 30, '#3a4a68');
  rect(g, ox + 168, oy + 48, 144, 40, '#5a6f96'); rect(g, ox + 160, oy + 56, 160, 24, '#5a6f96');
  rect(g, ox + 164, oy + 88, 152, 6, '#26324a');
  rect(g, ox + 176, oy + 54, 128, 26, '#0d1a2b'); rect(g, ox + 176, oy + 54, 128, 1, '#6ee7ff'); rect(g, ox + 176, oy + 79, 128, 1, '#1f4a66');
  // wall screen on the north wall
  rect(g, ox + 78, oy - 28, 324, 22, '#5b6e8c'); rect(g, ox + 79, oy - 27, 322, 20, '#2c3a52'); rect(g, ox + 81, oy - 25, 318, 16, '#04101c');
  text(g, 'MEETING', ox + 84, oy - 23, '#6ee7ff');
  // plants in the corners
  for (const x of [1, MEET_W - 3]) { rect(g, ox0 + x * T + 2, oy + 6 * T + 8, 12, 6, '#4d2f22'); rect(g, ox0 + x * T + 7, oy + 6 * T - 2, 2, 11, C.green); rect(g, ox0 + x * T + 3, oy + 6 * T + 1, 4, 7, C.green); rect(g, ox0 + x * T + 9, oy + 6 * T + 1, 4, 7, C.green); }
}
function animateMeet(g, ox0, oy, t, occ) {
  const ox = ox0 + DX * T;
  const n = occ.size, act = n > 0, cx = ox + 240, cy = oy + 67, speed = 1 + n * 0.7;
  // wall screen: data bars that run faster while somebody is in the room
  const tick = Math.floor(t * (act ? 5 : 0.7));
  for (let i = 0; i < 28; i++) {
    const h = 2 + Math.floor(noise(tick + i * 3) * 11);
    rect(g, ox + 112 + i * 9, oy - 10 - h, 6, h, i % 7 === 3 ? C.orange : '#3dd9ff');
  }
  // light cone and floating orb above the table
  g.globalAlpha = act ? 0.14 : 0.05;
  for (let j = 0; j < 26; j++) rect(g, cx - 4 - j, cy - 2 - j, 9 + j * 2, 1, '#6ee7ff');
  g.globalAlpha = 1;
  rect(g, cx - 16, cy - 1, 32, 3, 'rgba(110,231,255,.28)'); rect(g, cx - 8, cy, 16, 1, '#6ee7ff');
  const bob = Math.round(Math.sin(t * 3) * 3);
  rect(g, cx - 5, cy - 24 + bob, 10, 10, '#6ee7ff'); rect(g, cx - 3, cy - 22 + bob, 6, 6, '#bff6ff'); rect(g, cx - 1, cy - 20 + bob, 2, 2, '#ffffff');
  for (let k = 0; k < 3; k++) {
    const a = t * speed + k * 2.09;
    rect(g, Math.round(cx + Math.cos(a) * 40), Math.round(cy - 10 + Math.sin(a) * 8), 2, 2, k ? '#6ee7ff' : '#ffc233');
  }
  if (n > 1) for (let i = 0; i < 14; i++) { const h = 1 + Math.floor(noise(Math.floor(t * 6) + i * 7) * 7); rect(g, ox + 182 + i * 8, oy + 78 - h, 4, h, '#6ee7ff'); }
  // beams from every seated agent to the table
  for (const i of occ) {
    const s = STATION_DEFS.meet.slots[i], sx = ox0 + s.x * T + 8, sy = oy + s.y * T + 6, steps = 12;
    g.globalAlpha = 0.5 + 0.3 * Math.sin(t * 5 + i);
    for (let k = 1; k < steps; k++) if ((k + Math.floor(t * 8)) % 3 === 0) rect(g, Math.round(sx + (cx - sx) * k / steps), Math.round(sy + (cy - sy) * k / steps), 2, 1, '#6ee7ff');
    g.globalAlpha = 1;
  }
}

// ============================================================ definitions
const UP = 'up';
export const STATION_DEFS = {
  door: {
    slots: [slot(7, 2), slot(10, 2), slot(6, 4), slot(8, 4), slot(10, 4), slot(12, 4), slot(9, 6)],
    blocks: [[1, 3, 5, 2], [13, 2, 4, 2], [13, 6, 4, 1], [0, 8, 1, 1], [16, 8, 1, 1]],
    spawn: { x: 9, y: 0.5 },
    draw: drawGate, animate: animateGate,
  },
  library: {
    slots: [slot(2, 2), slot(5, 2), slot(8, 2), slot(11, 2), slot(14, 2), slot(6, 6, 'right'), slot(11, 6, 'left')],
    blocks: [[1, 0, 16, 2], [7, 5, 4, 2], [0, 8, 1, 1], [16, 8, 1, 1]],
    draw: drawArchive, animate: animateArchive,
  },
  comms: {
    slots: [slot(2, 5), slot(4, 5), slot(13, 5), slot(15, 5), slot(9, 5), slot(5, 2, 'right'), slot(12, 2, 'left')],
    blocks: [[6, 1, 6, 3], [1, 3, 4, 2], [13, 3, 4, 2], [0, 1, 1, 2], [17, 1, 1, 2]],
    draw: drawComms, animate: animateComms,
  },
  desks: {
    slots: [slot(2, 3), slot(5, 3), slot(12, 3), slot(15, 3), slot(2, 7), slot(5, 7), slot(12, 7)],
    blocks: [[1, 1, 6, 2], [11, 1, 6, 2], [1, 5, 6, 2], [11, 5, 6, 2], [0, 2, 1, 1], [17, 2, 1, 1], [0, 8, 1, 1], [17, 8, 1, 1]],
    draw: drawDesks, animate: animateDesks,
    // which desk (index in DESKS) lights up for each slot
    deskOfSlot: [0, 1, 2, 3, 4, 5, 6],
  },
  bench: {
    slots: [slot(2, 2), slot(4, 2), slot(13, 2), slot(15, 2), slot(5, 8), slot(8, 8), slot(11, 8)],
    blocks: [[1, 0, 5, 2], [12, 0, 5, 2], [4, 6, 10, 2], [0, 9, 1, 1], [16, 8, 1, 1]],
    draw: drawBench, animate: animateBench,
  },
  meet: {
    slots: MEET_SEATS.map(([x, y, f]) => slot(x, y, f)),
    blocks: [[10 + DX, 3, 10, 3]],
    draw: drawMeet, animate: animateMeet,
  },
  lounge: {
    slots: [slot(2, 3), slot(4, 3), slot(6, 3), slot(12, 3), slot(14, 3), slot(16, 3), slot(9, 8)],
    blocks: [[1, 1, 6, 2], [11, 1, 6, 2], [7, 6, 4, 1], [0, 8, 1, 1], [17, 7, 1, 1]],
    draw: drawLounge, animate: animateLounge,
  },
};
