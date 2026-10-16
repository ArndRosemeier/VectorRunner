/**
 * The two looks. "Colored" gives every kind of thing its own neon hue;
 * "Uni" paints the whole world in one hue (blue by default), keeping each
 * thing's brightness so the scene still reads. Every glow material is made
 * here, under a category, so one call can recolour the world.
 */
import * as THREE from 'three';
import { GlowMaterial, type GlowParams } from './glow.js';

export interface CategoryLook {
  line: number;
  fill: number;
  windows?: number;
  boost?: number;
  emissive?: boolean;
}

export const CATEGORIES = {
  terrain: { line: 0x3d6bff, fill: 0x03061a, boost: 1.3 },
  mountain: { line: 0x7a4dff, fill: 0x05031a, boost: 1.3 },
  road: { line: 0xff4fd8, fill: 0x010108, boost: 0.0 },
  roadLine: { line: 0xffffff, fill: 0xffd6f4, emissive: true, boost: 0.6 },
  roadEdge: { line: 0xff4fd8, fill: 0xff4fd8, emissive: true, boost: 0.6 },
  street: { line: 0x19e3ff, fill: 0x9ff6ff, emissive: true, boost: 0.6 },
  towerA: { line: 0x19e3ff, fill: 0x020b18, windows: 0x3fd8ff, boost: 1.7 },
  towerB: { line: 0xff2a8a, fill: 0x14020c, windows: 0xff7ab8, boost: 1.7 },
  towerC: { line: 0xffb02e, fill: 0x120802, windows: 0xffd27a, boost: 1.6 },
  lamp: { line: 0xfff1b8, fill: 0xffe08a, emissive: true, boost: 1.0 },
  pole: { line: 0x8aa0ff, fill: 0x05060f, boost: 1.0 },
  monument: { line: 0xffffff, fill: 0x1b0b33, boost: 2.2 },
  pine: { line: 0x2bff88, fill: 0x01110a, boost: 1.4 },
  leafy: { line: 0x9dff3a, fill: 0x061200, boost: 1.4 },
  palm: { line: 0x22f5d0, fill: 0x01100d, boost: 1.6 },
  trunk: { line: 0xc77dff, fill: 0x0a0414, boost: 1.2 },
  rock: { line: 0xa36bff, fill: 0x07031a, boost: 1.2 },
  cave: { line: 0xb04dff, fill: 0x08021a, boost: 1.0 },
  crystal: { line: 0xb8fff4, fill: 0x00594c, emissive: true, boost: 1.1 },
  crystalB: { line: 0xffc4f2, fill: 0x5a0a48, emissive: true, boost: 1.1 },
  pool: { line: 0x54fff0, fill: 0x00505a, emissive: true, boost: 1.2 },
  sun: { line: 0xfff2a0, fill: 0xff6a2a, emissive: true, boost: 1.6 },
  sunRing: { line: 0xff3f9e, fill: 0x2a0018, boost: 2.0 },
  person: { line: 0xffd23f, fill: 0x120c00, boost: 1.8 },
  personB: { line: 0x5dfcff, fill: 0x001214, boost: 1.8 },
  deer: { line: 0xff9a3c, fill: 0x140800, boost: 1.8 },
  bird: { line: 0xbfe9ff, fill: 0x020812, boost: 2.0 },
  bat: { line: 0xff3355, fill: 0x140006, boost: 2.0 },
  crawler: { line: 0x7dff3a, fill: 0x061400, boost: 2.0 },
  car: { line: 0xff2a8a, fill: 0x0c0210, boost: 1.8 },
  carB: { line: 0x19e3ff, fill: 0x000c12, boost: 1.8 },
  headlight: { line: 0xffffff, fill: 0xfff6d8, emissive: true, boost: 1.0 },
  taillight: { line: 0xff2a2a, fill: 0xff2a3a, emissive: true, boost: 1.0 },
  bike: { line: 0x19e3ff, fill: 0x02060c, boost: 1.8 },
} satisfies Record<string, CategoryLook>;

export type Category = keyof typeof CATEGORIES;

export type StyleMode = 'uni' | 'colored';

export const UNI_PRESETS: { name: string; hex: string }[] = [
  { name: 'Blue', hex: '#3d7bff' },
  { name: 'Cyan', hex: '#19e3ff' },
  { name: 'Magenta', hex: '#ff2a8a' },
  { name: 'Green', hex: '#2bff88' },
  { name: 'Amber', hex: '#ffb02e' },
  { name: 'Red', hex: '#ff3344' },
  { name: 'White', hex: '#e8ecff' },
];

const lum = (c: THREE.Color) => 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;

interface Entry { mat: GlowMaterial; cat: Category; shade: number }

export interface SkyLook { top: THREE.Color; horizon: THREE.Color; glow: THREE.Color; stars: THREE.Color; fog: THREE.Color }

class StyleManager {
  mode: StyleMode = 'colored';
  uni = new THREE.Color(UNI_PRESETS[0].hex);
  private entries: Entry[] = [];
  private listeners: (() => void)[] = [];

  material(cat: Category, extra: Partial<GlowParams> & { shade?: number } = {}): GlowMaterial {
    const look: CategoryLook = CATEGORIES[cat];
    const m = new GlowMaterial({
      line: new THREE.Color(look.line),
      fill: new THREE.Color(look.fill),
      windows: look.windows !== undefined ? new THREE.Color(look.windows) : undefined,
      boost: look.boost,
      emissive: look.emissive,
      ...extra,
    });
    this.entries.push({ mat: m, cat, shade: extra.shade ?? 1 });
    this.paint(this.entries[this.entries.length - 1]);
    return m;
  }

  onChange(f: () => void) { this.listeners.push(f); }

  set(mode: StyleMode, uni?: THREE.ColorRepresentation) {
    this.mode = mode;
    if (uni !== undefined) this.uni.set(uni);
    for (const e of this.entries) this.paint(e);
    for (const f of this.listeners) f();
  }

  /** The colour a category shows in the current mode. */
  tint(hex: number, fillLike = false): THREE.Color {
    const c = new THREE.Color(hex);
    if (this.mode === 'colored') return c;
    const u = this.uni.clone();
    if (fillLike) return u.multiplyScalar(Math.min(1, lum(c) / Math.max(lum(u), 0.05)) * 0.9 + 0.02);
    // keep each category's brightness, lifted a little so dark hues stay visible
    const l = Math.max(lum(c), 0.25) / Math.max(lum(u), 0.05);
    return u.multiplyScalar(Math.min(l, 2.2));
  }

  sky(): SkyLook {
    if (this.mode === 'colored') {
      return {
        top: new THREE.Color(0x020015),
        horizon: new THREE.Color(0x5a1460),
        glow: new THREE.Color(0xff5a3c),
        stars: new THREE.Color(0xd8e6ff),
        fog: new THREE.Color(0x1a0826),
      };
    }
    const u = this.uni;
    return {
      top: u.clone().multiplyScalar(0.02),
      horizon: u.clone().multiplyScalar(0.28),
      glow: u.clone().lerp(new THREE.Color(1, 1, 1), 0.35).multiplyScalar(0.9),
      stars: u.clone().lerp(new THREE.Color(1, 1, 1), 0.6),
      fog: u.clone().multiplyScalar(0.09),
    };
  }

  private paint(e: Entry) {
    const look: CategoryLook = CATEGORIES[e.cat];
    e.mat.line.copy(this.tint(look.line)).multiplyScalar(e.shade);
    if (look.emissive) e.mat.fill.copy(this.tint(look.fill, true)).multiplyScalar(e.shade);
    else e.mat.fill.copy(this.mode === 'colored' ? new THREE.Color(look.fill) : this.uni.clone().multiplyScalar(0.035));
    if (look.windows !== undefined) e.mat.windowColor.copy(this.tint(look.windows));
  }
}

export const style = new StyleManager();
