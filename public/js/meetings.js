import { slotPos } from './map.js';
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

  // a subagent that got real work does not wait for its parent at the table: it walks to the matching room now
  function release(sub, key) {
    sub.resume = key;
    const m = meetings.find(x => x.parts.includes(sub));
    if (m && m.phase !== 'pass') endMeeting(m);
  }

  // a spawned subagent appears at the table, gets the task packet, then goes to work
  function taskHandoff(a) {
    if (a.inMeet) return;
    goTo(a, 'meet');
    const id = a.id + '~sub', s = makeAgent({ session_id: id, cwd: a.cwd });
    s.isSub = true; s.parentId = a.id; a.subId = id; s.state = 'working';
    s.type = 'robot';
    s.name = ('SUB ' + a.name).slice(0, 18);
    a.resume = 'lounge';   // the delegating agent waits in the lounge while its subagent works
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
    parent.resume = 'desks';
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

  // what the 3D scene shows: a link between meeting partners and the task packet flying along it
  function links() {
    const out = [];
    for (const m of meetings) {
      if (m.phase === 'gather') continue;
      const l = { a: m.parts[0], b: m.parts[1], packet: null };
      if (m.phase === 'pass' && m.t >= 0) { const [from, to] = m.passes[m.i]; l.packet = { from, to, p: Math.min(1, m.t / PASS_T) }; }
      out.push(l);
    }
    return out;
  }

  return { route, release, taskHandoff, returnSub, maybeSync, update, links };
}
