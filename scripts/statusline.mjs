#!/usr/bin/env node
// Claude Code status line command: forwards the session's status JSON (cost, context use, branch,
// 5-hour / 7-day usage limits) to the dashboard and prints a short line for the terminal.
// Agents hired from the dashboard get this automatically. For your own sessions add to
// ~/.claude/settings.json:  "statusLine": { "type": "command", "command": "node /path/to/scripts/statusline.mjs" }
let raw = '';
for await (const chunk of process.stdin) raw += chunk;
let s = {};
try { s = JSON.parse(raw); } catch { /* print an empty line below */ }
const base = process.env.ORBIT_URL || 'http://127.0.0.1:4111';
try {
  await fetch(`${base}/api/statusline`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-orbit-src': process.env.ORBIT_MANAGED ? 'managed' : 'external' }, body: JSON.stringify(s), signal: AbortSignal.timeout(1500) });
} catch { /* dashboard not running: ignore */ }
const bits = [s.model?.display_name, s.worktree?.branch ?? s.workspace?.git_worktree, s.context_window?.used_percentage != null ? `ctx ${Math.round(s.context_window.used_percentage)}%` : null, s.rate_limits?.five_hour ? `5h ${Math.round(s.rate_limits.five_hour.used_percentage)}%` : null];
console.log(bits.filter(Boolean).join(' · '));
