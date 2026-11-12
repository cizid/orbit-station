// Geometry of the office floor, in 16px tiles. Three rooms on top, a hallway, three rooms below.

export const T = 16;
export const ROOM_W = 18, ROOM_H = 10;      // floor size of one room, in tiles
export const SIDE = 2, GAP = 2, MARGIN = 3; // outer wall, wall between rooms, void around the hull
export const FACE = 2;                      // rows of the north wall you see from the front
export const HB = 4;                        // walkable bands of hallway above and below the meeting room
export const MEET_W = 40, MEET_H = 8;       // meeting room floor, in tiles
// hallway rows: south face of the top rooms, band, meeting room (wall cap, north face, floor, wall cap, south face), band
export const HALL_H = FACE + HB + 1 + FACE + MEET_H + 1 + FACE + HB;
export const DOOR_X = 7, DOOR_W = 4;        // door columns, local to a room's floor

// first floor column of each room column, and first floor row of each room row
export const COL_X = [0, 1, 2].map(i => MARGIN + SIDE + i * (ROOM_W + GAP));
export const TOP_Y = MARGIN + 1 + FACE;
export const HALL_Y = TOP_Y + ROOM_H + 1;
export const HALL_FLOOR_Y = HALL_Y + FACE;      // first walkable hallway row
export const BOT_Y = HALL_Y + HALL_H + 1 + FACE;
export const MEET_CAP_N = HALL_FLOOR_Y + HB;                 // wall cap row on top of the meeting room
export const MEET_Y = MEET_CAP_N + 1 + FACE;                 // first floor row of the meeting room
export const MEET_CAP_S = MEET_Y + MEET_H;                   // wall cap row below it
export const HALL_W = COL_X[2] + ROOM_W - COL_X[0];
export const MEET_TX = COL_X[0] + (HALL_W - MEET_W) / 2;     // centred between the outer rooms

export const MAP_W = COL_X[2] + ROOM_W + SIDE + MARGIN;   // tiles
export const MAP_H = BOT_Y + ROOM_H + 1 + MARGIN;

export const PX_W = MAP_W * T, PX_H = MAP_H * T;

// room key -> where its floor starts (tiles) and what colour accents it
export const ROOMS = [
  { key: 'door',    label: 'GATE',      color: '#8a6bff', tx: COL_X[0], ty: TOP_Y, top: true },
  { key: 'library', label: 'ARCHIVE',   color: '#3de0c8', tx: COL_X[1], ty: TOP_Y, top: true },
  { key: 'comms',   label: 'COMMS',     color: '#9be8ff', tx: COL_X[2], ty: TOP_Y, top: true },
  { key: 'desks',   label: 'CODING',    color: '#5aa9ff', tx: COL_X[0], ty: BOT_Y, top: false },
  { key: 'bench',   label: 'WORKBENCH', color: '#ffa24a', tx: COL_X[1], ty: BOT_Y, top: false },
  { key: 'lounge',  label: 'LOUNGE',    color: '#ff9a4a', tx: COL_X[2], ty: BOT_Y, top: false },
];
export const ROOM = Object.fromEntries(ROOMS.map(r => [r.key, r]));

// the meeting room sits in the middle of the map, the hallway runs around it as a ring
ROOM.meet = { key: 'meet', label: 'MEETING', color: '#6ee7ff', tx: MEET_TX, ty: MEET_Y, w: MEET_W, h: MEET_H };
