import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import pty from 'node-pty';
import { WebSocketServer, WebSocket } from 'ws';
import { PAGES, API } from '../public/js/routes.js';
import { stateOf } from '../public/js/states.js';
import { createTaskStore, STATUSES } from './tasks.js';

const PORT = 4111;
const HOSTS = ['127.0.0.1', '::1'];   // "localhost" can resolve to either; never listen on anything reachable from the network
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const MAX_AGENTS = 12;
const MAX_INPUT_BYTES = 10 * 1024;
// A page that can reach the WebSocket can spawn processes, so only our own origin may.
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]);
const SESSION_TTL_MS = 10 * 60 * 1000;
const SWEEP_INTERVAL_MS = 30 * 1000;
const DEMO_STEP_MS = 4000;

const rootDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const publicDir = path.join(rootDir, 'public');

const app = express();
const wss = new WebSocketServer({
  noServer: true,
  verifyClient: ({ origin }) => {
    if (!origin) return true; // non-browser clients (scripts, tests)
    try { return ALLOWED_HOSTS.has(new URL(origin).host); } catch { return false; }
  },
});

app.use(express.json({ limit: '1mb' }));
app.use(express.static(publicDir));
app.use('/vendor/xterm',express.static(path.join(rootDir, 'node_modules/@xterm/xterm')));
app.use('/vendor/xterm-fit', express.static(path.join(rootDir, 'node_modules/@xterm/addon-fit')));

// --- Session tracker -------------------------------------------------------

/** session_id -> { session_id, cwd, last_event, tool_name, started_at, last_seen } */
const sessions = new Map();

function broadcast(message) {
  const data = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(data);
  }
}

const taskStore = createTaskStore({
  file: path.join(rootDir, 'data', 'tasks.json'),
  onChange: () => broadcast({ type: 'tasks', ...taskStore.snapshot() }),
});

function trackSession(event) {
  const { session_id, hook_event_name, tool_name, cwd } = event;
  if (hook_event_name === 'SessionEnd') {
    sessions.delete(session_id);
    return;
  }
  const now = Date.now();
  const prev = sessions.get(session_id);
  sessions.set(session_id, {
    session_id,
    cwd: cwd ?? prev?.cwd ?? null,
    last_event: hook_event_name,
    state: stateOf(event) ?? prev?.state ?? 'working',
    tool_name: tool_name ?? null,
    started_at: prev?.started_at ?? now,
    last_seen: now,
  });
}

function ingest(event) {
  trackSession(event);
  taskStore.onEvent(event);
  broadcast({ type: 'event', event, sessions: [...sessions.values()] });
}

setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, s] of sessions) {
    if (s.last_seen < cutoff && !agentPtys.has(id)) {
      sessions.delete(id);
      const event = { session_id: id, hook_event_name: 'SessionEnd', reason: 'timeout', cwd: s.cwd };
      taskStore.onEvent(event);
      broadcast({ type: 'event', event, sessions: [...sessions.values()] });
    }
  }
}, SWEEP_INTERVAL_MS).unref();

// --- Agent manager (node-pty) ----------------------------------------------

/** session_id -> { term, cwd, buffer } for agents spawned from the game */
const agentPtys = new Map();
const BUFFER_CHARS = 64 * 1024; // scrollback replayed to clients that (re)connect

function isDirectory(p) {
  try { return statSync(p).isDirectory(); } catch { return false; }
}

function spawnAgent({ cwd, prompt }) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || !isDirectory(cwd)) {
    throw new Error('cwd must be an existing absolute directory');
  }
  if (prompt !== undefined && typeof prompt !== 'string') throw new Error('prompt must be a string');
  if (agentPtys.size >= MAX_AGENTS) throw new Error(`max ${MAX_AGENTS} agents`);

  // Claude Code reports this id in its hook payloads, so hooks and pty stay linked.
  const session_id = randomUUID();
  const args = ['--session-id', session_id];
  if (prompt) args.push(prompt);

  const term = pty.spawn(CLAUDE_BIN, args, {
    name: 'xterm-256color',
    cols: 100,
    rows: 30,
    cwd,
    env: process.env,
  });
  const agent = { term, cwd, buffer: '' };
  agentPtys.set(session_id, agent);

  term.onData((data) => {
    agent.buffer = (agent.buffer + data).slice(-BUFFER_CHARS);
    broadcast({ type: 'pty_output', session_id, data });
  });
  term.onExit(({ exitCode, signal }) => {
    agentPtys.delete(session_id);
    broadcast({ type: 'agent_exit', session_id, exitCode, signal });
    ingest({ session_id, hook_event_name: 'SessionEnd', cwd, reason: 'pty_exit' });
  });

  broadcast({ type: 'agent_spawned', session_id, cwd });
  ingest({ session_id, hook_event_name: 'SessionStart', cwd });
  return session_id;
}

const HANDLERS = {
  spawn_agent: (msg) => spawnAgent(msg),
  send_input(msg) {
    const agent = agentPtys.get(msg.session_id);
    if (!agent) throw new Error('unknown session_id');
    if (typeof msg.data !== 'string') throw new Error('data must be a string');
    if (Buffer.byteLength(msg.data) > MAX_INPUT_BYTES) throw new Error('data too large');
    agent.term.write(msg.data);
  },
  resize(msg) {
    const agent = agentPtys.get(msg.session_id);
    if (!agent) throw new Error('unknown session_id');
    const { cols, rows } = msg;
    if (!Number.isInteger(cols) || !Number.isInteger(rows) || cols < 20 || cols > 300 || rows < 5 || rows > 100) {
      throw new Error('invalid size');
    }
    agent.term.resize(cols, rows);
  },
  kill_agent(msg) {
    const agent = agentPtys.get(msg.session_id);
    if (!agent) throw new Error('unknown session_id');
    agent.term.kill(); // onExit cleans up and announces
  },
};

wss.on('connection', (ws) => {
  ws.send(JSON.stringify({
    type: 'snapshot',
    sessions: [...sessions.values()],
    ...taskStore.snapshot(),
    agents: [...agentPtys].map(([session_id, a]) => ({ session_id, cwd: a.cwd, buffer: a.buffer })),
  }));

  ws.on('message', (raw) => {
    let msg;
    try { msg = JSON.parse(raw); } catch { return; }
    const handler = Object.hasOwn(HANDLERS, msg?.type) ? HANDLERS[msg.type] : null;
    if (!handler) return;
    try {
      handler(msg);
    } catch (err) {
      ws.send(JSON.stringify({ type: 'error', request: msg.type, session_id: msg.session_id, message: err.message }));
    }
  });
});

function shutdown() {
  taskStore.flush();
  for (const { term } of agentPtys.values()) term.kill();
  process.exit(0);
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);

// --- Routes ----------------------------------------------------------------

app.post('/event', (req, res) => {
  const { session_id, hook_event_name } = req.body ?? {};
  if (typeof session_id !== 'string' || typeof hook_event_name !== 'string') {
    return res.status(400).json({ error: 'session_id and hook_event_name required' });
  }
  ingest(req.body);
  res.json({ ok: true });
});

app.get('/sessions', (_req, res) => {
  res.json([...sessions.values()]);
});

// Pages come from the shared route table; API calls from the browser must come from our own origin.
for (const page of PAGES) {
  if (page.path !== '/') app.get(page.path, (_req, res) => res.sendFile(path.join(publicDir, page.file)));
}

function sameOrigin(req, res, next) {
  const { origin } = req.headers;
  try { if (!origin || ALLOWED_HOSTS.has(new URL(origin).host)) return next(); } catch { /* fall through */ }
  res.status(403).json({ error: 'forbidden origin' });
}

app.get(API.tasks, (_req, res) => res.json({ statuses: STATUSES, ...taskStore.snapshot() }));
app.post(API.taskStatus, sameOrigin, (req, res) => {
  const result = taskStore.setStatus(req.params.id, req.body?.status);
  res.status(result.code ?? 200).json(result);
});
app.delete(API.task, sameOrigin, (req, res) => {
  if (!taskStore.remove(req.params.id)) return res.status(404).json({ error: 'unknown task' });
  res.json({ ok: true });
});

// --- Demo ------------------------------------------------------------------

const DEMO_AGENTS = [
  { session_id: 'demo-agent-1', cwd: '/demo/alpha' },
  { session_id: 'demo-agent-2', cwd: '/demo/beta' },
  { session_id: 'demo-agent-3', cwd: '/demo/gamma' },
];

// What the demo agents put on their todo list; `n` is the lap, so every lap creates fresh cards.
const demoTodos = (name, n, done, doing) => ({
  hook_event_name: 'PreToolUse', tool_name: 'TodoWrite',
  tool_input: { todos: [
    { content: `${name}: read the code (${n})`, status: done >= 1 ? 'completed' : doing === 0 ? 'in_progress' : 'pending', activeForm: 'Reading the code' },
    { content: `${name}: implement change (${n})`, status: done >= 2 ? 'completed' : doing === 1 ? 'in_progress' : 'pending', activeForm: 'Implementing the change' },
    { content: `${name}: run the tests (${n})`, status: doing === 2 ? 'in_progress' : 'pending', activeForm: 'Running the tests' },
  ] },
});
const DEMO_STEPS = [
  { hook_event_name: 'SessionStart' },
  (a, n) => demoTodos(a, n, 0, 0),
  { hook_event_name: 'PreToolUse', tool_name: 'Read', tool_input: { file_path: 'src/main.js' } },
  (a, n) => demoTodos(a, n, 1, 1),
  { hook_event_name: 'PreToolUse', tool_name: 'Task', tool_input: { description: 'Review src/main.js' } },
  { hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: 'src/main.js', old_string: 'a', new_string: 'b' } },
  { hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_input: { command: 'npm test' } },
  { hook_event_name: 'SubagentStop' },
  (a, n) => demoTodos(a, n, 2, 2),
  { hook_event_name: 'Notification', message: 'Claude needs your permission' },
  { hook_event_name: 'Stop' },
];

let demoTimers = [];

function startDemo() {
  demoTimers.forEach(clearInterval);
  taskStore.clearDemo();
  demoTimers = DEMO_AGENTS.map((agent, i) => {
    let step = 0, lap = 1;
    const tick = () => {
      const s = DEMO_STEPS[step];
      ingest({ ...agent, ...(typeof s === 'function' ? s(path.basename(agent.cwd).toUpperCase(), lap) : s) });
      if (++step === DEMO_STEPS.length) { step = 0; lap++; }
    };
    // Stagger agents so they don't move in lockstep.
    const timer = setTimeout(() => {
      tick();
      demoTimers[i] = setInterval(tick, DEMO_STEP_MS);
    }, i * (DEMO_STEP_MS / DEMO_AGENTS.length));
    return timer;
  });
}

app.post(API.demo, (_req, res) => {
  startDemo();
  res.json({ ok: true, agents: DEMO_AGENTS.map((a) => a.session_id) });
});

// ---------------------------------------------------------------------------

taskStore.clearDemo();   // fake cards from an earlier demo run are clutter after a restart

// one HTTP server per loopback address, all sharing the app and the WebSocket server
for (const host of HOSTS) {
  const server = createServer(app);
  server.on('upgrade', (req, socket, head) => {
    if (new URL(req.url, 'http://localhost').pathname !== API.ws) return socket.destroy();
    wss.handleUpgrade(req, socket, head, (ws) => wss.emit('connection', ws, req));
  });
  server.on('error', (err) => {
    if (host === '::1') console.warn(`no IPv6 loopback (${err.code}); only http://127.0.0.1:${PORT} works`);
    else { console.error(err.message); process.exit(1); }
  });
  server.listen(PORT, host, () => console.log(`http://${host.includes(':') ? `[${host}]` : host}:${PORT}`));
}
console.log(`open http://localhost:${PORT}`);
