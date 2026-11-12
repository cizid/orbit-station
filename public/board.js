import { STATES, effectiveState, agentColor } from './js/states.js';
import { API, fill, stationUrl } from './js/routes.js';
import { connectLink } from './js/link.js';
import { mountNav } from './js/shell.js';

mountNav('board');

const COLUMNS = [
  { id: 'backlog',  label: 'Backlog',     color: '#9aa7b5', empty: 'Cards appear when an agent writes a todo list or gets a prompt.' },
  { id: 'progress', label: 'In progress', color: '#5aa9ff', empty: 'Nobody is working on a card.' },
  { id: 'review',   label: 'Review',      color: '#ffa24a', empty: 'Nothing waiting for you.' },
  { id: 'done',     label: 'Done',        color: '#5de6a0', empty: 'Accepted cards end up here.' },
];
const DONE_SHOWN = 30;

let tasks = [], stats = [], recvAt = Date.now();
const sessions = new Map();
const prevStatus = new Map();
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

function fmt(ms) {
  const s = Math.round(ms / 1000);
  return s < 60 ? `${s}s` : s < 3600 ? `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s` : `${Math.floor(s / 3600)}h ${String(Math.floor(s / 60) % 60).padStart(2, '0')}m`;
}
const liveState = sid => {
  const s = sessions.get(sid);
  return s ? effectiveState(s.state, s.last_seen, Date.now()) : 'offline';
};
const chip = state => `<span class="chip${state === 'waiting' ? ' pulse' : ''}" style="--s:${STATES[state].color}" title="${esc(STATES[state].hint)}">${STATES[state].label}</span>`;
const agentLink = (sid, name) => `<a class="agent" style="--c:${agentColor(sid)}" href="${stationUrl(sid)}" title="Show in station"><i></i>${esc(name)}</a>`;

function cardHtml(t) {
  const prog = t.status === 'progress';
  const title = prog && t.active ? t.active : t.title;
  const names = [...new Set(t.handlers.map(h => h.agent))];
  const nums = [`TIME <b data-live="${t.work_ms}" data-prog="${prog ? 1 : 0}">${fmt(t.work_ms)}</b>`, `TOOLS <b>${t.tools}</b>`];
  if (t.asks) nums.push(`ASKS <b>${t.asks}</b>`);
  if (t.errors) nums.push(`ERR <b>${t.errors}</b>`);
  if (t.handoffs) nums.push(`SUBS <b>${t.handoffs}</b>`);
  if (t.rejections) nums.push(`REJECTED <b>${t.rejections}</b>`);
  const acts = { review: '<button class="ok" data-act="done">Accept</button><button class="danger" data-act="backlog">Reject</button>', done: '<button data-act="review">Reopen</button>' }[t.status] || '';
  return `<article class="card" data-id="${esc(t.id)}" data-status="${t.status}" style="--c:${agentColor(t.session_id)}">
    <p class="title">${esc(title)}</p>
    <div class="meta">${t.handlers.length ? agentLink(t.session_id, t.agent) : '<span>UNASSIGNED</span>'}${prog ? chip(liveState(t.session_id)) : ''}</div>
    ${t.handlers.length ? `<div class="nums">${nums.join('')}</div>` : ''}
    ${names.length > 1 ? `<div class="chain" title="Handed over between agents">${names.map(esc).join(' › ')}</div>` : ''}
    ${acts ? `<div class="acts">${acts}</div>` : ''}
  </article>`;
}

function renderBoard() {
  $('cols').innerHTML = COLUMNS.map(c => {
    const list = tasks.filter(t => t.status === c.id), shown = c.id === 'done' ? list.slice(0, DONE_SHOWN) : list;
    return `<section class="col" style="--c:${c.color}" aria-label="${c.label}">
      <header><h2>${c.label}</h2><span class="count">${list.length}</span></header>
      <div class="cards">${shown.map(cardHtml).join('') || `<p class="empty">${c.empty}</p>`}${list.length > shown.length ? `<p class="empty">+ ${list.length - shown.length} older</p>` : ''}</div>
    </section>`;
  }).join('');
  if (prevStatus.size) for (const el of $('cols').querySelectorAll('.card')) {
    if (prevStatus.get(el.dataset.id) !== el.dataset.status) el.classList.add('moved');
  }
  prevStatus.clear();
  for (const t of tasks) prevStatus.set(t.id, t.status);
}

function renderCrew() {
  const rows = stats.map(a => {
    const decided = a.accepted + a.rejected;
    return `<tr><td class="agent-cell">${agentLink(a.session_id, a.agent)}${chip(liveState(a.session_id))}</td>
      <td>${a.handled}</td><td>${a.delivered}</td><td>${decided ? Math.round(a.accepted / decided * 100) + '%' : '–'}</td><td>${a.rejected}</td>
      <td>${a.handled ? fmt(a.work_ms / a.handled) : '–'}</td><td>${a.handled ? (a.tools / a.handled).toFixed(1) : '–'}</td><td>${a.asks}</td><td>${a.errors}</td><td>${fmt(a.waiting_ms)}</td></tr>`;
  });
  $('crew').innerHTML = `<thead><tr><th>AGENT</th><th>HANDLED</th><th>DELIVERED</th><th>ACCEPTED</th><th>REJECTED</th><th>AVG TIME</th><th>TOOLS/TASK</th><th>ASKS</th><th>ERRORS</th><th>WAITED</th></tr></thead>
    <tbody>${rows.join('') || '<tr><td colspan="10" class="empty">No agent has picked up a card yet.</td></tr>'}</tbody>`;
}

const render = () => { renderBoard(); renderCrew(); };

$('legend').innerHTML = Object.values(STATES).map(s => `<li><span class="chip" style="--s:${s.color}">${s.label}</span>${esc(s.hint)}</li>`).join('');

connectLink({
  onStatus: on => $('link').classList.toggle('on', on),
  onMessage(msg) {
    if (msg.sessions) { sessions.clear(); for (const s of msg.sessions) sessions.set(s.session_id, s); }
    if (msg.tasks) { tasks = msg.tasks; stats = msg.stats; recvAt = Date.now(); }
    if (msg.sessions || msg.tasks) render();
  },
});

// card actions: accept / reject / reopen
$('cols').addEventListener('click', async ev => {
  const btn = ev.target.closest('button[data-act]');
  if (!btn) return;
  const id = btn.closest('.card').dataset.id;
  btn.disabled = true;
  await fetch(fill(API.taskStatus, { id }), { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: btn.dataset.act }) }).catch(() => {});
});

$('demo').addEventListener('click', () => { fetch(API.demo, { method: 'POST' }).catch(() => {}); });

// running clocks of the cards in progress
setInterval(() => {
  for (const el of document.querySelectorAll('[data-live]')) {
    el.textContent = fmt(Number(el.dataset.live) + (el.dataset.prog === '1' ? Date.now() - recvAt : 0));
  }
}, 1000);
