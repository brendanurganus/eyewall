// Original ~52 m classic motor yacht, built procedurally (no third-party model).
import * as THREE from 'three';
const L = 52, B = 4.6, T = 2.7, PI = Math.PI;
const sm = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };
const sheer = (s) => 3.2 + 2.3 * Math.pow(Math.max(0, (s - 0.5) / 0.5), 2);
const bdeck = (s) => (s < 0.45 ? B * (0.8 + 0.2 * Math.sin((PI / 2) * s / 0.45)) : B * (1 - Math.pow((s - 0.45) / 0.55, 2.4)));
const bottom = (s) => (s > 0.86 ? -T + (sheer(1) + T) * Math.pow((s - 0.86) / 0.14, 1.6) : -T * sm(-0.25, 0.3, s));
const zOf = (s) => L / 2 - s * L;

function geo(pos, uv, idx) {
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  if (uv) g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx); g.computeVertexNormals(); return g;
}
function canvasTex(w, h, draw, srgb = true) {
  const c = document.createElement('canvas'); c.width = w; c.height = h; draw(c.getContext('2d'), w, h);
  const t = new THREE.CanvasTexture(c); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
}
function hull() {
  const NS = 72, NV = 16, pos = [], uv = [], idx = [], H = 8.5;
  for (let side = -1; side <= 1; side += 2) for (let i = 0; i <= NS; i++) {
    const s = i / NS, sh = sheer(s), bt = bottom(s), bd = bdeck(s), p = 0.45 + 0.95 * sm(0.55, 1, s);
    for (let j = 0; j <= NV; j++) { const v = j / NV, y = bt + (sh - bt) * v; pos.push(side * bd * Math.pow(Math.sin((v * PI) / 2), p), y, zOf(s)); uv.push(s, (y + T) / H); }
  }
  const row = NV + 1, half = (NS + 1) * row;
  for (let k = 0; k < 2; k++) for (let i = 0; i < NS; i++) for (let j = 0; j < NV; j++) { const a = k * half + i * row + j, b = a + row; idx.push(a, b, a + 1, a + 1, b, b + 1); }
  const c = pos.length / 3; pos.push(0, (sheer(0) + bottom(0)) / 2, zOf(0)); uv.push(0, 0.5);
  for (let k = 0; k < 2; k++) for (let j = 0; j < NV; j++) idx.push(c, k * half + j, k * half + j + 1);
  return geo(pos, uv, idx);
}
function deckParts() {
  const NS = 72, dk = [], dkuv = [], di = [], bw = [], bi = [], cap = [], ci = [];
  for (let i = 0; i <= NS; i++) {
    const s = i / NS, sh = sheer(s), b = Math.max(0, bdeck(s) - 0.14), z = zOf(s), yd = sh - 0.75;
    dk.push(-b, yd, z, b, yd, z); dkuv.push(-b / 2, z / 2, b / 2, z / 2);
    for (const sd of [-1, 1]) { bw.push(sd * b, yd, z, sd * b, sh, z); cap.push(sd * b, sh + 0.01, z, sd * (b + 0.17), sh + 0.01, z); }
    if (i < NS) { const a = i * 2; di.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); const q = i * 4; for (const o of [0, 2]) { bi.push(q + o, q + o + 1, q + o + 4, q + o + 1, q + o + 5, q + o + 4); ci.push(q + o, q + o + 1, q + o + 4, q + o + 1, q + o + 5, q + o + 4); } }
  }
  return { deck: geo(dk, dkuv, di), bulwark: geo(bw, null, bi), cap: geo(cap, null, ci) };
}
// plan outline: rounded stern corners, superelliptic nose. zA = aft (+), zF = forward (-)
function outline(zA, zF, w, nose) {
  const pts = [], n = 2.6;
  for (let k = 0; k <= 20; k++) { const a = (k / 20) * PI, c = Math.cos(a), s = Math.sin(a); pts.push([w * Math.sign(c) * Math.pow(Math.abs(c), 2 / n), zF + nose - nose * Math.pow(s, 2 / n), 1 - Math.abs(c)]); }
  const ra = 0.7;
  for (let k = 0; k <= 5; k++) { const a = (k / 5) * PI / 2; pts.push([-w + ra - ra * Math.cos(a), zA - ra + ra * Math.sin(a), 0]); }
  for (let k = 0; k <= 5; k++) { const a = (k / 5) * PI / 2; pts.push([w - ra + ra * Math.sin(a), zA - ra + ra * Math.cos(a), 0]); }
  return pts;
}
function walls(o, y0, h, rake, mod) {
  const pos = [], uv = [], idx = []; let acc = 0; const n = o.length;
  for (let i = 0; i <= n; i++) {
    const p = o[i % n], q = o[(i + n - 1) % n]; if (i > 0) acc += Math.hypot(p[0] - q[0], p[1] - q[1]);
    const f = p[2];
    pos.push(p[0], y0, p[1], p[0] * (1 - 0.03 - 0.05 * f), y0 + h, p[1] + rake * f); uv.push(acc / mod, 0, acc / mod, 1);
    if (i < n) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
  }
  return geo(pos, uv, idx);
}
function slab(o, y, th, grow, shiftAft = 0) {
  const pos = [0, y + th, 0, 0, y, 0], idx = [], n = o.length;
  let cz = 0; for (const p of o) cz += p[1]; cz /= n; pos[2] = pos[5] = cz;
  for (const p of o) { const x = p[0] * (1 + grow / 4), z = cz + (p[1] - cz) * (1 + grow / 14) + (p[1] > cz ? shiftAft : 0); pos.push(x, y + th, z, x, y, z); }
  for (let i = 0; i < n; i++) { const a = 2 + i * 2, b = 2 + ((i + 1) % n) * 2; idx.push(0, a, b, 1, b + 1, a + 1, a, a + 1, b, b, a + 1, b + 1); }
  return geo(pos, null, idx);
}
function bars(list, r = 0.022) {
  const pos = [], idx = [];
  for (const [a, b] of list) {
    const d = new THREE.Vector3().subVectors(b, a), up = Math.abs(d.y) > 0.9 * d.length() ? new THREE.Vector3(1, 0, 0) : new THREE.Vector3(0, 1, 0);
    const u = new THREE.Vector3().crossVectors(d, up).normalize().multiplyScalar(r), v = new THREE.Vector3().crossVectors(d, u).normalize().multiplyScalar(r), base = pos.length / 3;
    for (const e of [a, b]) for (const [x, y] of [[1, 0], [0, 1], [-1, 0], [0, -1]]) pos.push(e.x + u.x * x + v.x * y, e.y + u.y * x + v.y * y, e.z + u.z * x + v.z * y);
    for (let k = 0; k < 4; k++) { const n = (k + 1) % 4; idx.push(base + k, base + 4 + k, base + n, base + n, base + 4 + k, base + 4 + n); }
  }
  return geo(pos, null, idx);
}
function rail(path, h = 1.0, step = 1.9) {
  const list = []; let prevTop = null, prevMid = null, acc = step;
  for (let i = 0; i < path.length; i++) {
    const p = path[i]; if (i > 0) acc += p.distanceTo(path[i - 1]);
    if (acc >= step || i === path.length - 1) {
      acc = 0; const top = p.clone().setY(p.y + h), mid = p.clone().setY(p.y + h * 0.5);
      list.push([p, top]); if (prevTop) { list.push([prevTop, top]); list.push([prevMid, mid]); } prevTop = top; prevMid = mid;
    }
  }
  return list;
}

export function buildYacht() {
  const g = new THREE.Group();
  const hullTex = canvasTex(2048, 512, (c, w, h) => {
    const Y = (y) => (1 - (y + T) / 8.5) * h;
    c.fillStyle = '#f4f3ee'; c.fillRect(0, 0, w, h);
    c.fillStyle = '#5b1f1c'; c.fillRect(0, Y(0.12), w, h);
    c.fillStyle = '#0d1b33'; c.fillRect(0, Y(0.5), w, Y(0.12) - Y(0.5));
    c.strokeStyle = '#0d1b33'; c.lineWidth = 5; c.beginPath();
    for (let i = 0; i <= 200; i++) { const s = i / 200, y = Y(sheer(s) - 0.95); i ? c.lineTo(s * w, y) : c.moveTo(s * w, y); } c.stroke();
    for (let s = 0.2; s < 0.84; s += 0.027) { const y = Y(1.75 + (sheer(s) - 3.2) * 0.6); c.fillStyle = '#b9b7ae'; c.beginPath(); c.arc(s * w, y, 7.5, 0, 7); c.fill(); c.fillStyle = '#0a0f16'; c.beginPath(); c.arc(s * w, y, 5.5, 0, 7); c.fill(); }
    // weathering streaks
    c.globalAlpha = 0.05; for (let i = 0; i < 260; i++) { c.fillStyle = i % 2 ? '#6b6a60' : '#ffffff'; c.fillRect(Math.random() * w, Y(3.5) + Math.random() * 60, 2, 40 + Math.random() * 120); } c.globalAlpha = 1;
  });
  const mHull = new THREE.MeshPhysicalMaterial({ map: hullTex, roughness: 0.28, clearcoat: 1, clearcoatRoughness: 0.08, side: THREE.DoubleSide });
  const mWhite = new THREE.MeshPhysicalMaterial({ color: 0xf2f1ec, roughness: 0.3, clearcoat: 0.8, clearcoatRoughness: 0.12, side: THREE.DoubleSide });
  const teak = canvasTex(256, 256, (c, w, h) => { c.fillStyle = '#7a6a58'; c.fillRect(0, 0, w, h); for (let x = 0; x < w; x += 16) { c.fillStyle = `rgba(${95 + Math.random() * 40},${78 + Math.random() * 30},${60 + Math.random() * 25},0.45)`; c.fillRect(x, 0, 15, h); c.fillStyle = '#2a2018'; c.fillRect(x + 15, 0, 1.4, h); } });
  teak.wrapS = teak.wrapT = THREE.RepeatWrapping;
  const mTeak = new THREE.MeshStandardMaterial({ map: teak, roughness: 0.38, side: THREE.DoubleSide });
  const mCap = new THREE.MeshStandardMaterial({ color: 0x5a3d25, roughness: 0.3, side: THREE.DoubleSide });
  const mSteel = new THREE.MeshStandardMaterial({ color: 0xd8dde2, metalness: 1, roughness: 0.22 });
  const mNavy = new THREE.MeshPhysicalMaterial({ color: 0x0d1b33, roughness: 0.3, clearcoat: 1, side: THREE.DoubleSide });
  const mDark = new THREE.MeshStandardMaterial({ color: 0x14181d, roughness: 0.5 });
  const lit = []; const winDraw = (mode) => (c, w, h) => {
    c.fillStyle = mode === 'c' ? '#f1f0ea' : mode === 'r' ? '#707070' : '#000'; c.fillRect(0, 0, w, h);
    for (let i = 0; i < 8; i++) {
      const x = i * (w / 8) + 9, ww = w / 8 - 18, y = h * 0.2, hh = h * 0.44;
      if (mode === 'e' && lit[i] === undefined) lit[i] = Math.random() < 0.55;
      c.fillStyle = mode === 'c' ? '#070b10' : mode === 'r' ? '#101010' : lit[i] ? `rgb(255,${190 + (i * 37) % 40},${120 + (i * 53) % 50})` : '#000';
      c.beginPath(); c.roundRect(x, y, ww, hh, 9); c.fill();
    }
  };
  for (let i = 0; i < 8; i++) lit[i] = Math.random() < 0.55;
  const wc = canvasTex(1024, 256, winDraw('c')), wr = canvasTex(1024, 256, winDraw('r'), false), we = canvasTex(1024, 256, winDraw('e'));
  for (const t of [wc, wr, we]) t.wrapS = THREE.RepeatWrapping;
  const mWall = new THREE.MeshPhysicalMaterial({ map: wc, roughnessMap: wr, roughness: 1, emissiveMap: we, emissive: 0xffffff, emissiveIntensity: 0.0, clearcoat: 0.6, clearcoatRoughness: 0.1, side: THREE.DoubleSide });
  g.userData.wall = mWall;
  const add = (geom, mat) => { const m = new THREE.Mesh(geom, mat); m.castShadow = m.receiveShadow = true; g.add(m); return m; };
  add(hull(), mHull);
  const d = deckParts(); add(d.deck, mTeak); add(d.bulwark, mWhite); add(d.cap, mCap);
  const railList = [];
  const tiers = [[zOf(0.16), zOf(0.66), 3.5, 5.5, 2.5, 2.6, 0.9, 5.2], [zOf(0.26), zOf(0.6), 3.0, 4.5, 5.24, 2.4, 1.3, 4.6], [zOf(0.37), zOf(0.52), 2.1, 2.6, 7.78, 1.25, 0.7, 1.2]];
  tiers.forEach(([zA, zF, w, nose, y0, h, rake, aftOver], k) => {
    const o = outline(zA, zF, w, nose);
    add(walls(o, y0, h, rake, 12.8), mWall);
    const top = o.map((p) => [p[0], p[1] + rake * p[2] * 0.6, p[2]]);
    add(slab(top, y0 + h, 0.14, k < 2 ? 0.75 : 0.5, k < 2 ? aftOver : 0.6), mWhite);
    if (k < 2) {
      // teak on the open deck aft of the next tier + rails round the slab edge
      let cz = 0; for (const p of top) cz += p[1]; cz /= top.length;
      const edge = top.map((p) => new THREE.Vector3(p[0] * (1 + 0.7 / 4), y0 + h + 0.14, cz + (p[1] - cz) * (1 + 0.7 / 14) + (p[1] > cz ? aftOver - 0.1 : 0)));
      railList.push(...rail(edge.filter((p) => p.z > zOf(0.5)).concat([]), 1.0));
      const tk = new THREE.Mesh(new THREE.PlaneGeometry(w * 2 + 0.8, aftOver + 3), mTeak); tk.rotation.x = -PI / 2; tk.position.set(0, y0 + h + 0.15, zA + aftOver / 2 - 1.2); tk.receiveShadow = true; g.add(tk);
      for (const sx of [-1, 1]) for (const dz of [0.4, aftOver * 0.55, aftOver - 0.3]) railList.push([new THREE.Vector3(sx * (w + 0.45), y0 - 0.1, zA + dz), new THREE.Vector3(sx * (w + 0.45), y0 + h, zA + dz)]);
    }
  });
  // bow + stern rails on the bulwark
  for (const sd of [-1, 1]) for (const [s0, s1] of [[0.64, 0.995], [0.0, 0.15]]) { const path = []; for (let s = s0; s <= s1 + 1e-6; s += 0.01) path.push(new THREE.Vector3(sd * bdeck(s) * 0.985, sheer(s), zOf(s))); railList.push(...rail(path, 0.55, 2.2)); }
  add(bars(railList, 0.024), mSteel);
  // funnel
  const fn = add(new THREE.CylinderGeometry(0.75, 1.15, 2.6, 20), mWhite); fn.scale.set(1, 1, 1.7); fn.position.set(0, 9.0, zOf(0.315)); fn.rotation.x = 0.16;
  const fb = add(new THREE.CylinderGeometry(0.86, 0.93, 0.55, 20), mNavy); fb.scale.set(1, 1, 1.7); fb.position.set(0, 9.75, zOf(0.315) + 0.12); fb.rotation.x = 0.16;
  // mast, radar, domes
  const mz = zOf(0.45), my = 9.17;
  const mast = add(new THREE.CylinderGeometry(0.09, 0.2, 5.6, 10), mWhite); mast.position.set(0, my + 2.8, mz); mast.rotation.x = 0.1;
  const arm = add(new THREE.BoxGeometry(4.2, 0.12, 0.3), mWhite); arm.position.set(0, my + 2.3, mz + 0.22);
  const radar = add(new THREE.BoxGeometry(2.3, 0.14, 0.2), mDark); radar.position.set(0, my + 3.3, mz + 0.5); g.userData.radar = radar;
  for (const sx of [-1, 1]) { const dm = add(new THREE.SphereGeometry(0.55, 18, 12), mWhite); dm.position.set(sx * 1.75, my + 2.9, mz + 0.22); }
  const ht = add(new THREE.BoxGeometry(4.6, 0.12, 5.2), mWhite); ht.position.set(0, my + 1.15, mz + 1.6);
  for (const sx of [-1, 1]) for (const dz of [-0.6, 3.8]) railList.push([new THREE.Vector3(sx * 2.1, my, mz + dz), new THREE.Vector3(sx * 2.1, my + 1.15, mz + dz)]);
  const posts = add(bars([[new THREE.Vector3(-2.1, my - 0.1, mz - 0.6), new THREE.Vector3(-2.1, my + 1.15, mz - 0.6)], [new THREE.Vector3(2.1, my - 0.1, mz - 0.6), new THREE.Vector3(2.1, my + 1.15, mz - 0.6)], [new THREE.Vector3(-2.1, my - 0.1, mz + 3.8), new THREE.Vector3(-2.1, my + 1.15, mz + 3.8)], [new THREE.Vector3(2.1, my - 0.1, mz + 3.8), new THREE.Vector3(2.1, my + 1.15, mz + 3.8)]], 0.07), mWhite);
  // tender under cover on the bridge-deck aft, anchor windlass, jackstaff
  const tn = add(new THREE.SphereGeometry(1, 16, 10), mNavy); tn.scale.set(1.0, 0.55, 3.0); tn.position.set(0, 5.95, zOf(0.19));
  const wl = add(new THREE.CylinderGeometry(0.3, 0.3, 1.3, 12), mSteel); wl.rotation.z = PI / 2; wl.position.set(0, sheer(0.9) - 0.45, zOf(0.9));
  add(bars([[new THREE.Vector3(0, sheer(0.99), zOf(0.99)), new THREE.Vector3(0, sheer(0.99) + 2.2, zOf(0.99) - 0.3)], [new THREE.Vector3(0, sheer(0.01), zOf(0.012)), new THREE.Vector3(0, sheer(0.01) + 2.6, zOf(0.0) + 0.5)]], 0.035), mSteel);
  // navigation lights
  const lights = [[-3.2, 7.2, zOf(0.56), 0xff2a1a], [3.2, 7.2, zOf(0.56), 0x1aff4a], [0, my + 5.5, mz + 0.55, 0xfff4dd], [0, 3.6, zOf(0.005), 0xfff4dd]];
  g.userData.nav = lights.map(([x, y, z, c]) => { const m = new THREE.Mesh(new THREE.SphereGeometry(0.14, 10, 8), new THREE.MeshBasicMaterial({ color: new THREE.Color(c).multiplyScalar(1) })); m.position.set(x, y, z); g.add(m); return m; });
  g.userData.mats = [mHull, mWhite, mTeak, mWall];
  return g;
}
