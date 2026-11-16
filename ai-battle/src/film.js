import * as THREE from 'three';
import { Mascot } from './mascots.js';
import { buildVfx, Trail } from './vfx.js';
import { Aegis, Plate, Cage, Tube, buildScan, buildGlaives, Lotus, LensStack } from './constructs.js';
import { V, hdr, PAL, Track, E, clamp, lerp, smooth, remap, Spring1, R, rr, DEG, HEXW, hexCenter, mulberry } from './util.js';

const END = 38.25;
const TAU = Math.PI * 2;
const bump = (u) => (u <= 0 || u >= 1 ? 0 : Math.sin(Math.PI * u) * (1 - u) * 1.6);
const bez = (a, b, c, d, u, out = new THREE.Vector3()) => { const v = 1 - u; return out.set(0, 0, 0).addScaledVector(a, v * v * v).addScaledVector(b, 3 * v * v * u).addScaledVector(c, 3 * v * u * u).addScaledVector(d, u * u * u); };

export function createFilm({ scene, camera, arena, post, W, H }) {
  /* ================================================================ time warp */
  const slows = [[0.335, 0.43, 0.09, 0.012], [13.05, 13.26, 0.15, 0.02], [21.55, 22.0, 0.17, 0.03], [25.74, 25.81, 0.15, 0.01], [34.4, 34.5, 0.12, 0.012]];
  const hitstops = [[3.55, 3], [5.26, 3], [13.275, 5], [18.8, 4], [24.05, 5], [25.83, 5], [10.55, 2], [23.18, 3]].sort((a, b) => a[0] - b[0]);
  const speedAt = (s) => { let v = 1; for (const [a, b, sp, r] of slows) { const k = smooth((s - a + r) / r) * (1 - smooth((s - b) / r)); v = Math.min(v, lerp(1, sp, k)); } return v; };
  const ST = [0]; { let s = 0, hi = 0; while (s < END) { let ns = s + speedAt(s) / 60; if (hi < hitstops.length && ns >= hitstops[hi][0]) { const [hs, n] = hitstops[hi++]; ST.push(hs); for (let j = 1; j <= n; j++) ST.push(hs + j * 2e-4); s = hs + n * 2e-4; continue; } ST.push(ns); s = ns; } }
  const totalFrames = ST.length;
  const s2T = (s) => { let lo = 0, hi = ST.length - 1; while (hi - lo > 1) { const m = (lo + hi) >> 1; if (ST[m] <= s) lo = m; else hi = m; } const d = ST[hi] - ST[lo]; return (lo + (d > 0 ? clamp((s - ST[lo]) / d) : 0)) / 60; };

  /* ================================================================ scene content */
  const key = new THREE.DirectionalLight(0xfff4e8, 0.9); key.position.set(2, 9, 8); scene.add(key);
  const hemi = new THREE.HemisphereLight(0x8fa8d8, 0x20140c, 0.22); scene.add(hemi);
  const rimW = new THREE.DirectionalLight(0xffb070, 0.7); rimW.position.set(-8, 4, -6); scene.add(rimW);
  const rimC = new THREE.DirectionalLight(0x70d8ff, 0.7); rimC.position.set(8, 4, -6); scene.add(rimC);

  const fx = buildVfx(scene, arena, camera);
  const cl = new Mascot('claude', scene), cx = new Mascot('codex', scene);
  const GOLD = hdr(1.9, 0.95, 0.28), CYAN = hdr(0.35, 1.5, 2.1), WHITE = hdr(2.2, 2.2, 2.2), ICE = hdr(1.2, 1.9, 2.3), COPPER = hdr(1.8, 0.6, 0.2);
  const ghosts = { cl: [], cx: [], plan: [] };
  for (let i = 0; i < 6; i++) { ghosts.cl.push({ m: new Mascot('claude', scene, { ghost: true, ghostColor: hdr(1.5, 0.75, 0.22) }), t: 9, snap: null }); ghosts.cx.push({ m: new Mascot('codex', scene, { ghost: true, ghostColor: hdr(0.25, 1.1, 1.6) }), t: 9, snap: null }); }
  for (let i = 0; i < 3; i++) ghosts.plan.push(new Mascot('claude', scene, { ghost: true, ghostColor: hdr(1.9, 1.05, 0.3) }));
  [...ghosts.cl, ...ghosts.cx].forEach((g) => g.m.hide()); ghosts.plan.forEach((g) => g.hide());
  const trails = { clR: new Trail(scene, hdr(1.6, 0.75, 0.2), { life: 0.1 }), cxR: new Trail(scene, hdr(0.3, 1.2, 1.7), { life: 0.08 }), cxL: new Trail(scene, hdr(0.3, 1.2, 1.7), { life: 0.08 }),
    scarf: new Trail(scene, hdr(0.9, 0.36, 0.12), { life: 0.45, n: 60 }), jet: new Trail(scene, hdr(0.12, 0.6, 0.85), { life: 0.3, n: 50 }) };
  const aegis = new Aegis(scene), shield = new Plate(scene, hdr(1.8, 0.95, 0.3), 2, 1.9), mirror = new Plate(scene, hdr(2.0, 1.2, 0.45), 2, 2.1);
  const cage = new Cage(scene, 1.45), scan = buildScan(scene), glaives = buildGlaives(scene, 7, Trail), lotus = new Lotus(scene), lens = new LensStack(scene);
  const whip = new Tube(scene, hdr(1.9, 0.9, 0.26), { n: 40, m: 6, radius: 0.035 });
  const paths = [0, 1, 2].map(() => new Tube(scene, hdr(1.7, 0.95, 0.3), { n: 70, m: 5, radius: 0.028, dashed: true }));
  // debris chunk (pillar piece hurled by the whip) + its halves
  const chunkGeo = new THREE.CylinderGeometry(HEXW / Math.sqrt(3) * 0.97, HEXW / Math.sqrt(3) * 0.97, 1.5, 6);
  const chunkMat = arena.pillars[0].mat.clone(); chunkMat.uniforms.uH.value = 1.5; chunkMat.uniforms.uHeat.value = 0.6;
  const chunk = new THREE.Mesh(chunkGeo, chunkMat); chunk.visible = false; scene.add(chunk);
  const halves = [0, 1].map((i) => { const g = new THREE.CylinderGeometry(HEXW / Math.sqrt(3) * 0.97, HEXW / Math.sqrt(3) * 0.97, 1.5, 6, 1, false, i * Math.PI, Math.PI); const hm = chunkMat.clone(); hm.side = THREE.DoubleSide; hm.uniforms.uH.value = 1.5; hm.uniforms.uHeat.value = 1.0; const m = new THREE.Mesh(g, hm); m.visible = false; scene.add(m); return m; });

  /* ================================================================ choreography data */
  const P = Math.PI;
  const clPos = new Track([
    [0, [-5.5, 0.9, 0.5]], [0.34, [-0.78, 1.0, 0], 'lin'], [0.8, [-0.6, 0.8, 0], 'io2'], [1.25, [-0.82, 0.45, 0], 'io2'], [1.8, [-5, 0, 0.3], 'out3'], [4.3, [-5, 0, 0.3]],
    [4.48, [-2.4, 0, 0.6], 'out3'], [4.66, [-2.2, 0, 0.6]], [4.8, [-1.0, 0, 0.3], 'out3'], [4.98, [-0.9, 0, 0.2]], [5.14, [0.1, 0, -0.8], 'out3'], [5.27, [0.1, 0, -0.8]], [5.8, [-3.6, 0, 0], 'out3'], [13.275, [-3.6, 0, 0]],
    [13.5, [-6.3, 1.5, 0.5], 'out2'], [13.9, [-9.0, 0, 1.0], 'in2'], [14.45, [-10.2, 0, 1.1], 'out3'], [16.22, [-10.2, 0, 1.1]],
    [16.45, [-7, 0, -2], 'out3'], [16.52, [-7, 0, -2]], [16.75, [-4, 0, 1.5], 'out3'], [16.85, [-4, 0, 1.5]],
    [17.05, [-2.8, 2.2, 0], 'out2'], [17.25, [-1.5, 0, -1.5], 'in2'], [17.3, [-1.5, 0, -1.5]], [17.5, [-4.5, 0, -4], 'out3'], [17.55, [-4.5, 0, -4]],
    [18.0, [-5.6, 0, -3.0], 'out2'], [18.02, [-5.6, 0, -3]], [18.2, [-6.5, 0, 0.5], 'out3'], [18.3, [-6.5, 0, 0.5]], [18.5, [-6.5, 3.3, 0.5], 'out2'], [18.75, [-6.3, 4.6, 0.7], 'out2'], [18.82, [-6.3, 4.6, 0.7]],
    [19.3, [-5, 0, 2], 'in2'], [19.45, [-4.6, 0.5, 2.15], 'out2'], [19.62, [-4.2, 0, 2.3], 'in2'], [22.0, [-4.2, 0, 2.3]],
    [22.15, [-4.6, 3.0, 2.0], 'out3'], [22.3, [-2.0, 3.25, 0.4], 'io2'], [22.42, [-2.0, 3.8, 0.4], 'out2'], [22.9, [0.0, 4.5, 0.6], 'out2'], [23.15, [0.5, 3.4, 0.8], 'io2'], [23.38, [0.2, 0, 0.8], 'in2'], [23.5, [0.2, 0, 0.8]],
    [23.85, [2.0, 2.4, 0.7], 'out2'], [24.05, [2.2, 0.25, 0.65], 'in3'], [24.2, [2.0, 0, 0.7], 'out2'], [24.3, [2.0, 0, 0.7]], [24.62, [0.5, 0, 0.5], 'io2'], [25.45, [0.5, 0, 0.5]],
    [25.8, [6.6, 0.25, 0.3], 'in2'], [26.0, [7.0, 0, 0.3], 'out3'], [26.6, [7.0, 0, 0.3]], [27.4, [2.0, 0, 0], 'io3'], [27.74, [2.0, 0, 0]], [27.9, [1.6, 0, -0.4], 'out3'],
    [28.42, [1.6, 0, -0.4]], [28.56, [-0.6, 0, -1.2], 'out3'], [28.75, [-0.6, 0, -1.2]], [29.5, [-7.5, 1.6, 0], 'io3'], [33.9, [-7.5, 1.6, 0]], [34.4, [-8.6, 1.5, 0], 'in2'],
    [34.42, [-8.6, 1.5, 0]], [34.9, [-8.4, 0, 0.5], 'out2'], [36.9, [-8.4, 0, 0.5]], [37.3, [-0.75, 1.0, 0], 'in2'], [39, [-0.75, 1, 0]],
  ]);
  const cxPos = new Track([
    [0, [5.5, 1.3, -0.5]], [0.34, [0.78, 1.0, 0], 'lin'], [0.8, [0.6, 0.8, 0], 'io2'], [1.25, [0.82, 0.45, 0], 'io2'], [1.75, [5, 0, -0.3], 'out3'], [2.7, [5, 0, -0.3]],
    [2.86, [-3.9, 0, 1.2], 'out3'], [2.98, [-3.9, 0, 1.2]], [3.12, [-6.3, 0, -0.8], 'out3'], [3.24, [-6.3, 0, -0.8]], [3.42, [-5.2, 3.0, 0.5], 'out2'], [3.55, [-4.75, 1.45, 0.45], 'in2'], [3.82, [-4.75, 1.4, 0.45]],
    [4.02, [-2.6, 2.6, 0.7], 'out2'], [4.25, [-1.0, 0, 0.8], 'in2'], [4.42, [-1.0, 0, 0.8]], [4.58, [0.2, 0, 0.5], 'out3'], [4.74, [0.2, 0, 0.5]], [4.84, [0.9, 0, -1.3], 'out3'], [5.3, [1.0, 0, -1.2]],
    [6.0, [2.5, 0, 0], 'io3'], [6.2, [2.5, 0, 0]], [6.8, [4.5, 0, 0], 'io3'], [9.47, [4.5, 0, 0]], [9.55, [4.5, 0, 1.6], 'out3'], [9.6, [4.5, 0, 1.6]], [9.67, [5.6, 0, -0.6], 'out3'], [10.06, [5.6, 0, -0.6]], [10.3, [7, 0, -0.4], 'out3'], [10.45, [7, 0, -0.4]],
    [10.64, [7, 3.2, -0.4], 'out2'], [10.95, [6.4, 0, 0], 'in2'], [13.0, [6.4, 0, 0]], [13.2, [-2.5, 0.35, 0], 'lin'], [13.3, [-2.3, 0.2, 0], 'out2'], [13.6, [-1.8, 0, 0], 'out2'], [15.0, [-1.8, 0, 0]],
    [15.7, [3.5, 2.6, 0], 'io3'], [19.9, [3.5, 2.6, 0]], [20.7, [1.0, 1.2, 1.0], 'io3'], [23.18, [1.0, 1.2, 1.0]], [23.5, [2.8, 0, 0.6], 'in2'], [24.05, [2.8, 0, 0.6]], [24.7, [8.0, 0, 0.3], 'out3'], [25.83, [8.0, 0, 0.3]],
    [26.05, [9.6, 1.4, -0.1], 'out2'], [26.3, [10.8, 0, -0.4], 'in2'], [26.6, [11.5, 0, -0.5], 'out3'], [27.7, [11.5, 0, -0.5]],
    [27.77, [-1.5, 0, 1.2], 'lin'], [27.92, [-1.5, 0, 1.2]], [27.99, [4.5, 0, -3.5], 'lin'], [28.14, [4.5, 0, -3.5]], [28.21, [-1.0, 0, 4.0], 'lin'], [28.36, [-1.0, 0, 4.0]], [28.43, [2.8, 0, -5.0], 'lin'], [28.58, [2.8, 0, -5.0]],
    [28.62, [1.6, 0.2, -0.4], 'lin'], [29.38, [1.6, 0.2, -0.4]], [30.0, [7.5, 1.6, 0], 'io3'], [33.9, [7.5, 1.6, 0]], [34.4, [8.6, 1.5, 0], 'in2'], [34.9, [8.4, 0, -0.5], 'out2'], [36.9, [8.4, 0, -0.5]], [37.3, [0.75, 1.0, 0], 'in2'], [39, [0.75, 1, 0]],
  ]);
  const clTumble = new Track([[0, 0], [13.275, 0], [13.9, -TAU, 'out2'], [13.901, 0, 'step'], [17.0, 0], [17.25, TAU, 'io2'], [17.251, 0, 'step'], [18.3, 0], [19.3, -TAU * 2, 'lin'], [19.301, 0, 'step'], [22.0, 0], [22.17, -TAU, 'out2'], [22.171, 0, 'step'], [22.45, 0], [22.9, TAU, 'io2'], [22.901, 0, 'step'], [23.55, 0], [24.02, TAU, 'in2'], [24.021, 0, 'step'], [34.42, 0], [34.9, -TAU, 'out2'], [34.901, 0, 'step']]);
  const cxTumble = new Track([[0, 0], [3.82, 0], [4.22, -TAU, 'io2'], [4.221, 0, 'step'], [25.83, 0], [26.3, -TAU, 'out2'], [26.301, 0, 'step'], [34.42, 0], [34.9, -TAU, 'out2'], [34.901, 0, 'step']]);
  const clSpin = new Track([[0, 0], [4.36, 0], [4.6, -TAU, 'io2'], [4.601, 0, 'step'], [25.02, 0], [25.42, -TAU, 'io2'], [25.421, 0, 'step']]);
  const cxSpin = new Track([[0, 0], [10.47, 0], [10.9, TAU, 'io2'], [10.901, 0, 'step'], [29.2, 0], [29.38, TAU * 2, 'io2'], [29.381, 0, 'step']]);
  const clFlare = new Track([[0, 0.3], [0.34, 0.9], [1.3, 0.2], [6.2, 0.1], [6.9, 0.9], [8.1, 0.6], [8.9, 1.0], [10.6, 0.3], [12.5, 0.1], [17.5, 0.1], [17.55, 0.8], [18.0, 0.2], [19, 0], [21.4, 0], [21.6, 1.0], [23.3, 0.8], [24.1, 0.4], [26, 0.2], [28.3, 0.2], [28.45, 0.9], [29.4, 0.6], [31.4, 1.0], [34.4, 1.0], [34.5, 0], [36.5, 0], [36.9, 0.8]]);
  const cxFlare = new Track([[0, 0.3], [0.34, 0.9], [1.3, 0.2], [2.6, 0.2], [2.7, 0.8], [3.6, 0.3], [11.0, 0.2], [11.4, 0.8], [13.0, 1.0], [13.4, 0.2], [15.3, 0.2], [15.7, 1.0], [23.18, 1.0], [23.2, 0], [26.6, 0], [27.3, 1.0], [29.4, 0.7], [31.4, 1.0], [34.4, 1.0], [34.5, 0], [36.5, 0], [36.9, 0.8]]);
  const cxHaloSpin = new Track([[0, 0], [26.6, 0], [27.6, 14, 'in2'], [29.4, 40, 'lin'], [34.4, 160, 'lin'], [36, 165, 'out2']]);
  const clHaloSpin = new Track([[0, 0], [8.1, 0], [9.0, 5, 'io2'], [29.4, 5], [31.4, 12, 'in2'], [34.4, 60, 'lin'], [36, 62, 'out2']]);
  const clLean = new Track([[0, 0], [13.9, 0], [14.0, 0.5, 'out2'], [14.4, 0.45], [14.7, 0, 'io2'], [19.3, 0], [19.4, 0.25, 'out2'], [19.62, 0.6, 'io2'], [20.4, 0.55], [20.9, 0.12, 'io2'], [21.5, 0, 'io2'], [34.9, 0], [35.0, 0.6, 'out2'], [35.3, 0.55], [35.7, 0, 'io2']]);
  const cxLean = new Track([[0, 0], [26.3, 0], [26.4, 0.55, 'out2'], [26.7, 0.5], [27.0, 0, 'io2'], [34.9, 0], [35.0, 0.6, 'out2'], [35.4, 0.55], [35.8, 0, 'io2']]);
  const squashes = { cl: [[1.85, 0.12], [3.58, 0.3], [13.92, 0.3], [17.27, 0.18], [19.32, 0.4], [19.64, 0.15], [23.4, 0.22], [24.07, 0.25], [34.92, 0.3], [-36.82, 0.16]], cx: [[1.8, 0.12], [-2.64, 0.16], [4.27, 0.2], [10.97, 0.22], [-13.0, 0.14], [23.52, 0.3], [24.07, 0.35], [26.32, 0.3], [-27.66, 0.2], [34.92, 0.3], [-36.82, 0.16]] };
  const squashAt = (list, s) => { let v = 0; for (const [t, a] of list) v -= t < 0 ? a * bump(1 - (-t - s) / 0.2) * 0.6 : a * bump((s - t) / 0.32); return v; };
  const moods = { cl: [[0, 'fierce'], [1.3, 'focus'], [5.27, 'hurt'], [5.9, 'calm'], [6.4, 'focus'], [10.7, 'calm'], [12.15, 'wide'], [13.275, 'hurt'], [14.5, 'focus'], [18.8, 'hurt'], [19.4, 'closed'], [20.5, 'hurt'], [21.3, 'closed'], [21.52, 'focus'], [22.0, 'fierce'], [24.2, 'focus'], [26.1, 'calm'], [27.75, 'hurt'], [28.15, 'focus'], [29.5, 'fierce'], [34.42, 'closed'], [35.3, 'hurt'], [35.9, 'calm'], [36.6, 'fierce']],
    cx: [[0, 'fierce'], [1.3, 'focus'], [3.8, 'neutral'], [5.2, 'focus'], [6.0, 'neutral'], [10.06, 'hurt'], [10.4, 'focus'], [11.0, 'line'], [13.0, 'fierce'], [13.6, 'calm'], [15.3, 'focus'], [20.0, 'calm'], [22.6, 'wide'], [23.18, 'hurt'], [24.4, 'focus'], [25.3, 'line'], [25.83, 'hurt'], [26.9, 'line'], [28.62, 'wide'], [28.8, 'line'], [29.4, 'fierce'], [34.42, 'closed'], [35.4, 'hurt'], [35.9, 'calm'], [36.6, 'fierce']] };
  const moodAt = (list, s) => { let m = list[0][1]; for (const [t, n] of list) { if (t <= s) m = n; else break; } return m; };
  const faceMove = { cl: [[16.22, 18.2], [22.0, 23.3]], cx: [] };
  const nods = { cx: new Track([[0, 0], [36.0, 0], [36.15, 0.3, 'io2'], [36.35, 0, 'io2']]), cl: new Track([[0, 0], [36.2, 0], [36.4, 0.22, 'io2'], [36.8, 0, 'io2']]) };

  /* ---------------------------------------------------------------- hand clips */
  const POSE = {
    guard: (k) => (k === 'claude' ? { R: [0.42, 0.72, 0.45], bR: [-0.25, 0.9, 0.35], L: [-0.45, 0.62, 0.1], bL: [0, 0.3, 1] } : { R: [0.45, 0.7, 0.35], bR: [0.15, 0.35, 1], L: [-0.45, 0.7, 0.35], bL: [-0.15, 0.35, 1] }),
    press: () => ({ R: [0.2, 0.92, 0.5], bR: [-0.5, 0.62, 0.6], L: [-0.26, 0.8, 0.45], bL: [0, 0.3, 1] }),
    cross: () => ({ R: [0.22, 1.0, 0.62], bR: [-0.55, 0.75, 0.35], L: [-0.22, 1.0, 0.62], bL: [0.55, 0.75, 0.35] }),
    crossUp: () => ({ R: [0.25, 1.38, 0.4], bR: [-0.8, 0.5, 0.2], L: [-0.25, 1.38, 0.4], bL: [0.8, 0.5, 0.2] }),
    windup: () => ({ R: [0.65, 1.05, -0.45], bR: [0.5, 0.5, -0.7], L: [-0.65, 1.05, -0.45], bL: [-0.5, 0.5, -0.7] }),
    strikeDown: () => ({ R: [0.2, 0.6, 0.75], bR: [-0.2, -0.5, 0.85], L: [-0.2, 0.6, 0.75], bL: [0.2, -0.5, 0.85] }),
    block: () => ({ R: [0.38, 1.34, 0.42], bR: [-1, 0.1, 0.1], L: [-0.38, 1.3, 0.42], bL: [0, 0.3, 1] }),
    castL: () => ({ R: [0.5, 0.62, -0.05], bR: [0.3, 0.9, -0.2], L: [-0.2, 1.08, 0.78], bL: [0, 0.2, 1] }),
    castUp: () => ({ R: [0.62, 1.5, 0.15], bR: [0.2, 1, 0.1], L: [-0.62, 1.5, 0.15], bL: [-0.2, 1, 0.1] }),
    cast2: () => ({ R: [0.32, 0.92, 0.8], bR: [0.1, 0.3, 1], L: [-0.32, 0.92, 0.8], bL: [-0.1, 0.3, 1] }),
    pointR: () => ({ R: [0.2, 0.95, 0.95], bR: [0, 0.02, 1], L: [-0.5, 0.65, 0.0], bL: [-0.2, 0.3, 1] }),
    pointL: () => ({ L: [-0.2, 0.95, 0.95], bL: [0, 0.02, 1], R: [0.5, 0.65, 0.0], bR: [0.2, 0.3, 1] }),
    hit: () => ({ R: [0.75, 1.05, -0.45], bR: [0.6, 0.6, -0.5], L: [-0.75, 1.05, -0.45], bL: [-0.6, 0.6, -0.5] }),
    down: () => ({ R: [0.42, 0.22, 0.35], bR: [0.8, 0.25, 0.5], L: [-0.4, 0.3, 0.3], bL: [0, 0.3, 1] }),
    spread: () => ({ R: [0.92, 1.02, 0.1], bR: [0.7, -0.6, 0.3], L: [-0.92, 1.02, 0.1], bL: [-0.7, -0.6, 0.3] }),
    charge: () => ({ R: [0.0, 0.92, 0.78], bR: [0, 0.0, 1], L: [-0.24, 0.78, 0.45], bL: [0, 0.2, 1] }),
    hammerUp: () => ({ R: [0.2, 1.55, -0.25], bR: [0.1, 0.8, -0.6], L: [-0.2, 1.45, -0.2], bL: [0, 0.3, 1] }),
    hammerDown: () => ({ R: [0.15, 0.55, 0.85], bR: [0, -0.35, 0.95], L: [-0.2, 0.6, 0.7], bL: [0, 0.3, 1] }),
    thrust: (k, u) => { const e = E.outExpo(u); return { R: [lerp(0.42, 0.1, e), lerp(0.8, 0.9, e), lerp(-0.35, 1.18, e)], bR: [0, 0.04, 1], L: [-0.5, 0.7, lerp(0.1, -0.3, e)], bL: [0, 0.3, 1] }; },
    thrust2: (k, u) => { const e = E.outExpo(u); return { R: [0.18, 0.92, lerp(-0.3, 1.12, e)], bR: [0.04, 0.02, 1], L: [-0.18, 0.92, lerp(-0.3, 1.12, e)], bL: [-0.04, 0.02, 1] }; },
    swing: (k, u, c) => {
      const e = E.io4(u); const th = lerp(c.a0, c.a1, e) * DEG, ti = (c.tilt || 0) * DEG, r = c.r || 0.82, sx = c.hand === 'L' ? -1 : 1;
      const X = [Math.cos(ti) * sx, Math.sin(ti), 0]; const p = [X[0] * Math.sin(th) * r, 0.82 + X[1] * Math.sin(th) * r, Math.cos(th) * r * 0.9 + 0.05];
      const tg = [X[0] * Math.cos(th), X[1] * Math.cos(th), -Math.sin(th)]; const lag = -0.55 * Math.sin(u * P) * Math.sign(c.a1 - c.a0);
      const b = [p[0] + tg[0] * lag, p[1] - 0.82 + tg[1] * lag + 0.12, p[2] + tg[2] * lag];
      const o = POSE.guard(k); const other = sx > 0 ? { L: [-0.5, 0.7, -0.15 + 0.2 * Math.cos(th)], bL: o.bL } : { R: [0.5, 0.7, -0.15 + 0.2 * Math.cos(th)], bR: o.bR };
      return sx > 0 ? { R: p, bR: b, ...other, yawOff: (e - 0.5) * (c.a1 - c.a0) * DEG * 0.22 } : { L: p, bL: b, ...other, yawOff: -(e - 0.5) * (c.a1 - c.a0) * DEG * 0.22 };
    },
  };
  const clClips = [
    { s: -1, type: 'windup' }, { s: 0.14, d: 0.2, type: 'swing', a0: 140, a1: -15, tilt: 25, hold: 0.02 }, { s: 0.36, type: 'press' }, { s: 1.25, type: 'guard' },
    { s: 2.8, d: 0.09, type: 'swing', a0: 70, a1: -40, tilt: 15 }, { s: 3.06, d: 0.09, type: 'swing', a0: -70, a1: 60, tilt: -10 }, { s: 3.4, type: 'block' },
    { s: 3.8, d: 0.16, type: 'swing', a0: -40, a1: 120, tilt: 82 }, { s: 4.38, d: 0.2, type: 'swing', a0: 130, a1: -70, tilt: 10 }, { s: 4.74, d: 0.18, type: 'swing', a0: -120, a1: 80, tilt: -22 },
    { s: 5.0, d: 0.14, type: 'thrust', hold: 0.1 }, { s: 5.27, type: 'hit' }, { s: 5.85, type: 'guard' }, { s: 6.9, type: 'castL' }, { s: 8.1, type: 'castUp' }, { s: 8.92, d: 0.2, type: 'swing', a0: 120, a1: -25, tilt: 62, hold: 1.2 },
    { s: 10.4, type: 'guard' }, { s: 13.18, type: 'block' }, { s: 13.275, type: 'hit' }, { s: 13.9, type: 'down' }, { s: 14.5, type: 'guard' }, { s: 17.48, type: 'castL' }, { s: 18.02, type: 'guard' }, { s: 18.3, type: 'hit' }, { s: 19.3, type: 'down' }, { s: 20.6, type: 'guard' },
    { s: 21.5, type: 'castL' }, { s: 22.0, type: 'guard' }, { s: 22.52, type: 'castL' }, { s: 23.3, type: 'hammerUp' }, { s: 23.97, type: 'hammerDown' }, { s: 24.3, type: 'guard' },
    { s: 24.82, d: 0.16, type: 'swing', a0: 110, a1: -70, tilt: 20, hold: 0.1 }, { s: 25.05, type: 'castUp' }, { s: 25.36, d: 0.1, type: 'swing', a0: 120, a1: -30, tilt: 30, hold: 0.05 }, { s: 25.55, type: 'windup' }, { s: 25.76, d: 0.08, type: 'thrust', hold: 0.25 },
    { s: 26.2, type: 'guard' }, { s: 27.72, type: 'castL' }, { s: 27.76, type: 'hit' }, { s: 28.1, d: 0.08, type: 'swing', a0: 80, a1: -50, tilt: 20 }, { s: 28.32, d: 0.08, type: 'swing', a0: -60, a1: 70, tilt: -15 }, { s: 28.42, type: 'castL' },
    { s: 28.9, type: 'castUp' }, { s: 30.2, type: 'cast2' }, { s: 34.42, type: 'hit' }, { s: 34.9, type: 'down' }, { s: 35.5, type: 'guard' }, { s: 36.6, type: 'castUp' }, { s: 36.85, type: 'windup' }, { s: 37.16, d: 0.14, type: 'swing', a0: 140, a1: -15, tilt: 25 },
  ];
  const cxClips = [
    { s: -1, type: 'windup' }, { s: 0.2, type: 'cross' }, { s: 1.25, type: 'guard' }, { s: 2.6, type: 'windup' }, { s: 2.8, d: 0.08, type: 'swing', a0: 110, a1: -60, tilt: 10 }, { s: 3.06, d: 0.08, type: 'swing', a0: -110, a1: 60, tilt: 0, hand: 'L' },
    { s: 3.26, type: 'windup' }, { s: 3.48, type: 'strikeDown' }, { s: 3.84, type: 'guard' }, { s: 5.08, d: 0.07, type: 'swing', a0: -70, a1: 50, tilt: 20, hand: 'L' }, { s: 5.2, d: 0.07, type: 'thrust', hold: 0.2 }, { s: 5.6, type: 'guard' },
    { s: 7.2, type: 'pointR' }, { s: 7.36, type: 'pointL' }, { s: 7.51, type: 'pointR' }, { s: 7.66, type: 'pointL' }, { s: 7.81, type: 'pointR' }, { s: 8.1, type: 'guard' },
    { s: 9.74, d: 0.07, type: 'swing', a0: 100, a1: -60, tilt: 30 }, { s: 9.86, d: 0.07, type: 'swing', a0: -100, a1: 60, tilt: 25, hand: 'L' }, { s: 10.06, type: 'hit' }, { s: 10.4, type: 'guard' }, { s: 11.4, type: 'castL' },
    { s: 12.7, type: 'pointR' }, { s: 12.83, type: 'pointL' }, { s: 12.95, type: 'pointR' }, { s: 13.02, type: 'windup' }, { s: 13.2, d: 0.07, type: 'thrust2', hold: 0.3 }, { s: 13.7, type: 'guard' },
    { s: 15.45, type: 'spread' }, { s: 20.2, type: 'pointR' }, { s: 22.6, type: 'spread' }, { s: 23.18, type: 'hit' }, { s: 23.6, type: 'guard' }, { s: 23.95, type: 'crossUp' }, { s: 24.1, type: 'hit' }, { s: 24.7, type: 'guard' },
    { s: 25.5, type: 'hammerUp' }, { s: 25.71, d: 0.06, type: 'swing', a0: 120, a1: -50, tilt: 88, hold: 0.06 }, { s: 25.83, type: 'hit' }, { s: 26.3, type: 'down' }, { s: 26.9, type: 'guard' }, { s: 27.2, type: 'charge' },
    { s: 27.71, d: 0.05, type: 'swing', a0: 100, a1: -70, tilt: 5 }, { s: 27.93, d: 0.05, type: 'swing', a0: -100, a1: 70, tilt: 10 }, { s: 28.15, d: 0.05, type: 'swing', a0: 100, a1: -70, tilt: -5 }, { s: 28.37, d: 0.05, type: 'swing', a0: -100, a1: 70, tilt: 8 }, { s: 28.58, d: 0.04, type: 'thrust', hold: 0.1 },
    { s: 28.66, type: 'guard' }, { s: 29.12, type: 'windup' }, { s: 29.22, d: 0.16, type: 'swing', a0: 160, a1: -200, tilt: 8, hold: 0.1 }, { s: 29.6, type: 'charge' }, { s: 34.42, type: 'hit' }, { s: 34.9, type: 'down' }, { s: 35.6, type: 'guard' }, { s: 36.6, type: 'charge' }, { s: 36.9, type: 'windup' }, { s: 37.18, d: 0.12, type: 'thrust2' },
  ];
  const clipPose = (kind, clips, s) => {
    let c = clips[0]; for (const k of clips) { if (k.s <= s) c = k; else break; }
    let type = c.type, u = c.d ? clamp((s - c.s) / c.d) : 1;
    if (c.d && s > c.s + c.d + (c.hold ?? 0.14)) type = 'guard';
    const p = POSE[type](kind, u, c), g = POSE.guard(kind);
    return { R: p.R || g.R, L: p.L || g.L, bR: p.bR || g.bR, bL: p.bL || g.bL, yawOff: p.yawOff || 0 };
  };

  /* ================================================================ events */
  const events = [], cuesOut = [], durs = [];
  const at = (s, fn) => events.push({ s, fn });
  const cue = (s, name, o = {}) => cuesOut.push({ s, name, ...o });
  const during = (s0, s1, fn) => durs.push({ s0, s1, fn });
  const mid = (a, b, k = 0.5) => a.clone().lerp(b, k);
  const wtip = (m, side = 'R') => m.weaponPoint(side, 'tip');
  let ctx = { s: 0, ds: 0, T: 0 };

  /* ---- generic helpers */
  const weaponBurst = (m, side, col) => { const p = wtip(m, side), b = m.weaponPoint(side, 'base'); for (let i = 0; i < 6; i++) fx.sparks(mid(b, p, i / 5), 8, { col, speed: 4, life: 0.5, size: 0.025, grav: 2 }); fx.flash(mid(b, p), { col, size: 1.6, life: 0.25 }); };
  const hitChar = (m, pos, col, power = 1) => { m.hit = 1; fx.impact(pos, col, power); fx.shards(pos, Math.round(8 * power), { col: WHITE, speed: 7, size: 0.07, life: 0.7 }); };

  /* ---------------------------------------------------------------- A: cold open */
  cue(0, 'whoosh_in', { x: 0 });
  at(0.34, () => { const p = V(0, 1.72, 0.1); fx.impact(p, WHITE, 2.0); fx.impact(p, GOLD, 1.3, { floor: false }); fx.sparks(p, 60, { col: CYAN, speed: 16, life: 0.7 }); fx.ring(p, { col: WHITE, r0: 0.3, r1: 7, life: 0.6, width: 0.07 }); fx.floorRing(0, 0, { col: hdr(1.2, 1.2, 1.4), speed: 24, life: 1.0, k: 1.6 }); fx.punch(0.07); });
  cue(0.34, 'clash_big', { x: 0 }); cue(0.345, 'slowmo_in', {}); cue(0.43, 'slowmo_out', {});
  during(0.36, 1.25, (u, s, ds) => { const p = mid(wtip(cl), wtip(cx)); p.lerp(V(0, cl.pos.y + 0.85, 0.05), 0.6); if (ds > 0) { fx.sparks(p, 3, { col: R() > 0.5 ? GOLD : CYAN, speed: 9, life: 0.4, size: 0.022, dir: V(0, 0.4, R() - 0.5), spread: 1.4 }); } arena.pushLight(p, WHITE, 2.2, 0.6 + 0.4 * Math.sin(s * 70)); fx.glow(p, hdr(2, 1.9, 1.7), 0.55 + 0.12 * Math.sin(s * 90), 0.7); fx.shake(0.012); });
  cue(0.5, 'grind', { x: 0, dur: 0.75 });
  at(1.25, () => { const p = V(0, 1.2, 0); fx.impact(p, WHITE, 1.2); }); cue(1.25, 'clash', { x: 0 }); cue(1.3, 'slide', { x: -0.4 }); cue(1.3, 'slide', { x: 0.4 });
  during(1.3, 1.8, (u, s, ds) => { if (ds > 0 && u < 0.8) { fx.sparks(V(cl.pos.x, 0.05, cl.pos.z), 2, { col: GOLD, speed: 3, life: 0.3, dir: V(1, 0.5, 0), spread: 0.6, size: 0.02 }); fx.sparks(V(cx.pos.x, 0.05, cx.pos.z), 2, { col: CYAN, speed: 3, life: 0.3, dir: V(-1, 0.5, 0), spread: 0.6, size: 0.02 }); } });

  /* ---------------------------------------------------------------- B: speed vs flow */
  const parry = (s, power, x) => { at(s, () => { const p = mid(wtip(cl), cx.chestWorld(), 0.45); fx.impact(p, WHITE, power); fx.sparks(p, 20, { col: CYAN, speed: 10, life: 0.4 }); }); cue(s, 'clash', { x, p: power }); };
  cue(2.7, 'dash', { x: 0.3 }); parry(2.86, 0.8, -0.4); cue(2.98, 'dash', { x: -0.4 }); parry(3.12, 0.8, -0.6); cue(3.26, 'dash', { x: -0.5 });
  at(3.55, () => { const p = cl.headWorld().add(V(0.15, 0.75, 0)); fx.impact(p, WHITE, 1.5); fx.sparks(p, 40, { col: CYAN, speed: 12 }); fx.floorRing(cl.pos.x, cl.pos.z, { col: ICE, speed: 16, life: 0.8, k: 1.3 }); fx.sparks(V(cl.pos.x, 0.05, cl.pos.z), 40, { col: hdr(0.8, 0.9, 1.1), speed: 6, flat: 0.15, life: 0.5, size: 0.02 }); });
  cue(3.55, 'clash_big', { x: -0.5 });
  during(3.56, 3.82, (u, s, ds) => { const p = cl.headWorld().add(V(0.15, 0.75, 0)); if (ds > 0) fx.sparks(p, 2, { col: R() > 0.5 ? GOLD : CYAN, speed: 7, life: 0.3, size: 0.02 }); arena.pushLight(p, WHITE, 2, 0.7); });
  at(3.86, () => { fx.impact(cx.chestWorld().add(V(0, -0.3, 0)), GOLD, 0.9); }); cue(3.8, 'swing_c', { x: -0.5 }); cue(3.86, 'clash', { x: -0.5, p: 0.7 }); cue(4.26, 'land', { x: -0.1 });
  cue(4.4, 'swing_c', { x: -0.3 }); cue(4.5, 'dodge', { x: 0 }); cue(4.76, 'swing_c', { x: -0.1 }); cue(4.78, 'dash', { x: 0.1 }); cue(5.02, 'swing_c', { x: 0 });
  at(5.13, () => { fx.impact(mid(wtip(cl), wtip(cx, 'L')), WHITE, 0.7); }); cue(5.13, 'clash', { x: 0.05, p: 0.6 });
  at(5.26, () => hitChar(cl, cl.chestWorld().add(V(0.3, 0.1, 0)), CYAN, 1.3)); cue(5.26, 'hit', { x: 0 }); cue(5.3, 'slide', { x: -0.2 });
  cue(6.3, 'halo', { x: -0.35 });

  /* ---------------------------------------------------------------- C: design */
  at(6.95, () => { aegis.alive = true; aegis.t0 = 6.95; aegis.scan = 0; aegis.crack = 0; aegis.scanX = 99; aegis.place(-1.4, 0, cl.hands.L.position); fx.flash(cl.hands.L.position, { col: GOLD, size: 1.6 }); });
  cue(6.95, 'build', { x: -0.2, n: 15, dur: 0.9 });
  [[7.27, 'R', 1.9, 0.5], [7.43, 'L', 1.2, -0.7], [7.58, 'R', 2.6, -0.2], [7.73, 'L', 0.8, 0.9], [7.88, 'R', 1.6, 0.0]].forEach(([s, side, y, z]) => {
    at(s, () => { const a = wtip(cx, side), b = V(-1.42 - Math.abs(z) * 0.12, y, z); fx.flash(a, { col: ICE, size: 0.9, life: 0.1 }); fx.bolt(a, b, { speed: 75, onHit: (p) => { aegis.hit(p, 1); fx.flash(p, { col: GOLD, size: 1.4 }); fx.ring(p, { col: GOLD, r0: 0.1, r1: 1.1, life: 0.3, normal: V(1, 0, 0) }); fx.sparks(p, 16, { col: ICE, speed: 8, dir: V(1, 0.2, 0), spread: 0.8, life: 0.4 }); fx.light(p, GOLD, 2, 0.25); } }); });
    cue(s, 'bolt', { x: 0.45 }); cue(s + 0.085, 'shield_hit', { x: -0.15 });
  });
  // glaive fan
  const GL = [
    { i: 3, launch: 9.0, arrive: 9.55, target: V(4.5, 0.2, 0), out: 'stick', lat: 0 }, { i: 2, launch: 9.1, arrive: 9.66, target: V(4.5, 0.2, 1.6), out: 'stick', lat: 0.8 },
    { i: 4, launch: 9.22, arrive: 9.80, target: V(4.95, 0.95, -0.5), out: 'cut', lat: -0.8 }, { i: 1, launch: 9.34, arrive: 9.92, target: V(4.95, 1.0, -0.75), out: 'cut', lat: 1.2 },
    { i: 5, launch: 9.48, arrive: 10.06, target: V(5.6, 1.05, -0.5), out: 'graze', lat: -1.2 }, { i: 0, launch: 9.75, arrive: 10.55, target: V(7.0, 0.9, -0.4), out: 'collide', lat: -7 }, { i: 6, launch: 9.75, arrive: 10.55, target: V(7.0, 0.9, -0.4), out: 'collide', lat: 7 },
  ];
  GL.forEach((g) => { const a = (g.i - 3) * 20 * DEG; g.home = V(-3.95, 2.0 + 1.45 * Math.cos(a), 2.5 * Math.sin(a)); g.appear = 8.15 + g.i * 0.085;
    g.c1 = g.home.clone().add(V(2.0, g.out === 'collide' ? 1.0 : 2.8, g.lat * 0.9)); g.c2 = g.target.clone().add(g.out === 'collide' ? V(-0.5, 0.3, g.lat) : V(-3.0, 1.6, g.lat * 0.4));
    at(g.appear, () => { fx.flash(g.home, { col: GOLD, size: 1.0, life: 0.2 }); fx.sparks(g.home, 10, { col: GOLD, speed: 3, life: 0.5, grav: 1 }); }); cue(g.appear, 'chime', { x: -0.4, n: g.i });
    cue(g.launch, 'glaive', { x: -0.3 });
    at(g.arrive, () => { const p = g.target;
      if (g.out === 'stick') { fx.impact(V(p.x, 0.1, p.z), GOLD, 0.7); fx.sparks(V(p.x, 0.1, p.z), 20, { col: GOLD, speed: 6, flat: 0.5 }); }
      if (g.out === 'cut') { fx.impact(p, WHITE, 0.8); fx.shards(p, 10, { col: GOLD, speed: 9, dir: V(1, 0.2, 0), spread: 0.9, size: 0.12, life: 0.9 }); fx.sparks(p, 24, { col: GOLD, speed: 12, dir: V(1, 0, 0), spread: 0.9 }); }
      if (g.out === 'graze') { hitChar(cx, cx.chestWorld().add(V(-0.25, 0.25, 0)), GOLD, 0.9); }
      if (g.out === 'collide' && g.i === 0) { fx.impact(p, GOLD, 1.7); fx.shards(p, 26, { col: GOLD, speed: 10, size: 0.14, life: 1.2 }); fx.ring(p, { col: GOLD, r0: 0.2, r1: 4, life: 0.5, floor: true }); }
    });
    cue(g.arrive, g.out === 'stick' ? 'glaive_stick' : g.out === 'cut' ? 'cut' : g.out === 'graze' ? 'hit_small' : 'clash_gold', { x: 0.5 });
  });
  cue(8.1, 'halo', { x: -0.4 }); cue(8.95, 'swing_c', { x: -0.4 }); cue(9.47, 'dash', { x: 0.45 }); cue(9.6, 'dash', { x: 0.5 }); cue(9.74, 'swing_x', { x: 0.5 }); cue(9.86, 'swing_x', { x: 0.5 }); cue(10.46, 'jump', { x: 0.6 }); cue(10.96, 'land', { x: 0.6 });
  during(8.15, 11.4, (u, s) => {
    for (const g of GL) { const G = glaives[g.i]; let vis = s >= g.appear, p = new THREE.Vector3(), dir = V(0, 1, 0), sc = 1;
      if (s < g.launch) { p.copy(g.home); p.y += Math.sin(s * 3 + g.i) * 0.06; sc = E.outBack(clamp((s - g.appear) / 0.25)); const aim = smooth((s - (g.launch - 0.22)) / 0.2); dir.set(aim * 0.9, 1 - aim * 0.4, 0).normalize(); }
      else if (s <= g.arrive) { const uu = E.in2(clamp((s - g.launch) / (g.arrive - g.launch))) * 0.55 + clamp((s - g.launch) / (g.arrive - g.launch)) * 0.45; bez(g.home, g.c1, g.c2, g.target, uu, p); const p2 = bez(g.home, g.c1, g.c2, g.target, Math.min(1, uu + 0.02)); dir.copy(p2).sub(p).normalize(); if (uu > 0.98) dir.copy(g.target).sub(g.c2).normalize(); }
      else if (g.out === 'stick') { p.copy(g.target); dir.copy(g.target).sub(g.c2).normalize(); sc = 1 - smooth((s - g.arrive - 0.5) / 0.5); p.addScaledVector(dir, -0.1); }
      else if (g.out === 'graze') { dir.copy(g.target).sub(g.c2).normalize(); p.copy(g.target).addScaledVector(dir, (s - g.arrive) * 24); sc = 1 - smooth((s - g.arrive) / 0.35); }
      else vis = false;
      if (sc < 0.01) vis = false; G.m.visible = vis;
      if (vis) { G.m.position.copy(p); G.m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir); G.m.scale.set(0.085 * sc, 0.62 * sc, 0.03 * sc); arena.pushLight(p, GOLD, 1.2, 0.5);
        if (s >= g.launch && s <= g.arrive + 0.05) G.trail.push(p.clone().addScaledVector(dir, -0.5), p.clone().addScaledVector(dir, 0.5), s); }
      G.trail.update(s);
    }
  });
  at(11.41, () => glaives.forEach((G) => { G.m.visible = false; G.trail.clear(); G.trail.update(99); }));

  /* ---------------------------------------------------------------- D: critique */
  cue(11.0, 'analyze', { x: 0.5 }); cue(11.45, 'scan', { x: 0.2, dur: 0.95 });
  during(11.45, 12.45, (u, s) => { const x = lerp(5.4, -5.5, u); scan.setPlane(x, 2.3, 0, Math.sin(u * P) * 1.3 + 0.2, s); aegis.scanX = x; aegis.scan = 1; arena.pushLight(V(x, 0.2, 0), CYAN, 3, 0.7); });
  at(12.46, () => scan.setPlane(0, -10, 0, 0, 0));
  [12.12, 12.27, 12.42].forEach((s, i) => { at(s, () => scan.lock(i, aegis.jointWorld(i), s)); cue(s, 'lock', { x: -0.1, n: i }); });
  [[12.75, 'R'], [12.87, 'L'], [12.99, 'R']].forEach(([s, side], i) => {
    at(s, () => { const a = wtip(cx, side), b = aegis.jointWorld(i); fx.flash(a, { col: ICE, size: 1.0, life: 0.1 }); fx.bolt(a, b, { speed: 110, onHit: (p) => { scan.release(i, ctx.s); aegis.crack = Math.min(1, aegis.crack + 0.4); aegis.hit(p, 1.5); fx.impact(p, ICE, 0.9, { floor: false }); fx.shards(p, 8, { col: GOLD, speed: 6, dir: V(-1, 0.2, 0), spread: 0.9, size: 0.1 }); } }); });
    cue(s, 'bolt', { x: 0.5 }); cue(s + 0.07, 'crack', { x: -0.15, n: i });
  });
  at(13.07, () => { aegis.shatter(fx, V(-1, 0.25, 0)); fx.flash(V(-1.5, 1.8, 0), { col: GOLD, size: 3.5, life: 0.25 }); fx.floorRing(-1.4, 0, { col: GOLD, speed: 14, life: 1.0, k: 1.2 }); fx.shake(0.12); });
  cue(13.0, 'dash_big', { x: 0.3 }); cue(13.07, 'shatter', { x: -0.15 }); cue(13.08, 'slowmo_in', {}); cue(13.26, 'slowmo_out', {});
  at(13.275, () => { const p = cl.chestWorld().add(V(0.35, 0.15, 0)); hitChar(cl, p, CYAN, 2.0); fx.ring(p, { col: ICE, r0: 0.3, r1: 6, life: 0.55, width: 0.08 }); fx.punch(0.08); });
  cue(13.275, 'hit_big', { x: -0.3 }); cue(13.9, 'land_hard', { x: -0.8 }); cue(13.95, 'slide', { x: -0.85 });
  at(13.9, () => { fx.sparks(V(-9, 0.05, 1), 40, { col: hdr(0.9, 0.9, 1.0), speed: 6, flat: 0.2, life: 0.5, size: 0.02 }); fx.floorRing(-9, 1, { col: hdr(0.8, 0.7, 0.6), speed: 10, life: 0.6, k: 0.8 }); });
  during(13.9, 14.4, (u, s, ds) => { if (ds > 0) fx.sparks(cl.hands.R.position.clone().setY(0.04), 3, { col: GOLD, speed: 4, dir: V(1, 0.6, 0), spread: 0.7, life: 0.35, size: 0.02 }); });

  /* ---------------------------------------------------------------- E: tool control */
  const CT = [0, 1, 2, 3, 4, 5, 6];
  cue(15.0, 'rise', { x: 0.2 }); cue(15.6, 'takeover', { x: 0.2 });
  CT.forEach((ti, n) => { const s0 = 15.62 + n * 0.07; at(s0 + 0.22, () => { const T = arena.terminals[ti]; fx.flash(T.m.position, { col: CYAN, size: 1.8, life: 0.25 }); T.flash = 0.6; }); cue(s0 + 0.22, 'acquire', { x: clamp(arena.terminals[ti].home.x / 12, -1, 1), n });
    during(s0, 17.0, (u, s) => { const T = arena.terminals[ti]; const a = cx.hands[n % 2 ? 'L' : 'R'].position, k = clamp((s - s0) / 0.22); const b = mid(a, T.m.position, k); const fade = 1 - smooth((s - 16.5) / 0.5); fx.beam(a, b, CYAN, 0.022, (k < 1 ? 1.6 : 0.5) * fade, { core: 0.6 }); T.ctrl = smooth((s - s0 - 0.2) / 0.35); T.flash = Math.max(0, T.flash - 0.05); }); });
  during(15.7, 23.6, (u, s) => { const k = s < 23.18 ? 1 : 1 - smooth((s - 23.18) / 0.4); arena.fu.uControl.value.set(3.5, 0, lerp(0, 34, E.out2(clamp((s - 15.7) / 1.3))), k); });
  at(23.61, () => arena.fu.uControl.value.set(0, 0, 0, 0));
  // pistons
  const PIL = [[-10.2, 1.1, 16.3, 19.0, 3.0], [-7, -2, 16.6, 19.0, 3.0], [-1.5, -1.5, 17.3, 19.5, 2.6], [-5.6, -3.0, 18.08, 20.0, 3.0], [-6.5, 0.5, 18.3, 19.4, 3.0]];
  { const [c0x, c0z] = hexCenter(-4.2, 2.3); for (let i = 0; i < 6; i++) { const a = i * 60 * DEG; PIL.push([c0x + Math.cos(a) * HEXW, c0z + Math.sin(a) * HEXW, 20.3 + i * 0.075, 22.22, 2.3]); } }
  PIL.push([-2.0, 0.4, 22.2, 23.3, 3.0]); PIL.push([-1.0, -2.6, 22.9, 25.05, 1.5]);
  PIL.forEach(([x, z, t0, t1, h], i) => { cue(t0, 'pillar', { x: clamp(x / 10, -1, 1) });
    at(t0, () => { const [hx, hz] = hexCenter(x, z); fx.sparks(V(hx, 0.1, hz), 24, { col: CYAN, speed: 8, dir: V(0, 1, 0), spread: 0.6, life: 0.4 }); fx.floorRing(hx, hz, { col: CYAN, speed: 9, life: 0.5, k: 0.8 }); fx.shake(0.04); });
    during(t0 - 0.25, t1 + 0.45, (u, s) => { const [hx, hz] = hexCenter(x, z); const up = E.outBack(clamp((s - t0) / 0.15)), dn = 1 - E.in2(clamp((s - t1) / 0.4)); const hh = s < t0 ? 0 : h * up * dn; arena.setPillar(i, x, z, hh); arena.pillars[i].mat.uniforms.uHeat.value = 1 - clamp((s - t0) / 0.6);
      if (s < t0) arena.pushLight(V(hx, 0.15, hz), CYAN, 1.3, (s - t0 + 0.25) / 0.25 * 1.5); });
    at(t1 + 0.46, () => arena.setPillar(i, x, z, 0));
  });
  // terminal beams: [terminal, telegraph, fire0, fire1, targetFn, reflectTargetFn]
  const tb = (ti, tele, f0, f1, tgt, opt = {}) => { const T = arena.terminals[ti];
    cue(f0, 'tbeam', { x: clamp(T.home.x / 12, -1, 1), dur: f1 - f0 });
    during(tele, f1, (u, s, ds) => { const a = T.m.position, b = tgt(s); T.m.lookAt(b); T.flash = s >= f0 ? 0.5 : 0.1;
      if (s < f0) { fx.beam(a, b, CYAN, 0.012, 0.35 + 0.25 * Math.sin(s * 80), { core: 0 }); return; }
      fx.beam(a, b, WHITE, 0.05, 2.0, { core: 2 }); fx.beam(a, b, CYAN, 0.16, 0.9, { core: 0.3 }); fx.beam(a, b, hdr(0.1, 0.6, 0.9), 0.42, 0.22, { core: 0 });
      fx.glow(a, CYAN, 1.3, 0.7); arena.pushLight(b, CYAN, 3.0, 1.6); fx.shake(0.02);
      if (opt.reflect) { const c = opt.reflect(s); fx.beam(b, c, WHITE, 0.05, 2.0, { core: 2 }); fx.beam(b, c, hdr(1.2, 1.5, 1.6), 0.16, 0.9, { core: 0.3 }); fx.glow(b, hdr(2.2, 1.8, 1.2), 0.9, 0.8); mirror.mat.uniforms.uHit.value = 1; if (ds > 0) fx.sparks(b, 4, { col: GOLD, speed: 8, life: 0.3 }); }
      else if (ds > 0) { fx.sparks(b, 5, { col: CYAN, speed: 9, dir: V(0, 1, 0), spread: 1.0, life: 0.4, size: 0.025 }); if (opt.onTick) opt.onTick(b, s); }
    });
    at(f1 + 0.001, () => { T.m.quaternion.copy(T.homeQ); T.flash = 0; });
  };
  tb(1, 16.6, 16.85, 17.35, (s) => V(lerp(-5.5, -1.2, clamp((s - 16.85) / 0.5)), 0.05, lerp(0.4, 3.6, clamp((s - 16.85) / 0.5))));
  tb(3, 17.3, 17.55, 18.0, () => shield.m.position.clone(), { onTick: (b) => { shield.mat.uniforms.uHit.value = 1; fx.sparks(b, 4, { col: GOLD, speed: 7, life: 0.3 }); } });
  during(17.46, 18.0, (u, s) => { const T = arena.terminals[3].home; const c = cl.chestWorld(); const d = T.clone().sub(c).normalize(); shield.set(c.clone().addScaledVector(d, 0.95), d, clamp((s - 17.46) / 0.1), s); shield.mat.uniforms.uCrack.value = clamp((s - 17.6) / 0.4); });
  at(18.0, () => { const p = shield.m.position.clone(); shield.hide(); fx.shards(p, 22, { col: GOLD, speed: 8, size: 0.13, life: 1.0 }); fx.impact(p, GOLD, 0.8, { floor: false }); });
  cue(17.48, 'shield_up', { x: -0.4 }); cue(18.0, 'shatter_small', { x: -0.45 });
  tb(0, 18.45, 18.7, 18.95, () => cl.chestWorld()); tb(6, 18.45, 18.7, 18.95, () => cl.chestWorld());
  cue(16.22, 'dash_c', { x: -0.8 }); cue(16.52, 'dash_c', { x: -0.6 }); cue(16.86, 'jump', { x: -0.3 }); cue(17.26, 'land', { x: -0.15 }); cue(17.3, 'dash_c', { x: -0.2 }); cue(18.02, 'dash_c', { x: -0.5 });
  at(18.3, () => { fx.impact(V(-6.5, 0.6, 0.5), CYAN, 1.1); cl.hit = 0.6; }); cue(18.3, 'hit', { x: -0.6 });
  at(18.8, () => { const p = cl.chestWorld(); hitChar(cl, p, CYAN, 2.2); fx.ring(p, { col: ICE, r0: 0.3, r1: 7, life: 0.6, width: 0.08 }); weaponBurst(cl, 'R', GOLD); cl.setWeapon('R', 'none'); fx.punch(0.08); });
  cue(18.8, 'hit_big', { x: -0.55 }); cue(18.82, 'weapon_break', { x: -0.55 });
  at(19.3, () => { fx.sparks(V(-5, 0.05, 2), 60, { col: hdr(0.9, 0.9, 1), speed: 7, flat: 0.2, life: 0.6, size: 0.02 }); fx.floorRing(-5, 2, { col: hdr(0.9, 0.8, 0.7), speed: 12, life: 0.8, k: 1.4 }); fx.shake(0.12); });
  cue(19.3, 'land_hard', { x: -0.45 }); cue(19.9, 'descend', { x: 0.2 }); cue(21.0, 'target_all', { x: 0 });
  [0, 1, 2, 6].forEach((ti) => during(20.8, 21.55, (u, s) => { const T = arena.terminals[ti]; const b = cl.chestWorld(); T.m.lookAt(b); fx.beam(T.m.position, b, CYAN, 0.012, 0.25 + 0.3 * u + 0.2 * Math.sin(s * 60 + ti), { core: 0 }); }));

  /* ---------------------------------------------------------------- F: planning */
  cue(21.4, 'breath', { x: -0.3 }); cue(21.55, 'plan_in', {}); cue(22.0, 'plan_out', {});
  const pathPts = [
    [V(-4.2, 0.9, 2.3), V(-3.2, 1.0, 2.2), V(-2.2, 1.2, 1.9), V(-1.4, 1.35, 1.6)],
    [V(-4.2, 0.9, 2.3), V(-4.6, 2.6, 3.0), V(-4.0, 4.0, 3.9), V(-2.8, 4.3, 4.3)],
    (() => { const o = []; for (let i = 0; i <= 14; i++) { const p = clPos.at(22.0 + i * (1.38 / 14)); o.push(V(p[0], p[1] + 0.9, p[2])); } return o; })(),
  ];
  const pathCurves = [];
  const PW = [[0.02, 0.34], [0.2, 0.55], [0.42, 0.95]];
  during(21.55, 22.12, (u0, s) => { const g = clamp((s - 21.55) / 0.45);
    pathPts.forEach((pts, i) => { const [a, b] = PW[i]; const k = clamp((g - a) / (b - a)); const fail = i < 2 && g > b; const T = paths[i];
      if (!pathCurves[i]) pathCurves[i] = T.setPoints(pts); T.mesh.visible = g > a && s < 22.0 + (i === 2 ? 0.12 : 0);
      T.mat.uniforms.uReveal.value = k; T.mat.uniforms.uTime.value = ctx.T; T.mat.uniforms.uHead.value = k < 1 ? 1 : 0; T.mat.uniforms.uDash.value = i === 2 && k >= 1 ? 0 : 1;
      T.mat.uniforms.uA.value = fail ? Math.max(0, 1 - (g - b) / 0.08) * 0.6 : (i === 2 && k >= 1 ? 2.0 : 1.0); T.mat.uniforms.uColor.value.copy(fail ? hdr(0.9, 0.9, 1.0) : hdr(1.7, 0.95, 0.3));
      const gm = ghosts.plan[i]; const show = g > a && !fail && s < 22.0;
      if (show) { const p = pathCurves[i].getPoint(k), p2 = pathCurves[i].getPoint(Math.min(1, k + 0.02)); const yaw = Math.atan2(p2.x - p.x, p2.z - p.z);
        gm.set(s, 0, { pos: V(p.x, p.y - 0.9, p.z), yaw: k < 1 ? yaw : Math.PI / 2, handL: V(-0.45, 0.62, 0.1), handR: V(0.42, 0.9, 0.5), bladeL: V(0, 0, 1), bladeR: V(0, 0.6, 0.8), lean: [0.5 * (k < 1 ? 1 : 0), 0] }); gm.first = true; gm.gmat.uniforms.uOpacity.value = 0.55 + 0.25 * Math.sin(ctx.T * 30 + i); }
      else gm.hide();
    });
  });
  [[0, 0.34, pathPts[0][3]], [1, 0.55, pathPts[1][3]]].forEach(([i, g, p]) => { const s = 21.55 + g * 0.45; at(s, () => { fx.sparks(p, 40, { col: hdr(1.0, 1.0, 1.2), speed: 5, life: 0.25, size: 0.02, grav: 0 }); fx.flash(p, { col: hdr(0.5, 1.4, 2.0), size: 2.2, life: 0.06 }); }); cue(s, 'plan_fail', { x: -0.1, n: i }); });
  at(21.55 + 0.95 * 0.45, () => { const p = pathPts[2][14]; fx.flash(p, { col: GOLD, size: 3, life: 0.08 }); }); cue(21.55 + 0.95 * 0.45, 'plan_ok', { x: 0 });
  cue(21.6, 'ghost', { x: -0.2 }); cue(21.64, 'ghost', { x: -0.2 }); cue(21.74, 'ghost', { x: 0 });
  at(22.13, () => { paths.forEach((p) => p.hide()); ghosts.plan.forEach((g) => g.hide()); });
  // execution of the plan
  cue(22.0, 'dash_c', { x: -0.35 });
  [0, 1, 2, 6].forEach((ti) => tb(ti, 22.0, 22.08, 22.3, () => V(-4.2, 0.9, 2.3)));
  at(22.2, () => { const p = V(-4.2, 1.0, 2.3); fx.impact(p, CYAN, 2.0); fx.shards(p, 50, { col: hdr(0.3, 1.0, 1.4), speed: 11, size: 0.2, life: 1.3, radius: 1.5 }); fx.ring(p, { col: CYAN, r0: 0.4, r1: 6, life: 0.5, floor: true }); }); cue(22.2, 'explode', { x: -0.4 });
  at(22.36, () => { fx.impact(V(-2, 3.3, 0.4), GOLD, 0.8, { floor: false }); }); cue(22.36, 'spring', { x: -0.2 });
  const mirrorWin = (k0, f0, f1, k1, ti, tgt, onHit) => {
    const src = arena.terminals[ti].home; let mp = V(), mn = V();
    during(k0, k1, (u, s) => { const c = cl.chestWorld(); const d1 = src.clone().sub(c).normalize(); mp = c.clone().addScaledVector(d1, 1.0); const d2 = tgt().clone().sub(mp).normalize(); mn = d1.clone().add(d2).normalize(); mirror.set(mp, mn, Math.min(clamp((s - k0) / 0.07), 1 - clamp((s - k1 + 0.06) / 0.06)), s); });
    tb(ti, k0 - 0.12, f0, f1, () => mirror.m.position.clone(), { reflect: () => tgt() });
    at(f0 + 0.05, () => onHit(tgt())); at(k1 + 0.001, () => mirror.hide()); cue(k0, 'mirror', { x: clamp(cl.pos.x / 10, -1, 1) }); cue(f0, 'reflect', { x: 0 });
  };
  const killTerm = (ti) => (p) => { const T = arena.terminals[ti]; T.alive = false; fx.impact(p, CYAN, 1.8, { floor: false }); fx.shards(p, 60, { col: hdr(0.4, 1.3, 1.8), speed: 10, size: 0.22, life: 1.6, box: V(3.5, 2, 0.6) }); fx.flash(p, { col: WHITE, size: 3.5, life: 0.25 }); fx.shake(0.1); };
  mirrorWin(22.5, 22.58, 22.72, 22.76, 3, () => arena.terminals[4].home, killTerm(4)); cue(22.63, 'explode', { x: 0.7 });
  mirrorWin(22.78, 22.84, 22.96, 23.0, 2, () => arena.terminals[3].home, killTerm(3)); cue(22.89, 'explode', { x: 0.4 });
  mirrorWin(23.04, 23.1, 23.24, 23.28, 0, () => cx.chestWorld(), () => {});
  at(23.18, () => { const p = cx.chestWorld(); hitChar(cx, p, CYAN, 2.0); fx.impact(p, GOLD, 1.2, { floor: false }); fx.punch(0.07); for (const T of arena.terminals) T.flash = 1; });
  cue(23.18, 'hit_big', { x: 0.1 }); cue(23.2, 'power_down', { x: 0 });
  during(23.18, 23.7, (u, s) => { for (const T of arena.terminals) { T.ctrl = (1 - u) * (Math.sin(s * 70 + T.seed) > 0 ? 1 : 0.3); T.flash = Math.max(0, T.flash - 0.08); } });
  at(23.71, () => { for (const T of arena.terminals) { T.ctrl = 0; T.flash = 0; } });
  at(23.3, () => { cl.setWeapon('R', 'hammer'); fx.flash(cl.hands.R.position, { col: GOLD, size: 2.2, life: 0.25 }); }); cue(23.3, 'morph', { x: 0 }); cue(23.4, 'land', { x: 0 }); cue(23.52, 'land_hard', { x: 0.25 }); cue(23.55, 'jump', { x: 0.05 }); cue(23.9, 'swing_heavy', { x: 0.2 });
  at(24.05, () => { const p = V(2.75, 1.25, 0.6); fx.impact(p, GOLD, 2.4); fx.impact(p, WHITE, 1.4, { floor: false }); fx.ring(V(2.8, 0.05, 0.6), { col: GOLD, r0: 0.4, r1: 9, life: 0.7, floor: true, width: 0.1 }); fx.floorRing(2.8, 0.6, { col: GOLD, speed: 22, life: 1.2, k: 2.0 });
    fx.sparks(V(2.8, 0.1, 0.6), 90, { col: GOLD, speed: 12, flat: 0.25, life: 0.7 }); weaponBurst(cx, 'L', CYAN); fx.shards(wtip(cx, 'L'), 14, { col: CYAN, speed: 8, size: 0.1 }); cx.setWeapon('L', 'none'); cx.hit = 0.8; fx.punch(0.1); fx.shake(0.2); });
  cue(24.05, 'hammer', { x: 0.28 }); cue(24.07, 'weapon_break', { x: 0.3 }); cue(24.12, 'slide', { x: 0.5 });
  during(24.1, 24.7, (u, s, ds) => { if (ds > 0 && u < 0.8) fx.sparks(V(cx.pos.x, 0.05, cx.pos.z), 3, { col: CYAN, speed: 4, dir: V(-1, 0.5, 0), spread: 0.6, life: 0.3, size: 0.02 }); });

  // whip + hurled debris
  at(24.7, () => { weaponBurst(cl, 'R', GOLD); cl.setWeapon('R', 'whip'); }); cue(24.7, 'morph', { x: 0.05 }); cue(24.86, 'whip', { x: 0 }); cue(25.02, 'whip_crack', { x: -0.1 }); cue(25.08, 'heave', { x: 0 }); cue(25.4, 'throw', { x: 0.3 });
  const [dbx, dbz] = hexCenter(-1.0, -2.6); const chunkPos = (s, out = new THREE.Vector3()) => {
    if (s < 25.05) return out.set(dbx, 0.75, dbz);
    const c = V(0.5, 1.0, 0.5);
    if (s < 25.4) { const u = E.in2(clamp((s - 25.05) / 0.35)) * 0.6 + clamp((s - 25.05) / 0.35) * 0.4; const a0 = Math.atan2(dbz - c.z, dbx - c.x), a = a0 - u * (a0 + TAU > TAU ? a0 : a0 + TAU); const r = lerp(Math.hypot(dbx - c.x, dbz - c.z), 3.2, u); return out.set(c.x + Math.cos(a) * r, lerp(0.75, 1.0, u) + Math.sin(u * P) * 0.9, c.z + Math.sin(a) * r); }
    const rel = chunkPos(25.3999); return out.lerpVectors(rel, V(7.1, 1.0, 0.3), clamp((s - 25.4) / 0.34));
  };
  during(24.84, 25.52, (u, s) => { const h = cl.weaponPoint('R', 'tip'); const tgt = s < 25.05 ? V(dbx, 1.45, dbz) : chunkPos(Math.min(s, 25.4)); const ext = s < 25.05 ? E.out3(clamp((s - 24.84) / 0.17)) : s > 25.4 ? 1 - clamp((s - 25.4) / 0.12) : 1;
    const pts = []; const end = h.clone().lerp(tgt, ext); const side = V(0, 1, 0); for (let i = 0; i <= 8; i++) { const k = i / 8; const p = h.clone().lerp(end, k); const wv = Math.sin(k * P) * (s < 25.05 ? (1 - ext) * 1.2 + 0.15 : 0.25); p.addScaledVector(side, wv * Math.sin(k * 9 - s * 40) * 0.5 + Math.sin(k * P) * 0.25 * (s > 25.05 ? 1 : 0)); pts.push(p); }
    whip.setPoints(pts, (k) => 1.2 - 0.7 * k); whip.mat.uniforms.uA.value = 1.2; arena.pushLight(end, GOLD, 1.5, 0.8); });
  at(25.521, () => whip.hide());
  at(25.03, () => { fx.impact(V(dbx, 1.4, dbz), GOLD, 0.9); });
  during(25.05, 25.745, (u, s) => { chunk.visible = true; chunkPos(s, chunk.position); chunk.rotation.set(s * 9, s * 5, s * 3); arena.pushLight(chunk.position, CYAN, 1.5, 0.5); });
  at(25.745, () => { chunk.visible = false; const p = V(7.1, 1.0, 0.3); fx.impact(p, WHITE, 1.3); fx.sparks(p, 50, { col: CYAN, speed: 14, dir: V(0, 1, 0), spread: 0.5, flat: 3 }); fx.beam(p.clone().add(V(0, -1.6, 0)), p.clone().add(V(0, 1.9, 0)), WHITE, 0.03, 2); }); cue(25.72, 'swing_x', { x: 0.7 }); cue(25.745, 'cut_big', { x: 0.7 }); cue(25.75, 'slowmo_in', { short: 1 });
  during(25.745, 26.7, (u, s) => { const t = s - 25.745; halves.forEach((m, i) => { const sg = i ? 1 : -1; m.visible = u < 1; m.position.set(7.1 + t * 12, 1.0 + t * 2.2 - t * t * 5, 0.3 + sg * (0.25 + t * 2.4)); m.rotation.set(t * 6 * sg, P / 2 + t * 3, t * 4); m.scale.setScalar(1 - smooth((u - 0.6) / 0.4)); }); });
  at(25.5, () => { weaponBurst(cl, 'R', GOLD); cl.setWeapon('R', 'blade'); }); cue(25.5, 'morph', { x: 0.2 }); cue(25.47, 'dash_c', { x: 0.3 });
  at(25.83, () => { const p = cx.chestWorld().add(V(-0.3, 0.1, 0)); hitChar(cx, p, GOLD, 2.3); fx.ring(p, { col: GOLD, r0: 0.3, r1: 7, life: 0.6, width: 0.08 }); fx.punch(0.09); cx.damage = 0.6; }); cue(25.83, 'hit_big', { x: 0.7 });
  cue(26.3, 'land_hard', { x: 0.9 }); cue(26.35, 'slide', { x: 0.95 }); at(26.3, () => { fx.sparks(V(10.8, 0.05, -0.4), 40, { col: hdr(0.9, 0.9, 1), speed: 6, flat: 0.2, life: 0.5, size: 0.02 }); fx.floorRing(10.8, -0.4, { col: ICE, speed: 10, life: 0.6, k: 0.8 }); });
  at(26.9, () => { cx.damage = 0; });

  /* ---------------------------------------------------------------- G: execution */
  cue(26.9, 'spinup', { x: 0.9, dur: 0.8 });
  at(27.2, () => { weaponBurst(cx, 'R', CYAN); cx.setWeapon('R', 'single'); fx.ring(cx.chestWorld(), { col: CYAN, r0: 0.2, r1: 2.5, life: 0.4 }); }); cue(27.2, 'condense', { x: 0.9 });
  const dashLines = [];
  [[27.7, 27.77], [27.92, 27.99], [28.14, 28.21], [28.36, 28.43], [28.58, 28.62]].forEach(([a, b], i) => { const pa = cxPos.at(a), pb = cxPos.at(b); const A = V(pa[0], 0.95, pa[2]), B = V(pb[0], 0.95 + pb[1], pb[2]);
    at(a, () => { dashLines.push({ A, B, t0: a, t1: b }); fx.ring(V(pa[0], 0.05, pa[2]), { col: CYAN, r0: 0.2, r1: 2.2, life: 0.3, floor: true }); }); cue(a, 'exec_dash', { x: clamp(pa[0] / 10, -1, 1), n: i }); });
  during(27.7, 29.3, (u, s) => { for (const d of dashLines) { const k = clamp((s - d.t0) / (d.t1 - d.t0)); const age = s - d.t1; const fade = age < 0 ? 1 : Math.max(0, 1 - age / 0.75); if (fade <= 0) continue; const head = d.A.clone().lerp(d.B, k);
    fx.beam(d.A, head, WHITE, 0.018, 2.2 * fade * fade, { core: 2, flow: 0 }); fx.beam(d.A, head, CYAN, 0.07, 0.8 * fade, { core: 0, flow: 0.2 }); arena.pushLight(d.A.clone().lerp(head, 0.5), CYAN, 3, 0.5 * fade); } });
  at(27.75, () => { const p = cl.chestWorld().add(V(0.3, 0.1, 0.4)); fx.shards(p, 16, { col: GOLD, speed: 7, size: 0.1 }); hitChar(cl, p, CYAN, 1.2); }); cue(27.75, 'hit', { x: 0.2 }); cue(27.74, 'shatter_small', { x: 0.2 });
  during(27.71, 27.752, (u, s) => { const c = cl.chestWorld(); const d = V(1, 0, 0.3).normalize(); shield.set(c.clone().addScaledVector(d, 0.9), d, clamp(u * 3), s); }); at(27.753, () => shield.hide());
  at(27.956, () => hitChar(cl, cl.chestWorld().add(V(-0.2, 0.1, -0.3)), CYAN, 1.2)); cue(27.956, 'hit', { x: 0.15 });
  at(28.17, () => { const p = mid(wtip(cl), cl.chestWorld(), 0.5).add(V(0.4, 0, 0)); fx.impact(p, WHITE, 1.0); fx.sparks(p, 30, { col: GOLD, speed: 11 }); }); cue(28.17, 'clash', { x: 0.2 });
  at(28.394, () => { const p = mid(wtip(cl), cl.chestWorld(), 0.5).add(V(-0.3, 0, 0)); fx.impact(p, WHITE, 1.0); fx.sparks(p, 30, { col: GOLD, speed: 11 }); }); cue(28.394, 'clash', { x: 0.15 });
  const cageC = V(1.6, 1.15, -0.4); let cageHeat = 0;
  cue(28.42, 'cage_build', { x: 0.15 }); cue(28.62, 'cage_shut', { x: 0.15 });
  during(28.42, 29.32, (u, s) => { cage.update(cageC, clamp((s - 28.42) / 0.2), s, cageHeat); arena.pushLight(cageC, GOLD, 2.5, 0.8); });
  at(28.62, () => { fx.impact(cageC, GOLD, 1.3); fx.ring(cageC, { col: GOLD, r0: 0.5, r1: 3, life: 0.4 }); fx.floorRing(cageC.x, cageC.z, { col: GOLD, speed: 12, life: 0.7, k: 1.2 }); });
  [28.8, 28.88, 28.96, 29.04].forEach((s, i) => { at(s, () => { const n = cage.nodes[[1, 14, 27, 38][i] % cage.nodes.length].clone().applyAxisAngle(new THREE.Vector3(0, 1, 0), s * 0.6).add(cageC); scan.lock(i + 3 > 5 ? 0 : i + 2, n, s, 29.3 - s); }); cue(s, 'lock', { x: 0.15, n: i }); });
  cue(28.7, 'analyze', { x: 0.15 });
  during(29.05, 29.3, (u) => { cageHeat = u; });
  at(29.32, () => { cage.burst(fx, cageC); cageHeat = 0; fx.impact(cageC, WHITE, 1.8); fx.ring(cageC, { col: CYAN, r0: 0.4, r1: 6, life: 0.5, floor: true }); for (let i = 0; i < 6; i++) scan.release(i, 29.32); }); cue(29.22, 'swing_x', { x: 0.15 }); cue(29.32, 'shatter', { x: 0.15 });

  /* ---------------------------------------------------------------- H: climax */
  at(29.45, () => { weaponBurst(cl, 'R', GOLD); cl.setWeapon('R', 'none'); });
  cue(29.5, 'charge_c', { x: -0.7, dur: 1.9 }); cue(30.0, 'charge_x', { x: 0.7, dur: 1.4 }); cue(29.4, 'dash', { x: 0.4 });
  const lotusPos = () => V(cl.pos.x + 1.55, cl.pos.y + 1.1, 0), BY = 2.72;
  let lotusExtra = 0, lensExtra = 0;
  during(29.5, 34.399, (u, s) => { lotus.update(lotusPos(), 1, clamp((s - 29.5) / 1.8), s, ctx.T, lotusExtra); arena.pushLight(lotusPos(), GOLD, 4, 0.6 + lotusExtra); });
  during(30.0, 34.399, (u, s, ds) => { const tip = wtip(cx); const k = clamp((s - 30.0) / 1.3); lens.update(tip.clone().add(V(-0.15, 0, 0)), V(-1, 0, 0), k, s, lensExtra); fx.glow(tip, ICE, 0.35 + k * 0.6 + lensExtra * 0.3, 0.5 + k * 0.4, 1.2);
    arena.terminals.forEach((T, i) => { if (!T.alive) return; T.ctrl = smooth((s - 30.0 - i * 0.06) / 0.3); if (s < 30.1) return; const pulse = 0.25 + 0.35 * (0.5 + 0.5 * Math.sin(s * 30 - i)); fx.beam(T.m.position, cx.chestWorld(), CYAN, 0.014, pulse * (s < 31.4 ? 1 : 1.5), { core: 0.4, flow: 2 }); });
    if (ds > 0 && s < 31.4) { const a = R() * TAU, r = 2.5; fx.sparks(tip.clone().add(V(0, Math.cos(a) * r, Math.sin(a) * r)), 2, { col: CYAN, speed: 0.1, add: V(0, -Math.cos(a) * 6, -Math.sin(a) * 6), life: 0.35, size: 0.02, grav: 0, drag: 0, bounce: false });
      const lp = lotusPos(); const a2 = R() * TAU; fx.sparks(lp.clone().add(V(0, Math.cos(a2) * 3, Math.sin(a2) * 3)), 2, { col: GOLD, speed: 0.1, add: V(0, -Math.cos(a2) * 5, -Math.sin(a2) * 5), life: 0.5, size: 0.025, grav: 0, drag: 0, bounce: false }); } });
  const beamX = new Track([[31.4, 0.3], [31.55, 0.3], [32.3, -3.3, 'io2'], [33.1, 1.6, 'io2'], [33.5, -0.6, 'io2'], [33.9, 0.5, 'io2'], [34.4, 0.0, 'io2']]);
  cue(31.4, 'fire', { x: 0 }); cue(31.55, 'beam_clash', { x: 0, dur: 2.85 }); cue(32.3, 'adapt_c', { x: -0.6 }); cue(33.1, 'adapt_x', { x: 0.6 }); cue(33.9, 'unstable', { x: 0, dur: 0.5 });
  at(31.4, () => { fx.flash(lotusPos(), { col: GOLD, size: 4, life: 0.25 }); fx.flash(wtip(cx), { col: ICE, size: 3, life: 0.25 }); fx.shake(0.15); });
  at(31.55, () => { const p = V(0.3, BY, 0); fx.impact(p, WHITE, 2.5); fx.ring(p, { col: WHITE, r0: 0.4, r1: 9, life: 0.7, normal: V(1, 0, 0), width: 0.07 }); fx.floorRing(0.3, 0, { col: WHITE, speed: 22, life: 1.2, k: 1.8 }); fx.punch(0.08); });
  during(31.4, 34.399, (u, s, ds) => {
    lotusExtra = smooth((s - 32.3) / 0.6) * (1 + 0.5 * smooth((s - 33.9) / 0.5)); lensExtra = smooth((s - 33.1) / 0.5);
    const ext = clamp((s - 31.4) / 0.15); const X = beamX.at(s); const lp = lotusPos().add(V(0.3, 0, 0)), tip = wtip(cx); const xc = V(X, BY, 0);
    const ca = lp.clone().lerp(V(s < 31.55 ? lerp(lp.x, 0.3, ext) : X, BY, 0), 1), cb = tip.clone().lerp(V(s < 31.55 ? lerp(tip.x, 0.3, ext) : X, BY, 0), 1);
    const wC = 0.5 * (1 + lotusExtra * 0.6) * (1 + 0.06 * Math.sin(s * 50)), jit = 1 + 0.08 * Math.sin(s * 110);
    fx.beam(lp, ca, hdr(2.0, 1.6, 1.0), wC * 0.38, 1.3, { core: 1.0 }); fx.beam(lp, ca, GOLD, wC, 0.7, { core: 0.1 }); fx.beam(lp, ca, COPPER, wC * 2.3, 0.12, { core: 0, flow: 0.5 });
    const wX = 0.05 * (1 - lensExtra * 0.35) * jit;
    fx.beam(tip, cb, hdr(2.2, 2.5, 2.8), wX, 2.4 + lensExtra * 1.2, { core: 2.5, flow: 2 }); fx.beam(tip, cb, CYAN, wX * 3.4, 0.7, { core: 0.1, flow: 2 }); fx.beam(tip, cb, hdr(0.1, 0.6, 0.9), wX * 9, 0.08, { core: 0 });
    arena.pushLight(V(lerp(lp.x, X, 0.5), 0.5, 0), GOLD, 4, 0.9); arena.pushLight(V(lerp(tip.x, X, 0.5), 0.5, 0), CYAN, 4, 0.9);
    if (s >= 31.55) { const grow = clamp((s - 31.55) / 2.85); const sz = 1.3 + grow * 1.8 + smooth((s - 33.9) / 0.5) * 3.5; fx.glow(xc, hdr(2.2, 2.1, 2.0), sz * (1 + 0.1 * Math.sin(s * 80)), 0.9 + grow * 0.5, 1.5); arena.pushLight(V(X, 0.3, 0), WHITE, 3 + grow * 2, 0.8);
      if (ds > 0) { for (let i = 0; i < 2; i++) { fx.sparks(xc, 5, { col: i ? GOLD : CYAN, speed: 16, dir: V(i ? 0.5 : -0.5, 0, 0), spread: 2.5, flat: 1, life: 0.5, size: 0.028 }); } if (R() < 0.12) fx.ring(xc, { col: R() > 0.5 ? GOLD : CYAN, r0: 0.3, r1: 4 + grow * 4, life: 0.45, normal: V(1, 0, 0), width: 0.08 }); if (R() < 0.3) fx.shards(xc, 2, { col: R() > 0.5 ? GOLD : CYAN, speed: 9, size: 0.1, life: 1.0 }); }
      fx.shake(0.03 + grow * 0.06); arena.fu.uDamage.value.set(0, 0, 2 + grow * 5, grow * 0.6); }
  });
  at(34.4, () => { const p = V(0, BY, 0); lotus.burst(fx); lens.g.visible = false; cx.setWeapon('R', 'none'); fx.impact(p, WHITE, 3); fx.flash(p, { col: hdr(2.5, 2.5, 2.5), size: 16, life: 0.6 });
    fx.shards(p, 160, { col: GOLD, speed: 18, size: 0.2, life: 2.6, radius: 1.5, grav: 3 }); fx.shards(p, 160, { col: hdr(0.4, 1.4, 1.9), speed: 18, size: 0.2, life: 2.6, radius: 1.5, grav: 3 });
    fx.sparks(p, 500, { col: GOLD, speed: 26, life: 1.6, grav: 4, drag: 1.5 }); fx.sparks(p, 500, { col: CYAN, speed: 26, life: 1.6, grav: 4, drag: 1.5 });
    fx.ring(V(0, 0.05, 0), { col: WHITE, r0: 0.5, r1: 22, life: 1.1, floor: true, width: 0.06 }); fx.floorRing(0, 0, { col: WHITE, speed: 26, life: 1.5, k: 3 }); fx.punch(0.16); fx.shake(0.5);
    arena.fu.uDamage.value.set(0, 0, 8.5, 1); for (const T of arena.terminals) T.ctrl = 0; cl.damage = 1; cx.damage = 1; });
  cue(34.4, 'detonate', { x: 0 }); cue(34.5, 'aftermath', { dur: 2.2 }); cue(34.92, 'land_hard', { x: -0.8 }); cue(34.92, 'land_hard', { x: 0.8 });
  during(34.5, 36.9, (u, s, ds) => { if (ds > 0 && R() < 0.7) { const a = R() * TAU, r = R() * 9; fx.sparks(V(Math.cos(a) * r, 3 + R() * 4, Math.sin(a) * r), 1, { col: R() > 0.5 ? GOLD : CYAN, speed: 0.5, life: 2.2, grav: 0.8, drag: 0.5, size: 0.022, stretch: 0.01 }); } arena.pushLight(V(0, 0.4, 0), hdr(1.6, 0.8, 0.4), 5, 0.5 * (1 - u)); });
  cue(36.0, 'nod_x', { x: 0.75 }); cue(36.25, 'nod_c', { x: -0.75 });
  at(36.6, () => { cl.setWeapon('R', 'blade2'); cx.setWeapon('R', 'single'); fx.flash(cl.hands.R.position, { col: GOLD, size: 2.5, life: 0.3 }); fx.flash(cx.hands.R.position, { col: CYAN, size: 2.5, life: 0.3 }); });
  cue(36.6, 'morph', { x: -0.75 }); cue(36.6, 'condense', { x: 0.75 }); cue(36.9, 'final_dash', { x: 0 }); cue(37.3, 'final_clash', { x: 0 });
  at(37.29, () => { fx.impact(V(0, 1.75, 0), WHITE, 2.5); });

  events.sort((a, b) => a.s - b.s); let evI = 0;

  /* ================================================================ camera */
  const mp = () => cl.pos.clone().add(cx.pos).multiplyScalar(0.5);
  const hC = (dy = 1.22) => V(cl.pos.x, cl.pos.y + dy, cl.pos.z), hX = (dy = 1.2) => V(cx.pos.x, cx.pos.y + dy, cx.pos.z);
  const L3 = (a, b, u) => a.clone().lerp(b, u);
  const shots = [
    [0, (u) => [V(0.3, 1.1, lerp(9.2, 7.6, u)), V(0, 1.3, 0), 44]],
    [0.335, (u) => [V(lerp(1.3, 0.3, u), 1.45, lerp(5.6, 5.0, u)), V(0, 1.6, 0), 34]],
    [0.43, (u) => { const a = lerp(72, 118, E.io2(u)) * DEG; return [V(Math.cos(a) * 5.4, lerp(1.9, 1.1, u), Math.sin(a) * 5.4), V(0, lerp(1.6, 1.15, u), 0), 34]; }],
    [1.25, (u) => [V(0, lerp(1.6, 2.2, E.out3(u)), lerp(7, 11.5, E.out3(u))), V(0, 1.0, 0), 36]],
    [1.8, (u) => [V(lerp(-3.0, -3.2, u), 1.3, 2.0), hC(1.2), 30]],
    [2.25, (u) => [V(lerp(3.0, 3.2, u), 1.25, 1.9), hX(1.15), 30]],
    [2.68, (u) => [V(lerp(-1.0, -2.6, u), 3.0, 9.5), V(-4.6, 1.1, 0.3), 38]],
    [3.44, (u) => [V(lerp(-4.2, -4.6, u), 1.1, lerp(5.6, 5.0, u)), V(-4.9, 1.75, 0.4), 38]],
    [3.84, (u) => [V(-2.2, 1.5, 8.2), V(lerp(-4, -2.6, u), 1.4, 0.5), 38]],
    [4.3, (u) => { const m = mp(); return [V(m.x + 0.6, 1.5, 6.4), V(m.x, 1.05, 0), 36]; }],
    [5.26, (u) => [V(lerp(0.6, -0.6, u), 1.3, lerp(4.2, 5.2, u)), V(lerp(-0.4, -1.8, E.out3(u)), 1.0, 0), 38]],
    [5.86, (u) => [L3(V(-1.0, 1.35, 2.9), V(-1.9, 1.35, 2.0), E.io2(u)), V(-3.6, 1.28, 0), 30]],
    [6.9, (u) => [V(lerp(-6.6, -6.2, u), 2.4, 2.7), V(0, 1.6, -0.2), 40]],
    [8.1, (u) => [V(lerp(0.2, -0.3, u), 0.85, lerp(3.9, 3.5, u)), V(-3.7, 2.25, 0), 42]],
    [9.0, (u) => [V(lerp(-1.5, 1.5, u), 5.2, 12.5), V(lerp(-1, 1.5, u), 2.3, 0), 40]],
    [9.44, (u) => [V(lerp(8.2, 9.0, u), 1.5, 6.2), V(lerp(4.8, 5.8, u), 1.1, 0), 36]],
    [10.4, (u) => [V(7.4, 0.8, 6.6), V(7, lerp(1.2, 2.2, E.out2(clamp(u * 2))) - smooth((u - 0.6) / 0.4) * 1.0, -0.4), 42]],
    [11.0, (u) => [V(lerp(4.4, 4.7, u), 1.25, 1.8), hX(1.18), 28]],
    [11.45, (u) => [V(lerp(9.6, 9.2, u), 2.5, 2.6), V(0, 1.5, 0), 38]],
    [12.2, (u) => [V(lerp(0.1, -0.3, u), 1.4, 1.5), V(-3.6, 1.25, 0), 34]],
    [12.68, (u) => [V(1.0, 1.6, lerp(5.6, 5.2, u)), V(-1.2, 1.6, 0), 38]],
    [13.05, (u) => [V(lerp(-0.6, -1.6, u), 0.75, lerp(4.2, 3.7, u)), V(lerp(-1.6, -2.4, u), 1.35, 0), 38]],
    [13.275, (u) => [V(-5.5, 1.6, 8.5), V(lerp(-4, -9.5, E.out2(u)), 1.0, 0.8), 40]],
    [14.4, (u) => [V(lerp(-8.2, -8.6, u), 0.85, 2.9), hC(1.15), 32]],
    [15.0, (u) => [V(lerp(0.2, 1.4, u), 0.6, 4.6), hX(1.0), 36]],
    [15.62, (u) => [V(0, lerp(8.5, 9.5, u), lerp(16.5, 18, u)), V(0, 2.0, -2.5), 44]],
    [16.2, (u) => [V(cl.pos.x * 0.5 - 2.5, 3.6, 10.5), V(cl.pos.x, 1.3, cl.pos.z * 0.5), 40]],
    [17.3, (u) => [V(lerp(-6.2, -6.6, u), 1.7, lerp(2.6, 2.2, u)), V(-2.8, 2.0, -6.5), 46]],
    [18.0, (u) => [V(-6, 2.2, lerp(9.5, 10.5, u)), V(-6.2, lerp(1.2, 3.0, smooth(u * 1.5)), 0.5), 44]],
    [18.82, (u) => [V(-3.2, 0.55, 5.8), V(cl.pos.x, Math.max(0.9, cl.pos.y + 0.6), cl.pos.z), 40]],
    [19.62, (u) => [V(lerp(-7.0, -6.7, u), 0.42, lerp(4.3, 4.0, u)), V(-2.2, 1.25, 1.7), 36]],
    [20.3, (u) => [V(-4.2, lerp(7, 8.6, u), lerp(8.5, 9.6, u)), V(-3.4, 0.9, 1.8), 38]],
    [21.38, (u) => [V(-2.75, 1.5, 3.9), V(-4.2, 1.5, 2.3), 15]],
    [21.55, (u) => [L3(V(-7.2, 4.6, 8.6), V(-5.6, 6.0, 10.2), u), V(-1.9, 1.9, 1.8), 40]],
    [22.0, (u) => [V(-8.6, 3.4, 8.6), V(cl.pos.x, cl.pos.y + 0.9, cl.pos.z), 44]],
    [22.45, (u) => [V(lerp(-3.5, -2.0, u), 2.6, 11.5), V(lerp(0, 1.5, u), 3.6, -2.0), 46]],
    [23.26, (u) => [V(3.6, 1.1, 5.0), V(cx.pos.x - 0.6, cx.pos.y + 1.0, cx.pos.z), 38]],
    [23.52, (u) => [V(4.9, 0.45, 4.0), V(2.4, lerp(1.2, 1.9, u), 0.6), 42]],
    [24.05, (u) => [V(lerp(3.2, 4.2, E.out3(u)), 1.4, lerp(7.5, 9, E.out3(u))), V(lerp(3, 4.5, E.out3(u)), 1.0, 0.4), 40]],
    [24.7, (u) => [V(lerp(1.8, 2.4, u), 2.7, 7.4), V(lerp(0.6, 2.0, u), 1.2, -0.6), 44]],
    [25.4, (u) => { const c = chunkPos(Math.min(ctx.s, 25.74)); return [V(c.x - 4.6, 2.3, 4.2), V(c.x + 2.2, 1.0, 0.2), 40]; }],
    [25.74, (u) => [V(lerp(5.9, 5.6, u), 1.3, 6.2), V(7.4, 1.1, 0.3), 34]],
    [25.83, (u) => [V(8.6, 1.7, 10.5), V(lerp(8, 10.5, E.out2(u)), 1.0, -0.2), 40]],
    [26.55, (u) => [L3(V(9.2, 0.95, 2.6), V(9.7, 1.05, 2.0), E.io2(u)), hX(1.12), 30]],
    [27.62, (u) => [V(1.6, lerp(15.5, 14.5, u), 5.2), V(1.6, 0, -0.4), 42]],
    [28.6, (u) => { const a = lerp(60, 100, u) * DEG; return [V(1.6 + Math.cos(a) * 4.6, 1.5, -0.4 + Math.sin(a) * 4.6), V(1.6, 1.05, -0.4), 36]; }],
    [29.4, (u) => [L3(V(-3.4, 1.0, 3.6), V(-3.9, 1.3, 3.0), u), V(cl.pos.x + 0.9, cl.pos.y + 1.1, 0), 40]],
    [30.2, (u) => [L3(V(3.8, 1.3, 3.4), V(4.3, 1.6, 2.8), u), V(cx.pos.x - 1.0, cx.pos.y + 1.1, 0), 38]],
    [31.0, (u) => [V(0, 2.3, lerp(15.5, 14.8, u)), V(0, 2.4, 0), 40]],
    [31.4, (u) => [V(0, 2.5, lerp(14.5, 12.0, E.out2(u))), V(0, 2.5, 0), 40]],
    [32.3, (u) => [V(lerp(-11.2, -10.6, u), 3.5, 2.6), V(0, 2.3, -0.2), 42]],
    [33.1, (u) => [V(lerp(11.2, 10.6, u), 3.2, 2.4), V(0, 2.4, -0.2), 40]],
    [33.9, (u) => [L3(V(0.8, 1.6, 6.5), V(0, 3.2, 17), E.in2(u)), V(0, 2.6, 0), 40]],
    [34.5, (u) => [V(0, lerp(9, 10.5, u), lerp(17, 19, u)), V(0, 0.6, 0), 40]],
    [35.25, (u) => [V(lerp(-5.9, -5.6, u), 0.8, 3.2), hC(1.1), 32]],
    [35.85, (u) => [V(lerp(5.9, 5.6, u), 0.8, 3.2), hX(1.08), 32]],
    [36.42, (u) => [V(0, 0.9, lerp(15.5, 14.5, u)), V(0, 1.5, 0), 42]],
    [36.9, (u) => [V(0, lerp(0.9, 1.2, u), lerp(14.5, 8.0, E.in2(u))), V(0, 1.5, 0), 42]],
    [37.3, () => [V(0, 1.2, 8), V(0, 1.5, 0), 42]],
  ];
  for (let i = 0; i < shots.length; i++) shots[i][2] = i + 1 < shots.length ? shots[i + 1][0] : END;
  shots.forEach(([s]) => { if (s > 0.1 && s < 37.3) cue(s, 'cut', {}); });

  /* ================================================================ per-frame */
  const yawS = { cl: new Spring1(20, 0.9), cx: new Spring1(26, 0.95) };
  const angTo = (cur, tgt) => cur + Math.atan2(Math.sin(tgt - cur), Math.cos(tgt - cur));
  const prevTip = { clR: V(), cxR: V(), cxL: V() };
  const ghostAcc = { cl: 0, cx: 0 }; let ghostIdx = { cl: 0, cx: 0 };
  const _p = [0, 0, 0];

  function poseChar(m, key, s, ds, posT, opp, clips) {
    const p = posT.at(s), o = opp; const pos = V(p[0], p[1], p[2]);
    let tgt = Math.atan2(o.x - pos.x, o.z - pos.z);
    for (const [a, b] of faceMove[key]) if (s >= a && s <= b) { const q = posT.at(s + 0.03); const dx = q[0] - p[0], dz = q[2] - p[2]; if (dx * dx + dz * dz > 1e-4) tgt = Math.atan2(dx, dz); }
    const Y = yawS[key]; if (!Y.init) Y.snap(tgt); const yaw = Y.step(angTo(Y.x, tgt), ds);
    const c = clipPose(m.kind, clips, s);
    m.set(s, ds, { pos, yaw, spin: (key === 'cl' ? clSpin : cxSpin).at(s) + c.yawOff, tumble: (key === 'cl' ? clTumble : cxTumble).at(s),
      handL: V(...c.L), handR: V(...c.R), bladeL: V(...c.bL), bladeR: V(...c.bR), mood: moodAt(moods[key], s), look: V(o.x, o.y + 1.25, o.z), squash: squashAt(squashes[key], s),
      lean: [(key === 'cl' ? clLean : cxLean).at(s), 0], flare: (key === 'cl' ? clFlare : cxFlare).at(s), haloSpin: (key === 'cl' ? clHaloSpin : cxHaloSpin).at(s), nod: nods[key].at(s) });
  }

  let prevS = -1;
  function step(frame, willRender) {
    const s = ST[frame], ds = frame === 0 ? 0 : s - ST[frame - 1], T = frame / 60; ctx = { s, ds, T };
    fx.begin();
    if (frame === 0) { cl.setWeapon('R', 'blade', true); cx.setWeapon('R', 'lance', true); cx.setWeapon('L', 'lance', true); }
    const pc = clPos.at(s), px = cxPos.at(s);
    poseChar(cl, 'cl', s, ds, clPos, V(px[0], px[1], px[2]), clClips); poseChar(cx, 'cx', s, ds, cxPos, V(pc[0], pc[1], pc[2]), cxClips);
    // continuous windows
    for (const d of durs) if (s >= d.s0 && s <= d.s1) d.fn(clamp((s - d.s0) / (d.s1 - d.s0)), s, ds);
    aegis.update(s, T);
    while (evI < events.length && events[evI].s <= s) { events[evI].fn(); evI++; }
    scan.update(s);
    // trails
    const tr = (name, m, side) => { const t = trails[name]; const tip = m.weaponPoint(side, 'tip'), base = m.weaponPoint(side, 'base'); const sp = ds > 0 ? tip.distanceTo(prevTip[name]) / ds : 0; prevTip[name].copy(tip);
      if (m.form[side] !== 'none' && m.root.visible && sp > 5 && sp < 400) t.push(base, tip, s); t.mat.uniforms.uOpacity.value = clamp((sp - 5) / 14) * 0.9 + 0.1; t.update(s); };
    tr('clR', cl, 'R'); tr('cxR', cx, 'R'); tr('cxL', cx, 'L');
    { const a = V(0, 0.32, -0.32).applyMatrix4(cl.tilt.matrixWorld), b = V(0, 0.12, -0.34).applyMatrix4(cl.tilt.matrixWorld); if (cl.speed > 3) trails.scarf.push(b, a, s); trails.scarf.mat.uniforms.uOpacity.value = clamp(cl.speed / 12) * 0.7; trails.scarf.update(s); trails.jet.mesh.visible = false; }
    // afterimages
    for (const [key, m, thr] of [['cl', cl, 34], ['cx', cx, 24]]) { const G = ghosts[key]; ghostAcc[key] += ds;
      if (m.speed > thr && ghostAcc[key] > 0.016) { ghostAcc[key] = 0; const g = G[ghostIdx[key]++ % G.length]; g.snap = m.snapshot(); g.t = 0; }
      for (const g of G) { g.t += ds; const a = g.snap ? Math.max(0, 1 - g.t / 0.2) : 0; if (a > 0) g.m.applySnapshot(g.snap, a * 0.75); else g.m.hide(); } }
    // character light on the floor
    const cc = cl.chestWorld(), xc = cx.chestWorld();
    arena.pushLight(V(cc.x, 0.25, cc.z), hdr(1.8, 0.8, 0.3), 1.5, 0.55 + cl.flare * 0.7); arena.pushLight(V(xc.x, 0.25, xc.z), hdr(0.25, 1.2, 1.8), 1.5, 0.55 + cx.flare * 0.7);
    if (cl.form.R !== 'none') arena.pushLight(cl.weaponPoint('R', 'tip'), GOLD, 1.3, 0.5); if (cx.form.R !== 'none') arena.pushLight(cx.weaponPoint('R', 'tip'), CYAN, 1.2, 0.5);
    arena.fu.uBlob.value[0].set(cc.x, cc.z, clamp(1 - cl.pos.y / 3)); arena.fu.uBlob.value[1].set(xc.x, xc.z, clamp(1 - cx.pos.y / 3));
    // camera
    let sh = shots[0]; for (const q of shots) { if (q[0] <= s) sh = q; else break; }
    const [cp, ct, fov] = sh[1](clamp((s - sh[0]) / (sh[2] - sh[0])));
    const sk = fx.shakeAmt; cp.x += Math.sin(T * 61.3) * sk * 0.6 + Math.sin(T * 0.9) * 0.012; cp.y += Math.sin(T * 73.1 + 1) * sk * 0.6 + Math.sin(T * 1.1 + 2) * 0.01; ct.x += Math.sin(T * 67.7 + 2) * sk * 0.35; ct.y += Math.sin(T * 79.9 + 3) * sk * 0.35;
    camera.position.copy(cp); camera.fov = fov; camera.lookAt(ct); camera.updateProjectionMatrix(); camera.updateMatrixWorld(true);
    fx.update(s, ds, T, 1 / 60);
    // grading / post
    const plan = smooth((s - 21.5) / 0.06) * (1 - smooth((s - 21.97) / 0.05));
    const scanG = Math.max(smooth((s - 11.0) / 0.4) * (1 - smooth((s - 12.5) / 0.3)) * 0.55, smooth((s - 28.68) / 0.1) * (1 - smooth((s - 29.2) / 0.1)) * 0.5);
    const U = post.u; U.uPlan.value = plan; U.uScan.value = scanG; U.uRadial.value = fx.radial;
    const white = s >= 34.4 ? Math.max(0, 1 - Math.abs((s - 34.455) / (s < 34.455 ? 0.05 : 0.5))) : 0;
    const black = s >= 37.3 ? 1 : 0; const fin = clamp(1 - T / 0.12);
    if (black) { U.uFade.value.set(0, 0, 0); U.uFadeK.value = 1; } else if (white > 0) { U.uFade.value.set(1, 0.98, 0.95); U.uFadeK.value = clamp(white * 1.15); } else { U.uFade.value.set(0, 0, 0); U.uFadeK.value = fin * 0.0; }
    U.uExposure.value = 1.0 - plan * 0.12 + (s > 34.5 && s < 36.9 ? -0.12 * (1 - smooth((s - 36.2) / 0.7)) : 0);
    arena.setDim(1 - plan * 0.35 - (s > 34.5 ? 0.25 * (1 - smooth((s - 36.4) / 0.5)) : 0));
    key.intensity = 0.9; arena.update(T, camera);
    prevS = s;
  }

  return { totalFrames, step, cues: () => ({ fps: 60, frames: totalFrames, duration: totalFrames / 60, events: cuesOut.map((c) => ({ ...c, t: +s2T(c.s).toFixed(4), tEnd: c.dur ? +s2T(c.s + c.dur).toFixed(4) : undefined })).sort((a, b) => a.t - b.t), marks: Object.fromEntries([['designStart', 6.9], ['critique', 11.0], ['control', 15.0], ['low', 19.3], ['plan', 21.4], ['planExec', 22.0], ['execution', 26.9], ['charge', 29.5], ['fire', 31.4], ['detonate', 34.4], ['after', 34.5], ['finalDash', 36.9], ['end', 37.3]].map(([k, v]) => [k, +s2T(v).toFixed(4)])) }) };
}
