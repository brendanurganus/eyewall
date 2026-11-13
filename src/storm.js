// Storm reconstruction from NOAA best-track values.
// Wind: Holland, Belanger & Fritz (2010) parametric profile, fitted per-azimuth to NOAA 34-kt radii.
// Wave direction: Young (2006): dominant waves are swell from the intense-wind region right of the centre;
//        components above ~3x the peak frequency follow the local wind, with a smooth transition.
// Waves: Young (1988) equivalent-fetch parametric hurricane wave model (peak Hs, Tp) with an analytic
//        spatial shape (provisional until the Stage 6 buoy calibration).
// Coordinates: e = metres east of storm centre, n = metres north. Bearings are compass degrees.

export const KT = 0.514444, NM = 1852, G = 9.81;
const RHO = 1.15, D2R = Math.PI / 180;

const tUTC = (t) => Date.UTC(+t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6, 8), +t.slice(8, 10), +t.slice(10, 12));

function lerpFix(a, b, f) {
  const L = (x, y) => x + (y - x) * f;
  const LR = (x, y) => x.map((v, i) => L(v ?? 0, y[i] ?? 0));
  return {
    time: L(a.time, b.time), lat: L(a.lat, b.lat), lon: L(a.lon, b.lon),
    vmax: L(a.vmax, b.vmax), pmin: L(a.pmin, b.pmin), rmw: L(a.rmw, b.rmw), poci: L(a.poci, b.poci),
    r34: LR(a.r34, b.r34), r50: LR(a.r50, b.r50), r64: LR(a.r64, b.r64),
  };
}

// Clean a storm's points: fill gaps in radii / rmw / poci from neighbours so interpolation is safe.
export function prepareTrack(storm) {
  const pts = storm.pts.map((p) => ({ ...p, time: tUTC(p.t) }));
  const fill = (key, isArr) => {
    let last = null;
    for (const p of pts) { const ok = isArr ? p[key] && p[key][0] != null : p[key] != null; if (ok) last = p[key]; else if (last) p[key] = last; }
    last = null;
    for (let i = pts.length - 1; i >= 0; i--) { const p = pts[i]; const ok = isArr ? p[key] && p[key][0] != null : p[key] != null; if (ok) last = p[key]; else if (last) p[key] = last; }
  };
  fill('rmw'); fill('poci'); fill('r34', true); fill('r50', true); fill('r64', true);
  for (const p of pts) { p.rmw = p.rmw ?? 25; p.poci = p.poci ?? 1010; }
  return pts;
}

// Storm state at a UTC time (ms), with translation velocity from the track.
// Position and intensity are linear between NOAA fixes. Translation velocity is each segment's mean
// velocity, blended linearly between segment midpoints so the wind asymmetry does not jump at fixes.
export function stormAt(pts, time) {
  let i = 0;
  while (i < pts.length - 2 && pts[i + 1].time <= time) i++;
  const a = pts[i], b = pts[i + 1];
  const f = Math.min(1, Math.max(0, (time - a.time) / (b.time - a.time)));
  const s = lerpFix(a, b, f);
  const segV = (k) => {
    const p = pts[k], q = pts[k + 1], dt = (q.time - p.time) / 1000, la = (p.lat + q.lat) / 2;
    return { u: ((q.lon - p.lon) * 111320 * Math.cos(la * D2R)) / dt, v: ((q.lat - p.lat) * 111320) / dt, mid: (p.time + q.time) / 2 };
  };
  const c = segV(i), tm = Math.min(Math.max(time, pts[0].time), pts[pts.length - 1].time);
  const o = tm < c.mid ? (i > 0 ? segV(i - 1) : c) : (i < pts.length - 2 ? segV(i + 1) : c);
  const g = o.mid === c.mid ? 0 : Math.min(1, Math.max(0, (tm - c.mid) / (o.mid - c.mid)));
  return fitStorm({ ...s, u: c.u + (o.u - c.u) * g, v: c.v + (o.v - c.v) * g });
}
export const trackSpan = (pts) => [pts[0].time, pts[pts.length - 1].time];

function fitStorm(s) {
  const st = {
    time: s.time, lat: s.lat, lon: s.lon,
    vmax: s.vmax * KT, vmaxKt: s.vmax, pc: s.pmin * 100, pn: Math.max(s.poci, s.pmin + 2) * 100,
    rm: s.rmw * NM, u: s.u, v: s.v,
    r34: s.r34.map((x) => x * NM), r64: s.r64.map((x) => x * NM),
  };
  st.vt = Math.hypot(st.u, st.v);
  st.asym = 0.5;
  st.vsym = Math.max(5, st.vmax - st.asym * st.vt);
  st.dp = st.pn - st.pc;
  st.bs = Math.min(2.5, Math.max(0.8, (st.vsym * st.vsym * RHO * Math.E) / st.dp));
  st.f = 2 * 7.2921e-5 * Math.sin(st.lat * D2R);
  // per-quadrant exponent anchors so the profile passes through NOAA's 64-, 50- and 34-kt radii
  st.r50 = s.r50.map((x) => x * NM);
  st.anchors = [0, 1, 2, 3].map((qd) => {
    const out = [];
    for (const [kt, arr] of [[64, st.r64], [50, st.r50], [34, st.r34]]) {
      const rn = arr[qd], vn = kt * KT;
      if (!(rn > st.rm * 1.25) || st.vsym <= vn * 1.05) continue;
      if (out.length && rn <= out[out.length - 1].r * 1.1) continue;
      const q = Math.pow(st.rm / rn, st.bs), fr = q * Math.exp(1 - q);
      out.push({ r: rn, x: Math.min(1.8, Math.max(0.2, Math.log(vn / st.vsym) / Math.log(fr))) });
    }
    return out;
  });
  st.r34mean = st.r34.reduce((a, b) => a + b, 0) / 4 || st.rm * 6;
  st.cat = st.vmaxKt < 34 ? 'TD' : st.vmaxKt < 64 ? 'TS' : st.vmaxKt < 83 ? '1' : st.vmaxKt < 96 ? '2' : st.vmaxKt < 113 ? '3' : st.vmaxKt < 137 ? '4' : '5';
  // peak sea state (Young 1988). Coefficients checked against Young (2017, Atmosphere 8:194, eqs 5-7).
  // Inputs are clamped to the paper's fitted range, Vmax 20-60 m/s and Vfm 0-12.5 m/s (owner decision,
  // Stage 3: no extrapolation; Katrina at peak gives 18.2 m instead of 22.0 m).
  // 0.93 converts NOAA's 1-minute wind to a ~10-minute mean (factor 1.08, Harper, as given in Young 2017).
  const V = Math.min(60, Math.max(20, st.vmax * 0.93)), Vf = Math.min(12.5, st.vt);
  const Rp = Math.max(5e3, 22.5e3 * Math.log10(st.rm) - 70.8e3);
  const xr = -2.175e-3 * V * V + 1.506e-2 * V * Vf - 1.223e-1 * Vf * Vf + 2.19e-1 * V + 6.737e-1 * Vf + 7.98e-1;
  st.fetch = Math.max(2e4, xr * Rp);
  st.hsMax = 0.0016 * V * Math.sqrt(st.fetch / G);
  st.tpMax = ((0.045 * 2 * Math.PI * V) / G) * Math.pow((G * st.fetch) / (V * V), 0.33);
  return st;
}

// cosine interpolation of a per-quadrant value (NE,SE,SW,NW at 45,135,225,315 deg)
function quad(vals, brg) {
  const a = (((brg - 45) % 360) + 360) % 360 / 90;
  const i = Math.floor(a) % 4, f = a - Math.floor(a);
  const w = 0.5 - 0.5 * Math.cos(f * Math.PI);
  return vals[i] * (1 - w) + vals[(i + 1) % 4] * w;
}

function xProfile(st, qd, r) {
  const A = st.anchors[qd];
  let r0 = st.rm, x0 = 0.5;
  for (const a of A) {
    if (r <= a.r) return x0 + ((r - r0) * (a.x - x0)) / (a.r - r0);
    r0 = a.r; x0 = a.x;
  }
  if (!A.length) return 0.5;
  // beyond the 34-kt radius: keep the last slope, bounded
  const p = A.length > 1 ? A[A.length - 2] : { r: st.rm, x: 0.5 }, l = A[A.length - 1];
  return Math.min(1.8, Math.max(l.x, l.x + ((r - l.r) * (l.x - p.x)) / (l.r - p.r)));
}

// Wind, pressure at a point (e,n metres from centre).
export function windAt(st, e, n) {
  const r = Math.max(50, Math.hypot(e, n));
  const brg = Math.atan2(e, n) / D2R;
  const q = Math.pow(st.rm / r, st.bs);
  let x = 0.5;
  if (r > st.rm) {
    // blend the two nearest quadrants' piecewise-linear exponent profiles
    const a = (((brg - 45) % 360) + 360) % 360 / 90, i0 = Math.floor(a) % 4, fq = a - Math.floor(a);
    const wq = 0.5 - 0.5 * Math.cos(fq * Math.PI);
    x = xProfile(st, i0, r) * (1 - wq) + xProfile(st, (i0 + 1) % 4, r) * wq;
  }
  const vs = st.vsym * Math.pow(q * Math.exp(1 - q), x);
  const rr = r / st.rm;
  const beta = (rr < 1 ? 10 * rr : rr < 1.2 ? 10 + 75 * (rr - 1) : 25) * D2R;
  const te = -n / r, tn = e / r, re = e / r, rn2 = n / r; // tangential (CCW), radial
  const w = vs / st.vsym;
  const we = vs * (Math.cos(beta) * te - Math.sin(beta) * re) + st.asym * st.u * w;
  const wn = vs * (Math.cos(beta) * tn - Math.sin(beta) * rn2) + st.asym * st.v * w;
  const speed = Math.hypot(we, wn);
  return {
    e: we, n: wn, speed, r,
    from: ((Math.atan2(-we, -wn) / D2R) + 360) % 360,
    p: st.pc + st.dp * Math.exp(-q),
  };
}

// Sea state at a point: significant wave height, peak period, propagation direction, directional spread.
// Wave-field shape: radial fall-off and far-field swell, calibrated against NDBC buoys (tools/buoys.py,
// test/buoycal.mjs; fitted on odd-year storms, checked on even-year storms). k scales Young's peak Hs.
export const WAVE_CAL = { k: 1, a: 1, p: 1.5, b: 1.5, q: 1 }; // b: ambient sea not made by the storm (m), added in quadrature
export function seaAt(st, e, n) {
  const r = Math.max(50, Math.hypot(e, n)), rr = r / st.rm;
  const w = windAt(st, e, n);
  // bearing relative to the right-forward quadrant of motion (where fetch is longest)
  const mot = Math.atan2(st.u, st.v), brg = Math.atan2(e, n);
  const rel = brg - (mot + 70 * D2R);
  const scale = WAVE_CAL.a * Math.max(3 * st.rm, 0.6 * st.r34mean);
  const radial = rr < 1 ? 0.62 + 0.38 * Math.pow(rr, 1.5) : 1 / (1 + Math.pow((r - st.rm) / scale, WAVE_CAL.p));
  const asymK = Math.min(0.95, WAVE_CAL.q * Math.min(0.35, 0.05 + 0.03 * st.vt)) * Math.min(1, rr); // q: asymmetry strength
  const shape = radial * (1 - asymK * (0.5 - 0.5 * Math.cos(rel)));
  const hs = Math.max(0.3, Math.hypot(WAVE_CAL.k * st.hsMax * shape, WAVE_CAL.b));
  const tp = Math.max(4, st.tpMax * Math.pow(shape, 0.35));
  // waves run with the local wind, turned ~25 deg outward; inside the eye seas are confused
  // Dominant waves: swell radiating out from the intense-wind region to the right of the centre
  // (Young 2006). Close to that region they run with the local wind; elsewhere they can cross it.
  const sb = mot + 90 * D2R, se = st.rm * Math.sin(sb), sn = st.rm * Math.cos(sb);
  const qe = e - se, qn = n - sn, qd = Math.hypot(qe, qn) || 1, ws = w.speed || 1;
  const tk = smooth(0.4 * st.rm, 1.6 * st.rm, qd);
  let de = (w.e / ws) * (1 - tk) + (qe / qd) * tk, dn = (w.n / ws) * (1 - tk) + (qn / qd) * tk;
  const m = Math.hypot(de, dn) || 1; de /= m; dn /= m;
  const iso = Math.min(0.75, Math.max(0.12, 0.85 - 0.75 * rr));
  return { hs, tp, de, dn, we: w.e / ws, wn: w.n / ws, iso, wind: w };
}

// Rain rate proxy (0..1) and cloud geometry (used by sky + fog).
export function precipAt(st, e, n) {
  const r = Math.hypot(e, n), rr = r / st.rm;
  const eyeR = eyeRadius(st);
  const wall = smooth(eyeR * 0.92, eyeR * 1.15, r) * (1 - 0.75 * smooth(st.rm * 1.5, st.rm * 4.5, r));
  const brg = Math.atan2(e, n);
  const band = 0.5 + 0.5 * Math.sin(3.2 * Math.log(Math.max(rr, 0.2)) * 2.0 - 2 * brg);
  const outer = smooth(st.rm * 2, st.rm * 4, r) * (1 - smooth(st.r34mean * 0.9, st.r34mean * 1.6, r)) * Math.pow(band, 3) * 0.7;
  const inten = Math.min(1, st.vmax / 70);
  return Math.min(1, (wall + outer) * (0.35 + 0.65 * inten));
}
export const eyeRadius = (st) => Math.max(6e3, st.rm * 0.62);
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Sun direction for a UTC time and location. Returns {el, az} radians (az clockwise from north).
export function sunPosition(time, latDeg, lonDeg) {
  const d = time / 86400000 - 10957.5; // days since J2000
  const g = (357.529 + 0.98560028 * d) * D2R, q = 280.459 + 0.98564736 * d;
  const L = (q + 1.915 * Math.sin(g) + 0.02 * Math.sin(2 * g)) * D2R;
  const eps = (23.439 - 3.6e-7 * d) * D2R;
  const ra = Math.atan2(Math.cos(eps) * Math.sin(L), Math.cos(L)), dec = Math.asin(Math.sin(eps) * Math.sin(L));
  const gmst = (18.697374558 + 24.06570982441908 * d) % 24;
  const ha = ((gmst * 15 + lonDeg) * D2R) - ra;
  const lat = latDeg * D2R;
  const el = Math.asin(Math.sin(lat) * Math.sin(dec) + Math.cos(lat) * Math.cos(dec) * Math.cos(ha));
  const az = Math.atan2(-Math.sin(ha), Math.tan(dec) * Math.cos(lat) - Math.sin(lat) * Math.cos(ha));
  return { el, az: (az + 2 * Math.PI) % (2 * Math.PI) };
}
