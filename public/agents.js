import { STATES, agentColor } from './js/states.js';
import { ROLES, roleOf } from './js/roles.js';
import { API } from './js/routes.js';
import { connectLink } from './js/link.js';
import { mountNav } from './js/shell.js';

mountNav('agents');

const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const usd = n => `$${n < 1 ? n.toFixed(3) : n.toFixed(2)}`;
const num = n => (n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n));
const FEED_LINES = 14;
const ALLOW_KEYS = '1', DENY_KEYS = '\x1b';   // checked against the real Claude Code permission menu
const post = (url, body) => fetch(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then(r => r.json()).catch(() => ({ error: 'request failed' }));

let data = null, selected = 'all', socket = null, openTerm = null;
const roleOff = new Set();                 // roles hidden by the filter
const cards = new Map();                   // sid -> { el, refs }
const ptyBuf = new Map();                  // sid -> recent terminal output, for replay when a terminal is opened
const send = msg => socket?.readyState === WebSocket.OPEN && socket.send(JSON.stringify(msg));

// ------------------------------------------------------------------ data
let timer = null;
const soon = () => { clearTimeout(timer); timer = setTimeout(load, 250); };
async function load() {
  try { data = await (await fetch(API.agents ?? '/api/agents')).json(); } catch { return; }
  render();
}

// ------------------------------------------------------------------ sidebar
function sideHtml() {
  const p = data.projects, cur = p.find(x => x.root === selected);
  const total = data.agents.filter(a => !a.ended).length;
  const projBtn = (key, name, sub, extra = '') => `<button type="button" class="proj" data-root="${esc(key)}" aria-pressed="${key === selected}"><b>${esc(name)}</b><small>${sub}</small>${extra}</button>`;
  const meter = x => x.budgetUsd ? `<div class="meter ${x.cost_today / x.budgetUsd > 1 ? 'bad' : x.cost_today / x.budgetUsd > 0.7 ? 'warn' : ''}"><i style="width:${Math.min(100, x.cost_today / x.budgetUsd * 100)}%"></i></div>` : '';
  const q = data.quota.plan;
  const bar = (label, w) => w ? `<div><small>${label} · ${Math.round(w.pct)}%${w.resets_at ? ` · resets ${new Date(w.resets_at * 1000).toLocaleString([], { weekday: 'short', hour: '2-digit', minute: '2-digit' })}` : ''}</small><div class="meter ${w.pct > 90 ? 'bad' : w.pct > 70 ? 'warn' : ''}"><i style="width:${Math.min(100, w.pct)}%"></i></div></div>` : '';
  return `<section class="panel"><h2>Projects</h2><div style="display:grid;gap:6px">
      ${projBtn('all', 'All projects', `${total} running · ${usd(p.reduce((n, x) => n + x.cost_today, 0))} today`)}
      ${p.map(x => projBtn(x.root, x.name, `${x.active} running · ${usd(x.cost_today)} today${x.budgetUsd ? ` / ${usd(x.budgetUsd)}` : ''}`, meter(x))).join('')}</div></section>
    ${cur ? `<section class="panel cfg"><h2>${esc(cur.name)}</h2>
      <label>Default role for new agents<select id="cfg-role">${Object.entries(data.roles).map(([k, r]) => `<option value="${k}"${k === cur.defaultRole ? ' selected' : ''}>${esc(r.label)}</option>`).join('')}</select></label>
      <label>Daily budget (USD, empty = none)<input id="cfg-budget" type="number" min="0" step="1" value="${cur.budgetUsd ?? ''}"></label>
      <label class="check" style="display:flex;flex-direction:row;gap:8px;align-items:center"><input id="cfg-wt" type="checkbox"${cur.worktreeDefault ? ' checked' : ''}> New agents get their own worktree</label>
      <h2 style="margin-top:12px">History</h2>${cur.history.length ? `<ul class="hist">${cur.history.map(h => `<li style="--c:${roleOf(h.role).color}"><span class="role">${esc(roleOf(h.role).label)}</span><span>${esc(h.branch ?? '')}</span><span>${usd(h.cost ?? 0)}</span></li>`).join('')}</ul>` : '<p class="empty-note">No finished agents yet.</p>'}</section>` : ''}
    <section class="panel quota"><h2>Quota</h2>${q ? `${bar('5-hour limit', q.five_hour)}${bar('7-day limit', q.seven_day)}<small class="dim">updated ${new Date(data.quota.at).toLocaleTimeString()}</small>`
      : '<p class="empty-note">Plan limits show up once an agent reports its status line. Agents hired here do it automatically; for your own sessions set <code>node scripts/statusline.mjs</code> as the status line command.</p>'}
      <small class="dim">Costs are estimates from token counts (${data.max_agents} agents max).</small></section>`;
}

function renderSide() {
  $('side').innerHTML = sideHtml();
  const cur = data.projects.find(x => x.root === selected);
  if (!cur) return;
  const upd = patch => post('/api/projects/config', { root: cur.root, ...patch });
  $('cfg-role').onchange = e => upd({ defaultRole: e.target.value });
  $('cfg-budget').onchange = e => upd({ budgetUsd: e.target.value === '' ? null : Number(e.target.value) });
  $('cfg-wt').onchange = e => upd({ worktreeDefault: e.target.checked });
}

// ------------------------------------------------------------------ cards
const FEED_CLASS = { status: 'status' };
function feedLine(l) { const d = document.createElement('div'); d.className = `${FEED_CLASS[l.kind] ?? l.kind}${l.kind === 'status' && l.ok === false ? ' bad' : ''}`; d.textContent = l.text; return d; }
function pushFeed(refs, lines) {
  const box = refs.feed, atEnd = box.scrollHeight - box.scrollTop - box.clientHeight < 24;
  for (const l of lines) box.append(feedLine(l));
  while (box.childElementCount > 120) box.firstChild.remove();
  if (atEnd) box.scrollTop = box.scrollHeight;
}

function buildCard(a) {
  const el = document.createElement('article');
  el.className = 'acard';
  el.innerHTML = `<header><h3></h3><select class="role" aria-label="Role"></select><span class="chip"></span><span class="alerts-n"></span></header>
    <div class="meta"></div><div class="feed" role="log" aria-label="Live feed"></div>
    <footer><button type="button" data-act="term"></button><button type="button" class="danger" data-act="stop">Stop</button></footer>`;
  const refs = { name: el.querySelector('h3'), role: el.querySelector('.role'), chip: el.querySelector('.chip'), alerts: el.querySelector('.alerts-n'), meta: el.querySelector('.meta'), feed: el.querySelector('.feed'), term: el.querySelector('[data-act=term]'), stop: el.querySelector('[data-act=stop]') };
  refs.role.innerHTML = Object.entries(data.roles).map(([k, r]) => `<option value="${k}">${esc(r.label)}</option>`).join('');
  refs.role.onchange = async () => { await post(`/api/agents/${encodeURIComponent(a.sid)}/role`, { role: refs.role.value }); };
  el.dataset.sid = a.sid;
  return { el, refs };
}

function updateCard(c, a) {
  const { el, refs } = c, role = roleOf(a.role), st = STATES[a.state] ?? STATES.offline, managed = data.managed.includes(a.sid);
  el.style.setProperty('--c', role.color);
  el.classList.toggle('dead', !!a.ended);
  refs.name.textContent = a.name ?? `${data.projects.find(p => p.root === a.root)?.name ?? 'agent'}·${a.sid.slice(0, 4)}`;
  if (refs.role.value !== a.role) refs.role.value = a.role;
  refs.chip.style.setProperty('--s', st.color); refs.chip.className = `chip${a.state === 'waiting' ? ' pulse' : ''}`; refs.chip.textContent = st.label; refs.chip.title = st.hint;
  refs.alerts.textContent = a.alerts ? `! ${a.alerts}` : '';
  refs.meta.innerHTML = `<span class="branch">⎇ ${esc(a.branch ?? '–')}</span>${a.worktree ? '<span class="wt">WORKTREE</span>' : ''}<span>cost <b>${usd(a.cost)}</b></span><span>tokens <b>${num(a.tokens)}</b></span>${a.ctx != null ? `<span>ctx <b>${Math.round(a.ctx)}%</b></span>` : ''}`;
  refs.term.textContent = managed ? 'Open terminal' : 'Open feed';
  refs.stop.hidden = !managed;
}

function syncCards() {
  const wanted = data.agents.filter(a => (selected === 'all' || a.root === selected) && !roleOff.has(a.role));
  const rank = a => (a.ended ? 3 : a.state === 'waiting' ? 0 : a.state === 'working' || a.state === 'handoff' ? 1 : 2);
  wanted.sort((a, b) => rank(a) - rank(b) || b.last_seen - a.last_seen);
  const keep = new Set(wanted.map(a => a.sid));
  for (const [sid, c] of cards) if (!keep.has(sid)) { c.el.remove(); cards.delete(sid); }
  const grid = $('grid');
  wanted.forEach((a, i) => {
    let c = cards.get(a.sid);
    if (!c) { c = buildCard(a); cards.set(a.sid, c); pushFeed(c.refs, a.feed); }
    updateCard(c, a);
    if (grid.children[i] !== c.el) grid.insertBefore(c.el, grid.children[i] ?? null);
  });
  if (!wanted.length) grid.innerHTML = '<p class="empty-note">No agents here yet. Press “+ Hire Agent”, or start a Claude Code session with the hooks.</p>';
  else grid.querySelector(':scope > .empty-note')?.remove();
}

function renderFilters() {
  const used = new Set(data.agents.map(a => a.role));
  $('filters').innerHTML = [...used].map(k => { const r = roleOf(k); return `<button type="button" class="fchip" data-role="${k}" style="--c:${r.color}" aria-pressed="${!roleOff.has(k)}">${esc(r.label)}</button>`; }).join('');
}
function renderWarnings() {
  const al = data.alerts.filter(a => ['conflict-risk', 'merge-conflict', 'budget'].includes(a.kind) && (selected === 'all' || data.agents.find(x => x.sid === a.sid)?.root === selected));
  al.sort((x, y) => y.at - x.at);
  $('warnings').innerHTML = al.length ? `<ul class="alerts">${al.map(a => `<li class="${a.level}"><span class="kind">${esc(a.short ?? a.kind)}</span><span>${esc(a.msg)}</span><time>${new Date(a.at).toLocaleTimeString()}</time></li>`).join('')}</ul>` : '';
}

function render() { renderSide(); renderFilters(); renderWarnings(); syncCards(); }

// ------------------------------------------------------------------ interaction
$('side').addEventListener('click', e => { const b = e.target.closest('.proj'); if (b) { selected = b.dataset.root; render(); } });
$('filters').addEventListener('click', e => { const b = e.target.closest('.fchip'); if (!b) return; roleOff.has(b.dataset.role) ? roleOff.delete(b.dataset.role) : roleOff.add(b.dataset.role); render(); });
$('grid').addEventListener('click', e => {
  const btn = e.target.closest('button[data-act]'), sid = btn?.closest('.acard')?.dataset.sid;
  if (!sid) return;
  if (btn.dataset.act === 'term') openTerminal(sid);
  else if (btn.dataset.act === 'stop') send({ type: 'kill_agent', session_id: sid });
});

// ------------------------------------------------------------------ terminal dock
function openTerminal(sid) {
  closeTerminal();
  const a = data.agents.find(x => x.sid === sid);
  if (!a) return;
  const managed = data.managed.includes(sid), body = $('term-body');
  $('term-dock').hidden = false;
  $('term-name').textContent = $('grid').querySelector(`[data-sid="${sid}"] h3`)?.textContent ?? sid.slice(0, 6);
  $('term-chip').style.setProperty('--c', roleOf(a.role).color);
  $('term-sub').textContent = managed ? 'interactive session' : 'started elsewhere: live feed only';
  for (const id of ['term-allow', 'term-deny', 'term-stop']) $(id).hidden = !managed;
  $('term-form').hidden = !managed;
  body.innerHTML = '';
  if (!managed) {
    const v = document.createElement('div');
    v.className = 'view-only';
    v.textContent = 'This session was started in another terminal, so the dashboard can only watch it (the live feed on its card). Hire agents from here to get a full terminal you can type into.';
    body.append(v);
    openTerm = { sid, term: null };
    return;
  }
  const term = new window.Terminal({ fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 12, scrollback: 4000, theme: { background: '#000000' }, cursorBlink: true });
  const fit = new window.FitAddon.FitAddon();
  term.loadAddon(fit); term.open(body);
  term.write(ptyBuf.get(sid) ?? '');
  term.onData(d => send({ type: 'send_input', session_id: sid, data: d }));
  term.onResize(({ cols, rows }) => send({ type: 'resize', session_id: sid, cols, rows }));
  openTerm = { sid, term, fit };
  requestAnimationFrame(() => { fit.fit(); term.focus(); });
}
function closeTerminal() { openTerm?.term?.dispose(); openTerm = null; $('term-dock').hidden = true; }
$('term-close').onclick = closeTerminal;
$('term-stop').onclick = () => openTerm && send({ type: 'kill_agent', session_id: openTerm.sid });
$('term-allow').onclick = () => openTerm && send({ type: 'send_input', session_id: openTerm.sid, data: ALLOW_KEYS });
$('term-deny').onclick = () => openTerm && send({ type: 'send_input', session_id: openTerm.sid, data: DENY_KEYS });
$('term-form').addEventListener('submit', e => {
  e.preventDefault();
  const text = $('term-input').value.trim();
  if (!text || !openTerm) return;
  const sid = openTerm.sid;
  send({ type: 'send_input', session_id: sid, data: text });
  setTimeout(() => send({ type: 'send_input', session_id: sid, data: '\r' }), 60);   // text first, then Enter
  $('term-input').value = '';
});
window.addEventListener('resize', () => openTerm?.fit?.fit());

// ------------------------------------------------------------------ hire
function openHire() {
  const cur = data?.projects.find(p => p.root === selected);
  $('hire-projects').innerHTML = (data?.projects ?? []).map(p => `<option value="${esc(p.root)}">`).join('');
  $('hire-role').innerHTML = Object.entries(data?.roles ?? Object.fromEntries(Object.entries(ROLES).map(([k, r]) => [k, r]))).map(([k, r]) => `<option value="${k}">${esc(r.label)}</option>`).join('');
  if (cur) { $('hire-cwd').value = cur.root; $('hire-role').value = cur.defaultRole; $('hire-wt').checked = cur.worktreeDefault; }
  $('hire-error').textContent = '';
  $('modal').hidden = false;
  $('hire-cwd').focus();
}
$('hire-open').onclick = openHire;
$('hire-cancel').onclick = () => { $('modal').hidden = true; };
$('hire').addEventListener('submit', e => {
  e.preventDefault();
  send({ type: 'spawn_agent', cwd: $('hire-cwd').value.trim(), role: $('hire-role').value, worktree: $('hire-wt').checked, prompt: $('hire-task').value.trim() || undefined });
});

// ------------------------------------------------------------------ live updates
connectLink({
  onSocket: ws => { socket = ws; },
  onStatus: on => $('link').classList.toggle('on', on),
  onMessage(msg) {
    switch (msg.type) {
      case 'snapshot': for (const a of msg.agents ?? []) ptyBuf.set(a.session_id, a.buffer ?? ''); soon(); break;
      case 'feed': { const c = cards.get(msg.session_id); if (c) pushFeed(c.refs, msg.lines); break; }
      case 'pty_output': {
        const b = ((ptyBuf.get(msg.session_id) ?? '') + msg.data).slice(-64 * 1024);
        ptyBuf.set(msg.session_id, b);
        if (openTerm?.sid === msg.session_id) openTerm.term?.write(msg.data);
        break;
      }
      case 'agent_spawned': $('modal').hidden = true; $('hire-task').value = ''; soon(); break;
      case 'agent_exit': soon(); break;
      case 'error': if (msg.request === 'spawn_agent') $('hire-error').textContent = msg.message; break;
      case 'agents': case 'quota': case 'alert': soon(); break;
    }
  },
});
load();
