// Globe view: NASA Blue Marble (Next Generation, via GIBS) graded for a dark ops-room look, coastlines
// from the NASA MODIS water mask, every archive track coloured by Saffir-Simpson category, a highlighted
// selected track and a chosen-point marker. Own orbit controls and CPU picking. Renders straight to the
// canvas (no post chain). Unit sphere; lat/lon <-> xyz: x = cos(lat)cos(lon), y = sin(lat), z = -cos(lat)sin(lon).
import * as THREE from 'three';
import { Line2 } from 'three/examples/jsm/lines/Line2.js';
import { LineMaterial } from 'three/examples/jsm/lines/LineMaterial.js';
import { LineGeometry } from 'three/examples/jsm/lines/LineGeometry.js';
import bmUrl from './assets/bluemarble.jpg';
import waterUrl from './assets/water.png';   // NASA MODIS water mask, world ocean only (lakes = land): land check
import coastUrl from './assets/coast.png';   // same, small lakes/rivers removed and softened: used for drawing

const D2R = Math.PI / 180;
// Track colours: the long-standing Wikipedia track-map scheme (owner's choice; NHC has no colour standard)
export const CAT_COLORS = { TD: '#5EBAFF', TS: '#00FAF4', 1: '#FFFFCC', 2: '#FFE775', 3: '#FFC140', 4: '#FF8F20', 5: '#FF6060' };
export const catOf = (kt) => (kt < 34 ? 'TD' : kt < 64 ? 'TS' : kt < 83 ? '1' : kt < 96 ? '2' : kt < 113 ? '3' : kt < 137 ? '4' : '5');
const COLS = Object.fromEntries(Object.entries(CAT_COLORS).map(([k, v]) => [k, new THREE.Color(v)]));
export const xyz = (lat, lon, r = 1, v = new THREE.Vector3()) => v.set(r * Math.cos(lat * D2R) * Math.cos(lon * D2R), r * Math.sin(lat * D2R), -r * Math.cos(lat * D2R) * Math.sin(lon * D2R));

const GLOBE_VS = `varying vec3 vN; varying vec3 vW; void main(){ vN = normalize(position); vW = (modelMatrix*vec4(position,1.)).xyz; gl_Position = projectionMatrix*viewMatrix*vec4(vW,1.); }`;
const GLOBE_FS = `
uniform sampler2D uMap, uWater; uniform vec3 uCam; varying vec3 vN; varying vec3 vW;
void main(){
  vec3 n = normalize(vN);
  float lat = asin(clamp(n.y, -1., 1.)), lon = atan(-n.z, n.x);
  vec2 uv = vec2(lon/6.2831853 + 0.5, lat/3.14159265 + 0.5);
  vec3 c = texture(uMap, uv).rgb;                       // linear (texture is sRGB)
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  c = mix(c, vec3(l)*vec3(0.62, 0.86, 1.15), 0.42)*0.62; // ops-room grade: darker, cooler, less saturated
  float w = texture(uWater, uv).r;                      // 1 water, 0 land
  float coast = 1. - smoothstep(0.0, 0.05 + 1.5*fwidth(w), abs(w - 0.5));   // thin line along the coast
  c = mix(c, c*vec3(0.78, 0.9, 1.05), w*0.4);           // seas a touch deeper
  vec3 V = normalize(uCam - vW);
  float mu = max(dot(n, V), 0.);
  c *= 0.45 + 0.65*pow(mu, 0.6);                       // limb darkening, so the globe reads round
  // graticule every 10 degrees
  vec2 g = vec2(lat, lon)/(10.*0.0174533); vec2 fg = abs(fract(g - 0.5) - 0.5)/fwidth(g);
  float grid = (1. - smoothstep(0., 1.2, min(fg.x, fg.y)))*0.1;
  c += vec3(0.35, 0.6, 0.85)*grid*(0.4 + 0.6*mu);
  c += vec3(0.4, 0.75, 1.0)*coast*0.12*(0.3 + 0.7*mu);
  c += vec3(0.05, 0.16, 0.3)*pow(1. - mu, 3.)*0.8;    // atmosphere at the limb
  gl_FragColor = vec4(pow(c, vec3(1./2.2)), 1.);
}`;
const RIM_FS = `uniform vec3 uCam; varying vec3 vN; varying vec3 vW;
void main(){ vec3 V = normalize(uCam - vW); float mu = abs(dot(normalize(vN), V)); float a = pow(1. - mu, 4.)*0.9;
  gl_FragColor = vec4(vec3(0.25, 0.55, 1.0)*a, a); }`;
const DOT_VS = `attribute vec3 color; attribute float size; varying vec3 vC; uniform float uDpr;
void main(){ vC = color; vec4 mv = modelViewMatrix*vec4(position,1.); gl_Position = projectionMatrix*mv; gl_PointSize = size*uDpr; }`;
const DOT_FS = `varying vec3 vC; void main(){ vec2 q = gl_PointCoord*2. - 1.; float r = length(q); if (r > 1.) discard;
  float edge = smoothstep(0.62, 0.78, r); gl_FragColor = vec4(mix(pow(vC, vec3(1./2.2)), vec3(0.02, 0.05, 0.09), edge), 1.); }`;
const RING_FS = `uniform float uT; void main(){ vec2 q = gl_PointCoord*2. - 1.; float r = length(q);
  float a = smoothstep(0.08, 0.0, abs(r - 0.78)) + smoothstep(0.1, 0.0, abs(r - (0.25 + 0.7*fract(uT*0.8))))*(1. - fract(uT*0.8));
  if (a < 0.01) discard; gl_FragColor = vec4(vec3(1.), a); }`;

export class Globe {
  constructor(renderer, storms) {
    this.r = renderer; this.storms = storms;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(35, 1, 0.01, 100);
    this.view = { lat: 24, lon: -75, dist: 3.4, tLat: 24, tLon: -75, tDist: 3.4, vLat: 0, vLon: 0 };
    this.fly = null; this.t = 0;
    const L = new THREE.TextureLoader();
    const map = L.load(bmUrl); map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 8;
    const water = L.load(coastUrl); water.anisotropy = 4;
    this.u = { uMap: { value: map }, uWater: { value: water }, uCam: { value: new THREE.Vector3() } };
    this.ball = new THREE.Mesh(new THREE.SphereGeometry(1, 192, 96), new THREE.ShaderMaterial({ vertexShader: GLOBE_VS, fragmentShader: GLOBE_FS, uniforms: this.u, extensions: { derivatives: true } }));
    this.scene.add(this.ball);
    const rim = new THREE.Mesh(new THREE.SphereGeometry(1.035, 96, 48), new THREE.ShaderMaterial({ vertexShader: GLOBE_VS, fragmentShader: RIM_FS, uniforms: { uCam: this.u.uCam }, side: THREE.BackSide, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false }));
    this.scene.add(rim);
    // all tracks, 1 px, rebuilt on filter change
    this.allMat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.5, depthWrite: false });
    this.all = new THREE.LineSegments(new THREE.BufferGeometry(), this.allMat); this.all.renderOrder = 2; this.scene.add(this.all);
    // selected and hovered tracks: fat lines + dots at fixes
    this.selMat = new LineMaterial({ vertexColors: true, linewidth: 3.2, transparent: true, depthWrite: false });
    this.hovMat = new LineMaterial({ color: 0xcfe9ff, linewidth: 1.6, transparent: true, opacity: 0.85, depthWrite: false });
    this.sel = null; this.hov = null;
    this.dotMat = new THREE.ShaderMaterial({ vertexShader: DOT_VS, fragmentShader: DOT_FS, uniforms: { uDpr: { value: 1 } }, depthWrite: false });
    this.dots = null;
    this.ringMat = new THREE.ShaderMaterial({ vertexShader: `uniform float uDpr; void main(){ gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); gl_PointSize = 34.*uDpr; }`, fragmentShader: RING_FS, uniforms: { uT: { value: 0 }, uDpr: this.dotMat.uniforms.uDpr }, transparent: true, depthTest: false, depthWrite: false });
    this.ring = new THREE.Points(new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute([0, 0, 0], 3)), this.ringMat);
    this.ring.visible = false; this.ring.renderOrder = 10; this.scene.add(this.ring);
    this.visible = storms.map(() => true);
    this.buildAll();
    this.live = []; this.liveGrp = new THREE.Group(); this.scene.add(this.liveGrp);
    this.liveMat = new LineMaterial({ vertexColors: true, linewidth: 2.6, transparent: true, depthWrite: false });
    this.fcMat = new LineMaterial({ color: 0xffffff, linewidth: 1.8, dashed: true, dashSize: 0.012, gapSize: 0.008, transparent: true, opacity: 0.9, depthWrite: false });
    this.coneLine = new LineMaterial({ color: 0xffffff, linewidth: 1.2, transparent: true, opacity: 0.55, depthWrite: false });
    this.pulseMat = new THREE.ShaderMaterial({ vertexShader: `uniform float uDpr; void main(){ gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.); gl_PointSize = 44.*uDpr; }`,
      fragmentShader: `uniform float uT; void main(){ vec2 q = gl_PointCoord*2. - 1.; float r = length(q); float ph = fract(uT*0.6);
        float a = smoothstep(0.24, 0.16, r) + smoothstep(0.09, 0.0, abs(r - (0.2 + 0.75*ph)))*(1. - ph)*0.9;
        if (a < 0.01) discard; gl_FragColor = vec4(mix(vec3(1.), vec3(1., 0.38, 0.27), smoothstep(0.1, 0.3, r)), a); }`,
      uniforms: { uT: this.ringMat.uniforms.uT, uDpr: this.dotMat.uniforms.uDpr }, transparent: true, depthWrite: false });
    // the land mask, read on the CPU for "is this point at sea"
    this.waterPx = null;
    const img = new Image(); img.onload = () => { const c = document.createElement('canvas'); c.width = img.width; c.height = img.height; const x = c.getContext('2d'); x.drawImage(img, 0, 0); this.waterPx = { w: img.width, h: img.height, d: x.getImageData(0, 0, img.width, img.height).data }; }; img.src = waterUrl;
  }
  // true over open sea (water connected to the world ocean); null until the mask has loaded
  isWater(lat, lon) {
    const m = this.waterPx; if (!m) return null;
    const x = Math.floor(((((lon + 180) % 360) + 360) % 360) / 360 * m.w), y = Math.floor((90 - lat) / 180 * m.h);
    return m.d[(Math.min(m.h - 1, Math.max(0, y)) * m.w + x) * 4] > 127;
  }
  ptsOf(s) { return s._p || (s._p = s.lat.map((la, i) => xyz(la / 10, s.lon[i] / 10, 1.004))); }
  segs(s, out, col, every) { // great-circle-ish subdivision so chords stay above the surface
    const P = this.ptsOf(s);
    for (let i = 0; i < P.length - 1; i++) {
      const n = Math.max(1, Math.ceil(P[i].distanceTo(P[i + 1]) / 0.02));
      const c = COLS[catOf(s.v[i])];
      for (let k = 0; k < n; k++) {
        const a = P[i].clone().lerp(P[i + 1], k / n).setLength(1.004), b = P[i].clone().lerp(P[i + 1], (k + 1) / n).setLength(1.004);
        every(a, b, c);
      }
    }
  }
  buildAll() {
    const pos = [], col = [];
    this.storms.forEach((s, j) => { if (!this.visible[j]) return; this.segs(s, null, null, (a, b, c) => { pos.push(a.x, a.y, a.z, b.x, b.y, b.z); col.push(c.r, c.g, c.b, c.r, c.g, c.b); }); });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
    this.all.geometry.dispose(); this.all.geometry = g;
  }
  // intro: every track drawn in date order. All segments sorted by time; the draw range grows with f.
  startReveal() {
    const tOf = (k) => Date.UTC(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8), +k.slice(8, 10), +k.slice(10, 12));
    const segs = [];
    for (const s of this.storms) {
      const P = this.ptsOf(s);
      for (let i = 0; i < P.length - 1; i++) {
        const n = Math.max(1, Math.ceil(P[i].distanceTo(P[i + 1]) / 0.02)), c = COLS[catOf(s.v[i])], ta = tOf(s.t[i]), tb = tOf(s.t[i + 1]);
        for (let k = 0; k < n; k++) segs.push([ta + (tb - ta) * (k / n), P[i].clone().lerp(P[i + 1], k / n).setLength(1.004), P[i].clone().lerp(P[i + 1], (k + 1) / n).setLength(1.004), c]);
      }
    }
    segs.sort((a, b) => a[0] - b[0]);
    const pos = new Float32Array(segs.length * 6), col = new Float32Array(segs.length * 6); this.revT = new Float64Array(segs.length);
    segs.forEach(([t, a, b, c], j) => { pos.set([a.x, a.y, a.z, b.x, b.y, b.z], j * 6); col.set([c.r, c.g, c.b, c.r, c.g, c.b], j * 6); this.revT[j] = t; });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.BufferAttribute(col, 3));
    this.all.geometry.dispose(); this.all.geometry = g; g.setDrawRange(0, 0); this.allMat.opacity = 0.6; this.liveGrp.visible = false;
  }
  setReveal(f) {
    const T = this.revT; if (!T) return; const tc = T[0] + (T[T.length - 1] - T[0]) * f;
    let lo = 0, hi = T.length; while (lo < hi) { const m = (lo + hi) >> 1; if (T[m] <= tc) lo = m + 1; else hi = m; }
    this.all.geometry.setDrawRange(0, lo * 2); return tc;
  }
  endReveal() { if (!this.revT) return; this.revT = null; this.liveGrp.visible = true; this.allMat.opacity = this.selected ? 0.22 : 0.5; this.buildAll(); }
  setVisible(fn) { this.visible = this.storms.map(fn); this.buildAll(); }
  fat(s, mat) {
    const pos = [], col = []; let first = true;
    this.segs(s, null, null, (a, b, c) => { if (first) { pos.push(a.x, a.y, a.z); col.push(c.r, c.g, c.b); first = false; } pos.push(b.x, b.y, b.z); col.push(c.r, c.g, c.b); });
    const g = new LineGeometry(); g.setPositions(pos); g.setColors(col);
    const l = new Line2(g, mat); l.renderOrder = 4; return l;
  }
  select(s) {
    for (const k of ['sel', 'dots']) if (this[k]) { this.scene.remove(this[k]); this[k].geometry.dispose(); this[k] = null; }
    this.selected = s; this.allMat.opacity = s ? 0.22 : 0.5;
    if (!s) { this.ring.visible = false; return; }
    this.sel = this.fat(s, this.selMat); this.scene.add(this.sel);
    const P = this.ptsOf(s), pos = [], col = [], size = [];
    P.forEach((p, i) => { const c = COLS[catOf(s.v[i])]; pos.push(p.x * 1.001, p.y * 1.001, p.z * 1.001); col.push(c.r, c.g, c.b); size.push(s.rec[i] === 'L' ? 9 : 6.5); });
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3)); g.setAttribute('size', new THREE.Float32BufferAttribute(size, 1));
    this.dots = new THREE.Points(g, this.dotMat); this.dots.renderOrder = 5; this.scene.add(this.dots);
  }
  hover(s) {
    if (this.hovS === s) return; this.hovS = s;
    if (this.hov) { this.scene.remove(this.hov); this.hov.geometry.dispose(); this.hov = null; }
    if (s && s !== this.selected) { this.hov = this.fat(s, this.hovMat); this.scene.add(this.hov); }
  }
  setPoint(lat, lon) { if (lat == null) { this.ring.visible = false; return; } this.ring.visible = true; xyz(lat, lon, 1.006, this.ring.position); }
  // CPU picking: nearest visible track fix (or the selected track, with interpolation) to a screen point
  pick(px, py, onlySel) {
    const cam = this.camera, v = new THREE.Vector3(), W = this.W, H = this.H, cp = cam.position, cl = cp.length();
    const scr = (p) => { v.copy(p).project(cam); return [(v.x * 0.5 + 0.5) * W, (-v.y * 0.5 + 0.5) * H]; };
    const front = (p) => p.dot(cp) / cl > 1 / cl + 0.02;
    let best = null, bd = onlySel ? 22 : 12;
    const list = onlySel ? [this.selected] : this.live.concat(this.storms);
    list.forEach((s, j) => {
      if (!s || (!onlySel && !s.live && !this.visible[j - this.live.length])) return;
      const P = this.ptsOf(s);
      let prev = null;
      for (let i = 0; i < P.length; i++) {
        if (!front(P[i])) { prev = null; continue; }
        const q = scr(P[i]);
        if (prev) { // distance to the screen segment from the previous fix
          const dx = q[0] - prev[0], dy = q[1] - prev[1], L2 = dx * dx + dy * dy || 1;
          const f = Math.min(1, Math.max(0, ((px - prev[0]) * dx + (py - prev[1]) * dy) / L2));
          const d = Math.hypot(prev[0] + f * dx - px, prev[1] + f * dy - py);
          if (d < bd) { bd = d; best = { storm: s, i: i - 1, f }; }
        }
        prev = q;
      }
    });
    return best;
  }
  // live storms: observed track (category colours), NHC forecast track (dashed), cone of uncertainty and a
  // pulsing marker at the latest advisory position. Drawn whatever the archive filters say.
  setLive(list) {
    for (const o of [...this.liveGrp.children]) { this.liveGrp.remove(o); o.geometry.dispose(); }
    this.live = list;
    for (const s of list) {
      if (s.t.length > 1) this.liveGrp.add(this.fat(s, this.liveMat));
      const L = s.live, R = 1.0045;
      const fc = [[L.lat, L.lon], ...L.fc.filter((f) => f.tau > 0).map((f) => [f.lat, f.lon])];
      if (fc.length > 1) {
        const pos = []; for (let i = 0; i < fc.length - 1; i++) { const a = xyz(...fc[i], R), b = xyz(...fc[i + 1], R), n = Math.max(1, Math.ceil(a.distanceTo(b) / 0.01)); for (let k = 0; k < n; k++) { const q = a.clone().lerp(b, k / n).setLength(R); pos.push(q.x, q.y, q.z); } }
        const e = xyz(...fc[fc.length - 1], R); pos.push(e.x, e.y, e.z);
        const g = new LineGeometry(); g.setPositions(pos); const l = new Line2(g, this.fcMat); l.computeLineDistances(); l.renderOrder = 6; this.liveGrp.add(l);
        const dp = [], dc = [], ds = [];
        L.fc.filter((f) => f.tau > 0).forEach((f) => { const q = xyz(f.lat, f.lon, R * 1.001), c = COLS[catOf(f.v)]; dp.push(q.x, q.y, q.z); dc.push(c.r, c.g, c.b); ds.push(6); });
        const dg = new THREE.BufferGeometry(); dg.setAttribute('position', new THREE.Float32BufferAttribute(dp, 3)); dg.setAttribute('color', new THREE.Float32BufferAttribute(dc, 3)); dg.setAttribute('size', new THREE.Float32BufferAttribute(ds, 1));
        const d = new THREE.Points(dg, this.dotMat); d.renderOrder = 7; this.liveGrp.add(d);
      }
      if (L.cone.length > 3) { // fill: triangulated in lon/lat (longitudes unwrapped), drawn on the sphere
        let lon0 = L.cone[0][0]; const ring = L.cone.map(([lo, la]) => { let x = lo; while (x - lon0 > 180) x -= 360; while (x - lon0 < -180) x += 360; lon0 = x; return new THREE.Vector2(x, la); });
        const tri = THREE.ShapeUtils.triangulateShape(ring, []), pos = [];
        for (const t of tri) for (const k of t) { const q = xyz(ring[k].y, ring[k].x, 1.0025); pos.push(q.x, q.y, q.z); }
        const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
        const m = new THREE.Mesh(g, new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.13, depthWrite: false, side: THREE.DoubleSide })); m.renderOrder = 3; this.liveGrp.add(m);
        const op = []; for (const v of [...ring, ring[0]]) { const q = xyz(v.y, v.x, 1.003); op.push(q.x, q.y, q.z); }
        const og = new LineGeometry(); og.setPositions(op); const ol = new Line2(og, this.coneLine); ol.renderOrder = 3; this.liveGrp.add(ol);
      }
      const pg = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(xyz(L.lat, L.lon, 1.007).toArray(), 3));
      const pm = new THREE.Points(pg, this.pulseMat); pm.renderOrder = 9; this.liveGrp.add(pm);
    }
  }
  flyTo(lat, lon, dist, dur = 1.4) { const v = this.view; this.fly = { t: 0, dur, from: [v.lat, v.lon, v.dist], to: [lat, lon, dist ?? v.dist] }; }
  // pointer controls (called by the UI layer)
  drag(dx, dy) { const v = this.view, k = 0.12 * (v.dist - 1); v.vLon = -dx * k; v.vLat = dy * k; v.lon += v.vLon; v.lat = Math.max(-80, Math.min(80, v.lat + v.vLat)); this.fly = null; }
  zoom(f) { const v = this.view; v.dist = Math.max(1.25, Math.min(7, 1 + (v.dist - 1) * f)); this.fly = null; }
  resize(w, h, dpr) { this.W = w; this.H = h; this.camera.aspect = w / h; this.camera.updateProjectionMatrix(); for (const m of [this.selMat, this.hovMat, this.liveMat, this.fcMat, this.coneLine]) m.resolution.set(w * dpr, h * dpr); this.dotMat.uniforms.uDpr.value = dpr; }
  frame(dt, dragging) {
    this.t += dt; const v = this.view;
    if (this.fly) {
      const f = this.fly; f.t = Math.min(1, f.t + dt / f.dur); const e = f.t * f.t * (3 - 2 * f.t);
      let dl = f.to[1] - f.from[1]; dl = ((dl + 540) % 360) - 180;
      v.lat = f.from[0] + (f.to[0] - f.from[0]) * e; v.lon = f.from[1] + dl * e; v.dist = f.from[2] + (f.to[2] - f.from[2]) * e;
      if (f.t >= 1) this.fly = null;
    } else if (!dragging) { v.vLon *= Math.exp(-dt * 4); v.vLat *= Math.exp(-dt * 4); v.lon += v.vLon; v.lat = Math.max(-80, Math.min(80, v.lat + v.vLat)); }
    xyz(v.lat, v.lon, v.dist, this.camera.position); this.camera.up.set(0, 1, 0); this.camera.lookAt(0, 0, 0);
    this.u.uCam.value.copy(this.camera.position); this.ringMat.uniforms.uT.value = this.t;
    const r = this.r; r.setRenderTarget(null); r.setClearColor(0x04070b, 1); r.autoClear = true; r.render(this.scene, this.camera);
  }
}
