import * as THREE from 'three';
import { clamp, lerp, smooth, E, hdr, PAL, V, mulberry, DEG } from './util.js';

const rnd = mulberry(909);
const Zv = new THREE.Vector3(0, 0, 1), Yv = new THREE.Vector3(0, 1, 0);

/* shared holographic panel material: shape 0 rect, 1 ogive (pointed arch), 2 hexagon, 3 petal */
export function panelMat(color, shape = 0) {
  return new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
    uniforms: { uColor: { value: color.clone() }, uA: { value: 1 }, uTime: { value: 0 }, uShape: { value: shape }, uScan: { value: 0 }, uCrack: { value: 0 }, uHit: { value: 0 }, uSeed: { value: rnd() * 10 } },
    vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
    fragmentShader: /* glsl */`
      precision highp float; varying vec2 vUv; varying vec3 vN; varying vec3 vV;
      uniform vec3 uColor; uniform float uA, uTime, uShape, uScan, uCrack, uHit, uSeed;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        vec2 p = vUv * 2.0 - 1.0; float d;
        if (uShape < 0.5) { d = 1.0 - max(abs(p.x), abs(p.y)); }
        else if (uShape < 1.5) { float c1 = 1.9 - length(vec2(p.x + 0.9, p.y + 1.0)); float c2 = 1.9 - length(vec2(p.x - 0.9, p.y + 1.0)); d = min(min(c1, c2) * 0.9, min(1.0 - abs(p.x), p.y + 1.0)); }
        else if (uShape < 2.5) { vec2 q = abs(p); d = 1.0 - max(q.x * 0.866 + q.y * 0.5, q.y) / 0.866; d *= 0.866; }
        else { vec2 q = vec2(abs(p.x), p.y); float w = 0.62 * sin(3.14159 * pow(clamp(q.y * 0.5 + 0.5, 0.0, 1.0), 0.75)); d = (w - q.x) * 0.9; d = min(d, 1.0 - abs(p.y)); }
        if (d < 0.0) discard;
        float frame = smoothstep(0.085, 0.03, d) + smoothstep(0.2, 0.17, d) * smoothstep(0.14, 0.17, d) * 0.5;
        float lat = smoothstep(0.46, 0.5, abs(fract((p.x + p.y) * 2.0) - 0.5)) + smoothstep(0.46, 0.5, abs(fract((p.x - p.y) * 2.0) - 0.5));
        float f = clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0); f *= f;
        float sweep = exp(-pow((p.y - (fract(uTime * 0.35 + uSeed) * 3.0 - 1.5)) / 0.12, 2.0));
        vec3 col = uColor * (frame * 1.0 + lat * 0.22 + 0.035 + f * 0.25 + sweep * 0.12);
        // analysed by the opponent: cool wireframe overlay
        float grid = smoothstep(0.44, 0.5, abs(fract(p.x * 4.0) - 0.5)) + smoothstep(0.44, 0.5, abs(fract(p.y * 4.0) - 0.5));
        col = mix(col, vec3(0.14, 0.62, 0.9) * (frame * 0.8 + grid * 0.3 + 0.02), uScan * 0.75);
        // cracks
        vec2 cp = p * 3.0 + uSeed; vec2 ci = floor(cp); float cmin = 9.0;
        for (int j = -1; j <= 1; j++) for (int i = -1; i <= 1; i++){ vec2 o = vec2(float(i), float(j)); vec2 r = o + vec2(hash(ci + o), hash(ci + o + 7.7)) - fract(cp); cmin = min(cmin, abs(r.x) + abs(r.y) * 0.6); }
        float crack = smoothstep(0.42, 0.5, cmin) * smoothstep(0.62, 0.5, cmin);
        col += vec3(1.3, 1.5, 1.7) * crack * uCrack * (0.6 + 0.4 * sin(uTime * 50.0 + uSeed * 9.0));
        col += uColor * uHit * 0.8 + vec3(1.0) * uHit * 0.15;
        gl_FragColor = vec4(max(col * uA, 0.0), 1.0);
      }`,
  });
}

/* ------------------------------------------------------------------ Aegis: architectural barrier */
export class Aegis {
  constructor(scene) {
    this.g = new THREE.Group(); scene.add(this.g); this.panels = []; this.alive = false; this.joints = [];
    const Rr = 3.3, geo = new THREE.PlaneGeometry(1, 1);
    for (let i = -2; i <= 2; i++) for (let t = 0; t < 3; t++) {
      const phi = i * 15 * DEG; const w = 0.83, h = t === 2 ? 1.05 : 1.14; const y = t === 0 ? 0.66 : t === 1 ? 1.86 : 2.99 - Math.abs(i) * 0.0;
      const mat = panelMat(hdr(1.05, 0.55, 0.16), t === 2 ? 1 : 0);
      const m = new THREE.Mesh(geo, mat); m.scale.set(w, h, 1);
      const home = new THREE.Vector3(Math.cos(phi) * Rr - Rr, y - Math.abs(i) * (t === 2 ? 0.0 : 0), Math.sin(phi) * Rr);
      const q = new THREE.Quaternion().setFromAxisAngle(Yv, Math.PI / 2 - phi);
      this.g.add(m); this.panels.push({ m, mat, home, q, delay: (Math.abs(i) * 0.09 + t * 0.14), i, t, w, h });
    }
    for (const [i, y] of [[-1, 1.26], [0.5, 2.45], [1, 1.26]]) { const phi = i * 15 * DEG; this.joints.push(new THREE.Vector3(Math.cos(phi) * Rr - Rr + 0.02, y, Math.sin(phi) * Rr)); }
    this.g.visible = false; this.t0 = 1e9; this.scan = 0; this.crack = 0;
  }
  place(x, z, from) { this.g.position.set(x, 0, z); this.from = this.g.worldToLocal(from.clone()); }
  jointWorld(i) { return this.joints[i].clone().add(this.g.position); }
  update(s, t) {
    this.g.visible = this.alive; if (!this.alive) return;
    for (const p of this.panels) {
      const u = clamp((s - this.t0 - p.delay) / 0.42); const e = E.out3(u), sc = E.outBack(u);
      p.m.position.lerpVectors(this.from, p.home, e); p.m.position.y += Math.sin(u * Math.PI) * 0.5;
      p.m.quaternion.copy(p.q); p.m.rotateZ((1 - e) * 2.2 * (p.i % 2 ? 1 : -1)); p.m.rotateY((1 - e) * 1.5);
      p.m.scale.set(p.w * sc, p.h * sc, 1); p.m.visible = u > 0;
      const U = p.mat.uniforms; U.uTime.value = t; U.uA.value = Math.min(1, u * 2) * (1 + (1 - u) * 0.8); U.uScan.value = this.scan * ((this.scanX ?? 99) < p.home.x + this.g.position.x + 0.3 ? 1 : 0); U.uCrack.value = this.crack; U.uHit.value = Math.max(0, U.uHit.value - 0.08);
    }
  }
  hit(point, k = 1) { for (const p of this.panels) { const d = p.m.getWorldPosition(new THREE.Vector3()).distanceTo(point); p.mat.uniforms.uHit.value = Math.max(p.mat.uniforms.uHit.value, k * Math.exp(-d * d / 1.2)); } }
  shatter(fx, dir) {
    this.alive = false;
    for (const p of this.panels) { const w = p.m.getWorldPosition(new THREE.Vector3());
      fx.shards(w, 16, { col: hdr(1.9, 1.0, 0.32), speed: 9, dir, spread: 0.9, size: 0.2, life: 1.7, box: new THREE.Vector3(0.2, 1.0, 0.8), grav: 6 });
      fx.sparks(w, 14, { col: PAL.gold, speed: 9, dir, spread: 1.0, life: 0.9, size: 0.03 }); }
  }
}

/* ------------------------------------------------------------------ flat panel constructs: mirror, petals */
export class Plate {
  constructor(scene, color, shape, size) { this.mat = panelMat(color, shape); this.m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), this.mat); this.m.visible = false; this.size = size; scene.add(this.m); }
  set(pos, normal, k, t, roll = 0) { this.m.visible = k > 0.001; if (!this.m.visible) return; this.m.position.copy(pos); this.m.quaternion.setFromUnitVectors(Zv, normal); this.m.rotateZ(roll + (1 - k) * 2.0);
    const sc = E.outBack(clamp(k)) * this.size; this.m.scale.set(sc, sc, 1); this.mat.uniforms.uTime.value = t; this.mat.uniforms.uA.value = Math.min(1, k * 2); this.mat.uniforms.uHit.value = Math.max(0, this.mat.uniforms.uHit.value - 0.06); }
  hide() { this.m.visible = false; }
}

/* ------------------------------------------------------------------ lattice cage */
export class Cage {
  constructor(scene, radius = 1.5) {
    const ico = new THREE.IcosahedronGeometry(radius, 1); const pos = ico.attributes.position; const seen = new Map(); this.edges = [];
    const key = (a, b) => { const ka = a.toArray().map((x) => x.toFixed(3)).join(','), kb = b.toArray().map((x) => x.toFixed(3)).join(','); return ka < kb ? ka + '|' + kb : kb + '|' + ka; };
    for (let i = 0; i < pos.count; i += 3) for (let j = 0; j < 3; j++) { const a = new THREE.Vector3().fromBufferAttribute(pos, i + j), b = new THREE.Vector3().fromBufferAttribute(pos, i + (j + 1) % 3); const k = key(a, b); if (!seen.has(k)) { seen.set(k, 1); this.edges.push([a, b]); } }
    const geo = new THREE.CylinderGeometry(0.02, 0.02, 1, 5); geo.translate(0, 0.5, 0);
    this.mat = new THREE.MeshBasicMaterial({ color: hdr(1.25, 0.62, 0.17) });
    this.mesh = new THREE.InstancedMesh(geo, this.mat, this.edges.length); this.mesh.frustumCulled = false; this.g = new THREE.Group(); this.g.add(this.mesh); scene.add(this.g); this.g.visible = false;
    this.nodes = [...new Set(this.edges.flat().map((v) => v.toArray().map((x) => x.toFixed(3)).join(',')))].map((s) => new THREE.Vector3(...s.split(',').map(Number)));
    const ng = new THREE.OctahedronGeometry(0.06, 0); this.nodeMesh = new THREE.InstancedMesh(ng, this.mat, this.nodes.length); this.g.add(this.nodeMesh);
    this.edges.sort((p, q) => (p[0].y + p[1].y) - (q[0].y + q[1].y)); this.col = this.mat.color.clone();
  }
  update(center, k, s, heat = 0) {
    this.g.visible = k > 0.001; if (!this.g.visible) return; this.g.position.copy(center); this.g.rotation.y = s * 0.6;
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), d = new THREE.Vector3(), sc = new THREE.Vector3(); const n = this.edges.length;
    this.edges.forEach(([a, b], i) => { const u = clamp(k * 1.6 - (i / n) * 0.6); d.copy(b).sub(a); const len = d.length(); q.setFromUnitVectors(Yv, d.normalize()); sc.set(1, Math.max(0.001, len * E.out3(u)), 1); m.compose(a, q, sc); this.mesh.setMatrixAt(i, m); });
    this.mesh.instanceMatrix.needsUpdate = true;
    this.nodes.forEach((p, i) => { const u = clamp(k * 1.6 - ((p.y + 1.5) / 3) * 0.6); sc.setScalar(Math.max(0.001, E.outBack(u))); q.identity(); m.compose(p, q, sc); this.nodeMesh.setMatrixAt(i, m); });
    this.nodeMesh.instanceMatrix.needsUpdate = true;
    this.mat.color.copy(this.col).lerp(hdr(1.6, 1.7, 1.8), heat);
  }
  burst(fx, center) { this.g.visible = false; for (const [a, b] of this.edges) { const p = a.clone().add(b).multiplyScalar(0.5).add(center); fx.shards(p, 3, { col: hdr(1.9, 1.0, 0.32), speed: 10, dir: a.clone().normalize(), spread: 0.6, size: 0.14, life: 1.2 }); fx.sparks(p, 5, { col: PAL.gold, speed: 10, dir: a.clone().normalize(), spread: 0.8, life: 0.7 }); } }
}

/* ------------------------------------------------------------------ dynamic tube (whip, command links, path lines) */
export class Tube {
  constructor(scene, color, { n = 48, m = 6, radius = 0.03, dashed = false } = {}) {
    this.n = n; this.m = m; this.radius = radius;
    const g = new THREE.BufferGeometry(); this.pos = new Float32Array((n + 1) * m * 3); this.uv = new Float32Array((n + 1) * m * 2);
    const idx = []; for (let i = 0; i < n; i++) for (let j = 0; j < m; j++) { const a = i * m + j, b = i * m + (j + 1) % m, c = a + m, d = b + m; idx.push(a, c, b, b, c, d); }
    for (let i = 0; i <= n; i++) for (let j = 0; j < m; j++) { this.uv[(i * m + j) * 2] = i / n; this.uv[(i * m + j) * 2 + 1] = j / m; }
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2)); g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
      uniforms: { uColor: { value: color.clone() }, uA: { value: 1 }, uReveal: { value: 1 }, uDash: { value: dashed ? 1 : 0 }, uTime: { value: 0 }, uHead: { value: 0 }, uDashN: { value: 60 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `precision highp float; varying vec2 vUv; uniform vec3 uColor; uniform float uA, uReveal, uDash, uTime, uHead, uDashN;
        void main(){ float a = step(vUv.x, uReveal); float dash = mix(1.0, step(0.45, fract(vUv.x * uDashN - uTime * 2.0)), uDash); float head = exp(-pow((vUv.x - uReveal) / 0.03, 2.0)) * uHead;
          gl_FragColor = vec4(uColor * (a * dash + head * 3.0) * uA, 1.0); }` });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; this.mesh.visible = false; scene.add(this.mesh); this.geo = g;
    this._t = new THREE.Vector3(); this._n = new THREE.Vector3(); this._b = new THREE.Vector3(); this._p = new THREE.Vector3();
  }
  // pts: array of Vector3 (resampled to n+1); taper: radius multiplier fn(u)
  setPoints(pts, taper) {
    const curve = pts.length > 2 ? new THREE.CatmullRomCurve3(pts, false, 'centripetal') : null; const n = this.n, m = this.m; const up = new THREE.Vector3(0, 1, 0);
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const u = i / n; const p = curve ? curve.getPoint(u, this._p) : this._p.lerpVectors(pts[0], pts[1], u);
      const tg = curve ? curve.getTangent(u, this._t) : this._t.copy(pts[1]).sub(pts[0]).normalize();
      this._n.crossVectors(tg, Math.abs(tg.y) > 0.95 ? new THREE.Vector3(1, 0, 0) : up).normalize(); this._b.crossVectors(tg, this._n).normalize();
      const r = this.radius * (taper ? taper(u) : 1);
      for (let j = 0; j < m; j++) { const a = j / m * Math.PI * 2, c = Math.cos(a) * r, s = Math.sin(a) * r; const o = (i * m + j) * 3;
        this.pos[o] = p.x + this._n.x * c + this._b.x * s; this.pos[o + 1] = p.y + this._n.y * c + this._b.y * s; this.pos[o + 2] = p.z + this._n.z * c + this._b.z * s; }
    }
    this.geo.attributes.position.needsUpdate = true; this.mesh.visible = true; return curve;
  }
  hide() { this.mesh.visible = false; }
}

/* ------------------------------------------------------------------ scan plane + reticles */
export function buildScan(scene) {
  const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, uniforms: { uA: { value: 0 }, uTime: { value: 0 } },
    vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
    fragmentShader: `precision highp float; varying vec2 vUv; uniform float uA, uTime;
      void main(){ vec2 p = vUv; float g = smoothstep(0.46, 0.5, abs(fract(p.x * 14.0) - 0.5)) + smoothstep(0.46, 0.5, abs(fract(p.y * 9.0 + uTime * 1.5) - 0.5));
        float edge = smoothstep(0.03, 0.0, min(min(p.x, 1.0 - p.x), min(p.y, 1.0 - p.y)));
        float fade = smoothstep(0.0, 0.25, p.y) * smoothstep(0.0, 0.1, p.x) * smoothstep(1.0, 0.9, p.x);
        gl_FragColor = vec4(vec3(0.2, 0.95, 1.4) * (0.025 + g * 0.3 + edge * 0.9) * uA * mix(fade, 1.0, edge), 1.0); }` });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(7, 4.6), mat); plane.rotation.y = Math.PI / 2; plane.visible = false; scene.add(plane);
  // reticle texture
  const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d'); g.strokeStyle = '#fff'; g.lineWidth = 7; g.lineCap = 'square';
  const L = 58, M = 26; for (const [sx, sy] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) { g.beginPath(); g.moveTo(128 + sx * (128 - M), 128 + sy * (128 - M - L)); g.lineTo(128 + sx * (128 - M), 128 + sy * (128 - M)); g.lineTo(128 + sx * (128 - M - L), 128 + sy * (128 - M)); g.stroke(); }
  g.lineWidth = 5; g.beginPath(); g.arc(128, 128, 40, 0, 7); g.stroke(); g.beginPath(); g.moveTo(128, 70); g.lineTo(128, 106); g.moveTo(128, 150); g.lineTo(128, 186); g.moveTo(70, 128); g.lineTo(106, 128); g.moveTo(150, 128); g.lineTo(186, 128); g.stroke();
  g.fillStyle = '#fff'; g.beginPath(); g.arc(128, 128, 7, 0, 7); g.fill();
  const tex = new THREE.CanvasTexture(c);
  const rets = [];
  for (let i = 0; i < 6; i++) { const sm = new THREE.SpriteMaterial({ map: tex, color: hdr(0.6, 2.0, 2.6), transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending }); const sp = new THREE.Sprite(sm); sp.visible = false; sp.renderOrder = 6; scene.add(sp); rets.push({ sp, sm, t0: 1e9, t1: 1e9, pos: new THREE.Vector3() }); }
  return {
    plane, mat, rets,
    setPlane(x, y, z, a, t) { plane.visible = a > 0.01; plane.position.set(x, y, z); mat.uniforms.uA.value = a; mat.uniforms.uTime.value = t; },
    lock(i, pos, s, dur = 9) { const r = rets[i]; r.pos.copy(pos); r.t0 = s; r.t1 = s + dur; },
    release(i, s) { rets[i].t1 = s; },
    update(s) { for (const r of rets) { const u = s - r.t0; const on = u > 0 && s < r.t1 + 0.12; r.sp.visible = on; if (!on) continue; const k = clamp(u / 0.22); const out = clamp((s - r.t1) / 0.12);
      r.sp.position.copy(r.pos); const sc = lerp(2.4, 0.62, E.out3(k)) * (1 + out * 1.2); r.sp.scale.setScalar(sc); r.sm.rotation = (1 - E.out3(k)) * 1.6; r.sm.opacity = (k < 1 ? 0.5 + 0.5 * Math.sin(u * 90) : 0.85 + 0.15 * Math.sin(u * 14)) * (1 - out); } },
  };
}

/* ------------------------------------------------------------------ flying glaive shards */
export function buildGlaives(scene, n, TrailCls) {
  const geo = new THREE.OctahedronGeometry(1, 0); const out = [];
  for (let i = 0; i < n; i++) { const mat = new THREE.MeshBasicMaterial({ color: hdr(1.6, 0.8, 0.2) }); const m = new THREE.Mesh(geo, mat); m.scale.set(0.085, 0.62, 0.03); m.visible = false; scene.add(m);
    out.push({ m, mat, trail: new TrailCls(scene, hdr(1.5, 0.72, 0.2), { n: 30, life: 0.16 }), prev: new THREE.Vector3(), alive: false }); }
  return out;
}

/* ------------------------------------------------------------------ final lotus construct */
export class Lotus {
  constructor(scene) {
    this.g = new THREE.Group(); scene.add(this.g); this.g.visible = false; this.petals = [];
    const geo = new THREE.PlaneGeometry(1, 1);
    const rings = [[8, 0.55, 0.62, 0.9, 0.35], [12, 1.05, 0.8, 1.25, 0.6], [16, 1.6, 0.62, 1.05, 0.95]];
    rings.forEach(([cnt, rad, w, h, cone], ri) => { for (let i = 0; i < cnt; i++) { const mat = panelMat(ri === 1 ? hdr(1.15, 0.5, 0.15) : hdr(1.1, 0.62, 0.2), 3); const m = new THREE.Mesh(geo, mat);
      const pivot = new THREE.Group(); pivot.add(m); this.g.add(pivot); m.scale.set(w, h, 1); this.petals.push({ m, mat, pivot, a: i / cnt * Math.PI * 2 + ri * 0.2, rad, ri, cone, delay: ri * 0.35 + (i / cnt) * 0.45, w, h }); } });
    this.core = new THREE.Mesh(new THREE.TorusGeometry(0.3, 0.025, 8, 48), new THREE.MeshBasicMaterial({ color: hdr(1.6, 0.85, 0.25) })); this.g.add(this.core);
    this.core2 = new THREE.Mesh(new THREE.TorusGeometry(2.05, 0.018, 8, 96), new THREE.MeshBasicMaterial({ color: hdr(1.0, 0.5, 0.16) })); this.g.add(this.core2);
  }
  // k: build 0..1 (may exceed for extra rings), spin
  update(pos, dirX, k, s, t, extra = 0) {
    this.g.visible = k > 0.001; if (!this.g.visible) return; this.g.position.copy(pos); this.g.rotation.y = dirX > 0 ? Math.PI / 2 : -Math.PI / 2;
    for (const p of this.petals) { const u = clamp((k * 1.9 - p.delay) / 0.5); const sc = E.outBack(u);
      const a = p.a + s * (p.ri % 2 ? -0.7 : 0.5) * (1 + extra);
      p.pivot.rotation.set(0, 0, a); p.m.position.set(0, p.rad * (0.4 + 0.6 * E.out3(u)) * (1 + extra * 0.12 * p.ri), 0.25 * p.ri * (1 - u) - p.ri * 0.12); p.m.rotation.x = -p.cone * (0.6 + 0.4 * u);
      p.m.scale.set(p.w * sc, p.h * sc, 1); p.m.visible = u > 0; p.mat.uniforms.uTime.value = t; p.mat.uniforms.uA.value = Math.min(1, u * 2) * (0.8 + extra * 0.5); }
    const cu = clamp(k * 2); this.core.scale.setScalar(E.outBack(cu) * (1 + 0.1 * Math.sin(s * 20))); this.core2.scale.setScalar(E.out3(clamp(k * 1.4 - 0.4))); this.core2.rotation.z = -s * 0.4;
  }
  burst(fx) { if (!this.g.visible) return; for (const p of this.petals) { const w = p.m.getWorldPosition(new THREE.Vector3()); fx.shards(w, 6, { col: hdr(1.9, 1.0, 0.32), speed: 12, size: 0.2, life: 1.8, dir: w.clone().sub(this.g.position).normalize(), spread: 0.8 }); } this.g.visible = false; }
}

/* Codex's counterpart: a minimal stack of hex lenses */
export class LensStack {
  constructor(scene) { this.g = new THREE.Group(); scene.add(this.g); this.g.visible = false; this.rings = [];
    [[0.85, 0.0], [0.55, 0.7], [0.3, 1.25], [0.13, 1.65]].forEach(([r, z], i) => { const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.014 + 0.004 * (3 - i), 6, 6), new THREE.MeshBasicMaterial({ color: hdr(0.25, 1.0, 1.45) })); m.position.z = z; this.g.add(m); this.rings.push({ m, z, r }); }); }
  update(pos, dir, k, s, extra = 0) { this.g.visible = k > 0.001; if (!this.g.visible) return; this.g.position.copy(pos); this.g.quaternion.setFromUnitVectors(Zv, dir);
    this.rings.forEach((r, i) => { const u = clamp(k * 2.2 - i * 0.3); r.m.scale.setScalar(Math.max(0.001, E.outBack(u)) * (1 - extra * 0.25)); r.m.rotation.z = s * (i % 2 ? 2.5 : -2.0) * (1 + extra * 2) + i; r.m.position.z = r.z * (0.3 + 0.7 * E.out3(u)); }); }
}
