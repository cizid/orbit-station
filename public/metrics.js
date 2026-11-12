import { agentColor, TOOL_STATION, isTask } from './js/states.js';
import { ROOM } from './js/consts.js';
import { API } from './js/routes.js';
import { connectLink } from './js/link.js';
import { mountNav } from './js/shell.js';

mountNav('metrics');

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const dur = ms => ms == null ? '–' : ms < 1000 ? `${Math.round(ms)} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)} m ${String(Math.round(ms % 60000 / 1000)).padStart(2, '0')} s`;
const num = n => n >= 1e6 ? `${(n / 1e6).toFixed(2)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n);
const usd = (c, known) => known ? `≈ $${c.toFixed(c < 1 ? 3 : 2)}` : c > 0 ? `≥ $${c.toFixed(3)} (n/a for some models)` : 'n/a';
const toolColor = tool => ROOM[isTask(tool) ? 'meet' : TOOL_STATION[tool] ?? 'desks']?.color ?? '#9aa7b5';

let data = null;
async function load() {
  try { data = await (await fetch(API.metrics)).json(); } catch { return; }
  render();
}
let timer = null;
const soon = () => { clearTimeout(timer); timer = setTimeout(load, 500); };

function bars(rows, color, hotFirst) {
  const max = Math.max(1, ...rows.map(r => r.v));
  return `<div class="bars">${rows.map((r, i) => `<div class="bar${hotFirst && i === 0 && r.v > 0 ? ' hot' : ''}" style="--c:${r.color ?? color}"><span>${esc(r.label)}</span><div class="fill"><i style="width:${(r.v / max * 100).toFixed(1)}%"></i></div><span class="num">${r.text}</span></div>`).join('')}</div>`;
}

function render() {
  const m = data, t = m.totals, toolShare = t.tool_ms || 1;
  const tiles = [
    ['Cost', usd(t.cost, t.cost_known), 'estimated from token counts', '#ffc233'],
    ['Tokens', `${num(t.tokens.in + t.tokens.out)}`, `in ${num(t.tokens.in)} · out ${num(t.tokens.out)} · cache ${num(t.tokens.cr + t.tokens.cc)}`, '#5aa9ff'],
    ['API requests', t.requests, `avg response ${dur(t.avg_latency_ms)}`, '#6ee7ff'],
    ['Tool time', dur(t.tool_ms), `${t.errors} failed call${t.errors === 1 ? '' : 's'}`, '#ff8a3d'],
    ['Waiting for you', dur(t.wait_ms), 'permission questions', '#ff4d4d'],
  ].map(([l, v, s, c]) => `<div class="tile" style="--c:${c}"><span>${l}</span><b>${esc(v)}</b><small>${esc(s)}</small></div>`).join('');

  const agentRows = m.agents.filter(a => a.requests || a.calls);
  const agentTable = agentRows.length ? `<div class="scroll"><table id="crew"><thead><tr><th>AGENT</th><th>COST</th><th>TOKENS IN/OUT</th><th>REQUESTS</th><th>AVG RESPONSE</th><th>SLOWEST</th><th>TOOL TIME</th><th>WAITED</th><th>CALLS</th><th>ERRORS</th></tr></thead><tbody>${agentRows.map(a => `<tr>
    <td class="agent-cell"><a class="agent" style="--c:${agentColor(a.key)}" href="/trace?sid=${encodeURIComponent(a.sid)}"><i></i>${esc(a.name)}</a></td>
    <td>${esc(usd(a.cost, a.cost_known))}</td><td>${num(a.tokens.in)} / ${num(a.tokens.out)}</td><td>${a.requests}</td><td>${dur(a.avg_latency_ms)}</td><td>${dur(a.max_latency_ms || null)}</td>
    <td>${dur(a.tool_ms)}</td><td>${dur(a.wait_ms)}</td><td>${a.calls}</td><td>${a.errors}</td></tr>`).join('')}</tbody></table></div>`
    : '<p class="empty-note">No usage yet. Costs and tokens appear once a session has answered at least once.</p>';

  const top = m.tools[0];
  const toolBars = m.tools.length
    ? bars(m.tools.slice(0, 12).map(x => ({ label: x.tool, v: x.total_ms, color: toolColor(x.tool), text: `${dur(x.total_ms)} · ${x.calls}× · avg ${dur(x.total_ms / x.calls)} · max ${dur(x.max_ms)}${x.errors ? ` · ${x.errors} failed` : ''}` })), '#9aa7b5', true)
    : '<p class="empty-note">No tool calls yet.</p>';
  const note = top ? `<p class="empty-note">Bottleneck: <b style="color:var(--warn)">${esc(top.tool)}</b> takes ${(top.total_ms / toolShare * 100).toFixed(0)}% of all tool time. On the station map this room glows warm.</p>` : '';

  const costBars = agentRows.length ? bars([...agentRows].sort((a, b) => b.cost - a.cost).slice(0, 10).map(a => ({ label: a.name, v: a.cost, color: agentColor(a.key), text: usd(a.cost, a.cost_known) })), '#ffc233') : '';
  const al = m.alerts.length ? `<section class="panel"><h2>Guardrails <span class="sub">${m.alerts.length} active</span></h2><ul class="alerts">${m.alerts.map(a => `<li class="${a.level}"><span class="kind">${esc(a.kind)}</span><span>${esc(a.msg)}</span><time>${new Date(a.at).toLocaleTimeString()}</time></li>`).join('')}</ul></section>` : '';

  $('main').innerHTML = `${al}<section class="panel"><h2>Overview</h2><div class="tiles">${tiles}</div></section>
    <section class="panel"><h2>Per agent</h2>${agentTable}</section>
    <section class="panel"><h2>Bottlenecks <span class="sub">tool time, all sessions</span></h2>${toolBars}${note}</section>
    ${costBars ? `<section class="panel"><h2>Cost per agent</h2>${costBars}<p class="empty-note">${esc(m.pricing_note)}</p></section>` : ''}`;
}

connectLink({
  onStatus: on => $('link').classList.toggle('on', on),
  onMessage: msg => { if (msg.type === 'metrics' || msg.type === 'alert' || msg.type === 'snapshot') soon(); },
});
$('demo').addEventListener('click', () => { fetch(API.demo, { method: 'POST' }).catch(() => {}); });
load();
