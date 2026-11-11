// Shore intro: dusk beach with a single procedural coconut palm; the storm arrives over ~10 s.
import * as THREE from 'three';
import { PANO_GLSL } from './sky.js';
import { SHORE_GLSL } from './ocean.js';
import { rng } from './gl.js';
const ss = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
export function terrainJS(x, z) {
  let h = z * 0.055 + 0.9 * ss(8, 40, z) + 1.6 * ss(30, 90, z);
  h += 0.35 * Math.sin(x * 0.021 + 1.3) * ss(-20, 30, z) + 0.12 * Math.sin(x * 0.083 + z * 0.05);
  h -= 0.9 * (1 - ss(-60, -6, z)) + 3.0 * (1 - ss(-400, -40, z)) + 30 * (1 - ss(-3000, -300, z));
  return h;
}
const LIGHT = `uniform sampler2D uPano, uNoise; uniform vec3 uSunDir, uSunE; uniform float uWet, uFlash, uTime;`;
const BEACH_VS = `SHORE varying vec3 vW; void main(){ vec3 p = position; p.y = terrainH(p.xz); vW = p; gl_Position = projectionMatrix*viewMatrix*vec4(p, 1.); }`;
const BEACH_FS = PANO_GLSL + LIGHT + `SHORE varying vec3 vW;
void main(){
  vec2 xz = vW.xz; float e = 0.3;
  vec3 N = normalize(vec3(terrainH(xz-vec2(e,0.))-terrainH(xz+vec2(e,0.)), 2.*e, terrainH(xz-vec2(0.,e))-terrainH(xz+vec2(0.,e))));
  vec2 g = (texture(uNoise, xz*0.71).rg-0.5) + (texture(uNoise, xz*0.11).ba-0.5)*1.4;
  float dry = smoothstep(0.7, 1.6, vW.y);
  float rip = sin(xz.y*7.5 + xz.x*1.1 + texture(uNoise, xz*0.035).r*16.)*dry;
  float rf = 1.-smoothstep(6., 30., distance(cameraPosition, vW));
  N = normalize(N + vec3(g.x*0.2 + rip*0.01*rf, 0., g.y*0.2 + rip*0.045*rf));
  float grain = texture(uNoise, xz*2.3).b, blot = texture(uNoise, xz*0.037).g;
  vec3 alb = mix(vec3(0.50, 0.43, 0.33), vec3(0.72, 0.65, 0.53), grain*0.6 + blot*0.5);
  float wl = swash(xz, uTime);
  float wet = max(smoothstep(wl + 0.5 + 0.7*uSurf, wl - 0.05, vW.y), uWet*0.9);
  alb *= mix(1., 0.42, wet);
  vec3 V = normalize(cameraPosition - vW);
  vec3 amb = textureLod(uPano, vec2(0.5, 0.7), 12.).rgb*0.6 + textureLod(uPano, panoUV(normalize(N + vec3(0., 0.6, 0.))), 6.).rgb*0.4;
  amb += vec3(0.65, 0.78, 1.)*uFlash*0.25;
  vec3 col = alb*(amb + uSunE*max(dot(N, uSunDir), 0.)*0.3183);
  float F = 0.03 + 0.97*pow(1.-max(dot(N, V), 0.), 5.);
  vec3 R = reflect(-V, N); R.y = abs(R.y) + 0.01;
  col = mix(col, textureLod(uPano, panoUV(normalize(R)), 2.5).rgb, F*wet*0.85);
  vec3 H = normalize(V + uSunDir); col += uSunE*wet*F*8.*pow(max(dot(N, H), 0.), 180.);
  gl_FragColor = vec4(col, 0.);
}`;
const PALM_VS = `attribute vec4 aInfo; uniform vec3 uCrown, uWindDir; uniform float uBend, uTime; varying vec3 vW, vN; varying vec4 vInfo;
vec3 trunkOff(float t){ float sway = sin(uTime*1.7)*0.35 + sin(uTime*2.9 + 1.)*0.2; float b = uBend*(1. + 0.1*sway) + 0.015*sway; return uWindDir*(t*t*2.4*b) - vec3(0., t*t*1.0*b*b, 0.); }
void main(){
  vec3 p = position;
  if (aInfo.w < 0.5) p += trunkOff(aInfo.x);
  else {
    vec3 r = p - uCrown; float len = length(r); vec3 rh = r/max(len, 1e-4); float u = aInfo.x, ph = aInfo.z;
    float gust = uBend*(1. + 0.12*sin(uTime*1.3 + ph*6.) + 0.06*sin(uTime*3.1 + ph*17.)) + 0.012*sin(uTime*0.9 + ph*9.);
    float th = gust*(0.16 + 0.72*u)*(1. - 0.6*max(dot(rh, uWindDir), 0.));
    vec3 ax = cross(rh, uWindDir); float al = length(ax);
    if (al > 1e-3) { ax /= al; r = r*cos(th) + cross(ax, r)*sin(th); }
    // whole frond whips slowly as one piece; leaflet tips flutter fast but only slightly
    vec3 sd = normalize(cross(uWindDir, vec3(0., 1., 0.)));
    float whip = sin(uTime*(3.2 + 1.6*ph) + ph*40. - u*2.0), lift = sin(uTime*(2.3 + ph) + ph*20. - u*1.6);
    r += (sd*whip + vec3(0., 0.5*lift, 0.))*(0.008 + 0.15*uBend)*u*u;
    float lf = sin(uTime*(16. + 8.*fract(u*37.3 + ph)) + u*140. + ph*60.);
    r += (vec3(0., 1., 0.) + uWindDir*0.4)*lf*(0.003 + 0.045*uBend)*aInfo.y;
    p = uCrown + trunkOff(1.) + r;
  }
  vW = p; vN = normal; vInfo = aInfo; gl_Position = projectionMatrix*viewMatrix*vec4(p, 1.);
}`;
const PALM_FS = PANO_GLSL + LIGHT + `varying vec3 vW, vN; varying vec4 vInfo;
void main(){
  vec3 V = normalize(cameraPosition - vW); bool leaf = vInfo.w > 0.5;
  vec3 N = leaf ? normalize(cross(dFdx(vW), dFdy(vW))) : normalize(vN);
  if (dot(N, V) < 0.) N = -N;
  vec3 alb; 
  if (!leaf) { float rings = 0.5 + 0.5*sin(vInfo.x*165. + sin(vInfo.y*6.28)*0.8); float n = texture(uNoise, vec2(vInfo.y*2., vInfo.x*9.)).r; alb = mix(vec3(0.15, 0.125, 0.10), vec3(0.33, 0.29, 0.24), rings*0.5 + n*0.5); }
  else if (vInfo.w > 1.5) alb = vec3(0.16, 0.15, 0.05);
  else alb = mix(vec3(0.028, 0.062, 0.016), vec3(0.085, 0.14, 0.03), vInfo.y*0.5 + fract(vInfo.z*7.3)*0.5);
  alb *= mix(1., 0.6, uWet);
  vec3 amb = textureLod(uPano, vec2(0.5, 0.7), 12.).rgb*0.45 + textureLod(uPano, panoUV(normalize(N*0.7 + vec3(0., 0.45, 0.))), 6.).rgb*0.55;
  amb += vec3(0.65, 0.78, 1.)*uFlash*0.3;
  float d = max(dot(N, uSunDir), 0.), tr = leaf ? max(dot(-N, uSunDir), 0.) : 0.;
  vec3 col = alb*(amb + uSunE*0.3183*d) + vec3(0.06, 0.10, 0.02)*uSunE*0.3183*tr*0.5;
  float F = 0.04 + 0.96*pow(1.-max(dot(N, V), 0.), 5.);
  vec3 R = reflect(-V, N); R.y = abs(R.y) + 0.01;
  col += textureLod(uPano, panoUV(normalize(R)), 3.5).rgb*F*(leaf ? 0.25 + 0.5*uWet : 0.1*uWet);
  gl_FragColor = vec4(col, 1.);
}`;

function palmGeometry(base, r) {
  const pos = [], nor = [], info = [], idx = [];
  const H = 8.6, RS = 12, TS = 36, V = (x, y, z) => new THREE.Vector3(x, y, z);
  const axis = (t) => V(base.x + 1.5 * t * t + 0.25 * Math.sin(t * 3.1), base.y - 0.3 + (H + 0.3) * t, base.z + 0.35 * Math.sin(t * 2.2));
  for (let i = 0; i <= TS; i++) {
    const t = i / TS, c = axis(t), rad = 0.2 - 0.075 * t + 0.13 * Math.exp(-t * 9) + 0.012 * Math.sin(t * 165);
    for (let j = 0; j <= RS; j++) { const a = (j / RS) * Math.PI * 2; pos.push(c.x + Math.cos(a) * rad, c.y, c.z + Math.sin(a) * rad); nor.push(Math.cos(a), 0.15, Math.sin(a)); info.push(t, j / RS, 0, 0); }
    if (i < TS) for (let j = 0; j < RS; j++) { const a = i * (RS + 1) + j, b = a + RS + 1; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  }
  const crown = axis(1);
  const quad = (a, b, c, d) => { const n = pos.length / 3; return n; };
  const push = (p, u, w, ph, kind) => { pos.push(p.x, p.y, p.z); nor.push(0, 1, 0); info.push(u, w, ph, kind); return pos.length / 3 - 1; };
  const NF = 30;
  for (let f = 0; f < NF; f++) {
    const phi = f * 2.39996 + r() * 0.3, fr = Math.pow(f / (NF - 1), 0.85), ph = r();
    let el = (72 - 92 * fr + (r() - 0.5) * 14) * Math.PI / 180; const droop = (38 + r() * 24) * Math.PI / 180, Lf = 4.3 * (0.72 + 0.28 * r()) * (0.75 + 0.25 * Math.sin(fr * Math.PI));
    const NSt = 44, ds = Lf / NSt; let p = crown.clone().add(V(Math.cos(phi) * 0.12, 0.1, Math.sin(phi) * 0.12)); let prevR = null;
    for (let s = 0; s <= NSt; s++) {
      const u = s / NSt, e = el - droop * Math.pow(u, 1.5);
      const tg = V(Math.cos(e) * Math.cos(phi), Math.sin(e), Math.cos(e) * Math.sin(phi)), nn = V(-Math.sin(e) * Math.cos(phi), Math.cos(e), -Math.sin(e) * Math.sin(phi)), sd = V(-Math.sin(phi), 0, Math.cos(phi));
      // rachis: two crossed ribbons
      const rw = 0.035 * (1 - 0.8 * u) + 0.006;
      const ra = push(p.clone().addScaledVector(sd, rw), u, 0, ph, 2), rb = push(p.clone().addScaledVector(sd, -rw), u, 0, ph, 2), rc = push(p.clone().addScaledVector(nn, rw), u, 0, ph, 2), rd = push(p.clone().addScaledVector(nn, -rw), u, 0, ph, 2);
      if (prevR) { const [a, b, c, d] = prevR; idx.push(a, b, ra, b, rb, ra, c, d, rc, d, rd, rc); } prevR = [ra, rb, rc, rd];
      if (s >= 5 && s < NSt) {
        const len = 0.95 * Math.pow(Math.sin(Math.PI * (0.06 + 0.9 * u)), 0.55) * (1 - 0.25 * u) * (0.85 + 0.3 * r());
        for (const sg of [-1, 1]) {
          const va = (22 + r() * 14) * Math.PI / 180, dl = sd.clone().multiplyScalar(sg * Math.cos(va)).addScaledVector(nn, Math.sin(va)).addScaledVector(tg, 0.4 + 0.2 * r()).normalize();
          let prev = null; const dr = 0.35 + 0.3 * r();
          for (let k = 0; k <= 3; k++) {
            const w = k / 3, c = p.clone().addScaledVector(dl, len * w); c.y -= len * w * w * dr; const wd = (0.031 * (1 - Math.pow(w, 1.6)) + 0.003);
            const a = push(c.clone().addScaledVector(tg, wd), u, w, ph, 1), b = push(c.clone().addScaledVector(tg, -wd), u, w, ph, 1);
            if (prev) idx.push(prev[0], prev[1], a, prev[1], b, a); prev = [a, b];
          }
        }
      }
      p = p.clone().addScaledVector(tg, ds);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3)); g.setAttribute('aInfo', new THREE.Float32BufferAttribute(info, 4)); g.setIndex(idx);
  return { g, crown };
}

export class Shore {
  constructor(sky, noise, ocean) {
    this.group = new THREE.Group();
    this.u = { uPano: { value: sky.pano.texture }, uNoise: { value: noise }, uSunDir: { value: sky.sunDir }, uSunE: { value: new THREE.Vector3() }, uWet: { value: 0 }, uFlash: { value: 0 }, uTime: { value: 0 }, uSurf: ocean.u.uSurf,
      uCrown: { value: new THREE.Vector3() }, uWindDir: { value: new THREE.Vector3(0.86, 0, 0.5).normalize() }, uBend: { value: 0.03 } };
    const pg = new THREE.PlaneGeometry(700, 420, 280, 168); pg.rotateX(-Math.PI / 2); pg.translate(0, 0, 150);
    const beach = new THREE.Mesh(pg, new THREE.ShaderMaterial({ vertexShader: BEACH_VS.replace('SHORE', SHORE_GLSL), fragmentShader: BEACH_FS.replace('SHORE', SHORE_GLSL), uniforms: this.u }));
    beach.frustumCulled = false; this.group.add(beach);
    this.base = new THREE.Vector3(0, terrainJS(0, 13), 13);
    const { g, crown } = palmGeometry(this.base, rng(42)); this.crown = crown; this.u.uCrown.value.copy(crown);
    const palm = new THREE.Mesh(g, new THREE.ShaderMaterial({ vertexShader: PALM_VS, fragmentShader: PALM_FS, uniforms: this.u, side: THREE.DoubleSide }));
    palm.frustumCulled = false; this.group.add(palm);
    const nut = new THREE.MeshStandardMaterial({ color: 0x2c2a14, roughness: 0.6 });
    this.nuts = []; for (let i = 0; i < 6; i++) { const m = new THREE.Mesh(new THREE.SphereGeometry(0.13, 12, 10), nut); const a = i * 1.1; m.userData.o = new THREE.Vector3(Math.cos(a) * 0.24, -0.32 - (i % 2) * 0.14, Math.sin(a) * 0.24); m.scale.y = 1.2; this.group.add(m); this.nuts.push(m); }
  }
  // returns the crown's current position (for coconuts / camera target)
  update(t, bend) {
    this.u.uTime.value = t; this.u.uBend.value = bend;
    const sway = Math.sin(t * 1.7) * 0.35 + Math.sin(t * 2.9 + 1) * 0.2, b = bend * (1 + 0.1 * sway) + 0.015 * sway, w = this.u.uWindDir.value;
    const c = this.crown.clone().addScaledVector(w, 2.4 * b); c.y -= 1.0 * b * b;
    for (const n of this.nuts) n.position.copy(c).add(n.userData.o);
    return c;
  }
}
