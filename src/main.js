import * as THREE from 'three';
import { noise2D } from './gl.js';
import { Sky } from './sky.js';
import { OceanSim } from './oceanSim.js';
import { Ocean } from './ocean.js';
import { Post } from './post.js';
import { buildYacht } from './yacht.js';
import { Boat, ChaseCam, Input } from './boat.js';
import { Spray } from './particles.js';
import { Shore, terrainJS } from './shore.js';
import { Dive } from './dive.js';
import satWide from './sat/wide.jpg';
import satCore from './sat/core.jpg';
import satCov from './sat/cov.jpg';
import satMeta from './sat/meta.json';
import K from './katrina.js';
import { prepareTrack, stormAt, seaAt, windAt, precipAt, eyeRadius, sunPosition, KT, NM } from './storm.js';

const $ = (id) => document.getElementById(id);
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const canvas = $('c');
let renderer;
try { renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' }); if (!renderer.capabilities.isWebGL2) throw 0; }
catch (e) { $('msg').style.display = 'flex'; $('msg').textContent = 'This prototype needs WebGL 2 with a hardware graphics card. It could not start in this browser.'; throw e; }
const LOW = location.hash === '#low';
const DPR = Math.min(window.devicePixelRatio || 1, 1.5);
const Q = { scale: 1, acc: 0, n: 0 };
let W = innerWidth, H = innerHeight;
renderer.setPixelRatio(1); renderer.setSize(Math.round(W * Q.scale), Math.round(H * Q.scale), false);
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(48, W / H, 0.5, 200000);
const sky = new Sky(renderer, LOW); scene.add(sky.bg);
const noise = noise2D(256);
const sim = new OceanSim(renderer, [{ N: 128, L: 4000 }, { N: 256, L: 500 }, { N: 256, L: 57 }]);
const ocean = new Ocean(sim, sky, noise); scene.add(ocean.mesh);
const post = new Post(renderer, sky, Math.round(W * Q.scale), Math.round(H * Q.scale));
const yacht = buildYacht(); scene.add(yacht);
const boat = new Boat(yacht), chase = new ChaseCam(camera), input = new Input(canvas);
const spray = new Spray(); scene.add(spray.mesh);
const sun = new THREE.DirectionalLight(0xffffff, 0); scene.add(sun); scene.add(sun.target);
ocean.u.uBoatOn.value = 1;
const flashLight = new THREE.DirectionalLight(0xa8c8ff, 0); scene.add(flashLight); scene.add(flashLight.target);

// ---- lightning: in-cloud flashes that light the rain and sea, with an occasional visible stroke ----
const LT = { next: 5 + Math.random() * 6, t0: -1, strokes: [], I: 0, dir: new THREE.Vector4(0, 0.2, -1, 0), bolt: null, on: true };
const boltMat = new THREE.MeshBasicMaterial({ color: new THREE.Color(70, 85, 120), blending: THREE.AdditiveBlending, transparent: true, depthWrite: false, side: THREE.DoubleSide });
function makeBolt(x0, z0, top, dist) {
  const pts = [new THREE.Vector3(x0 + (Math.random() - 0.5) * 300, top, z0 + (Math.random() - 0.5) * 300), new THREE.Vector3(x0, 0, z0)];
  let amp = top * 0.16;
  for (let l = 0; l < 6; l++) { for (let i = pts.length - 1; i > 0; i--) { const m = pts[i].clone().add(pts[i - 1]).multiplyScalar(0.5); m.x += (Math.random() - 0.5) * amp; m.z += (Math.random() - 0.5) * amp; m.y += (Math.random() - 0.5) * amp * 0.25; pts.splice(i, 0, m); } amp *= 0.52; }
  const paths = [[pts, 1]];
  for (let b = 0; b < 2; b++) { const i0 = 8 + Math.floor(Math.random() * 30), br = [pts[i0].clone()]; const d = new THREE.Vector3(Math.random() - 0.5, -0.5 - Math.random() * 0.4, Math.random() - 0.5).normalize(); for (let k = 0; k < 14; k++) br.push(br[k].clone().addScaledVector(d, top * 0.035).add(new THREE.Vector3((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 6, (Math.random() - 0.5) * 16))); paths.push([br, 0.45]); }
  const pos = [], idx = [], w0 = Math.max(1.3, dist * 0.0011), view = new THREE.Vector3(), side = new THREE.Vector3(), seg = new THREE.Vector3();
  for (const [pp, wk] of paths) { const base = pos.length / 3; for (let i = 0; i < pp.length; i++) { seg.subVectors(pp[Math.min(i + 1, pp.length - 1)], pp[Math.max(i - 1, 0)]); view.subVectors(pp[i], camera.position); side.crossVectors(seg, view).normalize().multiplyScalar(w0 * wk * 0.5); pos.push(pp[i].x - side.x, pp[i].y - side.y, pp[i].z - side.z, pp[i].x + side.x, pp[i].y + side.y, pp[i].z + side.z); if (i) { const a = base + (i - 1) * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); } } }
  const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3)); g.setIndex(idx);
  const m = new THREE.Mesh(g, boltMat); m.frustumCulled = false; return m;
}
function updateLightning(dt, t, zone, distC) {
  // zone: 0 eye, 1 eyewall / inner core, 2 outer bands, 3 outside
  if (LT.t0 < 0 && LT.on) {
    LT.next -= dt;
    if (LT.next <= 0 && zone < 3) {
      LT.next = (zone === 1 ? 7 : zone === 2 ? 5 : 11) * (0.35 + 1.5 * Math.random());
      let az = LT.forceAz ?? Math.random() * Math.PI * 2, d = 700 + Math.random() * Math.random() * 6500, el = 0.08 + Math.random() * 0.3;
      if (zone === 0) { d = Math.max(st.eyeR - distC, 3000) + 1500 + Math.random() * 6000; el = 0.06 + Math.random() * 0.12; }
      LT.dir.set(Math.sin(az) * Math.cos(el), Math.sin(el), -Math.cos(az) * Math.cos(el), 0);
      LT.t0 = t; LT.strokes = []; let ts = 0; const n = 2 + Math.floor(Math.random() * 4), power = (zone === 0 ? 0.35 : 1) * (0.55 + 0.6 * Math.random()) * Math.min(1, 2500 / d + 0.35);
      for (let i = 0; i < n; i++) { LT.strokes.push([ts, power * (i === 0 ? 1 : 0.35 + 0.6 * Math.random())]); ts += 0.045 + Math.random() * 0.11; }
      LT.dur = ts + 0.3;
      if (LT.bolt) { scene.remove(LT.bolt); LT.bolt.geometry.dispose(); LT.bolt = null; }
      if (Math.random() < (zone === 0 ? 0.5 : 0.45)) { LT.bolt = makeBolt(camera.position.x + Math.sin(az) * d, camera.position.z - Math.cos(az) * d, 420 + Math.random() * 500, d); scene.add(LT.bolt); }
    }
  }
  LT.I = 0;
  if (LT.t0 >= 0) {
    const tt = t - LT.t0;
    for (const [ts, a] of LT.strokes) if (tt >= ts) LT.I += a * Math.exp(-(tt - ts) / 0.045);
    if (tt > LT.dur) { LT.t0 = -1; if (LT.bolt) { scene.remove(LT.bolt); LT.bolt.geometry.dispose(); LT.bolt = null; } }
  }
  LT.dir.w = LT.I; if (LT.bolt) { LT.bolt.visible = LT.I > 0.03; boltMat.opacity = Math.min(1, LT.I * 1.6); }
  flashLight.intensity = LT.I * 1.6; flashLight.position.set(boat.x + LT.dir.x * 500, Math.max(LT.dir.y, 0.25) * 500, boat.z + LT.dir.z * 500); flashLight.target.position.set(boat.x, 0, boat.z);
  ocean.u.uFlash.value = LT.I;
}

// ---- storm state (Katrina at peak, 2005-08-28 18:00 UTC) ----
const track = prepareTrack(K);
const T0 = Date.UTC(2005, 7, 28, 18);
const st = stormAt(track, T0);
{ // eye size from NOAA aircraft fixes near this time, when available
  const near = K.eyes.filter(([t]) => Math.abs(Date.UTC(+t.slice(0, 4), +t.slice(4, 6) - 1, +t.slice(6, 8), +t.slice(8, 10), +(t.slice(10, 12) || 0)) - T0) < 2.5 * 3600e3);
  st.eyeR = near.length ? (near.reduce((a, e) => a + (e[1] + e[2]) / 2, 0) / near.length / 2) * NM : eyeRadius(st);
  st.eyeSrc = near.length ? `${near.length} aircraft fixes` : 'estimated';
}
const r64 = st.r64.reduce((a, b) => a + b, 0) / 4, cdoR = Math.max(st.rm * 3, r64 * 1.2), outerR = st.r34mean * 1.25;
const center = { x: 0, z: 0 }; // storm centre in world coords
const rel = () => ({ e: boat.x - center.x, n: -(boat.z - center.z) });
let seaS = null;
function teleport(brgDeg, r, headOff = 35) {
  const b = (brgDeg * Math.PI) / 180, e = r * Math.sin(b), n = r * Math.cos(b);
  boat.x = 0; boat.z = 0; center.x = -e; center.z = n;
  const s = seaAt(st, e, n);
  boat.psi = ((s.wind.from + headOff) * Math.PI) / 180; boat.u = 3; boat.v = 0; boat.r = 0; boat.wake.length = 0; boat.roll = boat.pitch = 0; boat.vy = boat.vp = boat.vr = 0;
  seaS = { hs: s.hs, tp: s.tp, dx: s.de, dz: -s.dn, wx: s.we, wz: -s.wn, iso: s.iso }; sim.setSea(seaS); sim.setScale(sim.scaleFor(s.tp)); ocean.syncScale();
  chase.init = false; input.look.yaw = 0; sky.first = true; envAge = 1e9; post.ei = 0;
}
let envAge = 1e9;
const motion = (Math.atan2(st.u, st.v) * 180) / Math.PI;
const SPOTS = { Digit1: () => teleport(motion + 70, st.rm), Digit2: () => teleport(motion + 200, st.eyeR * 0.3, 90), Digit3: () => teleport(motion + 70, st.eyeR * 0.78, 180), Digit4: () => teleport(motion + 80, Math.max(cdoR * 1.25, 230e3)) };
teleport(motion + 70, st.rm);

// ---- HUD ----
const hud = $('hud'), help = $('help');
help.innerHTML = '<b>W/S</b> or <b>↑/↓</b> throttle · <b>A/D</b> or <b>←/→</b> rudder · drag to look · gamepad supported<br><b>1</b> eyewall · <b>2</b> eye · <b>3</b> eye edge (drive into the wall) · <b>4</b> outer bands<br><b>H</b> readout · <b>N</b> map · <b>T</b> lightning · <b>L</b> lens droplets · <b>K</b> camera shake · <b>M</b> motion blur · <b>I</b> replay intro · <b>V</b> replay dive · <b>F</b> frame rate';
const card = (d) => ['N', 'NNE', 'NE', 'ENE', 'E', 'ESE', 'SE', 'SSE', 'S', 'SSW', 'SW', 'WSW', 'W', 'WNW', 'NW', 'NNW'][Math.round(d / 22.5) % 16];
let hudT = 0, gustPeak = 0;
// ---- storm map (north up): wind bands by Saffir-Simpson category, eye, max-wind ring, boat ----
const map = $('map'), mc = map.getContext('2d');
const CATC = [[34, '#12283a'], [64, '#1f5f8b'], [83, '#d9b53f'], [96, '#ee9a35'], [113, '#ea6a2a'], [137, '#dc3a2c'], [999, '#b0164f']];
const catCol = (kt) => CATC.find((c) => kt < c[0])[1];
function drawMap() {
  const S = 380, c = S / 2, r = rel(), dist = Math.hypot(r.e, r.n);
  const view = Math.max(dist * 1.3, st.eyeR * 1.7), k = (c - 14) / view;
  mc.clearRect(0, 0, S, S); mc.save(); mc.beginPath(); mc.arc(c, c, c - 6, 0, 7); mc.clip();
  const N = 40;
  for (let i = N; i >= 1; i--) { const rr = (i / N) * view * 1.05; let v = 0; for (const b of [0.6, 2.2, 3.8, 5.4]) v += windAt(st, rr * Math.sin(b), rr * Math.cos(b)).speed / 4; mc.fillStyle = catCol(v / KT); mc.globalAlpha = 0.8; mc.beginPath(); mc.arc(c, c, rr * k + 1, 0, 7); mc.fill(); }
  mc.globalAlpha = 1; mc.fillStyle = '#0b1c2a'; mc.beginPath(); mc.arc(c, c, st.eyeR * k, 0, 7); mc.fill();
  mc.strokeStyle = '#cfe9ff'; mc.lineWidth = 2; mc.setLineDash([6, 5]); mc.beginPath(); mc.arc(c, c, st.eyeR * k, 0, 7); mc.stroke();
  mc.setLineDash([]); mc.strokeStyle = 'rgba(255,255,255,.55)'; mc.lineWidth = 1.5; mc.beginPath(); mc.arc(c, c, st.rm * k, 0, 7); mc.stroke();
  const bx = c + r.e * k, by = c - r.n * k;
  mc.strokeStyle = 'rgba(255,255,255,.7)'; mc.setLineDash([3, 6]); mc.beginPath(); mc.moveTo(bx, by); mc.lineTo(c, c); mc.stroke(); mc.setLineDash([]);
  mc.translate(bx, by); mc.rotate(boat.psi); mc.fillStyle = '#fff'; mc.strokeStyle = '#04121d'; mc.lineWidth = 2.5; mc.beginPath(); mc.moveTo(0, -15); mc.lineTo(9, 11); mc.lineTo(0, 6); mc.lineTo(-9, 11); mc.closePath(); mc.stroke(); mc.fill();
  mc.restore();
  mc.font = '600 19px ui-monospace,Menlo,Consolas,monospace'; mc.fillStyle = '#cfe9ff'; mc.textAlign = 'center';
  if (st.eyeR * k > 26) mc.fillText('EYE', c, c + 7);
  mc.fillStyle = '#9fd0f0'; mc.fillText('N', c, 26);
  const edge = dist - st.eyeR; mc.textAlign = 'left'; mc.fillStyle = '#e8f3fa';
  mc.fillText(edge > 0 ? `EYE EDGE ${(edge / NM).toFixed(1)} NM` : 'INSIDE THE EYE', 14, S - 16);
}
function drawHud(s, w, gust) {
  const r = rel(), dist = Math.hypot(r.e, r.n), brg = ((Math.atan2(-r.e, -r.n) * 180) / Math.PI + 360) % 360;
  const row = (k, v) => `<div class="row"><span class="k">${k}</span><b>${v}</b></div>`;
  const hdg = ((boat.psi * 180) / Math.PI % 360 + 360) % 360;
  hud.innerHTML = `<div class="hd"><span>Katrina · 28 Aug 2005 18:00 UTC</span><span class="cat">Cat ${st.cat}</span></div>` +
    row('Wind', `${(w.speed / KT).toFixed(0)} kt from ${card(w.from)} (${w.from.toFixed(0)}°)`) + row('Gusts', `${(gust / KT).toFixed(0)} kt`) +
    row('Waves', `${s.hs.toFixed(1)} m (${(s.hs * 3.281).toFixed(0)} ft) · ${s.tp.toFixed(0)} s`) + row('Crests apart', `${(1.56 * s.tp * s.tp).toFixed(0)} m · tallest ~${(s.hs * 1.9 * 3.281).toFixed(0)} ft`) + row('Pressure', `${(w.p / 100).toFixed(0)} mb`) +
    row('Storm centre', `${(dist / NM).toFixed(1)} nm ${card(brg)}`) + row('Storm peak', `${st.vmaxKt.toFixed(0)} kt · ${(st.pc / 100).toFixed(0)} mb`) +
    row('Boat', `${(boat.speed / KT).toFixed(1)} kt · hdg ${hdg.toFixed(0)}°`);
}

// ---- quality governor: keeps the frame rate up by trading sky/dive detail and resolution ----
const LEVELS = [
  { strips: [10, 16], steps: 40, dive: 0.28, diveSteps: 36, scale: 0.62, msaa: 2 },
  { strips: [6, 10], steps: 50, dive: 0.36, diveSteps: 46, scale: 0.8, msaa: 4 },
  { strips: [4, 8], steps: 60, dive: 0.45, diveSteps: 56, scale: 1.0, msaa: 4 },
  { strips: [3, 6], steps: 80, dive: 0.55, diveSteps: 72, scale: DPR, msaa: 4 },
];
const GOV = { ema: 16, level: LOW ? 0 : 2, hold: 3.5, show: true };
function applyQuality() {
  const L = LEVELS[GOV.level];
  sky.strips = L.strips[mode === 'intro' ? 0 : 1]; sky.u.uMaxSteps.value = L.steps; dive.scale = L.dive; dive.u.uDiveSteps.value = L.diveSteps;
  if (Q.scale !== L.scale || post.msaa !== L.msaa) { Q.scale = L.scale; post.msaa = L.msaa; resize(); }
}
function govern(ms, dt) {
  GOV.ema += (Math.min(ms, 250) - GOV.ema) * 0.06; GOV.hold -= dt;
  if (GOV.hold <= 0 && !LOW) {
    if (GOV.ema > 23 && GOV.level > 0) { GOV.level--; GOV.hold = 2.0; applyQuality(); }
    else if (GOV.ema < 12 && GOV.level < LEVELS.length - 1) { GOV.level++; GOV.hold = 7; applyQuality(); }
  }
  fpsT -= dt; if (fpsT <= 0) { fpsT = 0.5; $('fps').textContent = GOV.show ? `${Math.round(1000 / GOV.ema)} fps · quality ${GOV.level + 1}/4 · ${mode}` : ''; }
}
let fpsT = 0;

// ---- main loop ----
const env = { fogExt: 0, spray: 0, rain: 0, wind: new THREE.Vector3(), rainDir: new THREE.Vector2(0, -1), seaY: 0, key: 0.12 };
const dbg = { fog: 1, rain: 1, fixedDt: 0, cam: null };
const v3 = new THREE.Vector3(), tmp = [0, 0, 0];
let t = 0, last = performance.now(), frameN = 0, gphase = Math.random() * 100;
function frame(now) {
  requestAnimationFrame(frame);
  const rawMs = now - last; let dt = Math.min(0.05, rawMs / 1000) || 0.016; last = now; govern(rawMs || 16, dt); if (dbg.fixedDt) dt = dbg.fixedDt; t += dt; frameN++;
  const keys = input.update(dt);
  if (mode !== 'storm' && keys.some((c) => c === 'Space' || c === 'Enter' || c === 'Escape')) startStorm();
  if (mode === 'intro') { introFrame(dt); return; }
  const diving = mode === 'dive'; if (diving) { input.throttle = 0.35; input.rudder = 0; keys.length = 0; }
  post.fade = Math.min(1, post.fade + dt * 1.3);
  for (const code of keys) {
    if (code === 'KeyI') { startIntro(); return; }
    if (code === 'KeyV') { startDive(); return; }
    if (SPOTS[code]) SPOTS[code]();
    if (code === 'KeyH') hud.classList.toggle('hide');
    if (code === 'KeyL') post.opts.lens = !post.opts.lens;
    if (code === 'KeyK') chase.shakeOn = !chase.shakeOn;
    if (code === 'KeyM') post.opts.motionBlur = !post.opts.motionBlur;
    if (code === 'KeyN') map.classList.toggle('hide');
    if (code === 'KeyF') GOV.show = !GOV.show;
    if (code === 'KeyT') LT.on = !LT.on;
  }
  // local conditions from the reconstruction
  const r = rel(), s = seaAt(st, r.e, r.n), w = s.wind, rainHere = precipAt({ ...st, }, r.e, r.n);
  const k = 1 - Math.exp(-dt * 0.5), tgt = { hs: s.hs, tp: s.tp, dx: s.de, dz: -s.dn, wx: s.we, wz: -s.wn, iso: s.iso };
  for (const key in tgt) seaS[key] += (tgt[key] - seaS[key]) * k;
  { const m = Math.hypot(seaS.dx, seaS.dz) || 1; seaS.dx /= m; seaS.dz /= m; const m2 = Math.hypot(seaS.wx, seaS.wz) || 1; seaS.wx /= m2; seaS.wz /= m2; }
  sim.setSea(seaS);
  const gn = 0.5 * Math.sin(t * 0.31 + gphase) + 0.3 * Math.sin(t * 0.83 + 1.7 * gphase) + 0.2 * Math.sin(t * 2.1 + gphase * 0.3);
  const gf = 1 + 0.16 * gn, wsp = Math.max(w.speed, 0.5), wx = (w.e / wsp), wz = (-w.n / wsp), gust = w.speed * 1.2;
  ocean.setWind(wx, wz, w.speed * gf);
  const distC = Math.hypot(r.e, r.n);
  const rain = Math.min(1, sm(st.eyeR * 0.9, st.eyeR * 1.2, distC) * (1 - 0.7 * sm(st.rm * 1.6, st.rm * 4.5, distC)) + 0.6 * rainHere) * (0.8 + 0.25 * gn);
  const sunVis = 1 - sm(st.eyeR * 0.6, st.eyeR * 0.95, distC) + sm(outerR * 0.95, outerR * 1.3, distC);
  // sun + sky
  const sp = sunPosition(T0, st.lat, st.lon); sky.setSun(sp.el, sp.az);
  const su = sky.u; su.uEyeR.value = st.eyeR / 1e3; su.uRm.value = st.rm / 1e3; su.uCdoR.value = cdoR / 1e3; su.uOuterR.value = outerR / 1e3; su.uSpin.value = st.vmax / 1e3; su.uRain.value = 1;
  sun.color.setRGB(sky.sunGround.x, sky.sunGround.y, sky.sunGround.z); sun.intensity = sunVis;
  sun.position.set(boat.x, 0, boat.z).addScaledVector(sky.sunDir, 500); sun.target.position.set(boat.x, 0, boat.z);
  ocean.u.uSunE.value.copy(sky.sunGround).multiplyScalar(sunVis);
  yacht.userData.wall.emissiveIntensity = 0.55 * (1 - sunVis);
  yacht.userData.radar.rotation.y = t * 2.5;
  // simulate
  sim.update(t, dt);
  boat.update(dt, input, w.e * gf, -w.n * gf, sim);
  if (dbg.cam) { camera.position.set(dbg.cam[0], dbg.cam[1], dbg.cam[2]); camera.lookAt(dbg.cam[3], dbg.cam[4], dbg.cam[5]); camera.updateMatrixWorld(); }
  else chase.update(dt, boat, input, sim, sm(15, 70, w.speed) * (1 + gn));
  if (diving) diveCamera(dt);
  const high = diving && dv.alt > DIVE_SWITCH;
  if (boat.slamNow) { chase.shake += boat.slamNow * 1.2; post.wet = Math.min(1, post.wet + 0.5 * boat.slamNow); }
  if (!diving) { camera.fov = 48 + 9 * sm(3, 15, boat.speed); camera.updateProjectionMatrix(); }
  updateLightning(dt, t, high ? 3 : distC < st.eyeR * 0.92 ? 0 : distC < cdoR ? 1 : distC < outerR ? 2 : 3, distC);
  env.flash = LT.dir; ocean.u.uBoatSpd.value = sm(1, 12, Math.abs(boat.u));
  // spray
  const sprayAmt = sm(17, 60, w.speed * gf), vx = w.e * gf, vz = -w.n * gf;
  camera.getWorldDirection(v3); const ca = Math.atan2(v3.x, -v3.z);
  for (let i = 0, n = Math.round(sprayAmt * 260 * dt + Math.random()); i < n; i++) {
    const a = ca + (Math.random() - 0.5) * 2.2, d = 25 + Math.random() * Math.random() * 320, x = camera.position.x + Math.sin(a) * d, z = camera.position.z - Math.cos(a) * d;
    const h = sim.heightAt(x, z, tmp); if (h < 0.2 * seaS.hs) continue;
    spray.emit(x, h + 0.6, z, vx * 0.35, 1 + Math.random() * 2.5, vz * 0.35, 1.5 + Math.random() * 2, 5 + Math.random() * 9);
  }
  if (boat.bowWash > 0.25 || boat.slamNow) {
    boat.fwd(v3); const nb = boat.slamNow ? 36 * boat.slamNow : Math.round(boat.bowWash * 3 * Math.random());
    for (let i = 0; i < nb; i++) { const sd = (Math.random() - 0.5) * 7, f = 14 + Math.random() * 12; spray.emit(boat.x + v3.x * f + v3.z * sd, boat.y + 1 + Math.random() * 3, boat.z + v3.z * f - v3.x * sd, vx * 0.25 + v3.x * boat.u + (Math.random() - 0.5) * 6, 3 + Math.random() * (boat.slamNow ? 9 : 4), vz * 0.25 + v3.z * boat.u + (Math.random() - 0.5) * 6, 1.3 + Math.random() * 1.6, 3 + Math.random() * 4); }
  }
  spray.update(dt, vx * 0.75, vz * 0.75);
  spray.mat.uniforms.uScale.value = post.h / (2 * Math.tan((camera.fov * Math.PI) / 360));
  spray.mat.uniforms.uPano.value = sky.pano.texture; spray.mat.uniforms.uCol.value.set(0.65, 0.78, 1).multiplyScalar(LT.I * 0.18);
  // render inputs
  su.uCamRel.value.set((camera.position.x - center.x) / 1e3, Math.max(camera.position.y, 2) / 1e3, (camera.position.z - center.z) / 1e3);
  if (!diving || dv.alt < 2500) sky.update(t, diving && dv.alt < DIVE_SWITCH + 60 && !dv.synced); sky.syncCamera(camera); if (diving) dv.synced = dv.alt < DIVE_SWITCH + 60; else dv.synced = false;
  envAge += dt; if (envAge > 2.5 && frameN > 2) { sky.updateEnv(scene); envAge = 0; }
  ocean.update(camera, t);
  const ou = ocean.u; ou.uBoatPos.value.set(boat.x, boat.y, boat.z); boat.fwd(v3); ou.uBoatFwd.value.set(v3.x, v3.z);
  boat.wake.forEach((p, i) => ou.uWake.value[i].set(p.x, p.z, p.age, p.w)); ou.uWakeN.value = boat.wake.length;
  env.fogExt = rain * 0.0017 * dbg.fog; env.spray = sprayAmt * 0.0035 * dbg.fog; env.rain = rain * dbg.rain; env.wind.set(vx, 0, vz);
  env.key = 0.15 + 0.03 * sunVis; env.adapt = LT.I > 0.02 ? 0.15 : 1.2;
  v3.set(vx - chase.vel.x, -9, vz - chase.vel.z).transformDirection(camera.matrixWorldInverse); env.rainDir.set(v3.x, v3.y).normalize();
  post.wet += ((rain * 0.75 + sprayAmt * 0.25) * dbg.rain - post.wet) * (1 - Math.exp(-dt * 1.4));
  if (high) { env.fogExt = 0; env.spray = 0; env.rain = 0; env.key = 0.17 + 0.25 * sm(20e3, 300e3, dv.alt); env.adapt = 2.2; post.wet += (dv.inCloud * 0.85 - post.wet) * (1 - Math.exp(-dt * 3)); }
  else if (diving) env.adapt = 2.5;
  if (diving) { dive.u.uCamKm.value.copy(su.uCamRel.value); dive.u.uCamKm.value.y = camera.position.y / 1e3; }
  post.render(scene, camera, t, dt, env, high ? (target) => dive.draw(target, camera, post.w, post.h, sky.u.uUseSat.value > 0.5 && dv.alt > 112e3) : null);
  hudT -= dt; if (hudT <= 0) { hudT = 0.2; drawHud(s, w, gust); drawMap(); }
}
function resize() {
  W = innerWidth; H = innerHeight; const w = Math.round(W * Q.scale), h = Math.round(H * Q.scale);
  renderer.setSize(w, h, false); camera.aspect = W / H; camera.updateProjectionMatrix(); post.resize(w, h);
}
addEventListener('resize', resize);

// ---- shore intro: a calm dusk beach, then the storm arrives ----
const shore = new Shore(sky, noise, ocean); scene.add(shore.group);
let mode = 'storm', it = 0, flashes = 0;
const lerp = (a, b, k) => a + (b - a) * k;
function startIntro() {
  mode = 'intro'; it = 0; flashes = 0; title.classList.remove('on'); $('skip').textContent = 'Skip intro'; shore.group.visible = true; yacht.visible = spray.mesh.visible = false; if (LT.bolt) LT.bolt.visible = false;
  for (const id of ['hud', 'help', 'note', 'map']) $(id).classList.add('hide'); $('skip').style.display = 'block';
  ocean.u.uShore.value = 1; ocean.u.uBoatOn.value = 0; sky.u.uMode.value = 1; sky.first = true; applyQuality(); post.fade = 0; post.wet = 0; LT.next = 1e9; LT.t0 = -1;
  shore.u.uWindDir.value.set(0.8, 0, 0.6).normalize(); seaS = { hs: 0.35, tp: 7, dx: 0.15, dz: 0.99, wx: 0.8, wz: 0.6, iso: 0.25 }; sim.setSea(seaS); sim.setScale(sim.scaleFor(8.5)); ocean.syncScale();
}
function startStorm() {
  mode = 'storm'; title.classList.remove('on'); shore.group.visible = false; yacht.visible = spray.mesh.visible = true;
  for (const id of ['hud', 'help', 'note', 'map']) $(id).classList.remove('hide'); $('skip').style.display = 'none';
  ocean.u.uShore.value = 0; ocean.u.uSurf.value = 0; ocean.u.uBoatOn.value = 1; const su = sky.u; su.uMode.value = 0; applyQuality(); su.uSkyCut.value = 1; sky.bgMat.uniforms.uLod.value = 0; env.rainGain = 0.3; su.uDark.value = 1; su.uRain.value = 1;
  LT.forceAz = undefined; LT.next = 5 + Math.random() * 5; post.fade = 0; SPOTS.Digit1();
}
const INTRO_T = 16.5, title = $('title');
function introFrame(dt) {
  if (!dbg.introFreeze) it += dt;
  const su = sky.u, W = shore.u.uWindDir.value;
  // the storm deck advances from the sea: position of its leading edge along the approach axis, km (0 = overhead)
  const front = -92 + 140 * Math.min(1, it / 14.5), near = sm(-30, 14, front), over = sm(-12, 30, front);
  su.uFrontPos.value = front; su.uFrontDir.value.set(0.12, 0.993);
  const gn = 0.5 * Math.sin(t * 0.9) + 0.3 * Math.sin(t * 2.3 + 1) + 0.2 * Math.sin(t * 5.1), wind = (3 + 40 * near) * (1 + 0.14 * gn);
  const k2 = sm(-45, 30, front);
  Object.assign(seaS, { hs: 0.35 + 3.2 * k2, tp: 7 + 3 * k2 }); sim.setSea(seaS);
  ocean.setWind(W.x, W.z, wind); ocean.u.uSurf.value = k2; ocean.u.uFlash.value = LT.I;
  const sunEl = 0.078;
  sky.setSun(sunEl, 0.33);
  // the low sun is hidden once the deck's top rises above it, long before the storm is overhead
  const cut = 1 - sm(sunEl - 0.02, sunEl + 0.05, Math.atan2(9, Math.max(-front + 25, 1)));
  { const desat = (v, a) => { const l = (v.x + v.y + v.z) / 3; v.set(v.x + (l - v.x) * a, v.y + (l - v.y) * a, v.z + (l - v.z) * a); };
    desat(su.uSunCol.value, 0.4); desat(sky.sunGround, 0.4);
    su.uSunCol.value.multiplyScalar(cut); sky.bgMat.uniforms.uSunCol.value.copy(su.uSunCol.value).multiplyScalar(0.02);
    su.uAmbCol.value.multiplyScalar(1.35 - 0.3 * (1 - cut) - 0.4 * over);
    su.uSkyCut.value = 1 - 0.35 * (1 - cut) - 0.4 * over; sky.bgMat.uniforms.uLod.value = 0.6 - 0.4 * sm(0.8, 12, it); }
  su.uCover.value = 0.2; su.uFront.value = 0; su.uCirrus.value = 0.3; su.uRain.value = 1; su.uDark.value = 1 - 0.35 * over;
  su.uWindKm.value.set(W.x, 0, W.z).multiplyScalar(0.012 + 0.03 * near);
  ocean.u.uSunE.value.copy(sky.sunGround).multiplyScalar(cut * 0.8); shore.u.uSunE.value.copy(ocean.u.uSunE.value);
  const rain = sm(3, 24, front); shore.u.uWet.value = sm(4, 20, front);
  sim.update(t, dt);
  const crown = shore.update(t, 0.03 + 0.97 * Math.pow(near, 1.3));
  const c = sm(0.8, 13, it), b = shore.base;
  const z = lerp(34, 28.5, c), x = lerp(3.5, 7.5, c);
  camera.position.set(x, terrainJS(x, z) + lerp(1.45, 1.75, c), z);
  camera.lookAt(lerp(crown.x - 0.4, 2.2, c), lerp(crown.y - 2.0, b.y + 5.0, c), lerp(13, 6, c));
  const sh = 0.0011 * sm(12, 40, wind) * (1 + gn);
  camera.rotation.x += sh * Math.sin(t * 13.1); camera.rotation.y += sh * Math.sin(t * 11.3 + 2); camera.rotation.z += sh * 0.6 * Math.sin(t * 7.9);
  camera.fov = lerp(21, 50, c); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  // the storm hits: first lightning strike, and the title lands with it
  if ((flashes === 0 && front > -1) || (flashes === 1 && it > 13.4)) { flashes++; LT.forceAz = (Math.random() - 0.5) * 1.0; LT.next = 0; if (flashes === 1) title.classList.add('on'); }
  const on = LT.on; LT.on = true; updateLightning(dt, t, 1, 0); LT.on = on; LT.next = Math.max(LT.next, 1e8); shore.u.uFlash.value = LT.I;
  su.uCamRel.value.set(camera.position.x / 1e3, Math.max(camera.position.y, 2) / 1e3, camera.position.z / 1e3);
  sky.update(t, false); sky.syncCamera(camera); ocean.update(camera, t);
  env.fogExt = rain * 0.0022; env.spray = sm(20, 45, wind) * 0.002; env.rain = rain; env.wind.set(W.x * wind, 0, W.z * wind);
  env.rainGain = 0.16; env.key = 0.19 - 0.02 * over; env.adapt = LT.I > 0.02 ? 0.15 : 2.0; env.flash = LT.dir; env.seaY = 0;
  v3.set(W.x * wind, -9, W.z * wind).transformDirection(camera.matrixWorldInverse); env.rainDir.set(v3.x, v3.y).normalize();
  post.wet += (rain * 0.7 - post.wet) * (1 - Math.exp(-dt * 1.2));
  post.fade = sm(0, 1.0, it) * (1 - sm(INTRO_T - 0.9, INTRO_T - 0.1, it));
  if (it > INTRO_T - 1.0) title.classList.remove('on');
  post.render(scene, camera, t, dt, env);
  if (it > INTRO_T) startDive();
}

// ---- dive from space into the storm ----
const dive = new Dive(renderer, sky), DIVE_T = 11, dv = { t: 0, alt: 0, start: new THREE.Vector3(), q: new THREE.Quaternion(), endQ: new THREE.Quaternion(), endP: new THREE.Vector3(), pos: new THREE.Vector3(), tgt: new THREE.Vector3() };
const KN = [[0, Math.log(1700)], [0.6, Math.log(17)], [0.76, Math.log(0.5)], [1, Math.log(0.02)]];
const lnAlt = (p) => { for (let i = 1; i < KN.length; i++) if (p <= KN[i][0]) { const f = (p - KN[i - 1][0]) / (KN[i][0] - KN[i - 1][0]); return lerp(KN[i - 1][1], KN[i][1], f); } return KN[KN.length - 1][1]; };
function startDive() {
  startStorm(); mode = 'dive'; dv.t = 0; title.classList.remove('on');
  for (const id of ['hud', 'help', 'note', 'map']) $(id).classList.add('hide'); $('skip').style.display = 'block'; $('skip').textContent = 'Skip';
  // begin high over the outer rain bands, outward from where the yacht is
  const out = v3.set(boat.x - center.x, 0, boat.z - center.z).normalize();
  dv.start.set(boat.x + out.x * 110e3 - out.z * 40e3, 0, boat.z + out.z * 110e3 + out.x * 40e3);
  post.fade = 0; post.wet = 0;
}
function diveCamera(dt) {
  if (!dbg.diveFreeze) dv.t += dt; const p0 = Math.min(1, dv.t / DIVE_T), p = p0 * p0 * (3 - 2 * p0);
  dv.endP.copy(camera.position); dv.endQ.copy(camera.quaternion);
  const alt = Math.exp(lnAlt(p)) * 1000, hk = 1 - Math.pow(1 - Math.min(1, p / 0.68), 2.4);
  dv.pos.set(lerp(dv.start.x, dv.endP.x, hk), alt, lerp(dv.start.z, dv.endP.z, hk)).lerp(dv.endP, sm(0.86, 1, p));
  const tk = sm(0.12, 0.6, p); dv.tgt.set(lerp(center.x, boat.x, tk), boat.y, lerp(center.z, boat.z, tk));
  const hk2 = sm(0.3, 0.72, p), hx = Math.sin(boat.psi) * hk2, hz = lerp(-1, -Math.cos(boat.psi), hk2), uk = sm(0.74, 0.95, p);   // north-up from space, turning to the boat's heading on the way down
  camera.position.copy(dv.pos); camera.up.set(hx * (1 - uk), uk, hz * (1 - uk)).normalize(); camera.lookAt(dv.tgt); camera.up.set(0, 1, 0);
  dv.q.copy(camera.quaternion); camera.quaternion.slerpQuaternions(dv.q, dv.endQ, sm(0.84, 1, p));
  const inCloud = sm(17e3, 14e3, alt) * (1 - sm(0.9, 1, p));
  camera.rotation.x += 0.006 * inCloud * Math.sin(t * 17.3); camera.rotation.y += 0.006 * inCloud * Math.sin(t * 13.9 + 1); camera.rotation.z += 0.01 * inCloud * Math.sin(t * 9.1);
  camera.fov = lerp(lerp(30, 40, sm(0.05, 0.5, p)), 48 + 9 * sm(3, 15, boat.speed), sm(0.8, 1, p)); camera.updateProjectionMatrix(); camera.updateMatrixWorld();
  dv.alt = camera.position.y; dv.inCloud = inCloud;
  if (p0 >= 1) { mode = 'storm'; for (const id of ['hud', 'help', 'note', 'map']) $(id).classList.remove('hide'); $('skip').style.display = 'none'; }
}
// NASA MODIS (Terra) true-colour image of Katrina, 28 Aug 2005, via NASA Worldview Snapshots / GIBS
{ const L = new THREE.TextureLoader(), su = sky.u; let n = 0;
  const done = () => { if (++n === 3) su.uUseSat.value = 1; };
  const w = L.load(satWide, done), c = L.load(satCore, done), cv = L.load(satCov, done);
  for (const tx of [w, c]) { tx.colorSpace = THREE.SRGBColorSpace; tx.anisotropy = 8; tx.wrapS = tx.wrapT = THREE.ClampToEdgeWrapping; }
  cv.wrapS = cv.wrapT = THREE.ClampToEdgeWrapping; cv.minFilter = THREE.LinearFilter; cv.generateMipmaps = false;
  dive.u.uSatWide.value = w; dive.u.uSatCore.value = c; su.uCov.value = cv;
  const W = satMeta.wide, C = satMeta.core;
  su.uSatW.value.set(W[0], W[1], W[2] - W[0], W[1] - W[3]); su.uSatC.value.set(C[0], C[1], C[2] - C[0], C[1] - C[3]); su.uSatEye.value.set(satMeta.eye[0], satMeta.eye[1]); }
const DIVE_SWITCH = 430; // metres: below the cloud base the normal sea-level renderer takes over
$('skip').addEventListener('click', startStorm);
if (matchMedia('(prefers-reduced-motion: reduce)').matches || location.hash === '#storm') startStorm(); else startIntro();
window.__ew = { dv, startDive, setDive: (v) => { dv.t = v; }, shore, setIntro: (v) => { it = v; }, startIntro, startStorm, LT, THREE, dbg, env, st, sim, sky, ocean, post, camera, boat, chase, teleport, SPOTS, input };
requestAnimationFrame(frame);
