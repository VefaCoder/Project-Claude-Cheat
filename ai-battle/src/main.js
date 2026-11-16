import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { buildArena } from './arena.js';
import { createFilm } from './film.js';

const q = new URLSearchParams(location.search);
const W = +q.get('w') || 2560, H = +q.get('h') || 1440, wsPort = q.get('ws');

const renderer = new THREE.WebGLRenderer({ antialias: false, preserveDrawingBuffer: true, powerPreference: 'high-performance' });
renderer.setPixelRatio(1); renderer.setSize(W, H, false);
renderer.toneMapping = THREE.NoToneMapping;
renderer.outputColorSpace = THREE.LinearSRGBColorSpace; // final pass encodes to sRGB itself
renderer.domElement.style.width = '1280px'; renderer.domElement.style.height = '720px';
document.body.appendChild(renderer.domElement);

const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(36, W / H, 0.1, 900);
const arena = buildArena(scene, renderer, W, H);

const rt = new THREE.WebGLRenderTarget(W, H, { type: THREE.HalfFloatType, samples: 4 });
const composer = new EffectComposer(renderer, rt);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(W, H), 0.36, 0.5, 1.0);
composer.addPass(bloom);

const finalPass = new ShaderPass({
  uniforms: {
    tDiffuse: { value: null }, uTime: { value: 0 }, uExposure: { value: 1.0 }, uVig: { value: 1.0 }, uCA: { value: 1.0 }, uRadial: { value: 0 },
    uCenter: { value: new THREE.Vector2(0.5, 0.5) }, uFade: { value: new THREE.Vector3(0, 0, 0) }, uFadeK: { value: 0 }, uPlan: { value: 0 }, uScan: { value: 0 },
    uAspect: { value: W / H },
  },
  vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
  fragmentShader: /* glsl */`
    precision highp float; varying vec2 vUv; uniform sampler2D tDiffuse;
    uniform float uTime, uExposure, uVig, uCA, uRadial, uFadeK, uPlan, uScan, uAspect; uniform vec2 uCenter; uniform vec3 uFade;
    vec3 aces(vec3 x){ return clamp((x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14), 0.0, 1.0); }
    float hash(vec2 p){ vec3 p3 = fract(vec3(p.xyx) * .1031); p3 += dot(p3, p3.yzx + 33.33); return fract((p3.x + p3.y) * p3.z); }
    void main(){
      vec2 uv = vUv; vec2 dir = uv - uCenter; float dl = length(dir * vec2(uAspect, 1.0));
      vec3 col;
      if (uRadial > 0.0005){
        col = vec3(0.0); float j = hash(uv * 913.0 + uTime) ;
        for (int i = 0; i < 10; i++){ float k = (float(i) + j) / 10.0; col += texture2D(tDiffuse, uv - dir * uRadial * k).rgb; }
        col /= 10.0;
      } else {
        vec2 ca = dir * dl * 0.0016 * uCA;
        col.r = texture2D(tDiffuse, uv - ca).r; col.g = texture2D(tDiffuse, uv).g; col.b = texture2D(tDiffuse, uv + ca).b;
      }
      col = clamp(col, 0.0, 64.0) * uExposure;
      // split-tone: cool shadows, warm highlights
      float l0 = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col *= mix(vec3(0.92, 0.98, 1.10), vec3(1.05, 1.0, 0.94), smoothstep(0.0, 0.9, l0));
      col = aces(col * 1.05);
      float l = dot(col, vec3(0.2126, 0.7152, 0.0722));
      col = mix(col, l * vec3(1.18, 0.94, 0.66) * 0.82, uPlan * 0.85);
      col = mix(col, l * vec3(0.62, 0.98, 1.18) * 0.9, uScan * 0.7);
      col = max(mix(vec3(l), col, 1.08), 0.0);
      col = pow(col, vec3(1.04));
      float v = smoothstep(1.25, 0.35, length((uv - 0.5) * vec2(1.0, 0.82)) * 1.55);
      col *= mix(1.0, v, 0.55 * uVig);
      col = mix(col, uFade, uFadeK);
      col = pow(max(col, 0.0), vec3(1.0 / 2.2));
      float g = hash(uv * vec2(1917.0, 1081.0) + fract(uTime) * 311.0) - 0.5;
      col += g * 0.018;
      gl_FragColor = vec4(col, 1.0);
    }`,
});
composer.addPass(finalPass);

const post = { bloom, u: finalPass.uniforms };
const film = createFilm({ scene, camera, arena, renderer, post, W, H });

const gl = renderer.getContext();
const buf = new Uint8Array(W * H * 4);
let ws = null;
function connect() { return new Promise((res) => { ws = new WebSocket(`ws://localhost:${wsPort}`); ws.binaryType = 'arraybuffer'; ws.onopen = res; }); }

let cur = -1;
function seek(frame) {
  if (frame < cur) throw new Error('cannot seek backwards');
  while (cur < frame) { cur++; film.step(cur, cur === frame); }
}
function draw() { post.u.uTime.value = cur / 60; composer.render(); }

window.film = {
  ready: false,
  info: () => ({ totalFrames: film.totalFrames, W, H }),
  cues: () => film.cues(),
  async renderFrames(list) {
    if (!ws) await connect();
    for (const f of list) {
      seek(f); draw();
      gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, buf);
      ws.send(buf);
      await new Promise((r) => { ws.onmessage = r; });
    }
    return true;
  },
  preview(f) { seek(f); draw(); },
};
// warm-up (shader compile)
film.step(0, true); cur = 0; draw();
window.film.ready = true;
