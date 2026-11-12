import { slotPos } from './map.js';
import { rect } from './art.js';
import { MEET_COOL_MS, canSync } from './states.js';

// Choreography at the meeting table: handing a task to a subagent, getting the result back, and
// same-project agents syncing up. WHEN these happen is decided by routeEvent()/canSync() in states.js.

const PASS_T = 1.1;            // seconds a task packet needs to fly from giver to taker

export function createMeetings({ agents, hooks, goTo, makeAgent, freeSlot }) {
  const meetings = [];      // { parts:[a,b], passes:[[giver,taker]...], i, phase: gather|pass|hold, t, done }

  // station change that waits while the agent is held at the meeting table
  function route(a, key) {
    if (a.inMeet) { a.resume = key; return; }
    goTo(a, key);
  }

  function startMeeting(parts, passes, done) {
    const m = { parts, passes, i: 0, phase: 'gather', t: 0, done };
    for (const p of parts) p.inMeet = true;
    meetings.push(m);
  }

  function endMeeting(m) {
    meetings.splice(meetings.indexOf(m), 1);
    for (const p of m.parts) {
      if (!agents.has(p.id)) continue;
      p.inMeet = false;
      if (p.resume && !p.leaving && !p.vanish) { const r = p.resume; p.resume = null; goTo(p, r); }
    }
    m.done();
  }

  // a spawned subagent appears at the table, gets the task packet, then goes to work
  function taskHandoff(a) {
    if (a.inMeet) return;
    goTo(a, 'meet');
    const id = a.id + '~sub', s = makeAgent({ session_id: id, cwd: a.cwd });
    s.isSub = true; s.parentId = a.id; a.subId = id; s.state = 'working';
    s.type = a.type === 'astro' ? 'robot' : 'astro';
    s.name = ('SUB ' + a.name).slice(0, 12);
    s.station = 'meet'; s.slotIdx = freeSlot(s, 'meet');
    const p = slotPos('meet', s.slotIdx);
    s.x = p.x; s.y = p.y; s.arrived = true; s.spawn = 0;
    hooks.onPortal();
    startMeeting([a, s], [[a, s]], () => {
      if (s.returnAfter) { const par = s.returnAfter; s.returnAfter = null; runReturn(s, par); }
    });
  }

  function returnSub(parent) {
    const sub = agents.get(parent.subId);
    parent.subId = null;
    if (!sub) return;
    if (sub.inMeet) { sub.returnAfter = parent; return; }
    runReturn(sub, parent);
  }

  function runReturn(sub, parent) {
    if (!agents.has(parent.id) || parent.leaving) { sub.vanish = true; return; }
    sub.resume = null;
    goTo(sub, 'meet'); goTo(parent, 'meet');
    startMeeting([sub, parent], [[sub, parent]], () => { sub.vanish = true; });
  }

  // two agents in the same project that are both busy sync up at the table
  function maybeSync(a, dest, now) {
    for (const b of agents.values()) {
      if (!canSync(a, b, now)) continue;
      a.meetCool = b.meetCool = now + MEET_COOL_MS;
      a.resume = dest; b.resume = b.station;
      goTo(a, 'meet'); goTo(b, 'meet');
      startMeeting([a, b], [[b, a], [a, b]], () => {});
      return true;
    }
    return false;
  }

  function update(dt) {
    for (const m of [...meetings]) {
      m.t += dt;
      if (m.parts.some(p => !agents.has(p.id) || p.leaving || p.vanish)) { endMeeting(m); continue; }
      if (m.phase === 'gather') {
        if (m.parts.every(p => p.station === 'meet' && p.arrived && !p.path.length)) { m.phase = 'pass'; m.t = 0; }
        else if (m.t > 30) endMeeting(m);
      } else if (m.phase === 'pass') {
        if (m.t >= PASS_T) {
          const taker = m.passes[m.i][1];
          taker.flash = 0.5; hooks.onPortal();
          if (++m.i < m.passes.length) m.t = -0.35; else { m.phase = 'hold'; m.t = 0; }
        }
      } else if (m.t > 1.2) endMeeting(m);
    }
  }

  // dotted link between meeting partners and the task packet flying along it
  function draw(g, t) {
    const chest = a => ({ x: a.x, y: a.y - 18 - a.air });
    for (const m of meetings) {
      if (m.phase === 'gather') continue;
      const A = chest(m.parts[0]), B = chest(m.parts[1]), n = Math.max(1, Math.floor(Math.hypot(B.x - A.x, B.y - A.y) / 4));
      g.globalAlpha = 0.7;
      for (let i = 0; i <= n; i++) if ((i + Math.floor(t * 10)) % 3 === 0) rect(g, Math.round(A.x + (B.x - A.x) * i / n), Math.round(A.y + (B.y - A.y) * i / n), 2, 1, '#6ee7ff');
      g.globalAlpha = 1;
      if (m.phase !== 'pass' || m.t < 0) continue;
      const [from, to] = m.passes[m.i], F = chest(from), Tt = chest(to), col = from.color;
      for (let k = 4; k >= 0; k--) {
        const p = Math.max(0, Math.min(1, m.t / PASS_T) - k * 0.05), e = p * p * (3 - 2 * p);
        const x = Math.round(F.x + (Tt.x - F.x) * e), y = Math.round(F.y + (Tt.y - F.y) * e - Math.sin(Math.PI * p) * 14);
        if (k) { g.globalAlpha = 0.5 - k * 0.09; rect(g, x - 1, y - 1, 3, 3, col); g.globalAlpha = 1; continue; }
        g.globalAlpha = 0.35; rect(g, x - 6, y - 6, 12, 12, col); g.globalAlpha = 1;
        rect(g, x - 4, y - 4, 8, 9, '#e8f7ff'); rect(g, x - 4, y - 4, 8, 2, col);
        rect(g, x - 2, y, 4, 1, '#5b7a99'); rect(g, x - 2, y + 2, 3, 1, '#5b7a99');
      }
    }
  }

  return { route, taskHandoff, returnSub, maybeSync, update, draw };
}
