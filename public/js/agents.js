import { findPath, slotPos, spawnPos, SLOT_COUNT } from './map.js';
import { STATES, ACTIVITY, IDLE_MS, routeEvent, COLORS, hash, projectName } from './states.js';
import { createMeetings } from './meetings.js';
import { ROLES } from './roles.js';

const roleName = r => (r && r !== 'none' && ROLES[r] ? ROLES[r].label.toUpperCase() : '');

const SPEED = { astro: 34, robot: 28 };    // pixels per second (one tile = 16 px): a calm stroll
const HOP = 64;                            // pixels travelled per astronaut bounce
const DWELL = 3000;                        // ms an agent stays at a station before it may walk to the next one
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
      id, cwd: ev.cwd || '', color: pickColor(id), type: 'astro',
      name: roleName(ev.role) || projectName(ev.cwd) || id.slice(0, 6).toUpperCase(),
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
    a.station = key; a.stationAt = performance.now(); a.pending = null; a.v = 0;
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

  // Tool calls change the wanted station all the time. Walking after every one of them looks restless, so a
  // change waits until the agent has been at its station for DWELL ms; only the latest wish counts.
  function softRoute(a, key, now) {
    if (a.station === key) { a.pending = null; return; }
    if (a.inMeet || (a.arrived && now - (a.stationAt || 0) >= DWELL)) { a.pending = null; meet.route(a, key); }
    else a.pending = key;
  }

  // ------------------------------------------------------------ events
  function onEvent(ev) {
    if (!ev || !ev.session_id) return;
    let a = agents.get(ev.session_id);
    if (routeEvent(ev).action === 'leave') { if (a) leave(a); return; }
    if (!a) { a = makeAgent(ev); hooks.onPortal(); }
    else if (ev.cwd) { a.name = roleName(ev.role) || projectName(ev.project || ev.cwd) || a.name; a.cwd = ev.cwd; }
    if (a.leaving) return;
    const now = a.last = performance.now(), sub = agents.get(a.subId);
    const r = routeEvent(ev, { hasSub: !!sub });
    if (r.target === 'sub') { sub.last = now; sub.state = r.state; }
    else if (r.state) a.state = r.state;
    switch (r.action) {
      case 'arrive': a.bubble = null; a.linger = a.last + 3500; meet.route(a, r.station); break;
      case 'delegate': a.bubble = null; if (!sub) meet.taskHandoff(a); break;
      case 'sub-work': a.bubble = null; if (sub.inMeet) meet.release(sub, r.station); else softRoute(sub, r.station, now); break;
      case 'work': a.bubble = null; if (!meet.maybeSync(a, r.station, now)) softRoute(a, r.station, now); break;
      case 'ask': a.bubble = 'alert'; hooks.onAlert(); meet.route(a, r.station); break;
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
        const p = a.path[0], dx = p.x - a.x, dy = p.y - a.y, d = Math.hypot(dx, dy), rest = d + a.path.slice(1).reduce((n, q, i) => n + Math.hypot(q.x - a.path[i].x, q.y - a.path[i].y), 0);
        a.v = (a.v ?? 0) + ((1 + Math.min(1.4, rest / 350)) - (a.v ?? 0)) * Math.min(1, dt * 1.5);   // eases in, and long walks go faster
        const step = SPEED[a.type] * a.v * dt;
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
        a.arrived = true; a.v = 0;
        const f = slotPos(a.station, a.slotIdx).face;
        a.face = f === 'up' ? 'up' : f === 'down' ? 'down' : 'side';
        if (f === 'left') a.flip = true; else if (f === 'right') a.flip = false;
        if (a.station === 'door' && a.linger && now > a.linger) { a.linger = 0; a.bubble = 'done'; a.state = 'idle'; goTo(a, 'lounge'); }
        else if (a.station !== 'lounge' && !a.inMeet && !a.isSub && now - a.last > IDLE_MS) { a.bubble = 'done'; a.state = 'idle'; goTo(a, 'lounge'); }
      }
      if (a.pending && a.arrived && !a.inMeet && !a.leaving && now - (a.stationAt || 0) >= DWELL) { const k = a.pending; a.pending = null; meet.route(a, k); }
      a.spawn = Math.min(1, a.spawn + dt / 0.6);

      // pose
      const moving = a.path.length > 0;
      if (moving) {
        if (a.type === 'astro') {
          const ph = (a.dist % HOP) / HOP, hop = Math.floor(a.dist / HOP) % 2;
          a.air = Math.sin(Math.PI * ph) * 3;
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
        a.air = a.type === 'astro' ? 0.8 + Math.sin(t * 1.2 + a.dist) * 0.6 : 0;   // astronauts hover a little when idle
      }
    }
  }

  // DOM labels follow the camera; `project(a)` gives the screen point above an agent's head.
  // Labels that would cover each other are stacked upwards, front-most agent first.
  function updateLabels(project) {
    const placed = [];
    for (const a of [...agents.values()].sort((p, q) => q.y - p.y)) {
      const p = project(a), el = a.label, w = (a.name.length * 6.5 + 26), h = 20;
      const wantsState = a.id === Orbit.selectedId || a.state === 'waiting' || a.bubble === 'alert';
      let y = p.y;
      for (let n = 0; n < 8; n++) {
        const hit = placed.find(o => Math.abs(o.x - p.x) < (o.w + w) / 2 && Math.abs(o.y - y) < h + 4);
        if (!hit) break;
        y = hit.y - h - 4;
      }
      placed.push({ x: p.x, y, w });
      a.screen.x = p.x; a.screen.y = y; a.screen.visible = a.spawn > 0.3 && p.visible;
      el.style.visibility = a.screen.visible ? 'visible' : 'hidden';
      el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(y)}px) translate(-50%, -100%)`;
      const bubble = a.bubble === 'alert' ? 'alert' : a.bubble === 'done' && !a.path.length && a.arrived ? 'done' : '';
      if (el.dataset.b !== bubble) el.dataset.b = bubble;
      const alert = a.alert && Date.now() - a.alert.at < 5 * 60_000 ? a.alert : null;   // guardrail warning wins over the state
      const stateKey = alert ? `! ${alert.short ?? alert.kind.toUpperCase()}` : a.state === 'working' && ACTIVITY[a.station] ? ACTIVITY[a.station] : (STATES[a.state] || STATES.working).label;
      if (el.dataset.s !== stateKey) {
        el.dataset.s = stateKey;
        const em = el.querySelector('.tag em');
        em.textContent = stateKey; em.style.color = alert ? (alert.level === 'crit' ? '#ff4d4d' : '#ffc233') : (STATES[a.state] || STATES.working).color;
        el.querySelector('.tag').title = alert ? alert.msg : '';
      }
      el.style.setProperty('--sc', (STATES[a.state] || STATES.working).color);
      el.classList.toggle('full', wantsState);
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

  // guardrail alerts from the server; a subagent's alert belongs to the agent that started it
  function setAlert(alert) {
    const a = agents.get(alert.sid);
    if (a && (!a.alert || alert.at >= a.alert.at)) a.alert = alert;
  }

  return { onEvent, syncSnapshot, update, updateLabels, meetings: meet, occupancy, goTo, leave, setAlert };
}
