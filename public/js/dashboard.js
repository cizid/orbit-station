import { STATES } from './states.js';
import { API, fill } from './routes.js';
import { esc, hbars, donut, wave, spikes, radial, gauge, avatars } from './charts.js';

// The panels around the 3D station: KPI strip, agent ranking, task pipeline, review queue and the charts.
// Everything numeric is drawn as a chart where a chart reads faster than a number.

const $ = id => document.getElementById(id);
const num = n => n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(Math.round(n));
const dur = ms => ms < 1000 ? `${Math.round(ms)} ms` : ms < 60000 ? `${(ms / 1000).toFixed(1)} s` : `${Math.floor(ms / 60000)} m ${String(Math.round(ms % 60000 / 1000)).padStart(2, '0')} s`;
const usd = c => `$${c < 1 ? c.toFixed(3) : c.toFixed(2)}`;
const BIN_MS = 5000, BINS = 60;
const TASK_COLORS = { backlog: '#8b97a8', progress: '#4c9aff', review: '#ff9a4a', done: '#19d3ff' };
const TASK_LABEL = { backlog: 'Backlog', progress: 'In progress', review: 'Review', done: 'Done' };
const ICON = {
  agents: '<path d="M12 12a4 4 0 100-8 4 4 0 000 8zm-7 8a7 7 0 0114 0z"/>',
  bolt: '<path d="M13 2L4 14h6l-1 8 9-12h-6z"/>',
  hand: '<path d="M12 2a1.5 1.5 0 011.5 1.5V10h1V5a1.5 1.5 0 013 0v8a7 7 0 01-7 7h-1a6 6 0 01-5-3l-2-4a1.5 1.5 0 012.4-1.7L8 12V6a1.5 1.5 0 013 0v4h1V3.5A1.5 1.5 0 0112 2z"/>',
  tasks: '<path d="M4 5h16v3H4zm0 5.5h16v3H4zM4 16h10v3H4z"/>',
  cost: '<path d="M12 2a10 10 0 100 20 10 10 0 000-20zm1 15.5V19h-2v-1.5c-1.5-.2-2.6-1-3-2.3l1.8-.7c.3.8 1 1.3 2.2 1.3 1 0 1.7-.4 1.7-1.1 0-.7-.5-1-2-1.4-1.8-.5-3.4-1.1-3.4-3 0-1.3 1-2.3 2.7-2.6V5h2v1.4c1.2.2 2.1.9 2.6 2l-1.7.8c-.3-.7-.9-1.1-1.9-1.1s-1.6.4-1.6 1c0 .7.6.9 2.1 1.3 1.9.5 3.3 1.2 3.3 3.1 0 1.4-1 2.4-2.8 2.7z"/>',
  tokens: '<path d="M4 4h7v7H4zm9 0h7v7h-7zM4 13h7v7H4zm9 3.5a3.5 3.5 0 117 0 3.5 3.5 0 01-7 0z"/>',
};
const icon = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;

export function createDashboard({ Orbit }) {
  let tasks = [], metrics = null, alerts = [];
  const bins = [];                       // { t, calls, asks } per 5 s
  const sig = {};
  const set = (id, html) => { if (sig[id] !== html) { sig[id] = html; $(id).innerHTML = html; } };

  const bump = key => {
    const t = Math.floor(Date.now() / BIN_MS) * BIN_MS;
    let b = bins.at(-1);
    if (!b || b.t !== t) { b = { t, calls: 0, asks: 0 }; bins.push(b); while (bins.length > BINS * 2) bins.shift(); }
    b[key]++;
  };
  function series() {                     // last 5 minutes, empty buckets as zero
    const end = Math.floor(Date.now() / BIN_MS) * BIN_MS, byT = new Map(bins.map(b => [b.t, b]));
    const calls = [], asks = [];
    for (let i = BINS - 1; i >= 0; i--) { const b = byT.get(end - i * BIN_MS); calls.push(b?.calls ?? 0); asks.push(b?.asks ?? 0); }
    return { calls, asks };
  }

  let metricsTimer = null;
  async function loadMetrics() {
    try { metrics = await (await fetch(API.metrics)).json(); alerts = metrics.alerts ?? []; } catch { /* server not reachable */ }
  }
  const soon = () => { clearTimeout(metricsTimer); metricsTimer = setTimeout(loadMetrics, 500); };

  function onMessage(msg) {
    if (msg.tasks) tasks = msg.tasks;
    if (msg.type === 'event') {
      const e = msg.event;
      if (e.hook_event_name === 'PreToolUse' && e.tool_name !== 'TodoWrite') bump('calls');
      else if (e.hook_event_name === 'Notification') bump('asks');
    }
    if (msg.type === 'metrics' || msg.type === 'alert' || msg.type === 'snapshot') soon();
  }

  const mains = () => [...Orbit.agents.values()].filter(a => !a.isSub && !a.leaving);

  const live = () => {
    const main = mains(), by = new Map();
    for (const a of metrics?.agents ?? []) { const m = by.get(a.sid) ?? { calls: 0, cost: 0, tokens: 0 }; m.calls += a.calls; m.cost += a.cost; m.tokens += a.tokens.in + a.tokens.out; by.set(a.sid, m); }
    return main.map(a => ({ a, m: by.get(a.id) ?? { calls: 0, cost: 0, tokens: 0 } })).sort((p, q) => q.m.calls - p.m.calls || p.a.name.localeCompare(q.a.name));
  };

  function renderHeader() {
    const main = mains(), working = main.filter(a => a.state === 'working' || a.state === 'handoff').length, waiting = main.filter(a => a.state === 'waiting').length;
    const g = (id, pct, color, label, text) => set(id, `${gauge(pct, { size: 42, color })}<div class="t"><small>${label}</small><b>${text}</b></div>`);
    g('g-agents', main.length ? working / main.length : 0, '#19d3ff', 'Agents working', `${working} / ${main.length}`);
    g('g-health', main.length ? 1 - waiting / main.length : 1, waiting ? '#ff5d6c' : '#2de2c4', 'Status', waiting ? `${waiting} need you` : 'All good');
  }

  function renderStats() {
    const main = mains(), subs = [...Orbit.agents.values()].filter(a => a.isSub && !a.leaving).length;
    const working = main.filter(a => a.state === 'working' || a.state === 'handoff').length, waiting = main.filter(a => a.state === 'waiting').length;
    const prog = tasks.filter(t => t.status === 'progress').length;
    const row = (ico, label, value, unit, cls = '') => `<div class="stat ${cls}"><span class="ico">${icon(ico)}</span><div><small>${label}</small><b>${value}<i>${unit}</i></b></div></div>`;
    set('l-stats', row('agents', 'Agents online', main.length, subs ? `+ ${subs} helpers` : 'agents')
      + row('bolt', 'Working now', working, `of ${main.length}`)
      + row('hand', 'Needs you', waiting, waiting ? 'waiting for permission' : 'all clear', waiting ? 'alert' : '')
      + row('tasks', 'Tasks in progress', prog, `of ${tasks.length} on the board`));
  }

  function renderAgents() {
    const list = live(), max = Math.max(1, ...list.map(x => x.m.calls));
    set('p-agents', list.length ? list.map(({ a, m }) => {
      const st = STATES[a.state] ?? STATES.working;
      return `<button type="button" class="arow${a.id === Orbit.selectedId ? ' sel' : ''}" data-id="${esc(a.id)}" style="--c:${a.color}">
        <span class="who"><b>${esc(a.name)}</b><em style="color:${st.color}">${st.label}</em></span><i class="meter"><u style="width:${m.calls / max * 100}%"></u></i><span class="val">${m.calls}</span></button>`;
    }).join('') : '<p class="empty-note">No agents yet. Spawn the demo or hire one.</p>');
  }

  function renderTasks() {
    const count = Object.fromEntries(Object.keys(TASK_COLORS).map(s => [s, tasks.filter(t => t.status === s).length]));
    set('l-pipeline', hbars(Object.keys(TASK_COLORS).map(s => ({ label: TASK_LABEL[s], v: count[s], color: TASK_COLORS[s], text: String(count[s]) })), { empty: 'No tasks yet' }));
    const prog = tasks.filter(t => t.status === 'progress').slice(0, 2);
    set('p-now', prog.map(t => `<div class="now"><b>${esc(t.title)}</b><span>${esc(t.agent)}${t.doing || t.active ? ' · ' + esc(t.doing || t.active) : ''}</span></div>`).join(''));
    const rev = tasks.filter(t => t.status === 'review').slice(0, 2);
    set('p-review', rev.length ? rev.map(t => `<div class="rev" data-id="${esc(t.id)}"><div><b>${esc(t.title)}</b><span>${esc(t.agent)}</span></div><button class="ok" data-act="done">Accept</button><button class="danger" data-act="backlog">Reject</button></div>`).join('') : '<p class="empty-note">Nothing waiting for you.</p>');
    const n = tasks.filter(t => t.status === 'review').length;
    $('review-n').textContent = n || ''; $('review-n').hidden = !n;
  }

  function renderAttention() {
    const waiting = mains().filter(a => a.state === 'waiting');
    const rows = [
      ...waiting.map(a => `<button type="button" class="att crit" data-id="${esc(a.id)}"><b>${esc(a.name)} needs you</b><span>waiting for permission or input</span></button>`),
      ...[...new Map(alerts.map(al => [al.kind + al.msg, al])).values()].slice(0, 2).map(al => `<button type="button" class="att ${al.level === 'crit' ? 'crit' : 'warn'}" data-id="${esc(al.sid ?? '')}"><b>${esc(al.kind)}</b><span>${esc(al.msg)}</span></button>`),
    ];
    $('att').hidden = !rows.length;
    set('p-att', rows.join(''));
  }

  function renderCharts() {
    const s = series(), list = live(), totalCalls = list.reduce((n, x) => n + x.m.calls, 0);
    set('l-spikes', spikes(s.calls, { height: 74, empty: 'Waiting for activity…' }));
    set('r-wave', wave([{ name: 'Tool calls', color: '#19d3ff', values: s.calls }, { name: 'Questions', color: '#8b5cf6', values: s.asks }], { height: 84, empty: 'Waiting for activity…' }));
    const tools = (metrics?.tools ?? []).slice(0, 5), toolTotal = (metrics?.tools ?? []).reduce((n, x) => n + x.total_ms, 0) || 1, cols = ['#19d3ff', '#3b82ff', '#8b5cf6', '#2de2c4', '#f2c94c'];
    set('r-tools', radial(tools.map((x, i) => ({ label: x.tool, v: x.total_ms, color: cols[i], text: `${Math.round(x.total_ms / toolTotal * 100)}%` })), { size: 128, empty: 'No tool calls yet' }));
    const counts = {};
    for (const a of mains()) counts[a.state] = (counts[a.state] ?? 0) + 1;
    const sp = Object.entries(counts).map(([k, v]) => ({ v, color: STATES[k]?.color ?? '#888', name: STATES[k]?.label ?? k }));
    const tk = metrics?.totals?.tokens, tp = tk ? [{ v: tk.in, color: '#3b82ff', name: 'Input' }, { v: tk.out, color: '#19d3ff', name: 'Output' }, { v: tk.cr + tk.cc, color: '#8b5cf6', name: 'Cache' }] : [];
    const dl = parts => `<ul class="dl">${parts.map(p => `<li><i style="background:${p.color}"></i>${p.name}<b>${p.name === 'Input' || p.name === 'Output' || p.name === 'Cache' ? num(p.v) : p.v}</b></li>`).join('')}</ul>`;
    set('r-rings', `<div class="ringbox">${donut(sp, { size: 92, centre: String(mains().length), sub: 'agents', empty: 'No agents' })}${dl(sp)}</div>
      <div class="ringbox">${donut(tp, { size: 92, centre: tk ? num(tk.in + tk.out) : '–', sub: 'tokens', empty: 'No usage yet' })}${tp.length ? dl(tp) : ''}</div>`);
    const top = list.slice(0, 4);
    set('b-avatars', avatars(top.map(({ a, m }) => ({ id: a.id, label: a.name, color: a.color, initials: a.name.slice(0, 2), pct: totalCalls ? m.calls / totalCalls : 0, big: m.calls + ' calls', small: totalCalls ? `${Math.round(m.calls / totalCalls * 100)}% of all` : '' }))));
    const cost = list.filter(x => x.m.cost > 0).sort((p, q) => q.m.cost - p.m.cost).slice(0, 6);
    set('b-cost', hbars(cost.map(x => ({ label: x.a.name, v: x.m.cost, color: x.a.color, text: usd(x.m.cost) })), { empty: 'Costs appear after the first answers' }));
  }

  function render() { renderHeader(); renderStats(); renderAgents(); renderTasks(); renderAttention(); renderCharts(); }

  // clicks: rank rows and alerts select the agent on the map, review buttons decide a card
  document.addEventListener('click', async ev => {
    const row = ev.target.closest('.arow, .att, .av');
    if (row && row.dataset.id && Orbit.agents.has(row.dataset.id)) { Orbit.select(row.dataset.id); return; }
    const btn = ev.target.closest('#p-review button[data-act]');
    if (!btn) return;
    btn.disabled = true;
    await fetch(fill(API.taskStatus, { id: btn.closest('.rev').dataset.id }), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: btn.dataset.act }) }).catch(() => {});
  });

  setInterval(render, 1000);
  loadMetrics().then(render);
  render();
  return { onMessage, render };
}
