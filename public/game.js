import { createAgents } from './js/agents.js';
import { createScene } from './js/scene3d.js';
import { createDashboard } from './js/dashboard.js';
import { sfx } from './js/sfx.js';
import { connectLink } from './js/link.js';
import { API } from './js/routes.js';
import { mountGoals } from './js/goals.js';

// Orbit Station: the dashboard around a 3D office. agents.js decides who walks where (on the logic map),
// scene3d.js shows it, dashboard.js draws the numbers. ui.js (hire modal, console dock, Allow/Deny) talks to
// this through window.Orbit.

const stage = document.getElementById('stage');
const labelsEl = document.getElementById('labels');

let socket = null, scene = null, lastFlown = null;
const Orbit = window.Orbit = {
  agents: new Map(),
  managed: new Set(),     // session_ids whose pty we own, i.e. the ones we can type into
  selectedId: null,
  highlightStation: null, // room key that is highlighted
  send(msg) { if (socket && socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify(msg)); },
  select(id, { keepCamera = false } = {}) {
    Orbit.selectedId = id;
    if (id) Orbit.highlightStation = null;
    else { lastFlown = null; if (!keepCamera && !Orbit.highlightStation) scene?.goHome(); }
    if (Orbit.onSelect) Orbit.onSelect(id);
  },
  // viewport position of an agent's label (the floating Allow/Deny buttons live in viewport space)
  screenAnchor: a => { const r = stage.getBoundingClientRect(), p = a.screen || { x: 0, y: 0, visible: false }; return { x: p.x + r.left, y: p.y + r.top, visible: p.visible }; },
  home() { Orbit.highlightStation = null; Orbit.select(null, { keepCamera: true }); scene?.goHome(); },
};

let gateFlash = 0;
const crowd = createAgents({
  labelsEl, Orbit,
  hooks: {
    onPortal: () => { gateFlash = 1.4; sfx.portal(); },
    onAlert: () => sfx.ping(),
    onStep: () => sfx.step(),
  },
});
scene = createScene({ container: stage, Orbit, crowd });
const dash = createDashboard({ Orbit });
Orbit.crowd = crowd; Orbit.scene = scene;

// the board links here with #agent=<session id>: select that agent as soon as it is on the map
let focusId = decodeURIComponent((location.hash.match(/^#agent=(.+)$/) || [])[1] || '');

connectLink({
  onSocket: ws => { socket = ws; },
  onStatus: on => document.getElementById('link').classList.toggle('on', on),
  onMessage(msg) {
    if (msg.type === 'snapshot') { crowd.syncSnapshot(msg.sessions); scene.setHeat(msg.heat); for (const a of msg.alerts || []) crowd.setAlert(a); }
    else if (msg.type === 'event') crowd.onEvent(msg.event);
    else if (msg.type === 'metrics') scene.setHeat(msg.heat);
    else if (msg.type === 'alert') crowd.setAlert(msg.alert);
    if (focusId && Orbit.agents.has(focusId)) { Orbit.select(focusId); focusId = ''; }
    dash.onMessage(msg);
    if (Orbit.onMessage) Orbit.onMessage(msg);
  },
});

document.getElementById('demo').addEventListener('click', () => { fetch(API.demo, { method: 'POST' }).catch(() => {}); });
const soundBtn = document.getElementById('sound');
soundBtn.addEventListener('click', () => soundBtn.setAttribute('aria-pressed', String(sfx.toggle())));
document.getElementById('zoom-in').addEventListener('click', () => scene.zoom(0.75));
document.getElementById('zoom-out').addEventListener('click', () => scene.zoom(1.33));
document.getElementById('zoom-home').addEventListener('click', () => Orbit.home());

const clock = document.getElementById('clock');
const tickClock = () => { clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' }); };
tickClock(); setInterval(tickClock, 1000);

let last = performance.now();
function frame(now) {
  const dt = Math.min(0.05, (now - last) / 1000), t = now / 1000;
  last = now;
  gateFlash = Math.max(0, gateFlash - dt);
  crowd.update(dt, t, now);
  // a freshly selected agent gets the camera
  const sel = Orbit.agents.get(Orbit.selectedId);
  if (sel && lastFlown !== sel.id && sel.arrived !== undefined) { lastFlown = sel.id; scene.flyToAgent(sel); }
  scene.render(t, dt, gateFlash);
  crowd.updateLabels(scene.project);
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);


mountGoals();
