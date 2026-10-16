/** Seeded randomness and value noise shared by every generator. */

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function hash2(x: number, y: number): number {
  let h = Math.imul(x | 0, 374761393) + Math.imul(y | 0, 668265263);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

export function hash3(x: number, y: number, z: number): number {
  return hash2(x + Math.imul(z | 0, 1442695041), y - Math.imul(z | 0, 2654435761));
}

const fade = (t: number) => t * t * (3 - 2 * t);

export function noise2(x: number, y: number): number {
  const ix = Math.floor(x), iy = Math.floor(y);
  const fx = fade(x - ix), fy = fade(y - iy);
  const a = hash2(ix, iy), b = hash2(ix + 1, iy), c = hash2(ix, iy + 1), d = hash2(ix + 1, iy + 1);
  return a + (b - a) * fx + (c - a) * fy + (a - b - c + d) * fx * fy;
}

export function noise3(x: number, y: number, z: number): number {
  const ix = Math.floor(x), iy = Math.floor(y), iz = Math.floor(z);
  const fx = fade(x - ix), fy = fade(y - iy), fz = fade(z - iz);
  const l = (a: number, b: number, t: number) => a + (b - a) * t;
  const p = (dx: number, dy: number, dz: number) => hash3(ix + dx, iy + dy, iz + dz);
  return l(
    l(l(p(0, 0, 0), p(1, 0, 0), fx), l(p(0, 1, 0), p(1, 1, 0), fx), fy),
    l(l(p(0, 0, 1), p(1, 0, 1), fx), l(p(0, 1, 1), p(1, 1, 1), fx), fy),
    fz,
  );
}

export function fbm2(x: number, y: number, octaves = 4): number {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < octaves; i++) {
    s += a * noise2(x * f + i * 17.3, y * f - i * 9.1);
    n += a;
    a *= 0.5;
    f *= 2.03;
  }
  return s / n;
}

export function ridged2(x: number, y: number, octaves = 4): number {
  let s = 0, a = 0.5, f = 1, n = 0;
  for (let i = 0; i < octaves; i++) {
    const v = 1 - Math.abs(noise2(x * f + i * 31.7, y * f + i * 5.3) * 2 - 1);
    s += a * v * v;
    n += a;
    a *= 0.5;
    f *= 2.1;
  }
  return s / n;
}

export const smoothstep = (a: number, b: number, x: number) => {
  const t = Math.min(1, Math.max(0, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
};

export const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
