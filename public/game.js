import { T, ROOM_W, ROOM_H, FACE, PX_W, PX_H, ROOMS, ROOM } from './js/consts.js';
import { C, rect, makeCanvas, noise } from './js/art.js';
import { renderStatic, WINDOWS, DOORS, slotPos, SLOT_COUNT, roomRect, spawnPos } from './js/map.js';
import { STATION_DEFS } from './js/furniture.js';
import { createAgents } from './js/agents.js';
import { sfx } from './js/sfx.js';
import { connectLink } from './js/link.js';
import { API } from './js/routes.js';

// Orbit Station: a pixel-art space-station office. The world is drawn at 1x on a buffer and scaled up
// with nearest-neighbour. ui.js (modal, console dock, Allow/Deny) talks to this through window.Orbit.

const canvas = document.getElementById('world');
const labelsEl = document.getElementById('labels');
const ctx = canvas.getContext('2d');
const buf = makeCanvas(PX_W, PX_H), g = buf.getContext('2d');
const staticLayer = renderStatic();

// ------------------------------------------------------------ Orbit bridge
let socket = null;
const Orbit = window.Orbit = {
  canvas,
  agents: new Map(),
  managed: new Set(),     // session_ids whose pty we own, i.e. the ones we can type into
  selectedId: null,
  highlightStation: null, // room key whose agents are ringed
  send(msg) { if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg)); },
  select(id, { keepCamera = false } = {}) {
    Orbit.selectedId = id;
    if (id) highlight(null);
    else { focusedId = null; if (!keepCamera && !Orbit.highlightStation) home(); }
    if (Orbit.onSelect) Orbit.onSelect(id);
  },
  screenAnchor: a => a.screen || { x: 0, y: 0, visible: false },
  toScreen: (x, y) => toScreen(x, y),   // world pixels -> screen pixels
  home() { highlight(null); Orbit.select(null, { keepCamera: true }); home(); },
};

let gateFlash = 0;
const crowd = createAgents({
  labelsEl, Orbit,
  hooks: {
    onPortal: () => { gateFlash = 1.4; sfx.portal(); },
    onAlert: () => sfx.ping(),
    onStep: () => sfx.step(),
  },
});

// ------------------------------------------------------------------ camera
const cam = { x: PX_W / 2, y: PX_H / 2, zoom: 1 };
let levels = [1], tween = null, following = true, focusedId = null;
const dpr = () => Math.min(devicePixelRatio || 1, 2);

function computeLevels() {
  const fit = Math.max(0.5, Math.min(innerWidth / PX_W, innerHeight / PX_H) * 0.98);
  levels = [fit, ...[2, 3, 4, 6].filter(z => z > fit + 0.4)];
  return fit;
}
function clampCam(c) {
  const hw = innerWidth / c.zoom / 2, hh = innerHeight / c.zoom / 2;
  c.x = PX_W <= hw * 2 ? PX_W / 2 : Math.max(hw, Math.min(PX_W - hw, c.x));
  c.y = PX_H <= hh * 2 ? PX_H / 2 : Math.max(hh, Math.min(PX_H - hh, c.y));
}
const toScreen = (wx, wy) => ({ x: (wx - cam.x) * cam.zoom + innerWidth / 2, y: (wy - cam.y) * cam.zoom + innerHeight / 2 });
const toWorld = (sx, sy) => ({ x: (sx - innerWidth / 2) / cam.zoom + cam.x, y: (sy - innerHeight / 2) / cam.zoom + cam.y });

const ease = x => 1 - Math.pow(1 - x, 3);
function flyTo(x, y, zoom, dur = 0.7) {
  const to = { x, y, zoom };
  clampCam(to);
  tween = { t: 0, dur, from: { ...cam }, to };
}
function fitZoom() { return levels[0]; }
function zoomFor(w, h) {   // the biggest zoom level at which a w x h area still fits the window
  const need = Math.min(innerWidth / w, innerHeight / h);
  return [...levels].reverse().find(z => z <= need) ?? levels[0];
}
function home() { focusedId = null; following = false; flyTo(PX_W / 2, PX_H / 2, fitZoom()); }
function zoomStep(dir, sx, sy) {
  const i = levels.reduce((best, z, k) => Math.abs(z - cam.zoom) < Math.abs(levels[best] - cam.zoom) ? k : best, 0);
  const z = levels[Math.max(0, Math.min(levels.length - 1, i + dir))];
  if (z === cam.zoom) return;
  const w = toWorld(sx, sy);
  following = false;
  // keep the point under the cursor where it is
  flyTo(w.x - (sx - innerWidth / 2) / z, w.y - (sy - innerHeight / 2) / z, z, 0.25);
}

function highlight(key) {
  Orbit.highlightStation = key;
}

// ------------------------------------------------------------------ picking
function pickAt(sx, sy) {
  const w = toWorld(sx, sy);
  const hit = [...Orbit.agents.values()].filter(a => !a.leaving && !a.isSub && Math.abs(w.x - a.x) <= 9 && w.y >= a.y - 28 - a.air && w.y <= a.y + 3).sort((p, q) => q.y - p.y)[0];
  if (hit) return { agent: hit.id };
  for (const r of [...ROOMS, ROOM.meet]) {
    const rr = roomRect(r.key);
    if (w.x >= rr.x && w.x <= rr.x + rr.w && w.y >= rr.y - FACE * T && w.y <= rr.y + rr.h) return { room: r.key };
  }
  return null;
}

let drag = null;
canvas.addEventListener('pointerdown', ev => {
  drag = { x: ev.clientX, y: ev.clientY, cx: cam.x, cy: cam.y, moved: false };
  canvas.setPointerCapture(ev.pointerId);
});
canvas.addEventListener('pointermove', ev => {
  if (drag) {
    const dx = ev.clientX - drag.x, dy = ev.clientY - drag.y;
    if (!drag.moved && Math.hypot(dx, dy) > 5) { drag.moved = true; tween = null; following = false; canvas.style.cursor = 'grabbing'; }
    if (drag.moved) { cam.x = drag.cx - dx / cam.zoom; cam.y = drag.cy - dy / cam.zoom; clampCam(cam); }
    return;
  }
  canvas.style.cursor = pickAt(ev.clientX, ev.clientY) ? 'pointer' : 'grab';
});
canvas.addEventListener('pointerup', ev => {
  const d = drag; drag = null;
  canvas.style.cursor = 'grab';
  if (!d || d.moved) return;
  const p = pickAt(ev.clientX, ev.clientY);
  if (p && p.agent) Orbit.select(p.agent);
  else if (p && p.room) {
    const rr = roomRect(p.room);
    Orbit.select(null, { keepCamera: true });
    highlight(p.room);
    following = false;
    flyTo(rr.x + rr.w / 2, rr.y + rr.h / 2 - FACE * T / 2, zoomFor(rr.w + 40, rr.h + FACE * T + 140));
  } else {
    highlight(null);
    Orbit.select(null, { keepCamera: true });
    home();
  }
});
canvas.addEventListener('wheel', ev => { ev.preventDefault(); zoomStep(ev.deltaY < 0 ? 1 : -1, ev.clientX, ev.clientY); }, { passive: false });

// ------------------------------------------------------------------ network
const link = document.getElementById('link');
// the board links here with #agent=<session id>: select that agent as soon as it is on the map
let focusId = decodeURIComponent((location.hash.match(/^#agent=(.+)$/) || [])[1] || '');

connectLink({
  onSocket: ws => { socket = ws; },
  onStatus: on => link.classList.toggle('on', on),
  onMessage(msg) {
    if (msg.type === 'snapshot') crowd.syncSnapshot(msg.sessions);
    else if (msg.type === 'event') crowd.onEvent(msg.event);
    if (focusId && Orbit.agents.has(focusId)) { Orbit.select(focusId); focusId = ''; }
    if (Orbit.onMessage) Orbit.onMessage(msg);
  },
});

document.getElementById('demo').addEventListener('click', () => {
  fetch(API.demo, { method: 'POST' }).catch(() => {});
});
const soundBtn = document.getElementById('sound');
soundBtn.addEventListener('click', () => soundBtn.setAttribute('aria-pressed', String(sfx.toggle())));

function resize() {
  const d = dpr(), old = cam.zoom, wasFit = Math.abs(old - levels[0]) < 1e-6;
  canvas.width = Math.round(innerWidth * d); canvas.height = Math.round(innerHeight * d);
  computeLevels();
  if (wasFit) cam.zoom = levels[0];
  clampCam(cam);
}
addEventListener('resize', resize);

// ------------------------------------------------------------ world drawing
function drawWindows(t) {
  for (const [i, w] of WINDOWS.entries()) {
    g.save();
    g.beginPath(); g.rect(w.x, w.y, w.w, w.h); g.clip();
    rect(g, w.x, w.y, w.w, w.h, '#04060c');
    for (let s = 0; s < 18; s++) {
      const x = w.x + (((noise(i * 40 + s) * w.w - t * (1.5 + noise(s + i) * 3)) % w.w) + w.w) % w.w;
      g.globalAlpha = 0.5 + 0.5 * Math.sin(t * 2 + s * 1.7);
      rect(g, x, w.y + noise(i * 40 + s + 7) * w.h, 1, 1, '#cfe0ff');
    }
    g.globalAlpha = 1;
    const px = w.x + w.w - ((t * 2.2 + i * 31) % (w.w + 40)) + 16;      // a planet drifting by
    g.fillStyle = '#2c5f93'; g.beginPath(); g.arc(px, w.y + w.h - 2, 11, 0, 7); g.fill();
    g.fillStyle = '#4b88c4'; g.beginPath(); g.arc(px - 2, w.y + w.h - 4, 8, 0, 7); g.fill();
    g.fillStyle = '#04060c'; g.globalAlpha = 0.5; g.beginPath(); g.arc(px + 5, w.y + w.h, 10, 0, 7); g.fill(); g.globalAlpha = 1;
    g.restore();
    rect(g, w.x + (w.w >> 1), w.y, 1, w.h, '#2c3a52'); rect(g, w.x, w.y + (w.h >> 1), w.w, 1, '#2c3a52');
  }
}

const doorOpen = new Map();
function drawDoors(dt) {
  for (const d of DOORS) {
    // sliding leaves open when somebody walks up to them
    let near = false;
    const cx = d.x + d.w / 2;
    for (const a of Orbit.agents.values()) if (Math.abs(a.x - cx) < d.w / 2 + 14 && Math.abs(a.y - d.cy) < 34) near = true;
    const o = Math.max(0, Math.min(1, (doorOpen.get(d.id) ?? 0) + (near ? 1 : -1) * dt * 5));
    doorOpen.set(d.id, o);
    const half = Math.round(d.w / 2 * (1 - o));
    rect(g, d.x, d.y, d.w, d.h, C.floorHall);
    for (let k = 0; k < d.w; k += T) rect(g, d.x + k, d.y, 1, d.h, '#16202f');
    if (half > 0) for (const [x, side] of [[d.x, 0], [d.x + d.w - half, 1]]) {
      rect(g, x, d.y, half, d.h, '#4b5d7b'); rect(g, x, d.y, half, 1, '#8aa0c4');
      for (let k = 6; k < d.h; k += 8) rect(g, x, d.y + k, half, 1, '#33445f');
      rect(g, side ? x : x + half - 2, d.y, 2, d.h, '#2c3646');
    }
    rect(g, d.x + d.w / 2 - 2, d.y - 3, 4, 2, o > 0.2 ? C.green : '#7a2a2a');
  }
}

function drawSlotMarks(occ, t) {
  for (const r of [...ROOMS, ROOM.meet]) {
    const set = occ[r.key];
    for (let i = 0; i < SLOT_COUNT(r.key); i++) {
      const p = slotPos(r.key, i), on = set && set.has(i);
      g.globalAlpha = on ? 0.8 : 0.22;
      const c = r.color, x = Math.round(p.x), y = Math.round(p.y) + 1;
      rect(g, x - 7, y - 2, 3, 1, c); rect(g, x + 4, y - 2, 3, 1, c); rect(g, x - 7, y + 2, 3, 1, c); rect(g, x + 4, y + 2, 3, 1, c);
      if (on) { rect(g, x - 5, y, 10, 1, c); }
      g.globalAlpha = 1;
    }
  }
}

function drawRoomHighlight(t) {
  const key = Orbit.highlightStation;
  if (!key) return;
  const r = roomRect(key), c = ROOM[key].color;
  g.globalAlpha = 0.45 + 0.35 * Math.sin(t * 5);
  rect(g, r.x - 2, r.y - FACE * T - 2, r.w + 4, 2, c); rect(g, r.x - 2, r.y + r.h, r.w + 4, 2, c);
  rect(g, r.x - 2, r.y - FACE * T, 2, r.h + FACE * T, c); rect(g, r.x + r.w, r.y - FACE * T, 2, r.h + FACE * T, c);
  g.globalAlpha = 1;
}

function render(t, dt) {
  g.drawImage(staticLayer, 0, 0);
  drawWindows(t);
  drawDoors(dt);
  const occ = crowd.occupancy();
  const spawn = spawnPos();
  let nearGate = gateFlash > 0;
  for (const a of Orbit.agents.values()) if (Math.hypot(a.x - spawn.x, a.y - spawn.y) < 40) nearGate = true;
  gateOpenAmt += ((nearGate ? 1 : 0) - gateOpenAmt) * Math.min(1, dt * 6);
  for (const r of [...ROOMS, ROOM.meet]) STATION_DEFS[r.key].animate(g, r.tx * T, r.ty * T, t, occ[r.key] || EMPTY, { gateOpen: gateOpenAmt, deskOfSlot: STATION_DEFS.desks.deskOfSlot });
  drawSlotMarks(occ, t);
  drawRoomHighlight(t);
  crowd.draw(g, t);
}
const EMPTY = new Set();
let gateOpenAmt = 0;

// ---------------------------------------------------------------- main loop
let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000), t = now / 1000;
  last = now;
  gateFlash = Math.max(0, gateFlash - dt);

  crowd.update(dt, t, now);
  render(t, dt);

  if (tween) {
    tween.t += dt / tween.dur;
    const e = ease(Math.min(1, tween.t));
    cam.x = tween.from.x + (tween.to.x - tween.from.x) * e;
    cam.y = tween.from.y + (tween.to.y - tween.from.y) * e;
    cam.zoom = tween.from.zoom + (tween.to.zoom - tween.from.zoom) * e;
    if (tween.t >= 1) { cam.zoom = tween.to.zoom; tween = null; }
  }
  // a selected agent gets followed
  const sel = Orbit.agents.get(Orbit.selectedId);
  if (sel && !tween) {
    if (focusedId !== sel.id) { focusedId = sel.id; following = true; flyTo(sel.x, sel.y - 12, zoomFor(280, 200), 0.7); }
    else if (following) { cam.x += (sel.x - cam.x) * (1 - Math.exp(-dt * 6)); cam.y += (sel.y - 12 - cam.y) * (1 - Math.exp(-dt * 6)); }
  }
  clampCam(cam);

  // blit the world buffer with whole-pixel offsets
  const d = dpr(), s = cam.zoom * d;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = C.void;
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(buf, Math.round(canvas.width / 2 - cam.x * s), Math.round(canvas.height / 2 - cam.y * s), Math.round(PX_W * s), Math.round(PX_H * s));

  crowd.updateLabels(toScreen);
  requestAnimationFrame(frame);
}

computeLevels();
cam.zoom = levels[0];
resize();
requestAnimationFrame(frame);
