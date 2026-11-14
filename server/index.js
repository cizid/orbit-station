import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import express from 'express';
import pty from 'node-pty';
import { WebSocketServer, WebSocket } from 'ws';
import { PAGES, API } from '../public/js/routes.js';
import { stateOf, effectiveState } from '../public/js/states.js';
import { createTaskStore, STATUSES } from './tasks.js';
import { createTraceStore } from './trace.js';
import { createGuardrails } from './guardrails.js';
import { createPricing } from './prices.js';
import { resolveTranscript, readUsage } from './transcript.js';
import { createVerifier } from './verifier.js';
import { createSettings } from './settings.js';
import { createJudge } from './judge.js';
import { createFeed } from './feed.js';
import { createProjects } from './projects.js';
import { createConflicts } from './conflicts.js';
import { repoInfo } from './git.js';
import { ROLES } from '../public/js/roles.js';

const PORT = 4111;
const HOSTS = ['127.0.0.1', '::1'];   // "localhost" can resolve to either; never listen on anything reachable from the network
const CLAUDE_BIN = process.env.CLAUDE_BIN || 'claude';
const MAX_AGENTS = 20;
const MAX_INPUT_BYTES = 10 * 1024;
// A page that can reach the WebSocket can spawn processes, so only our own origin may.
const ALLOWED_HOSTS = new Set([`localhost:${PORT}`, `127.0.0.1:${PORT}`, `[::1]:${PORT}`]);
const SESSION_TTL_MS = 10 * 60 * 1000;
const SWEEP_INTERVAL_MS = 30 * 1000;
const DEMO_STEP_MS = 9000;

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
app.use(express.static(publicDir, { index: false }));
// '/' is a thin shell holding the page in an iframe, so fullscreen survives when you switch pages
app.get('/', (_req, res) => res.sendFile(path.join(publicDir, 'shell.html')));
app.use('/vendor/three', express.static(path.join(rootDir, 'node_modules/three')));
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

// --- Tracing, metrics, guardrails --------------------------------------------

const pricing = createPricing(path.join(rootDir, 'data', 'prices.json'));
const traceStore = createTraceStore({ pricing });
const guard = createGuardrails({ trace: traceStore, onAlert: (alert) => broadcast({ type: 'alert', alert }) });

// debounce so a burst of events costs one message
function throttled(fn, ms) {
  let timer = null;
  return () => { if (!timer) timer = setTimeout(() => { timer = null; fn(); }, ms).unref(); };
}
const pingTrace = throttled(() => broadcast({ type: 'trace' }), 400);
const pingMetrics = throttled(() => { const m = traceStore.metrics(); broadcast({ type: 'metrics', heat: m.heat, totals: m.totals }); }, 2000);

// token usage lives in the transcripts the hooks point to; read what was appended since last time
const lastUsageRead = new Map();
function readTranscripts(sid, force) {
  const s = traceStore.raw(sid);
  if (!s || (!force && Date.now() - (lastUsageRead.get(sid) ?? 0) < 5000)) return;
  lastUsageRead.set(sid, Date.now());
  for (const [key, file] of Object.entries(s.paths)) {
    if (key === 'offsets' || typeof file !== 'string') continue;
    const real = resolveTranscript(file);
    if (!real) continue;
    try {
      const own = key === 'main' ? sid : key;
      const prev = s.paths.offsets[key] ?? { offset: 0, prevTs: null };
      const { requests, offset, prevTs } = readUsage(real, prev.offset, { skipSidechain: key === 'main', prevTs: prev.prevTs });
      s.paths.offsets[key] = { offset, prevTs };
      traceStore.addUsage(sid, own, requests);
    } catch { /* transcript not readable right now */ }
  }
}

const settings = createSettings({ file: path.join(rootDir, 'data', 'settings.json') });
const judge = createJudge({ trace: traceStore, settings, guard, bin: CLAUDE_BIN, onJudged: () => broadcast({ type: 'trace' }) });
const feed = createFeed();
const projects = createProjects({ file: path.join(rootDir, 'data', 'projects.json') });
const conflicts = createConflicts({ projects, guard });
const spawnMeta = new Map();                 // session_id -> { role, name, worktree } chosen when the agent was hired
const quota = { plan: null, at: 0, sessions: new Map() };   // from the status line: plan limits are account-wide
const pingAgents = throttled(() => broadcast({ type: 'agents' }), 400);
const verifier = createVerifier({ trace: traceStore, guard, file: path.join(rootDir, 'data', 'baseline.json') });

// who works where: project, branch, role. Runs after the event was handled; never blocks it.
async function track(event) {
  const { session_id: sid, cwd } = event;
  if (typeof cwd !== 'string' || !cwd) return;
  try {
    const info = await repoInfo(cwd), meta = spawnMeta.get(sid);
    const a = projects.register({ sid, cwd, info, managed: agentPtys.has(sid), role: meta?.role, name: meta?.name, worktree: meta?.worktree });
    if (event.hook_event_name === 'SessionEnd') {
      const v = traceStore.view(sid), t = v?.agents.reduce((n, x) => ({ in: n.in + x.tokens.in, out: n.out + x.tokens.out }), { in: 0, out: 0 });
      projects.finish(sid, { cost: v?.cost ?? 0, tokens: t ? t.in + t.out : 0 });
      spawnMeta.delete(sid);
    } else {
      const p = projects.project(a.root), spent = projectCostToday(a.root);
      if (p.budgetUsd != null && spent >= p.budgetUsd) guard.raise(sid, sid, 'budget', 'crit', `Project ${p.name} spent about $${spent.toFixed(2)} today (budget $${p.budgetUsd})`);
    }
    await conflicts.onEvent(event);
  } catch { /* tracking is best effort */ }
  pingAgents();
}
const sameDay = (a, b) => new Date(a).toDateString() === new Date(b).toDateString();
function projectCostToday(root) {
  let sum = 0;
  for (const a of projects.agents()) if (a.root === root) { const v = traceStore.view(a.sid); if (v && sameDay(v.started, Date.now())) sum += v.cost; }
  return sum;
}

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
    role: event.role ?? prev?.role,
    last_seen: now,
  });
}

function ingest(event) {
  trackSession(event);
  taskStore.onEvent({ ...event, role: event.role ?? projects.get(event.session_id)?.role });
  const lines = feed.onEvent(event);
  if (lines.length) broadcast({ type: 'feed', session_id: event.session_id, lines });
  track(event);
  const traced = traceStore.onEvent(event);
  verifier.onEvent(event);
  judge.maybeAuto(event);
  if (traced) {
    const name = event.hook_event_name;
    readTranscripts(event.session_id, name === 'Stop' || name === 'SubagentStop' || name === 'SessionEnd');
    if (name === 'Stop') setTimeout(() => readTranscripts(event.session_id, true), 3000).unref();   // interactive sessions flush the transcript a moment later
    guard.check(event.session_id);
    pingTrace(); pingMetrics();
  }
  const known = projects.get(event.session_id);
  broadcast({ type: 'event', event: known ? { ...event, project: path.basename(known.root), role: event.role ?? known.role } : { ...event, role: event.role }, sessions: withRoles() });
}

// sessions as the station view needs them: with the role each agent was given
const withRoles = () => [...sessions.values()].map(s => ({ ...s, role: s.role ?? projects.get(s.session_id)?.role }));

setInterval(() => {
  const cutoff = Date.now() - SESSION_TTL_MS;
  for (const [id, s] of sessions) {
    if (s.last_seen < cutoff && !agentPtys.has(id)) {
      sessions.delete(id);
      const event = { session_id: id, hook_event_name: 'SessionEnd', reason: 'timeout', cwd: s.cwd };
      taskStore.onEvent(event); traceStore.onEvent(event); projects.finish(id, { cost: traceStore.view(id)?.cost ?? 0 });
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

// Hired agents report through hooks and the status line that we hand them on the command line, so they
// show up fully (feed, trace, quota) whatever the user has in their own settings.
const HOOK_EVENTS = ['SessionStart', 'UserPromptSubmit', 'PreToolUse', 'PostToolUse', 'PostToolUseFailure', 'Stop', 'SessionEnd', 'Notification', 'SubagentStart', 'SubagentStop'];
const hookCommand = `curl -s -m 3 -XPOST http://127.0.0.1:${PORT}/event -H 'content-type: application/json' -H 'x-orbit-src: managed' -d @-`;
const agentSettings = () => JSON.stringify({
  hooks: Object.fromEntries(HOOK_EVENTS.map(e => [e, [{ matcher: e.includes('ToolUse') ? '*' : '', hooks: [{ type: 'command', command: hookCommand }] }]])),
  statusLine: { type: 'command', command: `ORBIT_MANAGED=1 node ${path.join(rootDir, 'scripts', 'statusline.mjs')}` },
});

// the child must not inherit another Claude Code session's markers (they switch off transcript saving).
// User configuration such as provider or token variables is left alone.
const SESSION_MARKERS = ['CLAUDECODE', 'CLAUDE_PID', 'CLAUDE_EFFORT', 'CLAUDE_CODE_CHILD_SESSION', 'CLAUDE_CODE_SESSION_ID', 'CLAUDE_CODE_SESSION_ATTENDED', 'CLAUDE_CODE_ENTRYPOINT', 'CLAUDE_CODE_EXECPATH', 'CLAUDE_CODE_MESSAGING_SOCKET', 'CLAUDE_CODE_MESSAGING_TOKEN'];
function agentEnv(role) {
  const env = { ...process.env, ORBIT_ROLE: role };
  for (const k of SESSION_MARKERS) delete env[k];
  return env;
}

function spawnAgent({ cwd, prompt, role = 'none', worktree = false, name }) {
  if (typeof cwd !== 'string' || !path.isAbsolute(cwd) || !isDirectory(cwd)) {
    throw new Error('cwd must be an existing absolute directory');
  }
  if (prompt !== undefined && typeof prompt !== 'string') throw new Error('prompt must be a string');
  if (!ROLES[role]) throw new Error('unknown role');
  if (typeof worktree !== 'boolean') throw new Error('worktree must be true or false');
  if (agentPtys.size >= MAX_AGENTS) throw new Error(`max ${MAX_AGENTS} agents`);

  // Claude Code reports this id in its hook payloads, so hooks and pty stay linked.
  const session_id = randomUUID();
  const args = ['--session-id', session_id, '--settings', agentSettings()];
  if (ROLES[role].prompt) args.push('--append-system-prompt', ROLES[role].prompt);
  if (worktree) args.push('--worktree', `orbit-${role}-${session_id.slice(0, 4)}`);
  if (prompt) args.push(prompt);
  spawnMeta.set(session_id, { role, worktree, name: typeof name === 'string' ? name.slice(0, 40) : undefined });

  const term = pty.spawn(CLAUDE_BIN, args, {
    name: 'xterm-256color',
    cols: 100,
    rows: 30,
    cwd,
    env: agentEnv(role),
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
    sessions: withRoles(),
    ...taskStore.snapshot(),
    alerts: guard.active(),
    heat: traceStore.metrics().heat,
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
  taskStore.flush(); verifier.flush(); projects.flush();
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
  // a hired agent reports through the hooks we gave it; the same events from the user's own hooks would be doubles
  if (agentPtys.has(session_id) && req.headers['x-orbit-src'] !== 'managed') return res.json({ ok: true, duplicate: true });
  ingest(req.body);
  res.json({ ok: true });
});

app.get('/sessions', (_req, res) => {
  res.json([...sessions.values()]);
});

// Pages come from the shared route table; API calls from the browser must come from our own origin.
for (const page of PAGES) {
  app.get(page.path, (_req, res) => res.sendFile(path.join(publicDir, page.file)));
}

function sameOrigin(req, res, next) {
  const { origin } = req.headers;
  try { if (!origin || ALLOWED_HOSTS.has(new URL(origin).host)) return next(); } catch { /* fall through */ }
  res.status(403).json({ error: 'forbidden origin' });
}

app.get(API.trace, (req, res) => {
  const list = traceStore.list(), sid = typeof req.query.sid === 'string' ? req.query.sid : list[0]?.sid;
  res.json({ sessions: list, trace: sid ? traceStore.view(sid) : null, alerts: guard.active() });
});
app.get(API.metrics, (_req, res) => res.json({ ...traceStore.metrics(), alerts: guard.active(), pricing_note: 'Costs are estimates from token counts; exact prices go in data/prices.json.' }));
app.get(API.settings, (_req, res) => res.json(settings.get()));
app.post(API.settings, sameOrigin, (req, res) => {
  const r = settings.update(req.body);
  res.status(r.error ? 400 : 200).json(r.error ? r : settings.get());
});
// check one finished turn with the AI judge (only when the judge is on)
app.post(API.judge, sameOrigin, async (req, res) => {
  const { sid, turn } = req.body ?? {};
  if (typeof sid !== 'string' || typeof turn !== 'string') return res.status(400).json({ error: 'sid and turn required' });
  const r = await judge.judgeTurn(sid, turn);
  res.status(r.code ?? 200).json(r);
});
// --- Agents, projects, quota -------------------------------------------------

app.post('/api/statusline', express.json({ limit: '64kb' }), (req, res) => {
  const j = req.body ?? {}, pct = x => (Number.isFinite(x?.used_percentage) ? { pct: x.used_percentage, resets_at: Number.isFinite(x.resets_at) ? x.resets_at : null } : null);
  if (typeof j.session_id === 'string') quota.sessions.set(j.session_id, { at: Date.now(), cost: Number(j.cost?.total_cost_usd) || 0, ctx: Number.isFinite(j.context_window?.used_percentage) ? j.context_window.used_percentage : null, model: String(j.model?.display_name ?? '').slice(0, 40) });
  if (quota.sessions.size > 200) quota.sessions.delete(quota.sessions.keys().next().value);
  const five = pct(j.rate_limits?.five_hour), week = pct(j.rate_limits?.seven_day);
  if (five || week) { quota.plan = { five_hour: five, seven_day: week }; quota.at = Date.now(); broadcast({ type: 'quota', plan: quota.plan, at: quota.at }); }
  res.json({ ok: true });
});

function agentsView() {
  const at = Date.now();
  const list = projects.agents().map(a => {
    const sess = sessions.get(a.sid), v = traceStore.view(a.sid), q = quota.sessions.get(a.sid);
    const tokens = v ? v.agents.reduce((n, x) => n + x.tokens.in + x.tokens.out, 0) : 0;
    return { ...a, state: a.ended ? 'offline' : sess ? effectiveState(sess.state, sess.last_seen, at) : 'offline', last_seen: sess?.last_seen ?? a.ended ?? a.started,
      cost: v?.cost ?? 0, tokens, ctx: q?.ctx ?? null, feed: feed.tail(a.sid, 14), alerts: guard.active().filter(x => x.sid === a.sid).length };
  });
  const byRoot = Object.fromEntries(projects.projects().map(p => [p.root, p]));
  return {
    agents: list,
    projects: projects.projects().map(p => ({ ...p, history: p.history.slice(0, 15), active: list.filter(a => a.root === p.root && !a.ended).length, cost_today: projectCostToday(p.root) })),
    quota: { plan: quota.plan, at: quota.at }, alerts: guard.active(),
    max_agents: MAX_AGENTS, managed: [...agentPtys.keys()], roles: Object.fromEntries(Object.entries(ROLES).map(([k, r]) => [k, { label: r.label, color: r.color }])),
    unknown_project_roots: list.filter(a => !byRoot[a.root]).length,
  };
}
app.get('/api/agents', (_req, res) => res.json(agentsView()));
app.post('/api/agents/:sid/role', sameOrigin, (req, res) => {
  const r = projects.setRole(req.params.sid, req.body?.role);
  if (r.ok) pingAgents();
  res.status(r.code ?? 200).json(r);
});
app.post('/api/projects/config', sameOrigin, (req, res) => {
  const { root, ...patch } = req.body ?? {};
  const r = typeof root === 'string' ? projects.setConfig(root, patch) : { error: 'root required', code: 400 };
  if (r.ok) pingAgents();
  res.status(r.code ?? 200).json(r);
});

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
  { session_id: 'demo-agent-1', cwd: '/demo/coordinator', role: 'coordinator' },
  { session_id: 'demo-agent-2', cwd: '/demo/planner', role: 'planner' },
  { session_id: 'demo-agent-3', cwd: '/demo/coder', role: 'coder' },
  { session_id: 'demo-agent-4', cwd: '/demo/qa', role: 'qa' },
  { session_id: 'demo-agent-5', cwd: '/demo/devops', role: 'devops' },
];

// What the demo agents put on their todo list; `n` is the lap, so every lap creates fresh cards.
const demoTodos = (name, n, done, doing) => ({
  hook_event_name: 'PreToolUse', tool_name: 'TodoWrite',
  tool_input: { todos: [
    { content: `Read the code (${n})`, status: done >= 1 ? 'completed' : doing === 0 ? 'in_progress' : 'pending', activeForm: 'Reading the code' },
    { content: `Implement the change (${n})`, status: done >= 2 ? 'completed' : doing === 1 ? 'in_progress' : 'pending', activeForm: 'Implementing the change' },
    { content: `Run the tests (${n})`, status: doing === 2 ? 'in_progress' : 'pending', activeForm: 'Running the tests' },
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
  { hook_event_name: 'SubagentStop', agent_id: 'demo-sub' },
  (a, n) => demoTodos(a, n, 2, 2),
  { hook_event_name: 'Notification', message: 'Claude needs your permission' },
  { hook_event_name: 'Stop' },
];

let demoTimers = [];

function startDemo() {
  demoTimers.forEach(clearInterval);
  taskStore.clearDemo(); traceStore.clearDemo();
  demoTimers = DEMO_AGENTS.map((agent, i) => {
    let step = 0, lap = 1, subId = null, seq = 0, taskPost = null;
    const tick = () => {
      const s = DEMO_STEPS[step];
      const ev = { ...agent, ...(typeof s === 'function' ? s(path.basename(agent.cwd).toUpperCase(), lap) : s) };
      if (subId && ev.hook_event_name === 'PreToolUse' && ev.tool_name !== 'Task') ev.agent_id = subId;   // subagent's own calls
      if (ev.hook_event_name === 'PreToolUse') {
        ev.tool_use_id = `${agent.session_id}-${lap}-${++seq}`;
        const ms = 200 + Math.round(Math.random() * 1800), who = ev.agent_id ?? agent.session_id, id = ev.tool_use_id, tool = ev.tool_name;
        const post = () => ingest({ ...agent, hook_event_name: 'PostToolUse', tool_name: tool, tool_use_id: id, duration_ms: ms, ...(ev.agent_id ? { agent_id: ev.agent_id } : {}) });
        if (tool === 'Task') taskPost = post;          // like the real thing: a Task call only ends when its subagent is done
        else setTimeout(post, Math.min(ms, 1500));
        // made-up token usage so the metrics page has something to show in the demo
        traceStore.addUsage(agent.session_id, who, [{ id: `u-${id}`, model: 'claude-sonnet-5-5', in: 800 + Math.round(Math.random() * 3000), out: 100 + Math.round(Math.random() * 700), cr: 4000, cc: 0, latency_ms: 600 + Math.round(Math.random() * 2500) }]);
      }
      if (ev.hook_event_name === 'SubagentStop' && subId) ev.agent_id = subId;
      ingest(ev);
      if (ev.hook_event_name === 'PreToolUse' && ev.tool_name === 'Task') { subId = `${agent.session_id}-sub${lap}`; ingest({ ...agent, hook_event_name: 'SubagentStart', agent_id: subId, agent_type: 'general-purpose' }); }
      if (ev.hook_event_name === 'SubagentStop') { subId = null; if (taskPost) { const p = taskPost; taskPost = null; setTimeout(p, 300); } }
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
