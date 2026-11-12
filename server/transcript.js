import { openSync, readSync, closeSync, statSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';

// Claude Code writes one JSONL transcript per session (and per subagent). Hook payloads carry its path.
// The path comes from an HTTP request, so it is only followed inside ~/.claude/projects.

const MAX_READ = 8 * 1024 * 1024;

export function resolveTranscript(p, root = path.join(homedir(), '.claude', 'projects')) {
  if (typeof p !== 'string' || !path.isAbsolute(p) || !p.endsWith('.jsonl')) return null;
  try {
    const real = realpathSync(p), base = realpathSync(root);
    return real.startsWith(base + path.sep) ? real : null;
  } catch { return null; }
}

// One entry per API request (a request is written as several lines, one per content block).
// latency_ms: time from the message before it (prompt or tool result) to the first block of the answer.
export function parseUsage(text, { skipSidechain = false, prevTs = null } = {}) {
  const by = new Map();
  for (const line of text.split('\n')) {
    if (!line) continue;
    let d; try { d = JSON.parse(line); } catch { continue; }
    const ts = Date.parse(d.timestamp);
    if (d.type === 'user') { if (!Number.isNaN(ts)) prevTs = ts; continue; }
    const u = d.type === 'assistant' && d.message?.usage;
    if (!u || (skipSidechain && d.isSidechain === true)) continue;
    const id = d.requestId || d.uuid;
    const cur = by.get(id) ?? { id, ts, model: d.message.model, latency_ms: prevTs != null && !Number.isNaN(ts) ? Math.max(0, ts - prevTs) : null, in: 0, out: 0, cr: 0, cc: 0 };
    cur.in = Math.max(cur.in, u.input_tokens ?? 0); cur.out = Math.max(cur.out, u.output_tokens ?? 0);
    cur.cr = Math.max(cur.cr, u.cache_read_input_tokens ?? 0); cur.cc = Math.max(cur.cc, u.cache_creation_input_tokens ?? 0);
    by.set(id, cur);
  }
  return { requests: [...by.values()], prevTs };   // prevTs: carry it into the next chunk of the same file
}

// read what was appended since `offset`, up to the last complete line
export function readUsage(file, offset = 0, opts) {
  const size = statSync(file).size;
  if (size <= offset) return { requests: [], offset: Math.min(offset, size), prevTs: opts?.prevTs ?? null };
  const len = Math.min(size - offset, MAX_READ), buf = Buffer.alloc(len), fd = openSync(file, 'r');
  try { readSync(fd, buf, 0, len, offset); } finally { closeSync(fd); }
  const text = buf.toString('utf8'), cut = text.lastIndexOf('\n') + 1;
  const { requests, prevTs } = parseUsage(text.slice(0, cut), opts);
  return { requests, prevTs, offset: offset + Buffer.byteLength(text.slice(0, cut)) };
}
