import * as THREE from 'three';
import { Reflector } from 'three/addons/objects/Reflector.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';
import { HEXW, hexCenter, mulberry, clamp, lerp, smooth, E, hdr, PAL, V } from './util.js';

export const ARENA_R = 15.5;
const rnd = mulberry(4242);

/* ---------------------------------------------------------------- environment map */
export function buildEnv(renderer) {
  const sc = new THREE.Scene();
  const bg = new THREE.Mesh(new THREE.SphereGeometry(50, 32, 16), new THREE.MeshBasicMaterial({ color: hdr(0.012, 0.016, 0.026), side: THREE.BackSide }));
  sc.add(bg);
  const panel = (col, w, h, pos, look = [0, 0, 0]) => {
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), new THREE.MeshBasicMaterial({ color: col, side: THREE.DoubleSide }));
    m.position.set(...pos); m.lookAt(...look); sc.add(m); return m;
  };
  panel(hdr(9, 4.6, 2.0), 16, 12, [-22, 9, 6]);       // warm key (Claude side)
  panel(hdr(1.6, 5.2, 8.0), 16, 12, [22, 9, 6]);      // cool key (Codex side)
  panel(hdr(5, 5.2, 5.6), 26, 5, [0, 26, 0]);         // top strip
  panel(hdr(1.2, 1.3, 1.6), 30, 10, [0, 6, 28]);      // soft front fill
  panel(hdr(2.6, 1.3, 0.7), 5, 14, [-12, 5, -24]);    // warm rim back
  panel(hdr(0.6, 1.9, 2.8), 5, 14, [12, 5, -24]);     // cool rim back
  panel(hdr(0.05, 0.07, 0.11), 80, 80, [0, -8, 0]);   // dark floor bounce
  const pm = new THREE.PMREMGenerator(renderer);
  const tex = pm.fromScene(sc, 0.035).texture;
  pm.dispose();
  return tex;
}

/* ---------------------------------------------------------------- floor */
const HEX_GLSL = /* glsl */`
const vec2 HS = vec2(1.0, 1.7320508);
vec4 hexCoords(vec2 p){
  vec4 hC = floor(vec4(p, p - vec2(.5, 1.)) / HS.xyxy) + .5;
  vec4 h = vec4(p - hC.xy * HS, p - (hC.zw + .5) * HS);
  return dot(h.xy, h.xy) < dot(h.zw, h.zw) ? vec4(h.xy, hC.xy) : vec4(h.zw, hC.zw + .5);
}
float hexDist(vec2 p){ p = abs(p); return max(dot(p, HS * .5), p.x); }
float hash21(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
`;

const floorShader = {
  name: 'ArenaFloor',
  uniforms: {
    color: { value: null }, tDiffuse: { value: null }, textureMatrix: { value: null },
    uTime: { value: 0 }, uCam: { value: new THREE.Vector3() },
    uLights: { value: Array.from({ length: 8 }, () => new THREE.Vector4()) },
    uLightCol: { value: Array.from({ length: 8 }, () => new THREE.Vector3()) },
    uRings: { value: Array.from({ length: 6 }, () => new THREE.Vector4()) },
    uRingCol: { value: Array.from({ length: 6 }, () => new THREE.Vector3()) },
    uBlob: { value: Array.from({ length: 2 }, () => new THREE.Vector3()) },
    uControl: { value: new THREE.Vector4(0, 0, 0, 0) },
    uDamage: { value: new THREE.Vector4(0, 0, 0, 0) },
    uDim: { value: 1 },
  },
  vertexShader: /* glsl */`
    uniform mat4 textureMatrix; varying vec4 vUv; varying vec3 vW;
    void main(){ vUv = textureMatrix * vec4(position, 1.0); vec4 w = modelMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
  fragmentShader: /* glsl */`
    precision highp float;
    uniform sampler2D tDiffuse; uniform float uTime; uniform vec3 uCam;
    uniform vec4 uLights[8]; uniform vec3 uLightCol[8];
    uniform vec4 uRings[6]; uniform vec3 uRingCol[6];
    uniform vec3 uBlob[2]; uniform vec4 uControl; uniform vec4 uDamage; uniform float uDim;
    varying vec4 vUv; varying vec3 vW;
    ${HEX_GLSL}
    void main(){
      vec2 p = vW.xz; float r = length(p);
      vec4 hx = hexCoords(p / ${HEXW.toFixed(4)});
      float hd = hexDist(hx.xy);
      float h = hash21(hx.zw);
      float h2 = hash21(hx.zw + 17.3);
      float aa = fwidth(hd) * 1.2;
      float seam = smoothstep(0.492 - aa, 0.5, hd);
      float bevel = smoothstep(0.40, 0.5, hd);
      vec3 Vd = normalize(uCam - vW);
      float fres = 1.0 - clamp(Vd.y, 0.0, 1.0); fres = fres * fres * fres;

      // faceted reflection: each tile is tilted a hair
      vec2 tilt = (vec2(h, h2) - 0.5) * 0.010;
      // explosion damage: tiles near the crater tilt strongly and sink
      float dmg = uDamage.w * smoothstep(uDamage.z, 0.0, length(p - uDamage.xy));
      tilt += (vec2(h2, h) - 0.5) * 0.09 * dmg;
      vec2 uv = vUv.xy / vUv.w + tilt;
      float br = 0.0022 + 0.004 * h;
      vec3 refl = texture2D(tDiffuse, uv).rgb * 0.4;
      refl += texture2D(tDiffuse, uv + vec2(br, 0.0)).rgb * 0.15;
      refl += texture2D(tDiffuse, uv - vec2(br, 0.0)).rgb * 0.15;
      refl += texture2D(tDiffuse, uv + vec2(0.0, br * 1.6)).rgb * 0.15;
      refl += texture2D(tDiffuse, uv - vec2(0.0, br * 1.6)).rgb * 0.15;

      vec3 base = mix(vec3(0.010, 0.013, 0.021), vec3(0.020, 0.026, 0.040), h);
      base *= 1.0 - 0.5 * bevel;
      float reflK = mix(0.22, 0.85, fres) * (0.75 + 0.25 * h2) * (1.0 - 0.6 * seam) * (1.0 - 0.5 * dmg);
      vec3 col = base + refl * reflK;

      // seams and arena markings
      vec3 seamCol = vec3(0.045, 0.062, 0.095);
      float ctl = uControl.w * smoothstep(uControl.z, uControl.z - 2.5, length(p - uControl.xy));
      float front = uControl.w * exp(-pow((length(p - uControl.xy) - uControl.z) / 0.7, 2.0));
      seamCol = mix(seamCol, vec3(0.05, 0.42, 0.6) * (0.6 + 0.4 * sin(uTime * 5.0 + h * 40.0)), ctl);
      col += seamCol * seam;
      col += vec3(0.15, 0.9, 1.25) * front * (0.12 + seam * 1.4 + step(0.82, h) * 0.3);
      col += vec3(0.02, 0.10, 0.14) * ctl * step(0.86, h2) * (0.6 + 0.4 * sin(uTime * 6.0 + h * 30.0));
      float mk = 0.0;
      mk += smoothstep(0.035, 0.0, abs(r - 3.2));
      mk += smoothstep(0.03, 0.0, abs(r - 9.0)) * step(0.35, fract(atan(p.y, p.x) * 6.0 / 6.2831853 + 0.04));
      mk += smoothstep(0.05, 0.0, abs(r - 14.1));
      float ang = atan(p.y, p.x);
      mk += smoothstep(0.012, 0.0, abs(fract(ang * 36.0 / 6.2831853) - 0.5) * 0.3) * step(13.5, r) * step(r, 14.1) * 0.7;
      col += vec3(0.16, 0.20, 0.27) * mk;

      // dynamic lights spilled on the floor
      for (int i = 0; i < 8; i++){
        vec3 d = vW - uLights[i].xyz; float rad = uLights[i].w;
        float a = min(rad * rad / (dot(d, d) + rad * rad * 0.25 + 0.02), 2.2);
        col += uLightCol[i] * a * (0.014 + 0.085 * seam + 0.022 * h * (1.0 - bevel));
      }
      // shock rings travelling along the tiles
      for (int i = 0; i < 6; i++){
        float d = length(p - uRings[i].xy) - uRings[i].z;
        float band = exp(-d * d / 0.10) * uRings[i].w;
        col += uRingCol[i] * band * (0.04 + 1.0 * seam + 0.16 * step(0.6, h));
      }
      // crater glow
      col += vec3(1.6, 0.75, 0.3) * dmg * seam * 0.9 * (0.6 + 0.4 * sin(uTime * 3.0 + h * 50.0));
      // soft contact shadows
      for (int i = 0; i < 2; i++){ float d = length(p - uBlob[i].xy); col *= 1.0 - 0.55 * uBlob[i].z * exp(-d * d / 0.42); }

      float rim = smoothstep(${(ARENA_R - 0.22).toFixed(2)}, ${(ARENA_R - 0.05).toFixed(2)}, r);
      col = mix(col, vec3(0.3, 0.45, 0.7) * 0.8, rim);
      gl_FragColor = vec4(col * uDim, 1.0);
    }`,
};

/* ---------------------------------------------------------------- sky */
function buildSky() {
  const mat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { uTime: { value: 0 }, uDim: { value: 1 } },
    vertexShader: `varying vec3 vD; void main(){ vD = normalize(position); gl_Position = projectionMatrix * viewMatrix * modelMatrix * vec4(position,1.0); }`,
    fragmentShader: /* glsl */`
      precision highp float; varying vec3 vD; uniform float uTime; uniform float uDim;
      float hash(vec2 p){ p = fract(p * vec2(123.34, 456.21)); p += dot(p, p + 45.32); return fract(p.x * p.y); }
      float noise(vec2 p){ vec2 i = floor(p), f = fract(p); f = f*f*(3.-2.*f);
        return mix(mix(hash(i), hash(i+vec2(1,0)), f.x), mix(hash(i+vec2(0,1)), hash(i+vec2(1,1)), f.x), f.y); }
      void main(){
        vec3 d = normalize(vD);
        float y = d.y;
        vec3 top = vec3(0.0025, 0.0035, 0.008), mid = vec3(0.007, 0.011, 0.022);
        vec3 col = mix(mid, top, smoothstep(0.0, 0.7, y));
        float hz = exp(-abs(y + 0.02) * 9.0);
        float side = d.x / max(0.2, length(d.xz));
        vec3 warm = vec3(0.34, 0.15, 0.07), cool = vec3(0.05, 0.19, 0.32);
        col += mix(warm, cool, smoothstep(-0.8, 0.8, side)) * hz * 0.20;
        col += vec3(0.012, 0.016, 0.026) * exp(-abs(y) * 3.0);
        float az = atan(d.z, d.x);
        float n = noise(vec2(az * 3.0, y * 5.0 - uTime * 0.01)) * noise(vec2(az * 7.0 + 3.0, y * 9.0));
        col += vec3(0.012, 0.018, 0.034) * n * smoothstep(-0.1, 0.5, y);
        // sparse data points
        vec2 g = vec2(az * 60.0, y * 90.0); vec2 gi = floor(g); float hh = hash(gi);
        float st = step(0.994, hh) * smoothstep(0.35, 0.0, length(fract(g) - 0.5)) * step(0.03, y);
        col += vec3(0.5, 0.65, 0.9) * st * (0.4 + 0.6 * sin(uTime * (1.0 + hh * 3.0) + hh * 60.0));
        col = mix(col, vec3(0.003, 0.004, 0.008), smoothstep(-0.02, -0.5, y) * 0.8);
        gl_FragColor = vec4(col * uDim, 1.0);
      }`,
  });
  const m = new THREE.Mesh(new THREE.SphereGeometry(400, 48, 24), mat);
  m.renderOrder = -10; m.frustumCulled = false;
  return m;
}

/* ---------------------------------------------------------------- distant data towers */
function buildTowers() {
  const N = 220;
  const geo = new THREE.BoxGeometry(1, 1, 1); geo.translate(0, 0.5, 0);
  const seeds = new Float32Array(N), scl = new Float32Array(N * 3);
  const mat = new THREE.ShaderMaterial({
    uniforms: { uTime: { value: 0 }, uDim: { value: 1 } },
    vertexShader: /* glsl */`
      attribute float aSeed; attribute vec3 aScale; varying vec3 vW; varying vec3 vL; varying float vSeed; varying vec3 vN;
      void main(){ vSeed = aSeed; vL = position * aScale; vN = normal;
        vec4 w = modelMatrix * instanceMatrix * vec4(position, 1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`
      precision highp float; varying vec3 vW; varying vec3 vL; varying float vSeed; varying vec3 vN;
      uniform float uTime; uniform float uDim;
      float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
      void main(){
        float dist = length(vW.xz);
        vec3 col = vec3(0.006, 0.008, 0.014) * (0.55 + 0.45 * abs(vN.x));
        float side = step(abs(vN.y), 0.5);
        float u = abs(vN.x) > 0.5 ? vL.z : vL.x;
        float ROW = 3.2;
        float row = floor(vW.y / ROW);
        float hr = hash(vec2(row, floor(vSeed * 97.0)));
        float fy = fract(vW.y / ROW);
        float strip = smoothstep(0.30, 0.34, fy) * smoothstep(0.46, 0.42, fy);
        float cellW = 2.6;
        float cu = u / cellW + hr * 7.0;
        float cell = floor(cu);
        float hc = hash(vec2(cell, row + floor(vSeed * 31.0)));
        float fx = fract(cu);
        float seg = smoothstep(0.04, 0.10, fx) * smoothstep(0.96, 0.90, fx);
        float lit = step(0.62, hr) * step(0.45, hc) * strip * seg * side;
        vec3 lc = mix(vec3(1.0, 0.52, 0.22), vec3(0.22, 0.75, 1.0), step(0.0, vW.x + (hc - 0.5) * 50.0));
        lc = mix(lc, vec3(0.75, 0.85, 1.0), step(0.86, hc));
        float lod = smoothstep(230.0, 70.0, dist);
        col += lc * lit * 0.20 * lod * (0.75 + 0.25 * sin(uTime * (0.4 + hc * 1.5) + hc * 50.0));
        col += vec3(0.10, 0.17, 0.28) * smoothstep(-0.25, 0.0, vL.y - (vW.y + 60.0) / 1.0 * 0.0 - 0.0) * 0.0;
        float fog = 1.0 - exp(-dist * 0.012);
        vec3 fc = mix(vec3(0.030, 0.019, 0.015), vec3(0.008, 0.022, 0.036), smoothstep(-50.0, 50.0, vW.x));
        float hf = smoothstep(-34.0, 4.0, vW.y);
        col = mix(col, fc, fog * 0.85) * mix(0.15, 1.0, hf);
        gl_FragColor = vec4(col * uDim, 1.0);
      }`,
  });
  const mesh = new THREE.InstancedMesh(geo, mat, N);
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), s = new THREE.Vector3(), p = new THREE.Vector3();
  for (let i = 0; i < N; i++) {
    const a = rnd() * Math.PI * 2, r = 48 + Math.pow(rnd(), 1.3) * 130;
    const w = 5 + rnd() * 9, d = 5 + rnd() * 9;
    let top = -14 + Math.pow(rnd(), 2.2) * 40 * (0.4 + r / 130);
    if (Math.abs(Math.sin(a)) > 0.92 && Math.sin(a) < 0) top = Math.min(top, 2);
    const base = -70;
    p.set(Math.cos(a) * r, base, Math.sin(a) * r);
    q.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.round(rnd() * 3) * Math.PI / 6);
    s.set(w, top - base, d);
    m4.compose(p, q, s); mesh.setMatrixAt(i, m4); seeds[i] = rnd(); scl.set([w, top - base, d], i * 3);
  }
  geo.setAttribute('aSeed', new THREE.InstancedBufferAttribute(seeds, 1));
  geo.setAttribute('aScale', new THREE.InstancedBufferAttribute(scl, 3));
  mesh.frustumCulled = false;
  return mesh;
}

/* ---------------------------------------------------------------- holo terminals */
function terminalTexture(variant, controlled) {
  const c = document.createElement('canvas'); c.width = 768; c.height = 448;
  const g = c.getContext('2d'); const r = mulberry(100 + variant * 7 + (controlled ? 999 : 0));
  g.clearRect(0, 0, c.width, c.height);
  const ink = controlled ? '#bff6ff' : '#dfe6f2', dim = controlled ? 'rgba(120,235,255,0.55)' : 'rgba(200,212,235,0.45)';
  const acc = controlled ? '#5ff0ff' : (variant % 2 ? '#ffb46a' : '#9fc4ff');
  g.fillStyle = controlled ? 'rgba(8,60,80,0.55)' : 'rgba(40,52,78,0.42)'; g.fillRect(0, 0, c.width, c.height);
  g.fillStyle = controlled ? 'rgba(95,240,255,0.30)' : 'rgba(210,220,240,0.16)'; g.fillRect(0, 0, c.width, 44);
  g.fillStyle = ink; g.font = '600 22px "DejaVu Sans Mono", monospace';
  g.fillText(controlled ? '> exec  // remote' : ['workspace', 'design.sys', 'analysis', 'context', 'structure', 'runtime'][variant % 6], 18, 30);
  for (let i = 0; i < 3; i++) { g.beginPath(); g.arc(c.width - 28 - i * 26, 22, 7, 0, 7); g.fillStyle = i === 0 ? acc : dim; g.fill(); }
  g.font = '18px "DejaVu Sans Mono", monospace';
  if (controlled) {
    const lines = ['$ acquire --panel ' + variant, '$ target.lock  OK', '$ route power -> emitter', '$ align  yaw=' + (r() * 90 | 0) + '  pitch=' + (r() * 30 | 0), '$ exec strike', '  ................ armed'];
    lines.forEach((l, i) => { g.fillStyle = i === 4 ? '#ffffff' : ink; g.fillText(l, 20, 84 + i * 30); });
    g.strokeStyle = acc; g.lineWidth = 3; g.strokeRect(470, 70, 270, 200);
    g.beginPath(); g.arc(605, 170, 62, 0, 7); g.stroke(); g.beginPath(); g.arc(605, 170, 22, 0, 7); g.stroke();
    g.beginPath(); g.moveTo(605, 84); g.lineTo(605, 256); g.moveTo(488, 170); g.lineTo(722, 170); g.stroke();
    for (let i = 0; i < 26; i++) { g.fillStyle = r() > 0.4 ? acc : dim; g.fillRect(20 + i * 28, 300 + (r() * 90 | 0), 18, 120); }
    g.fillStyle = 'rgba(8,60,80,0.9)'; g.fillRect(0, 330, c.width, 0);
  } else {
    let y = 76;
    for (let i = 0; i < 11; i++) {
      let x = 20 + ((r() * 3) | 0) * 26;
      const n = 2 + (r() * 4 | 0);
      for (let j = 0; j < n; j++) { const w = 30 + r() * 110; g.fillStyle = r() > 0.78 ? acc : (r() > 0.5 ? ink : dim); g.globalAlpha = 0.85; g.fillRect(x, y, w, 9); x += w + 12; if (x > 420) break; }
      y += 24;
    }
    g.globalAlpha = 1; g.strokeStyle = dim; g.lineWidth = 2; g.strokeRect(470, 70, 270, 150);
    g.beginPath(); g.strokeStyle = acc; g.lineWidth = 3;
    for (let i = 0; i <= 20; i++) { const x = 480 + i * 12.5, yy = 200 - (Math.sin(i * 0.5 + variant) * 0.5 + 0.5) * 80 - r() * 25; i ? g.lineTo(x, yy) : g.moveTo(x, yy); }
    g.stroke();
    for (let i = 0; i < 8; i++) { g.fillStyle = i % 3 ? dim : acc; g.fillRect(476 + i * 34, 420 - (30 + r() * 150), 22, 400); }
    g.clearRect(470, 420, 300, 40);
  }
  const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 4;
  return t;
}

const termMatProto = () => new THREE.ShaderMaterial({
  transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.NormalBlending,
  uniforms: { tA: { value: null }, tB: { value: null }, uMix: { value: 0 }, uTime: { value: 0 }, uSeed: { value: 0 }, uFlash: { value: 0 }, uAlive: { value: 1 }, uDim: { value: 1 } },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    precision highp float; varying vec2 vUv; uniform sampler2D tA, tB; uniform float uMix, uTime, uSeed, uFlash, uAlive, uDim;
    float hash(float n){ return fract(sin(n) * 43758.5453); }
    void main(){
      vec2 uv = vUv;
      float wipe = smoothstep(uMix * 1.3 - 0.3, uMix * 1.3, uv.y * 0.6 + uv.x * 0.4 );
            vec4 a = texture2D(tA, uv), b = texture2D(tB, uv);
      vec4 t = mix(b, a, wipe);
      vec3 tint = mix(vec3(0.8, 0.9, 1.15), vec3(0.45, 1.5, 1.9), 1.0 - wipe);
      float edge = max(smoothstep(0.47, 0.5, abs(uv.x - 0.5)), smoothstep(0.45, 0.5, abs(uv.y - 0.5)));
      float scan = 0.88 + 0.12 * sin(uv.y * 320.0 + uTime * 4.0);
      float wl = exp(-pow((uv.y * 0.6 + uv.x * 0.4 - (uMix * 1.3 - 0.15)) / 0.03, 2.0)) * step(0.01, uMix) * step(uMix, 0.99);
      vec3 col = t.rgb * tint * scan * 0.85 + tint * edge * 0.55 + vec3(0.6, 1.8, 2.2) * wl * 1.5;
      col += tint * uFlash * 2.5;
      float fl = 0.93 + 0.07 * sin(uTime * 13.0 + uSeed * 20.0);
      float alpha = clamp(t.a * 0.8 + edge * 0.7 + wl + uFlash, 0.0, 1.0) * fl * uAlive;
      gl_FragColor = vec4(col * fl * uDim, alpha);
    }`,
});

/* ---------------------------------------------------------------- build */
export function buildArena(scene, renderer, W, H) {
  const A = { uniformsTime: [], dimmables: [] };
  const env = buildEnv(renderer);
  scene.environment = env; scene.environmentIntensity = 0.5;

  const sky = buildSky(); scene.add(sky); A.sky = sky;
  A.uniformsTime.push(sky.material.uniforms); A.dimmables.push(sky.material.uniforms);
  const towers = buildTowers(); scene.add(towers);
  A.uniformsTime.push(towers.material.uniforms); A.dimmables.push(towers.material.uniforms);

  // floor
  const floor = new Reflector(new THREE.CircleGeometry(ARENA_R, 96), {
    shader: floorShader, textureWidth: Math.round(W / 2), textureHeight: Math.round(H / 2), clipBias: 0.003, multisample: 0,
  });
  floor.rotation.x = -Math.PI / 2; floor.position.y = 0;
  scene.add(floor); A.floor = floor; A.fu = floor.material.uniforms;
  A.uniformsTime.push(A.fu); A.dimmables.push(A.fu);

  // platform body: skirt + under-glow ring
  const skirt = new THREE.Mesh(new THREE.CylinderGeometry(ARENA_R, ARENA_R - 1.6, 1.4, 96, 1, true),
    new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uDim: { value: 1 } },
      vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `precision highp float; varying vec2 vUv; uniform float uTime; uniform float uDim;
        void main(){ float seg = smoothstep(0.46, 0.5, abs(fract(vUv.x * 48.0) - 0.5));
          vec3 c = vec3(0.012, 0.016, 0.026) + vec3(0.3, 0.45, 0.7) * smoothstep(0.93, 1.0, vUv.y) + vec3(0.05,0.08,0.13) * seg * vUv.y;
          float run = smoothstep(0.96, 1.0, sin(vUv.x * 60.0 - uTime * 1.5)) * smoothstep(0.5, 0.45, abs(vUv.y - 0.5));
          c += vec3(0.2, 0.5, 0.8) * run * 0.6; gl_FragColor = vec4(c * uDim, 1.0); }`,
    }));
  skirt.position.y = -0.7; scene.add(skirt); A.uniformsTime.push(skirt.material.uniforms); A.dimmables.push(skirt.material.uniforms);
  const under = new THREE.Mesh(new THREE.CylinderGeometry(ARENA_R - 1.6, ARENA_R - 5, 5, 64, 1, true), new THREE.MeshBasicMaterial({ color: hdr(0.008, 0.011, 0.018) }));
  under.position.y = -3.9; scene.add(under);

  // pylons around the arena
  A.pylons = [];
  const pyMat = new THREE.MeshStandardMaterial({ color: 0x1a2130, metalness: 0.9, roughness: 0.32 });
  for (let i = 0; i < 8; i++) {
    const a = (i + 0.5) / 8 * Math.PI * 2, r = ARENA_R + 3.0;
    const g = new THREE.Group();
    const h = 15 + (i % 2) * 5;
    const body = new THREE.Mesh(new RoundedBoxGeometry(1.0, h, 1.6, 2, 0.18), pyMat); body.position.y = h / 2 - 5; g.add(body);
    const warm = Math.cos(a) < 0;
    const stripMat = new THREE.MeshBasicMaterial({ color: warm ? hdr(1.0, 0.45, 0.18) : hdr(0.18, 0.7, 1.05) });
    const strip = new THREE.Mesh(new THREE.BoxGeometry(0.05, h * 0.62, 0.10), stripMat); strip.position.set(-0.52, h / 2 - 4.2, 0); g.add(strip);
    const cap = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.12, 1.9), new THREE.MeshBasicMaterial({ color: hdr(0.2, 0.28, 0.42) })); cap.position.y = h - 5; g.add(cap);
    g.position.set(Math.cos(a) * r, 0, Math.sin(a) * r); g.rotation.y = -a; scene.add(g);
    A.pylons.push({ g, strip: stripMat, base: stripMat.color.clone() });
  }

  // great rings overhead
  A.rings = [];
  [[19.5, 9, 0.18, 0.02], [23, 13, -0.12, -0.015], [28, 18, 0.07, 0.01]].forEach(([r, y, tilt, sp], i) => {
    const m = new THREE.Mesh(new THREE.TorusGeometry(r, 0.035, 6, 200), new THREE.MeshBasicMaterial({ color: hdr(0.16, 0.24, 0.4) }));
    m.rotation.x = Math.PI / 2 + tilt; m.position.y = y; scene.add(m);
    const seg = new THREE.Mesh(new THREE.TorusGeometry(r, 0.09, 6, 40, 0.42), new THREE.MeshBasicMaterial({ color: i === 1 ? hdr(0.9, 0.42, 0.17) : hdr(0.2, 0.65, 0.95) }));
    m.add(seg);
    const seg2 = seg.clone(); seg2.rotation.z = Math.PI * (0.9 + i * 0.2); m.add(seg2);
    A.rings.push({ m, sp });
  });

  // holographic terminals
  A.terminals = [];
  const tGeo = new THREE.PlaneGeometry(4.2, 2.45);
  const angles = [200, 232, 262, 292, 322, 352, 148, 28];
  angles.forEach((deg, i) => {
    const a = deg * Math.PI / 180, r = 12.6 + (i % 2) * 0.8;
    const mat = termMatProto();
    mat.uniforms.tA.value = terminalTexture(i, false); mat.uniforms.tB.value = terminalTexture(i, true); mat.uniforms.uSeed.value = i * 1.37;
    const m = new THREE.Mesh(tGeo, mat);
    const home = new THREE.Vector3(Math.cos(a) * r, 3.4 + (i % 3) * 0.9, Math.sin(a) * r);
    m.position.copy(home); m.lookAt(0, 2.2, 0);
    scene.add(m);
    A.terminals.push({ m, mat, home, homeQ: m.quaternion.clone(), alive: true, ctrl: 0, aim: null, seed: i, flash: 0 });
    A.uniformsTime.push(mat.uniforms); A.dimmables.push(mat.uniforms);
  });

  // floating code columns far out
  const codeTex = (() => {
    const c = document.createElement('canvas'); c.width = 256; c.height = 1024; const g = c.getContext('2d'); const r = mulberry(77);
    for (let y = 10; y < 1024; y += 18) { let x = 8 + (r() * 3 | 0) * 14; const n = 1 + (r() * 4 | 0);
      for (let j = 0; j < n; j++) { const w = 14 + r() * 70; g.fillStyle = `rgba(${200 + r() * 55 | 0},${215 + r() * 40 | 0},255,${0.25 + r() * 0.6})`; g.fillRect(x, y, w, 6); x += w + 8; if (x > 230) break; } }
    const t = new THREE.CanvasTexture(c); t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace; return t;
  })();
  A.codeCols = [];
  for (let i = 0; i < 16; i++) {
    const a = rnd() * Math.PI * 2, r = 21 + rnd() * 16;
    const warm = Math.cos(a) < 0;
    const mat = new THREE.MeshBasicMaterial({ map: codeTex.clone(), transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide,
      color: warm ? hdr(1.0, 0.62, 0.36, 0.7) : hdr(0.35, 0.8, 1.1, 0.7) });
    mat.map.repeat.set(1, 0.6); mat.map.offset.y = rnd(); mat.map.needsUpdate = true;
    const m = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 13), mat);
    m.position.set(Math.cos(a) * r, 2 + rnd() * 12, Math.sin(a) * r); m.lookAt(0, m.position.y, 0); scene.add(m);
    A.codeCols.push({ mat, sp: 0.02 + rnd() * 0.05 });
  }

  // dust
  {
    const N = 900, pos = new Float32Array(N * 3), sd = new Float32Array(N);
    for (let i = 0; i < N; i++) { const a = rnd() * 6.283, r = Math.sqrt(rnd()) * 22; pos[i * 3] = Math.cos(a) * r; pos[i * 3 + 1] = rnd() * 9 + 0.1; pos[i * 3 + 2] = Math.sin(a) * r; sd[i] = rnd(); }
    const g = new THREE.BufferGeometry(); g.setAttribute('position', new THREE.BufferAttribute(pos, 3)); g.setAttribute('aSeed', new THREE.BufferAttribute(sd, 1));
    const mat = new THREE.ShaderMaterial({
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      uniforms: { uTime: { value: 0 }, uH: { value: H }, uDim: { value: 1 } },
      vertexShader: `attribute float aSeed; uniform float uTime, uH; varying float vA;
        void main(){ vec3 p = position; p.y += sin(uTime * 0.25 + aSeed * 40.0) * 0.5; p.x += sin(uTime * 0.17 + aSeed * 70.0) * 0.6; p.z += cos(uTime * 0.13 + aSeed * 55.0) * 0.6;
          vec4 mv = modelViewMatrix * vec4(p, 1.0); gl_Position = projectionMatrix * mv; gl_PointSize = uH * (0.010 + 0.014 * aSeed) / -mv.z;
          vA = (0.35 + 0.65 * sin(uTime * (0.6 + aSeed) + aSeed * 30.0)) * smoothstep(0.4, 2.5, -mv.z); }`,
      fragmentShader: `precision highp float; varying float vA; uniform float uDim; void main(){ float d = length(gl_PointCoord - 0.5); float a = smoothstep(0.5, 0.0, d); gl_FragColor = vec4(vec3(0.55, 0.7, 1.0) * a * a * vA * 0.55 * uDim, 1.0); }`,
    });
    const pts = new THREE.Points(g, mat); pts.frustumCulled = false; scene.add(pts);
    A.uniformsTime.push(mat.uniforms); A.dimmables.push(mat.uniforms);
  }

  // hex pillars (tool-control pistons)
  A.pillars = [];
  const pGeo = new THREE.CylinderGeometry(HEXW / Math.sqrt(3) * 0.985, HEXW / Math.sqrt(3) * 0.985, 1, 6, 1, false); pGeo.translate(0, -0.5, 0);
  const pillarMat = () => new THREE.ShaderMaterial({
    uniforms: { uH: { value: 1 }, uTime: { value: 0 }, uHeat: { value: 0 }, uDim: { value: 1 } },
    vertexShader: `varying vec3 vP; varying vec3 vN; varying vec3 vW; void main(){ vP = position; vN = normal; vec4 w = modelMatrix * vec4(position,1.0); vW = w.xyz; gl_Position = projectionMatrix * viewMatrix * w; }`,
    fragmentShader: /* glsl */`precision highp float; varying vec3 vP; varying vec3 vN; varying vec3 vW; uniform float uH, uTime, uHeat, uDim;
      void main(){
        vec3 col;
        if (vN.y > 0.5){ float r = length(vP.xz); col = vec3(0.012, 0.016, 0.026) + vec3(0.10, 0.75, 1.05) * smoothstep(0.84, 0.92, r) * (0.55 + uHeat) + vec3(0.03, 0.22, 0.32) * smoothstep(0.03, 0.0, abs(r - 0.45)); }
        else { float y = vW.y; float lines = smoothstep(0.44, 0.5, abs(fract(y * 2.4 - uTime * 0.8) - 0.5));
          float topGlow = smoothstep(0.22, 0.0, -vP.y * uH);
          col = vec3(0.010, 0.014, 0.024) * (0.55 + 0.65 * abs(vN.x)) + vec3(0.06, 0.5, 0.75) * lines * (0.35 + uHeat * 0.8) + vec3(0.10, 0.7, 1.0) * topGlow * 0.8; }
        gl_FragColor = vec4(col * uDim, 1.0); }`,
  });
  for (let i = 0; i < 26; i++) {
    const mat = pillarMat(); const m = new THREE.Mesh(pGeo, mat); m.visible = false; scene.add(m);
    A.pillars.push({ m, mat, h: 0 }); A.uniformsTime.push(mat.uniforms); A.dimmables.push(mat.uniforms);
  }
  A.setPillar = (i, x, z, h) => {
    const p = A.pillars[i]; const [cx, cz] = hexCenter(x, z);
    p.h = h; p.m.visible = h > 0.01; p.m.position.set(cx, h, cz); p.m.scale.set(1, Math.max(h + 0.6, 0.01), 1); p.mat.uniforms.uH.value = Math.max(h + 0.6, 0.01);
    p.x = cx; p.z = cz;
  };

  // floor light / ring registries (filled per frame by the VFX system)
  A.lights = []; A.ringsFx = [];
  A.pushLight = (pos, col, radius, k = 1) => A.lights.push({ pos, col, radius, k });
  A.pushRing = (x, z, rad, k, col) => A.ringsFx.push({ x, z, rad, k, col });

  A.update = (t, cam) => {
    for (const u of A.uniformsTime) u.uTime.value = t;
    A.fu.uCam.value.copy(cam.position);
    for (const r of A.rings) r.m.rotation.z = t * r.sp * 3.0;
    for (const c of A.codeCols) c.mat.map.offset.y = (t * c.sp) % 1;
    // lights -> strongest 8
    A.lights.sort((a, b) => b.k * b.radius - a.k * a.radius);
    for (let i = 0; i < 8; i++) {
      const L = A.lights[i];
      if (L) { A.fu.uLights.value[i].set(L.pos.x, L.pos.y, L.pos.z, L.radius); A.fu.uLightCol.value[i].set(L.col.r * L.k, L.col.g * L.k, L.col.b * L.k); }
      else { A.fu.uLights.value[i].set(0, -100, 0, 0.01); A.fu.uLightCol.value[i].set(0, 0, 0); }
    }
    A.ringsFx.sort((a, b) => b.k - a.k);
    for (let i = 0; i < 6; i++) {
      const L = A.ringsFx[i];
      if (L) { A.fu.uRings.value[i].set(L.x, L.z, L.rad, L.k); A.fu.uRingCol.value[i].set(L.col.r, L.col.g, L.col.b); }
      else { A.fu.uRings.value[i].set(0, 0, -100, 0); A.fu.uRingCol.value[i].set(0, 0, 0); }
    }
    A.lights.length = 0; A.ringsFx.length = 0;
    for (const T of A.terminals) {
      T.mat.uniforms.uMix.value = T.ctrl; T.mat.uniforms.uFlash.value = T.flash; T.mat.uniforms.uAlive.value = T.alive ? 1 : 0; T.m.visible = T.alive;
      const bob = Math.sin(t * 0.7 + T.seed * 2.1) * 0.12;
      T.m.position.set(T.home.x, T.home.y + bob, T.home.z);
    }
  };
  A.setDim = (d) => { for (const u of A.dimmables) u.uDim.value = d; };
  return A;
}
