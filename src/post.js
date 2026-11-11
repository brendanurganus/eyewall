// Post chain: rain/spray fog + camera motion blur + rain streaks -> glare, auto-exposure, tone map -> lens droplets.
import * as THREE from 'three';
import { Pass, fsMat, rt } from './gl.js';
import { PANO_GLSL } from './sky.js';

const A_FS = PANO_GLSL + `
precision highp sampler3D;
varying vec2 vUv;
uniform sampler2D uScene, uDepth, uPano; uniform sampler3D uNoise3;
uniform mat4 uInvViewProj, uPrevViewProj; uniform vec3 uCamPos, uWind;
uniform vec4 uFlash; uniform float uRainGain, uFogExt, uSpray, uMB, uRain, uTime, uAspect, uSeaY; uniform vec2 uRainDir;
float hash(float n){ return fract(sin(n*127.1)*43758.5453); }
float rainLayer(vec2 uv, float cols, float speed, float seed){
  vec2 d = uRainDir; vec2 p = vec2(uv.x*d.y - uv.y*d.x, dot(uv, d));
  float cx = p.x*cols, col = floor(cx), rnd = hash(col + seed);
  float y = (p.y - uTime*speed)*(2.0 + 2.5*rnd)*cols/40. + rnd*31.;
  float cell = floor(y), f = fract(y);
  float on = step(0.55, hash(col*1.37 + cell*7.13 + seed));
  float x = fract(cx) - 0.5;
  return smoothstep(0.5, 0.0, abs(x)*2.6)*smoothstep(0., 0.2, f)*smoothstep(1., 0.45, f)*on;
}
void main(){
  float z = texture(uDepth, vUv).x;
  vec4 wp = uInvViewProj*vec4(vUv*2.-1., z*2.-1., 1.); wp /= wp.w;
  vec3 rd = wp.xyz - uCamPos; float dist = length(rd); rd /= dist;
  vec4 c0 = texture(uScene, vUv);
  vec4 pc = uPrevViewProj*vec4(wp.xyz, 1.); vec2 vel = (vUv - (pc.xy/pc.w*0.5+0.5))*uMB*(1.-c0.a);
  float vl = length(vel); if (vl > 0.035) vel *= 0.035/vl;
  vec3 col = c0.rgb;
  if (vl > 0.0006) { col = vec3(0.); float wsum = 0.;
    for (int i = 0; i < 9; i++){ vec4 s = texture(uScene, vUv - vel*(float(i)/8. - 0.5)); float w = 1.-s.a*0.9; col += s.rgb*w; wsum += w; }
    col = wsum > 0.01 ? col/wsum : c0.rgb; }
  vec3 fdir = normalize(vec3(rd.x, max(rd.y, 0.02) + 0.03, rd.z));
  vec3 fc = textureLod(uPano, panoUV(fdir), 4.5).rgb;
  if (z < 1.) {
    float n = 0.; vec3 wsh = uWind*uTime;
    n += texture(uNoise3, (uCamPos + rd*min(dist, 60.) - wsh)*0.0035).r;
    n += texture(uNoise3, (uCamPos + rd*min(dist, 220.) - wsh)*0.0013).r;
    n += texture(uNoise3, (uCamPos + rd*min(dist, 700.) - wsh)*0.0006).g;
    float ext = uFogExt*(0.35 + 1.6*pow(n/3., 1.5)*1.9);
    float y0 = max(uCamPos.y - uSeaY, 0.), y1 = max(wp.y - uSeaY, 0.), Hs = 9.;
    float dy = (y1 - y0)/Hs;
    float layer = abs(dy) > 1e-3 ? (exp(-y0/Hs) - exp(-y1/Hs))/dy : exp(-y0/Hs);
    float tau = (ext + uSpray*layer + 2.5e-5)*dist;
    float fT = exp(-tau);
    col = mix(fc, col, fT);
    float fd = max(dot(rd, uFlash.xyz), 0.);
    col += vec3(0.62, 0.76, 1.)*uFlash.w*(1.-fT)*(0.3 + 2.2*pow(fd, 5.) + 5.*pow(fd, 40.));
  } else {
    float fd = max(dot(rd, uFlash.xyz), 0.);
    col += vec3(0.62, 0.76, 1.)*uFlash.w*(0.3 + 2.2*pow(fd, 5.) + 5.*pow(fd, 40.));
  }
  if (uRain > 0.01) {
    vec2 uv = (vUv - 0.5)*vec2(uAspect, 1.);
    float r = rainLayer(uv, 90., 1.9, 1.)*0.5 + rainLayer(uv*1.7 + 3., 90., 2.6, 5.)*0.35 + rainLayer(uv*3.1 + 7., 90., 3.4, 9.)*0.25;
    col += (fc*0.9 + 0.02)*r*uRain*uRainGain;
  }
  gl_FragColor = vec4(col, 1.);
}`;

const EXP_FS = `
varying vec2 vUv; uniform sampler2D uHdr, uPrev; uniform float uRate, uKey, uLod;
void main(){
  vec3 s = vec3(0.);
  s += textureLod(uHdr, vec2(0.5, 0.45), uLod).rgb*2.; s += textureLod(uHdr, vec2(0.3, 0.4), uLod).rgb; s += textureLod(uHdr, vec2(0.7, 0.4), uLod).rgb;
  s += textureLod(uHdr, vec2(0.5, 0.7), uLod).rgb; s += textureLod(uHdr, vec2(0.5, 0.2), uLod).rgb;
  float lum = max(dot(s/6., vec3(0.2126, 0.7152, 0.0722)), 1e-4);
  float target = clamp(uKey/lum, 0.01, 400.);
  float prev = texture(uPrev, vec2(0.5)).r;
  float e = prev <= 0. ? target : exp(mix(log(prev), log(target), uRate));
  gl_FragColor = vec4(e, e, e, 1.);
}`;

const B_FS = `
varying vec2 vUv; uniform sampler2D uHdr, uExp; uniform float uGlare, uTime, uFade, uSat;
vec3 aces(vec3 x){ x *= 0.6; return clamp((x*(2.51*x+0.03))/(x*(2.43*x+0.59)+0.14), 0., 1.); }
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898,78.233)))*43758.5453); }
void main(){
  float e = texture(uExp, vec2(0.5)).r;
  vec3 c = texture(uHdr, vUv).rgb;
  vec3 g = textureLod(uHdr, vUv, 2.5).rgb*0.3 + textureLod(uHdr, vUv, 4.).rgb*0.3 + textureLod(uHdr, vUv, 5.5).rgb*0.25 + textureLod(uHdr, vUv, 7.).rgb*0.15;
  c = mix(c, g, uGlare);
  c *= e;
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(vec3(l), c, uSat);
  c = aces(c);
  vec2 q = vUv - 0.5; c *= 1. - dot(q, q)*0.55;
  c = pow(c, vec3(1./2.2));
  c += (hash(vUv*vec2(1920., 1080.) + fract(uTime)*71.) - 0.5)*0.022;
  gl_FragColor = vec4(c*uFade, 1.);
}`;

const C_FS = `
varying vec2 vUv; uniform sampler2D uLdr; uniform float uTime, uWet, uAspect; uniform vec2 uSlide;
vec3 hash3(vec2 p){ vec3 q = vec3(dot(p, vec2(127.1, 311.7)), dot(p, vec2(269.5, 183.3)), dot(p, vec2(419.2, 371.9))); return fract(sin(q)*43758.5453); }
vec3 drops(vec2 uv, float scale, float t, float amount){
  vec2 g = uv*scale, id = floor(g), f = fract(g) - 0.5;
  vec3 r = hash3(id);
  float cyc = t*(0.07 + 0.13*r.z) + r.x*7.;
  vec3 r2 = hash3(id + floor(cyc)*13.7);
  float life = fract(cyc), present = step(r2.y, amount);
  vec2 c = (r2.xz - 0.5)*0.5 + uSlide*life*life*0.22;
  float size = (0.05 + 0.13*r2.x*r2.x)*smoothstep(0., 0.03, life)*(1. - smoothstep(0.65, 1., life));
  vec2 dv = f - c; dv.y *= 1.12;
  float d = length(dv);
  float m = smoothstep(size, size*0.72, d)*present;
  return vec3(dv/max(size, 1e-3)*m, m);
}
void main(){
  vec2 uv = vUv; vec3 col;
  if (uWet > 0.005) {
    vec2 a = vec2(uAspect, 1.);
    vec3 d1 = drops(uv*a, 5., uTime, uWet*0.2), d2 = drops(uv*a + 3.1, 11., uTime*1.3, uWet*0.32), d3 = drops(uv*a + 7.7, 23., uTime*1.6, uWet*0.4);
    vec2 off = d1.xy*0.05 + d2.xy*0.028 + d3.xy*0.014;
    float m = max(d1.z, max(d2.z, d3.z));
    float film = uWet*0.45*(0.5 + 0.5*sin(uv.y*9. + uTime*0.7 + sin(uv.x*7.)*2.));
    col = textureLod(uLdr, uv - off/a*1.6, m*1.6 + film*1.2).rgb;
    float rim = dot(off, vec2(0.6, -0.8));
    col += m*(0.012 + max(rim, 0.)*0.8)*vec3(0.9, 0.95, 1.);
  } else col = texture(uLdr, uv).rgb;
  gl_FragColor = vec4(col, 1.);
}`;

export class Post {
  constructor(renderer, sky, w, h) {
    this.r = renderer; this.pass = new Pass(renderer); this.sky = sky;
    this.exp = [rt(1, 1, { min: THREE.NearestFilter, mag: THREE.NearestFilter }), rt(1, 1, { min: THREE.NearestFilter, mag: THREE.NearestFilter })];
    this.ei = 0; this.prevVP = new THREE.Matrix4(); this.vp = new THREE.Matrix4(); this.inv = new THREE.Matrix4();
    this.mA = fsMat(A_FS, { uScene: { value: null }, uDepth: { value: null }, uPano: { value: sky.pano.texture }, uNoise3: { value: sky.noise },
      uInvViewProj: { value: this.inv }, uPrevViewProj: { value: this.prevVP }, uCamPos: { value: new THREE.Vector3() }, uWind: { value: new THREE.Vector3() },
      uFlash: { value: new THREE.Vector4(0, 1, 0, 0) }, uRainGain: { value: 0.3 }, uFogExt: { value: 0 }, uSpray: { value: 0 }, uMB: { value: 1 }, uRain: { value: 0 }, uTime: { value: 0 }, uAspect: { value: 1 }, uSeaY: { value: 0 }, uRainDir: { value: new THREE.Vector2(0, -1) } });
    this.mE = fsMat(EXP_FS, { uHdr: { value: null }, uPrev: { value: null }, uRate: { value: 0.05 }, uKey: { value: 0.16 }, uLod: { value: 6 } });
    this.mB = fsMat(B_FS, { uHdr: { value: null }, uExp: { value: null }, uGlare: { value: 0.06 }, uTime: { value: 0 }, uFade: { value: 1 }, uSat: { value: 0.92 } });
    this.mC = fsMat(C_FS, { uLdr: { value: null }, uTime: { value: 0 }, uWet: { value: 0 }, uAspect: { value: 1 }, uSlide: { value: new THREE.Vector2(0, -1) } });
    this.opts = { motionBlur: true, lens: true };
    this.wet = 0; this.fade = 1; this.msaa = 4;
    this.resize(w, h);
  }
  resize(w, h) {
    this.w = w; this.h = h;
    for (const k of ['scene', 'hdr', 'ldr']) if (this[k]) this[k].dispose();
    this.scene = rt(w, h, { depth: true, samples: this.msaa });
    this.scene.depthTexture = new THREE.DepthTexture(w, h); this.scene.depthTexture.type = THREE.UnsignedIntType;
    this.hdr = rt(w, h, { mips: true, min: THREE.LinearMipmapLinearFilter });
    this.ldr = rt(w, h, { type: THREE.UnsignedByteType, mips: true, min: THREE.LinearMipmapLinearFilter });
    this.mE.uniforms.uLod.value = Math.max(0, Math.floor(Math.log2(Math.max(w, h))) - 2);
    this.mA.uniforms.uAspect.value = w / h; this.mC.uniforms.uAspect.value = w / h;
  }
  // env: {fogExt (1/m), spray, rain 0..1, wind THREE.Vector3 m/s, rainDir Vector2, seaY}
  render(scene, cam, time, dt, env, override) {
    const r = this.r;
    r.setRenderTarget(this.scene); r.setClearColor(0x000000, 0); r.clear();
    if (override) override(this.scene); else r.render(scene, cam);
    this.vp.multiplyMatrices(cam.projectionMatrix, cam.matrixWorldInverse); this.inv.copy(this.vp).invert();
    const a = this.mA.uniforms;
    a.uScene.value = this.scene.texture; a.uDepth.value = this.scene.depthTexture; a.uCamPos.value.copy(cam.position);
    a.uFogExt.value = env.fogExt; a.uSpray.value = env.spray; a.uRain.value = env.rain; a.uTime.value = time; a.uWind.value.copy(env.wind);
    a.uRainDir.value.copy(env.rainDir); a.uRainGain.value = env.rainGain ?? 0.3; if (env.flash) a.uFlash.value.copy(env.flash); a.uSeaY.value = env.seaY; a.uMB.value = this.opts.motionBlur ? Math.min(1, 0.5 / Math.max(dt * 60, 0.25)) : 0;
    this.pass.render(this.mA, this.hdr);
    this.prevVP.copy(this.vp);
    const e = this.mE.uniforms, src = this.exp[this.ei], dst = this.exp[1 - this.ei];
    e.uHdr.value = this.hdr.texture; e.uPrev.value = src.texture; e.uRate.value = 1 - Math.exp(-dt * (env.adapt ?? 1.2)); e.uKey.value = env.key ?? 0.16;
    this.pass.render(this.mE, dst); this.ei = 1 - this.ei;
    const b = this.mB.uniforms; b.uHdr.value = this.hdr.texture; b.uExp.value = dst.texture; b.uTime.value = time; b.uFade.value = this.fade; b.uGlare.value = 0.04 + 0.05 * env.rain;
    const wet = this.opts.lens ? this.wet : 0;
    this.pass.render(this.mB, this.ldr);
    const c = this.mC.uniforms; c.uLdr.value = this.ldr.texture; c.uTime.value = time; c.uWet.value = wet; c.uSlide.value.copy(env.rainDir);
    this.pass.render(this.mC, null);
  }
}
