import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, renameSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { isTask, projectName } from '../public/js/states.js';
import { ROLES } from '../public/js/roles.js';

// Task board. Cards come from Claude's own todo list (TodoWrite hook calls) and move on their own:
//   todo pending -> Backlog      todo in_progress -> In Progress
//   todo completed, or the agent stops -> Review      (a human accepts -> Done, or rejects -> Backlog)
// Each time a card enters In Progress a "handler" record starts for that agent; tool calls, questions
// and errors are counted on it, so you can see who did what and how it went.

export const STATUSES = ['backlog', 'progress', 'review', 'done'];
const TODO_STATUS = { pending: 'backlog', in_progress: 'progress', completed: 'review' };
const MANUAL = { review: ['done', 'backlog'], done: ['review'] };   // moves a person may make
const MAX_TASKS = 500, MAX_TODOS = 50, MAX_TEXT = 160;

const clip = s => String(s).trim().slice(0, MAX_TEXT);
const taskId = (cwd, content) => createHash('sha1').update(`${cwd}\0${content}`).digest('hex').slice(0, 12);
// id of a task just created, from whatever shape the tool response has (object, or text like "Task #3 created")
const createdId = r => {
  const v = r && typeof r === 'object' ? r.id ?? r.taskId ?? r.task?.id : String(r ?? '').match(/#?(\d+)/)?.[1];
  return v == null ? null : String(v);
};
// an agent is called by what it is: its role. Without a role: project and a short id.
const agentName = (sid, cwd, role) => role && role !== 'none' && ROLES[role] ? ROLES[role].label : `${projectName(cwd) || 'AGENT'}·${sid.slice(0, 4)}`;

// one short line about what a tool call does, shown on the card while the agent works on it
const base = p => String(p ?? '').split(/[\\/]/).pop();
const one = (s, n = 70) => String(s ?? '').replace(/\s+/g, ' ').trim().slice(0, n);
export function describeTool(name, input = {}) {
  switch (name) {
    case 'Edit': case 'MultiEdit': return `Editing ${base(input.file_path)}`;
    case 'Write': return `Writing ${base(input.file_path)}`;
    case 'NotebookEdit': return `Editing ${base(input.notebook_path)}`;
    case 'Read': return `Reading ${base(input.file_path)}`;
    case 'Grep': return `Searching for "${one(input.pattern, 40)}"`;
    case 'Glob': case 'LS': return `Looking for files ${one(input.pattern ?? input.path, 40)}`.trim();
    case 'Bash': return `Running ${one(input.command)}`;
    case 'WebSearch': return `Searching the web: ${one(input.query, 50)}`;
    case 'WebFetch': return `Fetching ${one(input.url, 50)}`;
    case 'Task': case 'Agent': return `Delegating: ${one(input.description ?? input.prompt, 60)}`;
    default: return name ? one(name, 40) : '';
  }
}

export function createTaskStore({ file = null, onChange = () => {}, now = Date.now } = {}) {
  const tasks = new Map();
  const sessions = new Map();     // session_id -> { cwd, blocked_since }
  let saveTimer = null;

  try {
    for (const t of JSON.parse(readFileSync(file, 'utf8')).tasks ?? []) {
      if (t && typeof t.id === 'string' && STATUSES.includes(t.status) && Array.isArray(t.handlers)) tasks.set(t.id, t);
    }
  } catch { /* first run or unreadable file: start empty */ }

  function flush() {
    clearTimeout(saveTimer); saveTimer = null;
    if (!file) return;
    try {
      mkdirSync(path.dirname(file), { recursive: true });
      const tmp = `${file}.tmp`;
      writeFileSync(tmp, JSON.stringify({ version: 1, tasks: [...tasks.values()] }));
      renameSync(tmp, file);
    } catch (err) { console.error('tasks: save failed:', err.message); }
  }
  function changed() {
    if (!saveTimer) { saveTimer = setTimeout(flush, 250); saveTimer.unref?.(); }
    onChange();
  }

  function trim() {
    while (tasks.size > MAX_TASKS) {
      const old = [...tasks.values()].sort((a, b) => (a.status === 'done' ? 0 : 1) - (b.status === 'done' ? 0 : 1) || a.updated_at - b.updated_at)[0];
      tasks.delete(old.id);
    }
  }

  const open = t => t.handlers.at(-1);   // handler record of the current/last owner

  function moveTo(t, status, sid, at) {
    if (t.status === status) return false;
    const h = open(t);
    if (t.status === 'progress' && h && h.to == null) h.to = at;
    if (status === 'progress') {
      t.started_at ??= at;
      t.session_id = sid;
      t.agent = agentName(sid, t.cwd, sessions.get(sid)?.role);
      t.handlers.push({ session_id: sid, agent: t.agent, from: at, to: null, tools: 0, handoffs: 0, asks: 0, errors: 0, waiting_ms: 0 });
    }
    if (status !== 'progress') t.doing = null;
    if (status === 'review') { t.review_at = at; t.delivered_by = sid ?? t.session_id; }
    if (status === 'done') t.done_at = at;
    t.status = status; t.updated_at = at;
    return true;
  }

  function applyTodos(sid, cwd, todos, at) {
    let any = false;
    const p = sessions.get(sid)?.promptTask;     // a real todo list replaces the stand-in prompt card
    if (p && tasks.get(p)?.status === 'progress' && todos.length) { tasks.delete(p); sessions.get(sid).promptTask = null; any = true; }
    for (const td of todos.slice(0, MAX_TODOS)) {
      const target = TODO_STATUS[td?.status];
      if (!target || typeof td.content !== 'string' || !td.content.trim()) continue;
      const id = taskId(cwd, clip(td.content));
      let t = tasks.get(id);
      if (!t) {
        t = { id, cwd, project: projectName(cwd), title: clip(td.content), status: 'backlog', session_id: sid, agent: agentName(sid, cwd, sessions.get(sid)?.role),
          created_at: at, updated_at: at, started_at: null, review_at: null, done_at: null, delivered_by: null, rejections: 0,
          demo: sid.startsWith('demo-'), handlers: [] };
        tasks.set(id, t); any = true;
      }
      if (typeof td.activeForm === 'string' && td.activeForm.trim()) t.active = clip(td.activeForm);
      if (t.status === 'done') continue;     // a person accepted it; the agent's list doesn't undo that
      any = moveTo(t, target, sid, at) || any;
    }
    if (any) trim();
    return any;
  }

  // ---- hook events in
  function onEvent(ev) {
    const sid = ev?.session_id, name = ev?.hook_event_name;
    if (typeof sid !== 'string' || typeof name !== 'string') return;
    const at = now();
    const s = sessions.get(sid) ?? {};
    sessions.set(sid, s);
    if (typeof ev.cwd === 'string' && ev.cwd) s.cwd = ev.cwd;
    if (typeof ev.role === 'string') s.role = ev.role;
    const mine = () => [...tasks.values()].filter(t => t.status === 'progress' && t.session_id === sid);
    let dirty = false;

    if (name !== 'Notification' && s.blocked_since) {     // the agent is moving again: the wait is over
      for (const t of mine()) open(t).waiting_ms += at - s.blocked_since;
      s.blocked_since = null; dirty = true;
    }
    switch (name) {
      case 'UserPromptSubmit': {    // fallback for sessions without a todo tool: the prompt itself is the card
        const prompt = typeof ev.prompt === 'string' ? ev.prompt.trim() : '';
        if (!prompt) break;
        const id = taskId(s.cwd ?? '', `${prompt}\0${at}`);
        const t = { id, cwd: s.cwd ?? '', project: projectName(s.cwd), title: clip(prompt), status: 'backlog', session_id: sid, agent: agentName(sid, s.cwd ?? '', s.role),
          created_at: at, updated_at: at, started_at: null, review_at: null, done_at: null, delivered_by: null, rejections: 0,
          demo: sid.startsWith('demo-'), source: 'prompt', handlers: [] };
        tasks.set(id, t); s.promptTask = id;
        moveTo(t, 'progress', sid, at); trim(); dirty = true;
        break;
      }
      case 'PreToolUse':
        if (ev.tool_name === 'TodoWrite') {
          const todos = ev.tool_input?.todos;
          if (Array.isArray(todos)) dirty = applyTodos(sid, s.cwd ?? '', todos, at) || dirty;
        } else if (ev.tool_name === 'TaskCreate') {
          const { subject, activeForm } = ev.tool_input ?? {};
          if (typeof subject === 'string') dirty = applyTodos(sid, s.cwd ?? '', [{ content: subject, status: 'pending', activeForm }], at) || dirty;
        } else if (ev.tool_name === 'TaskUpdate') {
          const t = tasks.get(s.ids?.get(String(ev.tool_input?.taskId)));
          const target = TODO_STATUS[ev.tool_input?.status];
          if (t && target && t.status !== 'done') dirty = moveTo(t, target, sid, at) || dirty;
        } else {
          const what = describeTool(ev.tool_name, ev.tool_input), line = ev.agent_id && !isTask(ev.tool_name) ? `Helper: ${what}` : what;
          for (const t of mine()) { open(t).tools++; if (isTask(ev.tool_name)) open(t).handoffs++; if (what) t.doing = line; dirty = true; }
        }
        break;
      case 'PostToolUse':   // newer Claude Code versions: TaskCreate hands out ids that TaskUpdate refers to
        if (ev.tool_name === 'TaskCreate' && typeof ev.tool_input?.subject === 'string') {
          const n = createdId(ev.tool_response);
          if (n) (s.ids ??= new Map()).set(n, taskId(s.cwd ?? '', clip(ev.tool_input.subject)));
        }
        break;
      case 'PostToolUseFailure':
        for (const t of mine()) { open(t).errors++; dirty = true; }
        break;
      case 'Notification':
        for (const t of mine()) { open(t).asks++; dirty = true; }
        s.blocked_since ??= at;
        break;
      case 'Stop':
        for (const t of mine()) dirty = moveTo(t, 'review', sid, at) || dirty;
        break;
      case 'SessionEnd':     // unfinished work goes back to the pile
        for (const t of mine()) { open(t).interrupted = true; dirty = moveTo(t, 'backlog', sid, at) || dirty; }
        sessions.delete(sid);
        break;
    }
    if (dirty) changed();
  }

  // ---- people
  function setStatus(id, status) {
    const t = tasks.get(id);
    if (!t) return { error: 'unknown task', code: 404 };
    if (!MANUAL[t.status]?.includes(status)) return { error: `cannot move ${t.status} -> ${status}`, code: 400 };
    if (t.status === 'review' && status === 'backlog') t.rejections++;
    moveTo(t, status, null, now());
    changed();
    return { ok: true };
  }
  function remove(id) {
    if (!tasks.delete(id)) return false;
    changed();
    return true;
  }
  function clearDemo() {
    let n = 0;
    for (const [id, t] of tasks) if (t.demo && tasks.delete(id)) n++;
    if (n) changed();
  }

  // ---- views
  function list() {
    const at = now();
    return [...tasks.values()].map(t => {
      let work = 0, tools = 0, asks = 0, errors = 0, handoffs = 0, waiting = 0;
      for (const h of t.handlers) {
        work += (h.to ?? at) - h.from; waiting += h.waiting_ms; tools += h.tools; asks += h.asks; errors += h.errors; handoffs += h.handoffs;
      }
      return { ...t, work_ms: Math.max(0, work - waiting), waiting_ms: waiting, tools, asks, errors, handoffs };
    }).sort((a, b) => b.updated_at - a.updated_at);
  }

  // per agent: what it picked up, delivered, and how reviews went
  function stats() {
    const by = new Map();
    const get = (sid, agent) => {
      if (!by.has(sid)) by.set(sid, { session_id: sid, agent, handled: 0, delivered: 0, accepted: 0, rejected: 0, work_ms: 0, tools: 0, asks: 0, errors: 0, waiting_ms: 0 });
      return by.get(sid);
    };
    for (const t of tasks.values()) {
      for (const sid of new Set(t.handlers.map(h => h.session_id))) get(sid, t.handlers.findLast(h => h.session_id === sid).agent).handled++;
      for (const h of t.handlers) {
        const a = get(h.session_id, h.agent);
        a.work_ms += (h.to ?? now()) - h.from - h.waiting_ms; a.tools += h.tools; a.asks += h.asks; a.errors += h.errors; a.waiting_ms += h.waiting_ms;
      }
      if (t.delivered_by && (t.status === 'review' || t.status === 'done')) {
        const a = get(t.delivered_by, t.agent);
        a.delivered++;
        if (t.status === 'done') a.accepted++;
      }
      if (t.delivered_by && t.rejections) get(t.delivered_by, t.agent).rejected += t.rejections;
    }
    return [...by.values()].sort((a, b) => b.handled - a.handled);
  }

  const snapshot = () => ({ tasks: list(), stats: stats() });
  return { onEvent, setStatus, remove, clearDemo, list, stats, snapshot, flush };
}
