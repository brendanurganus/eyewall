// Ocean surface: camera-centred polar grid displaced by the spectral cascades, physically based shading.
import * as THREE from 'three';
import { PANO_GLSL } from './sky.js';
import { perlin2D } from './gl.js';

const VS = `
uniform sampler2D uDisp0, uDisp1, uDisp2; uniform vec3 uL, uTexel; uniform vec2 uCenter; uniform float uSeaLevel, uShore, uTime;
varying vec3 vWorld; varying vec2 vXZ; varying float vDepth;
SHORE
void main(){
  vec2 xz = position.xz + uCenter; float r = length(position.xz);
  float cell = 0.035*r + 0.6;
  vec3 lod = max(log2(cell/uTexel) + 0.6, 0.);
  vec3 d = textureLod(uDisp0, xz/uL.x, lod.x).xyz + textureLod(uDisp1, xz/uL.y, lod.y).xyz
         + textureLod(uDisp2, xz/uL.z, lod.z).xyz*(1.-smoothstep(120., 420., r));
  float lvl = uSeaLevel; vDepth = 1000.;
  if (uShore > 0.5) {
    float th = terrainH(xz), dep0 = lvl - th;
    // run-up: thin sheet of water sliding up and down the beach
    lvl += swash(xz, uTime)*(1.-smoothstep(0.5, 4., dep0));
    vDepth = lvl - th;
    d *= mix(0.1, 1., smoothstep(-0.2, 3.2, vDepth));
  }
  vec3 p = vec3(xz.x, lvl, xz.y) + d;
  vWorld = p; vXZ = xz;
  gl_Position = projectionMatrix*viewMatrix*vec4(p, 1.);
}`;

const FS = PANO_GLSL + `
uniform sampler2D uDeriv0, uDeriv1, uDeriv2, uPano, uNoise, uRip;
uniform vec3 uL, uSunDir, uSunE, uWaterCol, uScatterCol, uAerCol, uBoatPos;
uniform vec2 uWindDir, uBoatFwd, uBoatDim;
uniform float uWhite, uFlash, uBoatSpd, uTime, uWind, uStreak, uCover, uHs, uRipple, uShore, uSeaLevel, uBoatOn, uWakeN;
uniform vec4 uWake[24];
varying vec3 vWorld; varying vec2 vXZ; varying float vDepth;
SHORE
float segDist(vec2 p, vec2 a, vec2 b, out float h){ vec2 pa = p-a, ba = b-a; h = clamp(dot(pa,ba)/max(dot(ba,ba),1e-4), 0., 1.); return length(pa-ba*h); }
void main(){
  vec3 V = cameraPosition - vWorld; float dist = length(V); V /= dist;
  vec2 xz = vXZ;
  vec4 d0 = texture(uDeriv0, xz/uL.x), d1 = texture(uDeriv1, xz/uL.y), d2 = texture(uDeriv2, xz/uL.z);
  float f1 = 1.-0.5*smoothstep(800., 4000., dist), f2 = 1.-smoothstep(45., 240., dist);
  float shoreAtt = uShore > 0.5 ? mix(0.25, 1., smoothstep(-0.2, 4., vDepth)) : 1.;
  vec2 slope = (d0.xy + d1.xy*f1 + d2.xy*f2)*shoreAtt;
  vec2 wv = uWindDir*uTime;
  vec2 r1 = vec2(xz.x*0.891 - xz.y*0.454, xz.x*0.454 + xz.y*0.891), r2 = vec2(xz.x*0.545 + xz.y*0.838, -xz.x*0.838 + xz.y*0.545);
  vec2 n1 = texture(uRip, r1*0.23 + wv*0.4).rg - 0.5, n2 = texture(uRip, r2*0.41 - wv.yx*0.6 + 0.3).ba - 0.5;
  slope += (n1*0.5 + n2*0.3)*uRipple*(1.-smoothstep(15., 160., dist));
  vec3 N = normalize(vec3(-slope.x, 1., -slope.y));
  float NdV = max(dot(N, V), 0.03);
  float F = 0.02 + 0.98*pow(1.-NdV, 5.);
  F *= 1.-0.35*smoothstep(0.0, 0.5, length(slope))*smoothstep(200., 2000., dist); // rough far field
  vec3 R = reflect(-V, N); R.y = abs(R.y) + 0.02; R = normalize(R);
  float rough = clamp(0.25 + 0.5*smoothstep(60., 3000., dist) + 0.4*uRipple, 0., 1.);
  vec3 refl = textureLod(uPano, panoUV(R), 0.8 + rough*4.5).rgb;
  vec3 amb = textureLod(uPano, vec2(0.5, 0.7), 12.).rgb + vec3(0.65, 0.78, 1.)*uFlash*0.16;
  refl += vec3(0.65, 0.78, 1.)*uFlash*0.2;
  vec3 H = normalize(V + uSunDir);
  float sn = mix(900., 90., clamp(uRipple*1.5, 0., 1.)); sn = mix(sn, 20., smoothstep(30., 450., dist));
  vec3 spec = uSunE*F*(sn+8.)*0.0398*pow(max(dot(N, H), 0.), sn);
  // water body + subsurface scattering in crests
  float h = mix(0.35, (vWorld.y - uSeaLevel)/max(uHs*0.5, 0.25), smoothstep(0.8, 3.0, uHs));
  float steep = smoothstep(0.08, 0.55, length(slope));
  vec3 Lh = normalize(vec3(uSunDir.x, 0., uSunDir.z) + 1e-4);
  float back = pow(max(dot(V, -Lh), 0.)*0.5+0.5, 3.);
  vec3 water = uWaterCol*(amb*1.2 + uSunE*0.03*max(uSunDir.y, 0.));
  water += uScatterCol*(amb*1.3*smoothstep(-0.2, 1.3, h)*(0.35+0.65*steep) + uSunE*0.11*back*smoothstep(0., 1.4, h)*max(uSunDir.y+0.1, 0.));
  // foam
  float fo = d0.a*1.1 + d1.a*f1*0.9 + d2.a*f2*0.6;
  float aer = textureLod(uDeriv0, xz/uL.x, 2.5).a*0.9 + textureLod(uDeriv1, xz/uL.y, 3.).a*0.6;
  // wind streaks: long foam lines aligned with the wind
  vec2 wp = vec2(dot(xz, vec2(-uWindDir.y, uWindDir.x)), dot(xz, uWindDir) - uTime*1.5);
  vec2 u1 = vec2(wp.x/6., wp.y/150.), u2 = vec2(wp.x/2.6, wp.y/60.) + 0.37, u3 = vec2(wp.x/70., wp.y/500.);
  float l1 = log2(max(max(abs(dFdx(u1.x)), abs(dFdy(u1.x)))*256., 1e-3)), l2 = log2(max(max(abs(dFdx(u2.x)), abs(dFdy(u2.x)))*256., 1e-3));
  float s1 = textureLod(uNoise, u1, max(l1, 0.)).r, s2 = textureLod(uNoise, u2, max(l2, 0.)).g, s3 = texture(uNoise, u3).b;
  float lo = mix(0.7, 0.575, uStreak), brk = texture(uNoise, xz*0.045 + 0.9).a;
  float st1 = smoothstep(lo, lo+0.1, s1*0.7 + s3*0.3)*smoothstep(0.3, 0.62, brk + s3*0.4);
  float st2 = smoothstep(lo+0.03, lo+0.12, s2*0.75 + s3*0.25)*(1.-smoothstep(60., 500., dist));
  float streak = clamp(st1*0.6 + st2*0.45, 0., 1.)*uStreak;
  streak *= mix(1., 0.5, smoothstep(300., 3000., dist));
  float cover = uCover*smoothstep(0.35, 0.7, texture(uNoise, xz*0.011 + wv*0.004).a);
  float mask = fo;
  // boat: hull foam + wake
  if (uBoatOn > 0.5) {
    vec2 bp = xz - uBoatPos.xz; vec2 side = vec2(-uBoatFwd.y, uBoatFwd.x);
    vec2 bl = vec2(dot(bp, side), dot(bp, uBoatFwd));
    if (abs(bl.x) < 400. && abs(bl.y) < 900.) {
      float e = length(bl/(uBoatDim*vec2(1.25, 1.06)));
      float hn = texture(uNoise, xz*0.05 + 0.7).g;
      float hull = smoothstep(1.1 + 0.35*hn, 0.95, e)*smoothstep(-2.5, 0.8, vWorld.y - uBoatPos.y + 1.2)*(0.3 + 0.8*hn);
      float wk = 0.;
      for (int i = 0; i < 23; i++) {
        if (float(i) >= uWakeN - 1.) break;
        float hh; float dd = segDist(xz, uWake[i].xy, uWake[i+1].xy, hh);
        float age = mix(uWake[i].z, uWake[i+1].z, hh), wd = mix(uWake[i].w, uWake[i+1].w, hh);
        wk = max(wk, smoothstep(wd, wd*0.35, dd)*exp(-age*0.11));
      }
      float tn = texture(uNoise, xz*0.07 + 0.1).r;
      float back = uBoatDim.y - bl.y;
      float wing = smoothstep(2.6, 0., abs(abs(bl.x) - back*0.36))*exp(-back/55.)*step(0., back)*uBoatSpd;
      mask += hull*(0.3 + 0.7*uBoatSpd) + wk*(0.55 + 0.9*tn) + wing*(0.5 + 0.9*tn);
      aer += wk*0.8 + hull*0.5;
    }
  }
  if (uShore > 0.5) {
    // surf zone: foam lines marching up the beach, more with rising wind
    float dep = vDepth;
    float lines = shoreFoam(xz, dep, uTime);
    mask += lines; aer += lines*0.6 + smoothstep(3., 0., dep)*0.25*uStreak;
    // shallow water: see the sand through it
    float thin = exp(-max(dep, 0.)*1.1);
    vec3 sand = vec3(0.42, 0.36, 0.27)*(amb*1.4 + uSunE*0.25*max(uSunDir.y,0.));
    water = mix(water, sand*vec3(0.75,0.95,0.9), thin*0.8);
    F *= mix(0.6, 1., smoothstep(0., 0.4, dep));
  }
  water = mix(water, uAerCol*(amb*1.0 + uSunE*0.12*max(uSunDir.y, 0.)), clamp(aer*0.9, 0., 0.8));
  vec3 col = mix(water, refl, F) + spec;
  float bub = texture(uNoise, xz*0.23 + 0.5).g*0.65 + texture(uNoise, xz*0.051).r*0.5;
  float lace = texture(uNoise, xz*0.37 + 0.2).b;
  float fa = smoothstep(0.38, 1.1, mask*1.3 - (1.-clamp(mask, 0., 1.))*(bub*0.8 + lace*0.5) + bub*0.2);
  fa *= mix(1., 0.55 + 0.45*smoothstep(0.3, 0.7, lace), smoothstep(250., 20., dist));
  // Foam regime by wind speed (Holthuijsen et al. 2012): whitecaps level off, streaks take over,
  // and by ~40 m/s they merge into a continuous white sheet of foam and spray over the waves.
  float sheet = uWhite*mix(0.68, 1.0, clamp(streak/max(uStreak, 0.01)*0.8 + cover, 0., 1.))*(0.82 + 0.18*smoothstep(0.25, 0.7, lace));
  float thin = max(sheet, (1.-uWhite)*streak*0.6);
  float thick = fa;
  fa = max(fa*0.95, thin*0.9);
  float crest = clamp((vWorld.y - uSeaLevel)/max(uHs, 0.5), -1., 1.);
  float nl = max(dot(N, uSunDir), 0.);
  vec3 foamCol = mix(vec3(0.66, 0.74, 0.73), vec3(0.88, 0.9, 0.9), max(thick, streak*0.7))*(amb*1.05*(0.84 + 0.22*crest) + uSunE*nl*0.3183)*(0.8 + 0.3*bub);
  col = mix(col, foamCol, fa);
  gl_FragColor = vec4(col, 0.);
}`;

// Shore helpers shared by ocean, beach and palm shaders (world z grows offshore -> negative z is sea)
export const SHORE_GLSL = `
uniform float uSurf;
float terrainH(vec2 xz){
  float z = xz.y;                                   // +z = inland
  float h = z*0.055 + 0.9*smoothstep(8., 40., z) + 1.6*smoothstep(30., 90., z);
  h += 0.35*sin(xz.x*0.021 + 1.3)*smoothstep(-20., 30., z) + 0.12*sin(xz.x*0.083 + z*0.05);
  h -= 0.9*smoothstep(-6., -60., z) + 3.0*smoothstep(-40., -400., z) + 30.*smoothstep(-300., -3000., z);
  return h;
}
float swash(vec2 xz, float t){
  float ph = t*0.55 + sin(xz.x*0.035)*0.9 + sin(xz.x*0.11 + 1.7)*0.35;
  return (0.10 + 0.55*uSurf)*(0.5+0.5*sin(ph)) + 0.9*uSurf;
}
float shoreFoam(vec2 xz, float dep, float t){
  float w = 0.35 + 0.65*uSurf;
  float ph = dep*(2.2 - 1.2*uSurf) + t*(0.75 + 0.6*uSurf) + sin(xz.x*0.05 + t*0.1)*1.2 + sin(xz.x*0.17)*0.5;
  float l = pow(0.5+0.5*sin(ph), 5. - 3.*uSurf);
  float zone = smoothstep(2.5 + 9.*uSurf, 0.0, dep)*smoothstep(-0.25, 0.05, dep);
  float edge = smoothstep(0.22, 0.0, dep)*smoothstep(-0.3, -0.02, dep + 0.25);
  return (l*zone*(0.6 + 1.1*uSurf) + edge*0.9)*w*1.4;
}`;

export class Ocean {
  constructor(sim, sky, noise) {
    const NR = 232, NA = 320, growth = 1.035, rmin = 0.6;
    const pos = new Float32Array((NR * NA + 1) * 3), idx = [];
    for (let j = 0; j < NR; j++) {
      const r = (rmin * (Math.pow(growth, j + 1) - 1)) / (growth - 1);
      for (let i = 0; i < NA; i++) { const a = (i / NA) * Math.PI * 2 + (j % 2) * (Math.PI / NA), k = (j * NA + i + 1) * 3; pos[k] = Math.cos(a) * r; pos[k + 2] = Math.sin(a) * r; }
    }
    for (let i = 0; i < NA; i++) idx.push(0, 1 + ((i + 1) % NA), 1 + i);
    for (let j = 0; j < NR - 1; j++) for (let i = 0; i < NA; i++) {
      const a = 1 + j * NA + i, b = 1 + j * NA + ((i + 1) % NA), c = a + NA, d = b + NA;
      idx.push(a, b, c, b, d, c);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setIndex(idx);
    this.sim = sim;
    const wake = []; for (let i = 0; i < 24; i++) wake.push(new THREE.Vector4());
    this.u = {
      uDisp0: { value: null }, uDisp1: { value: null }, uDisp2: { value: null }, uDeriv0: { value: null }, uDeriv1: { value: null }, uDeriv2: { value: null },
      uL: { value: new THREE.Vector3(...sim.L) }, uTexel: { value: new THREE.Vector3(...sim.cfg.map((c) => c.L / c.N)) },
      uCenter: { value: new THREE.Vector2() }, uSeaLevel: { value: 0 }, uShore: { value: 0 }, uSurf: { value: 0 }, uTime: { value: 0 },
      uPano: { value: sky.pano.texture }, uNoise: { value: noise }, uRip: { value: perlin2D(256) },
      uSunDir: { value: sky.sunDir }, uSunE: { value: new THREE.Vector3() },
      uWaterCol: { value: new THREE.Vector3(0.006, 0.022, 0.03) }, uScatterCol: { value: new THREE.Vector3(0.012, 0.085, 0.082) }, uAerCol: { value: new THREE.Vector3(0.16, 0.36, 0.35) },
      uWindDir: { value: new THREE.Vector2(1, 0) }, uWind: { value: 10 }, uStreak: { value: 0 }, uCover: { value: 0 }, uHs: { value: 2 }, uRipple: { value: 0.3 },
      uBoatPos: { value: new THREE.Vector3() }, uBoatFwd: { value: new THREE.Vector2(0, -1) }, uBoatDim: { value: new THREE.Vector2(4.6, 26) }, uBoatOn: { value: 0 }, uWhite: { value: 0 }, uFlash: { value: 0 }, uBoatSpd: { value: 0 },
      uWake: { value: wake }, uWakeN: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({ side: THREE.DoubleSide, vertexShader: VS.replace('SHORE', SHORE_GLSL), fragmentShader: FS.replace('SHORE', SHORE_GLSL), uniforms: this.u });
    this.mesh = new THREE.Mesh(g, mat); this.mesh.frustumCulled = false;
  }
  update(cam, time) {
    const u = this.u, s = this.sim;
    u.uDisp0.value = s.dispTex(0); u.uDisp1.value = s.dispTex(1); u.uDisp2.value = s.dispTex(2);
    u.uDeriv0.value = s.derivTex(0); u.uDeriv1.value = s.derivTex(1); u.uDeriv2.value = s.derivTex(2);
    u.uCenter.value.set(cam.position.x, cam.position.z); u.uTime.value = time; u.uHs.value = s.sea.hs;
  }
  syncScale() { const s = this.sim; this.u.uL.value.set(...s.L); this.u.uTexel.value.set(...s.cfg.map((c) => c.L / c.N)); }
  // wind: {x,z (unit toward), speed}
  setWind(wx, wz, speed) {
    const u = this.u; u.uWindDir.value.set(wx, wz); u.uWind.value = speed;
    const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
    u.uStreak.value = sm(13, 38, speed); u.uCover.value = 0.5 * sm(35, 80, speed); u.uWhite.value = sm(27, 43, speed); u.uRipple.value = 0.12 + 0.75 * sm(1, 22, speed);
    this.sim.foamBias = 0.62 + 0.24 * sm(4, 24, speed);
  }
}
