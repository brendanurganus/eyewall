// Sky: physically based atmosphere (Rayleigh + Mie single scattering) with ray-marched volumetric
// storm clouds, rendered into a panorama that is used for the background, ocean reflections,
// distance fog colour and image-based lighting of the yacht.
import * as THREE from 'three';
import { Pass, fsMat, rt, noise3D } from './gl.js';
import { sunLux } from './astro.js';

export const PANO_GLSL = `
vec2 panoUV(vec3 d){
  float az = atan(d.x, -d.z), el = asin(clamp(d.y, -1., 1.));
  return vec2(az/6.2831853 + 0.5, sqrt(clamp((el + 0.05)/1.6208, 0., 1.)));
}`;

export const SKY_COMMON = `
precision highp sampler3D;
varying vec2 vUv;
uniform sampler3D uNoise;
uniform vec3 uCamRel, uSunDir, uSunCol, uAmbCol, uWindKm;
uniform sampler2D uCov; uniform vec4 uSatW, uSatC; uniform vec2 uSatEye; uniform float uUseSat;
uniform vec3 uGlow;
uniform int uMaxSteps; uniform vec2 uFrontDir; uniform float uFrontPos, uSkyCut, uSunI, uEyeR, uRm, uCdoR, uOuterR, uTime, uMode, uCover, uCirrus, uRain, uSpin, uHub, uFront, uDark;
const float RE = 6371., RA = 6471.;
const vec3 BR = vec3(5.8e-3, 13.5e-3, 33.1e-3); const float BM = 21e-3;
const vec3 BO = vec3(0.65e-3, 1.881e-3, 0.085e-3);   // ozone absorption (Hillaire 2020): keeps twilight skies blue
float ozone(float h){ return max(0., 1. - abs(h - 25.)/15.); }
vec2 rsi(vec3 ro, vec3 rd, float R){ float b = dot(ro,rd), c = dot(ro,ro)-R*R, h = b*b-c; if(h<0.) return vec2(1e9,-1e9); h = sqrt(h); return vec2(-b-h,-b+h); }
vec3 atmosphere(vec3 rd, out vec3 trans){
  vec3 ro = vec3(0., RE + 0.03 + uCamRel.y, 0.);
  float tmax = rsi(ro, rd, RA).y; vec2 g = rsi(ro, rd, RE); if (g.x > 0.) tmax = min(tmax, g.x);
  float dt = tmax/12., oR = 0., oM = 0., oO = 0.; vec3 sR = vec3(0.), sM = vec3(0.);
  for (int i = 0; i < 12; i++){
    vec3 p = ro + rd*(float(i)+0.5)*dt; float h = length(p)-RE;
    float dR = exp(-h/8.)*dt, dM = exp(-h/1.2)*dt; oR += dR; oM += dM; oO += ozone(h)*dt;
    vec2 gs = rsi(p, uSunDir, RE); if (gs.x > 0. && gs.y > 0.) continue;
    float tl = rsi(p, uSunDir, RA).y, dl = tl/4., lR = 0., lM = 0., lO = 0.;
    for (int j = 0; j < 4; j++){ float hq = length(p + uSunDir*(float(j)+0.5)*dl)-RE; lR += exp(-hq/8.)*dl; lM += exp(-hq/1.2)*dl; lO += ozone(hq)*dl; }
    vec3 att = exp(-(BR*(oR+lR) + BM*1.1*(oM+lM) + BO*(oO+lO)));
    sR += dR*att; sM += dM*att;
  }
  float mu = dot(rd, uSunDir), pR = 0.0596831*(1.+mu*mu), gg = 0.76;
  float pM = 0.1193662*(1.-gg*gg)*(1.+mu*mu)/((2.+gg*gg)*pow(1.+gg*gg-2.*gg*mu, 1.5));
  trans = exp(-(BR*oR + BM*1.1*oM + BO*oO));
  return uSunI*(sR*BR*pR*1.5 + sM*BM*pM);
}
float gT = 0.;
// storm-relative km (x east, z south) -> lon/lat, registered on the eye in the satellite photo
vec2 lonlat(vec2 xz){ float lat = uSatEye.y - xz.y/110.57; return vec2(uSatEye.x + xz.x/(111.32*cos(radians(lat))), lat); }
vec2 satUV(vec2 ll, vec4 r){ return vec2((ll.x - r.x)/r.z, 1. - (r.y - ll.y)/r.w); }
float inRect(vec2 uv, float e){ return smoothstep(0., e, uv.x)*smoothstep(1., 1.-e, uv.x)*smoothstep(0., e, uv.y)*smoothstep(1., 1.-e, uv.y); }
float n3(vec3 p){ return texture(uNoise, p).r; }
float nb(vec3 p){ return texture(uNoise, p).g; }

// returns cloud density 0..1 ; rain = precipitation below cloud base
float density(vec3 p, bool cheap, out float rain){
  rain = 0.; float h = p.y;
  if (h > 17. || h < 0.) return 0.;
  if (uMode > 0.5) {
    // shore intro: fair-weather cumulus, then a storm deck advancing along uFrontDir.
    float sAx = dot(p.xz, uFrontDir), behind = uFrontPos - sAx;
    vec3 q = p - vec3(uFrontDir.x, 0., uFrontDir.y)*uFrontPos*0.8 + uWindKm*uTime;
    float nl = n3(q*vec3(0.021,0.05,0.021));
    float nm = nb(q*0.11 + nl*0.3);
    float nh = cheap ? 0.5 : mix(0.5, nb(q*0.47), exp(-gT*0.07));
    float fair = smoothstep(1.02-uCover*0.85, 1.25-uCover*0.85, nl*0.75+nm*0.55)*smoothstep(0.7, 1.0, h)*(1.-smoothstep(1.6+nl*2., 2.6+nl*2., h));
    float edge = behind + (nl-0.5)*16. + (nm-0.5)*6.;          // ragged leading edge
    float deck = smoothstep(-1.5, 6., edge);
    float shelf = exp(-max(edge, 0.)/10.);                      // lowest, darkest cloud at the leading edge
    float base = mix(0.8, 0.32, shelf*deck) + 0.12*nm;
    float top = 3.2 + 9.*smoothstep(0., 32., edge) + nl*2.2;
    float storm = deck*smoothstep(base, base+0.22, h)*(1.-smoothstep(top-1.3, top, h));
    float ci = smoothstep(0.62-0.4*uCirrus, 0.9-0.4*uCirrus, n3(q*vec3(0.008,0.3,0.03)+0.5))*smoothstep(8.5, 9., h)*(1.-smoothstep(9.6, 10.2, h))*0.25*uCirrus;
    float d = max(fair*(1.-deck), storm);
    d = clamp((d - 0.28*(1.-nh))/0.72, 0., 1.);
    rain = uRain*smoothstep(3., 24., edge)*(1.-smoothstep(base, base+0.3, h)) + 0.004*exp(-h/1.1);
    return max(d, ci);
  }
  float r = length(p.xz);
  float a = uTime*uSpin/max(r, uRm*0.7), ca = cos(a), sa = sin(a);
  vec3 q = vec3(p.x*ca - p.z*sa, h, p.x*sa + p.z*ca);
  float th = atan(q.x, -q.z);
  float nL = n3(q*vec3(0.0029,0.01,0.0029) + 0.7);                 // storm-scale asymmetry
  float nl = n3(q*vec3(0.011,0.03,0.011) + 0.31 + nL*1.9);         // warped, so it does not visibly repeat
  float nm = cheap ? nl : mix(nb(q*0.061), nl, smoothstep(250., 900., gT));
  float nh = cheap ? 0.5 : mix(nb(q*0.29 + nl), 0.5, smoothstep(60., 300., gT));
  float lr = log(max(r, 1.)/uRm);
  float sp = 0.5+0.5*sin(2.*th - 5.5*lr + (nL-0.5)*4.);            // two main spiral arms
  float sp3 = 0.5+0.5*sin(3.*th - 7.*lr + 2. + (nl-0.5)*3.);       // finer banding
  float rout = uOuterR*(0.95 + 0.5*(nL-0.5) + 0.12*sin(th + 1.3));
  float farN = smoothstep(250., 900., gT);
  float cdoR = uCdoR*(0.9 + 0.5*(nL-0.5));
  float re = uEyeR*(0.9 + 0.22*nl) + 0.75*h;
  float wallIn = smoothstep(re-0.6, re+1.8, r + (nm-0.5)*4.5);
  float top = mix(15.8, 12.5, smoothstep(re, cdoR, r)) + (nl-0.5)*2.5 + 1.2*exp(-pow((r-re-12.)/18., 2.));
  float base = 0.42 + 0.3*nm;
  float cdo = 1.-smoothstep(cdoR*0.8, cdoR*1.2, r);
  float deep = wallIn*cdo*smoothstep(base, base+0.35, h)*(1.-smoothstep(top-2.2, top, h));
  // cirrus canopy: solid over the central dense overcast, then following the spiral arms outward
  float arm = smoothstep(0.4, 0.66, sp*0.7 + sp3*0.3 + (nl-0.5)*0.5);
  float canMask = max(cdo, (0.12 + 0.88*arm)*(1.-smoothstep(rout*0.7, rout*1.1, r)));
  float can = wallIn*smoothstep(9.5, 11., h)*(1.-smoothstep(top-1.5, top, h))*canMask*0.45;
  float band = smoothstep(0.5, 0.85, sp + (nl-0.5)*0.7)*smoothstep(cdoR*0.6, cdoR, r)*(1.-smoothstep(rout*0.75, rout*1.1, r));
  float scudK = 1.;
  if (uUseSat > 0.5) {
    // where NASA's photo shows cloud, there is cloud: brightness sets cover and depth
    vec2 cuv = satUV(lonlat(p.xz), uSatW); float cvr = texture(uCov, cuv).r*inRect(cuv, 0.02);
    float cl = smoothstep(0.34, 0.6, cvr), thick = smoothstep(0.56, 0.86, cvr);
    deep = wallIn*thick*smoothstep(base, base+0.35, h)*(1.-smoothstep(top-2.2, top, h));
    can = wallIn*smoothstep(9.5, 11., h)*(1.-smoothstep(top-1.5, top, h))*cl*0.5;
    band = cl*(1.-thick)*smoothstep(uRm*2., uRm*4., r); scudK = 0.3 + 0.7*cl;
  }
  float bandD = band*smoothstep(base, base+0.5, h)*(1.-smoothstep(6., 10.+4.*nl, h));
  float scud = smoothstep(0.5, 0.72, mix(nb(q*0.09 + 0.2), nl, farN))*smoothstep(0.3, 0.5, h)*(1.-smoothstep(1.0, 1.9, h))*smoothstep(re+2., re+12., r)*(1.-smoothstep(rout, rout*1.3, r))*0.6*scudK;
  float hub = smoothstep(0.52, 0.78, nm + 0.2*nh)*smoothstep(0.45, 0.75, h)*(1.-smoothstep(1.2, 1.9, h))*(1.-smoothstep(re*0.5, re*0.92, r))*uHub;
  float d = max(max(deep, can), max(bandD, max(scud, hub)));
  float er = 0.3*(1.-0.6*farN);
  d = clamp((d - er*(1.-nh))/(1.-er), 0., 1.);
  rain = (wallIn*(1.-smoothstep(cdoR*0.45, cdoR, r))*(0.25+0.75*(1.-smoothstep(uRm*1.3, uRm*3.5, r))) + band*0.6)*(1.-smoothstep(base, base+0.4, h))*uRain;
  return d;
}
`;
const PANO_FS = SKY_COMMON + `
void main(){
  float az = (vUv.x-0.5)*6.2831853, el = vUv.y*vUv.y*1.6208 - 0.05;
  vec3 rd = vec3(sin(az)*cos(el), sin(el), -cos(az)*cos(el));
  vec3 ro = uCamRel; ro.y = max(ro.y, 0.005);
  vec3 L = vec3(0.); float T = 1.;
  vec3 ambN = mix(uAmbCol, vec3(dot(uAmbCol, vec3(0.3333))), 0.8);
  float t = 0.03 + 0.1*fract(sin(dot(gl_FragCoord.xy, vec2(12.9898,78.233)))*43758.5453);
  float tEnd = rd.y > 0.002 ? min(260., (17.-ro.y)/rd.y) : 260.;
  float mu = dot(rd, uSunDir);
  float ph = 0.75 + 0.9*pow(max(mu,0.), 6.) + 2.5*pow(max(mu,0.), 40.);
  for (int i = 0; i < 80; i++){
    if (i >= uMaxSteps || t > tEnd || T < 0.012) break;
    vec3 p = ro + rd*t; float rain; gT = t;
    float d = density(p, false, rain);
    float dt = max(0.1, 0.045*t);
    if (d > 0.002 || rain > 0.002){
      float tau = 0., rr;
      if (d > 0.002 || rain > 0.03) {   // thin haze needs no shadow lookups
        tau += density(p + uSunDir*0.3, true, rr)*0.6;
        tau += density(p + uSunDir*1.4, true, rr)*1.6;
        tau += density(p + uSunDir*4.0, true, rr)*3.6;
        tau *= 3.2;
      }
      float sunT = 0.78*exp(-tau) + 0.22*exp(-0.22*tau);
      float hg = clamp(p.y/13., 0., 1.);
      vec3 amb = mix(ambN, uAmbCol, uMode > 0.5 ? 0.45 : hg*0.6)*(uMode > 0.5 ? 0.42 + 0.58*hg*hg : 0.10 + 0.9*hg*hg)*(1.-0.55*d) + uSunCol*0.012*hg;
      vec3 C = uSunCol*(uMode > 0.5 ? 0.11 : 0.21)*sunT*ph + amb;
      C *= uDark;
      float ext = d*5.5 + rain*1.7;
      vec3 Cr = mix(C, C*0.55 + ambN*0.035*uDark, rain*1.7/max(ext,1e-4));
      float haze = exp(-t*0.006);
      vec3 hz; // distant clouds pick up sky colour
      Cr = mix(mix(ambN, uAmbCol, 0.5)*0.9, Cr, haze);
      float al = 1.-exp(-ext*dt);
      L += T*al*Cr; T *= 1.-al;
    } else dt *= 2.4;
    t += dt;
  }
  vec3 tr; vec3 sky = atmosphere(rd, tr);
  L += T*(sky + uGlow*(0.55 + 0.45*(1.-max(rd.y, 0.))))*uSkyCut; // airglow + starlight floor
  gl_FragColor = vec4(L, T*dot(tr, vec3(0.333)));
}`;

const BG_VS = `varying vec3 vDir; uniform mat4 uInvProj, uCamWorld;
void main(){ vec4 v = uInvProj*vec4(position.xy, 1., 1.); vDir = mat3(uCamWorld)*(v.xyz/v.w); gl_Position = vec4(position.xy, 1., 1.); }`;
const BG_FS = PANO_GLSL + `
varying vec3 vDir; uniform sampler2D uPano; uniform vec3 uSunDir, uSunCol, uSunTrue, uMoonDir, uMoonCol; uniform float uLod, uMoonKey, uStars, uPix; uniform mat3 uEq;
float h1(vec2 p){ return fract(sin(dot(p, vec2(127.1, 311.7)))*43758.5453); }
float vn(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
  return mix(mix(h1(i), h1(i+vec2(1.,0.)), f.x), mix(h1(i+vec2(0.,1.)), h1(i+vec2(1.,1.)), f.x), f.y); }
// Procedural star field fixed to the celestial sphere (not a real catalogue). Counts follow roughly
// N(<m) ~ 3^m down to magnitude 6.5; radiance is relative to a magnitude-0 star.
vec3 stars(vec3 e){
  const float ROWS = 64., COLS = 128.;
  float ra = atan(e.y, e.x), sd = clamp(e.z, -1., 1.);
  vec2 c = floor(vec2((ra/6.2831853 + 0.5)*COLS, (sd*0.5 + 0.5)*ROWS));   // one star at most per cell,
  if (h1(c) > 0.72) return vec3(0.);                                        // kept off the cell edges, so
  vec2 pos = c + 0.1 + 0.8*vec2(h1(c + 3.1), h1(c + 7.7));                  // only this cell can light the pixel
  float ra2 = (pos.x/COLS - 0.5)*6.2831853, sd2 = pos.y/ROWS*2. - 1., cd = sqrt(1. - sd2*sd2);
  vec3 s = vec3(cd*cos(ra2), cd*sin(ra2), sd2);
  float dd = length(s - e), sig = uPix*0.75;
  if (dd > sig*5.) return vec3(0.);
  float m = max(-1.2, 6.5 + log(max(h1(c + 11.1), 1e-5))/1.0986);
  vec3 tint = mix(vec3(0.78, 0.86, 1.12), vec3(1.12, 0.96, 0.78), h1(c + 5.5));
  return tint*pow(10., -0.4*m)*exp(-0.5*dd*dd/(sig*sig))/(6.2831853*sig*sig);
}
void main(){
  vec3 d = normalize(vDir);
  vec4 p = textureLod(uPano, panoUV(d), uLod);
  float mu = dot(d, uSunDir);
  float disc = smoothstep(0.99996, 0.999985, mu)*(1. - uMoonKey);   // the moon gets its own disc below
  vec3 c = p.rgb + uSunCol*p.a*(disc*900. + 6.*pow(max(mu,0.), 900.) + 0.4*pow(max(mu,0.), 60.));
  if (uStars > 0. && d.y > -0.02 && p.a > 0.003) c += uStars*p.a*stars(uEq*d);
  // the moon: phase from the true sun direction (Lommel-Seeliger lunar reflectance), light maria, earthshine
  const float MR = 0.00453;  // angular radius, rad
  float cm = dot(d, uMoonDir);
  if (cm > 0.99985 && dot(uMoonCol, vec3(1.)) > 0.) {
    vec3 rt = normalize(cross(uMoonDir, vec3(0.0001, 1., 0.))), up = cross(rt, uMoonDir);
    vec2 q = vec2(dot(d, rt), dot(d, up))/MR; float r = length(q);
    float aa = 1. - smoothstep(1. - uPix/MR, 1. + uPix/MR, r);
    if (aa > 0.) {
      float z = sqrt(max(1. - r*r, 0.)); vec3 n = q.x*rt + q.y*up - z*uMoonDir;
      float mu0 = max(dot(n, uSunTrue), 0.);
      float ls = mu0/(mu0 + z + 1e-3);
      vec2 mq = q*1.6 + vec2(0.3, -0.2);
      float alb = 0.95 - 0.38*smoothstep(0.45, 0.7, vn(mq) *0.65 + vn(mq*2.3 + 4.)*0.35);
      c += uMoonCol*p.a*aa*(ls*2.*alb + 0.0025);
    }
  }
  gl_FragColor = vec4(c, 0.);
}`;

const ENV_FS = PANO_GLSL + `
varying vec2 vUv; uniform sampler2D uPano; uniform vec3 uSea;
void main(){
  float az = (vUv.x-0.5)*6.2831853 + 3.14159265, el = (vUv.y-0.5)*3.14159265;
  // three.js equirect convention: u = atan(z,x)/2pi+0.5
  float ph = (vUv.x-0.5)*6.2831853; vec3 d = vec3(cos(el)*cos(ph), sin(el), cos(el)*sin(ph));
  vec3 up = textureLod(uPano, panoUV(vec3(d.x, abs(d.y), d.z)), 2.).rgb;
  vec3 av = textureLod(uPano, vec2(0.5, 0.7), 12.).rgb;
  vec3 c = d.y >= 0. ? up : mix(up, av*0.42, smoothstep(0., -0.1, d.y));
  gl_FragColor = vec4(c, 1.);
}`;

// Clear-night sky (airglow + integrated starlight), radiance per unit of o.glow; slightly blue-green.
const NIGHT_GLOW = new THREE.Vector3(0.62, 0.78, 1.0), NIGHT_AMB = new THREE.Vector3(0.5, 0.62, 0.8);

export class Sky {
  constructor(renderer, low) {
    this.r = renderer; this.pass = new Pass(renderer);
    this.W = low ? 512 : 1024; this.H = low ? 192 : 448;
    this.pano = rt(this.W, this.H, { wrap: THREE.RepeatWrapping, wrapT: THREE.ClampToEdgeWrapping, mips: true, min: THREE.LinearMipmapLinearFilter });
    this.noise = noise3D(64);
    this.u = {
      uNoise: { value: this.noise }, uCamRel: { value: new THREE.Vector3() }, uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunCol: { value: new THREE.Vector3(1, 1, 1) }, uAmbCol: { value: new THREE.Vector3(0.2, 0.3, 0.5) }, uWindKm: { value: new THREE.Vector3(0.02, 0, 0) },
      uSunI: { value: 20 }, uEyeR: { value: 23 }, uRm: { value: 37 }, uCdoR: { value: 180 }, uOuterR: { value: 420 }, uTime: { value: 0 }, uMode: { value: 0 },
      uCover: { value: 0.3 }, uCirrus: { value: 0.5 }, uRain: { value: 1 }, uCov: { value: null }, uSatW: { value: new THREE.Vector4(0, 0, 1, 1) }, uSatC: { value: new THREE.Vector4(0, 0, 1, 1) }, uSatEye: { value: new THREE.Vector2() }, uUseSat: { value: 0 },
      uGlow: { value: new THREE.Vector3() }, uMaxSteps: { value: 60 }, uFrontDir: { value: new THREE.Vector2(0, 1) }, uFrontPos: { value: -200 }, uSkyCut: { value: 1 }, uSpin: { value: 0.077 }, uHub: { value: 1 }, uFront: { value: 0 }, uDark: { value: 1 },
    };
    this.mat = fsMat(PANO_FS, this.u);
    this.bgMat = new THREE.ShaderMaterial({ vertexShader: BG_VS, fragmentShader: BG_FS, depthTest: false, depthWrite: false,
      uniforms: { uPano: { value: this.pano.texture }, uInvProj: { value: new THREE.Matrix4() }, uCamWorld: { value: new THREE.Matrix4() }, uSunDir: this.u.uSunDir, uSunCol: { value: new THREE.Vector3() }, uLod: { value: 0 },
        uSunTrue: { value: new THREE.Vector3(0, 1, 0) }, uMoonDir: { value: new THREE.Vector3(0, -1, 0) }, uMoonCol: { value: new THREE.Vector3() }, uMoonKey: { value: 0 }, uStars: { value: 0 }, uPix: { value: 0.002 }, uEq: { value: new THREE.Matrix3() } } });
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.bg = new THREE.Mesh(g, this.bgMat); this.bg.frustumCulled = false; this.bg.renderOrder = -1000;
    this.env = rt(256, 128, {});
    this.env.texture.mapping = THREE.EquirectangularReflectionMapping;
    this.envMat = fsMat(ENV_FS, { uPano: { value: this.pano.texture }, uSea: { value: new THREE.Vector3(0.02, 0.03, 0.035) } });
    this.pmrem = new THREE.PMREMGenerator(renderer);
    this.envTex = null; this.strip = 0; this.strips = 8; this.first = true;
    this.sunI = 20; this.sunDir = this.u.uSunDir.value; this.sunGround = new THREE.Vector3();
  }
  // Sun colour after the clear atmosphere for a given elevation (Kasten-Young air mass)
  static sunTrans(el) {
    const d = (el * 180) / Math.PI;
    if (d < -1.5) return [0, 0, 0];
    const m = 1 / (Math.sin(Math.max(el, -0.02)) + 0.50572 * Math.pow(Math.max(d, -1) + 6.07995, -1.6364));
    const tau = [0.046 + 0.031, 0.108 + 0.031, 0.265 + 0.031];
    const k = Math.min(1, Math.max(0, (d + 1.5) / 1.5));
    return tau.map((t) => Math.exp(-m * t) * k);
  }
  setSun(el, az, floor = true) {
    this.sunDir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el));
    const wb = Sky.sunTrans(1.3), t = Sky.sunTrans(el).map((v, i) => v / wb[i] * wb[0]);   // white-balanced to a high sun
    this.sunGround.set(t[0], t[1], t[2]).multiplyScalar(this.sunI);
    // clouds sit higher: slightly less reddened
    const ce = el >= -0.012 ? el + 0.02 : el + 0.02 + Math.min(0.035, (-0.012 - el) * 0.6); // tops see ~3 deg below our horizon
    const t2 = Sky.sunTrans(ce).map((v, i) => v / wb[i] * wb[0]);
    this.u.uSunCol.value.set(t2[0], t2[1], t2[2]).multiplyScalar(this.sunI);
    const day = Math.min(1, Math.max(0, (el + 0.1) / 0.3));
    const dusk = Math.min(1, Math.max(0.0, (el + 0.16) / 0.2));
    const f = floor ? 1 : 0;
    const tw = el >= 0 ? 1 : sunLux(el * 57.29578) / sunLux(0); // twilight falls ~10x per 2-3 deg
    this.u.uAmbCol.value.set(0.055 * day + 0.004 * f, 0.105 * day * (0.6 + 0.4 * dusk) + 0.006 * f, 0.19 * (0.25 * dusk + 0.75 * day) + 0.012 * f).multiplyScalar(this.sunI * 0.1 * (floor ? 1 : tw));
    this.bgMat.uniforms.uSunCol.value.copy(this.u.uSunCol.value).multiplyScalar(0.02);
  }
  // Storm-scene lighting from the real sun and moon (see main.js lighting()). The key light is the sun or,
  // at night, the moon; everything is pre-exposed by o.pre so night values stay inside half-float range.
  setLight(o) {
    this.sunI = 20 * o.gain; this.u.uSunI.value = this.sunI;
    this.setSun(o.el, o.az, false);
    this.u.uAmbCol.value.addScaledVector(NIGHT_AMB, o.glow);
    this.u.uGlow.value.copy(NIGHT_GLOW).multiplyScalar(o.glow);
    const b = this.bgMat.uniforms;
    b.uMoonKey.value = o.moonKey ? 1 : 0; b.uSunTrue.value.copy(o.sunTrue); b.uMoonDir.value.copy(o.moonDir);
    b.uMoonCol.value.copy(o.moonCol); b.uStars.value = o.stars; b.uEq.value.copy(o.eq); b.uPix.value = o.pix;
  }
  resetLight() {
    this.sunI = 20; this.u.uSunI.value = 20; this.u.uGlow.value.set(0, 0, 0);
    const b = this.bgMat.uniforms; b.uMoonKey.value = 0; b.uMoonCol.value.set(0, 0, 0); b.uStars.value = 0;
  }
  update(time, full) {
    this.u.uTime.value = time;
    const p = this.pano;
    if (full || this.first) { p.scissorTest = false; this.pass.render(this.mat, p); this.first = false; }
    else {
      if (this.strip >= this.strips) this.strip = 0;
      const w = Math.ceil(this.W / this.strips);
      p.scissorTest = true; p.scissor.set(this.strip * w, 0, w, this.H);
      const ac = this.r.autoClear; this.r.autoClear = false;
      this.pass.render(this.mat, p); this.r.autoClear = ac;
      p.scissorTest = false; this.strip = (this.strip + 1) % this.strips;
    }
    this.r.setRenderTarget(null);
  }
  updateEnv(scene) {
    this.pass.render(this.envMat, this.env); this.r.setRenderTarget(null);
    const n = this.pmrem.fromEquirectangular(this.env.texture);
    if (this.envTex) this.envTex.dispose();
    this.envTex = n; scene.environment = n.texture;
  }
  syncCamera(cam) { this.bgMat.uniforms.uInvProj.value.copy(cam.projectionMatrixInverse); this.bgMat.uniforms.uCamWorld.value.copy(cam.matrixWorld); }
}
