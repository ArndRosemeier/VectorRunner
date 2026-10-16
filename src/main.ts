import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { shared, finalize, GlowMaterial } from './glow.js';
import { style, UNI_PRESETS, type StyleMode } from './style.js';
import { buildTerrain, heightAt, LAKE, ENTRANCES, roadQuery, CITY_HALF } from './terrain.js';
import { buildCaves, inCave, caveCast, CRYSTAL_CAVERN, POOL_CAVERN } from './caves.js';
import { buildSky, SUN_DIR } from './sky.js';
import { buildCity } from './city.js';
import { buildNature } from './nature.js';
import { buildCreatures } from './creatures.js';
import { Player, type Mode } from './player.js';

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;
const canvas = $<HTMLCanvasElement>('view');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.toneMapping = THREE.NoToneMapping;

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 20000);
camera.layers.enable(1);
scene.add(camera);

const pxScale = () => { shared.uPxScale.value = renderer.domElement.height / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)); };
pxScale();

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.75, 0.4, 0.32);
composer.addPass(bloom);
composer.addPass(new OutputPass());

shared.uLightDir.value.copy(SUN_DIR).setY(0.45).normalize();

const save = (k: string, v: string) => { try { localStorage.setItem('vr.' + k, v); } catch { /* storage may be blocked */ } };
const load = (k: string) => { try { return localStorage.getItem('vr.' + k); } catch { return null; } };

function build() {
  const sky = buildSky(scene);
  buildTerrain(scene);
  const caves = buildCaves(scene);
  const city = buildCity(scene);
  const nature = buildNature(scene);
  const pop = buildCreatures(scene);
  const player = new Player(camera);
  // every glow mesh gets its edge distances from its final geometry
  scene.traverse((o) => { if (o instanceof THREE.Mesh && o.material instanceof GlowMaterial) finalize(o.geometry); });
  return { sky, caves, city, nature, pop, player };
}

function floorIn(c: [number, number, number]) {
  const hit = caveCast(c, [0, -1, 0], 120);
  return hit ? hit[1] + 0.3 : c[1];
}

const A = ENTRANCES[0];
const PLACES: { name: string; go: (p: Player) => void }[] = [
  { name: 'City plaza', go: (p) => p.teleport(-40, null, 10, 0) },
  { name: 'Above the skyline', go: (p) => p.teleport(260, 170, 420, Math.atan2(260, 420), 'fly') },
  { name: 'Ride the loop road', go: (p) => { p.teleport(430, null, 10, -Math.PI / 2); p.setMode('ride'); } },
  { name: 'Mirror lake', go: (p) => p.teleport(LAKE.x + LAKE.r * 1.2, null, LAKE.z, Math.PI / 2) },
  { name: 'Pine forest', go: (p) => p.teleport(-60, null, -720, 0) },
  { name: 'Mountains', go: (p) => p.teleport(1350, 520, 1250, Math.atan2(1350, 1250) + Math.PI, 'fly') },
  { name: 'Sinkhole', go: (p) => p.teleport(A.x + 50, null, A.z, Math.PI / 2) },
  { name: 'Crystal cavern', go: (p) => p.teleport(CRYSTAL_CAVERN.c[0] - 30, floorIn([CRYSTAL_CAVERN.c[0] - 30, CRYSTAL_CAVERN.c[1], CRYSTAL_CAVERN.c[2]]), CRYSTAL_CAVERN.c[2], -Math.PI / 2) },
  { name: 'Pool cavern', go: (p) => p.teleport(POOL_CAVERN.c[0], floorIn([POOL_CAVERN.c[0], POOL_CAVERN.c[1], POOL_CAVERN.c[2] - 40]), POOL_CAVERN.c[2] - 40, Math.PI) },
];

function where(p: THREE.Vector3): string {
  if (inCave(p.x, p.y, p.z) && p.y < heightAt(p.x, p.z) - 3) return 'CAVES';
  if (Math.max(Math.abs(p.x), Math.abs(p.z)) < CITY_HALF + 20) return 'CITY';
  if (Math.hypot(p.x - LAKE.x, p.z - LAKE.z) < LAKE.r * 1.6) return 'LAKE';
  if (roadQuery(p.x, p.z).d < 30) return 'LOOP ROAD';
  if (p.z < -620 && Math.hypot(p.x, p.z) < 1500) return 'FOREST';
  if (Math.hypot(p.x, p.z) > 1300) return 'MOUNTAINS';
  return 'HILLS';
}

setTimeout(() => {
  const t0 = performance.now();
  const w = build();
  console.info(`world built in ${Math.round(performance.now() - t0)} ms, ${w.pop.count} creatures`);
  const { player } = w;
  $('loading').hidden = true;
  $('start').hidden = false;

  // ---- style controls ---------------------------------------------------------------
  const swatches = $('swatches');
  const swatchEls: HTMLButtonElement[] = [];
  for (const p of UNI_PRESETS) {
    const b = document.createElement('button');
    b.className = 'swatch';
    b.title = p.name;
    b.style.background = p.hex;
    b.style.color = p.hex;
    b.onclick = () => applyStyle('uni', p.hex);
    swatches.appendChild(b);
    swatchEls.push(b);
  }
  const picker = document.createElement('input');
  picker.type = 'color';
  picker.title = 'Any colour';
  picker.oninput = () => applyStyle('uni', picker.value);
  swatches.appendChild(picker);

  function applyStyle(mode: StyleMode, hex?: string) {
    style.set(mode, hex);
    const cur = '#' + style.uni.getHexString();
    picker.value = cur;
    document.querySelectorAll<HTMLButtonElement>('[data-style]').forEach((b) => b.classList.toggle('on', b.dataset.style === mode));
    swatchEls.forEach((b, i) => b.classList.toggle('on', mode === 'uni' && UNI_PRESETS[i].hex.toLowerCase() === cur));
    swatches.style.opacity = mode === 'uni' ? '1' : '0.45';
    save('style', mode);
    save('uni', cur);
  }
  document.querySelectorAll<HTMLButtonElement>('[data-style]').forEach((b) => (b.onclick = () => applyStyle(b.dataset.style as StyleMode)));
  applyStyle((load('style') as StyleMode) ?? 'colored', load('uni') ?? UNI_PRESETS[0].hex);
  const nextUni = () => {
    const cur = '#' + style.uni.getHexString();
    const i = UNI_PRESETS.findIndex((p) => p.hex.toLowerCase() === cur);
    applyStyle('uni', UNI_PRESETS[(i + 1) % UNI_PRESETS.length].hex);
  };

  // ---- mode, places, sliders ----------------------------------------------------------
  const setMode = (m: Mode) => {
    player.setMode(m);
    document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => b.classList.toggle('on', b.dataset.mode === m));
  };
  document.querySelectorAll<HTMLButtonElement>('[data-mode]').forEach((b) => (b.onclick = () => setMode(b.dataset.mode as Mode)));
  setMode('walk');
  const places = $<HTMLSelectElement>('places');
  places.innerHTML = '<option value="">choose…</option>' + PLACES.map((p, i) => `<option value="${i}">${i + 1}. ${p.name}</option>`).join('');
  const goPlace = (i: number) => { PLACES[i].go(player); setMode(player.mode); places.value = ''; };
  places.onchange = () => { if (places.value !== '') goPlace(Number(places.value)); places.blur(); };
  const glow = $<HTMLInputElement>('glow'), lines = $<HTMLInputElement>('lines'), mirror = $<HTMLInputElement>('mirror');
  glow.oninput = () => { bloom.strength = Number(glow.value); };
  lines.oninput = () => { shared.uLineWidth.value = Number(lines.value); };
  mirror.onchange = () => { w.nature.water.visible = mirror.checked; };
  PLACES[0].go(player);
  // handy from the console, and for automated screenshots
  (window as unknown as { vr: unknown }).vr = { scene, camera, renderer, bloom, composer, player, applyStyle, setMode, goPlace, places: PLACES.map((p) => p.name) };

  // ---- input --------------------------------------------------------------------------
  let locked = false;
  const start = () => {
    $('start').hidden = true;
    canvas.requestPointerLock?.()?.catch?.(() => {});
  };
  $('go').onclick = start;
  canvas.addEventListener('click', (e) => { if (!locked && (e as PointerEvent).pointerType !== 'touch') canvas.requestPointerLock?.()?.catch?.(() => {}); });
  document.addEventListener('pointerlockchange', () => { locked = document.pointerLockElement === canvas; });
  // touch: the left half of the screen is a move stick, the right half looks, a quick tap jumps
  let stickId = -1, stickX = 0, stickY = 0;
  const looks = new Map<number, { x: number; y: number; t: number; moved: number }>();
  const look = (dx: number, dy: number) => (player.mode === 'ride' ? player.rideLook(dx, dy) : player.look(dx, dy));
  canvas.addEventListener('pointerdown', (e) => {
    canvas.setPointerCapture(e.pointerId);
    if (e.pointerType === 'touch' && e.clientX < window.innerWidth / 2 && stickId < 0) {
      stickId = e.pointerId; stickX = e.clientX; stickY = e.clientY;
    } else looks.set(e.pointerId, { x: e.clientX, y: e.clientY, t: performance.now(), moved: 0 });
  });
  const release = (e: PointerEvent) => {
    if (e.pointerId === stickId) { stickId = -1; player.stick.x = player.stick.y = 0; }
    const l = looks.get(e.pointerId);
    if (l && e.pointerType === 'touch' && l.moved < 8 && performance.now() - l.t < 250) {
      player.keys.add('Space');
      setTimeout(() => player.keys.delete('Space'), 150);
    }
    looks.delete(e.pointerId);
  };
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);
  document.addEventListener('mousemove', (e) => { if (locked) look(e.movementX, e.movementY); });
  // without pointer lock (embedded pages, touch) drag to look
  canvas.addEventListener('pointermove', (e) => {
    if (e.pointerId === stickId) {
      const r = Math.min(window.innerWidth, window.innerHeight) * 0.12;
      player.stick.x = Math.max(-1, Math.min(1, (e.clientX - stickX) / r));
      player.stick.y = Math.max(-1, Math.min(1, -(e.clientY - stickY) / r));
      return;
    }
    const l = looks.get(e.pointerId);
    if (!l || locked) return;
    const dx = e.clientX - l.x, dy = e.clientY - l.y;
    l.moved += Math.abs(dx) + Math.abs(dy);
    look(dx * 1.6, dy * 1.6);
    l.x = e.clientX; l.y = e.clientY;
  });
  window.addEventListener('keydown', (e) => {
    if ((e.target as HTMLElement).tagName === 'INPUT' || (e.target as HTMLElement).tagName === 'SELECT') return;
    player.keys.add(e.code);
    if (e.code === 'Space' || e.code.startsWith('Arrow')) e.preventDefault();
    if (e.repeat) return;
    if (e.code === 'KeyF') setMode(player.mode === 'fly' ? 'walk' : 'fly');
    if (e.code === 'KeyR') setMode(player.mode === 'ride' ? 'walk' : 'ride');
    if (e.code === 'KeyV') applyStyle(style.mode === 'uni' ? 'colored' : 'uni');
    if (e.code === 'KeyB') nextUni();
    if (e.code === 'KeyH') $('panel').classList.toggle('hidden');
    if (/^Digit[1-9]$/.test(e.code)) { const i = Number(e.code.slice(5)) - 1; if (PLACES[i]) goPlace(i); }
  });
  window.addEventListener('keyup', (e) => player.keys.delete(e.code));
  window.addEventListener('blur', () => player.keys.clear());
  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
    composer.setSize(window.innerWidth, window.innerHeight);
  });

  // ---- the loop -----------------------------------------------------------------------
  const clock = new THREE.Clock();
  const fogTarget = new THREE.Color();
  let hudT = 0;
  const loop = () => {
    const dt = Math.min(clock.getDelta(), 0.05);
    const t = clock.elapsedTime;
    shared.uTime.value = t;
    player.update(dt);
    player.relaxLook(dt);
    const eye = camera.position;
    const under = inCave(eye.x, eye.y, eye.z) && eye.y < heightAt(eye.x, eye.z) - 4;
    fogTarget.copy(under ? style.sky().fog.multiplyScalar(0.25) : style.sky().fog);
    shared.uFogColor.value.lerp(fogTarget, Math.min(1, dt * 3));
    const dens = under ? 0.0065 : 0.00048;
    shared.uFogDensity.value += (dens - shared.uFogDensity.value) * Math.min(1, dt * 3);
    w.sky.group.visible = !under || eye.y > heightAt(eye.x, eye.z) - 40;
    w.sky.update(t, camera);
    w.caves.update(t);
    w.city.update(t);
    w.pop.update(dt, t, eye);
    hudT -= dt;
    if (hudT < 0) {
      hudT = 0.25;
      $('where').textContent = where(eye) + (player.mode === 'fly' ? ' · FLYING' : '');
      $('speed').textContent = player.mode === 'ride' ? `${Math.round(player.rideSpeed * 3.6)} km/h` : '';
    }
    pxScale();
    composer.render();
    requestAnimationFrame(loop);
  };
  loop();
}, 30);
