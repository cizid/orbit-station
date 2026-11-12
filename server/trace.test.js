import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTraceStore } from './trace.js';
import { createGuardrails, LIMITS } from './guardrails.js';
import { createPricing } from './prices.js';
import { parseUsage, resolveTranscript } from './transcript.js';

const setup = () => {
  let t = 1000;
  const trace = createTraceStore({ now: () => t, pricing: createPricing() });
  const raised = [];
  const guard = createGuardrails({ trace, now: () => t, onAlert: a => raised.push(a) });
  const ev = (name, extra = {}) => ({ session_id: 's1', cwd: '/p/alpha', hook_event_name: name, ...extra });
  return { trace, guard, raised, ev, tick: ms => { t += ms; } };
};

test('tool spans get their duration from the hook and flag failures', () => {
  const { trace, ev, tick } = setup();
  trace.onEvent(ev('PreToolUse', { tool_name: 'Read', tool_use_id: 'u1', tool_input: { file_path: '/a' } }));
  tick(50);
  trace.onEvent(ev('PostToolUse', { tool_name: 'Read', tool_use_id: 'u1', duration_ms: 40 }));
  trace.onEvent(ev('PreToolUse', { tool_name: 'Bash', tool_use_id: 'u2', tool_input: { command: 'x' } }));
  trace.onEvent(ev('PostToolUseFailure', { tool_name: 'Bash', tool_use_id: 'u2' }));
  const [a, b] = trace.view('s1').spans;
  assert.equal(a.end - a.start, 40); assert.equal(a.status, 'ok'); assert.equal(a.summary, '/a');
  assert.equal(b.status, 'error');
});

test('delegation and return are edges between the parent and the subagent id', () => {
  const { trace, ev } = setup();
  trace.onEvent(ev('PreToolUse', { tool_name: 'Agent', tool_use_id: 'u1', tool_input: { description: 'Review', prompt: 'look at X' } }));
  trace.onEvent(ev('SubagentStart', { agent_id: 'ag1', agent_type: 'general-purpose' }));
  trace.onEvent(ev('PreToolUse', { tool_name: 'Read', tool_use_id: 'u2', agent_id: 'ag1', tool_input: {} }));
  trace.onEvent(ev('SubagentStop', { agent_id: 'ag1', last_assistant_message: 'found it' }));
  const v = trace.view('s1');
  assert.deepEqual(v.edges.map(e => [e.kind, e.from, e.to]), [['delegate', 's1', 'ag1'], ['return', 'ag1', 's1']]);
  assert.equal(v.edges[0].text, 'look at X');
  assert.equal(v.spans.find(s => s.tool === 'Read').agent, 'ag1');
});

test('waiting for the user is its own span', () => {
  const { trace, ev, tick } = setup();
  trace.onEvent(ev('Notification', { message: 'permission' }));
  tick(3000);
  trace.onEvent(ev('PreToolUse', { tool_name: 'Bash', tool_use_id: 'u1', tool_input: {} }));
  const w = trace.view('s1').spans.find(s => s.kind === 'wait');
  assert.equal(w.end - w.start, 3000);
  assert.equal(trace.metrics().totals.wait_ms, 3000);
});

test('usage is counted once per request, with cost and latency', () => {
  const { trace, ev } = setup();
  trace.onEvent(ev('SessionStart'));
  const req = { id: 'r1', model: 'claude-sonnet-5-5', in: 1000, out: 100, cr: 0, cc: 0, latency_ms: 800 };
  trace.addUsage('s1', 's1', [req]);
  trace.addUsage('s1', 's1', [{ ...req, out: 250 }, req].slice(0, 1));   // the same request again, grown
  const m = trace.metrics();
  assert.equal(m.totals.tokens.out, 250); assert.equal(m.totals.requests, 1); assert.equal(m.totals.avg_latency_ms, 800);
  assert.ok(m.totals.cost > 0);
});

test('unknown models have no invented cost', () => {
  const { trace, ev } = setup();
  trace.onEvent(ev('SessionStart'));
  trace.addUsage('s1', 's1', [{ id: 'r', model: 'mystery-1', in: 10, out: 10, cr: 0, cc: 0, latency_ms: 1 }]);
  assert.equal(trace.metrics().totals.cost_known, false);
});

test('guardrail: repeated identical calls become a loop alert, varied calls do not', () => {
  const { trace, guard, raised, ev } = setup();
  for (let i = 0; i < 3; i++) { trace.onEvent(ev('PreToolUse', { tool_name: 'Read', tool_use_id: `a${i}`, tool_input: { file_path: '/same' } })); guard.check('s1'); }
  assert.equal(raised.length, 1); assert.equal(raised[0].kind, 'loop');
  const other = setup();
  for (let i = 0; i < 5; i++) { other.trace.onEvent(other.ev('PreToolUse', { tool_name: 'Read', tool_use_id: `b${i}`, tool_input: { file_path: `/f${i}` } })); other.guard.check('s1'); }
  assert.equal(other.raised.length, 0);
});

test('guardrail: failing calls in a row, re-delegation and budget', () => {
  const { trace, guard, raised, ev } = setup();
  for (let i = 0; i < 3; i++) { trace.onEvent(ev('PreToolUse', { tool_name: 'Bash', tool_use_id: `e${i}`, tool_input: { command: `c${i}` } })); trace.onEvent(ev('PostToolUseFailure', { tool_use_id: `e${i}` })); }
  guard.check('s1');
  assert.ok(raised.some(a => a.kind === 'errors'));
  for (let i = 0; i < 3; i++) { trace.onEvent(ev('PreToolUse', { tool_name: 'Agent', tool_use_id: `g${i}`, tool_input: { prompt: 'same job' } })); trace.onEvent(ev('SubagentStart', { agent_id: `x${i}` })); }
  guard.check('s1');
  assert.ok(raised.some(a => a.kind === 'handoff-loop'));
  trace.addUsage('s1', 's1', [{ id: 'big', model: 'claude-opus-5-5', in: 0, out: 400_000, cr: 0, cc: 0, latency_ms: 1 }]);
  guard.check('s1');
  assert.ok(raised.some(a => a.kind === 'budget'));
});

test('alerts are not repeated inside the cooldown', () => {
  const { trace, guard, raised, ev, tick } = setup();
  for (let i = 0; i < 6; i++) trace.onEvent(ev('PreToolUse', { tool_name: 'Read', tool_use_id: `r${i}`, tool_input: {} }));
  guard.check('s1'); guard.check('s1');
  assert.equal(raised.length, 1);
  tick(LIMITS.cooldownMs + 1); guard.check('s1');
  assert.equal(raised.length, 2);
});

test('transcript: requests are merged, latency measured, paths confined', () => {
  const lines = [
    { type: 'user', timestamp: '2026-01-01T00:00:00.000Z' },
    { type: 'assistant', requestId: 'r1', timestamp: '2026-01-01T00:00:02.000Z', message: { model: 'claude-sonnet-5-5', usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 100 } } },
    { type: 'assistant', requestId: 'r1', timestamp: '2026-01-01T00:00:03.000Z', message: { model: 'claude-sonnet-5-5', usage: { input_tokens: 10, output_tokens: 9, cache_read_input_tokens: 100 } } },
  ].map(l => JSON.stringify(l)).join('\n');
  const { requests: [r] } = parseUsage(lines);
  assert.deepEqual([r.in, r.out, r.cr, r.latency_ms], [10, 9, 100, 2000]);
  const root = mkdtempSync(path.join(tmpdir(), 'proj-')); mkdirSync(path.join(root, 'p'));
  const inside = path.join(root, 'p', 't.jsonl'); writeFileSync(inside, '');
  assert.ok(resolveTranscript(inside, root));
  assert.equal(resolveTranscript('/etc/passwd', root), null);
  assert.equal(resolveTranscript(path.join(tmpdir(), 'x.jsonl'), root), null);
});
