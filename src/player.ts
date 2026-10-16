/**
 * Getting around. Walk: first person with gravity, terrain, rooftops,
 * building walls and the caves' own distance field as collision; the glowing
 * updraft in each sinkhole shaft lifts you out when you hold jump. Fly: free
 * flight through everything. Ride: a fast, low motorbike run around the loop
 * road, leaning into the bends, like the dusk ride scene.
 */
import * as THREE from 'three';
import { heightAt, groundSolid, HALF, LAKE, WATER_Y, roadLength } from './terrain.js';
import { caveSdf, caveNormal, SHAFTS } from './caves.js';
import { colliders } from './city.js';
import { roadAt, postsNear } from './nature.js';
import { prep } from './glow.js';
import { style } from './style.js';

export type Mode = 'walk' | 'fly' | 'ride';

const EYE = 1.65, R = 0.6, GRAV = 26;

export class Player {
  pos = new THREE.Vector3(-40, 0, 60);
  vel = new THREE.Vector3();
  yaw = Math.PI;
  pitch = 0;
  mode: Mode = 'walk';
  grounded = false;
  keys = new Set<string>();
  /** Virtual stick from touch input: x strafes, y moves forward (-1..1). */
  stick = { x: 0, y: 0 };
  rideS = 0;
  rideSpeed = 0;
  rideLane = 1.8;
  private roll = 0;
  private bike: THREE.Group;
  private n = new THREE.Vector3();

  constructor(private camera: THREE.PerspectiveCamera) {
    this.pos.y = heightAt(this.pos.x, this.pos.z);
    // handlebars and a dash for ride mode, hanging in front of the camera
    this.bike = new THREE.Group();
    const m = style.material('bike', { fog: false, side: THREE.DoubleSide });
    const bar = new THREE.Mesh(prep(new THREE.BoxGeometry(1.1, 0.04, 0.04)), m);
    bar.position.set(0, -0.42, -0.75);
    const dash = new THREE.Mesh(prep(new THREE.CylinderGeometry(0.12, 0.16, 0.08, 6).rotateX(1.2), true), m);
    dash.position.set(0, -0.36, -0.7);
    const tank = new THREE.Mesh(prep(new THREE.OctahedronGeometry(0.22, 0).scale(1, 0.35, 1.6), true), m);
    tank.position.set(0, -0.78, -0.5);
    for (const s of [-1, 1]) {
      const grip = new THREE.Mesh(prep(new THREE.CylinderGeometry(0.035, 0.035, 0.2, 5).rotateZ(Math.PI / 2)), style.material('roadEdge', { fog: false }));
      grip.position.set(s * 0.6, -0.42, -0.75);
      const mirror = new THREE.Mesh(prep(new THREE.BoxGeometry(0.16, 0.08, 0.02)), m);
      mirror.position.set(s * 0.5, -0.2, -0.78);
      this.bike.add(grip, mirror);
    }
    this.bike.add(bar, dash, tank);
    this.bike.traverse((o) => { o.renderOrder = 10; });
    this.bike.visible = false;
    camera.add(this.bike);
  }

  get eye(): THREE.Vector3 { return this.camera.position; }

  setMode(m: Mode) {
    if (m === this.mode) return;
    if (m === 'ride') {
      // join the road at its nearest point
      let best = 0, bd = 1e18;
      for (let s = 0; s < roadLength; s += 5) {
        const p = roadAt(s);
        const d = (p.x - this.pos.x) ** 2 + (p.z - this.pos.z) ** 2;
        if (d < bd) { bd = d; best = s; }
      }
      this.rideS = best;
      this.rideSpeed = 25;
      const p = roadAt(best);
      this.yaw = Math.atan2(-p.tx, -p.tz);
    }
    if (this.mode === 'ride') {
      const p = roadAt(this.rideS);
      this.pos.set(p.x - p.tz * this.rideLane, p.y + 0.2, p.z + p.tx * this.rideLane);
      this.vel.set(0, 0, 0);
    }
    this.bike.visible = m === 'ride';
    this.mode = m;
  }

  teleport(x: number, y: number | null, z: number, yaw: number, mode: Mode = 'walk') {
    if (this.mode === 'ride') this.setMode('walk');
    this.setMode(mode);
    // never exactly above a ground vertex: a vertex at w = 0 trips some software rasterisers
    x += 0.37; z += 0.29;
    this.pos.set(x, y ?? heightAt(x, z) + 0.5, z);
    this.vel.set(0, 0, 0);
    this.yaw = yaw;
    this.pitch = mode === 'fly' ? -0.25 : 0;
  }

  look(dx: number, dy: number) {
    this.yaw -= dx * 0.0022;
    this.pitch = Math.max(-1.5, Math.min(1.5, this.pitch - dy * 0.0022));
  }

  private axis(a: string, b: string) { return (this.keys.has(a) ? 1 : 0) - (this.keys.has(b) ? 1 : 0); }

  update(dt: number) {
    if (this.mode === 'ride') return this.ride(dt);
    const fwd = this.axis('KeyW', 'KeyS') + this.axis('ArrowUp', 'ArrowDown') + this.stick.y;
    const strafe = this.axis('KeyD', 'KeyA') + this.axis('ArrowRight', 'ArrowLeft') + this.stick.x;
    const fast = this.keys.has('ShiftLeft') || this.keys.has('ShiftRight');
    const sy = Math.sin(this.yaw), cy = Math.cos(this.yaw);

    if (this.mode === 'fly') {
      const sp = fast ? 220 : 45;
      const cp = Math.cos(this.pitch), spch = Math.sin(this.pitch);
      const dir = new THREE.Vector3(-sy * cp * fwd + cy * strafe, spch * fwd + this.axis('Space', 'KeyQ'), -cy * cp * fwd - sy * strafe);
      if (this.keys.has('KeyE')) dir.y += 1;
      this.vel.lerp(dir.multiplyScalar(sp), Math.min(1, dt * 6));
      this.pos.addScaledVector(this.vel, dt);
      this.pos.x = Math.max(-HALF * 1.5, Math.min(HALF * 1.5, this.pos.x));
      this.pos.z = Math.max(-HALF * 1.5, Math.min(HALF * 1.5, this.pos.z));
    } else {
      const sp = fast ? 16 : 6.5;
      const wish = new THREE.Vector3(-sy * fwd + cy * strafe, 0, -cy * fwd - sy * strafe);
      if (wish.lengthSq() > 1) wish.normalize();
      wish.multiplyScalar(sp);
      const k = Math.min(1, dt * (this.grounded ? 12 : 2.5));
      this.vel.x += (wish.x - this.vel.x) * k;
      this.vel.z += (wish.z - this.vel.z) * k;
      this.vel.y -= GRAV * dt;
      if (this.keys.has('Space') && this.grounded) { this.vel.y = 9; this.grounded = false; }
      // the updraft in a sinkhole shaft
      for (const s of SHAFTS) {
        if (Math.hypot(this.pos.x - s.x, this.pos.z - s.z) < 12 && this.pos.y < s.top + 6 && this.pos.y > s.bottom - 2 && this.keys.has('Space')) {
          this.vel.y = Math.min(this.vel.y + 60 * dt, 16);
        }
      }
      this.vel.y = Math.max(this.vel.y, -45);
      const steps = Math.max(1, Math.ceil((this.vel.length() * dt) / 0.4));
      this.grounded = false;
      for (let i = 0; i < steps; i++) {
        this.pos.addScaledVector(this.vel, dt / steps);
        this.collide();
      }
    }
    this.place();
  }

  private collide() {
    const p = this.pos;
    p.x = Math.max(-HALF + 15, Math.min(HALF - 15, p.x));
    p.z = Math.max(-HALF + 15, Math.min(HALF - 15, p.z));
    const ground = heightAt(p.x, p.z);

    // the caves: a sphere around the body pushed out of the rock along the field's gradient
    if (p.y < ground - 0.5 || !groundSolid(p.x, p.z)) {
      for (const off of [R, 1.2]) {
        const cx = p.x, cy = p.y + off, cz = p.z;
        if (cy > heightAt(cx, cz) - 0.5 && groundSolid(cx, cz)) continue;
        const d = caveSdf(cx, cy, cz);
        if (d > -R) {
          const n = caveNormal(cx, cy, cz, this.n);
          const push = Math.min(d + R, 3);
          p.addScaledVector(n, -push);
          const vn = this.vel.dot(n);
          if (vn > 0) this.vel.addScaledVector(n, -vn);
          if (n.y < -0.55) this.grounded = true;
        }
      }
    }

    // open ground (not over a sinkhole, and not deep underground)
    if (groundSolid(p.x, p.z) && p.y > ground - 3 && p.y < ground) {
      p.y = ground;
      if (this.vel.y < 0) this.vel.y = 0;
      this.grounded = true;
    }

    // the lake carries you: wade along at the surface
    if (Math.hypot(p.x - LAKE.x, p.z - LAKE.z) < LAKE.r * 1.3 && p.y < WATER_Y - 1.1 && p.y > WATER_Y - 6) {
      p.y = WATER_Y - 1.1;
      if (this.vel.y < 0) this.vel.y = 0;
      this.grounded = true;
    }

    // trunks and boulders: round posts you slide around (or stand on, for low rocks)
    for (const q of postsNear(p.x, p.z)) {
      const dx = p.x - q.x, dz = p.z - q.z, d = Math.hypot(dx, dz), min = q.r + R;
      if (d >= min || p.y >= q.top - 0.4) continue;
      if (q.top - p.y < 0.9 && d < q.r) { p.y = q.top; if (this.vel.y < 0) this.vel.y = 0; this.grounded = true; continue; }
      const k = d > 1e-6 ? (min - d) / d : 0;
      p.x += dx * k; p.z += dz * k;
      if (d <= 1e-6) p.x += min;
    }

    // buildings: stand on roofs, slide along walls
    if (Math.abs(p.x) < 460 && Math.abs(p.z) < 460) {
      for (const b of colliders) {
        if (p.x < b.minX - R || p.x > b.maxX + R || p.z < b.minZ - R || p.z > b.maxZ + R) continue;
        if (p.y >= b.top - 0.7) {
          if (p.x > b.minX && p.x < b.maxX && p.z > b.minZ && p.z < b.maxZ && p.y < b.top) {
            p.y = b.top;
            if (this.vel.y < 0) this.vel.y = 0;
            this.grounded = true;
          }
          continue;
        }
        if (p.y + EYE < 0) continue;
        const qx = Math.max(b.minX, Math.min(b.maxX, p.x)), qz = Math.max(b.minZ, Math.min(b.maxZ, p.z));
        let dx = p.x - qx, dz = p.z - qz;
        let d = Math.hypot(dx, dz);
        if (d < 1e-6) {
          // inside: leave through the nearest face
          const opts = [[p.x - b.minX, -1, 0], [b.maxX - p.x, 1, 0], [p.z - b.minZ, 0, -1], [b.maxZ - p.z, 0, 1]].sort((a, c) => a[0] - c[0]);
          dx = opts[0][1]; dz = opts[0][2]; d = 0;
          p.x += dx * (opts[0][0] + R); p.z += dz * (opts[0][0] + R);
          continue;
        }
        if (d < R) {
          p.x += (dx / d) * (R - d);
          p.z += (dz / d) * (R - d);
        }
      }
    }
  }

  private ride(dt: number) {
    const fwd = this.axis('KeyW', 'KeyS') + this.axis('ArrowUp', 'ArrowDown') + Math.round(this.stick.y);
    const steer = this.axis('KeyD', 'KeyA') + this.axis('ArrowRight', 'ArrowLeft') + this.stick.x;
    const target = fwd > 0 ? 110 : fwd < 0 ? 15 : 70;
    this.rideSpeed += (target - this.rideSpeed) * Math.min(1, dt * (fwd < 0 ? 2 : 0.6));
    this.rideS += this.rideSpeed * dt;
    this.rideLane = Math.max(-4.6, Math.min(4.6, this.rideLane + steer * dt * 7));
    const p = roadAt(this.rideS);
    const ahead = roadAt(this.rideS + 25), behind = roadAt(this.rideS - 12), ahead2 = roadAt(this.rideS + 12);
    const heading = Math.atan2(-(ahead.x - p.x), -(ahead.z - p.z));
    const cross = (ahead2.x - p.x) * (p.z - behind.z) - (ahead2.z - p.z) * (p.x - behind.x);
    const curv = cross / 144;
    this.roll += (Math.max(-0.35, Math.min(0.35, curv * 0.25 * (this.rideSpeed / 60))) - steer * 0.08 - this.roll) * Math.min(1, dt * 3);
    const slope = Math.atan2(ahead.y - p.y, 25);
    const t = performance.now() / 1000;
    this.camera.position.set(p.x - p.tz * this.rideLane, p.y + 1.15 + Math.sin(t * 18) * 0.012 * (this.rideSpeed / 60), p.z + p.tx * this.rideLane);
    this.camera.rotation.set(slope - 0.04 + this.pitch, heading + this.lookOffset, this.roll, 'YXZ');
    this.yaw = heading;
    this.pos.copy(this.camera.position).y -= EYE;
    const fovTarget = 75 + Math.min(25, this.rideSpeed * 0.2);
    this.camera.fov += (fovTarget - this.camera.fov) * Math.min(1, dt * 2);
    this.camera.updateProjectionMatrix();
  }

  /** Mouse look while riding, decaying back to straight ahead. */
  lookOffset = 0;
  rideLook(dx: number, dy: number) {
    this.lookOffset = Math.max(-1.6, Math.min(1.6, this.lookOffset - dx * 0.0022));
    this.pitch = Math.max(-0.6, Math.min(0.6, this.pitch - dy * 0.0022));
  }
  relaxLook(dt: number) {
    if (this.mode === 'ride') this.lookOffset *= Math.max(0, 1 - dt * 0.8);
  }

  private place() {
    this.camera.position.set(this.pos.x, this.pos.y + EYE, this.pos.z);
    this.camera.rotation.set(this.pitch, this.yaw, 0, 'YXZ');
    if (Math.abs(this.camera.fov - 75) > 0.1) { this.camera.fov += (75 - this.camera.fov) * 0.1; this.camera.updateProjectionMatrix(); }
  }
}
