import { PAGES, API } from './routes.js';

// Navigation shared by every page: <nav id="nav"></nav> gets one link per page.
// The Board link shows how many cards wait for review.
// ---- fullscreen: always on the top document, so it survives page changes inside the shell
const topDoc = () => { try { return window.top.document; } catch { return document; } };
export function toggleFullscreen() {
  const d = topDoc();
  (d.fullscreenElement ? d.exitFullscreen() : d.documentElement.requestFullscreen()).catch(() => {});
}
function mountFullscreen() {
  // opened directly (not through the shell): load it inside the shell so fullscreen can follow page changes
  if (window.top === window && !location.pathname.startsWith('/_')) { location.replace('/?p=' + encodeURIComponent(location.pathname + location.search + location.hash)); return; }
  let btn = document.getElementById('fullscreen');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'fullscreen'; btn.type = 'button'; btn.title = 'Fullscreen (F)'; btn.setAttribute('aria-label', 'Fullscreen');
    btn.innerHTML = '<svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path class="enter" d="M1 6V1h5M10 1h5v5M15 10v5h-5M6 15H1v-5" fill="none" stroke="currentColor" stroke-width="1.6"/><path class="leave" d="M6 1v5H1M15 6h-5V1M10 15v-5h5M1 10h5v5" fill="none" stroke="currentColor" stroke-width="1.6"/></svg>';
    (document.querySelector('.top') ?? document.body).append(btn);
  }
  const sync = () => btn.setAttribute('aria-pressed', String(!!topDoc().fullscreenElement));
  btn.addEventListener('click', toggleFullscreen);
  topDoc().addEventListener('fullscreenchange', sync); sync();
  addEventListener('keydown', e => { if ((e.key === 'f' || e.key === 'F') && !e.metaKey && !e.ctrlKey && !e.altKey && !/^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName) && !e.target.closest?.('.xterm')) toggleFullscreen(); });
}

export function mountNav(activeId) {
  mountFullscreen();
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
