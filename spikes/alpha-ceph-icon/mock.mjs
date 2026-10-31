// Mockup of Alpha Ceph's icon candidates at real size (feature/alpha-ceph-hive-name).
// Writes index.html beside it. Geometry as `Mind` (hive-art.ts): axial cells, a point up.
import { writeFileSync } from 'node:fs';

const SQ3 = Math.sqrt(3);
const hex = (x, y, r) =>
  Array.from({ length: 6 }, (_, k) => {
    const a = ((k * 60 - 90) * Math.PI) / 180;
    return `${(x + r * Math.cos(a)).toFixed(2)},${(y + r * Math.sin(a)).toFixed(2)}`;
  }).join(' ');

function cells(rings, r) {
  const out = [];
  for (let q = -rings; q <= rings; q++)
    for (let s = -rings; s <= rings; s++) {
      if (Math.abs(q + s) > rings) continue;
      out.push({ x: 12 + r * SQ3 * (q + s / 2), y: 12 + r * 1.5 * s, core: q === 0 && s === 0 });
    }
  return out;
}

let n = 0;
function icon(kind, size) {
  const id = `g${n++}`;
  const rings = kind === 'A' ? 2 : 1;
  const lit = kind === 'D' || kind === 'E';
  const r = rings === 2 ? 2.72 : 4.35;
  const gap = rings === 2 ? 0.42 : kind === 'E' ? 1.0 : 0.6;
  const defs = `<defs>
    <linearGradient id="${id}m" x1="0.2" y1="0" x2="0.8" y2="1">
      ${lit ? '<stop offset="0" stop-color="#8a767d"/><stop offset="0.5" stop-color="#4f4045"/><stop offset="1" stop-color="#241b1e"/>' : '<stop offset="0" stop-color="#4a3b41"/><stop offset="0.5" stop-color="#2a1f23"/><stop offset="1" stop-color="#120c0e"/>'}
    </linearGradient>
    <radialGradient id="${id}c"><stop offset="0" stop-color="#ff8c98"/><stop offset="0.5" stop-color="#ff283e"/><stop offset="1" stop-color="#b8101f"/></radialGradient>
    <radialGradient id="${id}k"><stop offset="0" stop-color="#ffffff"/><stop offset="0.45" stop-color="#ffe2e6"/><stop offset="1" stop-color="#ff283e"/></radialGradient>
  </defs>`;
  const body = cells(rings, r)
    .map(({ x, y, core }) => {
      const plate = r - gap;
      const chamber = plate * (core ? (lit ? 0.74 : 0.7) : lit ? 0.56 : 0.5);
      const plateEl =
        kind === 'C' || kind === 'E'
          ? `<polygon points="${hex(x, y, plate - 0.6)}" fill="none" stroke="currentColor" stroke-width="${kind === 'E' ? 1.4 : 1.2}" stroke-linejoin="round"/>`
          : `<polygon points="${hex(x, y, plate)}" fill="url(#${id}m)" stroke="#d6bac2" stroke-opacity="0.35" stroke-width="0.45"/>`;
      const chamberFill = core ? `url(#${id}k)` : `url(#${id}c)`;
      const chamberEl =
        kind === 'C' && !core
          ? ''
          : `<polygon points="${hex(x, y, (kind === 'C' || kind === 'E') ? plate * (core ? 0.62 : 0.34) : chamber)}" fill="${chamberFill}"/>`;
      return plateEl + chamberEl;
    })
    .join('');
  return `<svg width="${size}" height="${size}" viewBox="0 0 24 24" aria-hidden="true">${defs}${body}</svg>`;
}

const circleDot = (size) =>
  `<svg width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="${(1.4 * 24) / 16}"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="1"/></svg>`;

const grounds = {
  dark: { side: '#0d090a', bg: '#070506', text: '#f7f2f2', muted: '#bcaeb0', accent: '#ffc4cc', selected: 'rgba(224,36,63,.2)', warning: '#eab308' },
  light: { side: '#0d090a', bg: '#ffffff', text: '#120a0c', muted: '#5e5053', accent: '#9b1230', selected: 'rgba(224,36,63,.2)', warning: '#eab308', panel: '#f7f4f4' },
};

function row(name, draw) {
  const parts = [];
  for (const [theme, g] of Object.entries(grounds)) {
    // The sidenav is the ink in both themes (decision 615).
    const link = (color, wash, label) =>
      `<div class="link" style="color:${color};background:${wash}"><span style="color:${color}">${draw(18)}</span><span style="color:${g === grounds.dark || true ? '#f7f2f2' : g.text}">${label}</span></div>`;
    parts.push(`<div class="cell" style="background:${g.side}">
      ${link('#bcaeb0', 'transparent', 'Alpha Ceph')}
      ${link('#ffc4cc', 'rgba(224,36,63,.2)', 'Alpha Ceph')}
      ${link('#eab308', 'rgba(234,179,8,.1)', 'Alpha Ceph')}
      <div class="rail">${draw(18)}</div>
    </div>
    <div class="cell head" style="background:${g.bg};color:${g.accent}">${draw(28)}<span style="color:${theme === 'dark' ? '#f7f2f2' : '#120a0c'};font-weight:600;font-size:17px">Alpha Ceph</span></div>
    <div class="cell head" style="background:${theme === 'dark' ? '#0d090a' : '#f7f4f4'};color:${theme === 'dark' ? '#bcaeb0' : '#5e5053'}">${draw(16)}<span style="color:${theme === 'dark' ? '#f7f2f2' : '#120a0c'}">Alpha Ceph</span></div>`);
  }
  return `<tr><th>${name}<div class="big">${draw(96)}</div></th>${parts.map((p) => `<td>${p}</td>`).join('')}</tr>`;
}

const html = `<!doctype html><html><head><meta charset="utf-8"><title>Alpha Ceph icon</title>
<style>
body{margin:0;padding:16px;background:#1a1a1a;color:#ddd;font:15px Geist,system-ui,sans-serif}
table{border-collapse:collapse}th,td{padding:8px;vertical-align:top;text-align:left}
th{font-weight:600;width:150px}.big{margin-top:8px}
.cell{display:flex;flex-direction:column;gap:2px;padding:8px;border-radius:8px;margin-bottom:6px;width:190px}
.cell.head{flex-direction:row;align-items:center;gap:8px}
.link{display:flex;align-items:center;gap:10px;height:32px;padding:0 10px;border-radius:8px}
.rail{display:flex;align-items:center;justify-content:center;width:40px;height:36px;border-radius:8px}
svg{flex:none;display:block}
</style></head><body>
<table><tr><th></th><td>Dark: sidenav (resting, current, waiting, folded rail), page head 28 px, Settings list 16 px</td><td>Light (the sidenav stays ink, decision 615)</td></tr>
${row('On main: circle-dot', circleDot)}
${row('A: the whole Mind, 19 cells', (s) => icon('A', s))}
${row('B: core and first ring, 7 cells', (s) => icon('B', s))}
${row('C: 7 cells drawn in the link’s colour, the core lit', (s) => icon('C', s))}
${row('D: B in lit gunmetal, larger chambers', (s) => icon('D', s))}
${row('E: C with gaps, each chamber lit', (s) => icon('E', s))}
</table></body></html>`;
writeFileSync(new URL('./index.html', import.meta.url), html);
