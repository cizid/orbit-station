import path from 'node:path';
import { builtinModules } from 'node:module';

// Pure checks that compare what an agent SAYS or WRITES with evidence we can look up for free:
// the trace (did a test run happen?), the file system (does that file exist?), package.json (is that
// dependency real?), and the shape of an edit (were assertions or tests removed?).
// No model, no network. They find provable problems, not everything: absence of a flag is not proof.

export const RUNNERS = {
  tests: /\b(npm|pnpm|yarn|bun)\s+(run\s+)?test\b|\bnode\s+--test\b|\b(vitest|jest|mocha|pytest|phpunit|rspec)\b|\bgo\s+test\b|\bcargo\s+test\b|\bmake\s+test\b/i,
  build: /\b(npm|pnpm|yarn|bun)\s+(run\s+)?build\b|\btsc\b(?!\s+--noEmit)|\bcargo\s+build\b|\bgo\s+build\b|\b(vite|next)\s+build\b/i,
  lint: /\b(eslint|ruff|flake8|prettier\s+--check)\b|\b(npm|pnpm|yarn)\s+(run\s+)?lint\b|\btsc\s+--noEmit\b/i,
  commit: /\bgit\s+commit\b/i,
  push: /\bgit\s+push\b/i,
};

// what the agent claims in its final message (English and German)
const CLAIMS = {
  tests: [/\btests?\s+(are\s+|were\s+|now\s+)?(pass(ed|ing)?|green|succe(ed|eded|ss))\b/i, /\ball\s+tests?\s+(pass|green)/i, /\balle\s+tests?\s+(laufen|bestanden|grün|sind\s+grün|bestehen)/i, /\btests?\s+(laufen|bestehen)\s+(alle\s+)?(durch|erfolgreich)/i, /\b\d+\s+tests?\s+(pass|passed|passing)\b/i, /\b(\d+)\s*\/\s*\1\s+tests?\b/i],
  build: [/\bbuild\s+(succeeds?|succeeded|passes|passed|works|is\s+green)\b/i, /\bbuilds?\s+(cleanly|successfully)\b/i, /\bbuild\s+(läuft|klappt|ist\s+erfolgreich)\b/i, /\bbaut\s+(fehlerfrei|durch)\b/i],
  lint: [/\b(lint|typecheck|type-?check)\s+(passes|passed|is\s+clean|clean|ok)\b/i, /\bno\s+(lint|type)\s+errors\b/i, /\bkeine\s+(lint|typ)-?fehler\b/i],
  commit: [/\b(i\s+)?committed\b/i, /\bcommit\s+(created|erstellt)\b/i, /\b(habe|hab)\s+(.{0,20})?committet\b/i, /\bcommittet\b/i],
  push: [/\b(i\s+)?pushed\b/i, /\bgepusht\b/i],
};
const NEGATION = /(\bnot\b|n't\b|\bnever\b|\bnicht\b|\bkein\w*\b|\bno\b|\bnoch\b|\bohne\b|\bbefore\b|\bunless\b)[^.!?\n]{0,25}$/i;

// is position `idx` inside a quotation? (an agent quoting a sentence it refuses to say is not claiming it)
function inQuote(text, idx) {
  const before = text.slice(Math.max(0, text.lastIndexOf('\n', idx)), idx);
  const n = ch => before.split(ch).length - 1;
  const pairs = [['„', ['“', '”', '"']], ['“', ['”']], ['«', ['»']], ['»', ['«']]];
  if (pairs.some(([o, cs]) => n(o) > cs.reduce((k, c) => k + n(c), 0))) return true;
  return n('"') % 2 === 1 || n('`') % 2 === 1;
}

export function claimsIn(text) {
  const found = [];
  const t = String(text ?? '');
  for (const [kind, patterns] of Object.entries(CLAIMS)) {
    for (const re of patterns) {
      const g = new RegExp(re.source, re.flags.includes('g') ? re.flags : re.flags + 'g');
      for (const m of t.matchAll(g)) {
        if (NEGATION.test(t.slice(Math.max(0, m.index - 30), m.index))) continue;
        if (inQuote(t, m.index)) continue;   // "not committed", "noch nicht gepusht"
        found.push({ kind, text: m[0].trim() });
        break;
      }
      if (found.some(f => f.kind === kind)) break;
    }
  }
  return found;
}

// spans: tool spans of this turn ({tool, summary, status}). Returns [{level, msg}].
export function checkClaims(claims, spans) {
  const out = [];
  for (const c of claims) {
    const runs = spans.filter(s => s.tool === 'Bash' && RUNNERS[c.kind].test(s.summary));
    if (!runs.length) out.push({ level: 'warn', msg: `Says "${c.text}" but no ${c.kind === 'tests' ? 'test run' : c.kind} command ran in this turn` });
    else if (['tests', 'build', 'lint'].includes(c.kind) && runs.at(-1).status === 'error') out.push({ level: 'crit', msg: `Says "${c.text}" but the last ${c.kind} command failed` });
  }
  return out;
}

// path-like names in a message; only ones that can be checked inside the project
const EXT = 'js|mjs|cjs|ts|tsx|jsx|json|md|css|html|py|rb|go|rs|java|yml|yaml|toml|sh|sql';
const MISSING_CONTEXT = /\b(delet|remov|renam|no longer|doesn'?t exist|does not exist|missing|gone|e\.g\.|for example|z\.\s?B\.|gelöscht|entfernt|umbenannt|nicht mehr|existiert nicht|fehlt|beispiel)/i;
export function fileRefs(text, cwd) {
  const t = String(text ?? ''), refs = new Set(), re = new RegExp(`(?:^|[\\s\`'"(\\[])((?:\\.{0,2}/)?(?:[\\w@.-]+/)*[\\w@-][\\w.@-]*\\.(?:${EXT}))(?![\\w/])`, 'gi');
  for (const m of t.matchAll(re)) {
    const ref = m[1];
    if (/https?:|:\/\//.test(t.slice(Math.max(0, m.index - 8), m.index + 1)) || ref.includes('*')) continue;
    if (MISSING_CONTEXT.test(t.slice(Math.max(0, m.index - 70), m.index + ref.length + 70))) continue;
    const abs = path.resolve(cwd, ref);
    if (abs === cwd || abs.startsWith(cwd + path.sep)) refs.add(abs);   // never probe outside the project
  }
  return [...refs];
}

// bare module names a JS/TS snippet imports
const NODE_BUILTINS = new Set(builtinModules.flatMap(m => [m, m.replace(/^node:/, '')]));
export function importsIn(code) {
  const names = new Set(), re = /(?:\bimport\s+(?:[^'"()]*?\s+from\s+)?|\bexport\s+[^'"()]*?\s+from\s+|\brequire\(\s*|\bimport\(\s*)['"]([^'"]+)['"]/g;
  for (const m of String(code ?? '').matchAll(re)) {
    const spec = m[1];
    if (/^[./#~]/.test(spec) || spec.startsWith('node:') || spec.startsWith('@/') || /^https?:/.test(spec)) continue;
    const name = spec.startsWith('@') ? spec.split('/').slice(0, 2).join('/') : spec.split('/')[0];
    if (!NODE_BUILTINS.has(name)) names.add(name);
  }
  return [...names];
}
export const isJsFile = p => /\.(m?[jt]sx?|cjs)$/.test(p ?? '');

// signs that an edit to a test file makes the suite weaker
export const isTestFile = p => /(^|\/)(__tests__|tests?|spec)\//i.test(p ?? '') || /\.(test|spec)\.[cm]?[jt]sx?$/i.test(p ?? '') || /(_test\.(go|py)|(^|\/)test_[^/]*\.py)$/i.test(p ?? '');
const count = (s, re) => (String(s ?? '').match(re) || []).length;
const ASSERT = /\b(expect|assert|should)\s*[.(]|\bassert\w*\s*\(|\.to(Be|Equal|Have|Throw|Match|Contain)\w*\s*\(|\bt\.(is|equal|deepEqual|ok|throws)\s*\(/g;
const TESTCASE = /\b(it|test)(\.\w+)?\s*\(|\bdef\s+test_|\bfunc\s+Test\w+/g;
const SKIPS = /\b(it|test|describe)\.(skip|todo|only)\b|\bx(it|describe)\b|@pytest\.mark\.skip|\bt\.Skip\(|@ts-(ignore|expect-error)|eslint-disable|istanbul ignore/g;
export function weakening(oldS, newS) {
  const a = [count(oldS, ASSERT), count(newS, ASSERT)], t = [count(oldS, TESTCASE), count(newS, TESTCASE)], k = [count(oldS, SKIPS), count(newS, SKIPS)];
  const out = [];
  if (t[1] < t[0]) out.push({ level: !String(newS ?? '').trim() ? 'crit' : 'warn', msg: `Test cases removed (${t[0]} → ${t[1]})` });
  if (a[1] < a[0]) out.push({ level: 'warn', msg: `Assertions reduced (${a[0]} → ${a[1]})` });
  if (k[1] > k[0]) out.push({ level: 'warn', msg: `Tests skipped or checks silenced (${k[1] - k[0]} new)` });
  return out;
}
export const deletesTests = cmd => /\brm\b[^|;&]*(\.test\.|\.spec\.|__tests__|\/tests?\/|_test\.)/.test(cmd ?? '');

const median = a => { const s = [...a].sort((x, y) => x - y); return s.length ? (s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2) : 0; };
export { median };
