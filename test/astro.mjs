// Moon ephemeris checks against published 2005 phase times (UTC) and illuminated fraction.
import { moonPosition, sunLux, moonLux } from '../src/astro.js';
const D = (y, m, d, h, mi) => Date.UTC(y, m - 1, d, h, mi);
for (const [lab, t, want] of [['full 19 Aug 17:53', D(2005, 8, 19, 17, 53), 0], ['last qtr 26 Aug 15:18', D(2005, 8, 26, 15, 18), 90], ['new 3 Sep 18:45', D(2005, 9, 3, 18, 45), 180], ['full 18 Sep 02:01', D(2005, 9, 18, 2, 1), 0]]) {
  const m = moonPosition(t, 29, -89);
  console.log(`${lab}: phase angle ${m.phase.toFixed(1)} (expect ~${want}), lit ${(m.lit * 100).toFixed(0)}%, ${m.waxing ? 'waxing' : 'waning'}, rel ${m.rel.toExponential(2)}`);
}
// moon over the Gulf through the night of 28-29 Aug 2005 (local CDT = UTC-5)
for (let h = 0; h <= 14; h += 2) { const t = D(2005, 8, 29, h, 0), m = moonPosition(t, 26.3, -88.6); console.log(`29 Aug ${String(h).padStart(2, '0')}Z moon el ${(m.el * 180 / Math.PI).toFixed(1)} az ${(m.az * 180 / Math.PI).toFixed(0)} lit ${(m.lit * 100).toFixed(0)}% lux ${moonLux(m).toFixed(3)}`); }
for (const e of [-20, -12, -6, 0, 10, 60]) console.log('sun el', e, 'lux', sunLux(e).toPrecision(2));
