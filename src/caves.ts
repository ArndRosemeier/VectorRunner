/**
 * The underground: a cave system defined as a signed distance field
 * (negative = air) built from capsules and flattened ellipsoids, roughened
 * with noise, and meshed with surface nets on a 4 m grid, which gives the
 * faceted, low-poly rock for free. Two sinkhole shafts reach the surface;
 * tunnels link a crystal cavern, a side grotto and a pool cavern. The same
 * field is the collision shape, so walls feel exactly where they glow.
 */
import * as THREE from 'three';
import { ENTRANCES, entranceY, heightAt } from './terrain.js';
import { noise3, smoothstep, mulberry32 } from './noise.js';
import { prep, soup, trs } from './glow.js';
import { style } from './style.js';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

type V3 = [number, number, number];
interface Capsule { a: V3; b: V3; r: number }
interface Room { c: V3; r: V3; floor: number }

const A = ENTRANCES[0], B = ENTRANCES[1];
const yA = entranceY(0), yB = entranceY(1);
// deep enough that every cavern stays under the lowest ground above the system
const baseY = (() => {
  let m = Math.min(yA, yB);
  for (let x = Math.min(A.x, B.x) - 200; x <= Math.max(A.x, B.x) + 200; x += 20)
    for (let z = Math.min(A.z, B.z) - 200; z <= Math.max(A.z, B.z) + 200; z += 20) m = Math.min(m, heightAt(x, z));
  return m - 70;
})();
const lerp3 = (p: V3, q: V3, t: number): V3 => [p[0] + (q[0] - p[0]) * t, p[1] + (q[1] - p[1]) * t, p[2] + (q[2] - p[2]) * t];
const add = (p: V3, q: V3): V3 => [p[0] + q[0], p[1] + q[1], p[2] + q[2]];

const aTop: V3 = [A.x, yA + 12, A.z], aNeck: V3 = [A.x, yA - 22, A.z], aBot: V3 = [A.x, baseY + 6, A.z];
const bTop: V3 = [B.x, yB + 12, B.z], bNeck: V3 = [B.x, yB - 22, B.z], bBot: V3 = [B.x, baseY + 2, B.z];
const AB0: V3 = [A.x, baseY, A.z], AB1: V3 = [B.x, baseY, B.z];

export const CRYSTAL_CAVERN: Room = { c: add(lerp3(AB0, AB1, 0.33), [90, 4, -50]), r: [62, 28, 50], floor: baseY - 7 };
export const POOL_CAVERN: Room = { c: add(lerp3(AB0, AB1, 0.72), [-70, -6, 30]), r: [50, 24, 64], floor: baseY - 13 };
export const GROTTO: Room = { c: add(CRYSTAL_CAVERN.c, [-30, 8, -105]), r: [24, 16, 24], floor: baseY - 2 };
const mid = add(lerp3(CRYSTAL_CAVERN.c, POOL_CAVERN.c, 0.5), [85, 2, 10]);

const capsules: Capsule[] = [
  { a: aTop, b: aNeck, r: 31 },
  { a: aNeck, b: aBot, r: 13 },
  { a: bTop, b: bNeck, r: 31 },
  { a: bNeck, b: bBot, r: 12 },
  { a: aBot, b: CRYSTAL_CAVERN.c, r: 9 },
  { a: CRYSTAL_CAVERN.c, b: mid, r: 8 },
  { a: mid, b: POOL_CAVERN.c, r: 8 },
  { a: POOL_CAVERN.c, b: bBot, r: 9 },
  { a: CRYSTAL_CAVERN.c, b: GROTTO.c, r: 7 },
];
const rooms: Room[] = [CRYSTAL_CAVERN, POOL_CAVERN, GROTTO];
export const SHAFTS = [
  { x: A.x, z: A.z, top: yA, bottom: baseY - 7 },
  { x: B.x, z: B.z, top: yB, bottom: baseY - 10 },
];

function capsuleD(px: number, py: number, pz: number, c: Capsule): number {
  const bx = c.b[0] - c.a[0], by = c.b[1] - c.a[1], bz = c.b[2] - c.a[2];
  const ax = px - c.a[0], ay = py - c.a[1], az = pz - c.a[2];
  const h = Math.max(0, Math.min(1, (ax * bx + ay * by + az * bz) / (bx * bx + by * by + bz * bz)));
  return Math.hypot(ax - bx * h, ay - by * h, az - bz * h) - c.r;
}

function roomD(px: number, py: number, pz: number, r: Room): number {
  const x = (px - r.c[0]) / r.r[0], y = (py - r.c[1]) / r.r[1], z = (pz - r.c[2]) / r.r[2];
  const k = Math.hypot(x, y, z);
  const ell = (k - 1) * Math.min(r.r[0], r.r[1], r.r[2]);
  return Math.max(ell, r.floor - py);
}

const smin = (a: number, b: number, k: number) => {
  const h = Math.max(0, Math.min(1, 0.5 + (0.5 * (b - a)) / k));
  return b + (a - b) * h - k * h * (1 - h);
};

function baseField(x: number, y: number, z: number): number {
  let d = 1e9;
  for (const c of capsules) d = smin(d, capsuleD(x, y, z, c), 7);
  for (const r of rooms) d = smin(d, roomD(x, y, z, r), 9);
  return d;
}

/** Signed distance to the cave walls: negative inside the caves (air), positive in rock. */
export function caveSdf(x: number, y: number, z: number): number {
  const d = baseField(x, y, z);
  if (d > 14) return d;
  // keep the shafts round where they meet the surface so they cover the ground's hole
  let rough = 1;
  for (const s of SHAFTS) {
    if (Math.hypot(x - s.x, z - s.z) < 45) rough = Math.min(rough, smoothstep(s.top - 6, s.top - 30, y));
  }
  return d + rough * ((noise3(x * 0.06, y * 0.06, z * 0.06) - 0.5) * 7 + (noise3(x * 0.17, y * 0.17, z * 0.17) - 0.5) * 2.5);
}

export function caveNormal(x: number, y: number, z: number, out = new THREE.Vector3()): THREE.Vector3 {
  const e = 0.4;
  return out.set(
    caveSdf(x + e, y, z) - caveSdf(x - e, y, z),
    caveSdf(x, y + e, z) - caveSdf(x, y - e, z),
    caveSdf(x, y, z + e) - caveSdf(x, y, z - e),
  ).normalize();
}

/** Marches from p along dir to the first wall; returns the hit or null. */
export function caveCast(p: V3, dir: V3, max = 80): V3 | null {
  let t = 0;
  for (let i = 0; i < 200 && t < max; i++) {
    const q: V3 = [p[0] + dir[0] * t, p[1] + dir[1] * t, p[2] + dir[2] * t];
    const d = caveSdf(q[0], q[1], q[2]);
    if (d > 0) return q;
    t += Math.max(0.3, -d * 0.6);
  }
  return null;
}

// ---- meshing ------------------------------------------------------------------------------

const STEP = 4;

function surfaceNets(): number[] {
  const lo: V3 = [1e9, 1e9, 1e9], hi: V3 = [-1e9, -1e9, -1e9];
  const grow = (p: V3, r: number) => { for (let i = 0; i < 3; i++) { lo[i] = Math.min(lo[i], p[i] - r); hi[i] = Math.max(hi[i], p[i] + r); } };
  for (const c of capsules) { grow(c.a, c.r + 12); grow(c.b, c.r + 12); }
  for (const r of rooms) grow(r.c, Math.max(...r.r) + 12);
  const nx = Math.ceil((hi[0] - lo[0]) / STEP) + 1, ny = Math.ceil((hi[1] - lo[1]) / STEP) + 1, nz = Math.ceil((hi[2] - lo[2]) / STEP) + 1;
  const field = new Float32Array(nx * ny * nz);
  const id = (i: number, j: number, k: number) => (k * ny + j) * nx + i;
  for (let k = 0; k < nz; k++) for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
    const edge = i === 0 || j === 0 || k === 0 || i === nx - 1 || j === ny - 1 || k === nz - 1;
    field[id(i, j, k)] = edge ? 1 : caveSdf(lo[0] + i * STEP, lo[1] + j * STEP, lo[2] + k * STEP);
  }
  // one vertex per sign-changing cell, at the mean of its edge crossings
  const cellV = new Int32Array(nx * ny * nz).fill(-1);
  const verts: number[] = [];
  const corners = [[0, 0, 0], [1, 0, 0], [0, 1, 0], [1, 1, 0], [0, 0, 1], [1, 0, 1], [0, 1, 1], [1, 1, 1]];
  const cedges = [[0, 1], [2, 3], [4, 5], [6, 7], [0, 2], [1, 3], [4, 6], [5, 7], [0, 4], [1, 5], [2, 6], [3, 7]];
  const v = new Float32Array(8);
  for (let k = 0; k < nz - 1; k++) for (let j = 0; j < ny - 1; j++) for (let i = 0; i < nx - 1; i++) {
    let neg = 0;
    for (let c = 0; c < 8; c++) { v[c] = field[id(i + corners[c][0], j + corners[c][1], k + corners[c][2])]; if (v[c] < 0) neg++; }
    if (neg === 0 || neg === 8) continue;
    let sx = 0, sy = 0, sz = 0, n = 0;
    for (const [p, q] of cedges) {
      if ((v[p] < 0) === (v[q] < 0)) continue;
      const t = v[p] / (v[p] - v[q]);
      sx += corners[p][0] + (corners[q][0] - corners[p][0]) * t;
      sy += corners[p][1] + (corners[q][1] - corners[p][1]) * t;
      sz += corners[p][2] + (corners[q][2] - corners[p][2]) * t;
      n++;
    }
    cellV[id(i, j, k)] = verts.length / 3;
    verts.push(lo[0] + (i + sx / n) * STEP, lo[1] + (j + sy / n) * STEP, lo[2] + (k + sz / n) * STEP);
  }
  const tris: number[] = [];
  const quad = (c0: number, c1: number, c2: number, c3: number, flip: boolean) => {
    const q = [cellV[c0], cellV[c1], cellV[c2], cellV[c3]];
    if (q.some((x) => x < 0)) return;
    const o = flip ? [q[0], q[3], q[2], q[1]] : q;
    const P = (x: number) => [verts[x * 3], verts[x * 3 + 1], verts[x * 3 + 2]];
    for (const t of [[o[0], o[1], o[2]], [o[0], o[2], o[3]]]) {
      const a = P(t[0]), b = P(t[1]), c = P(t[2]);
      // nothing pokes out above the ground
      if ([a, b, c].some((v) => v[1] > heightAt(v[0], v[2]) - 0.2)) continue;
      tris.push(...a, ...b, ...c);
    }
  };
  for (let k = 1; k < nz - 1; k++) for (let j = 1; j < ny - 1; j++) for (let i = 1; i < nx - 1; i++) {
    const s = field[id(i, j, k)] < 0;
    if (s !== (field[id(i + 1, j, k)] < 0)) quad(id(i, j - 1, k - 1), id(i, j, k - 1), id(i, j, k), id(i, j - 1, k), s);
    if (s !== (field[id(i, j + 1, k)] < 0)) quad(id(i - 1, j, k - 1), id(i, j, k - 1), id(i, j, k), id(i - 1, j, k), !s);
    if (s !== (field[id(i, j, k + 1)] < 0)) quad(id(i - 1, j - 1, k), id(i, j - 1, k), id(i, j, k), id(i - 1, j, k), s);
  }
  return tris;
}

function floorBelow(x: number, y: number, z: number): number | null {
  const hit = caveCast([x, y, z], [0, -1, 0], 120);
  return hit ? hit[1] : null;
}
function ceilingAbove(x: number, y: number, z: number): number | null {
  const hit = caveCast([x, y, z], [0, 1, 0], 80);
  return hit ? hit[1] : null;
}

export interface CaveWorld {
  glowWorms: THREE.Points;
  lift: THREE.Points;
  update(t: number): void;
}

export function buildCaves(scene: THREE.Scene): CaveWorld {
  scene.add(new THREE.Mesh(soup(surfaceNets()), style.material('cave', { side: THREE.DoubleSide })));
  const rnd = mulberry32(77);

  // crystal clusters on cavern floors
  const crys: THREE.BufferGeometry[] = [], crysB: THREE.BufferGeometry[] = [];
  const oct = prep(new THREE.OctahedronGeometry(1, 0), true);
  const scatter = (room: Room, count: number, spread: number) => {
    for (let n = 0; n < count; n++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * spread;
      const x = room.c[0] + Math.cos(a) * room.r[0] * r, z = room.c[2] + Math.sin(a) * room.r[2] * r;
      const f = floorBelow(x, room.c[1], z);
      if (f === null) continue;
      const big = 1 + rnd() * 2.5;
      for (let m = 0; m < 3 + rnd() * 4; m++) {
        const g = oct.clone().applyMatrix4(trs(x + (rnd() - 0.5) * 3 * big, f, z + (rnd() - 0.5) * 3 * big,
          (rnd() - 0.5) * 0.9, rnd() * 3, (rnd() - 0.5) * 0.9, big * (0.35 + rnd() * 0.4), big * (1.5 + rnd() * 2.5), big * (0.35 + rnd() * 0.4)));
        (rnd() < 0.6 ? crys : crysB).push(g);
      }
    }
  };
  scatter(CRYSTAL_CAVERN, 34, 0.85);
  scatter(GROTTO, 12, 0.8);
  scatter(POOL_CAVERN, 6, 0.9);
  scene.add(new THREE.Mesh(mergeGeometries(crys), style.material('crystal')));
  scene.add(new THREE.Mesh(mergeGeometries(crysB), style.material('crystalB')));

  // stalactites hanging from the ceilings
  const stal: THREE.BufferGeometry[] = [];
  const cone = prep(new THREE.ConeGeometry(1, 1, 5, 1, true), true);
  for (const room of rooms) {
    for (let n = 0; n < 40; n++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.85;
      const x = room.c[0] + Math.cos(a) * room.r[0] * r, z = room.c[2] + Math.sin(a) * room.r[2] * r;
      const c = ceilingAbove(x, room.c[1], z);
      if (c === null) continue;
      const len = 3 + rnd() * 9, w = 0.8 + rnd() * 1.6;
      stal.push(cone.clone().applyMatrix4(trs(x, c - len / 2 + 0.6, z, Math.PI, rnd() * 3, 0, w, len, w)));
    }
  }
  scene.add(new THREE.Mesh(mergeGeometries(stal), style.material('rock', { shade: 1.2, side: THREE.DoubleSide })));

  // the glowing pool
  const pf = floorBelow(POOL_CAVERN.c[0], POOL_CAVERN.c[1], POOL_CAVERN.c[2]) ?? POOL_CAVERN.floor;
  const pool = new THREE.Mesh(prep(new THREE.CircleGeometry(20, 9).rotateX(-Math.PI / 2), true), style.material('pool'));
  pool.position.set(POOL_CAVERN.c[0], pf + 0.6, POOL_CAVERN.c[2]);
  scene.add(pool);

  // glow worms dotting the pool cavern ceiling
  const worms: number[] = [];
  for (let n = 0; n < 600; n++) {
    const room = rnd() < 0.75 ? POOL_CAVERN : CRYSTAL_CAVERN;
    const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.95;
    const x = room.c[0] + Math.cos(a) * room.r[0] * r, z = room.c[2] + Math.sin(a) * room.r[2] * r;
    const c = ceilingAbove(x, room.c[1], z);
    if (c !== null) worms.push(x, c - 0.4, z);
  }
  const wormGeo = new THREE.BufferGeometry();
  wormGeo.setAttribute('position', new THREE.Float32BufferAttribute(worms, 3));
  const wormMat = new THREE.PointsMaterial({ size: 2.2, sizeAttenuation: false, color: 0x54fff0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const glowWorms = new THREE.Points(wormGeo, wormMat);
  scene.add(glowWorms);

  // rising sparks in each shaft: they mark the lift and shine out of the sinkholes
  const SP = 500;
  const sparks = new Float32Array(SP * 3 * SHAFTS.length);
  const seeds: number[] = [];
  for (let s = 0; s < SHAFTS.length; s++) for (let n = 0; n < SP; n++) {
    const a = rnd() * Math.PI * 2, r = rnd() * 8;
    seeds.push(s, Math.cos(a) * r, Math.sin(a) * r, rnd());
  }
  const liftGeo = new THREE.BufferGeometry();
  liftGeo.setAttribute('position', new THREE.BufferAttribute(sparks, 3));
  const liftMat = new THREE.PointsMaterial({ size: 3, sizeAttenuation: false, color: 0xffffff, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false });
  const lift = new THREE.Points(liftGeo, liftMat);
  lift.frustumCulled = false;
  scene.add(lift);

  const recolor = () => {
    wormMat.color.copy(style.tint(0x54fff0));
    liftMat.color.copy(style.tint(0x5dfcff));
  };
  recolor();
  style.onChange(recolor);

  return {
    glowWorms,
    lift,
    update(t: number) {
      for (let n = 0; n < seeds.length / 4; n++) {
        const s = SHAFTS[seeds[n * 4]];
        const h = s.top + 25 - s.bottom;
        const u = (seeds[n * 4 + 3] + t * 0.06) % 1;
        sparks[n * 3] = s.x + seeds[n * 4 + 1] * (1 + u * 0.6);
        sparks[n * 3 + 1] = s.bottom + u * h;
        sparks[n * 3 + 2] = s.z + seeds[n * 4 + 2] * (1 + u * 0.6);
      }
      liftGeo.attributes.position.needsUpdate = true;
    },
  };
}

/** True when (x, y, z) is in a cave's air and below the ground. */
export function inCave(x: number, y: number, z: number): boolean {
  return y < heightAt(x, z) + 2 && caveSdf(x, y, z) < 0;
}

/** Spots on cavern floors for crawlers, and air for bats. */
export function caveSpots(): { floors: THREE.Vector3[]; air: THREE.Vector3[] } {
  const rnd = mulberry32(5);
  const floors: THREE.Vector3[] = [], air: THREE.Vector3[] = [];
  for (const room of rooms) {
    for (let n = 0; n < 8; n++) {
      const a = rnd() * Math.PI * 2, r = Math.sqrt(rnd()) * 0.7;
      const x = room.c[0] + Math.cos(a) * room.r[0] * r, z = room.c[2] + Math.sin(a) * room.r[2] * r;
      const f = floorBelow(x, room.c[1], z);
      if (f !== null) floors.push(new THREE.Vector3(x, f, z));
    }
    air.push(new THREE.Vector3(...room.c));
  }
  return { floors, air };
}
