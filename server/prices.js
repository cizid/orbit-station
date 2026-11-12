import { readFileSync } from 'node:fs';

// USD per million tokens (input, output). These are ESTIMATES by model family; put exact numbers for the
// models you use into data/prices.json as { "claude-sonnet-5-5": { "in": 3, "out": 15 } } and they win.
const FAMILY = { opus: [5, 25], sonnet: [3, 15], haiku: [1, 5] };
const CACHE_READ = 0.1, CACHE_WRITE = 1.25;   // multiples of the input price

export function createPricing(file = null) {
  let overrides = {};
  try { overrides = JSON.parse(readFileSync(file, 'utf8')); } catch { /* no overrides */ }

  function price(model) {
    const o = overrides[model];
    if (o && Number.isFinite(o.in) && Number.isFinite(o.out)) return { in: o.in, out: o.out, exact: true };
    const fam = /opus|sonnet|haiku/.exec(String(model).toLowerCase())?.[0];
    return fam ? { in: FAMILY[fam][0], out: FAMILY[fam][1], exact: false } : null;
  }
  // null when the model is unknown: better "n/a" than a made-up number
  function cost({ in: i = 0, out = 0, cr = 0, cc = 0 }, model) {
    const p = price(model);
    return p ? (i * p.in + out * p.out + cr * p.in * CACHE_READ + cc * p.in * CACHE_WRITE) / 1e6 : null;
  }
  return { price, cost };
}
