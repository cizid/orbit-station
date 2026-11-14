import { MEET_W } from './consts.js';

// Where agents stand and what they can not walk through, per room (tiles, relative to the room floor).
//   slots:  where agents stand and the way they face
//   blocks: tiles nobody can walk through (furniture); the 3D scene builds its props from these
const slot = (x, y, face = 'up') => ({ x, y, face });
const DX = (MEET_W - 30) / 2;     // the furniture is laid out for 30 tiles and centred in the room
const MEET_SEATS = [[11, 2, 'down'], [11, 6, 'up'], [13, 2, 'down'], [13, 6, 'up'], [16, 2, 'down'], [16, 6, 'up'], [18, 2, 'down'], [18, 6, 'up'], [9, 4, 'right'], [20, 4, 'left']].map(([x, y, f]) => [x + DX, y, f]);

export const STATION_DEFS = {
  door:    { slots: [slot(7, 2), slot(10, 2), slot(6, 4), slot(8, 4), slot(10, 4), slot(12, 4), slot(9, 6)],
             blocks: [[1, 3, 5, 2], [13, 2, 4, 2], [13, 6, 4, 1], [0, 8, 1, 1], [16, 8, 1, 1]], spawn: { x: 9, y: 0.5 } },
  library: { slots: [slot(2, 2), slot(5, 2), slot(8, 2), slot(11, 2), slot(14, 2), slot(6, 6, 'right'), slot(11, 6, 'left')],
             blocks: [[1, 0, 16, 2], [7, 5, 4, 2], [0, 8, 1, 1], [16, 8, 1, 1]] },
  comms:   { slots: [slot(2, 5), slot(4, 5), slot(13, 5), slot(15, 5), slot(9, 5), slot(5, 2, 'right'), slot(12, 2, 'left')],
             blocks: [[6, 1, 6, 3], [1, 3, 4, 2], [13, 3, 4, 2], [0, 1, 1, 2], [17, 1, 1, 2]] },
  desks:   { slots: [slot(2, 3), slot(5, 3), slot(12, 3), slot(15, 3), slot(2, 7), slot(5, 7), slot(12, 7)],
             blocks: [[1, 1, 6, 2], [11, 1, 6, 2], [1, 5, 6, 2], [11, 5, 6, 2], [0, 2, 1, 1], [17, 2, 1, 1], [0, 8, 1, 1], [17, 8, 1, 1]] },
  bench:   { slots: [slot(2, 2), slot(4, 2), slot(13, 2), slot(15, 2), slot(5, 8), slot(8, 8), slot(11, 8)],
             blocks: [[1, 0, 5, 2], [12, 0, 5, 2], [4, 6, 10, 2], [0, 9, 1, 1], [16, 8, 1, 1]] },
  meet:    { slots: MEET_SEATS.map(([x, y, f]) => slot(x, y, f)), blocks: [[10 + DX, 3, 10, 3]] },
  lounge:  { slots: [slot(2, 3), slot(4, 3), slot(6, 3), slot(12, 3), slot(14, 3), slot(16, 3), slot(9, 8)],
             blocks: [[1, 1, 6, 2], [11, 1, 6, 2], [7, 6, 4, 1], [0, 8, 1, 1], [17, 7, 1, 1]] },
};
