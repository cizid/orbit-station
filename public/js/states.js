// Single source of truth for what an agent is "doing". Imported by the server (task board, /sessions)
// and by the browser (station labels, board chips), so both always agree.

export const IDLE_MS = 45000;   // no event for this long while working -> idle

// id -> how it is shown. `station` is where the character stands in the station view.
export const STATES = {
  boarding: { label: 'BOARDING',   color: '#8a6bff', hint: 'Session just started' },
  working:  { label: 'WORKING',    color: '#5aa9ff', hint: 'Running a tool or answering a prompt' },
  handoff:  { label: 'DELEGATING', color: '#6ee7ff', hint: 'Handed a task to a subagent' },
  waiting:  { label: 'NEEDS YOU',  color: '#ff4d4d', hint: 'Waiting for permission or input' },
  done:     { label: 'DONE',       color: '#5de6a0', hint: 'Turn finished, waiting for review' },
  idle:     { label: 'IDLE',       color: '#9aa7b5', hint: 'No activity for 45 s' },
  offline:  { label: 'OFFLINE',    color: '#4b5870', hint: 'Session ended' },
};

export const TOOL_STATION = {
  Edit: 'desks', Write: 'desks', MultiEdit: 'desks', NotebookEdit: 'desks',
  Read: 'library', Grep: 'library', Glob: 'library', LS: 'library',
  Bash: 'bench', WebSearch: 'comms', WebFetch: 'comms',
};
export const ACTIVITY = { desks: 'CODING', library: 'READING', bench: 'RUNNING', comms: 'ONLINE' };
export const isTask = name => name === 'Task' || name === 'Agent';

// Which state does a hook event put the agent in? null = the event doesn't change it.
export function stateOf(ev) {
  switch (ev?.hook_event_name) {
    case 'SessionStart': return 'boarding';
    case 'UserPromptSubmit': return 'working';
    case 'PreToolUse': return isTask(ev.tool_name) ? 'handoff' : 'working';
    case 'SubagentStop': return 'working';    // the delegate is back, the agent carries on
    case 'PostToolUse': return isTask(ev.tool_name) ? 'working' : null;
    case 'Notification': return 'waiting';
    case 'Stop': return 'done';
    case 'SessionEnd': return 'offline';
    default: return null;
  }
}

// state as it should be shown right now: working agents that went quiet turn idle
export const effectiveState = (state, lastSeen, now) =>
  (state === 'working' || state === 'boarding') && now - lastSeen > IDLE_MS ? 'idle' : state;

// ---- identity: the same session always gets the same colour
export const COLORS = ['#ff8a3d', '#4aa8ff', '#8bd450', '#ffc233', '#3dd9b0', '#8a6bff', '#e6edf3', '#e0553f'];
export const hash = s => { let h = 2166136261; for (const ch of s) { h ^= ch.charCodeAt(0); h = Math.imul(h, 16777619); } return h >>> 0; };
export const agentColor = id => COLORS[hash(id) % COLORS.length];
export const projectName = cwd => {
  const n = String(cwd || '').replace(/[\\/]+$/, '').split(/[\\/]/).pop();
  return n ? n.toUpperCase().replace(/[^A-Z0-9._ -]/g, '-').slice(0, 12) : '';
};

// The one routing decision for a hook event. The station view only carries it out.
//   state:   the agent's new state (null = unchanged)
//   station: where it should go (null = stay)
//   action:  arrive | work | sub-work | delegate | return | ask | finish | leave | none
//   target:  'agent' or 'sub': while a subagent is out, tool calls arrive under the parent's session id
//            but are the subagent's work
export function routeEvent(ev, { hasSub = false } = {}) {
  const name = ev?.hook_event_name, tool = ev?.tool_name;
  const toolCall = name === 'PreToolUse' && !isTask(tool);
  const target = hasSub && toolCall ? 'sub' : 'agent';
  let station = null, action = 'none';
  if (name === 'SessionStart') { station = 'door'; action = 'arrive'; }
  else if (name === 'UserPromptSubmit') { station = 'desks'; action = 'work'; }
  else if (name === 'PreToolUse') {
    station = isTask(tool) ? 'meet' : TOOL_STATION[tool] || 'desks';
    action = isTask(tool) ? 'delegate' : target === 'sub' ? 'sub-work' : 'work';
  }
  else if (name === 'SubagentStop' || (name === 'PostToolUse' && isTask(tool))) action = 'return';
  else if (name === 'Notification') { station = 'comms'; action = 'ask'; }
  else if (name === 'Stop') { station = 'lounge'; action = 'finish'; }
  else if (name === 'SessionEnd') action = 'leave';
  return { state: stateOf(ev), station, action, target };
}

// Two agents of the same project meet at the table when both are busy and neither is already in a meeting.
export const SYNC_RECENT_MS = 15000, MEET_COOL_MS = 40000;
export function canSync(a, b, now) {
  const free = x => !x.isSub && !x.leaving && !x.inMeet && !x.subId && now >= (x.meetCool || 0);
  return a !== b && !!a.cwd && a.cwd === b.cwd && free(a) && free(b) && now - b.last <= SYNC_RECENT_MS;
}
