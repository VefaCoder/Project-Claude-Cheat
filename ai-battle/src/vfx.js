import * as THREE from 'three';
import { clamp, lerp, R, rr, randDir, hdr, PAL, V, E } from './util.js';

const Yv = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3(), _b = new THREE.Vector3(), _c = new THREE.Vector3(), _q = new THREE.Quaternion(), _m = new THREE.Matrix4(), _s = new THREE.Vector3();

/* ------------------------------------------------------------------ blade / ribbon trail */
export class Trail {
  constructor(scene, color, { n = 44, life = 0.2, opacity = 1 } = {}) {
    this.n = n; this.life = life; this.pts = []; this.color = color;
    const g = new THREE.BufferGeometry();
    this.pos = new Float32Array(n * 2 * 3); this.uv = new Float32Array(n * 2 * 2);
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3)); g.setAttribute('uv', new THREE.BufferAttribute(this.uv, 2));
    const idx = []; for (let i = 0; i < n - 1; i++) { const a = i * 2; idx.push(a, a + 1, a + 2, a + 1, a + 3, a + 2); }
    g.setIndex(idx);
    this.mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: color.clone() }, uOpacity: { value: opacity } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `precision highp float; varying vec2 vUv; uniform vec3 uColor; uniform float uOpacity;
        void main(){ float age = clamp(vUv.x, 0.0, 1.0); float vy = clamp(vUv.y, 0.0, 1.0); float a = pow(1.0 - age, 1.8) * smoothstep(0.0, 0.08, 1.0 - age);
          float w = smoothstep(0.0, 0.5, vy) * (0.06 + 0.94 * pow(vy, 5.0));
          gl_FragColor = vec4(uColor * a * w * uOpacity * 0.42, 1.0); }`,
    });
    this.mesh = new THREE.Mesh(g, this.mat); this.mesh.frustumCulled = false; scene.add(this.mesh); this.geo = g; this.on = false;
  }
  push(base, tip, s) { this.pts.unshift({ b: base.clone(), t: tip.clone(), s }); if (this.pts.length > this.n) this.pts.pop(); }
  clear() { this.pts.length = 0; }
  update(s) {
    while (this.pts.length && s - this.pts[this.pts.length - 1].s > this.life) this.pts.pop();
    const m = this.pts.length;
    for (let i = 0; i < this.n; i++) {
      const p = this.pts[Math.min(i, m - 1)]; const o = i * 6, u = i * 4;
      if (!p) { this.pos.fill(0, o, o + 6); continue; }
      this.pos[o] = p.b.x; this.pos[o + 1] = p.b.y; this.pos[o + 2] = p.b.z; this.pos[o + 3] = p.t.x; this.pos[o + 4] = p.t.y; this.pos[o + 5] = p.t.z;
      const age = i < m ? clamp((s - p.s) / this.life) : 1;
      this.uv[u] = age; this.uv[u + 1] = 0; this.uv[u + 2] = age; this.uv[u + 3] = 1;
    }
    this.geo.attributes.position.needsUpdate = true; this.geo.attributes.uv.needsUpdate = true;
    this.mesh.visible = m > 1;
  }
}

/* ------------------------------------------------------------------ main system */
export function buildVfx(scene, arena, camera) {
  const fx = { shakeAmt: 0, radial: 0, flashLights: [] };

  /* ---- streak particles */
  const MAXP = 9000;
  const P = { n: 0, pos: new Float32Array(MAXP * 3), vel: new Float32Array(MAXP * 3), col: new Float32Array(MAXP * 3), par: new Float32Array(MAXP * 3),
    life: new Float32Array(MAXP), max: new Float32Array(MAXP), grav: new Float32Array(MAXP), drag: new Float32Array(MAXP), size: new Float32Array(MAXP), bounce: new Uint8Array(MAXP) };
  {
    const g = new THREE.InstancedBufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-1, -1, 0, 1, -1, 0, 1, 1, 0, -1, 1, 0]), 3)); g.setIndex([0, 1, 2, 0, 2, 3]);
    P.aPos = new THREE.InstancedBufferAttribute(P.pos, 3).setUsage(THREE.DynamicDrawUsage); P.aVel = new THREE.InstancedBufferAttribute(P.vel, 3).setUsage(THREE.DynamicDrawUsage);
    P.aCol = new THREE.InstancedBufferAttribute(P.col, 3).setUsage(THREE.DynamicDrawUsage); P.aPar = new THREE.InstancedBufferAttribute(P.par, 3).setUsage(THREE.DynamicDrawUsage);
    g.setAttribute('iPos', P.aPos); g.setAttribute('iVel', P.aVel); g.setAttribute('iCol', P.aCol); g.setAttribute('iPar', P.aPar);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: /* glsl */`attribute vec3 iPos, iVel, iCol, iPar; varying vec2 vUv; varying vec3 vCol; varying float vL;
        void main(){ vec4 mv = viewMatrix * vec4(iPos, 1.0); vec3 vv = (viewMatrix * vec4(iVel, 0.0)).xyz;
          float sp = length(vv.xy); vec2 d = sp > 1e-4 ? vv.xy / sp : vec2(1.0, 0.0);
          float size = iPar.x; float len = size * (1.0 + iPar.z * sp);
          mv.xy += position.x * d * len + position.y * vec2(-d.y, d.x) * size;
          vUv = position.xy; vCol = iCol; vL = iPar.y; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `precision highp float; varying vec2 vUv; varying vec3 vCol; varying float vL;
        void main(){ float a = clamp((1.0 - vUv.y * vUv.y) * (1.0 - vUv.x * vUv.x), 0.0, 1.0); a = a * a; gl_FragColor = vec4(vCol * a * smoothstep(0.0, 0.35, vL) * (0.6 + 0.4 * vL), 1.0); }`,
    });
    P.mesh = new THREE.Mesh(g, mat); P.mesh.frustumCulled = false; P.geo = g; scene.add(P.mesh);
  }
  fx.sparks = (pos, n, o = {}) => {
    const col = o.col || PAL.gold, sp = o.speed ?? 8, spread = o.spread ?? 1, life = o.life ?? 0.6, size = o.size ?? 0.035;
    for (let k = 0; k < n && P.n < MAXP; k++) {
      const i = P.n++; randDir(_a);
      if (o.dir) { _a.multiplyScalar(spread).add(o.dir).normalize(); }
      if (o.flat) { _a.y *= o.flat; _a.normalize(); }
      const v = sp * (0.25 + 0.75 * R()) * (o.speedPow ? Math.pow(R(), o.speedPow) + 0.2 : 1);
      const r0 = o.radius ? o.radius * Math.cbrt(R()) : 0; randDir(_b).multiplyScalar(r0);
      P.pos[i * 3] = pos.x + _b.x; P.pos[i * 3 + 1] = pos.y + _b.y; P.pos[i * 3 + 2] = pos.z + _b.z;
      P.vel[i * 3] = _a.x * v + (o.add ? o.add.x : 0); P.vel[i * 3 + 1] = _a.y * v + (o.add ? o.add.y : 0); P.vel[i * 3 + 2] = _a.z * v + (o.add ? o.add.z : 0);
      const cv = 0.7 + 0.6 * R(); P.col[i * 3] = col.r * cv; P.col[i * 3 + 1] = col.g * cv; P.col[i * 3 + 2] = col.b * cv;
      P.max[i] = life * (0.5 + R()); P.life[i] = 1; P.grav[i] = o.grav ?? 9; P.drag[i] = o.drag ?? 1.2; P.size[i] = size * (0.6 + 0.8 * R());
      P.par[i * 3] = P.size[i]; P.par[i * 3 + 1] = 1; P.par[i * 3 + 2] = o.stretch ?? 0.035; P.bounce[i] = o.bounce === false ? 0 : 1;
    }
  };
  function stepParticles(ds) {
    let i = 0;
    while (i < P.n) {
      P.life[i] -= ds / P.max[i];
      if (P.life[i] <= 0) { // swap-remove
        const j = --P.n;
        if (i !== j) { for (let c = 0; c < 3; c++) { P.pos[i * 3 + c] = P.pos[j * 3 + c]; P.vel[i * 3 + c] = P.vel[j * 3 + c]; P.col[i * 3 + c] = P.col[j * 3 + c]; P.par[i * 3 + c] = P.par[j * 3 + c]; }
          P.life[i] = P.life[j]; P.max[i] = P.max[j]; P.grav[i] = P.grav[j]; P.drag[i] = P.drag[j]; P.size[i] = P.size[j]; P.bounce[i] = P.bounce[j]; }
        continue;
      }
      const d = Math.exp(-P.drag[i] * ds), o = i * 3;
      P.vel[o] *= d; P.vel[o + 1] = P.vel[o + 1] * d - P.grav[i] * ds; P.vel[o + 2] *= d;
      P.pos[o] += P.vel[o] * ds; P.pos[o + 1] += P.vel[o + 1] * ds; P.pos[o + 2] += P.vel[o + 2] * ds;
      if (P.bounce[i] && P.pos[o + 1] < 0.02 && P.vel[o + 1] < 0 && (P.pos[o] * P.pos[o] + P.pos[o + 2] * P.pos[o + 2]) < 240) { P.pos[o + 1] = 0.02; P.vel[o + 1] *= -0.35; P.vel[o] *= 0.7; P.vel[o + 2] *= 0.7; }
      P.par[o + 1] = P.life[i];
      i++;
    }
    P.geo.instanceCount = P.n; P.aPos.needsUpdate = true; P.aVel.needsUpdate = true; P.aCol.needsUpdate = true; P.aPar.needsUpdate = true;
    P.mesh.visible = P.n > 0;
  }

  /* ---- shards (UI splinters) */
  const MAXS = 1600;
  const S = { n: 0, pos: [], vel: [], axis: [], ang: new Float32Array(MAXS), av: new Float32Array(MAXS), life: new Float32Array(MAXS), max: new Float32Array(MAXS), scl: [], grav: new Float32Array(MAXS), col: new Float32Array(MAXS * 4), base: new Float32Array(MAXS * 3) };
  {
    for (let i = 0; i < MAXS; i++) { S.pos.push(new THREE.Vector3()); S.vel.push(new THREE.Vector3()); S.axis.push(new THREE.Vector3()); S.scl.push(new THREE.Vector3()); }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([-0.5, -0.3, 0, 0.6, -0.15, 0, 0.1, 0.55, 0, -0.35, 0.3, 0]), 3)); g.setIndex([0, 1, 2, 0, 2, 3]); g.computeVertexNormals();
    S.aCol = new THREE.InstancedBufferAttribute(S.col, 4).setUsage(THREE.DynamicDrawUsage); g.setAttribute('iCol', S.aCol);
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      vertexShader: `attribute vec4 iCol; varying vec4 vCol; varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){ vCol = iCol; vP = position; vec4 mv = modelViewMatrix * instanceMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * mat3(instanceMatrix) * normal); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `precision highp float; varying vec4 vCol; varying vec3 vN; varying vec3 vV; varying vec3 vP;
        void main(){ float g = clamp(abs(dot(normalize(vN + vec3(1e-5)), normalize(vV))), 0.0, 1.0); float gl = pow(g, 10.0); gl_FragColor = vec4(vCol.rgb * (0.22 + 2.4 * gl) * vCol.a, 1.0); }`,
    });
    S.mesh = new THREE.InstancedMesh(g, mat, MAXS); S.mesh.frustumCulled = false; S.mesh.count = 0; scene.add(S.mesh);
  }
  fx.shards = (pos, n, o = {}) => {
    const col = o.col || PAL.gold, sp = o.speed ?? 6, life = o.life ?? 1.4, size = o.size ?? 0.16;
    for (let k = 0; k < n && S.n < MAXS; k++) {
      const i = S.n++; randDir(_a); if (o.dir) _a.multiplyScalar(o.spread ?? 1).add(o.dir).normalize();
      const r0 = o.radius ? o.radius * Math.cbrt(R()) : 0; randDir(_b).multiplyScalar(r0); if (o.box) _b.set((R() - 0.5) * o.box.x, (R() - 0.5) * o.box.y, (R() - 0.5) * o.box.z);
      S.pos[i].set(pos.x + _b.x, pos.y + _b.y, pos.z + _b.z); S.vel[i].copy(_a).multiplyScalar(sp * (0.3 + 0.7 * R())); if (o.add) S.vel[i].add(o.add);
      randDir(S.axis[i]); S.ang[i] = R() * 6.28; S.av[i] = rr(3, 14); S.life[i] = 1; S.max[i] = life * (0.6 + 0.8 * R()); S.grav[i] = o.grav ?? 7;
      const sz = size * (0.4 + 1.2 * R()); S.scl[i].set(sz * rr(0.6, 1.6), sz, sz);
      const cv = 0.7 + 0.6 * R(); S.base[i * 3] = col.r * cv; S.base[i * 3 + 1] = col.g * cv; S.base[i * 3 + 2] = col.b * cv;
    }
  };
  function stepShards(ds) {
    let i = 0;
    while (i < S.n) {
      S.life[i] -= ds / S.max[i];
      if (S.life[i] <= 0) { const j = --S.n; if (i !== j) { S.pos[i].copy(S.pos[j]); S.vel[i].copy(S.vel[j]); S.axis[i].copy(S.axis[j]); S.scl[i].copy(S.scl[j]); S.ang[i] = S.ang[j]; S.av[i] = S.av[j]; S.life[i] = S.life[j]; S.max[i] = S.max[j]; S.grav[i] = S.grav[j]; for (let c = 0; c < 3; c++) S.base[i * 3 + c] = S.base[j * 3 + c]; } continue; }
      const v = S.vel[i], p = S.pos[i]; const d = Math.exp(-0.9 * ds); v.multiplyScalar(d); v.y -= S.grav[i] * ds; p.addScaledVector(v, ds); S.ang[i] += S.av[i] * ds;
      if (p.y < 0.03 && v.y < 0 && p.x * p.x + p.z * p.z < 240) { p.y = 0.03; v.y *= -0.3; v.x *= 0.6; v.z *= 0.6; S.av[i] *= 0.5; }
      _q.setFromAxisAngle(S.axis[i], S.ang[i]); _m.compose(p, _q, S.scl[i]); S.mesh.setMatrixAt(i, _m);
      const a = Math.min(1, S.life[i] * 3); S.col[i * 4] = S.base[i * 3]; S.col[i * 4 + 1] = S.base[i * 3 + 1]; S.col[i * 4 + 2] = S.base[i * 3 + 2]; S.col[i * 4 + 3] = a;
      i++;
    }
    S.mesh.count = S.n; S.mesh.instanceMatrix.needsUpdate = true; S.aCol.needsUpdate = true; S.mesh.visible = S.n > 0;
  }

  /* ---- shock rings (mesh) */
  const ringGeo = new THREE.PlaneGeometry(2, 2);
  const rings = [];
  for (let i = 0; i < 20; i++) {
    const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color() }, uA: { value: 0 }, uW: { value: 0.1 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv * 2.0 - 1.0; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `precision highp float; varying vec2 vUv; uniform vec3 uColor; uniform float uA, uW;
        void main(){ float r = length(vUv); float b = smoothstep(1.0 - uW, 1.0 - uW * 0.25, r) * smoothstep(1.0, 1.0 - uW * 0.12, r); float inner = smoothstep(0.3, 1.0, r) * step(r, 1.0) * 0.03; gl_FragColor = vec4(uColor * (b + inner) * uA, 1.0); }` });
    const m = new THREE.Mesh(ringGeo, mat); m.visible = false; m.frustumCulled = false; scene.add(m); rings.push({ m, mat, t: 1, life: 1 });
  }
  let ringI = 0;
  fx.ring = (pos, o = {}) => {
    const r = rings[ringI++ % rings.length]; r.t = 0; r.life = o.life ?? 0.5; r.r0 = o.r0 ?? 0.2; r.r1 = o.r1 ?? 4; r.k = o.k ?? 1; r.w = (o.width ?? 0.14) * 0.6;
    r.mat.uniforms.uColor.value.copy(o.col || PAL.white); r.m.position.copy(pos); r.face = !o.normal && !o.floor;
    if (o.floor) { r.m.rotation.set(-Math.PI / 2, 0, 0); r.m.position.y = Math.max(0.04, pos.y); } else if (o.normal) r.m.quaternion.setFromUnitVectors(new THREE.Vector3(0, 0, 1), o.normal.clone().normalize());
    r.m.visible = true;
  };
  /* ---- floor shader rings */
  const frings = [];
  fx.floorRing = (x, z, o = {}) => frings.push({ x, z, t: 0, life: o.life ?? 0.9, speed: o.speed ?? 14, k: o.k ?? 1, col: o.col || PAL.white, r0: o.r0 ?? 0 });

  /* ---- flashes */
  const flashes = [];
  for (let i = 0; i < 28; i++) {
    const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color() }, uA: { value: 0 }, uStreak: { value: 0 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv * 2.0 - 1.0; vec4 mv = modelViewMatrix * vec4(0.0, 0.0, 0.0, 1.0); vec2 sc = vec2(length(modelMatrix[0].xyz), length(modelMatrix[1].xyz)); mv.xy += position.xy * sc; gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `precision highp float; varying vec2 vUv; uniform vec3 uColor; uniform float uA, uStreak;
        void main(){ float r = length(vUv); float g = exp(-r * r * 14.0) * 1.1 + exp(-r * 4.0) * 0.07;
          float st = exp(-abs(vUv.y) * 90.0) * exp(-abs(vUv.x) * 2.6) * 0.7 + exp(-abs(vUv.x) * 140.0) * exp(-abs(vUv.y) * 6.0) * 0.25;
          float fade = smoothstep(1.0, 0.6, r); gl_FragColor = vec4(max(uColor * (g + st * uStreak) * uA * fade, 0.0), 1.0); }` });
    const m = new THREE.Mesh(ringGeo, mat); m.visible = false; m.frustumCulled = false; m.renderOrder = 5; scene.add(m); flashes.push({ m, mat, t: 1, life: 1 });
  }
  let flashI = 0;
  fx.flash = (pos, o = {}) => {
    const f = flashes[flashI++ % flashes.length]; f.t = 0; f.life = (o.life ?? 0.22) * 0.8; f.size = (o.size ?? 2) * 0.75; f.k = o.k ?? 1; f.mat.uniforms.uColor.value.copy(o.col || PAL.white); f.mat.uniforms.uStreak.value = o.streak ?? 1; f.m.position.copy(pos); f.m.visible = true; f.hold = o.hold ?? 0;
  };
  /* ---- persistent glow sprites (for charge-ups etc.), set every frame */
  const glows = [];
  for (let i = 0; i < 10; i++) { const f = { m: new THREE.Mesh(ringGeo, flashes[0].mat.clone()) }; f.mat = f.m.material; f.m.visible = false; f.m.frustumCulled = false; f.m.renderOrder = 5; scene.add(f.m); glows.push(f); }
  let glowI = 0;
  fx.glow = (pos, col, size, k = 1, streak = 0.6) => { const f = glows[glowI++]; if (!f) return; f.m.visible = true; f.m.position.copy(pos); f.m.scale.setScalar(size); f.mat.uniforms.uColor.value.copy(col); f.mat.uniforms.uA.value = k; f.mat.uniforms.uStreak.value = streak; };

  /* ---- temp lights */
  const tlights = [];
  fx.light = (pos, col, radius, life = 0.35, k = 1) => tlights.push({ pos: pos.clone(), col, radius, life, t: 0, k });
  const pl = []; for (let i = 0; i < 3; i++) { const l = new THREE.PointLight(0xffffff, 0, 14, 1.6); scene.add(l); pl.push(l); }
  fx.pointLights = pl;

  /* ---- beams */
  const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 20, 1, true); beamGeo.translate(0, 0.5, 0);
  const beams = [];
  for (let i = 0; i < 26; i++) {
    const mat = new THREE.ShaderMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending,
      uniforms: { uColor: { value: new THREE.Color() }, uA: { value: 1 }, uTime: { value: 0 }, uLen: { value: 1 }, uFlow: { value: 1 }, uCore: { value: 1 } },
      vertexShader: `varying vec2 vUv; varying vec3 vN; varying vec3 vV; void main(){ vUv = uv; vec4 mv = modelViewMatrix * vec4(position, 1.0); vN = normalize(normalMatrix * vec3(normal.x, 0.0, normal.z)); vV = normalize(-mv.xyz); gl_Position = projectionMatrix * mv; }`,
      fragmentShader: `precision highp float; varying vec2 vUv; varying vec3 vN; varying vec3 vV; uniform vec3 uColor; uniform float uA, uTime, uLen, uFlow, uCore;
        float hash(float n){ return fract(sin(n) * 43758.5453); }
        void main(){ float f = clamp(abs(dot(normalize(vN), normalize(vV))), 0.0, 1.0); float core = pow(f, 2.2);
          float y = vUv.y * uLen; float fl = 0.75 + 0.25 * sin(y * 3.0 - uTime * 40.0 * uFlow) * sin(y * 7.3 - uTime * 63.0 * uFlow + vUv.x * 12.0);
          vec3 c = uColor * core * fl + vec3(1.0) * pow(f, 9.0) * uCore * 1.2;
          float ends = smoothstep(0.0, 0.03, vUv.y);
          gl_FragColor = vec4(c * uA * ends * 0.5, 1.0); }` });
    const m = new THREE.Mesh(beamGeo, mat); m.visible = false; m.frustumCulled = false; scene.add(m); beams.push({ m, mat });
  }
  let beamI = 0;
  fx.beam = (a, b, col, width, alpha = 1, o = {}) => {
    const B = beams[beamI++]; if (!B) return; _a.copy(b).sub(a); const len = _a.length(); if (len < 1e-4) return;
    B.m.visible = true; B.m.position.copy(a); B.m.quaternion.setFromUnitVectors(Yv, _a.divideScalar(len)); B.m.scale.set(width, len, width);
    B.mat.uniforms.uColor.value.copy(col); B.mat.uniforms.uA.value = alpha; B.mat.uniforms.uLen.value = len; B.mat.uniforms.uFlow.value = o.flow ?? 1; B.mat.uniforms.uCore.value = o.core ?? 1;
  };

  /* ---- bolts (needle shots) */
  const bolts = [];
  fx.bolt = (a, b, o = {}) => bolts.push({ a: a.clone(), b: b.clone(), t: 0, speed: o.speed ?? 80, col: o.col || PAL.ice, len: o.len ?? 2.0, w: o.width ?? 0.03, onHit: o.onHit, done: false });

  /* ---- camera shake */
  fx.shake = (amt) => { fx.shakeAmt = Math.max(fx.shakeAmt, amt); };
  fx.punch = (amt) => { fx.radial = Math.max(fx.radial, amt); };

  /* ---- composite impact */
  fx.impact = (pos, col, power = 1, o = {}) => {
    const pw = Math.pow(power, 0.6);
    fx.flash(pos, { col: hdr(col.r, col.g, col.b, 0.9), size: 2.2 * pw, life: 0.16 + 0.05 * pw, streak: 1.0 });
    fx.flash(pos, { col: hdr(2.0, 2.0, 2.0), size: 0.7 * pw, life: 0.09 });
    fx.ring(pos, { col: hdr(col.r, col.g, col.b, 0.8), r0: 0.2, r1: 2.2 * pw, life: 0.32 + 0.08 * pw, width: 0.12 });
    fx.sparks(pos, Math.round(40 * power), { col, speed: 13 * Math.sqrt(power), life: 0.55, size: 0.026, dir: o.dir, spread: o.spread ?? 1.2, stretch: 0.03 });
    fx.sparks(pos, Math.round(12 * power), { col: PAL.white, speed: 7 * power, life: 0.3, size: 0.018, stretch: 0.03 });
    fx.light(pos, col, 3.0 * pw, 0.4, 1.2);
    if (o.floor !== false) fx.floorRing(pos.x, pos.z, { col: hdr(col.r, col.g, col.b, 0.7), speed: 16, life: 0.7, k: 0.8 * pw });
    fx.shake(0.06 * power); if (power >= 1) fx.punch(0.018 * power);
  };

  fx.update = (s, ds, t, dT = 1 / 60) => {
    stepParticles(ds); stepShards(ds);
    for (const r of rings) { if (!r.m.visible) continue; r.t += ds / r.life; if (r.t >= 1) { r.m.visible = false; continue; }
      const u = E.out3(r.t); r.m.scale.setScalar(lerp(r.r0, r.r1, u)); r.mat.uniforms.uA.value = (1 - r.t) * (1 - r.t) * 0.8 * r.k; r.mat.uniforms.uW.value = r.w * (1 - 0.5 * u); if (r.face) r.m.quaternion.copy(camera.quaternion); }
    for (let i = frings.length - 1; i >= 0; i--) { const f = frings[i]; f.t += ds; if (f.t > f.life) { frings.splice(i, 1); continue; } const u = f.t / f.life; arena.pushRing(f.x, f.z, f.r0 + f.speed * f.life * E.out2(u), (1 - u) * (1 - u) * f.k, f.col); }
    for (const f of flashes) { if (!f.m.visible) continue; f.t += dT / f.life; if (f.t >= 1) { f.m.visible = false; continue; } const u = f.t; f.m.scale.setScalar(f.size * (0.5 + 0.7 * E.out3(u))); f.mat.uniforms.uA.value = Math.pow(1 - u, 2.2) * f.k * 0.8; }
    // temp lights -> floor + point lights
    let best = [null, null, null];
    for (let i = tlights.length - 1; i >= 0; i--) { const L = tlights[i]; L.t += dT; if (L.t > L.life) { tlights.splice(i, 1); continue; } const k = Math.pow(1 - L.t / L.life, 2) * L.k; arena.pushLight(L.pos, L.col, L.radius, k * 1.4); L.cur = k * L.radius; }
    const sorted = tlights.slice().sort((a, b) => b.cur - a.cur);
    for (let i = 0; i < pl.length; i++) { const L = sorted[i]; if (L) { pl[i].position.copy(L.pos); pl[i].color.setRGB(L.col.r, L.col.g, L.col.b); const mx = Math.max(L.col.r, L.col.g, L.col.b, 0.001); pl[i].color.multiplyScalar(1 / mx); pl[i].intensity = Math.min(L.cur * 1.1, 5); } else pl[i].intensity = 0; }
    // bolts
    for (let i = bolts.length - 1; i >= 0; i--) { const b = bolts[i]; const L = b.a.distanceTo(b.b); b.t += ds * b.speed; const head = Math.min(b.t, L), tail = Math.max(0, b.t - b.len);
      if (tail >= L) { bolts.splice(i, 1); continue; }
      if (b.t >= L && !b.done) { b.done = true; if (b.onHit) b.onHit(b.b); }
      _c.copy(b.b).sub(b.a).normalize(); const pa = b.a.clone().addScaledVector(_c, tail), pb = b.a.clone().addScaledVector(_c, head);
      fx.beam(pa, pb, b.col, b.w, 1.6, { core: 2 }); fx.beam(pa, pb, b.col, b.w * 3.5, 0.35, { core: 0 }); arena.pushLight(pb, b.col, 1.2, 0.8); }
    for (const B of beams) B.mat.uniforms.uTime.value = t;
    fx.shakeAmt *= Math.exp(-ds * 9); fx.radial *= Math.exp(-ds * 12);
  };
  // call at the start of each frame, before choreography pushes per-frame beams/glows
  fx.begin = () => { for (let i = 0; i < beamI; i++) beams[i].m.visible = false; beamI = 0; for (let i = 0; i < glowI; i++) glows[i].m.visible = false; glowI = 0; };
  return fx;
}
