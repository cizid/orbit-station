'use strict';

// DOM layer on top of the canvas: hire modal, console dock with live terminals,
// and floating Allow/Deny buttons. Rendering and the socket live in game.js (window.Orbit).
(() => {
  const O = window.Orbit;
  const $ = id => document.getElementById(id);

  // Claude Code's permission prompt takes these keystrokes.
  // Claude Code's permission menu (checked against the real CLI): "1" picks Yes; Esc cancels = deny.
  // "n" + Enter would NOT deny: Enter confirms the preselected "1. Yes".
  const ALLOW_KEYS = '1';
  const DENY_KEYS = '\x1b';
  const LAST_CWD_KEY = 'orbit.lastCwd';

  const terms = new Map();   // session_id -> { term, fit, el, opened }
  let pendingHire = false;

  const store = {
    get() { try { return localStorage.getItem(LAST_CWD_KEY) || ''; } catch { return ''; } },
    set(v) { try { localStorage.setItem(LAST_CWD_KEY, v); } catch { /* private mode */ } },
  };

  // ------------------------------------------------------------ terminals
  function getTerm(sid) {
    let t = terms.get(sid);
    if (t) return t;
    const term = new Terminal({
      fontFamily: 'ui-monospace, "SF Mono", Menlo, monospace',
      fontSize: 12,
      cursorBlink: true,
      scrollback: 2000,
      theme: { background: '#05070b', foreground: '#dfe8f2', cursor: '#6ec1ff', selectionBackground: '#2b3a4f' },
    });
    const fit = new FitAddon.FitAddon();
    term.loadAddon(fit);
    const el = document.createElement('div');
    el.className = 'term';
    el.hidden = true;
    $('dock-terms').append(el);
    // typing straight into the terminal works too (menus, y/n, arrows)
    term.onData(data => { if (O.managed.has(sid)) O.send({ type: 'send_input', session_id: sid, data }); });
    term.onResize(({ cols, rows }) => { if (O.managed.has(sid)) O.send({ type: 'resize', session_id: sid, cols, rows }); });
    t = { term, fit, el, opened: false };
    terms.set(sid, t);
    return t;
  }

  function dropStaleTerms() {
    for (const [sid, t] of terms) {
      if (sid === O.selectedId || O.managed.has(sid)) continue;
      t.term.dispose(); t.el.remove(); terms.delete(sid);
    }
  }

  function fitSelected() {
    const t = terms.get(O.selectedId);
    if (t && t.opened && !$('dock').hidden) { try { t.fit.fit(); } catch { /* not laid out yet */ } }
  }

  // --------------------------------------------------------------- dock
  // the robot may not exist yet when it gets selected right after hiring, so this reruns on events
  function updateHeader() {
    const id = O.selectedId, a = O.agents.get(id);
    if (!id) return;
    $('dock-chip').style.background = a ? a.color : '#5b6878';
    $('dock-name').textContent = a ? a.name : id.slice(0, 8).toUpperCase();
  }

  // what the selected agent works on: card title plus the line about what it does right now
  let taskList = [];
  function updateTask() {
    const id = O.selectedId, el = $('dock-task');
    const t = id && taskList.find(x => x.session_id === id && x.status === 'progress');
    el.hidden = !t;
    if (!t) return;
    el.textContent = '';
    const b = document.createElement('b'); b.textContent = t.title;
    const d = document.createElement('span'); d.textContent = ' — ' + (t.doing || t.active || 'working');
    el.append(b, d);
  }

  function refreshDock() {
    const id = O.selectedId, dock = $('dock');
    if (!id) {
      dock.hidden = true;
      dropStaleTerms();
      return;
    }
    const managed = O.managed.has(id);
    updateHeader(); updateTask();
    $('dock-stop').hidden = !managed;
    $('dock-stop').disabled = false;
    $('dock-input').disabled = !managed;
    $('dock-form').querySelector('button').disabled = !managed;
    $('dock-ext').hidden = managed;
    $('dock-terms').hidden = !managed;

    for (const [sid, t] of terms) t.el.hidden = sid !== id;
    if (managed) {
      const t = getTerm(id);
      t.el.hidden = false;
      dock.hidden = false;
      if (!t.opened) { t.term.open(t.el); t.opened = true; }
    } else {
      dock.hidden = false;
    }

    requestAnimationFrame(fitSelected);
    dropStaleTerms();
  }
  O.onSelect = refreshDock;

  $('dock-close').addEventListener('click', () => O.select(null));
  $('dock-stop').addEventListener('click', () => {
    $('dock-stop').disabled = true;
    O.send({ type: 'kill_agent', session_id: O.selectedId });
  });
  $('dock-form').addEventListener('submit', ev => {
    ev.preventDefault();
    const input = $('dock-input'), sid = O.selectedId, text = input.value.trim();
    if (!text || !O.managed.has(sid)) return;
    // Claude's input treats text+Enter arriving together as a paste, so Enter goes separately.
    O.send({ type: 'send_input', session_id: sid, data: text });
    setTimeout(() => O.send({ type: 'send_input', session_id: sid, data: '\r' }), 60);
    input.value = '';
  });
  new ResizeObserver(fitSelected).observe($('dock-terms'));
  addEventListener('resize', fitSelected);

  // -------------------------------------------------------------- modal
  function openModal() {
    $('hire-cwd').value = store.get();
    $('hire-task').value = '';
    $('hire-error').textContent = '';
    $('hire').querySelector('[type=submit]').disabled = false;
    $('modal').hidden = false;
    $('hire-cwd').focus();
  }
  function closeModal() { $('modal').hidden = true; pendingHire = false; }

  $('hire-open').addEventListener('click', openModal);
  $('hire-cancel').addEventListener('click', closeModal);
  $('modal').addEventListener('mousedown', ev => { if (ev.target === $('modal')) closeModal(); });
  addEventListener('keydown', ev => {
    if (ev.key !== 'Escape') return;
    if (!$('modal').hidden) closeModal(); else if (O.selectedId) O.select(null);
  });
  $('hire').addEventListener('submit', ev => {
    ev.preventDefault();
    const cwd = $('hire-cwd').value.trim(), prompt = $('hire-task').value.trim();
    if (!cwd) return;
    store.set(cwd);
    pendingHire = true;
    $('hire-error').textContent = '';
    $('hire').querySelector('[type=submit]').disabled = true;
    O.send({ type: 'spawn_agent', cwd, role: $('hire-role').value, worktree: $('hire-wt').checked, ...(prompt && { prompt }) });
  });

  // ----------------------------------------------- server -> UI messages
  O.onMessage = msg => {
    switch (msg.type) {
      case 'snapshot':
        taskList = msg.tasks || []; updateTask();
        for (const a of msg.agents || []) {
          O.managed.add(a.session_id);
          const t = getTerm(a.session_id);
          if (a.buffer && !t.opened) t.term.write(a.buffer);
        }
        break;
      case 'event':
        if (msg.event.session_id === O.selectedId) updateHeader();
        break;
      case 'tasks':
        taskList = msg.tasks || []; updateTask();
        break;
      case 'agent_spawned':
        O.managed.add(msg.session_id);
        getTerm(msg.session_id);
        if (pendingHire) { closeModal(); O.select(msg.session_id); }
        break;
      case 'pty_output':
        getTerm(msg.session_id).term.write(msg.data);
        break;
      case 'agent_exit': {
        O.managed.delete(msg.session_id);
        const t = terms.get(msg.session_id);
        if (t) t.term.write('\r\n\x1b[2m[agent exited]\x1b[0m\r\n');
        if (msg.session_id === O.selectedId) {
          $('dock-stop').hidden = true;
          $('dock-input').disabled = true;
          $('dock-form').querySelector('button').disabled = true;
        }
        break;
      }
      case 'error':
        if (msg.request === 'spawn_agent' && pendingHire) {
          pendingHire = false;
          $('hire-error').textContent = msg.message;
          $('hire').querySelector('[type=submit]').disabled = false;
        }
        break;
    }
  };

  // ---------------------------------------- floating Allow / Deny buttons
  const rows = new Map();   // session_id -> element

  function answer(a, keys) {
    O.send({ type: 'send_input', session_id: a.id, data: keys });
    a.bubble = null;
  }

  function makeRow(a) {
    const row = document.createElement('div');
    row.className = 'act-row';
    for (const [label, cls, keys] of [['Allow', 'allow', ALLOW_KEYS], ['Deny', 'deny', DENY_KEYS]]) {
      const b = document.createElement('button');
      b.type = 'button'; b.className = 'act ' + cls; b.textContent = label;
      b.addEventListener('click', () => answer(a, keys));
      row.append(b);
    }
    $('actions').append(row);
    return row;
  }

  function placeActions() {
    const wanted = new Set();
    for (const a of O.agents.values()) {
      if (a.bubble !== 'alert' || a.leaving || !O.managed.has(a.id)) continue;
      wanted.add(a.id);
      let row = rows.get(a.id);
      if (!row) { row = makeRow(a); rows.set(a.id, row); }
      const p = O.screenAnchor(a);
      row.style.display = p.visible ? '' : 'none';
      row.style.left = p.x + 'px';
      row.style.top = Math.max(70, p.y - 62) + 'px';   // above tag and bubble
    }
    for (const [id, row] of rows) {
      if (!wanted.has(id)) { row.remove(); rows.delete(id); }
    }
    requestAnimationFrame(placeActions);
  }
  requestAnimationFrame(placeActions);
})();
