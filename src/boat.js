// Boat dynamics (wave- and wind-driven), input handling and chase camera.
import * as THREE from 'three';
const G = 9.81, clamp = (x, a, b) => Math.min(b, Math.max(a, x));

export class Input {
  constructor(el) {
    this.k = {}; this.throttle = 0; this.rudder = 0; this.look = { yaw: 0, pitch: 0 }; this.pressed = [];
    addEventListener('keydown', (e) => { if (!this.k[e.code]) this.pressed.push(e.code); this.k[e.code] = true; if (/Arrow|Space/.test(e.code)) e.preventDefault(); });
    addEventListener('keyup', (e) => { this.k[e.code] = false; });
    addEventListener('blur', () => { this.k = {}; });
    let drag = null; // one pointer looks around (the touch stick is a separate element with its own pointer)
    this.stick = null; // {x, y} in -1..1 from the on-screen stick (phones): x rudder, y forward
    el.addEventListener('pointerdown', (e) => { drag = [e.clientX, e.clientY, e.pointerId]; });
    addEventListener('pointerup', (e) => { if (drag && e.pointerId === drag[2]) drag = null; });
    addEventListener('pointercancel', (e) => { if (drag && e.pointerId === drag[2]) drag = null; });
    addEventListener('pointermove', (e) => { if (!drag || e.pointerId !== drag[2]) return; this.look.yaw -= (e.clientX - drag[0]) * 0.005; this.look.pitch = clamp(this.look.pitch + (e.clientY - drag[1]) * 0.003, -0.25, 0.6); drag = [e.clientX, e.clientY, drag[2]]; });
  }
  update(dt) {
    const k = this.k; let th = (k.KeyW || k.ArrowUp ? 1 : 0) - (k.KeyS || k.ArrowDown ? 0.5 : 0), rd = (k.KeyD || k.ArrowRight ? 1 : 0) - (k.KeyA || k.ArrowLeft ? 1 : 0);
    const gp = navigator.getGamepads ? [...navigator.getGamepads()].find((g) => g) : null;
    if (gp) {
      const dz = (v) => (Math.abs(v) < 0.12 ? 0 : v);
      const t = (gp.buttons[7]?.value || 0) - 0.5 * (gp.buttons[6]?.value || 0); if (Math.abs(t) > 0.05) th = t;
      const sx = dz(gp.axes[0] || 0); if (sx) rd = sx;
      this.look.yaw -= dz(gp.axes[2] || 0) * dt * 1.6; this.look.pitch = clamp(this.look.pitch + dz(gp.axes[3] || 0) * dt, -0.25, 0.6);
    }
    if (this.stick) { th = clamp(-this.stick.y, -0.5, 1); rd = this.stick.x; }
    this.throttle += clamp(th - this.throttle, -dt * 1.6, dt * 1.4);
    this.rudder += clamp(rd - this.rudder, -dt * 2.2, dt * 2.2);
    if (!k.pointer) this.look.yaw *= Math.exp(-dt * 0.35);
    const p = this.pressed; this.pressed = []; return p;
  }
}

export class Boat {
  constructor(mesh) {
    this.mesh = mesh; mesh.rotation.order = 'YXZ';
    this.x = 0; this.z = 0; this.psi = 0; this.u = 4; this.v = 0; this.r = 0;
    this.y = 0; this.vy = 0; this.pitch = 0; this.vp = 0; this.roll = 0; this.vr = 0;
    this.slam = 0; this.tmp = [0, 0, 0]; this.wake = []; this.wakeT = 0; this.bowWash = 0; this.prevBow = 0;
    this.speed = 0;
  }
  h(sim, f, s) { const sn = Math.sin(this.psi), cs = Math.cos(this.psi); return sim.heightAt(this.x + sn * f + cs * s, this.z - cs * f + sn * s, this.tmp); }
  // wind: world (x,z) m/s
  update(dt, inp, wx, wz, sim) {
    const sn = Math.sin(this.psi), cs = Math.cos(this.psi), fx = sn, fz = -cs, rx = cs, rz = sn;
    const hb = this.h(sim, 21, 0), hs = this.h(sim, -21, 0), hp = this.h(sim, 0, -4), hsb = this.h(sim, 0, 4), hc = this.h(sim, 0, 0);
    const hbp = this.h(sim, 16, -3), hbs = this.h(sim, 16, 3), hsp = this.h(sim, -16, -3), hss = this.h(sim, -16, 3);
    const vxw = fx * this.u + rx * this.v, vzw = fz * this.u + rz * this.v;
    const ax = wx - vxw, az = wz - vzw, wf = ax * fx + az * fz, wr = ax * rx + az * rz;
    const slopeF = (hb - hs) / 42, slopeS = (hsb - hp) / 8;
    // surge
    const thrust = inp.throttle * 1.55;
    this.u += dt * (thrust - 0.0056 * this.u * Math.abs(this.u) - 0.03 * this.u + 3.4e-5 * wf * Math.abs(wf) - G * slopeF * 0.3);
    // sway (leeway + wave push)
    this.v += dt * (1.5e-4 * wr * Math.abs(wr) - 0.22 * this.v * Math.abs(this.v) - 0.4 * this.v - G * slopeS * 0.1);
    // yaw: rudder (needs way on or prop wash), weathervaning, wave broaching moment
    const flow = this.u * Math.abs(this.u) + 25 * Math.max(inp.throttle, 0);
    const broach = ((hbs - hbp) - (hss - hsp)) * 0.0035;
    this.r += dt * (inp.rudder * 0.0007 * flow + 2.3e-6 * wr * Math.abs(wr) - broach - 1.25 * this.r - 2.5 * this.r * Math.abs(this.r));
    this.psi += this.r * dt; this.x += vxw * dt; this.z += vzw * dt; this.speed = Math.hypot(this.u, this.v);
    // heave / pitch / roll follow the water with inertia
    const heaveT = 0.2 * hb + 0.2 * hs + 0.3 * hc + 0.15 * hp + 0.15 * hsb;
    const pitchT = Math.atan2(hb - hs, 42) * 0.9;
    const rollT = Math.atan2(hsb - hp, 8) * 0.75 - clamp(4.2e-5 * wr * Math.abs(wr), -0.33, 0.33) + clamp(this.u * this.r * 0.06, -0.12, 0.12);
    this.vy += dt * (3.4 * (heaveT - this.y) - 2.0 * this.vy); this.y += this.vy * dt;
    this.vp += dt * (3.0 * (pitchT - this.pitch) - 1.7 * this.vp); this.pitch += this.vp * dt;
    this.vr += dt * (1.15 * (rollT - this.roll) - 0.72 * this.vr); this.roll = clamp(this.roll + this.vr * dt, -0.85, 0.85);
    // bow immersion -> slams
    const bowY = this.y + 21 * Math.sin(this.pitch), imm = hb - bowY, rate = (imm - this.prevBow) / Math.max(dt, 1e-3); this.prevBow = imm;
    this.slam = Math.max(0, this.slam - dt * 1.5);
    this.slamNow = 0;
    if (imm > 1.2 && rate > 2.2 && this.slam < 0.2) { this.slam = clamp((rate - 1.5) / 5 + imm / 6, 0.3, 1); this.slamNow = this.slam; }
    this.bowWash = clamp(imm / 3, 0, 1);
    const m = this.mesh; m.position.set(this.x, this.y + 0.15, this.z); m.rotation.set(this.pitch, -this.psi, this.roll);
    // wake trail
    this.wakeT -= dt;
    if (this.wakeT <= 0) { this.wakeT = 0.8; this.wake.unshift({ x: this.x - fx * 22, z: this.z - fz * 22, age: 14 * (1 - Math.min(1, Math.abs(this.u) / 6)), w: 2 + Math.abs(this.u) * 0.55 }); if (this.wake.length > 24) this.wake.pop(); }
    for (const w of this.wake) { w.age += dt; w.w += dt * 0.5; }
  }
  fwd(out) { return out.set(Math.sin(this.psi), 0, -Math.cos(this.psi)); }
}

export class ChaseCam {
  constructor(cam) { this.cam = cam; this.yaw = 0; this.h = 22; this.dist = 64; this.height = 24; this.shake = 0; this.t = 0; this.shakeOn = true; this.look = new THREE.Vector3(); this.pos = new THREE.Vector3(); this.init = false; this.vel = new THREE.Vector3(); }
  update(dt, boat, inp, sim, gust) {
    this.t += dt;
    let d = boat.psi - this.yaw; d = Math.atan2(Math.sin(d), Math.cos(d)); this.yaw += d * (1 - Math.exp(-dt * 1.6));
    if (!this.init) { this.yaw = boat.psi; }
    const yaw = this.yaw + inp.look.yaw, el = 0.27 + inp.look.pitch;
    const dist = this.dist + 12 * Math.min(1, boat.speed / 15), hx = Math.sin(yaw), hz = -Math.cos(yaw);
    const px = boat.x - hx * dist * Math.cos(el), pz = boat.z - hz * dist * Math.cos(el);
    const water = sim.heightAt(px, pz, [0, 0, 0]);
    const target = Math.max(dist * Math.sin(el) * 0.72 + boat.y * 0.25, water + 4.5);
    this.h = this.init ? this.h + (target - this.h) * (1 - Math.exp(-dt * 1.3)) : target; this.h = Math.max(this.h, water + 3.5);
    const prev = this.pos.clone();
    this.pos.set(px, this.h, pz);
    if (this.init) this.vel.subVectors(this.pos, prev).divideScalar(Math.max(dt, 1e-3));
    const lx = boat.x + hx * 14, lz = boat.z + hz * 14, ly = boat.y * 0.9 + 4;
    this.look.set(lx, this.init ? this.look.y + (ly - this.look.y) * (1 - Math.exp(-dt * 2)) : ly, lz);
    this.cam.position.copy(this.pos); this.cam.lookAt(this.look);
    this.shake = Math.max(this.shake * Math.exp(-dt * 2.2), 0);
    if (this.shakeOn) {
      const a = (0.0035 * gust + this.shake * 0.02), t = this.t;
      this.cam.rotation.x += a * (Math.sin(t * 13.1) * 0.6 + Math.sin(t * 29.3 + 1.3) * 0.4);
      this.cam.rotation.y += a * (Math.sin(t * 11.3 + 2.1) * 0.6 + Math.sin(t * 23.7) * 0.4);
      this.cam.rotation.z += a * 0.7 * Math.sin(t * 7.9 + 0.7);
    }
    this.cam.updateMatrixWorld(); this.init = true;
  }
}
