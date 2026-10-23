// AudioWorklet wrapper around PianoCore. Bundled to dist/piano-worklet.js.
import { PianoCore, EV_ALL_OFF, type PackLayout } from './core.ts'

declare const currentFrame: number
declare const sampleRate: number
declare function registerProcessor(name: string, ctor: unknown): void
declare class AudioWorkletProcessor {
  readonly port: MessagePort
  constructor(options?: unknown)
}

interface Options {
  processorOptions: {
    layout: PackLayout
    data: Int16Array
    events?: Float64Array // frame, type, key, vel (offline rendering)
  }
}

class PianoProcessor extends AudioWorkletProcessor {
  private core: PianoCore
  private q: Float64Array
  private qn: number
  private qi = 0
  private now: number[] = []

  constructor(options: Options) {
    super()
    const o = options.processorOptions
    this.core = new PianoCore(o.layout, o.data, sampleRate)
    this.q = o.events ?? new Float64Array(0)
    this.qn = this.q.length
    this.port.onmessage = (e: MessageEvent) => {
      const m = e.data
      if (m.cmd === 'now') this.now.push(m.type, m.key, m.vel)
      else if (m.cmd === 'events') this.enqueue(m.ev as Float64Array)
      else if (m.cmd === 'clear') {
        this.q = new Float64Array(0)
        this.qn = 0
        this.qi = 0
        this.now.push(EV_ALL_OFF, 0, 0)
      }
    }
  }

  private enqueue(ev: Float64Array) {
    const rest = this.q.subarray(this.qi, this.qn)
    const merged = new Float64Array(rest.length + ev.length)
    merged.set(rest)
    merged.set(ev, rest.length)
    // sort quadruples by frame (stable)
    const idx = Array.from({ length: merged.length / 4 }, (_, i) => i)
    idx.sort((a, b) => merged[a * 4] - merged[b * 4] || a - b)
    const out = new Float64Array(merged.length)
    idx.forEach((src, i) => out.set(merged.subarray(src * 4, src * 4 + 4), i * 4))
    this.q = out
    this.qn = out.length
    this.qi = 0
  }

  process(_inputs: Float32Array[][], outputs: Float32Array[][]): boolean {
    const out = outputs[0]
    const L = out[0]
    const R = out[1] ?? out[0]
    L.fill(0)
    if (R !== L) R.fill(0)
    const n = L.length
    const core = this.core
    for (let i = 0; i < this.now.length; i += 3) core.apply(this.now[i], this.now[i + 1], this.now[i + 2])
    this.now.length = 0
    const end = currentFrame + n
    let pos = 0
    const q = this.q
    while (this.qi < this.qn && q[this.qi] < end) {
      const at = Math.max(0, Math.min(n, q[this.qi] - currentFrame))
      if (at > pos) { core.render(L, R, pos, at); pos = at }
      core.apply(q[this.qi + 1], q[this.qi + 2], q[this.qi + 3])
      this.qi += 4
    }
    if (pos < n) core.render(L, R, pos, n)
    return true
  }
}

registerProcessor('pianola-piano', PianoProcessor)
