// Spray: spindrift torn from wave crests and bursts from the bow.
import * as THREE from 'three';
export class Spray {
  constructor(n = 3500) {
    this.n = n; this.p = new Float32Array(n * 3); this.vel = new Float32Array(n * 3); this.a = new Float32Array(n * 3); // life, maxLife, size
    this.i = 0;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.p, 3)); g.setAttribute('info', new THREE.BufferAttribute(this.a, 3));
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false,
      uniforms: { uCol: { value: new THREE.Vector3(0, 0, 0) }, uScale: { value: 600 }, uPano: { value: null } },
      vertexShader: `attribute vec3 info; varying float vA; uniform float uScale;
        void main(){ float k = clamp(info.x/max(info.y, 0.01), 0., 1.); vA = info.y > 0. ? sin(k*3.14159)*0.5 : 0.;
          vec4 mv = modelViewMatrix*vec4(position, 1.); gl_Position = projectionMatrix*mv;
          gl_PointSize = min(info.z*(0.5 + 1.5*(1.-k))*uScale/max(-mv.z, 1.), 420.); }`,
      fragmentShader: `varying float vA; uniform vec3 uCol; uniform sampler2D uPano;
        void main(){ vec2 q = gl_PointCoord - 0.5; float d = dot(q, q)*4.; float a = exp(-d*3.2)*(1.-smoothstep(0.7, 1., d))*vA; if (a < 0.004) discard; gl_FragColor = vec4(textureLod(uPano, vec2(0.5, 0.7), 12.).rgb*1.05 + uCol, a*0.38); }`,
    });
    this.mesh = new THREE.Points(g, this.mat); this.mesh.frustumCulled = false;
  }
  emit(x, y, z, vx, vy, vz, life, size) {
    const i = this.i; this.i = (i + 1) % this.n;
    this.p[i * 3] = x; this.p[i * 3 + 1] = y; this.p[i * 3 + 2] = z; this.vel[i * 3] = vx; this.vel[i * 3 + 1] = vy; this.vel[i * 3 + 2] = vz;
    this.a[i * 3] = life; this.a[i * 3 + 1] = life; this.a[i * 3 + 2] = size;
  }
  update(dt, wx, wz) {
    const { p, vel, a, n } = this, k = 1 - Math.exp(-dt * 1.4);
    for (let i = 0; i < n; i++) {
      if (a[i * 3] <= 0) continue;
      a[i * 3] -= dt; if (a[i * 3] <= 0) { a[i * 3 + 1] = 0; continue; }
      vel[i * 3] += (wx - vel[i * 3]) * k; vel[i * 3 + 2] += (wz - vel[i * 3 + 2]) * k; vel[i * 3 + 1] -= 2.5 * dt;
      p[i * 3] += vel[i * 3] * dt; p[i * 3 + 1] += vel[i * 3 + 1] * dt; p[i * 3 + 2] += vel[i * 3 + 2] * dt;
    }
    this.mesh.geometry.attributes.position.needsUpdate = true; this.mesh.geometry.attributes.info.needsUpdate = true;
  }
}
