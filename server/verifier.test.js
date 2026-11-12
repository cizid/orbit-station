import test from 'node:test';
import assert from 'node:assert/strict';
import { createTraceStore } from './trace.js';
import { createGuardrails } from './guardrails.js';
import { createVerifier } from './verifier.js';
import { claimsIn, fileRefs, importsIn, weakening, isTestFile } from './evidence.js';

const CWD = '/proj';
const setup = (opts = {}) => {
  let t = 1000;
  const trace = createTraceStore({ now: () => t });
  const raised = [];
  const guard = createGuardrails({ trace, now: () => t, onAlert: a => raised.push(a) });
  const verifier = createVerifier({ trace, guard, now: () => t, exists: () => true, readJson: () => null, readText: () => null, ...opts });
  const send = (name, extra = {}) => { const ev = { session_id: 's1', cwd: CWD, hook_event_name: name, ...extra }; trace.onEvent(ev); verifier.onEvent(ev); };
  const bash = (command, ok, id) => { send('PreToolUse', { tool_name: 'Bash', tool_use_id: id, tool_input: { command } }); send(ok ? 'PostToolUse' : 'PostToolUseFailure', { tool_name: 'Bash', tool_use_id: id, duration_ms: 5 }); };
  return { trace, raised, send, bash, tick: ms => { t += ms; } };
};
const kinds = r => r.map(a => a.kind);

test('claims are found in English and German, negations are ignored', () => {
  assert.deepEqual(claimsIn('All tests pass and the build succeeds.').map(c => c.kind).sort(), ['build', 'tests']);
  assert.deepEqual(claimsIn('Alle Tests laufen durch, ich habe committet.').map(c => c.kind).sort(), ['commit', 'tests']);
  assert.deepEqual(claimsIn('Ich schreibe nicht „The command succeeded and all tests pass." weil das falsch wäre, und `all tests pass` ist auch nur ein Zitat.'), []);
  assert.deepEqual(claimsIn('Not committed yet. Noch nicht gepusht. Tests should pass later.'), []);
});

test('a claim without a matching run is flagged, one with a failed run is critical, a real run is fine', () => {
  const a = setup();
  a.send('UserPromptSubmit', { prompt: 'do it' });
  a.send('Stop', { last_assistant_message: 'Fixed it, all tests pass.' });
  assert.deepEqual(a.raised.map(x => [x.kind, x.level]), [['unproven-claim', 'warn']]);

  const b = setup();
  b.send('UserPromptSubmit', { prompt: 'do it' });
  b.bash('npm test', false, 'u1');
  b.send('Stop', { last_assistant_message: 'All tests pass.' });
  assert.equal(b.raised.find(x => x.kind === 'unproven-claim').level, 'crit');

  const c = setup();
  c.send('UserPromptSubmit', { prompt: 'do it' });
  c.bash('npm test', true, 'u1');
  c.send('Stop', { last_assistant_message: 'All tests pass.' });
  assert.equal(c.raised.length, 0);
});

test('files mentioned but missing are flagged; deleted, example and outside paths are not', () => {
  assert.deepEqual(fileRefs('I updated src/app.js and ../outside.js, see https://x.io/a.js', '/proj'), ['/proj/src/app.js']);
  assert.deepEqual(fileRefs('I deleted old/gone.js and, e.g., src/example.js', '/proj'), []);
  const a = setup({ exists: p => p !== '/proj/src/ghost.js' });
  a.send('UserPromptSubmit', { prompt: 'x' });
  a.send('Stop', { last_assistant_message: 'Updated src/real.js and src/ghost.js.' });
  assert.match(a.raised[0].msg, /src\/ghost\.js/);
  assert.doesNotMatch(a.raised[0].msg, /real/);
});

test('imports of packages that are neither declared nor installed are flagged', () => {
  assert.deepEqual(importsIn("import fs from 'node:fs'; import x from 'left-pad'; import { y } from '@a/b/c'; import z from './z.js'; const q = require('express');").sort(), ['@a/b', 'express', 'left-pad']);
  const a = setup({ readJson: f => f === '/proj/package.json' ? { name: 'me', dependencies: { express: '1' } } : null, exists: () => false });
  a.send('PreToolUse', { tool_name: 'Write', tool_use_id: 'w', tool_input: { file_path: '/proj/src/a.js', content: "import e from 'express'; import ghost from 'ghost-pkg';" } });
  assert.deepEqual(kinds(a.raised), ['unknown-import']);
  assert.match(a.raised[0].msg, /ghost-pkg/); assert.doesNotMatch(a.raised[0].msg, /express/);
});

test('weakening a test file: fewer assertions, removed cases, new skips', () => {
  assert.ok(isTestFile('src/a.test.js') && isTestFile('tests/x.py') && !isTestFile('src/a.js'));
  const w = weakening("it('a', () => { expect(1).toBe(1); expect(2).toBe(2); });", "it.skip('a', () => { expect(1).toBe(1); });");
  assert.deepEqual(w.map(x => x.msg.split(' ')[0]), ['Assertions', 'Tests']);
  assert.equal(weakening("it('a', () => {})", '')[0].level, 'crit');
  const a = setup();
  a.send('PreToolUse', { tool_name: 'Edit', tool_use_id: 'e', tool_input: { file_path: '/proj/a.test.js', old_string: 'expect(a).toBe(1); expect(b).toBe(2);', new_string: 'expect(a).toBe(1);' } });
  assert.deepEqual(kinds(a.raised), ['test-weakening']);
  const b = setup();
  b.send('PreToolUse', { tool_name: 'Bash', tool_use_id: 'r', tool_input: { command: 'rm src/a.test.js' } });
  assert.deepEqual(kinds(b.raised), ['test-weakening']);
});

test('tests that were green and now fail after edits are a regression', () => {
  const a = setup();
  a.bash('npm test', true, 't1');
  a.send('PreToolUse', { tool_name: 'Edit', tool_use_id: 'e1', tool_input: { file_path: '/proj/src/a.js', old_string: 'a', new_string: 'b' } });
  a.bash('npm test', false, 't2');
  assert.equal(a.raised.find(x => x.kind === 'tests-red').level, 'crit');
  const first = setup();   // never green before: no regression claim
  first.bash('npm test', false, 't1');
  assert.equal(first.raised.length, 0);
});

test('a turn far bigger than the usual one is drift', () => {
  const a = setup();
  for (let turn = 0; turn < 6; turn++) {
    a.send('UserPromptSubmit', { prompt: 'p' + turn });
    for (let i = 0; i < 3; i++) a.send('PreToolUse', { tool_name: 'Read', tool_use_id: `r${turn}-${i}`, tool_input: { file_path: `/f${i}` } });
    a.send('Stop', {});
    a.tick(1);
  }
  assert.equal(a.raised.length, 0);
  a.send('UserPromptSubmit', { prompt: 'big' });
  for (let i = 0; i < 20; i++) a.send('PreToolUse', { tool_name: 'Read', tool_use_id: `b${i}`, tool_input: { file_path: `/g${i}` } });
  a.send('Stop', {});
  assert.deepEqual(kinds(a.raised), ['drift']);
});
