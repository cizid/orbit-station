import { findPath, slotPos, spawnPos, SLOT_COUNT } from './map.js';
import { sprite, SPRITE_W } from './sprites.js';
import { rect } from './art.js';
import { STATES, ACTIVITY, IDLE_MS, routeEvent, COLORS, hash, projectName } from './states.js';
import { createMeetings } from './meetings.js';

const SPEED = { astro: 58, robot: 46 };    // pixels per second
const HOP = 44;                            // pixels travelled per astronaut leap
// how a robot or astronaut moves while it works: [seconds per cycle, frames]; frame 3 = arms forward
const WORK = { desks: 0.14, bench: 0.2, library: 0.9, comms: 0.5, lounge: 1.4, meet: 0.55 };

export function createAgents({ labelsEl, Orbit, hooks }) {
  const agents = Orbit.agents;
  // meeting-table choreography lives in meetings.js; it needs these helpers
  const meet = createMeetings({ agents, hooks, goTo: (...x) => goTo(...x), makeAgent: (...x) => makeAgent(...x), freeSlot: (...x) => freeSlot(...x) });

  function pickColor(id) {
    const used = new Set([...agents.values()].map(a => a.color));
    const h = hash(id);
    for (let i = 0; i < COLORS.length; i++) {
      const c = COLORS[(h + i) % COLORS.length];
      if (!used.has(c)) return c;
    }
    return COLORS[h % COLORS.length];
  }

  function makeLabel(a) {
    const el = document.createElement('div');
    el.className = 'lbl';
    el.style.setProperty('--c', a.color);
    el.innerHTML = '<div class="bubble alert">!</div>'
      + '<div class="bubble done"><svg viewBox="0 0 10 8" width="12" height="10" shape-rendering="crispEdges"><path d="M0 4h2v2H0zM2 6h2v2H2zM4 4h2v2H4zM6 2h2v2H6zM8 0h2v2H8z" fill="#fff"/></svg></div>'
      + '<div class="tag"><span></span><em></em></div>';
    labelsEl.append(el);
    return el;
  }

  function makeAgent(ev) {
    const id = ev.session_id, p = spawnPos();
    const a = {
      id, cwd: ev.cwd || '', color: pickColor(id), type: hash(id) & 1 ? 'astro' : 'robot',
      name: projectName(ev.cwd) || id.slice(0, 6).toUpperCase(),
      state: 'boarding', x: p.x, y: p.y, path: [], station: 'door', slotIdx: 0, face: 'down', flip: false,
      arrived: false, bubble: null, last: performance.now(), linger: 0, leaving: false,
      spawn: 0, shrink: 1, dist: 0, air: 0, frame: 0, shown: '', screen: { x: 0, y: 0, visible: true },
    };
    a.label = makeLabel(a);
    agents.set(id, a);
    return a;
  }

  function dispose(a) {
    a.label.remove();
    agents.delete(a.id);
    if (Orbit.selectedId === a.id) Orbit.select(null);
    if (a.isSub) { const p = agents.get(a.parentId); if (p && p.subId === a.id) p.subId = null; }
    else { const s = agents.get(a.subId); if (s) s.vanish = true; }
  }

  // ------------------------------------------------------------ routing
  function freeSlot(a, key) {
    const used = new Set();
    for (const o of agents.values()) if (o !== a && o.station === key) used.add(o.slotIdx);
    for (let i = 0; i < SLOT_COUNT(key); i++) if (!used.has(i)) return i;
    return Math.floor(Math.random() * SLOT_COUNT(key));   // everything taken: share a spot
  }

  function goTo(a, key) {
    if (a.station === key && a.arrived && !a.path.length) return;
    a.station = key;
    a.slotIdx = freeSlot(a, key);
    a.path = findPath({ x: a.x, y: a.y }, slotPos(key, a.slotIdx));
    a.arrived = false;
  }

  function leave(a) {
    if (a.leaving) return;
    const sub = agents.get(a.subId);
    if (sub) sub.vanish = true;
    a.subId = null;
    a.state = 'offline';
    goTo(a, 'door');
    const p = spawnPos();
    a.path.push({ x: p.x, y: p.y });     // back through the airlock
    a.leaving = true;
    a.bubble = null;
    hooks.onPortal();
  }

  // ------------------------------------------------------------ events
  function onEvent(ev) {
    if (!ev || !ev.session_id) return;
    let a = agents.get(ev.session_id);
    if (routeEvent(ev).action === 'leave') { if (a) leave(a); return; }
    if (!a) { a = makeAgent(ev); hooks.onPortal(); }
    else if (ev.cwd) { a.name = projectName(ev.cwd) || a.name; a.cwd = ev.cwd; }
    if (a.leaving) return;
    const now = a.last = performance.now(), sub = agents.get(a.subId);
    const r = routeEvent(ev, { hasSub: !!sub });
    if (r.target === 'sub') { sub.last = now; sub.state = r.state; }
    else if (r.state) a.state = r.state;
    switch (r.action) {
      case 'arrive': a.bubble = null; a.linger = a.last + 3500; meet.route(a, r.station); break;
      case 'delegate': a.bubble = null; if (!sub) meet.taskHandoff(a); break;
      case 'sub-work': a.bubble = null; meet.route(sub, r.station); break;
      case 'work': a.bubble = null; if (!meet.maybeSync(a, r.station, now)) meet.route(a, r.station); break;
      case 'ask': a.bubble = 'alert'; hooks.onAlert(); break;
      case 'finish': a.bubble = 'done'; if (sub) meet.returnSub(a); meet.route(a, r.station); break;
      case 'return': if (sub) meet.returnSub(a); break;
    }
    // a brand-new agent whose first event doesn't move it still has to step out of the airlock
    if (!a.path.length && !a.arrived) goTo(a, a.station);
  }

  function syncSnapshot(list) {
    const ids = new Set(list.map(s => s.session_id));
    for (const s of list) {
      if (agents.has(s.session_id)) continue;
      const a = makeAgent(s);
      a.station = 'lounge';
      a.slotIdx = freeSlot(a, 'lounge');
      const p = slotPos('lounge', a.slotIdx);
      a.x = p.x; a.y = p.y; a.face = p.face;
      a.spawn = 1; a.arrived = true; a.bubble = 'done'; a.state = s.state === 'waiting' ? 'waiting' : 'idle';
    }
    for (const a of agents.values()) if (!ids.has(a.id) && !a.isSub) leave(a);
  }

  // ------------------------------------------------------------ per frame
  function update(dt, t, now) {
    meet.update(dt);
    for (const a of [...agents.values()]) {
      if (a.flash > 0) a.flash -= dt;
      if (a.vanish) { a.path = []; a.shrink -= dt / 0.5; if (a.shrink <= 0) { dispose(a); continue; } }
      else if (a.isSub && !a.inMeet && now - a.last > 90000) { const par = agents.get(a.parentId); if (par) meet.returnSub(par); else a.vanish = true; }
      if (a.path.length) {
        const p = a.path[0], dx = p.x - a.x, dy = p.y - a.y, d = Math.hypot(dx, dy), step = SPEED[a.type] * dt;
        if (a.leaving && a.path.length === 1) a.shrink = Math.max(0, Math.min(1, d / 24));
        if (d <= step) {
          a.x = p.x; a.y = p.y; a.path.shift();
          if (!a.path.length) {
            if (a.leaving) { dispose(a); continue; }
            a.arrived = true;
          }
        } else {
          a.x += dx / d * step; a.y += dy / d * step; a.dist += step;
          if (Math.abs(dx) > Math.abs(dy)) { a.face = 'side'; a.flip = dx < 0; } else a.face = dy < 0 ? 'up' : 'down';
        }
      } else if (!a.leaving) {
        a.arrived = true;
        const f = slotPos(a.station, a.slotIdx).face;
        a.face = f === 'up' ? 'up' : f === 'down' ? 'down' : 'side';
        if (f === 'left') a.flip = true; else if (f === 'right') a.flip = false;
        if (a.station === 'door' && a.linger && now > a.linger) { a.linger = 0; a.bubble = 'done'; a.state = 'idle'; goTo(a, 'lounge'); }
        else if (a.station !== 'lounge' && !a.inMeet && !a.isSub && now - a.last > IDLE_MS) { a.bubble = 'done'; a.state = 'idle'; goTo(a, 'lounge'); }
      }
      a.spawn = Math.min(1, a.spawn + dt / 0.6);

      // pose
      const moving = a.path.length > 0;
      if (moving) {
        if (a.type === 'astro') {
          const ph = (a.dist % HOP) / HOP, hop = Math.floor(a.dist / HOP) % 2;
          a.air = Math.round(Math.sin(Math.PI * ph) * 9);
          a.frame = a.air > 1 ? (hop ? 1 : 2) : 0;
          if (ph < 0.06 && !a.landed) { a.landed = true; hooks.onStep(); } else if (ph > 0.3) a.landed = false;
        } else {
          const k = Math.floor(a.dist / 6) % 2;
          a.air = k; a.frame = k ? 1 : 2;
          if (a.stepK !== k) { a.stepK = k; hooks.onStep(); }
        }
      } else {
        const rate = WORK[a.station];
        a.frame = rate && !a.leaving && !a.vanish && Math.floor(t / rate) % 2 ? 3 : 0;
        a.air = a.type === 'astro' ? Math.round(1 + Math.sin(t * 2 + a.dist) * 1) : 0;   // astronauts hover a little when idle
      }
    }
  }

  // sprites, shadows and the selection ring, sorted by depth
  function draw(g, t) {
    const list = [...agents.values()].sort((p, q) => p.y - q.y);
    for (const a of list) {
      const x = Math.round(a.x), y = Math.round(a.y), alpha = Math.min(1, a.spawn) * a.shrink;
      const sel = a.id === Orbit.selectedId, hl = Orbit.highlightStation && Orbit.highlightStation === a.station && !a.leaving;
      if (sel || hl) {
        const c = sel ? '#ffffff' : '#6ec1ff';
        g.globalAlpha = 0.65 + 0.35 * Math.sin(t * 6);
        rect(g, x - 6, y - 2, 12, 1, c); rect(g, x - 9, y - 1, 3, 1, c); rect(g, x + 6, y - 1, 3, 1, c);
        rect(g, x - 10, y, 2, 1, c); rect(g, x + 8, y, 2, 1, c); rect(g, x - 9, y + 1, 3, 1, c); rect(g, x + 6, y + 1, 3, 1, c); rect(g, x - 6, y + 2, 12, 1, c);
        g.globalAlpha = 1;
      }
      g.globalAlpha = 0.35 * alpha;
      const sw = Math.max(4, 10 - a.air); rect(g, x - (sw >> 1), y - 1, sw, 2, '#000');
      g.globalAlpha = alpha;
      const img = sprite(a.type, a.color, a.face === 'side' ? 'side' : a.face, a.frame);
      const dx = x - SPRITE_W / 2, dy = y - 25 - a.air;
      if (a.flip && a.face === 'side') { g.save(); g.translate(x, 0); g.scale(-1, 1); g.drawImage(img, -SPRITE_W / 2, dy); g.restore(); }
      else g.drawImage(img, Math.round(dx), dy);
      g.globalAlpha = 1;
      if (a.flash > 0) {      // catching a packet
        g.globalAlpha = Math.min(1, a.flash * 3);
        for (const [dx, dy] of [[-9, -20], [8, -20], [-7, -9], [6, -9], [0, -31]]) rect(g, x + dx, y + dy - a.air, 2, 2, '#bff6ff');
        g.globalAlpha = 1;
      }
    }
    meet.draw(g, t);
  }

  // DOM labels follow the camera; `project` maps world pixels to screen pixels
  function updateLabels(project) {
    for (const a of agents.values()) {
      const p = project(a.x, a.y - 30 - a.air);
      if (a.arrived && a.slotIdx % 2) p.y -= 16;   // neighbours at a station would overlap, so odd slots float higher
      a.screen.x = p.x; a.screen.y = p.y; a.screen.visible = a.spawn > 0.3;
      const el = a.label;
      el.style.visibility = a.screen.visible ? 'visible' : 'hidden';
      el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(-50%, -100%)`;
      const bubble = a.bubble === 'alert' ? 'alert' : a.bubble === 'done' && !a.path.length && a.arrived ? 'done' : '';
      if (el.dataset.b !== bubble) el.dataset.b = bubble;
      const stateKey = a.state === 'working' && ACTIVITY[a.station] ? ACTIVITY[a.station] : (STATES[a.state] || STATES.working).label;
      if (el.dataset.s !== stateKey) { el.dataset.s = stateKey; const em = el.querySelector('.tag em'); em.textContent = stateKey; em.style.color = (STATES[a.state] || STATES.working).color; }
      if (a.shown !== a.name) { el.querySelector('.tag span').textContent = a.name; a.shown = a.name; }
      el.classList.toggle('sel', a.id === Orbit.selectedId);
      el.classList.toggle('hl', !!Orbit.highlightStation && Orbit.highlightStation === a.station);
    }
  }

  function occupancy() {
    const occ = {};
    for (const a of agents.values()) {
      if (!a.arrived || a.path.length || a.leaving) continue;
      (occ[a.station] ||= new Set()).add(a.slotIdx);
    }
    return occ;
  }

  return { onEvent, syncSnapshot, update, draw, updateLabels, occupancy, goTo, leave };
}
