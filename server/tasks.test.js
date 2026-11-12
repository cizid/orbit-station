import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createTaskStore } from './tasks.js';

const todo = (...items) => ({ hook_event_name: 'PreToolUse', tool_name: 'TodoWrite', tool_input: { todos: items.map(([content, status]) => ({ content, status, activeForm: `${content}ing` })) } });
const ev = (name, extra = {}) => ({ session_id: 'abcd1234', cwd: '/p/alpha', hook_event_name: name, ...extra });
const setup = () => { let t = 1000; const store = createTaskStore({ now: () => t }); return { store, tick: ms => { t += ms; } }; };
const byTitle = (store, title) => store.list().find(x => x.title === title);

test('todo statuses map to board columns', () => {
  const { store } = setup();
  store.onEvent(ev('PreToolUse', todo(['A', 'in_progress'], ['B', 'pending'], ['C', 'completed'])));
  assert.equal(byTitle(store, 'A').status, 'progress');
  assert.equal(byTitle(store, 'B').status, 'backlog');
  assert.equal(byTitle(store, 'C').status, 'review');
});

test('stop moves open work to review; accept and reject are manual', () => {
  const { store } = setup();
  store.onEvent(ev('PreToolUse', todo(['A', 'in_progress'])));
  store.onEvent(ev('Stop'));
  const a = byTitle(store, 'A');
  assert.equal(a.status, 'review');
  assert.deepEqual(store.setStatus(a.id, 'progress'), { error: 'cannot move review -> progress', code: 400 });
  assert.ok(store.setStatus(a.id, 'backlog').ok);
  assert.equal(byTitle(store, 'A').rejections, 1);
  store.onEvent(ev('PreToolUse', todo(['A', 'in_progress'])));
  store.onEvent(ev('Stop'));
  assert.ok(store.setStatus(a.id, 'done').ok);
  store.onEvent(ev('PreToolUse', todo(['A', 'in_progress'])));
  assert.equal(byTitle(store, 'A').status, 'done', 'agent list cannot undo an accepted card');
});

test('tools, questions and waiting time are counted on the handler', () => {
  const { store, tick } = setup();
  store.onEvent(ev('PreToolUse', todo(['A', 'in_progress'])));
  store.onEvent(ev('PreToolUse', { tool_name: 'Read' }));
  store.onEvent(ev('PreToolUse', { tool_name: 'Task' }));
  store.onEvent(ev('Notification'));
  tick(5000);
  store.onEvent(ev('PreToolUse', { tool_name: 'Bash' }));
  store.onEvent(ev('PostToolUseFailure'));
  const a = byTitle(store, 'A');
  assert.equal(a.tools, 3); assert.equal(a.handoffs, 1); assert.equal(a.asks, 1); assert.equal(a.errors, 1); assert.equal(a.waiting_ms, 5000);
});

test('stats attribute work to the agent that handled and delivered', () => {
  const { store } = setup();
  store.onEvent(ev('PreToolUse', todo(['A', 'in_progress'])));
  store.onEvent({ ...ev('PreToolUse', todo(['A', 'in_progress'])), session_id: 'zzzz9999' });   // another agent, same project
  store.onEvent(ev('Stop'));
  const s = store.stats().find(x => x.session_id === 'abcd1234');
  assert.equal(s.handled, 1); assert.equal(s.delivered, 1);
});

test('session end sends unfinished work back to the backlog', () => {
  const { store } = setup();
  store.onEvent(ev('PreToolUse', todo(['A', 'in_progress'])));
  store.onEvent(ev('SessionEnd'));
  assert.equal(byTitle(store, 'A').status, 'backlog');
});

test('tasks survive a restart', () => {
  const file = path.join(mkdtempSync(path.join(tmpdir(), 'tasks-')), 'tasks.json');
  const a = createTaskStore({ file });
  a.onEvent(ev('PreToolUse', todo(['A', 'pending'])));
  a.flush();
  assert.equal(JSON.parse(readFileSync(file, 'utf8')).tasks.length, 1);
  assert.equal(createTaskStore({ file }).list()[0].title, 'A');
});

test('TaskCreate / TaskUpdate (newer Claude Code) drive the same board', () => {
  const { store } = setup();
  store.onEvent(ev('PreToolUse', { tool_name: 'TaskCreate', tool_input: { subject: 'Ship it', activeForm: 'Shipping it' } }));
  assert.equal(byTitle(store, 'Ship it').status, 'backlog');
  store.onEvent(ev('PostToolUse', { tool_name: 'TaskCreate', tool_input: { subject: 'Ship it' }, tool_response: 'Task #7 created' }));
  store.onEvent(ev('PreToolUse', { tool_name: 'TaskUpdate', tool_input: { taskId: '7', status: 'in_progress' } }));
  assert.equal(byTitle(store, 'Ship it').status, 'progress');
  store.onEvent(ev('PreToolUse', { tool_name: 'TaskUpdate', tool_input: { taskId: '7', status: 'completed' } }));
  assert.equal(byTitle(store, 'Ship it').status, 'review');
});

test('a prompt becomes a card when there is no todo list, and a todo list replaces it', () => {
  const { store } = setup();
  store.onEvent(ev('UserPromptSubmit', { prompt: 'fix the cart' }));
  assert.equal(byTitle(store, 'fix the cart').status, 'progress');
  store.onEvent(ev('Stop'));
  assert.equal(byTitle(store, 'fix the cart').status, 'review');
  store.onEvent(ev('UserPromptSubmit', { prompt: 'next thing' }));
  store.onEvent(ev('PreToolUse', todo(['Step 1', 'in_progress'])));
  assert.equal(byTitle(store, 'next thing'), undefined);
  assert.equal(byTitle(store, 'Step 1').status, 'progress');
});

test('real Claude Code payloads: TaskCreate response nests the id, TaskUpdate carries it as a string', () => {
  const { store } = setup();
  for (const [n, subject] of [['1', 'Write hello'], ['2', 'Say bye']]) {
    store.onEvent(ev('PreToolUse', { tool_name: 'TaskCreate', tool_input: { subject, description: subject } }));
    store.onEvent(ev('PostToolUse', { tool_name: 'TaskCreate', tool_input: { subject }, tool_response: { task: { id: n, subject } } }));
  }
  store.onEvent(ev('PreToolUse', { tool_name: 'TaskUpdate', tool_input: { taskId: '1', status: 'completed' } }));
  store.onEvent(ev('PreToolUse', { tool_name: 'TaskUpdate', tool_input: { taskId: '2', status: 'in_progress' } }));
  assert.equal(byTitle(store, 'Write hello').status, 'review');
  assert.equal(byTitle(store, 'Say bye').status, 'progress');
});
