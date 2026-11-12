import fs from 'node:fs';
import path from 'node:path';
import { ROLES } from '../public/js/roles.js';

// Projects (a git repository, or a plain folder) and the agents working in them. Each project keeps its
// own settings and a history of finished agents; roles are set per agent. Stored in data/projects.json.

const MAX_HISTORY = 100, MAX_AGENTS_KEPT = 80;

export function createProjects({ file = null, now = Date.now } = {}) {
  let state = { projects: {}, agents: {} };
  try { const s = JSON.parse(fs.readFileSync(file, 'utf8')); if (s?.projects && s?.agents) state = s; } catch { /* first run */ }
  let timer = null;
  const save = () => {
    if (!file || timer) return;
    timer = setTimeout(() => {
      timer = null;
      try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(`${file}.tmp`, JSON.stringify(state)); fs.renameSync(`${file}.tmp`, file); } catch { /* keep in memory */ }
    }, 400);
    timer.unref?.();
  };
  const project = root => (state.projects[root] ??= { root, name: path.basename(root) || root, defaultRole: 'none', worktreeDefault: false, budgetUsd: null, history: [] });

  // called for every event of a session: remember who works where, on which branch
  function register({ sid, cwd, info, managed = false, role, name, worktree }) {
    const root = info?.commonRoot ?? cwd, p = project(root);
    const a = state.agents[sid] ??= { sid, root, cwd, role: role ?? p.defaultRole, name: name ?? null, managed, worktree: !!(worktree ?? info?.worktree), branch: null, started: now(), ended: null };
    a.cwd = cwd; a.root = root;
    if (info?.branch) a.branch = info.branch;
    if (info?.worktree) a.worktree = true;
    if (managed) a.managed = true;
    if (role && ROLES[role]) a.role = role;
    const keys = Object.keys(state.agents);
    if (keys.length > MAX_AGENTS_KEPT) for (const k of keys.slice(0, keys.length - MAX_AGENTS_KEPT)) if (state.agents[k].ended) delete state.agents[k];
    save();
    return a;
  }
  const setRole = (sid, role) => {
    if (!state.agents[sid]) return { error: 'unknown agent', code: 404 };
    if (!ROLES[role]) return { error: 'unknown role', code: 400 };
    state.agents[sid].role = role; save(); return { ok: true };
  };
  function setConfig(root, patch) {
    const p = state.projects[root];
    if (!p) return { error: 'unknown project', code: 404 };
    if (patch.defaultRole !== undefined && !ROLES[patch.defaultRole]) return { error: 'unknown role', code: 400 };
    if (patch.budgetUsd !== undefined && patch.budgetUsd !== null && !(Number.isFinite(patch.budgetUsd) && patch.budgetUsd >= 0)) return { error: 'budgetUsd must be a number ≥ 0 or null', code: 400 };
    if (patch.worktreeDefault !== undefined && typeof patch.worktreeDefault !== 'boolean') return { error: 'worktreeDefault must be true or false', code: 400 };
    for (const k of ['defaultRole', 'budgetUsd', 'worktreeDefault']) if (patch[k] !== undefined) p[k] = patch[k];
    save(); return { ok: true };
  }
  // the session ended: keep a line of history for the project
  function finish(sid, summary = {}) {
    const a = state.agents[sid];
    if (!a || a.ended) return;
    a.ended = now();
    const p = project(a.root);
    p.history.unshift({ sid, role: a.role, branch: a.branch, worktree: a.worktree, started: a.started, ended: a.ended, ...summary });
    if (p.history.length > MAX_HISTORY) p.history.length = MAX_HISTORY;
    save();
  }
  const get = sid => state.agents[sid] ?? null;
  const flush = () => { clearTimeout(timer); timer = null; if (file) { try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(state)); } catch { /* ignore */ } } };
  return { register, setRole, setConfig, finish, get, project, flush, view: () => structuredClone(state), projects: () => Object.values(state.projects), agents: () => Object.values(state.agents) };
}
