/**
 * The dusk sky: a gradient dome with a hot glow along the horizon under the
 * sun, a field of stars overhead, and the sun itself, a faceted low-poly ball
 * with glowing edges and a slowly turning ring, sitting low in the west.
 */
import * as THREE from 'three';
import { prep } from './glow.js';
import { style } from './style.js';
import { mulberry32 } from './noise.js';

export const SUN_DIR = new THREE.Vector3(-0.92, 0.27, -0.38).normalize();

export interface Sky { group: THREE.Group; update(t: number, camera: THREE.Camera): void }

export function buildSky(scene: THREE.Scene): Sky {
  const group = new THREE.Group();
  const uniforms = {
    uTop: { value: new THREE.Color() },
    uHorizon: { value: new THREE.Color() },
    uGlow: { value: new THREE.Color() },
    uSun: { value: SUN_DIR.clone() },
  };
  const dome = new THREE.Mesh(
    new THREE.SphereGeometry(9000, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      uniforms,
      vertexShader: /* glsl */ `
        varying vec3 vDir;
        void main() {
          vDir = normalize(position);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
          gl_Position.z = gl_Position.w;
        }`,
      fragmentShader: /* glsl */ `
        uniform vec3 uTop, uHorizon, uGlow, uSun;
        varying vec3 vDir;
        void main() {
          vec3 d = normalize(vDir);
          float y = d.y;
          vec3 c = mix(uHorizon, uTop, smoothstep(-0.02, 0.55, y));
          c = mix(c, uHorizon * 0.35, smoothstep(0.0, -0.25, y));
          float a = dot(d.xz / max(length(d.xz), 1e-4), normalize(uSun.xz));
          float toward = pow(0.5 + 0.5 * a, 6.0);
          c += uGlow * exp(-abs(y - 0.02) * 9.0) * toward * 0.9;
          // a soft halo around the sun itself
          c += uGlow * pow(max(dot(d, normalize(uSun)), 0.0), 24.0) * 0.5;
          c += uGlow * exp(-abs(y - 0.02) * 60.0) * pow(0.5 + 0.5 * a, 30.0) * 0.8;
          // faint horizontal bands, like the reference's synthwave haze
          c += uGlow * 0.04 * step(0.0, y) * step(y, 0.25) * smoothstep(0.6, 1.0, sin(y * 160.0)) * toward;
          if (any(isnan(c))) c = vec3(0.0);
          gl_FragColor = vec4(clamp(c, 0.0, 6.0), 1.0);
        }`,
    }),
  );
  dome.renderOrder = -10;
  dome.frustumCulled = false;
  group.add(dome);

  // stars
  const rnd = mulberry32(9);
  const sp: number[] = [];
  for (let i = 0; i < 2500; i++) {
    const u = rnd() * 2 - 1, a = rnd() * Math.PI * 2;
    const y = 0.08 + Math.abs(u) * 0.92;
    const r = Math.sqrt(1 - y * y);
    sp.push(Math.cos(a) * r * 8000, y * 8000, Math.sin(a) * r * 8000);
  }
  const sg = new THREE.BufferGeometry();
  sg.setAttribute('position', new THREE.Float32BufferAttribute(sp, 3));
  const starMat = new THREE.PointsMaterial({ size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0.85, depthWrite: false, fog: false });
  const stars = new THREE.Points(sg, starMat);
  stars.frustumCulled = false;
  group.add(stars);

  // the sun, low-poly and outlined like everything else
  const sun = new THREE.Mesh(prep(new THREE.IcosahedronGeometry(330, 1), true), style.material('sun', { fog: false }));
  const ring = new THREE.Mesh(prep(new THREE.TorusGeometry(520, 18, 3, 24), true), style.material('sunRing', { fog: false }));
  const ring2 = new THREE.Mesh(prep(new THREE.TorusGeometry(640, 6, 3, 30), true), style.material('sunRing', { fog: false, shade: 0.7 }));
  const sunGroup = new THREE.Group();
  sunGroup.add(sun, ring, ring2);
  group.add(sunGroup);
  scene.add(group);

  const recolor = () => {
    const s = style.sky();
    uniforms.uTop.value.copy(s.top);
    uniforms.uHorizon.value.copy(s.horizon);
    uniforms.uGlow.value.copy(s.glow);
    starMat.color.copy(s.stars);
  };
  recolor();
  style.onChange(recolor);

  return {
    group,
    update(t, camera) {
      // the sky travels with the viewer so it is always infinitely far
      group.position.copy(camera.position);
      sunGroup.position.copy(SUN_DIR).multiplyScalar(6500);
      sunGroup.lookAt(camera.position);
      sun.rotation.set(t * 0.03, t * 0.05, 0);
      ring.rotation.set(1.25, 0.2, t * 0.04);
      ring2.rotation.set(1.1, -0.3, -t * 0.03);
    },
  };
}
