// Every page and API path in one place. The server registers them, the browser links to them.

export const PAGES = [
  { id: 'station', path: '/',      file: 'index.html', label: 'Station' },
  { id: 'board',   path: '/board', file: 'board.html', label: 'Board' },
];

export const API = {
  tasks: '/api/tasks',
  task: '/api/tasks/:id',
  taskStatus: '/api/tasks/:id/status',
  demo: '/demo',
  ws: '/ws',
};

export const fill = (tpl, params) => tpl.replace(/:(\w+)/g, (_, k) => encodeURIComponent(params[k]));
// the station page opens with this agent selected
export const stationUrl = sid => `/#agent=${encodeURIComponent(sid)}`;
