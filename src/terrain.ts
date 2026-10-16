/**
 * The ground: one faceted heightfield 4 km across. A flat city plateau in the
 * middle, rolling hills, a lake basin to the west, mountains towards the edge
 * and a racing road that loops out east through a valley between them. Two
 * sinkholes in the southern hills open into the caves. Heights live on a
 * 20 m grid and every query interpolates the same triangles the mesh draws.
 */
import * as THREE from 'three';
import { fbm2, ridged2, smoothstep, lerp } from './noise.js';
import { soup } from './glow.js';
import { style } from './style.js';

export const HALF = 2000;
export const CELL = 20;
export const N = (HALF * 2) / CELL;
export const WATER_Y = -3;
export const LAKE = { x: -850, z: -350, r: 240 };
export const CITY_HALF = 400;
/** Cave entrances sit exactly on grid vertices so their holes are clean hexagons. */
export const ENTRANCES = [
  { x: -620, z: 640, name: 'Sinkhole' },
  { x: -120, z: 1060, name: 'Far sinkhole' },
];

const heights = new Float32Array((N + 1) * (N + 1));
const vi = (i: number, j: number) => j * (N + 1) + i;

// ---- the road: a closed loop east of the city -------------------------------------------

export interface RoadPoint { x: number; y: number; z: number; s: number }
export const road: RoadPoint[] = [];
export let roadLength = 0;

function loopXZ(t: number): [number, number] {
  const cx = 1020, cz = 10, rx = 610, rz = 820;
  return [cx - rx * Math.cos(t) + 35 * Math.sin(3 * t), cz + rz * Math.sin(t) + 45 * Math.sin(2 * t) * Math.sin(t)];
}

function baseHeight(x: number, z: number): number {
  const r = Math.hypot(x, z);
  let h = (fbm2(x * 0.0025, z * 0.0025, 4) - 0.4) * 95;
  h += (fbm2(x * 0.013, z * 0.013, 3) - 0.5) * 9;
  const m = ridged2(x * 0.0016 + 3.1, z * 0.0016 - 7.3, 5);
  h += smoothstep(820, 1750, r) * (40 + 420 * m * m);
  // the city plateau
  const c = Math.max(Math.abs(x), Math.abs(z));
  h = lerp(0, h, smoothstep(CITY_HALF + 40, CITY_HALF + 260, c));
  // the lake basin
  const dl = Math.hypot(x - LAKE.x, z - LAKE.z);
  h = lerp(-16, h, smoothstep(LAKE.r * 0.55, LAKE.r * 1.5, dl));
  return h;
}

// segment buckets for fast nearest-road queries
const BUCKET = 60;
const buckets = new Map<number, number[]>();
const bkey = (bx: number, bz: number) => (bx + 1000) * 4096 + (bz + 1000);

function buildRoad() {
  const samples = 1400;
  const raw: { x: number; z: number; y: number }[] = [];
  for (let k = 0; k < samples; k++) {
    const [x, z] = loopXZ((k / samples) * Math.PI * 2);
    raw.push({ x, z, y: baseHeight(x, z) });
  }
  // smooth the grade with a wide circular window, then pin the city junction to street level
  const win = 70;
  for (let k = 0; k < samples; k++) {
    let s = 0;
    for (let o = -win; o <= win; o++) s += raw[(k + o + samples) % samples].y;
    const y = Math.max(s / (win * 2 + 1), 0.5);
    const fromJunction = Math.min(k, samples - k) / samples;
    road.push({ x: raw[k].x, z: raw[k].z, y: lerp(0, y, smoothstep(0.02, 0.09, fromJunction)), s: 0 });
  }
  let s = 0;
  for (let k = 0; k < samples; k++) {
    road[k].s = s;
    const n = road[(k + 1) % samples];
    s += Math.hypot(n.x - road[k].x, n.z - road[k].z);
  }
  roadLength = s;
  for (let k = 0; k < samples; k++) {
    const a = road[k], b = road[(k + 1) % samples];
    const x0 = Math.floor((Math.min(a.x, b.x) - 200) / BUCKET), x1 = Math.floor((Math.max(a.x, b.x) + 200) / BUCKET);
    const z0 = Math.floor((Math.min(a.z, b.z) - 200) / BUCKET), z1 = Math.floor((Math.max(a.z, b.z) + 200) / BUCKET);
    for (let bx = x0; bx <= x1; bx++) for (let bz = z0; bz <= z1; bz++) {
      const kk = bkey(bx, bz);
      const l = buckets.get(kk);
      if (l) l.push(k); else buckets.set(kk, [k]);
    }
  }
}

/** Distance to the road centre line (capped at 200) and the road's height there. */
export function roadQuery(x: number, z: number): { d: number; y: number; k: number; t: number } {
  const list = buckets.get(bkey(Math.floor(x / BUCKET), Math.floor(z / BUCKET)));
  let best = { d: 200, y: 0, k: -1, t: 0 };
  if (!list) return best;
  for (const k of list) {
    const a = road[k], b = road[(k + 1) % road.length];
    const dx = b.x - a.x, dz = b.z - a.z;
    const t = Math.max(0, Math.min(1, ((x - a.x) * dx + (z - a.z) * dz) / (dx * dx + dz * dz)));
    const d = Math.hypot(x - a.x - dx * t, z - a.z - dz * t);
    if (d < best.d) best = { d, y: lerp(a.y, b.y, t), k, t };
  }
  return best;
}

function finalHeight(x: number, z: number): number {
  let h = baseHeight(x, z);
  const q = roadQuery(x, z);
  if (q.k >= 0) h = lerp(q.y - 0.3, h, smoothstep(16, 120, q.d));
  for (const e of ENTRANCES) {
    const d = Math.hypot(x - e.x, z - e.z);
    h -= 14 * Math.exp(-((d / 55) ** 2));
  }
  return h;
}

buildRoad();
for (let j = 0; j <= N; j++) for (let i = 0; i <= N; i++) heights[vi(i, j)] = finalHeight(-HALF + i * CELL, -HALF + j * CELL);
for (const e of ENTRANCES) (e as { y?: number }).y = heights[vi((e.x + HALF) / CELL, (e.z + HALF) / CELL)];
export const entranceY = (k: number) => (ENTRANCES[k] as { y?: number }).y!;

// ---- holes: the six triangles around each entrance vertex --------------------------------

const holes = new Set<number>();
// triangle id: cell * 2 + (upper ? 1 : 0); "upper" is the fx > fz half
for (const e of ENTRANCES) {
  const i = (e.x + HALF) / CELL, j = (e.z + HALF) / CELL;
  const c = (ci: number, cj: number) => (cj * N + ci) * 2;
  holes.add(c(i, j)); holes.add(c(i, j) + 1);
  holes.add(c(i - 1, j - 1)); holes.add(c(i - 1, j - 1) + 1);
  holes.add(c(i - 1, j) + 1);
  holes.add(c(i, j - 1));
}

function locate(x: number, z: number) {
  const gx = Math.min(Math.max((x + HALF) / CELL, 0), N - 1e-6);
  const gz = Math.min(Math.max((z + HALF) / CELL, 0), N - 1e-6);
  const i = Math.floor(gx), j = Math.floor(gz);
  return { i, j, fx: gx - i, fz: gz - j };
}

/** Ground height at (x, z), exactly on the drawn facets. */
export function heightAt(x: number, z: number): number {
  const { i, j, fx, fz } = locate(x, z);
  const h00 = heights[vi(i, j)], h11 = heights[vi(i + 1, j + 1)];
  if (fx > fz) {
    const h10 = heights[vi(i + 1, j)];
    return h00 + (h10 - h00) * fx + (h11 - h10) * fz;
  }
  const h01 = heights[vi(i, j + 1)];
  return h00 + (h11 - h01) * fx + (h01 - h00) * fz;
}

/** False over a sinkhole, where there is no ground to stand on. */
export function groundSolid(x: number, z: number): boolean {
  const { i, j, fx, fz } = locate(x, z);
  return !holes.has((j * N + i) * 2 + (fx > fz ? 1 : 0));
}

/** Slope steepness (0 flat .. 1 vertical-ish) used when scattering things. */
export function slopeAt(x: number, z: number): number {
  const e = 4;
  const dx = heightAt(x + e, z) - heightAt(x - e, z);
  const dz = heightAt(x, z + e) - heightAt(x, z - e);
  return Math.min(1, Math.hypot(dx, dz) / (2 * e));
}

// ---- meshes -------------------------------------------------------------------------------

export function buildTerrain(scene: THREE.Scene) {
  const low: number[] = [], high: number[] = [];
  const P = (i: number, j: number) => [-HALF + i * CELL, heights[vi(i, j)], -HALF + j * CELL];
  for (let j = 0; j < N; j++) for (let i = 0; i < N; i++) {
    const id = (j * N + i) * 2;
    const a = P(i, j), b = P(i + 1, j), c = P(i + 1, j + 1), d = P(i, j + 1);
    // winding is counter-clockwise seen from above
    if (!holes.has(id + 1)) (((a[1] + b[1] + c[1]) / 3 > 95) ? high : low).push(...a, ...c, ...b);
    if (!holes.has(id)) (((a[1] + c[1] + d[1]) / 3 > 95) ? high : low).push(...a, ...d, ...c);
  }
  scene.add(new THREE.Mesh(soup(low), style.material('terrain', { side: THREE.DoubleSide })));
  scene.add(new THREE.Mesh(soup(high), style.material('mountain', { side: THREE.DoubleSide })));

  // a coarse ring of far mountains beyond the playable square, so the horizon is never empty
  const far: number[] = [];
  const FN = 64, FH = 7000, FC = (FH * 2) / FN;
  const fh = (x: number, z: number) => {
    const c = Math.max(Math.abs(x), Math.abs(z));
    if (c < HALF - 60) return -500;
    const m = ridged2(x * 0.0008 + 11, z * 0.0008 - 4, 4);
    return 150 + 900 * m * m * smoothstep(HALF, HALF + 1500, c) + 120 * smoothstep(HALF - 60, HALF + 300, c);
  };
  for (let j = 0; j < FN; j++) for (let i = 0; i < FN; i++) {
    const x0 = -FH + i * FC, z0 = -FH + j * FC, x1 = x0 + FC, z1 = z0 + FC;
    if (Math.max(Math.abs(x0 + FC / 2), Math.abs(z0 + FC / 2)) < HALF - FC) continue;
    const a = [x0, fh(x0, z0), z0], b = [x1, fh(x1, z0), z0], c = [x1, fh(x1, z1), z1], d = [x0, fh(x0, z1), z1];
    far.push(...a, ...c, ...b, ...a, ...d, ...c);
  }
  scene.add(new THREE.Mesh(soup(far), style.material('mountain', { shade: 0.8, side: THREE.DoubleSide })));
}
