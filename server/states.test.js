import test from 'node:test';
import assert from 'node:assert/strict';
import { routeEvent, effectiveState, canSync } from '../public/js/states.js';

const pre = tool => ({ hook_event_name: 'PreToolUse', tool_name: tool });

test('events map to state and station', () => {
  assert.deepEqual(routeEvent({ hook_event_name: 'SessionStart' }), { state: 'boarding', station: 'door', action: 'arrive', target: 'agent' });
  assert.deepEqual(routeEvent(pre('Read')), { state: 'working', station: 'library', action: 'work', target: 'agent' });
  assert.deepEqual(routeEvent(pre('Task')), { state: 'handoff', station: 'meet', action: 'delegate', target: 'agent' });
  assert.equal(routeEvent({ hook_event_name: 'Stop' }).state, 'done');
  assert.equal(routeEvent({ hook_event_name: 'Notification' }).station, null);
});
test('a subagent owns the tool calls while it is out', () => {
  assert.equal(routeEvent(pre('Bash'), { hasSub: true }).target, 'sub');
  assert.equal(routeEvent(pre('Task'), { hasSub: true }).target, 'agent');
  assert.equal(routeEvent({ hook_event_name: 'Stop' }, { hasSub: true }).target, 'agent');
});
test('quiet working agents turn idle', () => {
  assert.equal(effectiveState('working', 0, 46000), 'idle');
  assert.equal(effectiveState('done', 0, 999999), 'done');
});
test('the agent is working again once its subagent is back', () => {
  assert.equal(routeEvent({ hook_event_name: 'SubagentStop' }).state, 'working');
  assert.equal(routeEvent({ hook_event_name: 'PostToolUse', tool_name: 'Agent' }).state, 'working');
  assert.equal(routeEvent({ hook_event_name: 'PostToolUse', tool_name: 'Read' }).state, null);
});
test('every event resolves to one action', () => {
  const act = (e, o) => routeEvent(e, o).action;
  assert.equal(act(pre('Agent')), 'delegate');
  assert.equal(act(pre('Read')), 'work');
  assert.equal(act(pre('Read'), { hasSub: true }), 'sub-work');
  assert.equal(act({ hook_event_name: 'SubagentStop' }), 'return');
  assert.equal(act({ hook_event_name: 'PostToolUse', tool_name: 'Agent' }), 'return');
  assert.equal(act({ hook_event_name: 'Stop' }), 'finish');
  assert.equal(act({ hook_event_name: 'SessionEnd' }), 'leave');
});
test('same-project busy agents may sync, but not twice in a row', () => {
  const mk = o => ({ cwd: '/p', last: 100000, ...o });
  assert.ok(canSync(mk(), mk(), 101000));
  assert.ok(!canSync(mk(), mk({ cwd: '/q' }), 101000));
  assert.ok(!canSync(mk(), mk({ last: 1000 }), 101000));
  assert.ok(!canSync(mk({ meetCool: 200000 }), mk(), 101000));
  assert.ok(!canSync(mk({ subId: 'x' }), mk(), 101000));
});
