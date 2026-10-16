/**
 * The city on the central plateau: an 8 x 8 grid of 80 m blocks between 20 m
 * streets whose edges sit on the ground's own grid lines. Towers rise taller
 * towards the centre, as boxes with setbacks, polygonal prisms, spires and
 * antennas, with procedural lit windows. Street dashes and lamps glow; one
 * block is a plaza with a floating monument; a few are parks.
 */
import * as THREE from 'three';
import { mergeGeometries } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { prep, trs } from './glow.js';
import { style, type Category } from './style.js';
import { mulberry32 } from './noise.js';

export interface Box { minX: number; maxX: number; minZ: number; maxZ: number; top: number }
export interface Block { x0: number; z0: number; x1: number; z1: number; kind: 'build' | 'park' | 'plaza' }

export const BLOCK = 80, STREET = 20, PERIOD = 100, BLOCKS = 8;
export const colliders: Box[] = [];
export const blocks: Block[] = [];
/** Street centre coordinates (both axes). */
export const streetLines: number[] = [];
for (let s = -4; s <= 4; s++) streetLines.push(s * PERIOD + STREET / 2);

const boxG = prep(new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0));
const prism6 = prep(new THREE.CylinderGeometry(0.5, 0.5, 1, 6, 1).translate(0, 0.5, 0));
const prism8 = prep(new THREE.CylinderGeometry(0.5, 0.5, 1, 8, 1).translate(0, 0.5, 0));
const pyr = prep(new THREE.ConeGeometry(0.7071, 1, 4, 1).rotateY(Math.PI / 4).translate(0, 0.5, 0));
const spire = prep(new THREE.ConeGeometry(0.5, 1, 6, 1).translate(0, 0.5, 0));

export interface City { monument: THREE.Object3D; update(t: number): void }

export function buildCity(scene: THREE.Scene): City {
  const rnd = mulberry32(1234);
  const parts: Partial<Record<Category, THREE.BufferGeometry[]>> = {};
  const put = (cat: Category, g: THREE.BufferGeometry, m: THREE.Matrix4) => (parts[cat] ??= []).push(g.clone().applyMatrix4(m));

  const building = (cx: number, cz: number, w: number, d: number, h: number) => {
    const cat: Category = (['towerA', 'towerA', 'towerB', 'towerC'] as const)[Math.floor(rnd() * 4)];
    const shape = rnd();
    let top = h;
    if (shape < 0.5) {
      // a box, maybe with one or two setbacks
      let y = 0, ww = w, dd = d, hh = h * (rnd() < 0.5 ? 1 : 0.6);
      const tiers = h > 50 && rnd() < 0.6 ? 1 + Math.floor(rnd() * 2) : 0;
      for (let t = 0; t <= tiers; t++) {
        const seg = t === tiers ? h - y : hh;
        put(cat, boxG, trs(cx, y, cz, 0, 0, 0, ww, seg, dd));
        y += seg;
        ww *= 0.72; dd *= 0.72; hh = (h - y) * 0.6;
      }
      top = h;
    } else if (shape < 0.72) {
      const s = Math.min(w, d);
      put(cat, rnd() < 0.5 ? prism6 : prism8, trs(cx, 0, cz, 0, rnd() * Math.PI, 0, s, h, s));
    } else if (shape < 0.88) {
      put(cat, boxG, trs(cx, 0, cz, 0, 0, 0, w, h, d));
      const ph = Math.min(w, d) * 0.6;
      put(cat, pyr, trs(cx, h, cz, 0, 0, 0, w, ph, d));
      top = h + ph;
    } else {
      const s = Math.min(w, d);
      put(cat, prism6, trs(cx, 0, cz, 0, 0, 0, s, h, s));
      put(cat, spire, trs(cx, h, cz, 0, 0, 0, s * 0.8, h * 0.45, s * 0.8));
      top = h * 1.45;
    }
    if (h > 70 && rnd() < 0.5) {
      const ah = 10 + rnd() * 25;
      put('pole', boxG, trs(cx, top, cz, 0, 0, 0, 0.6, ah, 0.6));
      put('taillight', boxG, trs(cx, top + ah, cz, 0, 0, 0, 1.4, 1.4, 1.4));
    }
    colliders.push({ minX: cx - w / 2, maxX: cx + w / 2, minZ: cz - d / 2, maxZ: cz + d / 2, top: h });
  };

  let monument: THREE.Object3D = new THREE.Object3D();
  for (let bj = -4; bj < 4; bj++) for (let bi = -4; bi < 4; bi++) {
    const x0 = bi * PERIOD + STREET, z0 = bj * PERIOD + STREET, x1 = x0 + BLOCK, z1 = z0 + BLOCK;
    const cx = (x0 + x1) / 2, cz = (z0 + z1) / 2;
    const r = Math.hypot(cx, cz);
    const base = 14 + 170 * Math.exp(-((r / 230) ** 2));
    let kind: Block['kind'] = 'build';
    if (bi === -1 && bj === -1) kind = 'plaza';
    else if (rnd() < 0.1) kind = 'park';
    blocks.push({ x0, z0, x1, z1, kind });
    if (kind === 'plaza') {
      // a stepped pyramid with a slowly turning crystal above it
      for (let s = 0; s < 4; s++) put('monument', boxG, trs(cx, s * 2, cz, 0, 0, 0, 34 - s * 8, 2, 34 - s * 8));
      put('monument', pyr, trs(cx, 8, cz, 0, 0, 0, 10, 14, 10));
      colliders.push({ minX: cx - 17, maxX: cx + 17, minZ: cz - 17, maxZ: cz + 17, top: 2 });
      const crystal = new THREE.Mesh(prep(new THREE.OctahedronGeometry(6, 0), true), style.material('monument', { shade: 1.4 }));
      crystal.position.set(cx, 36, cz);
      crystal.scale.set(1, 1.8, 1);
      scene.add(crystal);
      monument = crystal;
      continue;
    }
    if (kind === 'park') continue;
    const layout = rnd();
    if (layout < 0.3) {
      building(cx, cz, 50 + rnd() * 16, 50 + rnd() * 16, base * (0.6 + rnd() * 0.8));
    } else if (layout < 0.75) {
      for (const ox of [-20, 20]) for (const oz of [-20, 20]) {
        if (rnd() < 0.12) continue;
        building(cx + ox, cz + oz, 24 + rnd() * 9, 24 + rnd() * 9, base * (0.3 + rnd() * 0.7));
      }
    } else {
      for (const ox of [-30, -10, 10, 30]) building(cx + ox, cz, 15 + rnd() * 3, 50 + rnd() * 20, base * (0.25 + rnd() * 0.5));
    }
  }

  // street dashes and lamps
  const lo = -4 * PERIOD, hi = 4 * PERIOD + STREET;
  for (const s of streetLines) {
    for (let u = lo; u < hi; u += 10) {
      const m = ((u - lo) % PERIOD + PERIOD) % PERIOD;
      if (m < STREET + 2) continue; // no dashes across intersections
      put('street', boxG, trs(u, 0.02, s, 0, 0, 0, 4, 0.06, 0.35));
      put('street', boxG, trs(s, 0.02, u, 0, 0, 0, 0.35, 0.06, 4));
    }
    for (let u = lo + STREET + 10; u < hi; u += 40) {
      if (((u - lo) % PERIOD + PERIOD) % PERIOD < STREET + 1) continue;
      for (const side of [-1, 1]) {
        const off = side * (STREET / 2 - 0.8);
        put('pole', boxG, trs(u, 0, s + off, 0, 0, 0, 0.25, 7, 0.25));
        put('lamp', boxG, trs(u, 7, s + off - side * 0.6, 0, 0, 0, 0.5, 0.25, 1.6));
        put('pole', boxG, trs(s + off, 0, u, 0, 0, 0, 0.25, 7, 0.25));
        put('lamp', boxG, trs(s + off - side * 0.6, 7, u, 0, 0, 0, 1.6, 0.25, 0.5));
      }
    }
  }

  for (const [cat, list] of Object.entries(parts) as [Category, THREE.BufferGeometry[]][]) {
    scene.add(new THREE.Mesh(mergeGeometries(list), style.material(cat)));
  }

  return {
    monument,
    update(t: number) {
      monument.rotation.y = t * 0.4;
      monument.position.y = 36 + Math.sin(t * 0.8) * 2;
    },
  };
}
