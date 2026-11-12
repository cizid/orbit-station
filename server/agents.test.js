import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, writeFileSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createFeed } from './feed.js';
import { createProjects } from './projects.js';
import { createConflicts } from './conflicts.js';
import { createTraceStore } from './trace.js';
import { createGuardrails } from './guardrails.js';
import { repoInfo, mergeConflicts, validBranch } from './git.js';

const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.email=t@t', '-c', 'user.name=t', ...args], { cwd, stdio: 'pipe' }).toString().trim();

test('feed turns events into terminal lines: commands with output, code being written, answers', () => {
  const f = createFeed({ now: () => 1 });
  f.onEvent({ session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'Bash', tool_use_id: 'b1', tool_input: { command: 'npm test' } });
  f.onEvent({ session_id: 's', hook_event_name: 'PostToolUse', tool_name: 'Bash', tool_use_id: 'b1', duration_ms: 1500, tool_response: { stdout: 'a\nb\nc\nd\n# pass 4', stderr: '' } });
  f.onEvent({ session_id: 's', hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: '/p/a.js', old_string: 'x', new_string: 'one\ntwo' } });
  f.onEvent({ session_id: 's', hook_event_name: 'PostToolUseFailure', tool_name: 'Bash', tool_use_id: 'b2', error: 'boom' });
  const t = f.tail('s');
  assert.deepEqual(t.map(l => l.kind), ['cmd', 'out', 'out', 'out', 'status', 'edit', 'code', 'code', 'out', 'status']);
  assert.equal(t[0].text, '$ npm test'); assert.equal(t[3].text, '# pass 4'); assert.match(t[4].text, /✓ 1\.5s/);
  assert.match(t[5].text, /edit \/p\/a\.js\s+\+2 −1/); assert.equal(t.at(-1).ok, false);
});

test('feed is bounded per agent', () => {
  const f = createFeed();
  for (let i = 0; i < 300; i++) f.onEvent({ session_id: 's', hook_event_name: 'UserPromptSubmit', prompt: `p${i}` });
  assert.equal(f.tail('s', 1000).length, 200);
});

test('projects keep roles, config and history per project; bad input is rejected', () => {
  const p = createProjects({ now: () => 5 });
  p.register({ sid: 'a1', cwd: '/r', info: { commonRoot: '/r', branch: 'main', worktree: false } });
  p.register({ sid: 'a2', cwd: '/r/.wt/x', info: { commonRoot: '/r', branch: 'feat', worktree: true }, managed: true, role: 'qa' });
  assert.equal(p.get('a2').role, 'qa'); assert.equal(p.get('a2').worktree, true); assert.equal(p.projects().length, 1);
  assert.ok(p.setRole('a1', 'security').ok); assert.equal(p.setRole('a1', 'wizard').code, 400);
  assert.ok(p.setConfig('/r', { defaultRole: 'backend', budgetUsd: 10 }).ok);
  assert.equal(p.setConfig('/r', { budgetUsd: -1 }).code, 400); assert.equal(p.setConfig('/nope', {}).code, 404);
  p.register({ sid: 'a3', cwd: '/r', info: { commonRoot: '/r', branch: 'main' } });
  assert.equal(p.get('a3').role, 'backend');   // new agents start with the project's default role
  p.finish('a1', { cost: 1.5 });
  assert.equal(p.project('/r').history[0].cost, 1.5); assert.equal(p.project('/r').history[0].role, 'security');
});

test('real git: worktrees are recognised and conflicting branches are found', async () => {
  const dir = realpathSync(mkdtempSync(path.join(tmpdir(), 'repo-')));
  git(dir, 'init', '-q', '-b', 'main'); writeFileSync(path.join(dir, 'a.txt'), 'base\n'); git(dir, 'add', '.'); git(dir, 'commit', '-qm', 'base');
  const wt = path.join(dir, '.wt-feat');
  git(dir, 'worktree', 'add', '-q', '-b', 'feat', wt);
  writeFileSync(path.join(wt, 'a.txt'), 'feature\n'); git(wt, 'commit', '-qam', 'feat');
  writeFileSync(path.join(dir, 'a.txt'), 'main change\n'); git(dir, 'commit', '-qam', 'main');
  const main = await repoInfo(dir, 0), feat = await repoInfo(wt, 0);
  assert.deepEqual([main.branch, main.worktree, feat.branch, feat.worktree, feat.commonRoot], ['main', false, 'feat', true, dir]);
  assert.deepEqual((await mergeConflicts(dir, 'main', 'feat')).files, ['a.txt']);
  assert.equal(await repoInfo('/definitely/not/here'), null);
  assert.ok(!validBranch('--output=x') && !validBranch('a b') && validBranch('feature/x-1'));
  assert.equal(await mergeConflicts(dir, 'main', '--help'), null);
});

test('two agents editing the same file raise a conflict warning; different files do not', async () => {
  const projects = createProjects();
  const trace = createTraceStore();
  const raised = [];
  const guard = createGuardrails({ trace, onAlert: a => raised.push(a) });
  const info = { root: '/r', commonRoot: '/r', branch: 'main', worktree: false };
  const c = createConflicts({ projects, guard, repoInfo: async () => info, mergeConflicts: async () => null });
  for (const sid of ['s1', 's2']) projects.register({ sid, cwd: '/r', info });
  const edit = (sid, f) => c.onEvent({ session_id: sid, cwd: '/r', hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: f } });
  await edit('s1', '/r/src/a.js'); await edit('s2', '/r/src/b.js');
  assert.equal(raised.length, 0);
  await edit('s2', '/r/src/a.js');
  assert.equal(raised[0].kind, 'conflict-risk'); assert.match(raised[0].msg, /src\/a\.js.*same working copy/);
  await edit('s1', '/r/src/a.js');   // the same problem is not raised again for the other agent
  assert.equal(raised.length, 1);
});

test('branches that would conflict raise a merge alert after a turn', async () => {
  const projects = createProjects(), trace = createTraceStore(), raised = [];
  const guard = createGuardrails({ trace, onAlert: a => raised.push(a) });
  projects.register({ sid: 's1', cwd: '/r', info: { commonRoot: '/r', root: '/r', branch: 'main' } });
  projects.register({ sid: 's2', cwd: '/r/wt', info: { commonRoot: '/r', root: '/r/wt', branch: 'feat', worktree: true } });
  const c = createConflicts({ projects, guard, repoInfo: async () => ({ root: '/r', commonRoot: '/r' }), mergeConflicts: async () => ({ files: ['a.txt'] }) });
  await c.onEvent({ session_id: 's1', cwd: '/r', hook_event_name: 'Stop' });
  assert.equal(raised[0].kind, 'merge-conflict'); assert.match(raised[0].msg, /main and feat/);
});
