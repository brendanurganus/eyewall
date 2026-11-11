// Space-to-storm dive: the whole hurricane ray-marched from any altitude over a curved Earth,
// using the same cloud model as the sea-level sky so the view stays continuous on the way down.
import * as THREE from 'three';
import { Pass, fsMat, rt } from './gl.js';
import { SKY_COMMON } from './sky.js';

const FS = SKY_COMMON + `
uniform mat4 uInvProj, uCamWorld; uniform vec3 uCamKm; uniform float uSeed; uniform int uDiveSteps; uniform sampler2D uSatWide, uSatCore;
vec4 photo(vec2 xz){ vec2 ll = lonlat(xz), uw = satUV(ll, uSatW), uc = satUV(ll, uSatC);
  vec3 c = mix(texture(uSatWide, uw).rgb, texture(uSatCore, uc).rgb, inRect(uc, 0.08));
  return vec4(c, inRect(uw, 0.03)); }
vec2 sph(vec3 o, vec3 d, float R){ float b = dot(o,d), c = dot(o,o)-R*R, h = b*b-c; if(h<0.) return vec2(1e9,-1e9); h = sqrt(h); return vec2(-b-h,-b+h); }
float hash1(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
void main(){
  vec4 v = uInvProj*vec4(vUv*2.-1., 1., 1.);
  vec3 rd = normalize(mat3(uCamWorld)*(v.xyz/v.w));
  vec3 Cn = vec3(0., -RE, 0.), ro = uCamKm, oc = ro - Cn;
  vec2 gi = sph(oc, rd, RE), ti = sph(oc, rd, RE + 17.2);
  bool hitG = gi.x > 0. && gi.y > 0.;
  float t0 = max(ti.x, 0.), t1 = hitG ? gi.x : ti.y;
  vec3 L = vec3(0.); float T = 1.;
  float mu = dot(rd, uSunDir), ph = 0.75 + 0.9*pow(max(mu,0.), 6.) + 2.5*pow(max(mu,0.), 40.);
  vec3 ambN = mix(uAmbCol, vec3(dot(uAmbCol, vec3(0.3333))), 0.8);
  float altKm = length(oc) - RE, wP = uUseSat*smoothstep(22., 110., altKm);
  // cloud tops take their brightness detail from the photograph
  float tint = 1.;
  if (uUseSat > 0.5) { vec2 h12 = sph(oc, rd, RE + 12.); if (h12.x > 0.) { vec4 pg = photo((ro + rd*h12.x).xz); tint = mix(1., clamp(dot(pg.rgb, vec3(0.4, 0.4, 0.2))*1.25, 0.35, 1.15), pg.a); } }
  if (wP < 0.999 && ti.y > 0. && t1 > t0) {
    float jit = hash1(gl_FragCoord.xy + uSeed), span = t1 - t0;
    float NS = float(uDiveSteps);
    for (int i = 0; i < 72; i++){
      if (i >= uDiveSteps) break;
      float f0 = (float(i) + jit)/NS, f1 = (float(i) + 1.)/NS, fa = float(i)/NS;
      float t = t0 + span*f0*f0, dt = span*(f1*f1 - fa*fa);
      vec3 p = ro + rd*t; float h = length(p - Cn) - RE; vec3 pc = vec3(p.x, h, p.z); float rain; gT = t;
      float d = density(pc, false, rain);
      if (d > 0.002 || rain > 0.002){
        float tau = 0., rr;
        tau += density(pc + uSunDir*0.4, true, rr)*0.6;
        tau += density(pc + uSunDir*1.4, true, rr)*1.4;
        tau += density(pc + uSunDir*3.6, true, rr)*3.0;
        tau *= 3.2;
        float sunT = 0.78*exp(-tau) + 0.22*exp(-0.22*tau);
        float hg = clamp(h/13., 0., 1.);
        vec3 amb = mix(ambN, uAmbCol, hg*0.6)*(0.10 + 0.9*hg*hg)*(1.-0.55*d) + uSunCol*0.012*hg;
        vec3 C = (uSunCol*0.21*sunT*ph + amb)*mix(1., tint, smoothstep(5., 9., h));
        float ext = d*5.5 + rain*1.7;
        vec3 Cr = mix(C, C*0.55 + ambN*0.035, rain*1.7/max(ext, 1e-4));
        float al = 1.-exp(-ext*dt);
        L += T*al*Cr; T *= 1.-al;
        if (T < 0.01) break;
      }
    }
  }
  vec3 bg;
  if (hitG) {
    vec3 ps = ro + rd*gi.x, n = normalize(ps - Cn);
    float sunUp = max(dot(n, uSunDir), 0.), nv = max(dot(n, -rd), 0.03);
    float fres = 0.02 + 0.98*pow(1.-nv, 5.);
    vec3 sea = vec3(0.010, 0.032, 0.062)*uSunCol*0.3183*sunUp + fres*uAmbCol*1.3;
    vec3 hv = normalize(uSunDir - rd); sea += uSunCol*0.012*pow(max(dot(n, hv), 0.), 40.);
    // storm-whitened water near the core (foam cover rises with wind)
    float r = length(ps.xz), wnd = exp(-pow(max(r - uRm, 0.)/(uRm*3.), 1.3))*smoothstep(uEyeR*0.5, uEyeR*1.1, r);
    sea = mix(sea, (ambN*1.0 + uSunCol*0.3183*sunUp*0.5)*0.75, 0.75*wnd);
    // shadow of the cloud deck on the sea
    float rr, sh = density(vec3(ps.x, 0., ps.z) + uSunDir*3.0, true, rr) + density(vec3(ps.x, 0., ps.z) + uSunDir*9.0, true, rr);
    sea *= mix(1., 0.3, clamp(sh*1.5, 0., 1.));
    vec3 haze = 1.-exp(-(8./nv)*BR*0.9);
    if (uUseSat > 0.5) { vec4 pg = photo(ps.xz); sea = mix(sea, pg.rgb*3.6, pg.a*smoothstep(8., 60., altKm)); }
    bg = sea*(1.-haze) + haze*vec3(0.25, 0.42, 0.85)*uSunI*0.05*(0.15 + 0.85*sunUp);
  } else {
    float b = length(cross(oc, rd)) - RE;
    float glow = exp(-max(b, 0.)/11.)*step(0., dot(rd, -normalize(oc)) + 0.9999);
    bg = vec3(0.22, 0.42, 1.0)*glow*uSunI*0.06 + vec3(step(0.9985, hash1(floor(vUv*900.))))*0.25*(1.-glow);
  }
  // thin air between the camera and the clouds, when looking from far above
  float alt = length(oc) - RE; vec3 airT = exp(-BR*clamp((alt - 10.)*0.2, 0., 6.));
  L = L*airT + (1.-airT)*vec3(0.25, 0.42, 0.85)*uSunI*0.045*(1.-T);
  L += T*bg;
  if (wP > 0.001) {
    // from high up, show NASA's photograph of the storm itself, sampled at cloud-top level
    vec2 hi = sph(oc, rd, RE + 9.); float tp = hi.x > 0. ? hi.x : (hitG ? gi.x : -1.);
    if (tp > 0.) { vec4 pg = photo((ro + rd*tp).xz); L = mix(L, pg.rgb*3.6 + vec3(0.03, 0.05, 0.1)*uSunI*0.02, wP*pg.a); }
  }
  gl_FragColor = vec4(L, 0.);
}`;
const BLIT = `varying vec2 vUv; uniform sampler2D uTex; void main(){ gl_FragColor = vec4(texture2D(uTex, vUv).rgb, 0.); }`;

export class Dive {
  constructor(renderer, sky) {
    this.r = renderer; this.pass = new Pass(renderer); this.sky = sky;
    this.u = { ...sky.u, uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uCamKm: { value: new THREE.Vector3() }, uSeed: { value: 0 }, uDiveSteps: { value: 56 }, uSatWide: { value: null }, uSatCore: { value: null } };
    this.mat = fsMat(FS, this.u);
    this.blit = fsMat(BLIT, { uTex: { value: null } });
    this.rt = null; this.scale = 0.5;
  }
  // draw into `target` (the post chain's scene buffer)
  draw(target, cam, w, h, full) {
    const sc = full ? 1 : this.scale, rw = Math.max(64, Math.round(w * sc)), rh = Math.max(64, Math.round(h * sc));
    if (!this.rt || this.rt.width !== rw || this.rt.height !== rh) { if (this.rt) this.rt.dispose(); this.rt = rt(rw, rh, {}); }
    this.u.uInvProj.value.copy(cam.projectionMatrixInverse); this.u.uCamWorld.value.copy(cam.matrixWorld); this.u.uSeed.value = (this.u.uSeed.value + 7.31) % 100;
    this.pass.render(this.mat, this.rt);
    this.blit.uniforms.uTex.value = this.rt.texture; this.pass.render(this.blit, target);
  }
}
