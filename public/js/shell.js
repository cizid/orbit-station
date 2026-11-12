import { PAGES, API } from './routes.js';

// Navigation shared by every page: <nav id="nav"></nav> gets one link per page.
// The Board link shows how many cards wait for review.
export function mountNav(activeId) {
  queueMicrotask(mountJudgeSwitch);
  const nav = document.getElementById('nav');
  nav.innerHTML = PAGES.map(p =>
    `<a href="${p.path}"${p.id === activeId ? ' aria-current="page"' : ''}>${p.label}${p.id === 'board' ? '<b id="nav-badge" hidden></b>' : ''}</a>`).join('');
  const badge = document.getElementById('nav-badge');
  window.addEventListener('orbit:tasks', e => {
    const n = e.detail.tasks.filter(t => t.status === 'review').length;
    badge.hidden = !n; badge.textContent = n;
  });
}

// AI judge switch in the header of every page (off by default). Shows today's usage next to it.
export async function mountJudgeSwitch() {
  const nav = document.getElementById('nav');
  const wrap = document.createElement('label');
  wrap.className = 'judge';
  wrap.innerHTML = 'AI judge <select id="judge-mode" aria-label="AI judge"><option value="off">Off</option><option value="manual">On request</option><option value="auto">Auto</option></select><span id="judge-use"></span>';
  nav.append(wrap);
  const sel = wrap.querySelector('select'), use = wrap.querySelector('#judge-use');
  const show = s => { sel.value = s.judge.mode; use.textContent = s.judge.mode === 'off' ? '' : `${s.usage.count}/${s.judge.dailyLimit} today`; use.title = `About $${s.usage.cost.toFixed(3)} at list price; counts against your Claude usage`; };
  const load = async () => { try { show(await (await fetch(API.settings)).json()); } catch { /* server not reachable */ } };
  sel.addEventListener('change', async () => {
    try { show(await (await fetch(API.settings, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ judge: { mode: sel.value } }) })).json()); } catch { load(); }
    window.dispatchEvent(new Event('orbit:settings'));
  });
  window.addEventListener('orbit:judged', load);
  load();
}
