import { T, ROOM_W, ROOM_H, FACE, DOOR_X, DOOR_W, MARGIN, COL_X, TOP_Y, HALL_Y, HALL_FLOOR_Y, HALL_H, HALL_W, HB, BOT_Y, MEET_W, MEET_H, MEET_TX, MEET_Y, MEET_CAP_N, MEET_CAP_S, MAP_W, MAP_H, PX_W, PX_H, ROOMS, ROOM } from './consts.js';
import { STATION_DEFS } from './furniture.js';
import { C, rect, shade, makeCanvas, noise, text, textWidth } from './art.js';

// ------------------------------------------------------------------ positions
// feet position (pixels) of the agent standing in slot i of a room, and the way it faces
export function slotPos(key, i) {
  const r = ROOM[key], s = STATION_DEFS[key].slots[i % STATION_DEFS[key].slots.length];
  return { x: (r.tx + s.x + 0.5) * T, y: (r.ty + s.y + 0.5) * T + 5, face: s.face };
}
export const SLOT_COUNT = key => STATION_DEFS[key].slots.length;
export const roomOrigin = key => ({ x: ROOM[key].tx * T, y: ROOM[key].ty * T });
export const roomRect = key => ({ x: ROOM[key].tx * T, y: ROOM[key].ty * T, w: (ROOM[key].w ?? ROOM_W) * T, h: (ROOM[key].h ?? ROOM_H) * T });
export const spawnPos = () => { const r = ROOM.door, s = STATION_DEFS.door.spawn; return { x: (r.tx + s.x) * T, y: (r.ty + s.y) * T + 6 }; };

// door openings: where one room meets the hallway
const MEET_DOOR_X = MEET_TX + (MEET_W - DOOR_W) / 2;
export const DOORS = [
  ...ROOMS.map(r => {
    const x = (r.tx + DOOR_X) * T, w = DOOR_W * T;
    return r.top
      ? { id: r.key, key: r.key, x, y: (HALL_Y) * T, w, h: FACE * T, cy: (HALL_Y + FACE) * T }          // south wall of a top room, faces the hall
      : { id: r.key, key: r.key, x, y: (BOT_Y - FACE) * T, w, h: FACE * T, cy: (BOT_Y - FACE) * T };    // north wall of a bottom room, faces the room
  }),
  // the meeting room has one door to the hallway on its north and one on its south side
  { id: 'meet-n', key: 'meet', x: MEET_DOOR_X * T, y: (MEET_Y - FACE) * T, w: DOOR_W * T, h: FACE * T, cy: (MEET_Y - FACE) * T },
  { id: 'meet-s', key: 'meet', x: MEET_DOOR_X * T, y: (MEET_CAP_S + 1) * T, w: DOOR_W * T, h: FACE * T, cy: (MEET_CAP_S + 1 + FACE) * T },
];

// ------------------------------------------------------------ walkable grid
const walk = new Uint8Array(MAP_W * MAP_H);
const idx = (x, y) => y * MAP_W + x;
const fill = (x, y, w, h, v) => { for (let j = y; j < y + h; j++) for (let i = x; i < x + w; i++) walk[idx(i, j)] = v; };

for (const r of ROOMS) fill(r.tx, r.ty, ROOM_W, ROOM_H, 1);
fill(COL_X[0], HALL_FLOOR_Y, COL_X[2] + ROOM_W - COL_X[0], HALL_H - FACE, 1);
for (const r of ROOMS) {                                   // door passages through the walls
  if (r.top) fill(r.tx + DOOR_X, TOP_Y + ROOM_H, DOOR_W, HALL_FLOOR_Y - (TOP_Y + ROOM_H), 1);
  else fill(r.tx + DOOR_X, HALL_Y + HALL_H, DOOR_W, BOT_Y - (HALL_Y + HALL_H), 1);
}
// the meeting room: walls all round, a door in the middle of its north and south wall
fill(MEET_TX - 1, MEET_CAP_N, MEET_W + 2, MEET_CAP_S + FACE + 1 - MEET_CAP_N, 0);
fill(MEET_TX, MEET_Y, MEET_W, MEET_H, 1);
fill(MEET_DOOR_X, MEET_CAP_N, DOOR_W, MEET_Y - MEET_CAP_N, 1);
fill(MEET_DOOR_X, MEET_CAP_S, DOOR_W, FACE + 1, 1);
// hallway planters: the four corners and the middle of both side strips
const HALL_LAST = HALL_FLOOR_Y + HALL_H - FACE - 1, HALL_RIGHT = COL_X[2] + ROOM_W - 1, HALL_MID = MEET_Y + (MEET_H >> 1);
const HALL_BLOCKS = [[COL_X[0], HALL_FLOOR_Y, 1, 1], [HALL_RIGHT, HALL_FLOOR_Y, 1, 1], [COL_X[0], HALL_LAST, 1, 1], [HALL_RIGHT, HALL_LAST, 1, 1], [COL_X[0], HALL_MID, 1, 1], [HALL_RIGHT, HALL_MID, 1, 1]];
for (const [x, y, w, h] of HALL_BLOCKS) fill(x, y, w, h, 0);
const SPOTS = [...ROOMS, ROOM.meet];
for (const r of SPOTS) for (const [x, y, w, h] of STATION_DEFS[r.key].blocks) fill(r.tx + x, r.ty + y, w, h, 0);
for (const r of SPOTS) STATION_DEFS[r.key].slots.forEach(s => { walk[idx(r.tx + s.x, r.ty + s.y)] = 1; });

const tileOf = p => [Math.max(0, Math.min(MAP_W - 1, Math.floor(p.x / T))), Math.max(0, Math.min(MAP_H - 1, Math.floor((p.y - 4) / T)))];

function nearestWalkable(tx, ty) {
  if (walk[idx(tx, ty)]) return [tx, ty];
  for (let r = 1; r < 12; r++) for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
    const x = tx + dx, y = ty + dy;
    if (Math.max(Math.abs(dx), Math.abs(dy)) === r && x >= 0 && y >= 0 && x < MAP_W && y < MAP_H && walk[idx(x, y)]) return [x, y];
  }
  return [tx, ty];
}

// A* over tiles with 8 directions (no cutting corners), then drop collinear points. Returns pixel waypoints.
export function findPath(from, to) {
  const [sx, sy] = nearestWalkable(...tileOf(from)), [gx, gy] = nearestWalkable(...tileOf(to));
  const open = [[sx, sy]], g = new Map([[idx(sx, sy), 0]]), came = new Map(), closed = new Set();
  const h = (x, y) => Math.hypot(x - gx, y - gy);
  const f = new Map([[idx(sx, sy), h(sx, sy)]]);
  while (open.length) {
    let bi = 0;
    for (let i = 1; i < open.length; i++) if (f.get(idx(...open[i])) < f.get(idx(...open[bi]))) bi = i;
    const [x, y] = open.splice(bi, 1)[0];
    if (x === gx && y === gy) break;
    closed.add(idx(x, y));
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      if (!dx && !dy) continue;
      const nx = x + dx, ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= MAP_W || ny >= MAP_H || !walk[idx(nx, ny)] || closed.has(idx(nx, ny))) continue;
      if (dx && dy && (!walk[idx(x + dx, y)] || !walk[idx(x, y + dy)])) continue;
      const ng = g.get(idx(x, y)) + (dx && dy ? 1.414 : 1);
      if (ng < (g.get(idx(nx, ny)) ?? Infinity)) {
        g.set(idx(nx, ny), ng); f.set(idx(nx, ny), ng + h(nx, ny)); came.set(idx(nx, ny), [x, y]);
        if (!open.some(o => o[0] === nx && o[1] === ny)) open.push([nx, ny]);
      }
    }
  }
  const tiles = [[gx, gy]];
  for (let cur = came.get(idx(gx, gy)); cur; cur = came.get(idx(...cur))) tiles.unshift(cur);
  const pts = tiles.map(([x, y]) => ({ x: (x + 0.5) * T, y: (y + 0.5) * T + 5 }));
  const out = [];
  pts.forEach((p, i) => {
    if (i && i < pts.length - 1) {
      const a = pts[i - 1], b = pts[i + 1];
      if ((p.x - a.x) * (b.y - p.y) === (p.y - a.y) * (b.x - p.x)) return;   // straight on
    }
    out.push(p);
  });
  out[out.length - 1] = { x: to.x, y: to.y };
  return out;
}

// ---------------------------------------------------------------- static art
export const WINDOWS = [];   // glass areas, filled with stars every frame

function panelFace(g, x, y, w, h, accent) {
  rect(g, x, y, w, h, C.face);
  for (let px = 0; px < w; px += 32) { rect(g, x + px, y, 1, h, C.faceLine); rect(g, x + px + 1, y, 1, h, C.face2); }
  rect(g, x, y + h - 3, w, 3, '#141c30'); rect(g, x, y + h - 4, w, 1, accent);       // skirting with a neon edge
  rect(g, x, y, w, 2, '#33446e');
  for (let px = 8; px < w; px += 32) { rect(g, x + px, y + 4, 12, 1, '#10182a'); rect(g, x + px, y + 6, 12, 1, '#10182a'); }   // vents
}

function windowAt(g, x, y, w, h) {
  rect(g, x - 2, y - 2, w + 4, h + 4, '#5b6e8c'); rect(g, x - 1, y - 1, w + 2, h + 2, '#2c3a52'); rect(g, x, y, w, h, '#04060c');
  WINDOWS.push({ x, y, w, h });
  rect(g, x + (w >> 1), y, 1, h, '#2c3a52'); rect(g, x, y + (h >> 1), w, 1, '#2c3a52');
}

function floorTiles(g, x, y, cols, rows, a, b, line, seed = 0) {
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    const px = x + i * T, py = y + j * T;
    rect(g, px, py, T, T, (i + j) % 2 ? a : b);
    rect(g, px, py, T, 1, line); rect(g, px, py, 1, T, line);
    rect(g, px + 2, py + 2, 1, 1, 'rgba(255,255,255,.07)'); rect(g, px + T - 3, py + T - 3, 1, 1, 'rgba(255,255,255,.07)');
    if (noise(seed + i * 13 + j * 7) < 0.1) rect(g, px + 5, py + 6, 4, 1, 'rgba(255,255,255,.04)');
  }
}

export function renderStatic() {
  const cv = makeCanvas(PX_W, PX_H), g = cv.getContext('2d');
  rect(g, 0, 0, PX_W, PX_H, C.void);
  for (let i = 0; i < 260; i++) rect(g, noise(i) * PX_W, noise(i + 999) * PX_H, 1, 1, `rgba(190,210,255,${0.25 + noise(i + 5) * 0.5})`);

  // hull: plated slab with the walls drawn as its raised top
  const hx = (MARGIN) * T, hy = MARGIN * T, hw = (MAP_W - 2 * MARGIN) * T, hh = (MAP_H - 2 * MARGIN) * T;
  rect(g, hx - 6, hy - 6, hw + 12, hh + 12, '#101826'); rect(g, hx - 6, hy - 6, hw + 12, 2, '#2f4058'); rect(g, hx - 6, hy + hh + 4, hw + 12, 2, '#070a10');
  for (let x = hx - 4; x < hx + hw + 4; x += 24) { rect(g, x, hy - 5, 2, 2, '#2f4058'); rect(g, x, hy + hh + 2, 2, 2, '#2f4058'); }
  rect(g, hx, hy, hw, hh, C.wallCap);
  for (let x = hx; x < hx + hw; x += T) rect(g, x, hy, 1, hh, C.wallCapLo);
  for (let y = hy; y < hy + hh; y += T) rect(g, hx, y, hw, 1, C.wallCapLo);
  rect(g, hx, hy, hw, 2, C.wallCapHi); rect(g, hx, hy + hh - 2, hw, 2, '#26324a');

  // floors
  for (const r of ROOMS) {
    const x = r.tx * T, y = r.ty * T;
    floorTiles(g, x, y, ROOM_W, ROOM_H, C.floorA, C.floorB, C.floorLine, r.tx * 31 + r.ty);
    rect(g, x, y + ROOM_H * T - 1, ROOM_W * T, 1, r.color); rect(g, x, y, 1, ROOM_H * T, shade(r.color, -0.5)); rect(g, x + ROOM_W * T - 1, y, 1, ROOM_H * T, shade(r.color, -0.5));
  }
  const hallX = COL_X[0] * T, hallY = HALL_FLOOR_Y * T, hallW = (COL_X[2] + ROOM_W - COL_X[0]) * T, hallH = (HALL_H - FACE) * T;
  floorTiles(g, hallX, hallY, hallW / T, hallH / T, C.floorHall, C.floorHall2, '#16202f', 77);
  // guide line running round the meeting room
  const gl = (HALL_FLOOR_Y + 1) * T + 7, gb = (MEET_CAP_S + 1 + FACE + 1) * T + 7, gx0 = (COL_X[0] + 7) * T + 7, gx1 = (COL_X[0] + HALL_W - 8) * T + 7;
  for (let x = gx0; x <= gx1; x += 24) { rect(g, x, gl, 12, 2, '#9a5420'); rect(g, x, gb, 12, 2, '#9a5420'); }
  for (let y = gl; y <= gb; y += 24) { rect(g, gx0, y, 2, 12, '#9a5420'); rect(g, gx1, y, 2, 12, '#9a5420'); }
  // door passages: floor continues through the wall
  for (const r of ROOMS) {
    const x = (r.tx + DOOR_X) * T, w = DOOR_W * T;
    if (r.top) floorTiles(g, x, (TOP_Y + ROOM_H) * T, DOOR_W, HALL_FLOOR_Y - (TOP_Y + ROOM_H), C.floorHall, C.floorHall2, '#16202f', 5);
    else floorTiles(g, x, (HALL_Y + HALL_H) * T, DOOR_W, BOT_Y - (HALL_Y + HALL_H), C.floorHall, C.floorHall2, '#16202f', 6);
  }

  // the meeting room in the middle: wall block, floor, door passages, wall faces
  {
    const mx = (MEET_TX - 1) * T, my = MEET_CAP_N * T, mw = (MEET_W + 2) * T, mh = (MEET_CAP_S + FACE + 1 - MEET_CAP_N) * T;
    rect(g, mx, my, mw, mh, C.wallCap);
    for (let x = mx; x < mx + mw; x += T) rect(g, x, my, 1, mh, C.wallCapLo);
    for (let y = my; y < my + mh; y += T) rect(g, mx, y, mw, 1, C.wallCapLo);
    rect(g, mx, my, mw, 2, C.wallCapHi);
    floorTiles(g, MEET_TX * T, MEET_Y * T, MEET_W, MEET_H, '#17293b', '#122234', '#1f4a66', 91);
    rect(g, MEET_TX * T, (MEET_Y + MEET_H) * T - 1, MEET_W * T, 1, ROOM.meet.color);
    floorTiles(g, MEET_DOOR_X * T, MEET_CAP_N * T, DOOR_W, MEET_Y - MEET_CAP_N, C.floorHall, C.floorHall2, '#16202f', 7);
    floorTiles(g, MEET_DOOR_X * T, MEET_CAP_S * T, DOOR_W, FACE + 1, C.floorHall, C.floorHall2, '#16202f', 8);
    panelFace(g, MEET_TX * T, (MEET_Y - FACE) * T, MEET_W * T, FACE * T, ROOM.meet.color);
    panelFace(g, MEET_TX * T, (MEET_CAP_S + 1) * T, MEET_W * T, FACE * T, '#33496e');
  }

  // north wall faces (inside every room) and south faces of the top rooms (seen from the hallway)
  for (const r of ROOMS) {
    const x = r.tx * T, y = r.ty * T;
    panelFace(g, x, y - FACE * T, ROOM_W * T, FACE * T, r.color);
    if (r.top) panelFace(g, x, HALL_Y * T, ROOM_W * T, FACE * T, '#33496e');
  }
  // door frames
  for (const d of DOORS) {
    const y0 = d.y;
    rect(g, d.x - 3, y0, 3, d.h, '#8aa0c4'); rect(g, d.x + d.w, y0, 3, d.h, '#8aa0c4'); rect(g, d.x - 3, y0 - 2, d.w + 6, 3, '#8aa0c4');
    for (let k = 0; k < d.h; k += 4) { rect(g, d.x - 3, y0 + k, 3, 2, k % 8 ? C.orange : '#2c3646'); rect(g, d.x + d.w, y0 + k, 3, 2, k % 8 ? C.orange : '#2c3646'); }
  }
  // windows
  for (const key of ['door', 'comms', 'desks', 'lounge', 'bench']) {
    const r = ROOM[key], x = r.tx * T, y = r.ty * T - FACE * T + 4;
    const cols = key === 'lounge' ? [[2, 4]] : key === 'bench' ? [[7, 4]] : [[1, 4], [13, 4]];
    for (const [c, w] of cols) windowAt(g, x + c * T, y, w * T, 18);
  }
  // room name plates on the cap row next to the hallway
  for (const r of ROOMS) {
    const capY = r.top ? (TOP_Y + ROOM_H) * T : (HALL_Y + HALL_H) * T, w = textWidth(r.label) + 10;
    const px = r.tx * T + 3 * T;
    rect(g, px, capY + 3, w, 10, '#0b0f17'); rect(g, px, capY + 3, w, 1, r.color); rect(g, px, capY + 12, w, 1, r.color);
    text(g, r.label, px + 5, capY + 5, r.color);
  }
  { const w = textWidth('MEETING') + 10, px = MEET_TX * T + 3 * T, capY = MEET_CAP_S * T;
    rect(g, px, capY + 3, w, 10, '#0b0f17'); rect(g, px, capY + 3, w, 1, ROOM.meet.color); rect(g, px, capY + 12, w, 1, ROOM.meet.color);
    text(g, 'MEETING', px + 5, capY + 5, ROOM.meet.color); }
  // furniture
  for (const r of SPOTS) STATION_DEFS[r.key].draw(g, r.tx * T, r.ty * T);

  // hallway decor: planters, benches, vending machine, floor arrows
  const planter = (x, y) => { rect(g, x + 2, y + 8, 12, 6, '#4d2f22'); for (const [dx, dy, w, h] of [[7, 0, 2, 9], [3, 3, 4, 6], [9, 3, 4, 6]]) rect(g, x + dx, y + dy, w, h, C.green); };
  for (const [x, y] of HALL_BLOCKS) planter(x * T, y * T);
  return cv;
}
