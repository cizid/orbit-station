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

let data = null, selected = 'all', socket = null, showEnded = false;   // finished agents are in the project history; hidden unless asked for
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

let sideSig = '';
function renderSide() {
  const html = sideHtml();
  if (html === sideSig) return;            // nothing changed: leave inputs and scroll position alone
  sideSig = html;
  $('side').innerHTML = html;
  const cur = data.projects.find(x => x.root === selected);
  if (!cur) return;
  const upd = patch => post('/api/projects/config', { root: cur.root, ...patch });
  $('cfg-role').onchange = e => upd({ defaultRole: e.target.value });
  $('cfg-budget').onchange = e => upd({ budgetUsd: e.target.value === '' ? null : Number(e.target.value) });
  $('cfg-wt').onchange = e => upd({ worktreeDefault: e.target.checked });
}

// small message at the bottom of the page
function toast(text) {
  let t = $('toast');
  if (!t) { t = document.createElement('div'); t.id = 'toast'; document.body.append(t); }
  t.textContent = text; t.classList.add('on');
  clearTimeout(toast.t); toast.t = setTimeout(() => t.classList.remove('on'), 4000);
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
    <div class="meta"></div><div class="tbox" hidden aria-label="Terminal"></div><div class="feed" role="log" aria-label="Live feed"></div>
    <footer><button type="button" data-act="allow">Allow</button><button type="button" data-act="deny">Deny</button><span class="spacer"></span><button type="button" data-act="term" hidden>Open terminal</button><button type="button" data-act="big">Expand</button><button type="button" class="danger" data-act="stop">Stop</button></footer>`;
  const refs = { name: el.querySelector('h3'), role: el.querySelector('.role'), chip: el.querySelector('.chip'), alerts: el.querySelector('.alerts-n'), meta: el.querySelector('.meta'), feed: el.querySelector('.feed'), tbox: el.querySelector('.tbox'), managedBtns: [...el.querySelectorAll('[data-act=allow],[data-act=deny],[data-act=stop]')], termBtn: el.querySelector('[data-act=term]'), term: null, fit: null };
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
  for (const b of refs.managedBtns) b.hidden = !managed;
  refs.termBtn.hidden = managed || !!a.ended || !a.cwd;   // sessions started elsewhere can't be typed into: offer a terminal of our own in the same folder
  if (managed && !refs.term) attachTerminal(a.sid, refs);   // hired here: the card IS the terminal
  refs.tbox.hidden = !refs.term; refs.feed.hidden = !!refs.term;
}

// a real terminal inside the card: type right here, no extra window
function attachTerminal(sid, refs) {
  const term = new window.Terminal({ fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace', fontSize: 12, scrollback: 2000, theme: { background: '#000000' }, cursorBlink: true });
  const fit = new window.FitAddon.FitAddon();
  term.loadAddon(fit);
  refs.tbox.hidden = false;
  term.open(refs.tbox);
  term.write(ptyBuf.get(sid) ?? '');
  term.onData(d => send({ type: 'send_input', session_id: sid, data: d }));
  term.onResize(({ cols, rows }) => send({ type: 'resize', session_id: sid, cols, rows }));
  let raf = 0;
  const refit = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(() => { try { fit.fit(); } catch { /* hidden */ } }); };
  new ResizeObserver(refit).observe(refs.tbox);
  refs.term = term; refs.fit = refit;
  refit();
  setTimeout(() => term.focus(), 150);   // ready to type as soon as it appears
}

function syncCards() {
  // stable order (oldest first, new agents at the end): cards never jump around when states change,
  // and moving a node would take the keyboard focus away from a terminal
  const wanted = data.agents.filter(a => (showEnded || !a.ended) && (selected === 'all' || a.root === selected) && !roleOff.has(a.role)).sort((a, b) => a.started - b.started);
  const keep = new Set(wanted.map(a => a.sid));
  for (const [sid, c] of cards) if (!keep.has(sid)) { c.refs.term?.dispose(); c.el.remove(); cards.delete(sid); }
  const grid = $('grid');
  grid.querySelector(':scope > .empty-note')?.remove();
  let prev = null;
  for (const a of wanted) {
    let c = cards.get(a.sid), fresh = false;
    if (!c) { c = buildCard(a); cards.set(a.sid, c); pushFeed(c.refs, a.feed); fresh = true; }
    const sig = JSON.stringify([a.role, a.state, a.ended, a.branch, a.worktree, a.name, a.alerts, a.ctx != null ? Math.round(a.ctx) : null, a.cost.toFixed(3), a.tokens, data.managed.includes(a.sid)]);
    if (c.sig !== sig) { c.sig = sig; updateCard(c, a); }
    const want = prev ? prev.nextElementSibling : grid.firstElementChild;
    if (want !== c.el) grid.insertBefore(c.el, want);   // only new cards (or a changed filter) move anything
    if (fresh && data.managed.includes(a.sid)) c.el.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
    prev = c.el;
  }
  if (!wanted.length) grid.innerHTML = '<p class="empty-note">No agents here yet. Press “+ Hire Agent”, or start a Claude Code session with the hooks.</p>';
}

let filterSig = '';
function renderFilters() {
  const live = data.agents.filter(a => showEnded || !a.ended), used = new Set(live.map(a => a.role)), ended = data.agents.filter(a => a.ended).length;
  const html = [...used].map(k => { const r = roleOf(k); return `<button type="button" class="fchip" data-role="${k}" style="--c:${r.color}" aria-pressed="${!roleOff.has(k)}">${esc(r.label)}</button>`; }).join('') + (ended ? `<button type="button" class="fchip" data-ended="1" style="--c:#94a3b8;margin-left:auto" aria-pressed="${showEnded}">${showEnded ? 'Hide' : 'Show'} finished (${ended})</button>` : '');
  if (html !== filterSig) { filterSig = html; $('filters').innerHTML = html; }
}
let warnSig = '';
function renderWarnings() {
  const al = data.alerts.filter(a => ['conflict-risk', 'merge-conflict', 'budget'].includes(a.kind) && (selected === 'all' || data.agents.find(x => x.sid === a.sid)?.root === selected));
  al.sort((x, y) => y.at - x.at);
  const wHtml = al.length ? `<ul class="alerts">${al.map(a => `<li class="${a.level}"><span class="kind">${esc(a.short ?? a.kind)}</span><span>${esc(a.msg)}</span><time>${new Date(a.at).toLocaleTimeString()}</time></li>`).join('')}</ul>` : '';
  if (wHtml !== warnSig) { warnSig = wHtml; $('warnings').innerHTML = wHtml; }
}

function render() { renderSide(); renderFilters(); renderWarnings(); syncCards(); }

// ------------------------------------------------------------------ interaction
$('side').addEventListener('click', e => { const b = e.target.closest('.proj'); if (b) { selected = b.dataset.root; render(); } });
$('filters').addEventListener('click', e => { const b = e.target.closest('.fchip'); if (!b) return; if (b.dataset.ended) { showEnded = !showEnded; render(); return; } roleOff.has(b.dataset.role) ? roleOff.delete(b.dataset.role) : roleOff.add(b.dataset.role); render(); });
$('grid').addEventListener('click', e => {
  const btn = e.target.closest('button[data-act]'), card = btn?.closest('.acard');
  if (!card) return;
  const sid = card.dataset.sid, c = cards.get(sid);
  if (btn.dataset.act === 'term') { const a = data.agents.find(x => x.sid === sid); if (a) { toast('Opening a terminal in ' + a.cwd + ' …'); send({ type: 'spawn_agent', cwd: a.cwd, role: a.role }); } }
  else if (btn.dataset.act === 'stop') send({ type: 'kill_agent', session_id: sid });
  else if (btn.dataset.act === 'allow') send({ type: 'send_input', session_id: sid, data: ALLOW_KEYS });
  else if (btn.dataset.act === 'deny') send({ type: 'send_input', session_id: sid, data: DENY_KEYS });
  else if (btn.dataset.act === 'big') { card.classList.toggle('big'); btn.textContent = card.classList.contains('big') ? 'Shrink' : 'Expand'; c?.refs.fit?.(); }
});
// clicking anywhere in the terminal box focuses it
$('grid').addEventListener('mousedown', e => { const box = e.target.closest('.tbox'); if (box) cards.get(box.closest('.acard').dataset.sid)?.refs.term?.focus(); });

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
      case 'snapshot':
        for (const a of msg.agents ?? []) { ptyBuf.set(a.session_id, a.buffer ?? ''); const t = cards.get(a.session_id)?.refs.term; if (t) { t.reset(); t.write(a.buffer ?? ''); } }
        soon(); break;
      case 'feed': { const c = cards.get(msg.session_id); if (c) pushFeed(c.refs, msg.lines); break; }
      case 'pty_output': {
        const b = ((ptyBuf.get(msg.session_id) ?? '') + msg.data).slice(-64 * 1024);
        ptyBuf.set(msg.session_id, b);
        cards.get(msg.session_id)?.refs.term?.write(msg.data);
        break;
      }
      case 'agent_spawned': $('modal').hidden = true; $('hire-task').value = ''; soon(); break;
      case 'agent_exit': soon(); break;
      case 'error': if (msg.request === 'spawn_agent') { $('hire-error').textContent = msg.message; toast(msg.message); } break;
      case 'agents': case 'quota': case 'alert': soon(); break;
    }
  },
});
load();
