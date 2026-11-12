import path from 'node:path';
import { mergeConflicts as realMerge, repoInfo as realInfo } from './git.js';

// Catch merge conflicts before they happen:
//   same file edited by two agents of one project  -> warning right away (worktrees: "will conflict at merge")
//   different branches of one repository           -> ask git (merge-tree) whether they would conflict
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);

export function createConflicts({ projects, guard, now = Date.now, repoInfo = realInfo, mergeConflicts = realMerge, windowMs = 30 * 60_000, pairCooldownMs = 60_000 }) {
  const edited = new Map();        // "root|relative path" -> Map(sid -> time)
  const lastPair = new Map();
  const name = sid => { const a = projects.get(sid); return a ? `${a.name ?? path.basename(a.cwd)}·${sid.slice(0, 4)}` : sid.slice(0, 6); };

  async function onEdit(ev) {
    const f = ev.tool_input?.file_path;
    if (typeof f !== 'string' || typeof ev.cwd !== 'string') return;
    const info = await repoInfo(ev.cwd), base = info?.root ?? ev.cwd, rel = path.relative(base, path.resolve(base, f));
    if (rel.startsWith('..')) return;
    const key = `${info?.commonRoot ?? ev.cwd}|${rel}`, seen = edited.get(key) ?? new Map(), at = now();
    const others = [...seen].filter(([s, t]) => s !== ev.session_id && at - t < windowMs).map(([s]) => s);
    seen.set(ev.session_id, at); edited.set(key, seen);
    if (edited.size > 2000) edited.delete(edited.keys().next().value);
    if (!others.length) return;
    const sameCopy = others.some(s => projects.get(s)?.cwd === ev.cwd);
    guard.raise(ev.session_id, ev.session_id, 'conflict-risk', 'warn',
      `${name(ev.session_id)} and ${others.map(name).join(', ')} both edit ${rel}${sameCopy ? ' in the same working copy: they can overwrite each other' : ': expect a merge conflict'}`,
      key);
  }

  // after an agent finished a turn: would its branch conflict with the other agents' branches?
  async function onTurnEnd(ev) {
    const me = projects.get(ev.session_id);
    if (!me?.branch) return;
    const info = await repoInfo(me.cwd);
    if (!info) return;
    for (const other of projects.agents()) {
      if (other.sid === me.sid || other.ended || other.root !== me.root || !other.branch || other.branch === me.branch) continue;
      const key = [me.sid, other.sid].sort().join('|');
      if (now() - (lastPair.get(key) ?? -Infinity) < pairCooldownMs) continue;
      lastPair.set(key, now());
      const r = await mergeConflicts(info.commonRoot, me.branch, other.branch);
      if (r?.files.length) guard.raise(me.sid, me.sid, 'merge-conflict', 'crit', `${me.branch} and ${other.branch} would conflict in ${r.files.slice(0, 3).join(', ')}${r.files.length > 3 ? ` (+${r.files.length - 3})` : ''}`);
    }
  }

  return {
    onEvent(ev) {
      const run = ev?.hook_event_name === 'PreToolUse' && EDIT_TOOLS.has(ev.tool_name) ? onEdit(ev) : ev?.hook_event_name === 'Stop' ? onTurnEnd(ev) : null;
      return run?.catch(() => {});
    },
  };
}
