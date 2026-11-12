// A terminal-style feed per agent, built from hook events: commands and their output, code being
// written, files read, questions, the final answer. Read-only; this is what a card shows live.

const MAX_LINES = 200;
const clip = (s, n = 160) => String(s ?? '').replace(/\r/g, '').slice(0, n);
const lines = s => String(s ?? '').split('\n').map(l => l.trimEnd()).filter(Boolean);

// text out of a tool response, whatever its shape
function outputOf(r) {
  if (r == null) return '';
  if (typeof r === 'string') return r;
  return [r.stdout, r.stderr, r.output, r.error, r.content, r.file?.content].filter(x => typeof x === 'string' && x).join('\n') || '';
}
const count = s => (s ? String(s).split('\n').length : 0);

export function createFeed({ now = Date.now } = {}) {
  const feeds = new Map(), cmds = new Map();   // sid -> ring buffer; tool_use_id -> command text

  const add = (sid, out, kind, text, extra = {}) => { out.push({ t: now(), kind, text: clip(text), ...extra }); return out; };

  // returns the new lines this event produced
  function onEvent(ev) {
    const sid = ev?.session_id;
    if (typeof sid !== 'string') return [];
    const out = [], tool = ev.tool_name, input = ev.tool_input ?? {};
    switch (ev.hook_event_name) {
      case 'UserPromptSubmit': add(sid, out, 'prompt', `> ${lines(ev.prompt)[0] ?? ''}`); break;
      case 'PreToolUse':
        if (tool === 'Bash') { const c = lines(input.command); if (ev.tool_use_id) cmds.set(ev.tool_use_id, c[0] ?? ''); add(sid, out, 'cmd', `$ ${c[0] ?? ''}${c.length > 1 ? ' …' : ''}`); }
        else if (tool === 'Edit' || tool === 'Write' || tool === 'MultiEdit') {
          const edits = tool === 'MultiEdit' ? (input.edits ?? []) : [{ old_string: input.old_string, new_string: tool === 'Write' ? input.content : input.new_string }];
          const plus = edits.reduce((n, e) => n + count(e.new_string), 0), minus = edits.reduce((n, e) => n + count(e.old_string), 0);
          add(sid, out, 'edit', `${tool === 'Write' ? 'write' : 'edit'} ${input.file_path ?? ''}  +${plus} −${minus}`);
          for (const l of lines(edits[0]?.new_string).slice(0, 5)) add(sid, out, 'code', `+ ${l}`);
        } else if (tool === 'Read' || tool === 'Grep' || tool === 'Glob' || tool === 'LS') add(sid, out, 'read', `${tool.toLowerCase()} ${input.file_path ?? input.pattern ?? input.path ?? ''}`);
        else if (tool === 'Agent' || tool === 'Task') add(sid, out, 'sub', `delegate: ${input.description ?? ''}`);
        else if (tool && tool !== 'TodoWrite') add(sid, out, 'read', `${tool.toLowerCase()} ${input.url ?? input.query ?? ''}`.trim());
        break;
      case 'PostToolUse': case 'PostToolUseFailure':
        if (tool === 'Bash') {
          const body = lines(outputOf(ev.tool_response ?? ev.error)), ok = ev.hook_event_name === 'PostToolUse';
          for (const l of body.slice(-3)) add(sid, out, 'out', l);
          add(sid, out, 'status', `${ok ? '✓' : '✗ failed'}${Number.isFinite(ev.duration_ms) ? ` ${(ev.duration_ms / 1000).toFixed(1)}s` : ''}`, { ok });
          cmds.delete(ev.tool_use_id);
        }
        break;
      case 'SubagentStop': add(sid, out, 'sub', `← ${lines(ev.last_assistant_message)[0] ?? 'done'}`); break;
      case 'Notification': add(sid, out, 'ask', `? ${ev.message ?? 'needs you'}`); break;
      case 'Stop': { const l = lines(ev.last_assistant_message)[0]; if (l) add(sid, out, 'say', l, {}); break; }
      case 'SessionStart': if (!(feeds.get(sid) ?? []).some(l => l.kind === 'note' && l.text.startsWith('session started'))) add(sid, out, 'note', `session started in ${ev.cwd ?? ''}`); break;
      case 'SessionEnd': add(sid, out, 'note', 'session ended'); break;
    }
    if (out.length) {
      const ring = feeds.get(sid) ?? [];
      ring.push(...out); if (ring.length > MAX_LINES) ring.splice(0, ring.length - MAX_LINES);
      feeds.set(sid, ring);
      if (feeds.size > 60) feeds.delete(feeds.keys().next().value);
    }
    if (cmds.size > 500) cmds.delete(cmds.keys().next().value);
    return out;
  }
  return { onEvent, tail: (sid, n = 14) => (feeds.get(sid) ?? []).slice(-n) };
}
