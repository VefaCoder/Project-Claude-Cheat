import * as THREE from 'three';

export const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
export const lerp = (a, b, t) => a + (b - a) * t;
export const sat = (x) => clamp(x, 0, 1);
export const smooth = (t) => { t = sat(t); return t * t * (3 - 2 * t); };
export const remap = (x, a, b, c = 0, d = 1) => c + (d - c) * sat((x - a) / (b - a));
export const DEG = Math.PI / 180;

export const E = {
  lin: (t) => t,
  in2: (t) => t * t,
  out2: (t) => 1 - (1 - t) * (1 - t),
  io2: (t) => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2),
  in3: (t) => t * t * t,
  out3: (t) => 1 - Math.pow(1 - t, 3),
  io3: (t) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2),
  io4: (t) => (t < 0.5 ? 8 * t * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2),
  out4: (t) => 1 - Math.pow(1 - t, 4),
  in4: (t) => t * t * t * t,
  outExpo: (t) => (t >= 1 ? 1 : 1 - Math.pow(2, -10 * t)),
  inExpo: (t) => (t <= 0 ? 0 : Math.pow(2, 10 * t - 10)),
  outBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return 1 + c3 * Math.pow(t - 1, 3) + c1 * Math.pow(t - 1, 2); },
  inBack: (t) => { const c1 = 1.70158, c3 = c1 + 1; return c3 * t * t * t - c1 * t * t; },
  step: (t) => (t >= 1 ? 1 : 0),
  smooth,
};

export function mulberry(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export const R = mulberry(1337);
export const rr = (a, b) => a + (b - a) * R();
export function randDir(out = new THREE.Vector3()) {
  const u = R() * 2 - 1, p = R() * Math.PI * 2, s = Math.sqrt(1 - u * u);
  return out.set(s * Math.cos(p), u, s * Math.sin(p));
}

// Keyframe track. keys: [s, value, ease?] — ease shapes the segment arriving at that key.
export class Track {
  constructor(keys) {
    this.k = keys.map((k) => ({ s: k[0], v: k[1], e: typeof k[2] === 'string' ? E[k[2]] : (k[2] || E.io3) }));
    this.k.sort((a, b) => a.s - b.s);
    this.isArr = Array.isArray(this.k[0].v);
    this.tmp = this.isArr ? new Array(this.k[0].v.length) : 0;
  }
  at(s, out) {
    const k = this.k;
    let i = 0;
    if (s <= k[0].s) return this._ret(k[0].v, k[0].v, 0, out);
    const n = k.length;
    if (s >= k[n - 1].s) return this._ret(k[n - 1].v, k[n - 1].v, 0, out);
    let lo = 0, hi = n - 1;
    while (hi - lo > 1) { const m = (lo + hi) >> 1; if (k[m].s <= s) lo = m; else hi = m; }
    i = lo;
    const a = k[i], b = k[i + 1];
    const u = b.e((s - a.s) / (b.s - a.s));
    return this._ret(a.v, b.v, u, out);
  }
  _ret(a, b, u, out) {
    if (!this.isArr) return a + (b - a) * u;
    out = out || [];
    for (let j = 0; j < a.length; j++) out[j] = a[j] + (b[j] - a[j]) * u;
    return out;
  }
}

// Damped spring on a Vector3 (semi-implicit, substepped).
export class Spring3 {
  constructor(w = 30, z = 0.8) { this.x = new THREE.Vector3(); this.v = new THREE.Vector3(); this.w = w; this.z = z; this.init = false; }
  snap(t) { this.x.copy(t); this.v.set(0, 0, 0); this.init = true; }
  step(t, dt) {
    if (!this.init) { this.snap(t); return this.x; }
    if (dt <= 0) return this.x;
    const n = Math.max(1, Math.ceil(dt * this.w / 0.35));
    const h = dt / n, k = this.w * this.w, c = 2 * this.z * this.w;
    for (let i = 0; i < n; i++) {
      this.v.x += (-k * (this.x.x - t.x) - c * this.v.x) * h;
      this.v.y += (-k * (this.x.y - t.y) - c * this.v.y) * h;
      this.v.z += (-k * (this.x.z - t.z) - c * this.v.z) * h;
      this.x.addScaledVector(this.v, h);
    }
    return this.x;
  }
}
export class Spring1 {
  constructor(w = 30, z = 0.8) { this.x = 0; this.v = 0; this.w = w; this.z = z; this.init = false; }
  snap(t) { this.x = t; this.v = 0; this.init = true; }
  step(t, dt) {
    if (!this.init) { this.snap(t); return this.x; }
    if (dt <= 0) return this.x;
    const n = Math.max(1, Math.ceil(dt * this.w / 0.35));
    const h = dt / n, k = this.w * this.w, c = 2 * this.z * this.w;
    for (let i = 0; i < n; i++) { this.v += (-k * (this.x - t) - c * this.v) * h; this.x += this.v * h; }
    return this.x;
  }
}

export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const hdr = (r, g, b, m = 1) => new THREE.Color().setRGB(r * m, g * m, b * m, THREE.LinearSRGBColorSpace);

// Palette (linear HDR values)
export const PAL = {
  gold: hdr(2.6, 1.45, 0.42),
  goldSoft: hdr(1.5, 0.95, 0.38),
  copper: hdr(2.3, 0.82, 0.3),
  amber: hdr(3.0, 1.7, 0.55),
  cream: hdr(1.9, 1.6, 1.25),
  cyan: hdr(0.35, 1.75, 2.5),
  ice: hdr(1.5, 2.2, 2.6),
  teal: hdr(0.15, 1.5, 1.25),
  white: hdr(2.4, 2.4, 2.4),
};

// Hex grid shared with the floor shader (pointy-top, flat-to-flat width HEXW)
export const HEXW = 1.7;
export function hexCenter(x, z) {
  const px = x / HEXW, py = z / HEXW, sx = 1, sy = 1.7320508;
  const ax = Math.floor(px / sx) + 0.5, ay = Math.floor(py / sy) + 0.5;
  const bx = Math.floor((px - 0.5) / sx) + 0.5, by = Math.floor((py - 1) / sy) + 0.5;
  const h1x = px - ax * sx, h1y = py - ay * sy;
  const h2x = px - (bx + 0.5) * sx, h2y = py - (by + 0.5) * sy;
  if (h1x * h1x + h1y * h1y < h2x * h2x + h2y * h2y) return [ax * sx * HEXW, ay * sy * HEXW];
  return [(bx + 0.5) * sx * HEXW, (by + 0.5) * sy * HEXW];
}
