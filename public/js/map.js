import { T, ROOM_W, ROOM_H, FACE, DOOR_X, DOOR_W, MARGIN, COL_X, TOP_Y, HALL_Y, HALL_FLOOR_Y, HALL_H, HALL_W, HB, BOT_Y, MEET_W, MEET_H, MEET_TX, MEET_Y, MEET_CAP_N, MEET_CAP_S, MAP_W, MAP_H, PX_W, PX_H, ROOMS, ROOM } from './consts.js';
import { STATION_DEFS } from './layout.js';

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

