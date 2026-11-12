import { createHash } from 'node:crypto';
import { isTask, TOOL_STATION, projectName } from '../public/js/states.js';

// Tracing: who prompted whom, which agent called which tool for how long, and who handed work to whom.
// Built from hook events (tool_use_id, duration_ms, agent_id) plus token usage read from the transcripts.
// Model (OpenTelemetry-like): a session holds agents (main + subagents), spans (tool calls, waiting for
// the user) and edges (prompt, delegate, return).

const MAX_SPANS = 4000, MAX_EDGES = 800, MAX_SESSIONS = 40, TEXT = 240;
const clip = (s, n = TEXT) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
const sig = (tool, input) => createHash('sha1').update(`${tool}\0${JSON.stringify(input ?? null)}`).digest('hex').slice(0, 10);
// a short excerpt of what a tool returned, so a reviewer can see what the agent actually saw
const brief = r => {
  if (r == null) return '';
  const t = typeof r === 'string' ? r : JSON.stringify(r);
  return clip(t, 300);
};
const summarize = input => (input && typeof input === 'object')
  ? clip(input.file_path ?? input.command ?? input.pattern ?? input.url ?? input.query ?? input.description ?? input.subject ?? '', 120) : '';

export function createTraceStore({ now = Date.now, pricing = null } = {}) {
  const sessions = new Map();

  function session(ev) {
    let s = sessions.get(ev.session_id);
    if (!s) {
      s = { sid: ev.session_id, cwd: ev.cwd ?? '', project: projectName(ev.cwd), started: now(), ended: null, agents: new Map(), spans: [], edges: [],
        open: new Map(), pending: [], wait: null, turns: [], judgements: [], usage: new Map(), paths: { main: null, offsets: {} } };
      sessions.set(s.sid, s);
      if (sessions.size > MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
    }
    if (ev.cwd) { s.cwd = ev.cwd; s.project = projectName(ev.cwd); }
    return s;
  }
  const agentOf = (s, key, patch = {}) => {
    let a = s.agents.get(key);
    if (!a) {
      const main = key === s.sid;
      a = { key, kind: main ? 'main' : 'sub', agent_type: null, parent: main ? null : s.sid, name: main ? `${s.project || 'AGENT'}·${s.sid.slice(0, 4)}` : key.slice(0, 6), started: now(), ended: null,
        tokens: { in: 0, out: 0, cr: 0, cc: 0 }, cost: 0, cost_known: true, requests: 0, latency_sum: 0, latency_n: 0, latency_max: 0 };
      s.agents.set(key, a);
    }
    return Object.assign(a, patch);
  };
  const push = (arr, item, max) => { arr.push(item); if (arr.length > max) arr.shift(); };

  function closeWait(s, at) {
    if (s.wait) { s.wait.end = at; s.wait.status = 'ok'; s.wait = null; return true; }
    return false;
  }

  // a finished turn: what was asked, what the agent finally said, and when
  function recordTurn(s, key, start, end, prompt, message) {
    if (typeof message !== 'string' || !message.trim()) return;
    push(s.turns, { id: `${key.slice(0, 8)}-${end}`, agent: key, start, end, prompt: clip(prompt, 1500), message: clip(message, 4000) }, 200);
  }

  // returns true when something changed
  function onEvent(ev) {
    const sid = ev?.session_id, name = ev?.hook_event_name;
    if (typeof sid !== 'string' || typeof name !== 'string') return false;
    const s = session(ev), at = now(), key = ev.agent_id ?? sid;
    if (typeof ev.transcript_path === 'string') s.paths.main = ev.transcript_path;
    const a = agentOf(s, key, ev.agent_type ? { agent_type: clip(ev.agent_type, 40) } : {});
    let changed = name === 'SessionStart';
    if (name !== 'Notification') changed = closeWait(s, at) || changed;

    switch (name) {
      case 'UserPromptSubmit':
        push(s.edges, { t: at, kind: 'prompt', from: 'user', to: sid, text: clip(ev.prompt) }, MAX_EDGES); changed = true; break;
      case 'PreToolUse': {
        const span = { id: ev.tool_use_id ?? `${at}-${s.spans.length}`, agent: key, kind: 'tool', tool: clip(ev.tool_name, 60), start: at, end: null, status: 'open', sig: sig(ev.tool_name, ev.tool_input), summary: summarize(ev.tool_input) };
        s.open.set(span.id, span); push(s.spans, span, MAX_SPANS);
        if (isTask(ev.tool_name)) s.pending.push({ from: key, text: clip(ev.tool_input?.prompt ?? ev.tool_input?.description), label: clip(ev.tool_input?.description, 80) });
        changed = true; break;
      }
      case 'PostToolUse': case 'PostToolUseFailure': {
        const span = s.open.get(ev.tool_use_id);
        if (span) {
          span.end = Number.isFinite(ev.duration_ms) ? span.start + ev.duration_ms : at;
          span.status = name === 'PostToolUse' ? 'ok' : 'error';
          span.result = brief(ev.tool_response ?? ev.error);
          s.open.delete(ev.tool_use_id); changed = true;
        }
        break;
      }
      case 'SubagentStart': {
        const sub = agentOf(s, ev.agent_id ?? key, { agent_type: clip(ev.agent_type, 40) || null });
        const p = s.pending.shift();
        push(s.edges, { t: at, kind: 'delegate', from: p?.from ?? sid, to: sub.key, text: p?.text ?? '', label: p?.label ?? '' }, MAX_EDGES);
        changed = true; break;
      }
      case 'SubagentStop': {
        const sub = agentOf(s, ev.agent_id ?? key, { ended: at });
        if (typeof ev.agent_transcript_path === 'string') s.paths[sub.key] = ev.agent_transcript_path;
        push(s.edges, { t: at, kind: 'return', from: sub.key, to: sub.parent ?? sid, text: clip(ev.last_assistant_message) }, MAX_EDGES);
        recordTurn(s, sub.key, sub.started, at, s.edges.findLast(e => e.kind === 'delegate' && e.to === sub.key)?.text, ev.last_assistant_message);
        changed = true; break;
      }
      case 'Notification':
        if (!s.wait) { s.wait = { id: `wait-${at}`, agent: key, kind: 'wait', tool: 'waiting for you', start: at, end: null, status: 'open', sig: 'wait', summary: clip(ev.message, 120) }; push(s.spans, s.wait, MAX_SPANS); }
        changed = true; break;
      case 'Stop': {
        const since = s.edges.findLast(e => e.kind === 'prompt')?.t ?? s.started;
        recordTurn(s, sid, since, at, s.edges.findLast(e => e.kind === 'prompt')?.text, ev.last_assistant_message);
        changed = true; break;
      }
      case 'SessionEnd': s.ended = at; for (const x of s.agents.values()) x.ended ??= at; changed = true; break;
    }
    return changed;
  }

  // token usage read from a transcript: [{id, model, in, out, cr, cc, latency_ms}] for one agent
  function addUsage(sid, key, requests) {
    const s = sessions.get(sid);
    if (!s || !requests.length) return false;
    const a = agentOf(s, key);
    for (const r of requests) {
      const prev = s.usage.get(`${key}|${r.id}`) ?? { in: 0, out: 0, cr: 0, cc: 0, counted: false };
      const d = { in: r.in - prev.in, out: r.out - prev.out, cr: r.cr - prev.cr, cc: r.cc - prev.cc };
      a.tokens.in += d.in; a.tokens.out += d.out; a.tokens.cr += d.cr; a.tokens.cc += d.cc;
      const c = pricing?.cost(d, r.model);
      if (c == null) a.cost_known = false; else a.cost += c;
      if (!prev.counted) {
        a.requests++;
        if (r.latency_ms != null) { a.latency_sum += r.latency_ms; a.latency_n++; a.latency_max = Math.max(a.latency_max, r.latency_ms); }
      }
      s.usage.set(`${key}|${r.id}`, { in: r.in, out: r.out, cr: r.cr, cc: r.cc, counted: true });
    }
    return true;
  }

  const clearDemo = () => { for (const sid of [...sessions.keys()]) if (sid.startsWith('demo-')) sessions.delete(sid); };
  const addJudgement = (sid, j) => { const s = sessions.get(sid); if (s) { s.judgements = s.judgements.filter(x => x.turn !== j.turn); s.judgements.push(j); } };
  const raw = sid => sessions.get(sid);
  const sessionCost = s => [...s.agents.values()].reduce((n, a) => n + a.cost, 0);

  function view(sid) {
    const s = sessions.get(sid);
    if (!s) return null;
    return { sid: s.sid, project: s.project, cwd: s.cwd, started: s.started, ended: s.ended, now: now(),
      agents: [...s.agents.values()], spans: s.spans, edges: s.edges, cost: sessionCost(s), turns: s.turns, judgements: s.judgements };
  }
  const list = () => [...sessions.values()].map(s => ({ sid: s.sid, project: s.project, started: s.started, ended: s.ended, agents: s.agents.size, spans: s.spans.length }))
    .sort((a, b) => b.started - a.started);

  // numbers for the metrics page and the heat on the station map
  function metrics(windowMs = 10 * 60 * 1000) {
    const at = now(), tools = new Map(), agents = [], heat = {};
    const tot = { tokens: { in: 0, out: 0, cr: 0, cc: 0 }, cost: 0, cost_known: true, requests: 0, tool_ms: 0, wait_ms: 0, errors: 0, latency_sum: 0, latency_n: 0 };
    for (const s of sessions.values()) {
      for (const a of s.agents.values()) {
        const row = { sid: s.sid, key: a.key, name: a.kind === 'main' ? a.name : `SUB ${a.agent_type ?? a.key.slice(0, 4)}`, project: s.project, kind: a.kind, tokens: a.tokens, cost: a.cost, cost_known: a.cost_known, requests: a.requests,
          avg_latency_ms: a.latency_n ? a.latency_sum / a.latency_n : null, max_latency_ms: a.latency_max, tool_ms: 0, wait_ms: 0, calls: 0, errors: 0, wall_ms: (a.ended ?? at) - a.started };
        for (const sp of s.spans) {
          if (sp.agent !== a.key) continue;
          const dur = (sp.end ?? at) - sp.start;
          if (sp.kind === 'wait') { row.wait_ms += dur; continue; }
          row.tool_ms += dur; row.calls++; if (sp.status === 'error') row.errors++;
          const t = tools.get(sp.tool) ?? { tool: sp.tool, calls: 0, total_ms: 0, max_ms: 0, errors: 0 };
          t.calls++; t.total_ms += dur; t.max_ms = Math.max(t.max_ms, dur); if (sp.status === 'error') t.errors++;
          tools.set(sp.tool, t);
          if (at - sp.start <= windowMs) { const st = isTask(sp.tool) ? 'meet' : TOOL_STATION[sp.tool] ?? 'desks'; heat[st] = (heat[st] ?? 0) + dur; }
        }
        agents.push(row);
        for (const k of ['in', 'out', 'cr', 'cc']) tot.tokens[k] += a.tokens[k];
        tot.cost += a.cost; tot.cost_known &&= a.cost_known; tot.requests += a.requests; tot.tool_ms += row.tool_ms; tot.wait_ms += row.wait_ms; tot.errors += row.errors;
        tot.latency_sum += a.latency_sum; tot.latency_n += a.latency_n;
      }
    }
    const peak = Math.max(0, ...Object.values(heat));
    for (const k of Object.keys(heat)) heat[k] = peak ? heat[k] / peak : 0;
    tot.avg_latency_ms = tot.latency_n ? tot.latency_sum / tot.latency_n : null;
    return { at, totals: tot, agents: agents.sort((a, b) => b.tool_ms - a.tool_ms), tools: [...tools.values()].sort((a, b) => b.total_ms - a.total_ms), heat };
  }

  return { onEvent, addUsage, addJudgement, view, list, metrics, raw, sessionCost, clearDemo };
}
