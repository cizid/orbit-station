import { agentColor, TOOL_STATION, isTask } from './js/states.js';
import { ROOM } from './js/consts.js';
import { API } from './js/routes.js';
import { connectLink } from './js/link.js';
import { mountNav } from './js/shell.js';

mountNav('trace');

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const clock = ms => { const s = Math.max(0, Math.round(ms / 1000)); return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`; };
const dur = ms => ms < 1000 ? `${Math.round(ms)} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)} m ${Math.round(ms % 60000 / 1000)} s`;
const toolColor = tool => ROOM[isTask(tool) ? 'meet' : TOOL_STATION[tool] ?? 'desks']?.color ?? '#9aa7b5';

let sid = new URLSearchParams(location.search).get('sid'), data = null, judgeMode = 'off';

async function loadSettings() {
  try { judgeMode = (await (await fetch(API.settings)).json()).judge.mode; } catch { /* keep last */ }
}
window.addEventListener('orbit:settings', async () => { await loadSettings(); if (data) render(); });

async function load() {
  try { data = await (await fetch(`${API.trace}${sid ? `?sid=${encodeURIComponent(sid)}` : ''}`)).json(); } catch { return; }
  sid = data.trace?.sid ?? sid;
  render();
}
let timer = null;
const soon = () => { clearTimeout(timer); timer = setTimeout(load, 300); };

function nameOf(t, key) {
  if (key === 'user') return 'YOU';
  const a = t.agents.find(x => x.key === key);
  return a ? (a.kind === 'main' ? a.name : `SUB ${a.agent_type ?? key.slice(0, 4)}`) : key.slice(0, 6);
}

const RISK_COLOR = { low: '#5de6a0', medium: '#ffc233', high: '#ff4d4d' };
function verdictHtml(j) {
  if (j.error) return `<div class="verdict"><span class="err">${esc(j.error)}</span></div>`;
  const v = j.verdict;
  return `<div class="verdict"><div class="chips">
    <span class="chip" style="--s:${RISK_COLOR[v.hallucination_risk]}">HALLUCINATION RISK: ${v.hallucination_risk.toUpperCase()}</span>
    <span class="chip" style="--s:${v.consistency === 'ok' ? '#5de6a0' : '#ff4d4d'}">${v.consistency === 'ok' ? 'CONSISTENT' : 'CONTRADICTION'}</span>
    <span class="chip" style="--s:${v.toxicity === 'none' ? '#5de6a0' : v.toxicity === 'mild' ? '#ffc233' : '#ff4d4d'}">TOXICITY: ${v.toxicity.toUpperCase()}</span></div>
    ${esc(v.summary)}${v.claims.length ? `<ul>${v.claims.map(c => `<li class="${c.verdict}"><b>${esc(c.verdict)}</b> · ${esc(c.claim)}${c.evidence ? ` <span class="dim">(${esc(c.evidence)})</span>` : ''}</li>`).join('')}</ul>` : ''}
    <small>${esc(j.model)} · ${dur(j.ms)} · ≈ $${(j.cost_usd ?? 0).toFixed(4)}${j.auto ? ' · automatic' : ''} · a model's opinion, not proof</small></div>`;
}

function turnsHtml(t) {
  const byTurn = new Map(t.judgements.map(j => [j.turn, j]));
  const list = [...t.turns].reverse().slice(0, 30);
  return `<section class="panel"><h2>Answers <span class="sub">${judgeMode === 'off' ? 'AI judge is off (switch in the header)' : 'check an answer with the AI judge'}</span></h2>${list.length ? list.map(x => {
    const j = byTurn.get(x.id);
    return `<div class="turn" style="--c:${agentColor(x.agent)}"><div class="head"><b>${esc(nameOf(t, x.agent))}</b><span>+${clock(x.end - t.started)}</span></div>
      ${x.prompt ? `<p class="ask">asked: ${esc(x.prompt.slice(0, 220))}</p>` : ''}<p class="say">${esc(x.message.slice(0, 500))}${x.message.length > 500 ? '…' : ''}</p>
      ${j ? verdictHtml(j) : judgeMode !== 'off' ? `<button type="button" data-turn="${esc(x.id)}">Check with AI</button>` : ''}</div>`;
  }).join('') : '<p class="empty-note">No finished answer yet.</p>'}</section>`;
}

function renderPicker() {
  $('pick-wrap').innerHTML = data.sessions.length
    ? `<select id="pick" aria-label="Session">${data.sessions.map(s => `<option value="${esc(s.sid)}"${s.sid === sid ? ' selected' : ''}>${esc(s.project || 'AGENT')} · ${esc(s.sid.slice(0, 6))} · ${new Date(s.started).toLocaleTimeString()}</option>`).join('')}</select>` : '';
  const sel = $('pick');
  if (sel) sel.onchange = () => { sid = sel.value; load(); };
}

function alertsHtml(t) {
  const list = data.alerts.filter(a => a.sid === t.sid);
  return `<section class="panel"><h2>Guardrails <span class="sub">${list.length ? `${list.length} active` : 'all quiet'}</span></h2>${list.length
    ? `<ul class="alerts">${list.map(a => `<li class="${a.level}"><span class="kind">${esc(a.kind)}</span><span>${esc(a.msg)}</span><span>${esc(nameOf(t, a.agent))}</span><time>${new Date(a.at).toLocaleTimeString()}</time></li>`).join('')}</ul>`
    : '<p class="empty-note">No loops, error cascades or budget problems detected in this session.</p>'}</section>`;
}

// who handed what to whom: nodes in columns (you, main agent, subagents), edges counted by kind
function graphHtml(t) {
  const subs = t.agents.filter(a => a.kind === 'sub'), main = t.agents.find(a => a.kind === 'main');
  const W = 900, rowH = 74, H = Math.max(120, subs.length * rowH + 40);
  const pos = { user: { x: 70, y: H / 2 }, ...(main ? { [main.key]: { x: 400, y: H / 2 } } : {}) };
  subs.forEach((s, i) => { pos[s.key] = { x: 760, y: 40 + i * rowH + (H - 40 - subs.length * rowH) / 2 + 17 }; });
  const edges = new Map();
  for (const e of t.edges) { const k = `${e.kind}|${e.from}|${e.to}`; edges.set(k, { ...e, n: (edges.get(k)?.n ?? 0) + 1 }); }
  const bad = new Set(data.alerts.filter(a => a.sid === t.sid && a.kind === 'handoff-loop').map(a => a.agent));
  const node = (key, label, sub, color) => { const p = pos[key]; return p ? `<g class="node" style="--c:${color}" transform="translate(${p.x - 62},${p.y - 20})"><rect width="124" height="40"/><text x="62" y="17" text-anchor="middle">${esc(label.slice(0, 16))}</text><text class="dim" x="62" y="31" text-anchor="middle">${esc(sub)}</text></g>` : ''; };
  const lines = [...edges.values()].map(e => {
    const a = pos[e.from], b = pos[e.to];
    if (!a || !b) return '';
    const off = e.kind === 'return' ? 12 : e.kind === 'delegate' ? -12 : 0;
    const x1 = a.x + (b.x > a.x ? 62 : -62), x2 = b.x + (b.x > a.x ? -62 : 62), y1 = a.y + off, y2 = b.y + off, mx = (x1 + x2) / 2;
    return `<path class="edge ${e.kind}${e.kind === 'delegate' && bad.has(e.from) ? ' bad' : ''}" d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" marker-end="url(#ah)"><title>${esc(e.kind)}: ${esc(e.text)}</title></path>
      <text x="${mx}" y="${(y1 + y2) / 2 - 5}" text-anchor="middle">${esc(e.kind)}${e.n > 1 ? ` ×${e.n}` : ''}</text>`;
  }).join('');
  return `<section class="panel"><h2>Handoffs <span class="sub">who passed what to whom</span></h2>
    <svg class="graph" viewBox="0 0 ${W} ${H}" role="img" aria-label="Handoff graph"><defs><marker id="ah" viewBox="0 0 8 8" refX="7" refY="4" markerWidth="7" markerHeight="7" orient="auto"><path d="M0 0L8 4L0 8z" fill="#9aa7b5"/></marker></defs>
    ${lines}${node('user', 'YOU', 'prompts', '#ffffff')}${main ? node(main.key, main.name, `${main.requests} requests`, agentColor(main.key)) : ''}${subs.map(s => node(s.key, `SUB ${s.agent_type ?? s.key.slice(0, 4)}`, `${s.requests} requests`, agentColor(s.key))).join('')}</svg></section>`;
}

function timelineHtml(t) {
  const t0 = t.started, total = Math.max(1000, (t.ended ?? t.now) - t0), pct = ms => ((ms - t0) / total * 100).toFixed(3);
  const rows = t.agents.map(a => {
    const bars = t.spans.filter(s => s.agent === a.key).map(s => {
      const end = s.end ?? t.now, w = Math.max(0.15, (end - s.start) / total * 100);
      const cls = s.kind === 'wait' ? 'wait' : s.status === 'error' ? 'error' : s.status === 'open' ? 'open' : '';
      return `<div class="tl-bar ${cls}" style="left:${pct(s.start)}%;width:${w}%;--c:${toolColor(s.tool)}" title="${esc(s.tool)} · ${dur(end - s.start)}${s.summary ? ' · ' + esc(s.summary) : ''}"></div>`;
    }).join('');
    const marks = t.edges.filter(e => e.to === a.key).map(e => `<div class="tl-mark ${e.kind}" style="left:${pct(e.t)}%" title="${esc(e.kind)} from ${esc(nameOf(t, e.from))}: ${esc(e.text)}"></div>`).join('');
    return `<div class="tl-row"><div class="tl-name" style="color:${agentColor(a.key)}">${esc(nameOf(t, a.key))}</div><div class="tl-track">${bars}${marks}</div></div>`;
  }).join('');
  const legend = [['Archive', 'library'], ['Coding', 'desks'], ['Workbench', 'bench'], ['Comms', 'comms'], ['Subagent', 'meet']].map(([l, k]) => `<span><i style="--c:${ROOM[k].color}"></i>${l}</span>`).join('');
  return `<section class="panel"><h2>Timeline <span class="sub">${dur(total)} · cost ≈ $${t.cost.toFixed(3)}</span></h2><div class="tl">
    <div class="tl-axis">${[0, 0.25, 0.5, 0.75, 1].map(f => `<span>${clock(total * f)}</span>`).join('')}</div>${rows}</div>
    <div class="legend-row">${legend}<span><i style="--c:#ff4d4d"></i>Error</span><span><i style="--c:#ff8a3d"></i>Waiting for you</span><span>◆ prompt / handoff / return</span></div></section>`;
}

function logHtml(t) {
  const items = [
    ...t.edges.map(e => ({ at: e.t, who: nameOf(t, e.from), key: e.from, html: `${esc(e.kind === 'prompt' ? 'prompted' : e.kind === 'delegate' ? '→ ' + nameOf(t, e.to) + ' (delegate)' : '→ ' + nameOf(t, e.to) + ' (return)')}${e.text ? ': ' + esc(e.text) : ''}` })),
    ...t.spans.map(s => ({ at: s.start, who: nameOf(t, s.agent), key: s.agent, html: `${esc(s.tool)}${s.summary ? ' · ' + esc(s.summary) : ''} · ${s.end ? dur(s.end - s.start) : 'running…'} ${s.status === 'error' ? '<span class="err">✗ failed</span>' : s.status === 'ok' ? '✓' : ''}` })),
  ].sort((a, b) => b.at - a.at).slice(0, 300);
  return `<section class="panel"><h2>Event log <span class="sub">newest first</span></h2><ul class="log">${items.map(i => `<li style="--c:${agentColor(i.key)}"><span class="t">+${clock(i.at - t.started)}</span><span class="who">${esc(i.who)}</span><span class="what">${i.html}</span></li>`).join('')}</ul></section>`;
}

function render() {
  renderPicker();
  const t = data.trace;
  $('main').innerHTML = t
    ? alertsHtml(t) + turnsHtml(t) + graphHtml(t) + timelineHtml(t) + logHtml(t)
    : '<section class="panel"><p class="empty-note">No session traced yet. Start a Claude Code session with the hooks, or press “Spawn Demo Agents”.</p></section>';
}

$('main').addEventListener('click', async ev => {
  const btn = ev.target.closest('button[data-turn]');
  if (!btn) return;
  btn.disabled = true; btn.textContent = 'Checking…';
  try {
    const r = await fetch(API.judge, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sid: data.trace.sid, turn: btn.dataset.turn }) });
    if (!r.ok) { btn.textContent = (await r.json()).error ?? 'Failed'; return; }
  } catch { btn.textContent = 'Failed'; return; }
  window.dispatchEvent(new Event('orbit:judged'));
  load();
});

connectLink({
  onStatus: on => $('link').classList.toggle('on', on),
  onMessage: msg => { if (msg.type === 'trace' || msg.type === 'alert' || msg.type === 'snapshot') soon(); },
});
$('demo').addEventListener('click', () => { fetch(API.demo, { method: 'POST' }).catch(() => {}); });
setInterval(() => { if (data?.trace && !data.trace.ended) load(); }, 5000);   // keep running bars growing
loadSettings().then(load);
