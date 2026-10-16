/**
 * The look of the whole world: every surface is a dark, flat-shaded facet
 * whose polygon edges glow. Geometry is unindexed with a `bary` attribute, so
 * the fragment shader knows how far it is from each triangle edge. Edges that
 * only split a flat face (a box's diagonal) are hidden, so boxes read as
 * boxes; organic shapes (terrain, rocks, caves) keep every triangle edge.
 */
import * as THREE from 'three';
import { mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';

/** Uniforms every glow material shares (fog, time, line width, light). */
export const shared = {
  uFogColor: { value: new THREE.Color(0x10051c) },
  uFogDensity: { value: 0.0009 },
  uTime: { value: 0 },
  uLineWidth: { value: 1.25 },
  uLightDir: { value: new THREE.Vector3(-0.6, 0.35, -0.2).normalize() },
  /** Pixels per world unit at distance 1: viewport height / (2 tan(fov / 2)). */
  uPxScale: { value: 500 },
};

export interface GlowParams {
  line: THREE.Color;
  fill: THREE.Color;
  /** Brightness of the edge lines; above 1 feeds the bloom. */
  boost?: number;
  fog?: boolean;
  /** Procedural lit windows on vertical faces (buildings). */
  windows?: THREE.Color;
  /** Solid glowing surface (lamps, dashes, crystals): fill is drawn at full strength. */
  emissive?: boolean;
  side?: THREE.Side;
}

const vertex = /* glsl */ `
attribute vec4 edge;
varying vec4 vEdge;
varying vec3 vWorld;
varying float vDepth;
void main() {
  float sc = (length(modelMatrix[0].xyz) + length(modelMatrix[1].xyz) + length(modelMatrix[2].xyz)) / 3.0;
  vEdge = edge * sc;
  vec4 p = vec4(position, 1.0);
  #ifdef USE_INSTANCING
  p = instanceMatrix * p;
  #endif
  vec4 w = modelMatrix * p;
  vWorld = w.xyz;
  vec4 mv = viewMatrix * w;
  vDepth = -mv.z;
  gl_Position = projectionMatrix * mv;
}
`;

const fragment = /* glsl */ `
uniform vec3 uLine;
uniform vec3 uFill;
uniform vec3 uWindow;
uniform float uBoost;
uniform float uFog;
uniform float uWindows;
uniform float uEmissive;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uLineWidth;
uniform float uTime;
uniform vec3 uLightDir;
uniform float uPxScale;
varying vec4 vEdge;
varying vec3 vWorld;
varying float vDepth;

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec3 cr = cross(dFdx(vWorld), dFdy(vWorld));
  vec3 n = cr / max(length(cr), 1e-12);
  float diff = 0.35 + 0.65 * abs(dot(n, uLightDir));
  vec3 col = uEmissive > 0.5 ? uFill : uFill * diff;

  // distance to the nearest visible edge, in pixels. The edge attribute carries world-space
  // distances, so no screen-space derivatives are needed (they break on some GPUs).
  float pxs = uPxScale / max(vDepth, 0.05);
  float d = min(min(vEdge.x, vEdge.y), vEdge.z) * pxs;
  float w = uLineWidth;
  float line = 1.0 - smoothstep(w - 0.5, w + 0.9, d);
  float halo = exp(-d / (w * 2.5)) * 0.18;
  // far away the triangles shrink to a few pixels: dim the lines so they don't fill the screen
  float cellPx = vEdge.w * pxs;
  float fade = smoothstep(3.0, 26.0, cellPx);
  col += uLine * uBoost * (line + halo) * mix(0.06, 1.0, fade);

  if (uWindows > 0.5 && abs(n.y) < 0.3) {
    vec2 t = vec2(-n.z, n.x) / max(length(n.xz), 1e-6);
    float along = dot(vWorld.xz, t);
    vec2 g = vec2(along / 3.2, vWorld.y / 3.6);
    vec2 cell = floor(g);
    vec2 f = fract(g);
    float rect = step(0.28, f.x) * step(f.x, 0.72) * step(0.3, f.y) * step(f.y, 0.75) * step(1.5, vWorld.y);
    float lit = step(0.8, hash(cell + floor(n.xz * 3.0) * 13.0));
    float flick = 0.75 + 0.25 * sin(uTime * 0.7 + hash(cell) * 40.0);
    float aa = smoothstep(4.0, 10.0, 3.2 * pxs);
    col += uWindow * rect * lit * flick * aa * 0.45;
  }

  if (uFog > 0.5) {
    float fd = uFogDensity * vDepth;
    col = mix(col, uFogColor, 1.0 - exp(-fd * fd));
  }
  // a NaN here would be smeared over the whole screen by the bloom
  if (any(isnan(col))) col = vec3(0.0);
  gl_FragColor = vec4(clamp(col, 0.0, 6.0), 1.0);
}
`;

export class GlowMaterial extends THREE.ShaderMaterial {
  constructor(p: GlowParams) {
    super({
      vertexShader: vertex,
      fragmentShader: fragment,
      side: p.side ?? THREE.FrontSide,
      uniforms: {
        uLine: { value: p.line.clone() },
        uFill: { value: p.fill.clone() },
        uWindow: { value: (p.windows ?? new THREE.Color(0)).clone() },
        uBoost: { value: p.boost ?? 1.6 },
        uFog: { value: p.fog === false ? 0 : 1 },
        uWindows: { value: p.windows ? 1 : 0 },
        uEmissive: { value: p.emissive ? 1 : 0 },
        ...shared,
      },
    });
  }
  get line(): THREE.Color { return this.uniforms.uLine.value; }
  get fill(): THREE.Color { return this.uniforms.uFill.value; }
  get windowColor(): THREE.Color { return this.uniforms.uWindow.value; }
}

/**
 * Turns any geometry into the unindexed, `bary`-carrying form the glow
 * material needs. With `allEdges` every triangle edge glows; otherwise edges
 * between two coplanar triangles are hidden.
 */
export function prep(src: THREE.BufferGeometry, allEdges = false): THREE.BufferGeometry {
  let g = new THREE.BufferGeometry();
  g.setAttribute('position', src.getAttribute('position'));
  if (src.index) g.setIndex(src.index);
  g = mergeVertices(g, 1e-4);
  const pos = g.getAttribute('position') as THREE.BufferAttribute;
  const idx = g.index!.array;
  const triCount = idx.length / 3;

  const normals: THREE.Vector3[] = [];
  const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
  const edges = new Map<number, number[]>();
  const key = (i: number, j: number) => (i < j ? i * 1048576 + j : j * 1048576 + i);
  for (let t = 0; t < triCount; t++) {
    const i0 = idx[t * 3], i1 = idx[t * 3 + 1], i2 = idx[t * 3 + 2];
    a.fromBufferAttribute(pos, i0);
    b.fromBufferAttribute(pos, i1);
    c.fromBufferAttribute(pos, i2);
    normals.push(new THREE.Vector3().crossVectors(b.clone().sub(a), c.clone().sub(a)).normalize());
    if (!allEdges) {
      for (const k of [key(i1, i2), key(i2, i0), key(i0, i1)]) {
        const list = edges.get(k);
        if (list) list.push(t); else edges.set(k, [t]);
      }
    }
  }

  const out = new Float32Array(triCount * 9);
  const bary = new Float32Array(triCount * 9);
  for (let t = 0; t < triCount; t++) {
    const v = [idx[t * 3], idx[t * 3 + 1], idx[t * 3 + 2]];
    const hidden = [false, false, false];
    if (!allEdges) {
      for (let i = 0; i < 3; i++) {
        const list = edges.get(key(v[(i + 1) % 3], v[(i + 2) % 3]))!;
        if (list.length === 2) {
          const other = list[0] === t ? list[1] : list[0];
          if (normals[t].dot(normals[other]) > 0.999) hidden[i] = true;
        }
      }
    }
    for (let k = 0; k < 3; k++) {
      out[t * 9 + k * 3] = pos.getX(v[k]);
      out[t * 9 + k * 3 + 1] = pos.getY(v[k]);
      out[t * 9 + k * 3 + 2] = pos.getZ(v[k]);
      for (let i = 0; i < 3; i++) bary[t * 9 + k * 3 + i] = i === k || hidden[i] ? 1 : 0;
    }
  }
  const r = new THREE.BufferGeometry();
  r.setAttribute('position', new THREE.BufferAttribute(out, 3));
  r.setAttribute('bary', new THREE.BufferAttribute(bary, 3));
  r.computeBoundingSphere();
  return r;
}

/**
 * Adds the `edge` attribute the shader reads, from the final vertex positions:
 * per vertex, its distance to the opposite edge in its own slot (so the
 * interpolated slot is the distance to that edge), a huge value in every slot
 * whose edge is hidden, and the triangle's size in w. Idempotent.
 */
export function finalize(g: THREE.BufferGeometry) {
  if (g.getAttribute('edge')) return;
  const pos = g.getAttribute('position');
  const bary = g.getAttribute('bary');
  const n = pos.count / 3;
  const out = new Float32Array(pos.count * 4);
  const p = [new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()];
  const e = new THREE.Vector3(), f = new THREE.Vector3();
  for (let t = 0; t < n; t++) {
    for (let k = 0; k < 3; k++) p[k].fromBufferAttribute(pos, t * 3 + k);
    const area2 = e.subVectors(p[1], p[0]).cross(f.subVectors(p[2], p[0])).length();
    const h = [0, 0, 0];
    let size = 0;
    for (let i = 0; i < 3; i++) {
      const len = p[(i + 1) % 3].distanceTo(p[(i + 2) % 3]);
      h[i] = len > 1e-9 ? area2 / len : 0;
      size = Math.max(size, len);
    }
    for (let i = 0; i < 3; i++) {
      let sum = 0;
      for (let k = 0; k < 3; k++) sum += bary.getComponent(t * 3 + k, i);
      const hidden = sum > 2.5;
      for (let k = 0; k < 3; k++) out[(t * 3 + k) * 4 + i] = hidden ? 1e5 : k === i ? h[i] : 0;
    }
    for (let k = 0; k < 3; k++) out[(t * 3 + k) * 4 + 3] = size * 0.5;
  }
  g.setAttribute('edge', new THREE.BufferAttribute(out, 4));
}

/** Builds glow-ready geometry straight from a triangle soup (every edge visible). */
export function soup(positions: ArrayLike<number>): THREE.BufferGeometry {
  const n = positions.length / 3;
  const bary = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) bary[i * 3 + (i % 3)] = 1;
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.BufferAttribute(Float32Array.from(positions), 3));
  g.setAttribute('bary', new THREE.BufferAttribute(bary, 3));
  g.computeBoundingSphere();
  return g;
}

/** Copies a prepped geometry with a transform baked in. */
export function placed(g: THREE.BufferGeometry, m: THREE.Matrix4): THREE.BufferGeometry {
  const c = g.clone();
  c.applyMatrix4(m);
  return c;
}

const _m = new THREE.Matrix4(), _q = new THREE.Quaternion(), _e = new THREE.Euler(), _s = new THREE.Vector3(), _p = new THREE.Vector3();
export function trs(x: number, y: number, z: number, rx = 0, ry = 0, rz = 0, sx = 1, sy = sx, sz = sx): THREE.Matrix4 {
  return _m.compose(_p.set(x, y, z), _q.setFromEuler(_e.set(rx, ry, rz)), _s.set(sx, sy, sz)).clone();
}
