import fs from 'node:fs';
import path from 'node:path';

// User-changeable settings, kept in data/settings.json. The AI judge is OFF until someone turns it on.
export const JUDGE_MODES = ['off', 'manual', 'auto'];
export const JUDGE_MODELS = ['haiku', 'sonnet'];
const DEFAULTS = { judge: { mode: 'off', model: 'haiku', dailyLimit: 20 }, usage: { date: '', count: 0, cost: 0 } };

export function createSettings({ file = null, today = () => new Date().toLocaleDateString('sv') } = {}) {
  let state = structuredClone(DEFAULTS);
  try {
    const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (JUDGE_MODES.includes(saved.judge?.mode)) state.judge.mode = saved.judge.mode;
    if (JUDGE_MODELS.includes(saved.judge?.model)) state.judge.model = saved.judge.model;
    if (Number.isInteger(saved.judge?.dailyLimit)) state.judge.dailyLimit = saved.judge.dailyLimit;
    if (saved.usage?.date) state.usage = { date: String(saved.usage.date), count: Number(saved.usage.count) || 0, cost: Number(saved.usage.cost) || 0 };
  } catch { /* defaults */ }

  function save() {
    if (!file) return;
    try { fs.mkdirSync(path.dirname(file), { recursive: true }); fs.writeFileSync(`${file}.tmp`, JSON.stringify(state)); fs.renameSync(`${file}.tmp`, file); } catch { /* keep in memory */ }
  }
  const rollover = () => { if (state.usage.date !== today()) state.usage = { date: today(), count: 0, cost: 0 }; };

  return {
    get() { rollover(); return structuredClone(state); },
    // validates; returns { error } for bad input
    update(patch) {
      const j = patch?.judge ?? {};
      if (j.mode !== undefined && !JUDGE_MODES.includes(j.mode)) return { error: 'mode must be off, manual or auto' };
      if (j.model !== undefined && !JUDGE_MODELS.includes(j.model)) return { error: 'model must be haiku or sonnet' };
      if (j.dailyLimit !== undefined && !(Number.isInteger(j.dailyLimit) && j.dailyLimit >= 1 && j.dailyLimit <= 500)) return { error: 'dailyLimit must be 1-500' };
      Object.assign(state.judge, Object.fromEntries(Object.entries(j).filter(([k]) => k in state.judge)));
      save();
      return { ok: true };
    },
    canRun() { rollover(); return state.usage.count < state.judge.dailyLimit; },
    record(cost) { rollover(); state.usage.count++; state.usage.cost += Number(cost) || 0; save(); },
  };
}
