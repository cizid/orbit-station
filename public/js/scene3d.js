import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';
import { T, ROOM_W, ROOM_H, MAP_W, MAP_H, MARGIN, DOOR_X, DOOR_W, COL_X, HALL_FLOOR_Y, HALL_W, MEET_CAP_S, FACE, ROOMS, ROOM } from './consts.js';
import { STATION_DEFS } from './layout.js';
import { spawnPos } from './map.js';

// The station as a 3D diorama: floating room platforms on a dark base, glowing paths in between.
// One tile of the logic map (map.js) is one unit here, so agents.js keeps deciding where everybody walks
// and this file only shows it. x/y in "pixels" of the logic map -> world x/z via (px / T - centre).

const CX = MAP_W / 2, CZ = MAP_H / 2;
const RH = 0.5, GH = 0.1;                       // room platform top, hallway ground top
const AGENT_SCALE = 2.2;
const ACCENT = '#19d3ff';
export const wx = px => px / T - CX;
export const wz = py => (py - 4) / T - CZ;

const mat = (color, o = {}) => new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.1, ...o });
const glow = (color, k = 1.4, o = {}) => new THREE.MeshStandardMaterial({ color: '#05080c', emissive: color, emissiveIntensity: k, roughness: 0.4, ...o });
function box(w, h, d, m, x = 0, y = 0, z = 0, shadow = true) {
  const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m);
  me.position.set(x, y + h / 2, z); me.castShadow = shadow; me.receiveShadow = true;
  return me;
}
function cyl(rt, rb, h, m, x = 0, y = 0, z = 0, seg = 24) {
  const me = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), m);
  me.position.set(x, y + h / 2, z); me.castShadow = true; me.receiveShadow = true;
  return me;
}
function ball(r, m, x = 0, y = 0, z = 0) {
  const me = new THREE.Mesh(new THREE.SphereGeometry(r, 20, 14), m);
  me.position.set(x, y, z); me.castShadow = true;
  return me;
}

function gridTexture(cols, rows, line = 'rgba(120,170,200,0.10)') {
  const c = document.createElement('canvas'); c.width = 64; c.height = 64;
  const g = c.getContext('2d');
  g.fillStyle = 'rgba(255,255,255,0)'; g.fillRect(0, 0, 64, 64);
  g.strokeStyle = line; g.lineWidth = 2; g.strokeRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(cols, rows); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

// ------------------------------------------------------------------ characters
function astronaut(color) {
  const g = new THREE.Group(), white = mat('#eef2f7', { roughness: 0.45 }), grey = mat('#b9c3cf'), dark = mat('#222a35');
  const suit = mat(color, { roughness: 0.5 });
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.34, 0.5, 6, 14), white); body.position.y = 0.95; body.castShadow = true; g.add(body);
  const belt = new THREE.Mesh(new THREE.CylinderGeometry(0.36, 0.36, 0.1, 18), suit); belt.position.y = 0.78; g.add(belt);
  const chest = box(0.3, 0.2, 0.06, dark, 0, 1.0, 0.33, false); g.add(chest);
  chest.add(box(0.1, 0.05, 0.02, glow(ACCENT, 2), 0, 0.075, 0.035, false));
  const pack = box(0.52, 0.7, 0.26, suit, 0, 0.62, -0.42); g.add(pack);
  const helmet = ball(0.42, white, 0, 1.58, 0); helmet.scale.set(1, 0.95, 1); g.add(helmet);
  const visor = ball(0.33, mat('#0a1626', { roughness: 0.1, metalness: 0.6 }), 0, 1.58, 0.16); visor.scale.set(1.05, 0.72, 0.7); g.add(visor);
  const shine = box(0.12, 0.04, 0.02, glow('#9fefff', 1.2), -0.1, 1.64, 0.43, false); g.add(shine);
  const mkLimb = (x, y, len, r, m) => {
    const pivot = new THREE.Group(); pivot.position.set(x, y, 0);
    const l = new THREE.Mesh(new THREE.CapsuleGeometry(r, len, 4, 10), m); l.position.y = -len / 2 - r * 0.5; l.castShadow = true; pivot.add(l);
    g.add(pivot); return pivot;
  };
  const armL = mkLimb(-0.46, 1.2, 0.34, 0.11, white), armR = mkLimb(0.46, 1.2, 0.34, 0.11, white);
  const legL = mkLimb(-0.17, 0.62, 0.36, 0.13, grey), legR = mkLimb(0.17, 0.62, 0.36, 0.13, grey);
  g.userData.parts = { armL, armR, legL, legR, body };
  return g;
}

// R2-D2 style: silver dome with colour bands and one lens, white barrel body, two side legs and a centre foot
function robot(color) {
  const g = new THREE.Group(), white = mat('#f1f4f8', { roughness: 0.4 }), silver = mat('#c4ccd6', { metalness: 0.5, roughness: 0.3 });
  const band = mat(color, { roughness: 0.4 }), dark = mat('#1a212b'), steel = mat('#7d8896', { metalness: 0.4 });
  const body = cyl(0.42, 0.42, 0.9, white, 0, 0.55); g.add(body);
  for (const y of [0.85, 1.2]) g.add(cyl(0.435, 0.435, 0.09, band, 0, y));
  g.add(box(0.34, 0.26, 0.04, dark, 0, 0.7, 0.42, false)); g.add(box(0.08, 0.06, 0.02, glow('#ffc233', 1.6), 0.08, 0.76, 0.45, false)); g.add(box(0.08, 0.06, 0.02, glow(ACCENT, 1.6), -0.08, 0.76, 0.45, false));
  const dome = new THREE.Mesh(new THREE.SphereGeometry(0.43, 24, 12, 0, Math.PI * 2, 0, Math.PI / 2), silver); dome.position.y = 1.45; dome.castShadow = true; g.add(dome);
  g.add(cyl(0.435, 0.435, 0.07, band, 0, 1.4));
  const lens = ball(0.1, mat('#080c12'), 0, 1.68, 0.36); g.add(lens); g.add(ball(0.045, glow('#ff4d4d', 2.2), 0, 1.68, 0.44));
  g.add(cyl(0.015, 0.015, 0.3, steel, 0.18, 1.82));
  const leg = x => { const p = new THREE.Group(); p.position.set(x, 0.85, 0); p.add(box(0.14, 0.9, 0.3, steel, 0, -0.85, 0)); p.add(box(0.22, 0.12, 0.5, dark, 0, -0.95, 0.06)); g.add(p); return p; };
  const legL = leg(-0.55), legR = leg(0.55);
  g.add(box(0.3, 0.2, 0.36, dark, 0, 0.0, 0.0));
  const arm = new THREE.Group(); arm.position.set(0.42, 1.0, 0.25);
  arm.add(box(0.07, 0.07, 0.4, steel, 0, 0, 0.2)); arm.add(ball(0.06, glow('#ffc233', 1.6), 0, 0.03, 0.42)); g.add(arm);
  g.userData.parts = { legL, legR, arm, body };
  return g;
}

// ------------------------------------------------------------------ props
const BODY = '#cfe6ff', BODY2 = '#8fb0d6', DARK = '#173154', SCREEN = '#3da9fc';
function propFor(key, w, h, [bx, by], room) {
  const g = new THREE.Group(), c = room.color;
  const m = mat(BODY), m2 = mat(BODY2), dk = mat(DARK);
  if (w * h <= 2 && w <= 2 && h <= 2) {                                   // 1x1 .. 2x1: plants and small stands
    g.add(cyl(0.34, 0.26, 0.4, mat('#5a4636'), 0, 0)); g.add(ball(0.42, mat('#2f9e6e'), 0, 0.85)); g.add(ball(0.28, mat('#43c08b'), 0.12, 1.2, 0.05));
    return g;
  }
  if (key === 'desks') {
    g.add(box(w, 0.9, h * 0.9, dk, 0, 0)); g.add(box(w + 0.2, 0.14, h, m, 0, 0.9));
    const n = Math.max(1, Math.round(w / 3));
    for (let i = 0; i < n; i++) {
      const x = -w / 2 + (i + 0.5) * w / n;
      g.add(box(1.5, 0.95, 0.08, mat('#12171e'), x, 1.15, h * 0.1)); g.add(box(1.4, 0.84, 0.03, glow(SCREEN, 0.9), x, 1.2, h * 0.1 + 0.06, false)); g.add(box(0.12, 0.3, 0.12, m2, x, 1.04, h * 0.1));
      g.add(box(0.7, 0.04, 0.3, m2, x, 1.04, h * 0.45));
    }
  } else if (key === 'library') {
    if (h >= 2 && w >= 10) {                                               // wall of shelves
      g.add(box(w, 3.4, h * 0.6, dk, 0, 0, -h * 0.2));
      for (let r = 0; r < 4; r++) for (let i = 0; i < w * 2; i++) {
        if ((i * 7 + r * 3) % 5 === 0) continue;
        const hh = 0.5 + ((i * 13 + r) % 4) * 0.12;
        g.add(box(0.34, hh, 0.45, mat(['#3de0c8', '#5aa9ff', '#c4b5fd', '#ffc233', '#e8eef5'][(i + r * 2) % 5], { roughness: 0.6 }), -w / 2 + 0.25 + i * 0.5, 0.2 + r * 0.8, -h * 0.05, false));
      }
      g.add(box(w, 0.05, 0.05, glow(c, 1.6), 0, 3.45, h * 0.1, false));
    } else { g.add(cyl(Math.min(w, h) * 0.45, Math.min(w, h) * 0.45, 0.9, m, 0, 0)); g.add(cyl(Math.min(w, h) * 0.38, Math.min(w, h) * 0.38, 0.06, glow(c, 1.2), 0, 0.92)); }
  } else if (key === 'comms') {
    if (w >= 6) {
      g.add(cyl(1.5, 1.8, 0.6, dk, 0, 0)); g.add(cyl(0.18, 0.18, 1.8, m2, 0, 0.6));
      const dish = new THREE.Mesh(new THREE.SphereGeometry(1.4, 24, 10, 0, Math.PI * 2, 0, Math.PI / 2.6), m); dish.rotation.x = Math.PI * 0.85; dish.position.set(0, 2.6, 0.2); dish.castShadow = true; g.add(dish);
      g.add(ball(0.12, glow('#ff4d4d', 2), 0, 2.15, 0.8));
      g.add(cyl(1.1, 1.1, 0.04, glow(c, 1.4, { transparent: true, opacity: 0.8 }), 0, 0.62));
    } else {
      g.add(box(w, 0.9, h * 0.8, dk, 0, 0)); g.add(box(w - 0.3, 0.7, 0.1, mat('#12171e'), 0, 1.0, -h * 0.1).rotateX(-0.25));
      g.add(box(w - 0.5, 0.5, 0.03, glow(c, 0.9), 0, 1.1, -h * 0.1 + 0.07, false).rotateX(-0.25));
    }
  } else if (key === 'bench') {
    g.add(box(w, 0.9, h * 0.9, dk, 0, 0)); g.add(box(w + 0.1, 0.12, h, mat('#8a5a2b'), 0, 0.9));
    for (let i = 0; i < Math.max(1, Math.floor(w / 3)); i++) {
      const x = -w / 2 + 1.2 + i * 3;
      g.add(box(1.2, 0.8, 0.9, m, x, 1.02, 0)); g.add(box(1.25, 0.12, 0.95, glow('#ffa24a', 1.2), x, 1.5, 0, false));
      g.add(cyl(0.18, 0.18, 0.5, m2, x + 0.8, 1.02, 0.1)); g.add(ball(0.07, glow('#5de6a0', 2), x - 0.4, 1.3, 0.47));
    }
  } else if (key === 'lounge') {
    if (w >= 6) {
      g.add(box(w, 0.55, h * 0.8, mat('#33415a'), 0, 0, h * 0.1)); g.add(box(w, 0.9, 0.45, mat('#28344a'), 0, 0.3, -h * 0.35));
      for (let i = 0; i < w / 2; i++) g.add(box(1.7, 0.18, h * 0.65, mat('#4a5d80', { roughness: 0.8 }), -w / 2 + 1 + i * 2, 0.55, h * 0.12));
    } else { g.add(cyl(Math.min(w, h) * 0.5, Math.min(w, h) * 0.5, 0.5, m2, 0, 0)); g.add(cyl(Math.min(w, h) * 0.5, Math.min(w, h) * 0.5, 0.06, glow(c, 1), 0, 0.52)); }
  } else if (key === 'meet') {
    const t = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.14, 48), mat('#56667c')); t.scale.set(w / 2, 1, h / 2); t.position.y = 1.0; t.castShadow = true; g.add(t);
    const base = new THREE.Mesh(new THREE.CylinderGeometry(1, 1, 0.9, 32), dk); base.scale.set(w / 2 - 1.4, 1, h / 2 - 0.6); base.position.y = 0.45; g.add(base);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(1, 0.03, 8, 64), glow(c, 2)); ring.rotation.x = Math.PI / 2; ring.scale.set(w / 2 - 0.5, h / 2 - 0.4, 1); ring.position.y = 1.08; g.add(ring);
  } else {                                                                 // gate: crates and consoles
    if (h >= 2) { g.add(box(w, 0.8, h, m2, 0, 0)); g.add(box(w * 0.5, 0.8, h * 0.8, m, -w * 0.15, 0.8)); g.add(box(w, 0.04, 0.04, glow(c, 1.4), 0, 0.8, h / 2, false)); }
    else { g.add(box(w, 0.9, h, dk, 0, 0)); g.add(box(w - 0.4, 0.04, h - 0.3, glow(c, 1), 0, 0.92, 0, false)); }
  }
  return g;
}

// ------------------------------------------------------------------ scene
export function createScene({ container, Orbit, crowd }) {
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.05;
  renderer.domElement.id = 'world';
  container.prepend(renderer.domElement);

  const scene = new THREE.Scene();
  const bgc = document.createElement('canvas'); bgc.width = 8; bgc.height = 256;
  { const g = bgc.getContext('2d'), gr = g.createLinearGradient(0, 0, 0, 256); gr.addColorStop(0, '#050d20'); gr.addColorStop(0.5, '#071634'); gr.addColorStop(1, '#040a18'); g.fillStyle = gr; g.fillRect(0, 0, 8, 256); }
  scene.background = new THREE.CanvasTexture(bgc); scene.background.colorSpace = THREE.SRGBColorSpace;
  const camera = new THREE.PerspectiveCamera(32, 1, 1, 400);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true; controls.dampingFactor = 0.09; controls.screenSpacePanning = false;
  controls.minDistance = 10; controls.maxDistance = 150; controls.maxPolarAngle = Math.PI * 0.46; controls.zoomSpeed = 0.9;
  controls.mouseButtons = { LEFT: THREE.MOUSE.ROTATE, MIDDLE: THREE.MOUSE.DOLLY, RIGHT: THREE.MOUSE.PAN };

  // glow: bright emissive parts bloom a little
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));
  const bloom = new UnrealBloomPass(new THREE.Vector2(512, 512), 0.75, 0.6, 0.7); composer.addPass(bloom);
  composer.addPass(new OutputPass());

  // light
  scene.add(new THREE.HemisphereLight('#a9d4ff', '#16315a', 1.7));
  const sun = new THREE.DirectionalLight('#ffffff', 2.4);
  sun.position.set(-26, 52, 34); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -48, right: 48, top: 44, bottom: -44, near: 5, far: 150 }); sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  scene.add(sun);
  const rim = new THREE.DirectionalLight('#19d3ff', 0.45); rim.position.set(30, 20, -40); scene.add(rim);

  // base plate
  const baseW = MAP_W - 2 * MARGIN + 2, baseH = MAP_H - 2 * MARGIN + 2;
  const base = box(baseW, 0.6, baseH, mat('#0a1a34', { roughness: 0.8 }), 0, -0.5, 0); scene.add(base);
  const baseTop = new THREE.Mesh(new THREE.PlaneGeometry(baseW, baseH), new THREE.MeshStandardMaterial({ color: '#0e2447', roughness: 0.9, map: gridTexture(baseW, baseH, 'rgba(60,170,255,0.22)') }));
  baseTop.rotation.x = -Math.PI / 2; baseTop.position.y = GH; baseTop.receiveShadow = true; scene.add(baseTop);
  const rimGlow = box(baseW + 0.2, 0.08, 0.12, glow(ACCENT, 1.2), 0, -0.2, baseH / 2 + 0.1, false); scene.add(rimGlow);
  scene.add(box(0.12, 0.08, baseH + 0.2, glow(ACCENT, 0.8), baseW / 2 + 0.1, -0.2, 0, false), box(0.12, 0.08, baseH + 0.2, glow(ACCENT, 0.8), -baseW / 2 - 0.1, -0.2, 0, false));

  // glowing paths: ring round the meeting room and one lane from every door to it
  const lane = glow(ACCENT, 1.1, { transparent: true, opacity: 0.85 }), laneDim = glow('#2b8f86', 0.8);
  const hx0 = COL_X[0] + 7.44 - CX, hx1 = COL_X[0] + HALL_W - 7.56 - CX, hz0 = HALL_FLOOR_Y + 1.44 - CZ, hz1 = MEET_CAP_S + 1 + FACE + 1.44 - CZ;
  const strip = (x0, z0, x1, z1, m) => { const dx = x1 - x0, dz = z1 - z0; const me = box(Math.max(0.14, Math.abs(dx)), 0.03, Math.max(0.14, Math.abs(dz)), m, (x0 + x1) / 2, GH, (z0 + z1) / 2, false); scene.add(me); };
  strip(hx0, hz0, hx1, hz0, lane); strip(hx0, hz1, hx1, hz1, lane); strip(hx0, hz0, hx0, hz1, lane); strip(hx1, hz0, hx1, hz1, lane);
  for (const r of ROOMS) {
    const x = r.tx + DOOR_X + DOOR_W / 2 - CX;
    const z0 = r.top ? r.ty + ROOM_H - CZ : r.ty - CZ, z1 = r.top ? hz0 : hz1;
    strip(x, z0, x, z1, laneDim);
  }

  // rooms
  const roomObjs = {}, rooms = [...ROOMS, ROOM.meet];
  const pickables = [];
  for (const r of rooms) {
    const w = r.w ?? ROOM_W, h = r.h ?? ROOM_H, cx = r.tx + w / 2 - CX, cz = r.ty + h / 2 - CZ;
    const grp = new THREE.Group(); grp.position.set(cx, 0, cz); scene.add(grp);
    const slab = box(w + 1, RH, h + 1, mat('#123059', { roughness: 0.7 }), 0, 0); slab.userData.room = r.key; grp.add(slab); pickables.push(slab);
    const floorMat = new THREE.MeshStandardMaterial({ color: '#17406d', roughness: 0.75, emissive: '#ff6a2a', emissiveIntensity: 0, map: gridTexture(w, h, 'rgba(90,190,255,0.30)') });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(w, h), floorMat); floor.rotation.x = -Math.PI / 2; floor.position.y = RH + 0.005; floor.receiveShadow = true; floor.userData.room = r.key; grp.add(floor); pickables.push(floor);
    const edge = glow(r.color, 1.5);
    grp.add(box(w + 1.1, 0.06, 0.1, edge, 0, RH - 0.05, (h + 1) / 2, false), box(0.1, 0.06, h + 1.1, edge, (w + 1) / 2, RH - 0.05, 0, false), box(0.1, 0.06, h + 1.1, edge, -(w + 1) / 2, RH - 0.05, 0, false));
    const wall = box(w + 1, 1.9, 0.18, mat('#1a4a7c', { transparent: true, opacity: 0.45, roughness: 0.4 }), 0, RH, -h / 2 - 0.4, false); grp.add(wall);
    grp.add(box(w + 1, 0.05, 0.22, glow(r.color, 1.6), 0, RH + 1.9, -h / 2 - 0.4, false));
    const defs = STATION_DEFS[r.key];
    for (const [bx, by, bw, bh] of defs.blocks) {
      const p = propFor(r.key, bw, bh, [bx, by], r);
      p.position.set(r.tx + bx + bw / 2 - CX - cx, RH, r.ty + by + bh / 2 - CZ - cz); grp.add(p);
    }
    if (r.key === 'meet') {                                                  // wall displays, plants and a hologram over the table
      for (const f of [-0.3, 0, 0.3]) { const dx = f * w; grp.add(box(7, 2.2, 0.15, mat('#10161d'), dx, RH + 0.3, -h / 2 - 0.2)); grp.add(box(6.6, 1.9, 0.05, glow(r.color, 0.75), dx, RH + 0.45, -h / 2 - 0.1, false)); }
      for (const dx of [-w / 2 + 1.2, w / 2 - 1.2]) { grp.add(cyl(0.5, 0.4, 0.7, mat('#5a4636'), dx, RH)); grp.add(ball(0.8, mat('#2f9e6e'), dx, RH + 1.5)); grp.add(ball(0.55, mat('#43c08b'), dx + 0.2, RH + 2.2)); }
      const cone = new THREE.Mesh(new THREE.ConeGeometry(2.2, 2.6, 32, 1, true), new THREE.MeshBasicMaterial({ color: r.color, transparent: true, opacity: 0.13, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })); cone.position.y = RH + 2.5; cone.rotation.x = Math.PI; grp.add(cone);
      grp.add(cyl(0.5, 0.7, 0.18, glow(r.color, 1.6), 0, RH + 1.1));
    }
    roomObjs[r.key] = { grp, floorMat, w, h, cx, cz };
  }

  // the gate: a portal ring where agents arrive
  const sp = spawnPos(), gate = new THREE.Group();
  gate.position.set(wx(sp.x), RH, wz(sp.y) - 0.2); scene.add(gate);
  const ringMat = glow('#8a6bff', 1.8), ring = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.12, 12, 48), ringMat); ring.position.y = 1.9; ring.castShadow = true; gate.add(ring);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(1.6, 40), new THREE.MeshBasicMaterial({ color: '#8a6bff', transparent: true, opacity: 0.25, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false })); disc.position.y = 1.9; gate.add(disc);
  gate.add(cyl(0.12, 0.12, 0.3, mat(DARK), -1.7, 0), cyl(0.12, 0.12, 0.3, mat(DARK), 1.7, 0));

  // shared selection ring and the lines between agents
  const selRing = new THREE.Mesh(new THREE.RingGeometry(0.95, 1.15, 40), new THREE.MeshBasicMaterial({ color: '#ffffff', transparent: true, opacity: 0.9, side: THREE.DoubleSide, depthWrite: false }));
  selRing.rotation.x = -Math.PI / 2; selRing.visible = false; scene.add(selRing);
  const linkMat = new THREE.LineBasicMaterial({ color: '#6ee7ff', transparent: true, opacity: 0.8 });
  const linkPool = [];
  const getLink = i => linkPool[i] ??= (() => {
    const geo = new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]);
    const line = new THREE.Line(geo, linkMat); line.frustumCulled = false; scene.add(line);
    const pk = new THREE.Group(); pk.add(box(0.5, 0.36, 0.5, mat('#e8f7ff'), 0, -0.18, 0, false), ball(0.5, new THREE.MeshBasicMaterial({ color: '#6ee7ff', transparent: true, opacity: 0.25, depthWrite: false }), 0, 0, 0));
    scene.add(pk);
    return { line, pk };
  })();

  // ---------------------------------------------------------------- agents
  const meshes = new Map();
  const floorAt = (x, z) => {
    for (const r of rooms) { const o = roomObjs[r.key]; if (Math.abs(x - o.cx) <= o.w / 2 + 0.5 && Math.abs(z - o.cz) <= o.h / 2 + 0.5) return RH; }
    return GH;
  };
  function ensureMesh(a) {
    let m = meshes.get(a.id);
    if (m) return m;
    const model = a.type === 'astro' ? astronaut(a.color) : robot(a.color);
    const holder = new THREE.Group(); holder.add(model);
    model.traverse(o => { o.userData.agentId = a.id; });
    scene.add(holder);
    m = { holder, model, parts: model.userData.parts, yaw: 0, h: RH, a };
    meshes.set(a.id, m);
    return m;
  }
  const FACE_YAW = { down: 0, up: Math.PI };
  const lerpAngle = (a, b, k) => { let d = ((b - a + Math.PI) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2) - Math.PI; return a + d * k; };

  const tmp = new THREE.Vector3();
  function syncAgents(t, dt) {
    for (const [id, m] of meshes) if (!Orbit.agents.has(id)) { scene.remove(m.holder); meshes.delete(id); }
    for (const a of Orbit.agents.values()) {
      const m = ensureMesh(a);
      if (m.px === undefined) { m.px = wx(a.x); m.pz = wz(a.y); }
      const kk = 1 - Math.exp(-dt * 7); m.px += (wx(a.x) - m.px) * kk; m.pz += (wz(a.y) - m.pz) * kk;   // soft corners
      const x = m.px, z = m.pz;
      const target = floorAt(x, z); m.h += (target - m.h) * Math.min(1, dt * 10);
      const s = Math.max(0.001, Math.min(1, a.spawn) * a.shrink) * AGENT_SCALE;
      const moving = a.path.length > 0, working = !moving && a.state === 'working' && ['desks', 'bench', 'library', 'comms'].includes(a.station);
      // done / waiting astronauts sit down on the lounge sofas (slots 0-5 are in front of them), facing the room
      const sitting = a.type === 'astro' && a.station === 'lounge' && a.arrived && !moving && a.slotIdx < 6 && !a.leaving && !a.vanish;
      m.sit = (m.sit ?? 0) + ((sitting ? 1 : 0) - (m.sit ?? 0)) * Math.min(1, dt * 2.5);
      const hop = a.type === 'astro' ? a.air / T * (1 - m.sit) : 0;
      m.holder.position.set(x, m.h + hop * AGENT_SCALE, z - 1.25 * m.sit); m.holder.scale.setScalar(s);
      const yaw = sitting ? 0 : a.face === 'side' ? (a.flip ? -Math.PI / 2 : Math.PI / 2) : FACE_YAW[a.face] ?? 0;
      m.yaw = lerpAngle(m.yaw, yaw, Math.min(1, dt * 5)); m.model.rotation.y = m.yaw;
      const P = m.parts, sw = Math.sin(a.dist * 0.4);
      if (a.type === 'astro') {
        const sit = m.sit;
        P.legL.rotation.x = (moving ? sw * 0.7 : 0) * (1 - sit) - 1.45 * sit; P.legR.rotation.x = (moving ? -sw * 0.7 : 0) * (1 - sit) - 1.45 * sit;
        const armL = moving ? -sw * 0.6 : working ? -1.25 + Math.sin(t * 4.5) * 0.12 : 0, armR = moving ? sw * 0.6 : working ? -1.25 + Math.sin(t * 4.5 + 1.5) * 0.12 : 0;
        P.armL.rotation.x = armL * (1 - sit) - 0.7 * sit; P.armR.rotation.x = armR * (1 - sit) - 0.7 * sit;   // hands in the lap
        P.body.position.y = 0.95 + (moving ? 0 : Math.sin(t * 2 + a.dist) * 0.02 * (1 - sit));
        m.model.position.y = -0.29 * sit;                                                                       // hips down to the seat
      } else {
        P.legL.rotation.x = moving ? sw * 0.45 : 0; P.legR.rotation.x = moving ? -sw * 0.45 : 0;
        m.model.position.y = moving ? Math.abs(sw) * 0.06 : 0;
        P.arm.rotation.x = working ? -0.2 + Math.sin(t * 4) * 0.15 : 0.5; P.arm.position.z = working ? 0.4 : 0.25;
        P.arm.visible = true;
      }
    }
    // selection / room highlight ring
    const sel = Orbit.agents.get(Orbit.selectedId), selM = sel && meshes.get(sel.id);
    selRing.visible = !!selM;
    if (selM) { selRing.position.set(selM.holder.position.x, selM.h + 0.03, selM.holder.position.z); const k = 1 + 0.12 * Math.sin(t * 5); selRing.scale.set(k * 1.5, k * 1.5, 1); }
  }

  function syncLinks(t) {
    let n = 0;
    const chest = a => { const m = meshes.get(a.id); return m ? tmp.copy(m.holder.position).setY(m.holder.position.y + 1.2 * AGENT_SCALE).clone() : null; };
    const setLine = (l, A, B) => {
      const pos = l.line.geometry.attributes.position; pos.setXYZ(0, A.x, A.y, A.z); pos.setXYZ(1, B.x, B.y, B.z); pos.needsUpdate = true; l.line.visible = true;
    };
    for (const lk of crowd.meetings.links()) {
      const A = chest(lk.a), B = chest(lk.b); if (!A || !B) continue;
      const l = getLink(n++); setLine(l, A, B);
      if (lk.packet) {
        const F = chest(lk.packet.from), To = chest(lk.packet.to);
        if (F && To) { const p = lk.packet.p, e = p * p * (3 - 2 * p); l.pk.position.lerpVectors(F, To, e); l.pk.position.y += Math.sin(Math.PI * p) * 2.2; l.pk.visible = true; l.pk.rotation.y = t * 4; } else l.pk.visible = false;
      } else l.pk.visible = false;
    }
    for (const a of Orbit.agents.values()) {       // a subagent out working stays tied to its parent
      const par = a.isSub && a.arrived && a.station !== 'meet' ? Orbit.agents.get(a.parentId) : null;
      if (!par) continue;
      const A = chest(a), B = chest(par); if (!A || !B) continue;
      const l = getLink(n++); setLine(l, A, B); l.pk.visible = false;
    }
    for (let i = n; i < linkPool.length; i++) { linkPool[i].line.visible = false; linkPool[i].pk.visible = false; }
  }

  // ------------------------------------------------------------ camera moves
  let tween = null, following = false;
  const home = { target: new THREE.Vector3(0, 0, 2), az: Math.PI * 0.22, pol: Math.PI * 0.3, dist: 100 };
  const dirOf = (az, pol) => new THREE.Vector3(Math.sin(az) * Math.sin(pol), Math.cos(pol), Math.cos(az) * Math.sin(pol));
  function fitDistance() {
    const r = container.getBoundingClientRect(), vfov = THREE.MathUtils.degToRad(camera.fov), t = Math.tan(vfov / 2);
    // the middle of the screen is free of panels: fit the station into it
    const fh = r.height / Math.max(300, r.height - 260), fw = r.width / Math.max(400, r.width - 700), aspect = Math.max(0.6, r.width / r.height);
    const need = 28 * fh / t, horiz = 38 * fw / (t * aspect);
    return Math.max(need, horiz);
  }
  function setView(target, dist, dur = 0.8) {
    const dir = camera.position.clone().sub(controls.target).normalize();
    tween = { t: 0, dur, fromT: controls.target.clone(), toT: target.clone(), fromP: camera.position.clone(), toP: target.clone().add(dir.multiplyScalar(dist)) };
  }
  function goHome() { following = false; home.dist = fitDistance(); setView(home.target, home.dist, 0.9); }
  function flyToRoom(key) { const o = roomObjs[key]; following = false; setView(new THREE.Vector3(o.cx, 0.5, o.cz), Math.max(24, o.w * 1.1), 0.9); }
  function flyToAgent(a) { const m = meshes.get(a.id); if (m) { following = true; setView(m.holder.position.clone().setY(1.5), 30, 0.8); } }

  // ------------------------------------------------------------ picking
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2();
  function pick(cx, cy) {
    const r = renderer.domElement.getBoundingClientRect();
    ndc.set(((cx - r.left) / r.width) * 2 - 1, -((cy - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, camera);
    const holders = [...meshes.values()].filter(m => !m.a.leaving && !m.a.isSub).map(m => m.holder);
    const ah = ray.intersectObjects(holders, true)[0];
    if (ah) { let o = ah.object; while (o && !o.userData.agentId) o = o.parent; if (o) return { agent: o.userData.agentId }; }
    const rh = ray.intersectObjects(pickables, false)[0];
    return rh ? { room: rh.object.userData.room } : null;
  }

  let down = null;
  const el = renderer.domElement;
  el.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY }; });
  el.addEventListener('pointerup', e => {
    const d = down; down = null;
    if (!d || Math.hypot(e.clientX - d.x, e.clientY - d.y) > 5) return;
    const p = pick(e.clientX, e.clientY);
    if (p && p.agent) { Orbit.select(p.agent); }
    else if (p && p.room) { Orbit.select(null, { keepCamera: true }); Orbit.highlightStation = p.room; flyToRoom(p.room); }
    else { Orbit.highlightStation = null; Orbit.select(null, { keepCamera: true }); goHome(); }
  });
  el.addEventListener('pointermove', e => { if (!down) el.style.cursor = pick(e.clientX, e.clientY)?.agent ? 'pointer' : 'grab'; });
  controls.addEventListener('start', () => { tween = null; following = false; });

  // ------------------------------------------------------------ sizing, labels, frame
  function resize() {
    const r = container.getBoundingClientRect();
    renderer.setSize(r.width, r.height, false); renderer.domElement.style.width = '100%'; renderer.domElement.style.height = '100%';
    composer.setPixelRatio(renderer.getPixelRatio()); composer.setSize(r.width, r.height);
    camera.aspect = r.width / Math.max(1, r.height); camera.setViewOffset(r.width, r.height, 0, Math.round(r.height * 0.03), r.width, r.height); camera.updateProjectionMatrix();
  }
  new ResizeObserver(resize).observe(container);
  resize();
  camera.position.copy(home.target).add(dirOf(home.az, home.pol).multiplyScalar(fitDistance()));
  controls.target.copy(home.target); controls.update();

  const roomCards = {};
  const cardHost = document.getElementById('labels');
  for (const r of rooms) {
    const c = document.createElement('div'); c.className = 'room-card'; c.style.setProperty('--c', r.color);
    c.innerHTML = `<b>${r.label}</b><span class="n">0</span>`; cardHost.append(c); roomCards[r.key] = c;
  }

  const v = new THREE.Vector3();
  function toScreen(p) {
    v.copy(p).project(camera);
    const r = renderer.domElement.getBoundingClientRect();   // relative to the stage, which holds the label layer
    return { x: (v.x * 0.5 + 0.5) * r.width, y: (-v.y * 0.5 + 0.5) * r.height, visible: v.z < 1 };
  }
  const headPoint = new THREE.Vector3();
  function project(a) {
    const m = meshes.get(a.id);
    if (!m) return { x: 0, y: 0, visible: false };
    headPoint.copy(m.holder.position).setY(m.holder.position.y + ((a.type === 'astro' ? 2.15 : 1.95) - 0.29 * (m.sit ?? 0)) * m.holder.scale.x + 0.2);
    return toScreen(headPoint);
  }

  let heat = {};
  function render(t, dt, gateFlash) {
    syncAgents(t, dt); syncLinks(t);
    // camera moves
    if (tween) {
      tween.t += dt / tween.dur;
      const k = Math.min(1, tween.t), e = 1 - Math.pow(1 - k, 3);
      controls.target.lerpVectors(tween.fromT, tween.toT, e); camera.position.lerpVectors(tween.fromP, tween.toP, e);
      if (k >= 1) tween = null;
    } else if (following) {
      const sel = meshes.get(Orbit.selectedId);
      if (sel) { const d = sel.holder.position.clone().setY(1).sub(controls.target).multiplyScalar(1 - Math.exp(-dt * 5)); controls.target.add(d); camera.position.add(d); }
    }
    controls.update();
    // gate, heat, room cards
    ring.rotation.z = t * 0.6; ringMat.emissiveIntensity = 1.4 + gateFlash * 3 + Math.sin(t * 3) * 0.3; disc.material.opacity = 0.18 + gateFlash * 0.4 + Math.sin(t * 2) * 0.04;
    for (const r of rooms) {
      const o = roomObjs[r.key], hv = heat[r.key] ?? 0, on = Orbit.highlightStation === r.key;
      o.floorMat.emissiveIntensity = hv > 0.4 ? 0.025 + 0.05 * hv + 0.015 * Math.sin(t * 2) : 0;
      o.floorMat.color.set(on ? '#235a94' : '#17406d');
    }
    const occ = {};
    for (const a of Orbit.agents.values()) if (!a.leaving && !a.isSub) occ[a.station] = (occ[a.station] || 0) + 1;
    for (const r of rooms) {
      const o = roomObjs[r.key], c = roomCards[r.key];
      const p = toScreen(tmp.set(o.cx - o.w / 2 + 2, RH + 2.4, o.cz - o.h / 2 - 0.2));
      c.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y)}px) translate(0, -100%)`;
      c.style.visibility = p.visible ? 'visible' : 'hidden';
      const n = occ[r.key] || 0; c.classList.toggle('busy', n > 0); c.querySelector('.n').textContent = n;
    }
    composer.render();
  }

  const chestScreen = id => { const m = meshes.get(id); return m ? toScreen(tmp.copy(m.holder.position).setY(m.holder.position.y + 1.3 * m.holder.scale.x)) : null; };
  return { render, project, chestScreen, setHeat: h => { heat = h || {}; }, goHome, flyToAgent, flyToRoom, toScreen, camera, controls, renderer, zoom: f => { const d = camera.position.clone().sub(controls.target); d.multiplyScalar(f); camera.position.copy(controls.target).add(d); } };
}
