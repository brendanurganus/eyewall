// Calibrate the wave-field shape (WAVE_CAL in src/storm.js) against NDBC buoys: grid search on storms
// from odd years, report the same error measures on even-year storms (held out) for the best fit.
// usage: node test/buoycal.mjs cases.json
import fs from 'fs';
import ARCHIVE from '../src/archive.js';
import { prepareTrack, stormAt, trackSpan, seaAt, WAVE_CAL } from '../src/storm.js';
const cases = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
const asTrack = (s) => ({ id: s.id, name: s.name, year: s.year, eyes: s.eyes, pts: s.t.map((t, i) => ({ t, lat: s.lat[i] / 10, lon: s.lon[i] / 10, vmax: s.v[i], pmin: s.p[i], r34: s.r34[i], r50: s.r50[i], r64: s.r64[i], rmw: s.rmw[i], poci: s.poci[i] })) });
const byId = new Map(ARCHIVE.map((s) => [s.id, s]));
const P = [];
for (const c of cases) {
  const S = byId.get(c.storm), tr = prepareTrack(asTrack(S)), [t0, t1] = trackSpan(tr);
  for (const o of c.obs) { const [t, , , , hs] = o; if (hs == null || t < t0 || t > t1) continue;
    const q = stormAt(tr, t); P.push({ q, e: (c.lon - q.lon) * 111320 * Math.cos(q.lat * Math.PI / 180), n: (c.lat - q.lat) * 111320, hs, odd: S.year % 2 === 1, key: c.storm + c.buoy }); }
}
const ev = (rows) => { let se = 0, b = 0, sc = 0, bc = 0, nc = 0; const pk = new Map();
  for (const r of rows) { const m = seaAt(r.q, r.e, r.n).hs, d = m - r.hs; se += d * d; b += d; const rr = Math.hypot(r.e, r.n) / r.q.rm; if (rr < 2) { bc += d; nc++; } const k = pk.get(r.key) || [0, 0]; pk.set(r.key, [Math.max(k[0], r.hs), Math.max(k[1], m)]); }
  let pe = 0, pb = 0, gb = 0, gn = 0; for (const [o, m] of pk.values()) { pe += (m - o) ** 2; pb += m - o; if (o >= 8) { gb += m - o; gn++; } }
  return { big_bias: +(gb / gn).toFixed(2), big_n: gn, n: rows.length, rmse: +Math.sqrt(se / rows.length).toFixed(3), bias: +(b / rows.length).toFixed(2), core_bias: +(bc / nc).toFixed(2), peak_rmse: +Math.sqrt(pe / pk.size).toFixed(2), peak_bias: +(pb / pk.size).toFixed(2) }; };
const tr = P.filter((r) => r.odd), te = P.filter((r) => !r.odd);
const base = { ...WAVE_CAL };
console.log('baseline', JSON.stringify(base), 'train', JSON.stringify(ev(tr)), 'test', JSON.stringify(ev(te)));
let best = null;
if (process.env.CFG) { for (const c of process.env.CFG.split(';')) { Object.assign(WAVE_CAL, JSON.parse(c)); console.log('cfg', c, 'train', JSON.stringify(ev(tr)), 'test', JSON.stringify(ev(te))); } process.exit(0); }
// score: hourly RMSE and per-case peak RMSE weighted equally, so the fit cannot buy hourly accuracy by
// flattening the peaks (the part of a storm the app is about)
const score = (r) => r.rmse + r.peak_rmse;
const all = [];
// far field only: Young's peak (k) and the asymmetry (q) stay as published/derived; fit the fall-off and the ambient sea
for (const k of [1]) for (const q of [1]) for (const a of [0.5, 0.75, 1, 1.25, 1.5, 2]) for (const p of [1, 1.25, 1.5, 1.75, 2, 2.5]) for (const b of [0, 0.5, 0.75, 1, 1.25, 1.5, 2]) {
  Object.assign(WAVE_CAL, { k, a, p, b, q }); const r = ev(tr); all.push([score(r), k, q, a, p, b]); if (!best || score(r) < score(best.r)) best = { k, a, p, b, q, r };
}
Object.assign(WAVE_CAL, best); delete WAVE_CAL.r;
all.sort((x, y) => x[0] - y[0]); console.log('top', all.slice(0, 8).map((x) => x.map((v) => +v.toFixed(3)).join(' ')).join(' | '));
console.log('best', JSON.stringify({ k: best.k, a: best.a, p: best.p, b: best.b, q: best.q }), 'train', JSON.stringify(best.r), 'test', JSON.stringify(ev(te)));
