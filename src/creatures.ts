/**
 * Everything that moves: people walking the sidewalks and the plaza, cars in
 * the street grid and out on the loop road, deer herds grazing the hills,
 * bird flocks circling overhead, bats in the caverns and beetle-like
 * crawlers on the cave floors. All of them are a few low-poly parts with the
 * same glowing edges, animated by swinging those parts.
 */
import * as THREE from 'three';
import { prep, soup } from './glow.js';
import { style, type Category } from './style.js';
import { mulberry32 } from './noise.js';
import { heightAt, LAKE, roadLength } from './terrain.js';
import { blocks, streetLines } from './city.js';
import { roadAt } from './nature.js';
import { caveSpots, caveCast, CRYSTAL_CAVERN, POOL_CAVERN, GROTTO } from './caves.js';

const box = (w: number, h: number, d: number, py = 0) => prep(new THREE.BoxGeometry(w, h, d).translate(0, py, 0));
const mats = new Map<string, THREE.Material>();
const mat = (c: Category) => { let m = mats.get(c); if (!m) { m = style.material(c, { side: THREE.DoubleSide }); mats.set(c, m); } return m; };

function part(parent: THREE.Object3D, g: THREE.BufferGeometry, c: Category, x = 0, y = 0, z = 0): THREE.Mesh {
  const m = new THREE.Mesh(g, mat(c));
  m.position.set(x, y, z);
  parent.add(m);
  return m;
}
function pivot(parent: THREE.Object3D, x: number, y: number, z: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  parent.add(g);
  return g;
}

interface Mover { group: THREE.Group; update(dt: number, t: number): void }

// ---- people -----------------------------------------------------------------------------

const G = {
  leg: box(0.2, 0.9, 0.22, -0.45),
  arm: box(0.13, 0.72, 0.13, -0.36),
  torso: box(0.5, 0.66, 0.28),
  hips: box(0.42, 0.2, 0.26),
  head: prep(new THREE.IcosahedronGeometry(0.17, 0), true),
};

function makePerson(cat: Category, rnd: () => number) {
  const group = new THREE.Group();
  const s = 0.9 + rnd() * 0.2;
  group.scale.setScalar(s);
  const legL = pivot(group, -0.11, 0.95, 0), legR = pivot(group, 0.11, 0.95, 0);
  part(legL, G.leg, cat); part(legR, G.leg, cat);
  part(group, G.hips, cat, 0, 0.98, 0);
  part(group, G.torso, cat, 0, 1.36, 0);
  const armL = pivot(group, -0.33, 1.65, 0), armR = pivot(group, 0.33, 1.65, 0);
  part(armL, G.arm, cat); part(armR, G.arm, cat);
  part(group, G.head, cat, 0, 1.88, 0);
  return { group, legL, legR, armL, armR };
}

function person(rnd: () => number, path: (u: number) => [number, number, number], length: number): Mover {
  const p = makePerson(rnd() < 0.55 ? 'person' : 'personB', rnd);
  let u = rnd() * length, pause = 0, phase = rnd() * 10;
  const speed = 1.1 + rnd() * 0.7, dir = rnd() < 0.5 ? 1 : -1;
  return {
    group: p.group,
    update(dt) {
      if (pause > 0) pause -= dt;
      else {
        u = (u + dir * speed * dt + length) % length;
        phase += dt * speed * 4.2;
        if (rnd() < dt * 0.02) pause = 2 + rnd() * 5;
      }
      const [x, z, yaw] = path(u);
      p.group.position.set(x, heightAt(x, z), z);
      p.group.rotation.y = yaw + (dir < 0 ? Math.PI : 0);
      const sw = pause > 0 ? 0 : Math.sin(phase) * 0.6;
      p.legL.rotation.x = sw; p.legR.rotation.x = -sw;
      p.armL.rotation.x = -sw * 0.8; p.armR.rotation.x = sw * 0.8;
    },
  };
}

function rectPath(x0: number, z0: number, x1: number, z1: number) {
  const w = x1 - x0, h = z1 - z0, L = 2 * (w + h);
  const f = (u: number): [number, number, number] => {
    if (u < w) return [x0 + u, z0, Math.PI / 2];
    if (u < w + h) return [x1, z0 + (u - w), 0];
    if (u < 2 * w + h) return [x1 - (u - w - h), z1, -Math.PI / 2];
    return [x0, z1 - (u - 2 * w - h), Math.PI];
  };
  return { f, L };
}

function wanderPath(cx: number, cz: number, r: number, rnd: () => number, minFrac = 0.5) {
  // a closed wobbly loop around a centre
  const k = 2 + Math.floor(rnd() * 3), ph = rnd() * 6, rr = r * (minFrac + rnd() * (1 - minFrac));
  const L = Math.PI * 2 * rr;
  const f = (u: number): [number, number, number] => {
    const a = (u / L) * Math.PI * 2;
    const q = rr * (1 + 0.25 * Math.sin(k * a + ph));
    const x = cx + Math.cos(a) * q, z = cz + Math.sin(a) * q;
    return [x, z, Math.atan2(-Math.sin(a), Math.cos(a))];
  };
  return { f, L };
}

// ---- cars -------------------------------------------------------------------------------

const CG = {
  body: box(2, 0.7, 4.3, 0.65),
  cabin: box(1.7, 0.6, 2.1, 1.3),
  light: box(0.45, 0.2, 0.1),
  wheel: prep(new THREE.CylinderGeometry(0.36, 0.36, 0.3, 6).rotateZ(Math.PI / 2)),
};

function makeCar(cat: Category) {
  const group = new THREE.Group();
  part(group, CG.body, cat);
  part(group, CG.cabin, cat, 0, 0, -0.2);
  for (const x of [-0.65, 0.65]) {
    part(group, CG.light, 'headlight', x, 0.7, 2.16);
    part(group, CG.light, 'taillight', x, 0.75, -2.16);
  }
  for (const x of [-1, 1]) for (const z of [-1.4, 1.4]) part(group, CG.wheel, 'pole', x, 0.36, z);
  return group;
}

function cityCar(rnd: () => number): Mover {
  const group = makeCar(rnd() < 0.5 ? 'car' : 'carB');
  const lines = streetLines;
  let axis: 'x' | 'z' = rnd() < 0.5 ? 'x' : 'z';
  let line = lines[Math.floor(rnd() * lines.length)];
  let dir = rnd() < 0.5 ? 1 : -1;
  let u = lines[0] + rnd() * (lines[lines.length - 1] - lines[0]);
  const speed = 10 + rnd() * 8;
  let yaw = 0;
  const nextStop = () => {
    const sorted = dir > 0 ? lines : [...lines].reverse();
    return sorted.find((v) => (dir > 0 ? v > u + 0.01 : v < u - 0.01));
  };
  let target = nextStop();
  return {
    group,
    update(dt) {
      if (target === undefined) { dir = -dir; target = nextStop(); }
      u += dir * speed * dt;
      if (target !== undefined && (dir > 0 ? u >= target : u <= target)) {
        const at = target;
        const canStraight = dir > 0 ? at < lines[lines.length - 1] : at > lines[0];
        const r = rnd();
        if (!canStraight || r < 0.35) {
          // turn onto the crossing street
          const newLine = at;
          u = line;
          line = newLine;
          axis = axis === 'x' ? 'z' : 'x';
          dir = u >= lines[lines.length - 1] ? -1 : u <= lines[0] ? 1 : rnd() < 0.5 ? 1 : -1;
        } else u = at + dir * 0.02;
        target = nextStop();
      }
      const lane = 3.5;
      const x = axis === 'x' ? u : line - dir * lane;
      const z = axis === 'x' ? line + dir * lane : u;
      group.position.set(x, 0, z);
      const want = axis === 'x' ? (dir > 0 ? Math.PI / 2 : -Math.PI / 2) : dir > 0 ? 0 : Math.PI;
      let d = want - yaw;
      d = Math.atan2(Math.sin(d), Math.cos(d));
      yaw += d * Math.min(1, dt * 8);
      group.rotation.y = yaw;
    },
  };
}

function roadCar(rnd: () => number): Mover {
  const group = makeCar(rnd() < 0.5 ? 'car' : 'carB');
  let s = rnd() * roadLength;
  const dir = rnd() < 0.5 ? 1 : -1, speed = 22 + rnd() * 18;
  return {
    group,
    update(dt) {
      s += dir * speed * dt;
      const p = roadAt(s);
      const o = dir * 3.4;
      group.position.set(p.x - p.tz * o, p.y + 0.12, p.z + p.tx * o);
      group.rotation.y = Math.atan2(p.tx * dir, p.tz * dir);
    },
  };
}

// ---- deer ---------------------------------------------------------------------------------

const DG = {
  body: box(0.55, 0.55, 1.35),
  neck: box(0.22, 0.75, 0.25, 0.35),
  head: box(0.25, 0.25, 0.5, 0, ),
  leg: box(0.12, 0.85, 0.12, -0.42),
  antler: box(0.05, 0.5, 0.05, 0.25),
  tail: box(0.12, 0.2, 0.08),
};

function deer(rnd: () => number, hx: number, hz: number): Mover {
  const group = new THREE.Group();
  const cat: Category = 'deer';
  part(group, DG.body, cat, 0, 1.15, 0);
  const neck = pivot(group, 0, 1.3, 0.55);
  part(neck, DG.neck, cat);
  const head = part(neck, DG.head, cat, 0, 0.75, 0.15);
  if (rnd() < 0.5) for (const sx of [-1, 1]) {
    const a = part(head, DG.antler, cat, sx * 0.08, 0.1, -0.1); a.rotation.z = -sx * 0.4;
    const b = part(a, DG.antler, cat, 0, 0.35, 0); b.rotation.x = 0.7; b.scale.setScalar(0.7);
  }
  part(group, DG.tail, cat, 0, 1.35, -0.7);
  const legs: THREE.Group[] = [];
  for (const [x, z] of [[-0.18, 0.5], [0.18, 0.5], [-0.18, -0.5], [0.18, -0.5]]) {
    const l = pivot(group, x, 0.88, z);
    part(l, DG.leg, cat);
    legs.push(l);
  }
  group.scale.setScalar(1.1 + rnd() * 0.3);
  const pos = new THREE.Vector2(hx + (rnd() - 0.5) * 30, hz + (rnd() - 0.5) * 30);
  const tgt = pos.clone();
  let graze = rnd() * 5, yaw = rnd() * 6, phase = 0;
  return {
    group,
    update(dt) {
      if (graze > 0) {
        graze -= dt;
        neck.rotation.x += (1.9 - neck.rotation.x) * Math.min(1, dt * 2);
        if (graze <= 0) tgt.set(hx + (rnd() - 0.5) * 120, hz + (rnd() - 0.5) * 120);
        for (const l of legs) l.rotation.x *= 0.9;
      } else {
        neck.rotation.x += (0.15 - neck.rotation.x) * Math.min(1, dt * 3);
        const d = tgt.clone().sub(pos);
        if (d.length() < 1) graze = 3 + rnd() * 8;
        else {
          const want = Math.atan2(d.x, d.y);
          let dy = want - yaw; dy = Math.atan2(Math.sin(dy), Math.cos(dy));
          yaw += dy * Math.min(1, dt * 2.5);
          pos.x += Math.sin(yaw) * 2.4 * dt;
          pos.y += Math.cos(yaw) * 2.4 * dt;
          phase += dt * 7;
          const sw = Math.sin(phase) * 0.5;
          legs[0].rotation.x = sw; legs[3].rotation.x = sw; legs[1].rotation.x = -sw; legs[2].rotation.x = -sw;
        }
      }
      group.position.set(pos.x, heightAt(pos.x, pos.y), pos.y);
      group.rotation.y = yaw;
    },
  };
}

// ---- birds and bats -----------------------------------------------------------------------

const wingSoup = (span: number, chord: number, jag: boolean) => {
  const pts: number[] = [0, 0, chord * 0.5, span, 0, 0, 0, 0, -chord * 0.5];
  if (jag) pts.push(span * 0.5, 0, -chord * 0.2, span, 0, 0, span * 0.75, 0, -chord * 0.9);
  return soup(pts);
};
const BG = {
  body: prep(new THREE.OctahedronGeometry(0.3, 0).scale(0.7, 0.6, 2), true),
  wing: wingSoup(1.3, 0.8, false),
  batBody: prep(new THREE.OctahedronGeometry(0.25, 0).scale(1, 1, 1.4), true),
  batWing: wingSoup(1.0, 0.9, true),
};

function flier(cat: Category, body: THREE.BufferGeometry, wing: THREE.BufferGeometry, flapRate: number) {
  const group = new THREE.Group();
  part(group, body, cat);
  const wl = pivot(group, 0, 0, 0), wr = pivot(group, 0, 0, 0);
  part(wr, wing, cat);
  const l = part(wl, wing, cat); l.scale.x = -1;
  let ph = Math.random() * 6;
  return {
    group,
    flap(dt: number, amt = 1) {
      ph += dt * flapRate;
      const a = Math.sin(ph) * 0.7 * amt;
      wr.rotation.z = a; wl.rotation.z = -a;
    },
  };
}

function flock(rnd: () => number, cx: number, cz: number, R: number, alt: number, count: number): Mover[] {
  const out: Mover[] = [];
  const speed = (0.08 + rnd() * 0.06) * (rnd() < 0.5 ? 1 : -1);
  for (let i = 0; i < count; i++) {
    const b = flier('bird', BG.body, BG.wing, 9 + rnd() * 3);
    b.group.scale.setScalar(1.4);
    const ox = (rnd() - 0.5) * 20, oy = (rnd() - 0.5) * 8, oz = (rnd() - 0.5) * 20, w = rnd() * 6;
    out.push({
      group: b.group,
      update(dt, t) {
        const a = t * speed + i * 0.01;
        const x = cx + Math.cos(a) * R + ox + Math.sin(t * 0.7 + w) * 3;
        const z = cz + Math.sin(a) * R + oz;
        const y = Math.max(alt, heightAt(x, z) + 40) + oy + Math.sin(t * 1.1 + w) * 2;
        const dx = -Math.sin(a) * Math.sign(speed), dz = Math.cos(a) * Math.sign(speed);
        b.group.position.set(x, y, z);
        b.group.rotation.set(0, Math.atan2(dx, dz), -0.3 * Math.sign(speed));
        b.flap(dt, 0.6 + 0.4 * Math.sin(t * 0.5 + w));
      },
    });
  }
  return out;
}

function bat(rnd: () => number, c: [number, number, number], r: [number, number, number]): Mover {
  const b = flier('bat', BG.batBody, BG.batWing, 22 + rnd() * 6);
  const sp = 0.5 + rnd() * 0.5, ph = rnd() * 6, rx = r[0] * (0.2 + rnd() * 0.35), rz = r[2] * (0.2 + rnd() * 0.35);
  const dir = rnd() < 0.5 ? 1 : -1;
  return {
    group: b.group,
    update(dt, t) {
      const a = (t * sp + ph) * dir;
      const x = c[0] + Math.cos(a) * rx + Math.sin(t * 2.3 + ph) * 2;
      const z = c[2] + Math.sin(a) * rz;
      const y = c[1] + 4 + Math.sin(t * 1.7 + ph) * 3;
      b.group.position.set(x, y, z);
      b.group.rotation.set(0, Math.atan2(-Math.sin(a) * dir, Math.cos(a) * dir), Math.sin(t * 5 + ph) * 0.4);
      b.flap(dt);
    },
  };
}

// ---- cave crawlers ------------------------------------------------------------------------

const KG = {
  body: prep(new THREE.IcosahedronGeometry(0.7, 0).scale(1, 0.5, 1.5), true),
  head: prep(new THREE.IcosahedronGeometry(0.35, 0), true),
  leg: box(0.07, 0.07, 0.9, 0),
};

function crawler(rnd: () => number, home: THREE.Vector3): Mover {
  const group = new THREE.Group();
  part(group, KG.body, 'crawler', 0, 0.55, 0);
  part(group, KG.head, 'crawler', 0, 0.55, 1.1);
  const legs: THREE.Group[] = [];
  for (let i = 0; i < 6; i++) {
    const side = i < 3 ? -1 : 1, z = ((i % 3) - 1) * 0.55;
    const l = pivot(group, side * 0.45, 0.5, z);
    const m = part(l, KG.leg, 'crawler', side * 0.45, -0.2, 0);
    m.rotation.y = Math.PI / 2;
    m.rotation.x = side * 0.5;
    legs.push(l);
  }
  group.scale.setScalar(1.3 + rnd() * 0.8);
  const pos = home.clone();
  let yaw = rnd() * 6, ph = 0, y = home.y, recast = 0, turn = 0;
  return {
    group,
    update(dt) {
      turn -= dt;
      if (turn < 0) turn = 1 + rnd() * 3;
      yaw += Math.sin(turn * 2) * dt * 1.2;
      const nx = pos.x + Math.sin(yaw) * 2.2 * dt, nz = pos.z + Math.cos(yaw) * 2.2 * dt;
      if (Math.hypot(nx - home.x, nz - home.z) < 14) { pos.x = nx; pos.z = nz; } else yaw += Math.PI * dt * 2;
      recast -= dt;
      if (recast < 0) {
        recast = 0.25;
        const hit = caveCast([pos.x, y + 3, pos.z], [0, -1, 0], 12);
        if (hit) pos.y = hit[1];
      }
      y += (pos.y - y) * Math.min(1, dt * 6);
      ph += dt * 14;
      legs.forEach((l, i) => { l.rotation.y = Math.sin(ph + (i % 2) * Math.PI) * 0.35; });
      group.position.set(pos.x, y, pos.z);
      group.rotation.y = yaw;
    },
  };
}

// ---- the population -----------------------------------------------------------------------

export interface Population { update(dt: number, t: number, cam: THREE.Vector3): void; count: number }

export function buildCreatures(scene: THREE.Scene): Population {
  const rnd = mulberry32(2024);
  const movers: Mover[] = [];
  const add = (m: Mover, layer = 0) => { movers.push(m); if (layer) m.group.traverse((o) => o.layers.set(layer)); scene.add(m.group); };

  // people on the sidewalks around blocks, wandering in parks and on the plaza
  for (const b of blocks) {
    const n = b.kind === 'build' ? 1 + Math.floor(rnd() * 2) : 4 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const p = b.kind === 'build' ? rectPath(b.x0 + 2.2, b.z0 + 2.2, b.x1 - 2.2, b.z1 - 2.2)
        : b.kind === 'plaza' ? wanderPath((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, 34, rnd)
        : wanderPath((b.x0 + b.x1) / 2, (b.z0 + b.z1) / 2, 32, rnd);
      add(person(rnd, p.f, p.L), 1);
    }
  }
  // a few people strolling by the lake
  for (let i = 0; i < 8; i++) {
    const p = wanderPath(LAKE.x, LAKE.z, LAKE.r * 1.4, rnd, 0.95);
    add(person(rnd, p.f, p.L));
  }
  for (let i = 0; i < 46; i++) add(cityCar(rnd), 1);
  for (let i = 0; i < 16; i++) add(roadCar(rnd), 1);

  // deer herds in the hills and by the lake
  const herds: [number, number][] = [[-600, -150], [-1050, -650], [-300, 700], [600, 950], [-1200, 300], [250, -800], [900, -600]];
  for (const [hx, hz] of herds) for (let i = 0; i < 4 + rnd() * 3; i++) add(deer(rnd, hx, hz));

  // flocks
  for (const f of [[0, 0, 500, 260], [-850, -350, 300, 80], [700, -800, 400, 200], [-500, 900, 350, 140], [1000, 0, 600, 180]] as const)
    for (const m of flock(rnd, f[0], f[1], f[2], f[3], 10 + Math.floor(rnd() * 6))) add(m);

  // the caves
  for (const room of [CRYSTAL_CAVERN, POOL_CAVERN, GROTTO]) for (let i = 0; i < (room === GROTTO ? 3 : 9); i++) add(bat(rnd, room.c, room.r), 1);
  for (const f of caveSpots().floors) add(crawler(rnd, f), 1);

  const tmp = new THREE.Vector3();
  return {
    count: movers.length,
    update(dt, t, cam) {
      for (const m of movers) {
        m.group.getWorldPosition(tmp);
        const far = tmp.distanceToSquared(cam) > 650 * 650;
        m.group.visible = !far;
        // things far away still move, just less often
        if (!far || Math.random() < 0.1) m.update(far ? Math.min(dt * 10, 0.5) : dt, t);
      }
    },
  };
}

