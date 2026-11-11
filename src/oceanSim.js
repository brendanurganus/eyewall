// Spectral ocean simulation: cascade 0 on the CPU (shared with physics), cascades 1..n via GPU FFT.
import * as THREE from 'three';
import { Pass, rawMat, rt, rng, gauss } from './gl.js';
import { CascadeCPU, spectrumAlpha } from './fft.js';

const SPECTRUM_FS = `
uniform sampler2D uGauss; uniform float uN, uL, uT, uKlo, uKhi, uWp, uAlpha, uSmax, uIso, uGamma, uTh, uDelta;
out vec4 o;
float ampAt(vec2 k, float dk){
  float kl = length(k); if (kl < uKlo || kl >= uKhi) return 0.;
  float w = sqrt(9.81*kl);
  float sig = w <= uWp ? 0.07 : 0.09;
  float r = exp(-(w-uWp)*(w-uWp)/(2.*sig*sig*uWp*uWp));
  float S = 96.2361*pow(w,-5.)*exp(-1.25*pow(uWp/w,4.))*pow(uGamma,r);
  float s = max(0.5, uSmax*(w <= uWp ? pow(w/uWp,5.) : pow(w/uWp,-2.5)));
  float ft = smoothstep(1.3, 3.0, w/uWp);
  float c2 = max(0., 0.5+0.5*cos(atan(k.y, k.x) - (uTh + uDelta*ft)));
  float Dn = sqrt(s)*(1.+0.125/s)/(2.*1.7724539);
  float D = (1.-uIso)*Dn*pow(c2,s) + uIso/6.2831853;
  return sqrt(uAlpha*S*(9.81/(2.*w))/kl*D)*dk*0.5;
}
void main(){
  ivec2 c = ivec2(gl_FragCoord.xy); int N = int(uN);
  ivec2 cm = ivec2((N-c.x)%N, (N-c.y)%N);
  float dk = 6.2831853/uL;
  vec2 k = dk*vec2(c.x < N/2 ? float(c.x) : float(c.x-N), c.y < N/2 ? float(c.y) : float(c.y-N));
  float kl = max(length(k), 1e-6);
  vec2 g = texelFetch(uGauss, c, 0).xy, gm = texelFetch(uGauss, cm, 0).xy;
  float a0 = (c.x==0 && c.y==0) ? 0. : ampAt(k, dk), am0 = (c.x==0 && c.y==0) ? 0. : ampAt(-k, dk);
  float w = sqrt(9.81*kl), cs = cos(w*uT), sn = sin(w*uT);
  float a = a0*g.x, b = a0*g.y, am = am0*gm.x, bm = am0*gm.y;
  float hr = a*cs + b*sn + am*cs + bm*sn, hi = b*cs - a*sn + am*sn - bm*cs;
  vec2 u = k/kl;
  // complex1 = H + i*Dx ; complex2 = Dz    (Dx = -i kx/k H)
  vec2 dx = vec2(u.x*hi, -u.x*hr), dz = vec2(u.y*hi, -u.y*hr);
  o = vec4(hr - dx.y, hi + dx.x, dz.x, dz.y);
}`;

const FFT_FS = `
uniform sampler2D uSrc, uBfly; uniform int uStage, uVert; out vec4 o;
vec2 cmul(vec2 a, vec2 b){ return vec2(a.x*b.x-a.y*b.y, a.x*b.y+a.y*b.x); }
void main(){
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec4 b = texelFetch(uBfly, ivec2(uStage, uVert==1 ? c.y : c.x), 0);
  ivec2 ca = uVert==1 ? ivec2(c.x, int(b.z)) : ivec2(int(b.z), c.y);
  ivec2 cb = uVert==1 ? ivec2(c.x, int(b.w)) : ivec2(int(b.w), c.y);
  vec4 p = texelFetch(uSrc, ca, 0), q = texelFetch(uSrc, cb, 0);
  o = vec4(p.xy + cmul(b.xy, q.xy), p.zw + cmul(b.xy, q.zw));
}`;

// raw (h, dx, dz) -> displacement (x,y,z) with choppiness
const DISP_FS = `
uniform sampler2D uSrc; uniform float uChop; out vec4 o;
void main(){ vec4 s = texelFetch(uSrc, ivec2(gl_FragCoord.xy), 0); o = vec4(uChop*s.y, s.x, uChop*s.z, 1.); }`;

const DERIV_FS = `
uniform sampler2D uDisp, uPrev; uniform float uN, uL, uDecay, uBias, uGain; out vec4 o;
vec3 D(ivec2 c){ int N = int(uN); return texelFetch(uDisp, ivec2((c.x+N)%N, (c.y+N)%N), 0).xyz; }
void main(){
  ivec2 c = ivec2(gl_FragCoord.xy);
  vec3 r = D(c+ivec2(1,0)), l = D(c-ivec2(1,0)), u = D(c+ivec2(0,1)), d = D(c-ivec2(0,1));
  float i2 = uN/(2.*uL);
  float sx = (r.y-l.y)*i2, sz = (u.y-d.y)*i2;
  float dxx = (r.x-l.x)*i2, dzz = (u.z-d.z)*i2, dxz = (u.x-d.x)*i2, dzx = (r.z-l.z)*i2;
  float J = (1.+dxx)*(1.+dzz) - dxz*dzx;
  float prev = texelFetch(uPrev, c, 0).a;
  float f = max(prev*uDecay, clamp((uBias - J)*uGain, 0., 1.));
  o = vec4(sx/max(0.35,1.+dxx), sz/max(0.35,1.+dzz), J, f);
}`;

export class OceanSim {
  // cascades: [{N, L}] ; cascade 0 is CPU
  constructor(renderer, cfg) {
    this.r = renderer; this.pass = new Pass(renderer);
    this.cfg = cfg; this.n = cfg.length; this.chop = 1.0;
    this.L = cfg.map((c) => c.L);
    const floatOK = !!renderer.extensions.get('EXT_color_buffer_float');
    const simType = floatOK ? THREE.FloatType : THREE.HalfFloatType;
    // band limits
    this.kc = cfg.map((c) => (0.95 * Math.PI * c.N) / c.L);
    this.kLo = cfg.map((c, i) => (i === 0 ? (2 * Math.PI) / c.L * 0.99 : this.kc[i - 1]));
    this.cpu = new CascadeCPU(cfg[0].N, cfg[0].L, 12345);
    this.cpuTex = new THREE.DataTexture(this.cpu.out, cfg[0].N, cfg[0].N, THREE.RGBAFormat, THREE.FloatType);
    this.cpuTex.minFilter = this.cpuTex.magFilter = THREE.NearestFilter; this.cpuTex.needsUpdate = true;
    this.casc = cfg.map((c, i) => {
      const o = { N: c.N, L: c.L };
      o.disp = rt(c.N, c.N, { wrap: THREE.RepeatWrapping, mips: true, min: THREE.LinearMipmapLinearFilter });
      o.deriv = [0, 1].map(() => rt(c.N, c.N, { wrap: THREE.RepeatWrapping, mips: true, min: THREE.LinearMipmapLinearFilter, aniso: 8 }));
      o.cur = 0;
      if (i > 0) {
        const g = new Float32Array(c.N * c.N * 4), r = rng(999 + i * 17);
        for (let k = 0; k < g.length; k++) g[k] = gauss(r);
        o.gauss = new THREE.DataTexture(g, c.N, c.N, THREE.RGBAFormat, THREE.FloatType);
        o.gauss.minFilter = o.gauss.magFilter = THREE.NearestFilter; o.gauss.needsUpdate = true;
        o.a = rt(c.N, c.N, { type: simType, min: THREE.NearestFilter, mag: THREE.NearestFilter });
        o.b = rt(c.N, c.N, { type: simType, min: THREE.NearestFilter, mag: THREE.NearestFilter });
        o.bfly = butterfly(c.N);
      }
      return o;
    });
    this.mSpec = rawMat(SPECTRUM_FS, { uGauss: { value: null }, uN: { value: 0 }, uL: { value: 0 }, uT: { value: 0 }, uKlo: { value: 0 }, uKhi: { value: 0 },
      uWp: { value: 1 }, uAlpha: { value: 0 }, uSmax: { value: 10 }, uIso: { value: 0.2 }, uGamma: { value: 3.3 }, uTh: { value: 0 }, uDelta: { value: 0 } });
    this.mFft = rawMat(FFT_FS, { uSrc: { value: null }, uBfly: { value: null }, uStage: { value: 0 }, uVert: { value: 0 } });
    this.mDisp = rawMat(DISP_FS, { uSrc: { value: null }, uChop: { value: 1 } });
    this.mDeriv = rawMat(DERIV_FS, { uDisp: { value: null }, uPrev: { value: null }, uN: { value: 0 }, uL: { value: 0 }, uDecay: { value: 0.98 }, uBias: { value: 0.8 }, uGain: { value: 3 } });
    this.P = { wp: 1, gamma: 3.3, smax: 10, iso: 0.2, th: 0, delta: 0, alpha: 0, kLo: this.kLo[0], kHi: this.kc[0] };
    this.sea = { hs: 1, tp: 8, dx: 1, dz: 0, wx: 1, wz: 0, iso: 0.2 };
    this.foamBias = 0.8; this.frame = 0;
    this.setSea(this.sea, true);
  }
  // sea = {hs, tp, dx, dz (unit propagation dir in world xz), iso}
  setSea(sea, force) {
    const s = this.sea; Object.assign(s, sea);
    const P = this.P;
    P.wp = (2 * Math.PI) / s.tp; P.iso = s.iso; P.th = Math.atan2(s.dz, s.dx);
    { const d = Math.atan2(s.wz, s.wx) - P.th; P.delta = Math.atan2(Math.sin(d), Math.cos(d)); }
    P.gamma = 2.6; P.smax = 9;
    P.alpha = spectrumAlpha(s.hs, s.tp, P.gamma, this.kLo[0], this.kc[this.n - 1]);
    this._dirty = true; if (force) { this.cpu.setSpectrum(P); this._dirty = false; }
  }
  update(t, dt) {
    const r = this.r, P = this.P; this.frame++;
    if (this._dirty && this.frame % 4 === 0) { this.cpu.setSpectrum(P); this._dirty = false; }
    this.cpu.update(t); this.cpuTex.needsUpdate = true;
    const prevAuto = r.autoClear; r.autoClear = false;
    for (let i = 0; i < this.n; i++) {
      const c = this.casc[i]; let src;
      if (i === 0) src = this.cpuTex;
      else {
        const u = this.mSpec.uniforms;
        u.uGauss.value = c.gauss; u.uN.value = c.N; u.uL.value = c.L; u.uT.value = t; u.uKlo.value = this.kLo[i]; u.uKhi.value = this.kc[i];
        u.uWp.value = P.wp; u.uAlpha.value = P.alpha; u.uSmax.value = P.smax; u.uIso.value = Math.min(0.9, P.iso + 0.15 * i); u.uGamma.value = P.gamma; u.uTh.value = P.th; u.uDelta.value = P.delta;
        this.pass.render(this.mSpec, c.a);
        let a = c.a, b = c.b; const f = this.mFft.uniforms, stages = Math.log2(c.N);
        f.uBfly.value = c.bfly;
        for (let v = 0; v < 2; v++) for (let s = 0; s < stages; s++) {
          f.uSrc.value = a.texture; f.uStage.value = s; f.uVert.value = v;
          this.pass.render(this.mFft, b); const tmp = a; a = b; b = tmp;
        }
        src = a.texture;
      }
      this.mDisp.uniforms.uSrc.value = src; this.mDisp.uniforms.uChop.value = this.chop;
      this.pass.render(this.mDisp, c.disp);
      const d = this.mDeriv.uniforms, prev = c.deriv[c.cur], next = c.deriv[1 - c.cur];
      d.uDisp.value = c.disp.texture; d.uPrev.value = prev.texture; d.uN.value = c.N; d.uL.value = c.L;
      d.uDecay.value = Math.exp(-dt / (i === 0 ? 7 : i === 1 ? 3.5 : 1.2));
      d.uBias.value = this.foamBias + (i === 0 ? 0.0 : i === 1 ? -0.12 : -0.3); d.uGain.value = i === 0 ? 2.5 : 3.5;
      this.pass.render(this.mDeriv, next); c.cur = 1 - c.cur;
    }
    r.autoClear = prevAuto; r.setRenderTarget(null);
  }
  // Re-size the cascades so the dominant wavelength is always well resolved (short-period seas need
  // a smaller largest tile, or the surface shows the texel lattice).
  setScale(Ls) {
    const cfg = this.cfg;
    Ls.forEach((L, i) => { cfg[i].L = L; this.casc[i].L = L; });
    this.L = cfg.map((c) => c.L);
    this.kc = cfg.map((c) => (0.95 * Math.PI * c.N) / c.L);
    this.kLo = cfg.map((c, i) => (i === 0 ? (2 * Math.PI) / c.L * 0.99 : this.kc[i - 1]));
    this.cpu = new CascadeCPU(cfg[0].N, cfg[0].L, 12345);
    this.cpuTex.image = { data: this.cpu.out, width: cfg[0].N, height: cfg[0].N }; this.cpuTex.needsUpdate = true;
    this.P.kLo = this.kLo[0]; this.P.kHi = this.kc[0];
    this.setSea(this.sea, true);
  }
  scaleFor(tp) { const L0 = Math.min(4000, Math.max(600, 9 * 1.56 * tp * tp)); return [L0, L0 / 8, L0 / 70]; }
  dispTex(i) { return this.casc[i].disp.texture; }
  derivTex(i) { return this.casc[i].deriv[this.casc[i].cur].texture; }
  heightAt(x, z, res) { return this.cpu.heightAt(x, z, this.chop, res); }
}

function butterfly(N) {
  const st = Math.log2(N), d = new Float32Array(st * N * 4);
  const rev = (x) => { let v = 0; for (let b = 0; b < st; b++) v |= ((x >> b) & 1) << (st - 1 - b); return v; };
  for (let s = 0; s < st; s++) {
    const span = 1 << s;
    for (let x = 0; x < N; x++) {
      const k = (x * (N >> (s + 1))) % N, a = (2 * Math.PI * k) / N;
      const top = x % (span << 1) < span; let A, B;
      if (s === 0) { A = top ? rev(x) : rev(x - 1); B = top ? rev(x + 1) : rev(x); }
      else { A = top ? x : x - span; B = top ? x + span : x; }
      const i = (x * st + s) * 4; d[i] = Math.cos(a); d[i + 1] = Math.sin(a); d[i + 2] = A; d[i + 3] = B;
    }
  }
  const t = new THREE.DataTexture(d, st, N, THREE.RGBAFormat, THREE.FloatType);
  t.minFilter = t.magFilter = THREE.NearestFilter; t.needsUpdate = true;
  return t;
}
