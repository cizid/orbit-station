// Small SVG chart helpers (no library). Every function returns an HTML string.
export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const PALETTE = ['#19d3ff', '#3b82ff', '#8b5cf6', '#2de2c4', '#f2c94c', '#ff9a4a', '#ff5d8f'];

// area/line chart, series: [{ name, color, values[] }], all the same length
export function area(series, { height = 120, yLabel = n => n, empty = 'No data yet' } = {}) {
  const n = Math.max(0, ...series.map(s => s.values.length)), max = Math.max(1, ...series.flatMap(s => s.values));
  if (n < 2 || !series.some(s => s.values.some(v => v > 0))) return `<p class="empty-note">${esc(empty)}</p>`;
  const W = 400, H = height, x = i => (i / (n - 1)) * W, y = v => H - 4 - (v / max) * (H - 12);
  const grid = [0, 0.5, 1].map(f => `<line x1="0" x2="${W}" y1="${y(max * f)}" y2="${y(max * f)}" class="grid"/>`).join('');
  const paths = series.map((s, k) => {
    const pts = s.values.map((v, i) => `${x(i).toFixed(1)},${y(v).toFixed(1)}`);
    return `<defs><linearGradient id="ag${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".45"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient></defs>
      <path d="M0,${H} L${pts.join(' L')} L${W},${H} Z" fill="url(#ag${k})"/><path d="M${pts.join(' L')}" fill="none" stroke="${s.color}" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round"/>`;
  }).join('');
  return `<div class="chart-area"><div class="ylab"><span>${yLabel(max)}</span><span>${yLabel(max / 2)}</span><span>0</span></div>
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" style="height:${H}px">${grid}${paths}</svg></div>
    <div class="legend">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`;
}

// vertical bars, rows: [{ label, v, color, text }]
export function columns(rows, { height = 110, empty = 'No data yet' } = {}) {
  const max = Math.max(0, ...rows.map(r => r.v));
  if (!rows.length || max <= 0) return `<p class="empty-note">${esc(empty)}</p>`;
  return `<div class="cols" style="height:${height + 34}px">${rows.map(r => `<div class="col" title="${esc(r.label)}: ${esc(r.text ?? r.v)}">
    <span class="val">${esc(r.text ?? r.v)}</span><div class="stack" style="height:${height}px"><i style="height:${Math.max(3, r.v / max * 100)}%;background:linear-gradient(to top, ${r.color}55, ${r.color})"></i></div><span class="lab">${esc(r.label)}</span></div>`).join('')}</div>`;
}

// stacked vertical bars: rows [{ label, parts:[{v,color,name}] }]
export function stacked(rows, { height = 110, empty = 'No data yet' } = {}) {
  const tot = r => r.parts.reduce((n, p) => n + p.v, 0), max = Math.max(0, ...rows.map(tot));
  if (!rows.length || max <= 0) return `<p class="empty-note">${esc(empty)}</p>`;
  return `<div class="cols" style="height:${height + 34}px">${rows.map(r => `<div class="col"><span class="val">${esc(r.text ?? '')}</span>
    <div class="stack" style="height:${height}px"><div class="sbar" style="height:${tot(r) / max * 100}%">${r.parts.filter(p => p.v > 0).map(p => `<i title="${esc(p.name)}" style="flex:${p.v};background:${p.color}"></i>`).join('')}</div></div><span class="lab">${esc(r.label)}</span></div>`).join('')}</div>`;
}

// horizontal bars with a value on the right, rows: [{ label, v, color, text }]
export function hbars(rows, { empty = 'No data yet' } = {}) {
  const max = Math.max(0, ...rows.map(r => r.v));
  if (!rows.length || max <= 0) return `<p class="empty-note">${esc(empty)}</p>`;
  return `<div class="hbars">${rows.map(r => `<div class="hb" style="--c:${r.color}"><span class="lab" title="${esc(r.label)}">${esc(r.label)}</span><div class="track"><i style="width:${Math.max(2, r.v / max * 100)}%"></i></div><span class="num">${esc(r.text ?? r.v)}</span></div>`).join('')}</div>`;
}

// donut with a big centre value, parts: [{ v, color, name }]
export function donut(parts, { size = 120, centre = '', sub = '', empty = 'No data yet' } = {}) {
  const tot = parts.reduce((n, p) => n + p.v, 0);
  if (tot <= 0) return `<p class="empty-note">${esc(empty)}</p>`;
  const R = 42, C = 2 * Math.PI * R;
  let off = 0;
  const arcs = parts.filter(p => p.v > 0).map(p => { const len = p.v / tot * C, a = `<circle r="${R}" cx="60" cy="60" fill="none" stroke="${p.color}" stroke-width="13" stroke-dasharray="${Math.max(0, len - 2).toFixed(2)} ${(C - len + 2).toFixed(2)}" stroke-dashoffset="${(-off).toFixed(2)}" transform="rotate(-90 60 60)"><title>${esc(p.name)}: ${p.v}</title></circle>`; off += len; return a; }).join('');
  return `<div class="donut" style="width:${size}px;height:${size}px"><svg viewBox="0 0 120 120"><circle r="${R}" cx="60" cy="60" fill="none" stroke="rgba(255,255,255,.06)" stroke-width="13"/>${arcs}</svg><div class="mid"><b>${esc(centre)}</b><small>${esc(sub)}</small></div></div>`;
}

// smooth wave chart (Catmull-Rom curves), series: [{ name, color, values[] }]
export function wave(series, { height = 96, empty = 'No data yet' } = {}) {
  const n = Math.max(0, ...series.map(s => s.values.length)), max = Math.max(1, ...series.flatMap(s => s.values));
  if (n < 2 || !series.some(s => s.values.some(v => v > 0))) return `<p class="empty-note">${esc(empty)}</p>`;
  const W = 400, H = height, x = i => (i / (n - 1)) * W, y = v => H - 6 - (v / max) * (H - 14);
  const curve = vals => {
    const pts = vals.map((v, i) => [x(i), y(v)]);
    let d = `M${pts[0][0]},${pts[0][1]}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] ?? pts[i], p1 = pts[i], p2 = pts[i + 1], p3 = pts[i + 2] ?? p2;
      d += ` C${(p1[0] + (p2[0] - p0[0]) / 6).toFixed(1)},${(p1[1] + (p2[1] - p0[1]) / 6).toFixed(1)} ${(p2[0] - (p3[0] - p1[0]) / 6).toFixed(1)},${(p2[1] - (p3[1] - p1[1]) / 6).toFixed(1)} ${p2[0].toFixed(1)},${p2[1].toFixed(1)}`;
    }
    return d;
  };
  const grid = [0.25, 0.5, 0.75].map(f => `<line x1="0" x2="${W}" y1="${H * f}" y2="${H * f}" class="grid"/>`).join('');
  const paths = series.map((s, k) => `<defs><linearGradient id="wg${k}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${s.color}" stop-opacity=".35"/><stop offset="1" stop-color="${s.color}" stop-opacity="0"/></linearGradient></defs>
    <path d="${curve(s.values)} L${W},${H} L0,${H} Z" fill="url(#wg${k})"/><path d="${curve(s.values)}" fill="none" stroke="${s.color}" stroke-width="2" vector-effect="non-scaling-stroke" style="filter:drop-shadow(0 0 4px ${s.color})"/>`).join('');
  return `<svg class="wave" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" style="height:${H}px">${grid}${paths}</svg>
    <div class="legend">${series.map(s => `<span><i style="background:${s.color}"></i>${esc(s.name)}</span>`).join('')}</div>`;
}

// many thin glowing bars, values[] (oldest first)
export function spikes(values, { height = 90, color = '#19d3ff', color2 = '#8b5cf6', empty = 'No data yet' } = {}) {
  const max = Math.max(0, ...values);
  if (!values.length || max <= 0) return `<p class="empty-note">${esc(empty)}</p>`;
  return `<div class="spikes" style="height:${height}px">${values.map(v => `<i style="height:${Math.max(2, v / max * 100)}%;background:linear-gradient(to top, ${color2}, ${color})"></i>`).join('')}</div>`;
}

// concentric arcs, rows: [{ label, v, color, text }]
export function radial(rows, { size = 132, empty = 'No data yet' } = {}) {
  const max = Math.max(0, ...rows.map(r => r.v));
  if (!rows.length || max <= 0) return `<p class="empty-note">${esc(empty)}</p>`;
  const cx = 70, step = 9, R0 = 62;
  const arcs = rows.map((r, i) => {
    const R = R0 - i * step, C = 2 * Math.PI * R, len = r.v / max * C * 0.78;
    return `<circle cx="${cx}" cy="${cx}" r="${R}" fill="none" stroke="rgba(255,255,255,.07)" stroke-width="5" stroke-dasharray="${(C * 0.78).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 ${cx} ${cx})" stroke-linecap="round"/>
      <circle cx="${cx}" cy="${cx}" r="${R}" fill="none" stroke="${r.color}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${len.toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 ${cx} ${cx})" style="filter:drop-shadow(0 0 3px ${r.color})"><title>${esc(r.label)}: ${esc(r.text ?? r.v)}</title></circle>`;
  }).join('');
  return `<div class="radial"><svg viewBox="0 0 140 140" width="${size}" height="${size}">${arcs}</svg><ul>${rows.map(r => `<li style="--c:${r.color}"><i></i><span>${esc(r.label)}</span><b>${esc(r.text ?? r.v)}</b></li>`).join('')}</ul></div>`;
}

// small ring gauge, pct 0..1
export function gauge(pct, { size = 44, color = '#19d3ff' } = {}) {
  const R = 17, C = 2 * Math.PI * R;
  return `<svg class="gauge" viewBox="0 0 44 44" width="${size}" height="${size}"><circle cx="22" cy="22" r="${R}" fill="none" stroke="rgba(255,255,255,.1)" stroke-width="4"/><circle cx="22" cy="22" r="${R}" fill="none" stroke="${color}" stroke-width="4" stroke-linecap="round" stroke-dasharray="${(Math.max(0.02, Math.min(1, pct)) * C).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 22 22)" style="filter:drop-shadow(0 0 4px ${color})"/></svg>`;
}

// round avatars with a progress ring, rows: [{ label, color, pct, big, small, id }]
export function avatars(rows, { empty = 'No agents yet' } = {}) {
  if (!rows.length) return `<p class="empty-note">${esc(empty)}</p>`;
  return `<div class="avs">${rows.map(r => `<button type="button" class="av" data-id="${esc(r.id ?? '')}" style="--c:${r.color};--p:${Math.round((r.pct ?? 0) * 100)}"><span class="ring"><b>${esc(r.initials)}</b></span><strong>${esc(r.big)}</strong><em>${esc(r.label)}</em><small>${esc(r.small ?? '')}</small></button>`).join('')}</div>`;
}
