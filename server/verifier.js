import fs from 'node:fs';
import path from 'node:path';
import { isTask } from '../public/js/states.js';
import { RUNNERS, claimsIn, checkClaims, fileRefs, importsIn, isJsFile, isTestFile, weakening, deletesTests, median } from './evidence.js';

// Second guardrail layer, still free: it checks claims and edits against evidence.
//   hallucination -> claims without proof, files that don't exist, dependencies that aren't real
//   regression    -> tests that were green and now fail after edits, weakened/deleted tests, a turn that
//                    needs far more work than usual for this project
// Baselines (last green test run, typical turn size) are kept per project in data/baseline.json.

const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit']);
const MAX_READ = 1024 * 1024, MAX_TURNS = 30, MIN_TURNS = 5;
const defaultReadJson = f => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };

export function createVerifier({ trace, guard, file = null, now = Date.now, exists = fs.existsSync, readJson = defaultReadJson, readText = f => { try { return fs.statSync(f).size <= MAX_READ ? fs.readFileSync(f, 'utf8') : null; } catch { return null; } } } = {}) {
  const state = (file && readJson(file)) || { projects: {} };
  let timer = null;
  const proj = cwd => (state.projects[cwd] ??= { green: null, red: null, edits: 0, turns: [] });
  function save() {
    if (!file || timer) return;
    timer = setTimeout(() => {
      timer = null;
      try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(`${file}.tmp`, JSON.stringify(state)); fs.renameSync(`${file}.tmp`, file); } catch { /* keep going without persistence */ }
    }, 500);
    timer.unref?.();
  }
  const inside = (cwd, p) => { const abs = path.resolve(cwd, p); return abs.startsWith(cwd + path.sep) ? abs : null; };

  // the nearest package.json at or above the edited file, but never above the project folder
  function packageNames(cwd, filePath) {
    let dir = path.dirname(path.resolve(cwd, filePath));
    for (;;) {
      const pkg = readJson(path.join(dir, 'package.json'));
      if (pkg) return { dir, names: new Set(['dependencies', 'devDependencies', 'peerDependencies', 'optionalDependencies'].flatMap(k => Object.keys(pkg[k] ?? {}))), self: pkg.name };
      if (dir === cwd || !dir.startsWith(cwd)) return null;
      dir = path.dirname(dir);
    }
  }

  function onPreEdit(ev, sid, key, cwd) {
    const input = ev.tool_input ?? {}, f = input.file_path;
    if (typeof f !== 'string' || !cwd) return;
    proj(cwd).edits++; save();
    const added = ev.tool_name === 'Edit' ? input.new_string : ev.tool_name === 'Write' ? input.content : (input.edits ?? []).map(e => e.new_string).join('\n');
    if (isJsFile(f)) {
      const pk = packageNames(cwd, f);
      if (pk) {
        const missing = importsIn(added).filter(n => !pk.names.has(n) && n !== pk.self && !exists(path.join(pk.dir, 'node_modules', n)) && !exists(path.join(cwd, 'node_modules', n)));
        if (missing.length) guard.raise(sid, key, 'unknown-import', 'warn', `${path.basename(f)} imports ${missing.map(n => `"${n}"`).join(', ')}: not in package.json and not installed`);
      }
    }
    if (isTestFile(f)) {
      const before = ev.tool_name === 'Edit' ? input.old_string : ev.tool_name === 'Write' ? (inside(cwd, f) && readText(inside(cwd, f))) || '' : (input.edits ?? []).map(e => e.old_string).join('\n');
      for (const w of weakening(before, added)) guard.raise(sid, key, 'test-weakening', w.level, `${path.basename(f)}: ${w.msg}`);
    }
  }

  function onToolEnd(ev, sid, cwd) {
    const s = trace.raw(sid), span = s?.spans.findLast(x => x.id === ev.tool_use_id);
    if (!span || span.tool !== 'Bash' || !RUNNERS.tests.test(span.summary) || !cwd) return;
    const p = proj(cwd);
    if (span.status === 'ok') { p.green = now(); p.edits = 0; }
    else {
      if (p.green && p.edits > 0) guard.raise(sid, span.agent, 'tests-red', 'crit', `Tests were green at ${new Date(p.green).toLocaleTimeString()} and fail now after ${p.edits} edit${p.edits === 1 ? '' : 's'}: possible regression`);
      p.red = now();
    }
    save();
  }

  function onTurnEnd(ev, sid, cwd) {
    const s = trace.raw(sid);
    if (!s) return;
    const key = ev.agent_id ?? sid, isMain = key === sid;
    const since = isMain ? (s.edges.findLast(e => e.kind === 'prompt')?.t ?? s.started) : (s.agents.get(key)?.started ?? s.started);
    const spans = s.spans.filter(sp => sp.kind === 'tool' && sp.start >= since && (isMain || sp.agent === key));
    const text = ev.last_assistant_message;
    if (typeof text === 'string' && text) {
      for (const v of checkClaims(claimsIn(text), spans.filter(sp => sp.agent === key))) guard.raise(sid, key, 'unproven-claim', v.level, v.msg);
      if (cwd) {
        const written = new Set(spans.filter(sp => sp.tool === 'Write').map(sp => inside(cwd, sp.summary ?? '')).filter(Boolean));
        const missing = fileRefs(text, cwd).filter(f => !exists(f) && !written.has(f)).slice(0, 3);
        if (missing.length) guard.raise(sid, key, 'missing-file', 'warn', `Mentions ${missing.map(f => path.relative(cwd, f)).join(', ')}, which does not exist in the project`);
      }
    }
    if (isMain && cwd && spans.length) {   // is this turn much bigger than this project's usual one?
      const p = proj(cwd), calls = spans.filter(sp => !isTask(sp.tool)).length, ms = spans.reduce((n, sp) => n + ((sp.end ?? now()) - sp.start), 0);
      if (p.turns.length >= MIN_TURNS) {
        const mc = median(p.turns.map(t => t.calls)), mm = median(p.turns.map(t => t.ms));
        if (calls > Math.max(15, 3 * mc)) guard.raise(sid, sid, 'drift', 'warn', `This turn took ${calls} tool calls; typical for this project: ${Math.round(mc)}`);
        else if (ms > Math.max(60_000, 3 * mm)) guard.raise(sid, sid, 'drift', 'warn', `This turn spent ${Math.round(ms / 1000)} s in tools; typical: ${Math.round(mm / 1000)} s`);
      }
      p.turns.push({ calls, ms }); if (p.turns.length > MAX_TURNS) p.turns.shift();
      save();
    }
  }

  function onEvent(ev) {
    const sid = ev?.session_id, cwd = ev?.cwd;
    if (typeof sid !== 'string') return;
    const key = ev.agent_id ?? sid;
    switch (ev.hook_event_name) {
      case 'PreToolUse':
        if (EDIT_TOOLS.has(ev.tool_name)) onPreEdit(ev, sid, key, cwd);
        else if (ev.tool_name === 'Bash' && deletesTests(ev.tool_input?.command)) guard.raise(sid, key, 'test-weakening', 'warn', 'A command deletes test files');
        break;
      case 'PostToolUse': case 'PostToolUseFailure': onToolEnd(ev, sid, cwd); break;
      case 'Stop': case 'SubagentStop': onTurnEnd(ev, sid, cwd); break;
    }
  }
  return { onEvent, flush: () => { clearTimeout(timer); timer = null; if (file) { try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(file, JSON.stringify(state)); } catch { /* ignore */ } } } };
}
