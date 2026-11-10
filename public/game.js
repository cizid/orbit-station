'use strict';

// Orbit Station: a living pixel-art room. One robot per Claude Code session.
(() => {
  const W = 384, H = 216;
  const FLOOR_Y = 60;   // wall/floor seam
  const AISLE = 112;    // main walkway; every route goes through it
  const SPEED = 70;     // logical px per second
  const IDLE_MS = 45000;
  const DOOR_X = 26;

  const canvas = document.getElementById('game');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;

  // ---------------------------------------------------------------- palette
  const P = {
    hull: '#0b0f17', wall: '#1a2433', wallSeam: '#141c29', pipe: '#2b3a4f', pipeHi: '#43557265',
    metal: '#9aa7b5', metalD: '#5b6878', steel: '#3a4a63', steelHi: '#5b6e8c',
    holo: '#6ec1ff', warn: '#ff8a3d', ok: '#5de6a0', bad: '#ff4d4d', eye: '#7df3ff',
  };
  // Session colors: cool/warm mix, deliberately no pink.
  const AGENT_COLORS = ['#ff8a3d', '#4aa8ff', '#8bd450', '#ffc233', '#3dd9b0', '#8a7bff', '#e6edf3', '#e0553f'];

  // ----------------------------------------------------------- helpers
  let g = ctx;
  const R = (x, y, w, h, c) => { g.fillStyle = c; g.fillRect(Math.round(x), Math.round(y), w, h); };
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const mk = () => { const c = document.createElement('canvas'); c.width = W; c.height = H; return c; };

  function rng(seed) {
    return () => {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function hash(str) {
    let h = 2166136261;
    for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function shade(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    const ch = [n >> 16, (n >> 8) & 255, n & 255].map(v => clamp(Math.round(f > 0 ? v + (255 - v) * f : v * (1 + f)), 0, 255));
    return `rgb(${ch[0]},${ch[1]},${ch[2]})`;
  }
  function disc(cx, cy, r, color) {
    g.fillStyle = color;
    for (let dy = -r; dy <= r; dy++) {
      const w = Math.floor(Math.sqrt(r * r - dy * dy));
      g.fillRect(Math.round(cx - w), Math.round(cy + dy), w * 2 + 1, 1);
    }
  }

  // ------------------------------------------------------ 3x5 pixel font
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
  const textW = s => s.length * 4 - 1;
  function text(s, x, y, color) {
    g.fillStyle = color;
    for (const ch of s) {
      const gl = FONT[ch] || FONT['-'];
      for (let r = 0; r < 5; r++) for (let c = 0; c < 3; c++) {
        if ((gl[r] >> (2 - c)) & 1) g.fillRect(Math.round(x + c), Math.round(y + r), 1, 1);
      }
      x += 4;
    }
  }

  // ---------------------------------------------------------- stations
  // slots are where a robot's feet land. "top" stations face the wall, "bot" ones sit behind furniture.
  const STATIONS = {
    door:    { row: 'top', slots: [[DOOR_X, 74], [46, 80]] },
    library: { row: 'top', slots: [[66, 88], [92, 88], [118, 88]] },
    comms:   { row: 'top', slots: [[272, 88], [300, 88], [328, 88]] },
    desks:   { row: 'bot', slots: [[78, 146], [124, 146], [170, 146]] },
    bench:   { row: 'bot', slots: [[238, 146], [268, 146]] },
    lounge:  { row: 'bot', slots: [[304, 146], [332, 146], [360, 146]] },
  };
  const TOOL_STATION = {
    Edit: 'desks', Write: 'desks', MultiEdit: 'desks', NotebookEdit: 'desks',
    Read: 'library', Grep: 'library', Glob: 'library', LS: 'library',
    Bash: 'bench', WebSearch: 'comms', WebFetch: 'comms',
  };

  function slotPos(name, i) {
    const s = STATIONS[name].slots;
    const [x, y] = s[i % s.length];
    return [x + 9 * Math.floor(i / s.length), y];
  }

  // ------------------------------------------------------- static layers
  const back = mk();   // room, drawn under robots
  const front = mk();  // furniture that hides robot legs
  const stars = Array.from({ length: 70 }, (_, i) => {
    const r = rng(i * 97 + 5);
    return { x: r() * 70, y: r() * 34, v: 0.8 + r() * 2.2, s: r() < 0.15 ? 2 : 1, ph: r() * 6 };
  });

  function buildStatic() {
    g = back.getContext('2d');
    // wall
    R(0, 0, W, FLOOR_Y, P.wall);
    for (let x = 0; x < W; x += 32) { R(x, 0, 1, FLOOR_Y, P.wallSeam); R(x + 1, 0, 1, FLOOR_Y, '#202c3f'); }
    R(0, 6, W, 4, P.pipe); R(0, 6, W, 1, '#435572'); R(0, 9, W, 1, '#18212f');
    for (let x = 14; x < W; x += 48) R(x, 5, 3, 6, '#4a5b76');
    R(0, FLOOR_Y - 4, W, 4, P.hull); R(0, FLOOR_Y - 4, W, 1, '#2f3f58');
    // floor
    for (let y = FLOOR_Y; y < 204; y += 16) for (let x = 0; x < W; x += 16) {
      R(x, y, 16, 16, ((x + y) / 16) % 2 ? '#18212f' : '#1b2535');
      R(x, y, 16, 1, '#121a26'); R(x, y, 1, 16, '#121a26');
      R(x + 2, y + 2, 1, 1, '#2b3a4f'); R(x + 13, y + 13, 1, 1, '#2b3a4f');
    }
    // aisle markings
    for (let x = 52; x < W - 20; x += 16) { R(x, AISLE - 14, 8, 1, '#9a5420'); R(x, AISLE + 12, 8, 1, '#9a5420'); }
    R(0, FLOOR_Y, W, 3, 'rgba(0,0,0,.35)');

    // window (glass is a transparent hole, drawn live underneath)
    R(152, 8, 78, 42, P.steel); R(152, 8, 78, 1, P.steelHi); R(154, 10, 74, 38, P.hull);
    g.clearRect(156, 12, 70, 34);
    R(190, 12, 2, 34, P.steel); R(156, 28, 70, 2, P.steel);
    R(150, 50, 82, 3, P.hull);

    // entrance door frame
    R(6, 12, 40, 50, '#2b3a4f'); R(6, 12, 40, 1, P.steelHi);
    for (let i = 0; i < 10; i++) R(6 + i * 4, 14, 4, 3, i % 2 ? P.hull : P.warn);
    R(10, 20, 32, 40, '#04060a');
    R(8, 58, 36, 3, P.metalD); R(8, 58, 36, 1, P.metal);

    // library: data-case shelving
    R(56, 20, 84, 54, P.steel); R(56, 20, 84, 1, P.steelHi); R(58, 22, 80, 50, '#10151f');
    const r = rng(11), cols = ['#2f8f8a', '#c98a2b', '#6b7f99', '#a2503a', '#7c8f3f', '#4a6fa8'];
    for (let row = 0; row < 4; row++) {
      const by = 22 + row * 12;
      let x = 60;
      while (x < 134) {
        const w = 2 + Math.floor(r() * 3), h = 7 + Math.floor(r() * 4);
        R(x, by + 11 - h, w, h, cols[Math.floor(r() * cols.length)]);
        R(x, by + 11 - h, w, 1, 'rgba(255,255,255,.18)');
        x += w + (r() < 0.2 ? 2 : 0);
      }
      R(58, by + 11, 80, 1, P.steel);
    }
    R(56, 72, 84, 4, P.hull);

    // comms console + mast
    R(252, 38, 88, 28, P.steel); R(252, 38, 88, 1, P.steelHi); R(254, 41, 84, 22, '#10151f');
    R(257, 44, 22, 14, '#0c2230'); R(258, 45, 20, 1, P.holo);
    R(283, 44, 22, 14, '#0c2230'); R(309, 44, 26, 14, '#0c2230');
    R(256, 62, 80, 2, P.hull);
    R(294, 24, 4, 16, P.metalD); R(292, 38, 8, 3, P.metal);

    // wall extras
    for (let i = 0; i < 5; i++) R(352, 18 + i * 3, 22, 1, '#0a0e15');
    R(350, 16, 26, 16, 'rgba(0,0,0,0)'); R(350, 15, 26, 1, P.steel); R(350, 31, 26, 1, P.steel);
    R(354, 38, 8, 20, '#b03a2e'); R(354, 38, 8, 2, '#d85a4a'); R(356, 34, 4, 4, P.metalD);
    for (const x of [148, 238, 346]) { R(x - 2, 33, 5, 5, P.metalD); R(x - 1, 35, 3, 2, '#ffd9a0'); }

    // server racks behind the bench
    for (const x0 of [220, 254]) {
      R(x0, 112, 30, 30, P.steel); R(x0, 112, 30, 1, P.steelHi); R(x0 + 2, 114, 26, 26, '#10151f');
      for (let i = 0; i < 5; i++) R(x0 + 3, 116 + i * 5, 24, 3, '#1a2433');
    }
    // couch back + coffee tower
    R(294, 124, 48, 18, '#26364e'); R(294, 124, 48, 2, '#3a4f6e'); R(298, 128, 40, 10, '#2c3e5a');
    R(346, 112, 26, 30, P.steel); R(346, 112, 26, 1, P.steelHi); R(348, 114, 22, 26, '#10151f');
    R(351, 118, 16, 8, '#0c2230'); R(356, 130, 6, 6, P.metalD);
    // desk chairs
    for (const [x] of STATIONS.desks.slots) { R(x - 7, 128, 14, 16, '#222d40'); R(x - 7, 128, 14, 2, '#344863'); }

    // hull trim
    R(0, 204, W, 12, P.hull); R(0, 204, W, 1, '#2b3a4f');
    for (let x = 8; x < W; x += 24) R(x, 209, 2, 2, '#2b3a4f');
    R(0, 0, 3, H, P.hull); R(W - 3, 0, 3, H, P.hull);

    // ----- front layer
    g = front.getContext('2d');
    for (const [x] of STATIONS.desks.slots) {
      R(x - 20, 140, 40, 6, '#3a4f6e'); R(x - 20, 140, 40, 1, '#5b7396');
      R(x - 20, 146, 40, 14, '#222f45'); R(x - 20, 146, 40, 1, '#14202f');
      R(x - 8, 150, 16, 1, '#344863'); R(x - 8, 154, 16, 1, '#344863');
      R(x - 20, 160, 40, 2, 'rgba(0,0,0,.4)');
    }
    // workbench
    R(220, 140, 68, 6, '#4a3a2a'); R(220, 140, 68, 1, '#6b5640');
    R(220, 146, 68, 14, '#222f45'); R(220, 152, 68, 2, P.warn); R(220, 160, 68, 2, 'rgba(0,0,0,.4)');
    R(226, 137, 6, 3, P.metal); R(254, 138, 10, 2, P.metalD); R(278, 136, 4, 4, '#8a3a2a');
    // couch seat + arms
    R(294, 140, 48, 12, '#2f4363'); R(294, 140, 48, 1, '#4a6590');
    R(292, 134, 5, 20, '#26364e'); R(339, 134, 5, 20, '#26364e');
    R(294, 152, 48, 2, 'rgba(0,0,0,.4)');
    // coffee counter
    R(346, 140, 28, 6, '#3a4f6e'); R(346, 140, 28, 1, '#5b7396'); R(346, 146, 28, 14, '#222f45');
    R(352, 135, 5, 5, '#e6edf3'); R(352, 135, 5, 1, '#fff'); R(346, 160, 28, 2, 'rgba(0,0,0,.4)');
    // cargo crates
    for (const [x, y, w, h] of [[8, 150, 22, 20], [26, 160, 20, 14], [12, 136, 16, 14]]) {
      R(x, y, w, h, '#5a4630'); R(x, y, w, 2, '#7a6244'); R(x, y + h - 2, w, 2, '#3b2d1e');
      R(x + 2, y + 2, 2, h - 4, '#3b2d1e'); R(x + w - 4, y + 2, 2, h - 4, '#3b2d1e');
    }
    g = ctx;
  }

  // ------------------------------------------------------------- agents
  const agents = new Map();
  let doorOpen = 0;
  let socket = null;

  // Shared with ui.js (modal, console dock, permission buttons).
  const Orbit = window.Orbit = {
    W, H, canvas, agents,
    managed: new Set(),   // session_ids whose pty we own, i.e. the ones we can type into
    selectedId: null,
    reservedH: 0,         // vertical space taken by the dock
    send(msg) { if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg)); },
    select(id) { Orbit.selectedId = id; if (Orbit.onSelect) Orbit.onSelect(id); },
    // logical point just above an agent's bubble, where floating buttons hang
    anchor: a => [a.x, a.y - 57 - tagLift(a)],
  };

  const baseName = cwd => {
    const n = String(cwd || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();
    return n ? n.toUpperCase().replace(/[^A-Z0-9._ -]/g, '-').slice(0, 12) : '';
  };

  function pickColor(id) {
    const used = new Set([...agents.values()].map(a => a.color));
    const h = hash(id);
    for (let i = 0; i < AGENT_COLORS.length; i++) {
      const c = AGENT_COLORS[(h + i) % AGENT_COLORS.length];
      if (!used.has(c)) return c;
    }
    return AGENT_COLORS[h % AGENT_COLORS.length];
  }

  function makeAgent(ev) {
    const color = pickColor(ev.session_id);
    const a = {
      id: ev.session_id, color, light: shade(color, 0.35), dark: shade(color, -0.4),
      name: baseName(ev.cwd) || ev.session_id.slice(0, 6).toUpperCase(),
      x: DOOR_X, y: 62, path: [], station: 'door', slotIdx: 0, face: 'down', phase: 0,
      bubble: null, last: performance.now(), linger: 0, leaving: false, seed: Math.random() * 10,
    };
    agents.set(a.id, a);
    return a;
  }

  function placeAt(a, name) {
    a.station = name;
    a.slotIdx = freeSlot(a, name);
    [a.x, a.y] = slotPos(name, a.slotIdx);
    a.path = [];
    arrive(a);
  }

  function freeSlot(a, name) {
    const used = new Set();
    for (const o of agents.values()) if (o !== a && o.station === name) used.add(o.slotIdx);
    let i = 0;
    while (used.has(i)) i++;
    return i;
  }

  function goTo(a, name) {
    if (a.station === name && !a.path.length && a.arrived) return;
    a.station = name;
    a.slotIdx = freeSlot(a, name);
    const [tx, ty] = slotPos(name, a.slotIdx);
    const pts = [[a.x, AISLE], [tx, AISLE], [tx, ty]];
    a.path = [];
    let px = a.x, py = a.y;
    for (const p of pts) {
      if (Math.abs(p[0] - px) > 0.5 || Math.abs(p[1] - py) > 0.5) a.path.push(p);
      px = p[0]; py = p[1];
    }
    a.arrived = false;
    if (!a.path.length) arrive(a);
  }

  function arrive(a) {
    a.arrived = true;
    a.face = a.station === 'door' ? 'down' : STATIONS[a.station].row === 'top' ? 'up' : 'down';
  }

  function leave(a) {
    if (a.leaving) return;
    goTo(a, 'door');
    a.path.push([DOOR_X, 58]);
    a.leaving = true;
    a.bubble = null;
    a.arrived = false;
  }

  function onEvent(ev) {
    if (!ev || !ev.session_id) return;
    let a = agents.get(ev.session_id);
    const name = ev.hook_event_name;
    if (name === 'SessionEnd') { if (a) leave(a); return; }
    if (!a) {
      a = makeAgent(ev);
      sfx.door();
      a.path = [[DOOR_X, 74]];
      a.arrived = false;
    } else if (ev.cwd) {
      a.name = baseName(ev.cwd) || a.name;
    }
    if (a.leaving) return;
    a.last = performance.now();
    switch (name) {
      case 'SessionStart':
        a.bubble = null;
        a.linger = a.last + 3500;
        goTo(a, 'door');
        break;
      case 'PreToolUse':
        a.bubble = null;
        goTo(a, TOOL_STATION[ev.tool_name] || 'desks');
        break;
      case 'UserPromptSubmit':
        a.bubble = null;
        goTo(a, 'desks');
        break;
      case 'Notification':
        a.bubble = 'alert';
        sfx.ping();
        break;
      case 'Stop':
        a.bubble = 'done';
        goTo(a, 'lounge');
        break;
    }
  }

  function syncSnapshot(list) {
    const ids = new Set(list.map(s => s.session_id));
    for (const s of list) {
      if (agents.has(s.session_id)) continue;
      const a = makeAgent(s);
      placeAt(a, 'lounge');
      a.bubble = 'done';
    }
    for (const a of agents.values()) if (!ids.has(a.id)) leave(a);
  }

  function update(dt, now) {
    for (const a of [...agents.values()]) {
      if (a.path.length) {
        const [px, py] = a.path[0];
        const dx = px - a.x, dy = py - a.y, d = Math.hypot(dx, dy), s = SPEED * dt;
        if (d <= s) {
          a.x = px; a.y = py; a.path.shift();
          if (!a.path.length) {
            if (a.leaving) { agents.delete(a.id); continue; }
            arrive(a);
          }
        } else {
          a.x += dx / d * s; a.y += dy / d * s;
          a.face = Math.abs(dx) > Math.abs(dy) ? (dx < 0 ? 'left' : 'right') : (dy < 0 ? 'up' : 'down');
          const before = Math.floor(a.phase);
          a.phase += dt * 8;
          if (Math.floor(a.phase) !== before && Math.random() < 0.6) sfx.step();
        }
      } else if (!a.leaving) {
        if (a.station === 'door' && a.linger && now > a.linger) {
          a.linger = 0; a.bubble = 'done'; goTo(a, 'lounge');
        } else if (a.station !== 'lounge' && now - a.last > IDLE_MS) {
          a.bubble = 'done'; goTo(a, 'lounge');
        }
      }
    }
    // door opens whenever someone is close to it
    let near = false;
    for (const a of agents.values()) if (Math.hypot(a.x - DOOR_X, a.y - 66) < 22) near = true;
    doorOpen = clamp(doorOpen + (near ? 1 : -1) * dt * 5, 0, 1);
  }

  // ------------------------------------------------------------ drawing
  function drawRobot(a, t) {
    const x = Math.round(a.x), y = Math.round(a.y);
    const walking = a.path.length > 0;
    const step = Math.floor(a.phase) % 2;
    const bob = walking && step ? 1 : 0;
    const working = !walking && a.arrived && (a.station === 'desks' || a.station === 'bench');
    const fade = a.leaving && y < 66 ? clamp((y - 58) / 8, 0, 1) : 1;
    g.globalAlpha = fade;

    R(x - 5, y - 1, 10, 2, 'rgba(0,0,0,.35)');
    // legs
    const lift = walking ? (step ? [1, 0] : [0, 1]) : [0, 0];
    R(x - 3, y - 3 - lift[0], 2, 3, P.metalD); R(x + 1, y - 3 - lift[1], 2, 3, P.metalD);
    // arms
    const arm = working ? (Math.floor(t * 8 + a.seed) % 2) : 0;
    const swing = walking ? (step ? 1 : -1) : 0;
    R(x - 6, y - 9 - bob + swing, 2, 4 - arm, P.metal); R(x + 4, y - 9 - bob - swing, 2, 4 - (1 - arm) * (working ? 1 : 0), P.metal);
    // body
    R(x - 4, y - 9 - bob, 8, 6, a.color);
    R(x - 4, y - 9 - bob, 8, 1, a.light); R(x - 4, y - 4 - bob, 8, 1, a.dark);
    R(x - 1, y - 7 - bob, 2, 2, P.hull); R(x, y - 7 - bob, 1, 1, Math.floor(t * 2 + a.seed) % 2 ? P.holo : '#2a6a96');
    // head
    const hy = y - 16 - bob;
    R(x - 5, hy, 10, 7, P.metal); R(x - 5, hy, 10, 1, '#c4cfda'); R(x - 5, hy + 6, 10, 1, P.metalD);
    if (a.face === 'up') {
      R(x - 4, hy + 2, 8, 4, a.dark);
      R(x - 3, hy + 3, 6, 1, a.color); R(x - 3, hy + 5, 6, 1, 'rgba(0,0,0,.3)');
    } else {
      R(x - 4, hy + 2, 8, 4, P.hull);
      const blink = (Math.floor(t * 1000 / 140 + a.seed * 37) % 28) === 0;
      const eh = blink ? 1 : 2, ey = hy + 3 + (blink ? 1 : 0);
      const ex = a.face === 'left' ? [-4, -1] : a.face === 'right' ? [-1, 2] : [-3, 1];
      R(x + ex[0], ey, 2, eh, P.eye); R(x + ex[1], ey, 2, eh, P.eye);
    }
    // antenna
    R(x, hy - 3, 1, 3, P.metalD);
    R(x - 1, hy - 5, 3, 2, Math.floor(t * 1.6 + a.seed) % 2 ? a.light : a.color);
    g.globalAlpha = 1;
  }

  function drawBubble(cx, by, kind) {
    const c = kind === 'alert' ? '#ff3b3b' : '#35d07f';
    const hi = kind === 'alert' ? '#ff8a80' : '#8ef0b8';
    R(cx - 7, by + 1, 15, 11, P.hull); R(cx - 6, by, 13, 13, P.hull);
    R(cx - 1, by + 13, 3, 1, P.hull); R(cx, by + 14, 1, 1, P.hull);
    R(cx - 6, by + 1, 13, 11, c); R(cx - 5, by + 1, 11, 1, hi); R(cx - 1, by + 12, 3, 1, c);
    if (kind === 'alert') {
      R(cx - 1, by + 3, 3, 5, '#fff'); R(cx - 1, by + 9, 3, 2, '#fff');
    } else {
      for (const [dx, dy] of [[-3, 6], [-2, 7], [-1, 8], [0, 7], [1, 6], [2, 5], [3, 4]]) R(cx + dx, by + dy - 1, 1, 2, '#fff');
    }
  }

  // neighbours at a station would overlap, so odd slots float a bit higher
  const tagLift = a => (a.arrived && a.slotIdx % 2 ? 11 : 0);

  function drawTag(a) {
    const w = textW(a.name) + 5, x = clamp(Math.round(a.x - w / 2), 4, W - w - 4), y = Math.round(a.y - 36 - tagLift(a));
    if (a.id === Orbit.selectedId) R(x - 1, y - 1, w + 2, 11, '#fff');
    R(x, y, w, 9, 'rgba(8,12,20,.85)');
    R(x, y + 8, w, 1, a.color);
    text(a.name, x + 3, y + 2, '#dfe8f2');
  }

  const sweat = (t, i, rate) => (Math.imul(Math.floor(t * rate) + i * 7919, 2654435761) >>> 0);

  function drawWindow(t, d) {
    R(156, 12, 70, 34, '#04060c');
    const sun = 1 - d / 0.45;
    for (const s of stars) {
      const x = 156 + ((s.x - t * s.v * 0.6) % 70 + 70) % 70;
      const tw = 0.55 + 0.45 * Math.sin(t * 2 + s.ph);
      g.globalAlpha = tw;
      R(x, 12 + s.y, s.s, s.s, s.s > 1 ? '#fff' : '#b9d4ff');
    }
    g.globalAlpha = 1;
    // planet drifting across the pane
    const px = 156 + 70 - ((t * 1.4) % 110) + 20;
    g.save(); g.beginPath(); g.rect(156, 12, 70, 34); g.clip();
    disc(px, 40, 16, '#2c5f93'); disc(px - 3, 38, 13, '#3b78b5'); disc(px - 5, 36, 6, '#6aa5d8');
    g.globalAlpha = 0.5; disc(px + 6, 44, 14, '#04060c'); g.globalAlpha = 1;
    g.restore();
    g.globalAlpha = 0.14 * sun; R(156, 12, 70, 34, '#ffd9a0'); g.globalAlpha = 1;
    R(190, 12, 2, 34, P.steel); R(156, 28, 70, 2, P.steel);
  }

  function drawStation(t, occ) {
    // landing pads for top-row slots
    for (const name of ['door', 'library', 'comms']) {
      STATIONS[name].slots.forEach(([x, y], i) => {
        const on = occ[name] && occ[name].has(i);
        g.globalAlpha = on ? 0.55 : 0.16;
        R(x - 7, y - 1, 14, 3, P.holo); R(x - 5, y - 2, 10, 1, P.holo); R(x - 5, y + 2, 10, 1, P.holo);
        g.globalAlpha = 1;
      });
    }
    // door panels + lamp
    const o = Math.round(doorOpen * 14);
    R(10, 20, 16 - o, 40, '#4b5d78'); R(10 + 16 - o - 1, 20, 1, 40, P.hull); R(10, 20, 16 - o, 1, '#6a7f9f');
    R(26 + o, 20, 16 - o, 40, '#4b5d78'); R(26 + o, 20, 1, 40, P.hull); R(26 + o, 20, 16 - o, 1, '#6a7f9f');
    R(13, 38, 8 - Math.min(o, 8), 2, '#6ec1ff55');
    R(24, 9, 5, 2, doorOpen > 0.1 ? P.ok : P.bad);
    // library scan line when occupied
    if (occ.library && occ.library.size) {
      const row = Math.floor(t * 3) % 4;
      g.globalAlpha = 0.22; R(58, 22 + row * 12, 80, 11, P.holo); g.globalAlpha = 1;
    }
    // comms dish
    const act = occ.comms && occ.comms.size > 0;
    const ang = t * (act ? 1.4 : 0.45);
    const cx = 296, cy = 36;
    for (let i = -7; i <= 7; i++) {
      const px = cx + Math.cos(ang) * i, py = cy - Math.abs(Math.sin(ang * 0.7)) * 3 + Math.sin(ang) * i * 0.35 - Math.abs(i) * 0.25;
      R(px, py, 2, 2, i === 0 ? P.metalD : P.metal);
    }
    R(cx - 1, cy - 8 - Math.abs(Math.sin(ang * 0.7)) * 3, 2, 2, Math.floor(t * 3) % 2 ? P.bad : '#7a2a2a');
    if (act) for (let k = 0; k < 3; k++) {
      g.globalAlpha = 0.6 - ((t * 1.2 + k / 3) % 1) * 0.6;
      const rr = 4 + ((t * 1.2 + k / 3) % 1) * 14;
      for (let q = -2; q <= 2; q++) R(cx + q * rr * 0.4, cy - 12 - rr + Math.abs(q) * 1.5, 1, 1, P.holo);
    }
    g.globalAlpha = 1;
    // console screens
    for (let i = 0; i < 3; i++) {
      const x = [258, 284, 310][i], w = i === 2 ? 24 : 20;
      for (let l = 0; l < 4; l++) {
        const len = 3 + (sweat(t, i * 4 + l, act ? 5 : 1) % (w - 6));
        R(x, 46 + l * 3, len, 1, i === 1 ? P.warn : P.holo);
      }
    }
    // rack LEDs
    const busy = occ.bench && occ.bench.size > 0;
    for (const [rx, x0] of [[0, 220], [1, 254]]) for (let r = 0; r < 5; r++) for (let c = 0; c < 4; c++) {
      const v = sweat(t, rx * 40 + r * 5 + c, busy ? 7 : 1.5) % 5;
      R(x0 + 5 + c * 5, 117 + r * 5, 2, 1, v === 0 ? P.bad : v < 3 ? P.ok : '#1f3a30');
    }
    // coffee machine light + steam
    R(352, 128, 2, 2, Math.floor(t) % 2 ? P.ok : '#1f3a30');
    for (let k = 0; k < 3; k++) {
      const u = (t * 0.7 + k / 3) % 1;
      g.globalAlpha = 0.5 * (1 - u);
      R(354 + Math.sin(u * 8 + k) * 2, 133 - u * 14, 2, 2, '#dfe8f2');
    }
    g.globalAlpha = 1;
  }

  // pulsing pixel ring around the selected robot's feet; drawn over furniture so desks don't hide it
  function drawSelection(a, t) {
    const x = Math.round(a.x), y = Math.round(a.y);
    g.globalAlpha = 0.65 + 0.35 * Math.sin(t * 6);
    const c = '#ffffff';
    R(x - 4, y - 4, 9, 1, c); R(x - 8, y - 3, 4, 1, c); R(x + 5, y - 3, 4, 1, c);
    R(x - 9, y - 2, 2, 2, c); R(x + 8, y - 2, 2, 2, c);
    R(x - 8, y, 4, 1, c); R(x + 5, y, 4, 1, c); R(x - 4, y + 1, 9, 1, c);
    g.globalAlpha = 1;
  }

  function drawFrontFx(t, occ) {
    const slotsOf = n => STATIONS[n].slots;
    // glowing desk edges + floating holo panels
    for (const name of ['desks', 'bench']) {
      occ[name] && occ[name].forEach(i => {
        const [x] = slotsOf(name)[i % slotsOf(name).length];
        g.globalAlpha = 0.8; R(x - 14, 140, 28, 1, P.holo); g.globalAlpha = 1;
        const px = x + 10, py = 118;
        g.globalAlpha = 0.8; R(px, py, 17, 12, '#0c2230'); g.globalAlpha = 1;
        R(px, py, 17, 1, P.holo); R(px, py + 11, 17, 1, P.holo);
        for (let l = 0; l < 4; l++) {
          const len = 3 + (sweat(t, i * 9 + l, name === 'desks' ? 4 : 8) % 11);
          R(px + 2, py + 2 + l * 2, len, 1, name === 'desks' ? P.holo : P.warn);
        }
        if (name === 'bench' && Math.floor(t * 12) % 3 === 0) R(x + 14 + (sweat(t, i, 12) % 4), 134, 1, 1, '#ffd23f');
      });
    }
    // floating book at the library
    occ.library && occ.library.forEach(i => {
      const [x, y] = STATIONS.library.slots[i % 3];
      const bx = x + 10, by = y - 24 + Math.round(Math.sin(t * 3 + i) * 1.5);
      R(bx, by, 9, 7, '#c98a2b'); R(bx, by, 9, 1, '#e8b25a'); R(bx + 1, by + 2, 7, 1, '#fff7e0'); R(bx + 1, by + 4, 5, 1, '#fff7e0');
    });
    // comms holo globe
    occ.comms && occ.comms.forEach(i => {
      const [x, y] = STATIONS.comms.slots[i % 3];
      const gx = x + 11, gy = y - 22;
      g.globalAlpha = 0.85; disc(gx, gy, 5, '#0c2230'); g.globalAlpha = 1;
      R(gx - 5, gy, 11, 1, P.holo); R(gx - 4 + (Math.floor(t * 6) % 8), gy - 4, 1, 9, P.holo);
    });
    // coffee cups for lounge sitters
    occ.lounge && occ.lounge.forEach(i => {
      const [x, y] = STATIONS.lounge.slots[i % 3];
      R(x + 5, y - 7, 3, 3, '#e6edf3'); R(x + 8, y - 6, 1, 1, '#e6edf3');
      g.globalAlpha = 0.5; R(x + 6 + Math.round(Math.sin(t * 4 + i)), y - 9 - (t * 3 % 3), 1, 1, '#fff'); g.globalAlpha = 1;
    });
  }

  function drawLighting(t, d) {
    const sun = 1 - d / 0.45;
    // sun shaft from the window during the day
    if (sun > 0.05) {
      g.globalAlpha = 0.09 * sun;
      for (let y = 52; y < 138; y += 2) R(158 + (y - 52) * 0.85, y, 46, 2, '#ffe2a8');
      g.globalAlpha = 1;
    }
    // night tint
    g.globalAlpha = d; R(0, 0, W, H, '#050c24'); g.globalAlpha = 1;
    // lamps glow as it gets dark
    const k = clamp((d - 0.04) / 0.4, 0, 1);
    if (k > 0) {
      const prev = g.globalCompositeOperation;
      g.globalCompositeOperation = 'lighter';
      for (const [x, y] of [[148, 36], [238, 36], [346, 36], [DOOR_X, 66]]) {
        for (let r = 26; r >= 4; r -= 3) {
          g.globalAlpha = 0.022 * k;
          disc(x, y + 8, r, r > 14 ? '#ff9a4a' : '#ffc888');
        }
      }
      g.globalAlpha = 1; g.globalCompositeOperation = prev;
    }
  }

  function frame(now) {
    const t = now / 1000;
    const dt = Math.min(0.05, (now - (frame.prev || now)) / 1000);
    frame.prev = now;
    update(dt, now);

    const d = 0.225 - 0.225 * Math.cos(t / 150 * Math.PI * 2 + 2);
    // who is standing where (only arrived robots light up a station)
    const occ = {};
    for (const a of agents.values()) {
      if (!a.arrived || a.path.length) continue;
      (occ[a.station] ||= new Set()).add(a.slotIdx);
    }

    g = ctx;
    drawWindow(t, d);
    g.drawImage(back, 0, 0);
    drawStation(t, occ);
    const list = [...agents.values()].sort((p, q) => p.y - q.y);
    for (const a of list) drawRobot(a, t);
    g.drawImage(front, 0, 0);
    drawFrontFx(t, occ);
    const picked = agents.get(Orbit.selectedId);
    if (picked) drawSelection(picked, t);
    drawLighting(t, d);
    for (const a of list) {
      drawTag(a);
      const idle = a.bubble === 'done' && (a.path.length || !a.arrived);
      if (a.bubble && !idle) {
        const bounce = a.bubble === 'alert' ? Math.abs(Math.sin(t * 7)) * 3 : Math.sin(t * 2.5) * 1;
        drawBubble(Math.round(a.x), Math.max(2, Math.round(a.y - 52 - tagLift(a) - bounce)), a.bubble);
      }
    }
    requestAnimationFrame(frame);
  }

  // -------------------------------------------------------------- sound
  const sfx = (() => {
    let ac = null, on = false;
    const tone = (f, dur, type = 'square', vol = 0.03, slide = 0) => {
      if (!on || !ac) return;
      const o = ac.createOscillator(), v = ac.createGain();
      o.type = type; o.frequency.value = f;
      if (slide) o.frequency.linearRampToValueAtTime(f + slide, ac.currentTime + dur);
      v.gain.setValueAtTime(vol, ac.currentTime);
      v.gain.exponentialRampToValueAtTime(0.0001, ac.currentTime + dur);
      o.connect(v).connect(ac.destination);
      o.start(); o.stop(ac.currentTime + dur);
    };
    return {
      toggle() {
        on = !on;
        if (on && !ac) ac = new (window.AudioContext || window.webkitAudioContext)();
        if (on && ac.state === 'suspended') ac.resume();
        if (on) tone(660, 0.08, 'triangle', 0.05);
        return on;
      },
      step() { tone(70 + Math.random() * 25, 0.04, 'square', 0.02); },
      ping() { tone(880, 0.12, 'triangle', 0.06); setTimeout(() => tone(1320, 0.18, 'triangle', 0.06), 110); },
      door() { tone(180, 0.28, 'sawtooth', 0.02, 260); },
    };
  })();

  // ------------------------------------------------------------ network
  const host = location.protocol.startsWith('http') ? location.host : 'localhost:4111';
  const link = document.getElementById('link');

  function connect() {
    const ws = socket = new WebSocket(`ws://${host}/ws`);
    ws.onopen = () => link.classList.add('on');
    ws.onmessage = m => {
      const msg = JSON.parse(m.data);
      if (msg.type === 'snapshot') syncSnapshot(msg.sessions);
      else if (msg.type === 'event') onEvent(msg.event);
      if (Orbit.onMessage) Orbit.onMessage(msg);
    };
    ws.onclose = () => { link.classList.remove('on'); setTimeout(connect, 2000); };
    ws.onerror = () => ws.close();
  }

  // ----------------------------------------------------------------- UI
  document.getElementById('demo').addEventListener('click', () => {
    fetch(`http://${host}/demo`, { method: 'POST' }).catch(() => {});
  });
  const soundBtn = document.getElementById('sound');
  soundBtn.addEventListener('click', () => soundBtn.setAttribute('aria-pressed', String(sfx.toggle())));

  function fit() {
    const s = Math.max(1, Math.floor(Math.min((innerWidth - 40) / W, (innerHeight - 84 - Orbit.reservedH) / H)));
    canvas.style.width = W * s + 'px';
    canvas.style.height = H * s + 'px';
  }
  Orbit.fit = fit;
  addEventListener('resize', fit);

  // click a robot to select it, click empty floor to deselect
  function hit(ev) {
    const r = canvas.getBoundingClientRect();
    const lx = (ev.clientX - r.left) / r.width * W, ly = (ev.clientY - r.top) / r.height * H;
    return [...agents.values()]
      .filter(a => !a.leaving && Math.abs(lx - a.x) <= 9 && ly >= a.y - 24 && ly <= a.y + 3)
      .sort((p, q) => q.y - p.y)[0];
  }
  canvas.addEventListener('click', ev => { const a = hit(ev); Orbit.select(a ? a.id : null); });
  canvas.addEventListener('mousemove', ev => { canvas.style.cursor = hit(ev) ? 'pointer' : 'default'; });

  buildStatic();
  fit();
  connect();
  requestAnimationFrame(frame);
})();
