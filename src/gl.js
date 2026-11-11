import * as THREE from 'three';

// Fullscreen-triangle pass runner
export class Pass {
  constructor(renderer) {
    this.r = renderer;
    this.scene = new THREE.Scene();
    this.cam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 3, -1, 0, -1, 3, 0]), 3));
    this.mesh = new THREE.Mesh(g, null);
    this.mesh.frustumCulled = false;
    this.scene.add(this.mesh);
  }
  render(mat, target = null) {
    this.mesh.material = mat;
    this.r.setRenderTarget(target);
    this.r.render(this.scene, this.cam);
  }
}

export const VS_RAW = `in vec3 position; out vec2 vUv;
void main(){ vUv = position.xy*0.5+0.5; gl_Position = vec4(position.xy,0.,1.); }`;
export const VS = `varying vec2 vUv; void main(){ vUv = position.xy*0.5+0.5; gl_Position = vec4(position.xy,0.,1.); }`;

export function rawMat(frag, uniforms) {
  return new THREE.RawShaderMaterial({
    glslVersion: THREE.GLSL3, vertexShader: VS_RAW,
    fragmentShader: 'precision highp float; precision highp int; precision highp sampler2D; precision highp sampler3D;\n' + frag,
    uniforms, depthTest: false, depthWrite: false,
  });
}
export function fsMat(frag, uniforms) {
  return new THREE.ShaderMaterial({ vertexShader: VS, fragmentShader: frag, uniforms, depthTest: false, depthWrite: false });
}

export function rt(w, h, o = {}) {
  const t = new THREE.WebGLRenderTarget(w, h, {
    type: o.type ?? THREE.HalfFloatType, format: THREE.RGBAFormat,
    minFilter: o.min ?? THREE.LinearFilter, magFilter: o.mag ?? THREE.LinearFilter,
    wrapS: o.wrap ?? THREE.ClampToEdgeWrapping, wrapT: o.wrapT ?? o.wrap ?? THREE.ClampToEdgeWrapping,
    depthBuffer: !!o.depth, stencilBuffer: false, generateMipmaps: !!o.mips, samples: o.samples ?? 0,
  });
  if (o.aniso) t.texture.anisotropy = o.aniso;
  return t;
}

// deterministic RNG
export function rng(seed) {
  let s = seed >>> 0;
  return () => { s = (s + 0x6d2b79f5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
}
export function gauss(r) { const u = Math.max(1e-9, r()), v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); }

// Tileable 2D fbm noise, 4 independent channels
export function noise2D(size = 256) {
  const data = new Uint8Array(size * size * 4);
  for (let c = 0; c < 4; c++) {
    const acc = new Float32Array(size * size);
    let amp = 0.5, tot = 0;
    for (let o = 0; o < 6; o++) {
      const P = 4 << o, r = rng(1000 + c * 97 + o * 13), lat = new Float32Array(P * P);
      for (let i = 0; i < P * P; i++) lat[i] = r();
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const fx = (x / size) * P, fy = (y / size) * P, x0 = Math.floor(fx), y0 = Math.floor(fy);
        let tx = fx - x0, ty = fy - y0; tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty);
        const x1 = (x0 + 1) % P, y1 = (y0 + 1) % P;
        const a = lat[y0 * P + x0], b = lat[y0 * P + x1], d = lat[y1 * P + x0], e = lat[y1 * P + x1];
        acc[y * size + x] += amp * (a + (b - a) * tx + (d - a) * ty + (a - b - d + e) * tx * ty);
      }
      tot += amp; amp *= 0.5;
    }
    for (let i = 0; i < size * size; i++) data[i * 4 + c] = Math.max(0, Math.min(255, (acc[i] / tot) * 255));
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true; t.anisotropy = 4; t.needsUpdate = true;
  return t;
}

// Tileable 3D noise: R = smooth fbm, G = billowy (ridged) fbm
export function noise3D(size = 64) {
  const n = size, data = new Uint8Array(n * n * n * 2);
  for (let c = 0; c < 2; c++) {
    const acc = new Float32Array(n * n * n);
    let amp = 0.5, tot = 0;
    for (let o = 0; o < 4; o++) {
      const P = 4 << o, r = rng(7000 + c * 31 + o * 7), lat = new Float32Array(P * P * P);
      for (let i = 0; i < lat.length; i++) lat[i] = r();
      const L = (x, y, z) => lat[((z % P) * P + (y % P)) * P + (x % P)];
      for (let z = 0; z < n; z++) for (let y = 0; y < n; y++) for (let x = 0; x < n; x++) {
        const fx = (x / n) * P, fy = (y / n) * P, fz = (z / n) * P;
        const x0 = Math.floor(fx), y0 = Math.floor(fy), z0 = Math.floor(fz);
        let tx = fx - x0, ty = fy - y0, tz = fz - z0;
        tx = tx * tx * (3 - 2 * tx); ty = ty * ty * (3 - 2 * ty); tz = tz * tz * (3 - 2 * tz);
        const m = (a, b, t) => a + (b - a) * t;
        let v = m(m(m(L(x0, y0, z0), L(x0 + 1, y0, z0), tx), m(L(x0, y0 + 1, z0), L(x0 + 1, y0 + 1, z0), tx), ty),
          m(m(L(x0, y0, z0 + 1), L(x0 + 1, y0, z0 + 1), tx), m(L(x0, y0 + 1, z0 + 1), L(x0 + 1, y0 + 1, z0 + 1), tx), ty), tz);
        if (c === 1) v = 1 - Math.abs(2 * v - 1);
        acc[(z * n + y) * n + x] += amp * v;
      }
      tot += amp; amp *= 0.5;
    }
    let mn = 1e9, mx = -1e9;
    for (let i = 0; i < acc.length; i++) { mn = Math.min(mn, acc[i]); mx = Math.max(mx, acc[i]); }
    for (let i = 0; i < acc.length; i++) data[i * 2 + c] = ((acc[i] - mn) / (mx - mn)) * 255;
  }
  const t = new THREE.Data3DTexture(data, n, n, n);
  t.format = THREE.RGFormat; t.type = THREE.UnsignedByteType;
  t.wrapS = t.wrapT = t.wrapR = THREE.RepeatWrapping; t.minFilter = THREE.LinearFilter; t.magFilter = THREE.LinearFilter;
  t.unpackAlignment = 1; t.needsUpdate = true;
  return t;
}

// Tileable gradient (Perlin) fbm, 4 channels. Used for surface ripples: value noise shows its lattice
// as a faint grid when used as a normal map at grazing angles; gradient noise does not.
export function perlin2D(size = 256) {
  const data = new Uint8Array(size * size * 4);
  for (let c = 0; c < 4; c++) {
    const acc = new Float32Array(size * size);
    let amp = 0.5;
    for (let o = 0; o < 5; o++) {
      const P = 6 << o, r = rng(5000 + c * 131 + o * 17), gx = new Float32Array(P * P), gy = new Float32Array(P * P);
      for (let i = 0; i < P * P; i++) { const a = r() * Math.PI * 2; gx[i] = Math.cos(a); gy[i] = Math.sin(a); }
      for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
        const fx = (x / size) * P, fy = (y / size) * P, x0 = Math.floor(fx), y0 = Math.floor(fy), dx = fx - x0, dy = fy - y0;
        const x1 = (x0 + 1) % P, y1 = (y0 + 1) % P, u = dx * dx * dx * (dx * (dx * 6 - 15) + 10), v = dy * dy * dy * (dy * (dy * 6 - 15) + 10);
        const d = (ix, iy, ox, oy) => gx[iy * P + ix] * ox + gy[iy * P + ix] * oy;
        const a = d(x0, y0, dx, dy), b = d(x1, y0, dx - 1, dy), e = d(x0, y1, dx, dy - 1), f = d(x1, y1, dx - 1, dy - 1);
        acc[y * size + x] += amp * (a + (b - a) * u + (e - a) * v + (a - b - e + f) * u * v);
      }
      amp *= 0.55;
    }
    for (let i = 0; i < size * size; i++) data[i * 4 + c] = Math.max(0, Math.min(255, (0.5 + acc[i] * 0.62) * 255));
  }
  const t = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.minFilter = THREE.LinearMipmapLinearFilter; t.magFilter = THREE.LinearFilter;
  t.generateMipmaps = true; t.anisotropy = 8; t.needsUpdate = true;
  return t;
}
