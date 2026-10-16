/**
 * Everything that grows or lies on the land, plus the racing road itself:
 * the road ribbon with streaking lane dashes and solid edge lines (straight
 * from the dusk ride), palms along it and around the lake, a pine forest in
 * the north, leafy trees and rocks across the hills, and the mirror lake.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { Reflector } from 'three/examples/jsm/objects/Reflector.js';
import { prep, soup, trs } from './glow.js';
import { style } from './style.js';
import { mulberry32 } from './noise.js';
import { road, roadLength, heightAt, slopeAt, roadQuery, LAKE, WATER_Y, CITY_HALF, ENTRANCES, HALF } from './terrain.js';

/** Position, unit tangent and height of the road at arc length s (wraps). */
export function roadAt(s: number): { x: number; y: number; z: number; tx: number; tz: number } {
  s = ((s % roadLength) + roadLength) % roadLength;
  let lo = 0, hi = road.length - 1;
  while (lo < hi) { const m = (lo + hi + 1) >> 1; if (road[m].s <= s) lo = m; else hi = m - 1; }
  const a = road[lo], b = road[(lo + 1) % road.length];
  const len = Math.hypot(b.x - a.x, b.z - a.z);
  const t = (s - a.s) / len;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, z: a.z + (b.z - a.z) * t, tx: (b.x - a.x) / len, tz: (b.z - a.z) / len };
}

function palmGeometry(rnd: () => number): { trunk: number[]; fronds: number[] } {
  const trunk: number[] = [], fronds: number[] = [];
  const hgt = 6 + rnd() * 4, lean = (rnd() - 0.5) * 3, sides = 5, rings = 6;
  const ring = (u: number) => {
    const r = 0.38 - 0.18 * u;
    const cx = lean * u * u, cy = hgt * u;
    const pts: number[][] = [];
    for (let k = 0; k < sides; k++) { const a = (k / sides) * Math.PI * 2; pts.push([cx + Math.cos(a) * r, cy, Math.sin(a) * r]); }
    return pts;
  };
  for (let i = 0; i < rings; i++) {
    const p = ring(i / rings), q = ring((i + 1) / rings);
    for (let k = 0; k < sides; k++) {
      const k2 = (k + 1) % sides;
      trunk.push(...p[k], ...q[k], ...q[k2], ...p[k], ...q[k2], ...p[k2]);
    }
  }
  const top = [lean, hgt, 0];
  const n = 8;
  for (let f = 0; f < n; f++) {
    const a = (f / n) * Math.PI * 2 + rnd() * 0.4;
    const el = 0.35 + rnd() * 0.3, L = 3.4 + rnd() * 1.2;
    const dir = [Math.cos(a) * Math.cos(el), Math.sin(el), Math.sin(a) * Math.cos(el)];
    const side = [-Math.sin(a), 0, Math.cos(a)];
    let prev = top;
    for (let j = 1; j <= 5; j++) {
      const s = j / 5;
      const next = [top[0] + L * dir[0] * s, top[1] + L * (dir[1] * s - 0.75 * s * s), top[2] + L * dir[2] * s];
      const w = 0.9 * Math.sin(Math.PI * Math.min(1, s + 0.1));
      for (const sg of [-1, 1]) {
        const tip = [(prev[0] + next[0]) / 2 + side[0] * w * sg, (prev[1] + next[1]) / 2 - 0.25, (prev[2] + next[2]) / 2 + side[2] * w * sg];
        fronds.push(...prev, ...next, ...tip);
      }
      prev = next;
    }
  }
  return { trunk, fronds };
}

function transformSoup(src: number[], m: THREE.Matrix4, out: number[]) {
  const v = new THREE.Vector3();
  for (let i = 0; i < src.length; i += 3) { v.set(src[i], src[i + 1], src[i + 2]).applyMatrix4(m); out.push(v.x, v.y, v.z); }
}

export interface Nature { water: Reflector }

/** Round obstacles (trunks, rocks) bucketed on a 20 m grid for walking collision. */
export interface Post { x: number; z: number; r: number; top: number }
const posts = new Map<number, Post[]>();
const pkey = (x: number, z: number) => (Math.floor(x / 20) + 500) * 2048 + (Math.floor(z / 20) + 500);
function addPost(p: Post) {
  const k = pkey(p.x, p.z);
  const l = posts.get(k);
  if (l) l.push(p); else posts.set(k, [p]);
}
export function postsNear(x: number, z: number): Post[] {
  const out: Post[] = [];
  for (let dx = -20; dx <= 20; dx += 20) for (let dz = -20; dz <= 20; dz += 20) {
    const l = posts.get(pkey(x + dx, z + dz));
    if (l) out.push(...l);
  }
  return out;
}

export function buildNature(scene: THREE.Scene): Nature {
  const rnd = mulberry32(42);

  // ---- the road -------------------------------------------------------------------------
  const ribbon: number[] = [];
  const dashes: number[] = [], edges: number[] = [];
  const quadAlong = (s0: number, s1: number, off0: number, off1: number, lift: number, out: number[]) => {
    const steps = Math.max(1, Math.ceil((s1 - s0) / 4));
    for (let i = 0; i < steps; i++) {
      const p = roadAt(s0 + ((s1 - s0) * i) / steps), q = roadAt(s0 + ((s1 - s0) * (i + 1)) / steps);
      const P = (r: typeof p, o: number) => [r.x - r.tz * o, r.y + lift, r.z + r.tx * o];
      const a = P(p, off0), b = P(p, off1), c = P(q, off1), d = P(q, off0);
      out.push(...a, ...b, ...c, ...a, ...c, ...d);
    }
  };
  for (let s = 0; s < roadLength; s += 6) quadAlong(s, Math.min(s + 6, roadLength), -6.5, 6.5, 0.12, ribbon);
  for (let s = 0; s < roadLength - 9; s += 9) for (const o of [-1.8, 1.8]) quadAlong(s, s + 3.2, o - 0.12, o + 0.12, 0.16, dashes);
  for (let s = 0; s < roadLength; s += 12) for (const o of [-5.4, 5.4]) quadAlong(s, Math.min(s + 12, roadLength), o - 0.1, o + 0.1, 0.16, edges);
  scene.add(new THREE.Mesh(soup(ribbon), style.material('road', { side: THREE.DoubleSide })));
  scene.add(new THREE.Mesh(soup(dashes), style.material('roadLine', { side: THREE.DoubleSide })));
  scene.add(new THREE.Mesh(soup(edges), style.material('roadEdge', { side: THREE.DoubleSide })));
  // the avenue linking the loop to the city's main street
  const av: number[] = [], avEdge: number[] = [];
  for (let x = 400; x < 412; x += 4) {
    av.push(x, 0.12, 4, x, 0.12, 16, x + 4, 0.12, 16, x, 0.12, 4, x + 4, 0.12, 16, x + 4, 0.12, 4);
  }
  for (const z of [4.6, 15.4]) avEdge.push(400, 0.16, z - 0.1, 400, 0.16, z + 0.1, 412, 0.16, z + 0.1, 400, 0.16, z - 0.1, 412, 0.16, z + 0.1, 412, 0.16, z - 0.1);
  scene.add(new THREE.Mesh(soup(av), style.material('road', { side: THREE.DoubleSide })));
  scene.add(new THREE.Mesh(soup(avEdge), style.material('roadEdge', { side: THREE.DoubleSide })));

  // ---- palms ----------------------------------------------------------------------------
  const trunks: number[] = [], fronds: number[] = [];
  const palmAt = (x: number, z: number, scale = 1) => {
    const g = palmGeometry(rnd);
    const m = trs(x, heightAt(x, z) - 0.2, z, 0, rnd() * Math.PI * 2, 0, scale);
    addPost({ x, z, r: 0.45 * scale, top: heightAt(x, z) + 6 });
    transformSoup(g.trunk, m, trunks);
    transformSoup(g.fronds, m, fronds);
  };
  for (let s = 0; s < roadLength; s += 15) {
    const p = roadAt(s);
    if (Math.hypot(p.x, p.z) < CITY_HALF + 60) continue;
    for (const side of [-1, 1]) {
      if (rnd() < 0.3) continue;
      const o = side * (9 + rnd() * 4);
      palmAt(p.x - p.tz * o, p.z + p.tx * o, 0.9 + rnd() * 0.4);
    }
  }
  for (let i = 0; i < 70; i++) {
    const a = rnd() * Math.PI * 2, r = LAKE.r * (1.08 + rnd() * 0.35);
    const x = LAKE.x + Math.cos(a) * r, z = LAKE.z + Math.sin(a) * r;
    if (heightAt(x, z) > WATER_Y + 0.5) palmAt(x, z, 0.8 + rnd() * 0.5);
  }
  scene.add(new THREE.Mesh(soup(trunks), style.material('trunk', { side: THREE.DoubleSide })));
  scene.add(new THREE.Mesh(soup(fronds), style.material('palm', { side: THREE.DoubleSide })));

  // ---- forest, trees and rocks ----------------------------------------------------------
  const pineCone = prep(new THREE.ConeGeometry(1, 1, 6, 1).translate(0, 0.5, 0));
  const stem = prep(new THREE.CylinderGeometry(0.12, 0.2, 1, 4, 1).translate(0, 0.5, 0));
  const blob = prep(new THREE.IcosahedronGeometry(1, 0), true);
  const rockG = prep(new THREE.DodecahedronGeometry(1, 0), true);
  const pines: THREE.BufferGeometry[] = [], leafy: THREE.BufferGeometry[] = [], stems: THREE.BufferGeometry[] = [], rocks: THREE.BufferGeometry[] = [];
  const clear = (x: number, z: number) => {
    if (Math.max(Math.abs(x), Math.abs(z)) < CITY_HALF + 40) return false;
    if (Math.hypot(x - LAKE.x, z - LAKE.z) < LAKE.r * 1.05) return false;
    if (roadQuery(x, z).d < 14) return false;
    for (const e of ENTRANCES) if (Math.hypot(x - e.x, z - e.z) < 45) return false;
    return true;
  };
  for (let i = 0; i < 5000 && pines.length < 2400; i++) {
    const x = (rnd() * 2 - 1) * 1300, z = -620 - rnd() * 1000;
    if (!clear(x, z)) continue;
    const h = heightAt(x, z);
    if (h > 230 || slopeAt(x, z) > 0.75) continue;
    const s = 0.7 + rnd() * 0.8, H = 9 * s, R = 2.6 * s, yaw = rnd() * 3;
    stems.push(stem.clone().applyMatrix4(trs(x, h - 0.3, z, 0, yaw, 0, s * 2, H * 0.4, s * 2)));
    addPost({ x, z, r: R * 0.85, top: h + H });
    for (let t = 0; t < 3; t++) pines.push(pineCone.clone().applyMatrix4(trs(x, h + H * (0.22 + t * 0.22), z, 0, yaw + t, 0, R * (1 - t * 0.25), H * 0.45, R * (1 - t * 0.25))));
  }
  for (let i = 0; i < 2500 && leafy.length < 500; i++) {
    const a = rnd() * Math.PI * 2, r = 470 + rnd() * 900;
    const x = Math.cos(a) * r, z = Math.sin(a) * r;
    if (z < -600 || !clear(x, z) || slopeAt(x, z) > 0.6 || heightAt(x, z) > 160) continue;
    const h = heightAt(x, z), s = 0.8 + rnd() * 0.9;
    stems.push(stem.clone().applyMatrix4(trs(x, h - 0.3, z, 0, rnd() * 3, 0, s * 2.4, 4 * s, s * 2.4)));
    addPost({ x, z, r: 0.5 * s, top: h + 8 * s });
    leafy.push(blob.clone().applyMatrix4(trs(x, h + 5.2 * s, z, rnd(), rnd() * 3, rnd(), 2.8 * s, 2.3 * s, 2.8 * s)));
  }
  for (let i = 0; i < 700; i++) {
    const x = (rnd() * 2 - 1) * (HALF - 100), z = (rnd() * 2 - 1) * (HALF - 100);
    if (!clear(x, z)) continue;
    const s = 0.6 + rnd() * rnd() * 7;
    const sy = s * (0.5 + rnd() * 0.5);
    rocks.push(rockG.clone().applyMatrix4(trs(x, heightAt(x, z) + s * 0.2, z, rnd() * 3, rnd() * 3, rnd() * 3, s * (0.8 + rnd() * 0.6), sy, s)));
    if (s > 1.5) addPost({ x, z, r: s * 0.8, top: heightAt(x, z) + s * 0.2 + sy * 0.7 });
  }
  scene.add(new THREE.Mesh(mergeGeometries(pines), style.material('pine')));
  scene.add(new THREE.Mesh(mergeGeometries(leafy), style.material('leafy')));
  scene.add(new THREE.Mesh(mergeGeometries(stems), style.material('trunk')));
  scene.add(new THREE.Mesh(mergeGeometries(rocks), style.material('rock')));

  // ---- the mirror lake ------------------------------------------------------------------
  const water = new Reflector(new THREE.CircleGeometry(LAKE.r * 1.3, 14), {
    textureWidth: 1024,
    textureHeight: 1024,
    color: 0x9aa4b8,
    clipBias: 0.002,
  });
  water.rotation.x = -Math.PI / 2;
  water.position.set(LAKE.x, WATER_Y, LAKE.z);
  scene.add(water);
  return { water };
}
