// Model vs NDBC buoys: runs the app's own wind and wave model (src/storm.js) at each buoy, hour by hour,
// for every case from tools/buoys.py. Writes one row per observation for tools/buoystats.py.
// usage: node test/buoys.mjs cases.json out.json [hsScale] [shapeScale]
import fs from 'fs';
import ARCHIVE from '../src/archive.js';
import { prepareTrack, stormAt, trackSpan, seaAt, windAt } from '../src/storm.js';
const [casesF, outF] = process.argv.slice(2);
const cases = JSON.parse(fs.readFileSync(casesF, 'utf8'));
const asTrack = (s) => ({ id: s.id, name: s.name, year: s.year, eyes: s.eyes, pts: s.t.map((t, i) => ({ t, lat: s.lat[i] / 10, lon: s.lon[i] / 10, vmax: s.v[i], pmin: s.p[i], r34: s.r34[i], r50: s.r50[i], r64: s.r64[i], rmw: s.rmw[i], poci: s.poci[i] })) });
const byId = new Map(ARCHIVE.map((s) => [s.id, s]));
const rows = [];
for (const c of cases) {
  const S = byId.get(c.storm); const tr = prepareTrack(asTrack(S)); const [t0, t1] = trackSpan(tr);
  for (const [t, wdir, wspd, gst, hs, dpd, pres] of c.obs) {
    if (t < t0 || t > t1) continue;
    const q = stormAt(tr, t);
    const e = (c.lon - q.lon) * 111320 * Math.cos(q.lat * Math.PI / 180), n = (c.lat - q.lat) * 111320;
    const w = windAt(q, e, n), s = seaAt(q, e, n);
    rows.push({ storm: c.storm, buoy: c.buoy, hull: c.hull, t, r_km: Math.hypot(e, n) / 1e3, rm_km: q.rm / 1e3, vmax: q.vmaxKt ?? q.vmax, vt: q.vt,
      m_ws: w.speed, m_p: w.p / 100, m_hs: s.hs, m_tp: s.tp, o_ws: wspd, o_gst: gst, o_hs: hs, o_tp: dpd, o_p: pres });
  }
}
fs.writeFileSync(outF, JSON.stringify(rows));
console.log(rows.length, 'model/observation pairs from', cases.length, 'cases');
