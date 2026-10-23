// Synthetic concert hall impulse response: early reflections plus a dense noise tail
// whose decay time depends on frequency (bass rings longer, treble dies sooner).

function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = Math.imul(a ^ (a >>> 15), a | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface HallOptions {
  seconds?: number
  predelay?: number
  rtLow?: number
  rtMid?: number
  rtHigh?: number
}

export function hallImpulse(sampleRate: number, o: HallOptions = {}): [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] {
  const seconds = o.seconds ?? 3.2
  const predelay = o.predelay ?? 0.02
  const rtLow = o.rtLow ?? 2.4
  const rtMid = o.rtMid ?? 2.0
  const rtHigh = o.rtHigh ?? 1.1
  const n = Math.ceil(seconds * sampleRate)
  const out: [Float32Array<ArrayBuffer>, Float32Array<ArrayBuffer>] = [new Float32Array(n), new Float32Array(n)]
  const aLow = Math.exp((-2 * Math.PI * 300) / sampleRate)
  const aHigh = Math.exp((-2 * Math.PI * 3800) / sampleRate)
  const kLow = -3 / (rtLow * sampleRate)
  const kMid = -3 / (rtMid * sampleRate)
  const kHigh = -3 / (rtHigh * sampleRate)
  const pre = Math.round(predelay * sampleRate)
  const build = 0.08 * sampleRate

  for (let ch = 0; ch < 2; ch++) {
    const rand = rng(0x51f15e + ch * 7919)
    const y = out[ch]
    let lp = 0
    let hp = 0
    for (let i = pre; i < n; i++) {
      const w = rand() * 2 - 1
      lp = lp * aLow + w * (1 - aLow)
      hp = hp * aHigh + w * (1 - aHigh)
      const lo = lp
      const mid = hp - lp
      const hi = w - hp
      const t = i - pre
      const env = t < build ? Math.sin((0.5 * Math.PI * t) / build) : 1
      y[i] = env * (2.2 * lo * Math.pow(10, kLow * t) + mid * Math.pow(10, kMid * t) + 0.55 * hi * Math.pow(10, kHigh * t))
    }
    // early reflections: sparse taps in the first 90 ms, different per side
    for (let r = 0; r < 18; r++) {
      const time = 0.006 + rand() * 0.085
      const at = Math.round((predelay * 0.4 + time) * sampleRate)
      const amp = (rand() < 0.5 ? -1 : 1) * 0.9 * Math.exp(-time * 22) * (0.5 + rand() * 0.5)
      if (at < n) y[at] += amp
    }
  }
  return out
}
