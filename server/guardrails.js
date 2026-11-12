// Rule-based guardrails over the trace: loops, ping-pong handoffs, error cascades, runaway rate, budget.
// Pure checks, no model calls. Thresholds are plain numbers so they are easy to change.

export const LIMITS = {
  repeatWarn: 3, repeatCrit: 5,        // same tool + same arguments, back to back
  redelegateWarn: 3,                   // same task handed to a subagent this many times
  errorStreak: 3,                      // failed tool calls in a row (one agent's failure feeding the next)
  callsPerMin: 60,                     // tool calls by one agent within 60 s
  toolRunMs: 120_000,                  // a single tool call still running after this long
  costWarnUsd: 5, costCritUsd: 15,     // per session, estimated
  cooldownMs: 60_000,                  // the same alert is not raised again within this time
};

export function createGuardrails({ trace, now = Date.now, limits = LIMITS, onAlert = () => {} }) {
  const alerts = [], lastRaised = new Map();

  function raise(sid, agent, kind, level, msg) {
    const key = `${sid}|${agent}|${kind}`, at = now();
    if (at - (lastRaised.get(key) ?? -Infinity) < limits.cooldownMs) return;
    lastRaised.set(key, at);
    const alert = { id: `${at}-${alerts.length}`, sid, agent, kind, level, msg, at };
    alerts.push(alert); if (alerts.length > 200) alerts.shift();
    onAlert(alert);
  }

  function check(sid) {
    const s = trace.raw(sid);
    if (!s) return;
    const at = now();
    const toolSpans = s.spans.filter(sp => sp.kind === 'tool');

    for (const a of s.agents.values()) {
      const mine = toolSpans.filter(sp => sp.agent === a.key);
      // 1. the same call over and over
      let run = 0;
      for (let i = mine.length - 1; i >= 0 && mine[i].sig === mine.at(-1).sig; i--) run++;
      if (run >= limits.repeatCrit) raise(sid, a.key, 'loop', 'crit', `${mine.at(-1).tool} called ${run}× in a row with the same input: probably stuck in a loop`);
      else if (run >= limits.repeatWarn) raise(sid, a.key, 'loop', 'warn', `${mine.at(-1).tool} called ${run}× in a row with the same input`);
      // 2. failures piling up
      let fails = 0;
      for (let i = mine.length - 1; i >= 0 && mine[i].status === 'error'; i--) fails++;
      if (fails >= limits.errorStreak) raise(sid, a.key, 'errors', 'warn', `${fails} failed tool calls in a row: an error may be cascading`);
      // 3. runaway rate
      const recent = mine.filter(sp => at - sp.start <= 60_000).length;
      if (recent > limits.callsPerMin) raise(sid, a.key, 'rate', 'warn', `${recent} tool calls in the last minute`);
      // 4. one call that never returns
      const stuck = mine.find(sp => sp.status === 'open' && at - sp.start > limits.toolRunMs);
      if (stuck) raise(sid, a.key, 'stuck', 'warn', `${stuck.tool} has been running for ${Math.round((at - stuck.start) / 1000)} s`);
    }
    // 5. the same task handed over again and again, or handed back and forth
    const delegations = new Map();
    for (const e of s.edges) if (e.kind === 'delegate') { const k = `${e.from}|${e.text}`; delegations.set(k, (delegations.get(k) ?? 0) + 1); }
    for (const [k, n] of delegations) if (n >= limits.redelegateWarn) raise(sid, k.split('|')[0], 'handoff-loop', 'warn', `The same task was handed to a subagent ${n}×`);
    // 6. budget
    const cost = trace.sessionCost(s);
    if (cost >= limits.costCritUsd) raise(sid, sid, 'budget', 'crit', `Estimated cost $${cost.toFixed(2)} for this session`);
    else if (cost >= limits.costWarnUsd) raise(sid, sid, 'budget', 'warn', `Estimated cost $${cost.toFixed(2)} for this session`);
  }

  const active = (windowMs = 5 * 60_000) => alerts.filter(x => now() - x.at <= windowMs);
  return { check, active, all: () => alerts };
}
