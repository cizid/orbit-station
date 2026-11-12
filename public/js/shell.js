import { PAGES } from './routes.js';

// Navigation shared by every page: <nav id="nav"></nav> gets one link per page.
// The Board link shows how many cards wait for review.
export function mountNav(activeId) {
  const nav = document.getElementById('nav');
  nav.innerHTML = PAGES.map(p =>
    `<a href="${p.path}"${p.id === activeId ? ' aria-current="page"' : ''}>${p.label}${p.id === 'board' ? '<b id="nav-badge" hidden></b>' : ''}</a>`).join('');
  const badge = document.getElementById('nav-badge');
  window.addEventListener('orbit:tasks', e => {
    const n = e.detail.tasks.filter(t => t.status === 'review').length;
    badge.hidden = !n; badge.textContent = n;
  });
}
