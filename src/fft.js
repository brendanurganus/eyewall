// CPU spectral wave cascade (largest waves). Runs on the CPU so boat physics can sample the exact
// same surface that is drawn. JONSWAP spectrum with frequency-dependent directional spreading.
import { rng, gauss } from './gl.js';
const G = 9.81;

// Unnormalised JONSWAP S(w) (alpha = 1)
export function jonswap(w, wp, gamma) {
  const sig = w <= wp ? 0.07 : 0.09;
  const r = Math.exp(-((w - wp) * (w - wp)) / (2 * sig * sig * wp * wp));
  return (G * G) * Math.pow(w, -5) * Math.exp(-1.25 * Math.pow(wp / w, 4)) * Math.pow(gamma, r);
}
// alpha such that 4*sqrt(m0) = hs over [kLo,kHi]
export function spectrumAlpha(hs, tp, gamma, kLo, kHi) {
  const wp = (2 * Math.PI) / tp, w0 = Math.sqrt(G * kLo), w1 = Math.sqrt(G * kHi);
  let m0 = 0; const n = 400, lr = Math.log(w1 / w0) / n;
  for (let i = 0; i < n; i++) { const w = w0 * Math.exp((i + 0.5) * lr); m0 += jonswap(w, wp, gamma) * w * lr; }
  return (hs * hs) / 16 / m0;
}
export function ampAt(kx, kz, dk, P) {
  const kl = Math.hypot(kx, kz);
  if (kl < P.kLo || kl >= P.kHi) return 0;
  const w = Math.sqrt(G * kl);
  const S = jonswap(w, P.wp, P.gamma);
  const s = Math.max(0.5, P.smax * (w <= P.wp ? Math.pow(w / P.wp, 5) : Math.pow(w / P.wp, -2.5)));
  const fr = Math.min(1, Math.max(0, (w / P.wp - 1.3) / 1.7)), ft = fr * fr * (3 - 2 * fr);
  const c2 = Math.max(0, 0.5 + 0.5 * Math.cos(Math.atan2(kz, kx) - (P.th + P.delta * ft)));
  const Dn = (Math.sqrt(s) * (1 + 0.125 / s)) / (2 * 1.7724539);
  const D = (1 - P.iso) * Dn * Math.pow(c2, s) + P.iso / 6.2831853;
  return Math.sqrt(((P.alpha * S * (G / (2 * w))) / kl) * D) * dk * 0.5;
}

export class CascadeCPU {
  constructor(N, L, seed = 1) {
    this.N = N; this.L = L; const n2 = N * N;
    this.kx = new Float32Array(n2); this.kz = new Float32Array(n2); this.w = new Float32Array(n2);
    this.xr = new Float32Array(n2); this.xi = new Float32Array(n2); this.amp = new Float32Array(n2);
    this.ar = new Float32Array(n2); this.ai = new Float32Array(n2); this.br = new Float32Array(n2); this.bi = new Float32Array(n2);
    this.out = new Float32Array(n2 * 4);
    const r = rng(seed), dk = (2 * Math.PI) / L;
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const i = z * N + x;
      this.kx[i] = dk * (x < N / 2 ? x : x - N); this.kz[i] = dk * (z < N / 2 ? z : z - N);
      this.w[i] = Math.sqrt(G * Math.hypot(this.kx[i], this.kz[i]));
      this.xr[i] = gauss(r); this.xi[i] = gauss(r);
    }
    this.dk = dk;
    this.rev = new Uint16Array(N); const bits = Math.log2(N);
    for (let i = 0; i < N; i++) { let v = 0; for (let b = 0; b < bits; b++) v |= ((i >> b) & 1) << (bits - 1 - b); this.rev[i] = v; }
    this.cos = new Float32Array(N / 2); this.sin = new Float32Array(N / 2);
    for (let i = 0; i < N / 2; i++) { this.cos[i] = Math.cos((2 * Math.PI * i) / N); this.sin[i] = Math.sin((2 * Math.PI * i) / N); }
    this.tr = new Float32Array(N); this.ti = new Float32Array(N);
  }
  setSpectrum(P) {
    const n2 = this.N * this.N;
    for (let i = 0; i < n2; i++) this.amp[i] = i === 0 ? 0 : ampAt(this.kx[i], this.kz[i], this.dk, P);
  }
  fft1(re, im, off, stride) {
    const N = this.N, tr = this.tr, ti = this.ti, rev = this.rev;
    for (let i = 0; i < N; i++) { tr[i] = re[off + rev[i] * stride]; ti[i] = im[off + rev[i] * stride]; }
    for (let size = 2; size <= N; size <<= 1) {
      const half = size >> 1, step = N / size;
      for (let s = 0; s < N; s += size) for (let j = 0, k = 0; j < half; j++, k += step) {
        const wr = this.cos[k], wi = this.sin[k], a = s + j, b = a + half;
        const xr = tr[b] * wr - ti[b] * wi, xi = tr[b] * wi + ti[b] * wr;
        tr[b] = tr[a] - xr; ti[b] = ti[a] - xi; tr[a] += xr; ti[a] += xi;
      }
    }
    for (let i = 0; i < N; i++) { re[off + i * stride] = tr[i]; im[off + i * stride] = ti[i]; }
  }
  fft2(re, im) { const N = this.N; for (let y = 0; y < N; y++) this.fft1(re, im, y * N, 1); for (let x = 0; x < N; x++) this.fft1(re, im, x, N); }
  update(t) {
    const N = this.N, n2 = N * N, { ar, ai, br, bi, amp, xr, xi, kx, kz, w } = this;
    for (let z = 0; z < N; z++) for (let x = 0; x < N; x++) {
      const i = z * N + x, j = ((N - z) % N) * N + ((N - x) % N);
      const a = amp[i] * xr[i], b = amp[i] * xi[i], am = amp[j] * xr[j], bm = amp[j] * xi[j];
      const c = Math.cos(w[i] * t), s = Math.sin(w[i] * t);
      const hr = a * c + b * s + am * c + bm * s, hi = b * c - a * s + am * s - bm * c;
      ar[i] = hr; ai[i] = hi;
      const kl = Math.hypot(kx[i], kz[i]) || 1, ux = kx[i] / kl, uz = kz[i] / kl;
      br[i] = ux * hi + uz * hr; bi[i] = -ux * hr + uz * hi;
    }
    this.fft2(ar, ai); this.fft2(br, bi);
    const o = this.out;
    for (let i = 0; i < n2; i++) { o[i * 4] = ar[i]; o[i * 4 + 1] = br[i]; o[i * 4 + 2] = bi[i]; }
  }
  // bilinear sample: returns [height, dispX, dispZ]
  sample(x, z, res) {
    const N = this.N, fx = ((x / this.L) % 1 + 1) % 1 * N - 0.5, fz = ((z / this.L) % 1 + 1) % 1 * N - 0.5;
    const x0 = Math.floor(fx), z0 = Math.floor(fz), tx = fx - x0, tz = fz - z0;
    const xa = (x0 + N) % N, xb = (x0 + 1 + N) % N, za = (z0 + N) % N, zb = (z0 + 1 + N) % N, o = this.out;
    for (let c = 0; c < 3; c++) {
      const a = o[(za * N + xa) * 4 + c], b = o[(za * N + xb) * 4 + c], d = o[(zb * N + xa) * 4 + c], e = o[(zb * N + xb) * 4 + c];
      res[c] = a + (b - a) * tx + (d - a) * tz + (a - b - d + e) * tx * tz;
    }
    return res;
  }
  // surface height at a world point, accounting for horizontal (choppy) displacement
  heightAt(x, z, chop, res) {
    let px = x, pz = z;
    for (let i = 0; i < 3; i++) { this.sample(px, pz, res); px = x - res[1] * chop; pz = z - res[2] * chop; }
    this.sample(px, pz, res);
    return res[0];
  }
}
