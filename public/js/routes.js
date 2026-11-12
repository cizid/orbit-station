// Every page and API path in one place. The server registers them, the browser links to them.

export const PAGES = [
  { id: 'station', path: '/',      file: 'index.html', label: 'Station' },
  { id: 'agents',  path: '/agents', file: 'agents.html', label: 'Agents' },
  { id: 'board',   path: '/board', file: 'board.html', label: 'Board' },
  { id: 'trace',   path: '/trace', file: 'trace.html', label: 'Trace' },
  { id: 'metrics', path: '/metrics', file: 'metrics.html', label: 'Metrics' },
];

export const API = {
  tasks: '/api/tasks',
  task: '/api/tasks/:id',
  taskStatus: '/api/tasks/:id/status',
  agents: '/api/agents',
  trace: '/api/trace',
  metrics: '/api/metrics',
  settings: '/api/settings',
  judge: '/api/judge',
  demo: '/demo',
  ws: '/ws',
};

export const fill = (tpl, params) => tpl.replace(/:(\w+)/g, (_, k) => encodeURIComponent(params[k]));
// the station page opens with this agent selected
export const stationUrl = sid => `/#agent=${encodeURIComponent(sid)}`;
