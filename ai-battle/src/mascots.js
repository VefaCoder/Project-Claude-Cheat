import * as THREE from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { clamp, lerp, Spring3, Spring1, hdr, PAL, V, mulberry } from './util.js';

const Y = new THREE.Vector3(0, 1, 0), Z = new THREE.Vector3(0, 0, 1);
const _v = new THREE.Vector3(), _v2 = new THREE.Vector3(), _q = new THREE.Quaternion(), _e = new THREE.Euler();

function roundedRect(w, h, r) {
  const s = new THREE.Shape(); const x = -w / 2, y = -h / 2;
  s.moveTo(x + r, y); s.lineTo(x + w - r, y); s.quadraticCurveTo(x + w, y, x + w, y + r); s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h); s.lineTo(x + r, y + h); s.quadraticCurveTo(x, y + h, x, y + h - r); s.lineTo(x, y + r); s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

export const ghostMaterial = (color) => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.FrontSide,
  uniforms: { uColor: { value: color.clone() }, uOpacity: { value: 1 } },
  vertexShader: `varying vec3 vN; varying vec3 vV; void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); vN = normalize(normalMatrix * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
  fragmentShader: `precision highp float; varying vec3 vN; varying vec3 vV; uniform vec3 uColor; uniform float uOpacity;
    void main(){ float f = pow(clamp(1.0 - abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0), 1.5); gl_FragColor = vec4(uColor * (0.10 + f * 1.1) * uOpacity, 1.0); }`,
});

const MOODS = {
  claude: { neutral: [1, 1, 0], calm: [1, 0.86, 0], focus: [1.05, 0.72, 0.2], fierce: [1.12, 0.6, 0.34], wide: [1.1, 1.2, 0], hurt: [1.0, 0.3, -0.28], closed: [1, 0.07, 0] },
  codex: { neutral: [1, 1, 0], calm: [1, 0.8, 0], focus: [1.05, 0.5, 0.1], fierce: [1.1, 0.6, 0.24], wide: [0.95, 1.5, 0], hurt: [0.8, 0.4, -0.22], closed: [1, 0.08, 0], line: [1.3, 0.2, 0] },
};

export class Mascot {
  constructor(kind, scene, { ghost = false, ghostColor = null } = {}) {
    this.kind = kind; this.ghost = ghost; this.scene = scene;
    this.root = new THREE.Group(); this.tilt = new THREE.Group(); this.inner = new THREE.Group();
    this.tilt.position.y = 0.5; this.inner.position.y = -0.5; this.root.add(this.tilt); this.tilt.add(this.inner);
    this.headPivot = new THREE.Group(); this.headPivot.position.y = 0.84; this.inner.add(this.headPivot);
    this.hands = { L: new THREE.Group(), R: new THREE.Group() };
    scene.add(this.root, this.hands.L, this.hands.R);
    this.gmat = ghost ? ghostMaterial(ghostColor || PAL.gold) : null;
    this.eyes = []; this.flareMats = []; this.bodyMats = [];
    this.pos = new THREE.Vector3(); this.yaw = 0; this.prevPos = new THREE.Vector3(); this.vel = new THREE.Vector3(); this.speed = 0;
    this.velS = new Spring3(16, 1); this.hs = { L: new Spring3(34, 0.72), R: new Spring3(34, 0.72) }; this.bs = { L: new Spring3(30, 0.8), R: new Spring3(30, 0.8) };
    this.headYaw = new Spring1(14, 0.9); this.headPitch = new Spring1(14, 0.9);
    this.mood = [1, 1, 0]; this.blinkT = kind === 'claude' ? 1.7 : 2.6; this.blink = 0; this.rnd = mulberry(kind === 'claude' ? 11 : 23);
    this.hit = 0; this.damage = 0; this.flare = 0; this.t = 0; this.first = true;
    this.weapons = { L: {}, R: {} }; this.wScale = { L: new Spring1(26, 0.6), R: new Spring1(26, 0.6) }; this.form = { L: 'none', R: 'none' };
    if (kind === 'claude') this._buildClaude(); else this._buildCodex();
    this.chest = new THREE.Vector3(0, 0.74, 0);
  }

  mat(make, emissiveBoost = false) {
    if (this.ghost) return this.gmat;
    const m = make(); if (emissiveBoost !== null) this.bodyMats.push(m); return m;
  }
  glow(col) { if (this.ghost) return this.gmat; const m = new THREE.MeshBasicMaterial({ color: col.clone() }); m.userData.base = col.clone(); this.flareMats.push(m); return m; }
  add(parent, geo, mat, pos, rot, scl) { const m = new THREE.Mesh(geo, mat); if (pos) m.position.set(...pos); if (rot) m.rotation.set(...rot); if (scl) m.scale.set(...scl); parent.add(m); return m; }

  /* ------------------------------------------------------------ Claude */
  _buildClaude() {
    const cream = this.mat(() => new THREE.MeshPhysicalMaterial({ color: 0xead8bf, roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.3, sheen: 0.4, sheenColor: new THREE.Color(0xffc9a0), sheenRoughness: 0.5 }));
    const copper = this.mat(() => new THREE.MeshPhysicalMaterial({ color: 0xd0693f, metalness: 1.0, roughness: 0.26, clearcoat: 0.3 }));
    const visor = this.mat(() => new THREE.MeshPhysicalMaterial({ color: 0x120c09, roughness: 0.06, metalness: 0.3, clearcoat: 1.0, clearcoatRoughness: 0.04 }), null);
    // body — a small bell/cloak silhouette
    const prof = [[0.0, 0.0], [0.2, 0.015], [0.335, 0.07], [0.405, 0.19], [0.40, 0.33], [0.335, 0.5], [0.245, 0.66], [0.185, 0.76], [0.12, 0.815], [0.0, 0.83]];
    const cv = new THREE.CatmullRomCurve3(prof.map((p) => new THREE.Vector3(p[0], p[1], 0)), false, 'catmullrom', 0.4);
    const pts = cv.getPoints(48).map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));
    this.add(this.inner, new THREE.LatheGeometry(pts, 64), cream);
    this.add(this.inner, new THREE.TorusGeometry(0.398, 0.014, 10, 64), copper, [0, 0.27, 0], [Math.PI / 2, 0, 0]);
    this.add(this.inner, new THREE.TorusGeometry(0.19, 0.045, 14, 48), copper, [0, 0.80, 0], [Math.PI / 2, 0, 0]);
    this.add(this.inner, new THREE.OctahedronGeometry(0.055, 0), this.glow(PAL.amber), [0, 0.52, 0.335], [0, 0, 0], [0.8, 1.3, 0.5]);
    // hover base
    const baseRing = this.add(this.inner, new THREE.TorusGeometry(0.25, 0.018, 8, 48), this.glow(hdr(1.6, 0.7, 0.28)), [0, -0.12, 0], [Math.PI / 2, 0, 0]);
    this.baseRing = baseRing;
    // head
    const H = new THREE.Group(); H.position.y = 0.40; this.headPivot.add(H); this.head = H;
    this.add(H, new THREE.SphereGeometry(0.46, 64, 48), cream, null, null, [1.08, 0.95, 1.0]);
    this.add(H, new THREE.SphereGeometry(1, 48, 32), visor, [0, -0.005, 0.17], null, [0.365, 0.27, 0.33]);
    for (const sx of [-1, 1]) {
    }
    if (!this.ghost) {
      const eg = new THREE.ShapeGeometry(roundedRect(0.082, 0.185, 0.041), 12);
      for (const sx of [-1, 1]) {
        const g = new THREE.Group(); g.position.set(sx * 0.128, 0.008, 0.486); g.rotation.y = sx * 0.34; H.add(g);
        const m = new THREE.Mesh(eg, this.glow(hdr(2.4, 1.25, 0.36))); g.add(m); this.eyes.push({ m, sx });
      }
    }
    // crest: an irregular starburst floating behind the head
    const halo = new THREE.Group(); halo.position.set(0, 0.2, -0.47); H.add(halo); this.halo = halo; this.rays = [];
    const lens = [0.40, 0.25, 0.34, 0.22, 0.38, 0.28, 0.20, 0.36, 0.26, 0.32, 0.23];
    lens.forEach((len, i) => {
      const a = (i / lens.length) * Math.PI * 2 + (i % 3) * 0.07;
      const ray = new THREE.Mesh(new THREE.CapsuleGeometry(0.03, len, 6, 12), this.glow(hdr(1.75, 0.55, 0.19)));
      ray.scale.set(1, 1, 0.5);
      const p = new THREE.Group(); p.rotation.z = a; ray.position.y = 0.21 + len / 2; p.add(ray); halo.add(p); this.rays.push(p);
    });
    // hands
    for (const k of ['L', 'R']) {
      this.add(this.hands[k], new THREE.SphereGeometry(0.125, 32, 24), cream, null, null, [0.95, 0.86, 1.1]);
      this.add(this.hands[k], new THREE.TorusGeometry(0.088, 0.028, 10, 32), copper, [0, 0, -0.085]);
    }
    if (this.ghost) return;
    // weapons (local +Y is the blade axis)
    const W = this.weapons.R;
    { // quill blade
      const g = new THREE.Group(); const L = 1.42;
      const sh = new THREE.Shape(); const N = 28; const pl = [], pr = [];
      for (let i = 0; i <= N; i++) { const t = i / N; const cx = 0.20 * Math.sin(t * Math.PI * 0.9) * t, cy = t * L; const w = 0.095 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.62)), 0.75) + 0.004; pl.push([cx - w * 0.55, cy]); pr.push([cx + w, cy]); }
      sh.moveTo(pl[0][0], pl[0][1]); pl.forEach((p) => sh.lineTo(p[0], p[1])); pr.reverse().forEach((p) => sh.lineTo(p[0], p[1]));
      const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.018, bevelEnabled: true, bevelThickness: 0.012, bevelSize: 0.012, bevelSegments: 2, curveSegments: 4 }); geo.translate(0, 0.14, -0.009);
      const blade = new THREE.Mesh(geo, this.glow(hdr(1.9, 0.92, 0.24))); g.add(blade);
      this.add(g, new THREE.CylinderGeometry(0.03, 0.036, 0.34, 16), copper, [0, 0, 0]);
      this.add(g, new THREE.TorusGeometry(0.07, 0.022, 10, 32), copper, [0, 0.15, 0], [Math.PI / 2, 0, 0]);
      this.add(g, new THREE.SphereGeometry(0.045, 16, 12), copper, [0, -0.19, 0]);
      g.userData = { base: 0.2, tip: L + 0.12 }; W.blade = g;
    }
    { // twin-leaf blade (final form)
      const g = new THREE.Group(); const L = 1.5;
      for (const sgn of [-1, 1]) {
        const sh = new THREE.Shape(); const N = 24; const a = [], b = [];
        for (let i = 0; i <= N; i++) { const t = i / N; const cx = sgn * (0.035 + 0.11 * Math.sin(t * Math.PI) * (1 - t * 0.4)), cy = t * L; const w = 0.05 * Math.pow(Math.sin(Math.PI * Math.pow(t, 0.7)), 0.8) + 0.003; a.push([cx - w, cy]); b.push([cx + w, cy]); }
        sh.moveTo(a[0][0], a[0][1]); a.forEach((p) => sh.lineTo(p[0], p[1])); b.reverse().forEach((p) => sh.lineTo(p[0], p[1]));
        const geo = new THREE.ExtrudeGeometry(sh, { depth: 0.016, bevelEnabled: true, bevelThickness: 0.01, bevelSize: 0.01, bevelSegments: 2 }); geo.translate(0, 0.14, -0.008);
        g.add(new THREE.Mesh(geo, this.glow(hdr(2.0, 1.1, 0.34))));
      }
      this.add(g, new THREE.CylinderGeometry(0.03, 0.036, 0.34, 16), copper);
      this.add(g, new THREE.TorusGeometry(0.085, 0.02, 10, 32), copper, [0, 0.15, 0], [Math.PI / 2, 0, 0]);
      g.userData = { base: 0.2, tip: L + 0.12 }; W.blade2 = g;
    }
    { // hammer
      const g = new THREE.Group();
      this.add(g, new THREE.CylinderGeometry(0.03, 0.034, 1.35, 16), copper, [0, 0.5, 0]);
      const head = new THREE.Group(); head.position.y = 1.2; g.add(head);
      this.add(head, new THREE.CylinderGeometry(0.27, 0.27, 0.62, 6), this.glow(hdr(1.8, 0.85, 0.24)), null, [0, 0, Math.PI / 2]);
      this.add(head, new THREE.CylinderGeometry(0.31, 0.31, 0.08, 6), copper, [0.3, 0, 0], [0, 0, Math.PI / 2]);
      this.add(head, new THREE.CylinderGeometry(0.31, 0.31, 0.08, 6), copper, [-0.3, 0, 0], [0, 0, Math.PI / 2]);
      this.add(head, new THREE.TorusGeometry(0.36, 0.012, 8, 48), this.glow(hdr(2.4, 1.4, 0.5)), null, [0, Math.PI / 2, 0]);
      g.userData = { base: 0.9, tip: 1.5 }; W.hammer = g;
    }
    { // whip handle (ribbon itself is drawn by the vfx system)
      const g = new THREE.Group();
      this.add(g, new THREE.CylinderGeometry(0.03, 0.036, 0.34, 16), copper);
      this.add(g, new THREE.OctahedronGeometry(0.07, 0), this.glow(hdr(2.8, 1.5, 0.45)), [0, 0.24, 0], null, [0.7, 1.4, 0.7]);
      g.userData = { base: 0.2, tip: 0.36 }; W.whip = g;
    }
    for (const k in W) { W[k].visible = false; this.hands.R.add(W[k]); }
  }

  /* ------------------------------------------------------------ Codex */
  _buildCodex() {
    const white = this.mat(() => new THREE.MeshPhysicalMaterial({ color: 0xdde4ec, roughness: 0.28, clearcoat: 1.0, clearcoatRoughness: 0.14 }));
    const steel = this.mat(() => new THREE.MeshPhysicalMaterial({ color: 0x5d6b7c, metalness: 1.0, roughness: 0.24 }));
    const visor = this.mat(() => new THREE.MeshPhysicalMaterial({ color: 0x05080c, roughness: 0.05, metalness: 0.4, clearcoat: 1.0, clearcoatRoughness: 0.03 }), null);
    const body = this.add(this.inner, new THREE.CapsuleGeometry(0.27, 0.24, 12, 40), white, [0, 0.41, 0], null, [1.06, 1, 0.9]);
    this.add(this.inner, new THREE.TorusGeometry(0.283, 0.026, 10, 6), steel, [0, 0.28, 0], [Math.PI / 2, 0, Math.PI / 6], [1.06, 0.9, 1]);
    this.add(this.inner, new THREE.CylinderGeometry(0.075, 0.075, 0.03, 6), this.glow(PAL.cyan), [0, 0.5, 0.245], [Math.PI / 2, 0, 0]);
    this.add(this.inner, new THREE.CylinderGeometry(0.105, 0.105, 0.02, 6), steel, [0, 0.5, 0.236], [Math.PI / 2, 0, 0]);
    for (const sx of [-1, 1]) this.add(this.inner, new RoundedBoxGeometry(0.17, 0.14, 0.26, 5, 0.065), white, [sx * 0.33, 0.63, 0], [0, 0, -sx * 0.25]);
    this.add(this.inner, new THREE.TorusGeometry(0.15, 0.04, 10, 6), steel, [0, 0.79, 0], [Math.PI / 2, 0, Math.PI / 6]);
    this.baseRing = this.add(this.inner, new THREE.TorusGeometry(0.24, 0.02, 6, 6), this.glow(hdr(0.3, 1.3, 1.9)), [0, -0.1, 0], [Math.PI / 2, 0, Math.PI / 6]);
    const H = new THREE.Group(); H.position.y = 0.37; this.headPivot.add(H); this.head = H;
    this.add(H, new RoundedBoxGeometry(1.0, 0.66, 0.74, 8, 0.25), white);
    this.add(H, new RoundedBoxGeometry(0.80, 0.335, 0.2, 5, 0.1), visor, [0, 0.0, 0.305]);
    this.add(H, new RoundedBoxGeometry(1.02, 0.05, 0.5, 2, 0.02), steel, [0, -0.22, -0.02]);
    for (const sx of [-1, 1]) {
      const fin = this.add(H, new THREE.ConeGeometry(0.115, 0.3, 24), white, [sx * 0.33, 0.43, -0.06], [0, 0, -sx * 0.22], [1, 1, 0.42]);
      this.add(H, new THREE.ConeGeometry(0.05, 0.13, 24), this.glow(hdr(0.2, 0.9, 1.3)), [sx * 0.352, 0.535, -0.06], [0, 0, -sx * 0.22], [1, 1, 0.42]);
      this.add(H, new THREE.CylinderGeometry(0.07, 0.07, 0.03, 6), steel, [sx * 0.502, -0.02, -0.02], [0, 0, Math.PI / 2]);
    }
    if (!this.ghost) {
      const eg = new THREE.ShapeGeometry(roundedRect(0.2, 0.088, 0.026), 8);
      for (const sx of [-1, 1]) {
        const geo = eg.clone(); const p = geo.attributes.position; for (let i = 0; i < p.count; i++) p.setX(i, p.getX(i) - sx * p.getY(i) * 0.45);
        const g = new THREE.Group(); g.position.set(sx * 0.19, 0.0, 0.408); H.add(g);
        const m = new THREE.Mesh(geo, this.glow(hdr(0.3, 1.7, 2.4))); g.add(m); this.eyes.push({ m, sx });
      }
    }
    // back ring: interlocked hexagonal loops
    const ring = new THREE.Group(); ring.position.set(0, 0.78, -0.46); this.inner.add(ring); this.halo = ring; this.rays = [];
    this.add(ring, new THREE.TorusGeometry(0.44, 0.03, 6, 6), steel);
    this.ringGlow = this.add(ring, new THREE.TorusGeometry(0.35, 0.012, 6, 6), this.glow(hdr(0.35, 1.6, 2.3)), [0, 0, 0.01], [0, 0, Math.PI / 6]);
    for (let i = 0; i < 6; i++) { const a = i / 6 * Math.PI * 2; const n = this.add(ring, new THREE.BoxGeometry(0.07, 0.07, 0.05), white, [Math.cos(a) * 0.44, Math.sin(a) * 0.44, 0], [0, 0, a]); this.rays.push(n); }
    for (const k of ['L', 'R']) {
      this.add(this.hands[k], new RoundedBoxGeometry(0.21, 0.18, 0.27, 5, 0.075), white);
      this.add(this.hands[k], new THREE.TorusGeometry(0.085, 0.016, 8, 6), this.glow(hdr(0.35, 1.6, 2.3)), [0, 0, -0.04]);
    }
    if (this.ghost) return;
    const mkLance = (L, r) => {
      const g = new THREE.Group();
      const geo = new THREE.CylinderGeometry(0.0, r, L, 4); geo.translate(0, L / 2 + 0.16, 0);
      g.add(new THREE.Mesh(geo, this.glow(hdr(0.42, 1.35, 1.9))));
      const geo2 = new THREE.CylinderGeometry(r, 0.0, 0.14, 4); geo2.translate(0, 0.09, 0); g.add(new THREE.Mesh(geo2, this.glow(hdr(0.42, 1.35, 1.9))));
      this.add(g, new THREE.CylinderGeometry(0.026, 0.026, 0.3, 6), steel, [0, -0.02, 0]);
      this.add(g, new THREE.BoxGeometry(0.2, 0.025, 0.05), steel, [0, 0.03, 0]);
      g.userData = { base: 0.16, tip: L + 0.16 }; return g;
    };
    this.weapons.R.lance = mkLance(1.25, 0.038); this.weapons.L.lance = mkLance(1.25, 0.038); this.weapons.R.single = mkLance(1.75, 0.03);
    for (const k of ['L', 'R']) for (const n in this.weapons[k]) { this.weapons[k][n].visible = false; this.hands[k].add(this.weapons[k][n]); }
  }

  setWeapon(side, form, instant = false) {
    if (this.form[side] === form) return;
    this.form[side] = form; this.wScale[side].snap(instant ? 1 : 0.05);
    for (const n in this.weapons[side]) this.weapons[side][n].visible = n === form;
  }
  weaponPoint(side, which, out = new THREE.Vector3()) {
    const w = this.weapons[side][this.form[side]];
    if (!w) return this.hands[side].getWorldPosition(out);
    return out.set(0, w.userData[which], 0).applyMatrix4(w.matrixWorld);
  }
  headWorld(out = new THREE.Vector3()) { return this.head.getWorldPosition(out); }
  chestWorld(out = new THREE.Vector3()) { return out.set(0, 0.25, 0).applyMatrix4(this.tilt.matrixWorld); }

  /* P: {pos, yaw, handL, handR, bladeL, bladeR, mood, look, squash, flare, tumble:[x,z], spin, visible, lean} */
  set(s, ds, P) {
    this.t = s;
    const vis = P.visible !== false;
    this.root.visible = vis; this.hands.L.visible = vis; this.hands.R.visible = vis;
    this.pos.copy(P.pos);
    if (this.first) { this.prevPos.copy(P.pos); this.velS.snap(V()); }
    if (ds > 1e-6) { _v.copy(P.pos).sub(this.prevPos).divideScalar(ds); if (_v.length() > 160) _v.setLength(160); this.vel.copy(this.velS.step(_v, ds)); this.prevPos.copy(P.pos); }
    this.speed = this.vel.length();
    this.yaw = P.yaw;
    const bob = Math.sin(s * 2.3 + (this.kind === 'claude' ? 0 : 1.7)) * 0.035;
    this.root.position.set(P.pos.x, P.pos.y + 0.24 + bob, P.pos.z);
    this.root.rotation.set(0, P.yaw + (P.spin || 0), 0);
    // lean into motion
    const cy = Math.cos(-P.yaw), sy = Math.sin(-P.yaw);
    const lx = this.vel.x * cy + this.vel.z * sy, lz = -this.vel.x * sy + this.vel.z * cy;
    const k = this.kind === 'claude' ? 0.05 : 0.06;
    let rx = Math.atan(lz * k) * 0.95 - this.vel.y * 0.012, rz = -Math.atan(lx * k) * 0.95;
    if (P.lean) { rx += P.lean[0]; rz += P.lean[1]; }
    if (P.tumble) { rx += P.tumble; }
    this.tilt.rotation.set(rx, 0, rz);
    const st = clamp(this.speed * 0.007, 0, 0.28), sq = P.squash || 0;
    this.tilt.scale.set(1 - st * 0.45 - sq * 0.5, 1 + st + sq, 1 - st * 0.45 - sq * 0.5);
    this.root.updateMatrixWorld(true);
    // head look
    if (P.look) {
      _v.copy(P.look); this.inner.worldToLocal(_v); _v.y -= 1.2;
      const ty = clamp(Math.atan2(_v.x, _v.z), -1.0, 1.0), tp = clamp(-Math.atan2(_v.y, Math.hypot(_v.x, _v.z)), -0.6, 0.6);
      if (this.first) { this.headYaw.snap(ty); this.headPitch.snap(tp); }
      this.headPivot.rotation.set(this.headPitch.step(tp, ds) - rx * 0.6 + (P.nod || 0), this.headYaw.step(ty, ds), -rz * 0.4 + (P.headTilt || 0));
    }
    // hands (world-space springs give drag & follow-through)
    for (const side of ['L', 'R']) {
      const loc = side === 'L' ? P.handL : P.handR; const h = this.hands[side];
      _v.set(loc.x, loc.y - 0.5, loc.z).applyMatrix4(this.tilt.matrixWorld);
      if (this.first) this.hs[side].snap(_v);
      h.position.copy(this.hs[side].step(_v, ds));
      const bl = side === 'L' ? P.bladeL : P.bladeR;
      _v2.set(bl.x, bl.y, bl.z).normalize().transformDirection(this.tilt.matrixWorld);
      if (this.first) this.bs[side].snap(_v2);
      _v2.copy(this.bs[side].step(_v2, ds)).normalize();
      h.quaternion.setFromUnitVectors(Y, _v2);
      const ws = this.wScale[side].step(1, ds);
      const w = this.weapons[side][this.form[side]]; if (w) w.scale.setScalar(Math.max(0.001, ws) * (P.wscale ?? 1));
      h.updateMatrixWorld(true);
    }
    // face
    if (!this.ghost) {
      const md = MOODS[this.kind][P.mood || 'neutral'] || MOODS[this.kind].neutral;
      const a = ds > 0 ? 1 - Math.exp(-ds * 16) : 0;
      for (let i = 0; i < 3; i++) this.mood[i] = lerp(this.mood[i], md[i], this.first ? 1 : a);
      this.blinkT -= ds; if (this.blinkT < 0) { this.blinkT = 2.2 + this.rnd() * 2.5; this.blink = 1; }
      this.blink = Math.max(0, this.blink - ds * 9);
      const bl = 1 - Math.sin(Math.min(1, this.blink) * Math.PI) * 0.92;
      const glitch = this.damage > 0 ? (Math.sin(s * 47) * Math.sin(s * 31.7) > 1 - this.damage * 0.5 ? 0.25 : 1) : 1;
      for (const e of this.eyes) { e.m.scale.set(this.mood[0], this.mood[1] * bl, 1); e.m.rotation.z = e.sx * this.mood[2]; e.m.material.color.copy(e.m.material.userData.base).multiplyScalar((0.9 + (P.flare || 0) * 0.35) * glitch); }
      // crest / ring
      this.flare = P.flare || 0;
      if (this.kind === 'claude') {
        this.halo.rotation.z = s * 0.35 + (P.haloSpin || 0);
        this.halo.scale.setScalar(1 + this.flare * 0.28);
        this.rays.forEach((r, i) => { r.scale.y = 1 + 0.06 * Math.sin(s * 3 + i * 1.7) + this.flare * 0.25 * (0.5 + 0.5 * Math.sin(s * 9 + i * 2.3)); r.visible = !(this.damage > 0.5 && (i === 2 || i === 5 || i === 9)); });
      } else {
        this.halo.rotation.z = -s * 0.5 - (P.haloSpin || 0);
        this.halo.scale.setScalar(1 + this.flare * 0.15);
      }
      const fb = 0.8 + this.flare * 0.55;
      for (const m of this.flareMats) if (!this.eyes.some((e) => e.m.material === m)) m.color.copy(m.userData.base).multiplyScalar(fb);
      this.hit = Math.max(0, this.hit - ds * 7);
      for (const m of this.bodyMats) { if (!m.emissive) continue; m.emissive.setRGB(this.hit * 1.6, this.hit * 1.6, this.hit * 1.6); }
    }
    this.first = false;
  }

  snapshot() {
    return { rp: this.root.position.clone(), ry: this.root.rotation.y, tr: this.tilt.rotation.clone(), ts: this.tilt.scale.clone(), hr: this.headPivot.rotation.clone(),
      hl: this.hands.L.position.clone(), hlq: this.hands.L.quaternion.clone(), hrp: this.hands.R.position.clone(), hrq: this.hands.R.quaternion.clone() };
  }
  applySnapshot(S, opacity) {
    const v = opacity > 0.003; this.root.visible = v; this.hands.L.visible = v; this.hands.R.visible = v;
    if (!v) return;
    this.root.position.copy(S.rp); this.root.rotation.y = S.ry; this.tilt.rotation.copy(S.tr); this.tilt.scale.copy(S.ts); this.headPivot.rotation.copy(S.hr);
    this.hands.L.position.copy(S.hl); this.hands.L.quaternion.copy(S.hlq); this.hands.R.position.copy(S.hrp); this.hands.R.quaternion.copy(S.hrq);
    this.gmat.uniforms.uOpacity.value = opacity;
  }
  hide() { this.root.visible = false; this.hands.L.visible = false; this.hands.R.visible = false; }
}
