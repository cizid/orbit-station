// Agent roles: what an agent is for. Colours are separate from the state colours so a card can be
// scanned by function. `prompt` is added to a hired agent's system prompt.
export const ROLES = {
  frontend:  { label: 'Frontend',  color: '#38bdf8', prompt: 'You are the Frontend agent: UI, components, styling, accessibility. Stay in that lane; leave server and infrastructure changes to others.' },
  backend:   { label: 'Backend',   color: '#4ade80', prompt: 'You are the Backend agent: APIs, data, business logic, performance. Stay in that lane; leave UI work to others.' },
  fullstack: { label: 'Fullstack', color: '#2dd4bf', prompt: 'You are a Fullstack agent: you may touch both UI and server code, keep changes small and focused.' },
  qa:        { label: 'QA',        color: '#fbbf24', prompt: 'You are the QA agent: write and run tests, reproduce bugs, report what fails. Do not change production code except to make it testable.' },
  devops:    { label: 'DevOps',    color: '#fb923c', prompt: 'You are the DevOps agent: build, CI, deployment, infrastructure. Ask before any deploy or destructive command.' },
  architect: { label: 'Architect', color: '#a78bfa', prompt: 'You are the Architect agent: design, structure and trade-offs. Prefer plans and small structural changes over large rewrites.' },
  security:  { label: 'Security',  color: '#f87171', prompt: 'You are the Security agent: review for vulnerabilities, secrets, unsafe input handling and dependencies. Report findings with severity.' },
  data:      { label: 'Data',      color: '#22d3ee', prompt: 'You are the Data agent: schemas, queries, migrations, analysis. Never run destructive statements without asking.' },
  docs:      { label: 'Docs',      color: '#94a3b8', prompt: 'You are the Docs agent: documentation, comments, changelogs. Do not change behaviour.' },
  reviewer:  { label: 'Reviewer',  color: '#c4b5fd', prompt: 'You are the Reviewer agent: read changes critically, find bugs and risks, suggest fixes. Do not rewrite the code yourself.' },
  none:      { label: 'No role',   color: '#64748b', prompt: '' },
};
export const roleOf = id => ROLES[id] ?? ROLES.none;
