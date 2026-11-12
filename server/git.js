import { execFile } from 'node:child_process';
import { statSync } from 'node:fs';
import path from 'node:path';

// Read-only git questions about a project folder. Arguments are fixed strings; the only caller-supplied
// values are the folder (must be an existing absolute directory) and branch names (strictly validated).

const SAFE = ['-c', 'core.fsmonitor=false', '-c', 'core.hooksPath=/dev/null'];
const run = (cwd, args) => new Promise(resolve => {
  execFile('git', [...SAFE, ...args], { cwd, timeout: 5000, maxBuffer: 1 << 20, env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' } },
    (err, stdout, stderr) => resolve({ ok: !err, code: err?.code ?? 0, out: String(stdout).trim(), err: String(stderr).trim() }));
});
const isDir = p => { try { return path.isAbsolute(p) && statSync(p).isDirectory(); } catch { return false; } };
export const validBranch = b => typeof b === 'string' && /^[A-Za-z0-9._/@-]{1,200}$/.test(b) && !b.startsWith('-') && !b.includes('..');

const cache = new Map();
// { root: this working copy, commonRoot: the main repository, branch, worktree: bool } or null outside a repository
export async function repoInfo(cwd, ttlMs = 10_000) {
  if (!isDir(cwd)) return null;
  const hit = cache.get(cwd);
  if (hit && Date.now() - hit.at < ttlMs) return hit.info;
  const top = await run(cwd, ['rev-parse', '--show-toplevel']);
  let info = null;
  if (top.ok && top.out) {
    const [branch, common] = await Promise.all([run(cwd, ['rev-parse', '--abbrev-ref', 'HEAD']), run(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'])]);
    const commonRoot = common.ok && path.basename(common.out) === '.git' ? path.dirname(common.out) : top.out;
    info = { root: top.out, commonRoot, branch: branch.ok ? branch.out : null, worktree: path.resolve(top.out) !== path.resolve(commonRoot) };
  }
  cache.set(cwd, { at: Date.now(), info });
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return info;
}

// would merging branch b into a conflict? -> { files: [...] } | { files: [] } | null (cannot tell, e.g. old git)
export async function mergeConflicts(root, a, b) {
  if (!isDir(root) || !validBranch(a) || !validBranch(b)) return null;
  const r = await run(root, ['merge-tree', '--write-tree', '--name-only', '--no-messages', a, b]);
  if (r.ok) return { files: [] };
  if (r.code !== 1) return null;
  const lines = r.out.split('\n').slice(1);
  return { files: lines.slice(0, lines.indexOf('') === -1 ? lines.length : lines.indexOf('')).slice(0, 20) };
}
