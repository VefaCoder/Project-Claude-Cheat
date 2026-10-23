// Sample playback engine for the piano. Pure TypeScript: runs inside the AudioWorklet and in tests.
// Samples are stereo Int16, interleaved, all in one (shared) buffer.

export interface PackLayout {
  sampleRate: number
  roots: number[] // sampled MIDI keys, ascending
  layerDb: number[] // loudness of each velocity layer, ascending
  noteSample: number[] // [rootIndex * layers + layer] -> sample id
  releaseSample: number[] // [key - 21] -> sample id or -1
  offsets: number[] // sample id -> start frame in data
  frames: number[] // sample id -> length in frames
}

export const EV_ON = 0
export const EV_OFF = 1
export const EV_PEDAL = 2
export const EV_ALL_OFF = 3

export interface PianoEvent { frame: number; type: number; key: number; vel: number }

const MAX_VOICES = 256
const UNDAMPED_FROM = 89 // the top strings of a grand piano have no dampers
const STAGE_HELD = 0
const STAGE_SUSTAINED = 1
const STAGE_FADING = 2
const STAGE_FREE = 3 // rings until the sample ends (release noise, undamped strings)
const LN_1000 = Math.log(1000)

export class PianoCore {
  readonly sr: number
  private data: Int16Array
  private L: PackLayout
  private layers: number
  private active = new Uint8Array(MAX_VOICES)
  private vKey = new Int16Array(MAX_VOICES)
  private vOff = new Int32Array(MAX_VOICES)
  private vLen = new Int32Array(MAX_VOICES)
  private vPos = new Float64Array(MAX_VOICES)
  private vInc = new Float64Array(MAX_VOICES)
  private vGain = new Float64Array(MAX_VOICES)
  private vEnv = new Float64Array(MAX_VOICES)
  private vMul = new Float64Array(MAX_VOICES)
  private vStage = new Uint8Array(MAX_VOICES)
  private vBorn = new Float64Array(MAX_VOICES)
  private vVel = new Uint8Array(MAX_VOICES)
  private holds = new Int16Array(128)
  private pedal = false
  private clock = 0
  private rootFor = new Int16Array(128)

  constructor(layout: PackLayout, data: Int16Array, outputRate: number) {
    this.L = layout
    this.data = data
    this.sr = outputRate
    this.layers = layout.layerDb.length
    for (let k = 0; k < 128; k++) {
      let best = 0
      for (let i = 1; i < layout.roots.length; i++) {
        if (Math.abs(layout.roots[i] - k) < Math.abs(layout.roots[best] - k)) best = i
      }
      this.rootFor[k] = best
    }
  }

  get activeVoices(): number {
    let n = 0
    for (let i = 0; i < MAX_VOICES; i++) n += this.active[i]
    return n
  }

  /** Layer and linear gain for a MIDI velocity. Loudness follows 40*log10(v/127) dB below the top layer. */
  velocityToLayer(vel: number): [number, number] {
    const db = this.L.layerDb
    const target = db[this.layers - 1] + 40 * Math.log10(Math.max(1, Math.min(127, vel)) / 127)
    let best = 0
    for (let i = 1; i < this.layers; i++) if (Math.abs(db[i] - target) < Math.abs(db[best] - target)) best = i
    return [best, Math.pow(10, (target - db[best]) / 20)]
  }

  private mulForT60(seconds: number): number {
    return Math.exp(-LN_1000 / (seconds * this.sr))
  }

  private dampT60(key: number): number {
    return 0.9 * Math.pow(2, -(key - 21) / 20) + 0.12
  }

  private alloc(): number {
    let victim = -1
    let quietest = Infinity
    for (let i = 0; i < MAX_VOICES; i++) {
      if (!this.active[i]) return i
      // prefer stealing fading voices, then the quietest
      const loud = this.vEnv[i] * this.vGain[i] * (this.vStage[i] === STAGE_FADING ? 0.01 : 1)
      if (loud < quietest) { quietest = loud; victim = i }
    }
    return victim
  }

  private start(sample: number, key: number, inc: number, gain: number, stage: number, vel: number) {
    const v = this.alloc()
    this.active[v] = 1
    this.vKey[v] = key
    this.vOff[v] = this.L.offsets[sample]
    this.vLen[v] = this.L.frames[sample]
    this.vPos[v] = 0
    this.vInc[v] = inc
    this.vGain[v] = gain / 32768
    this.vEnv[v] = 1
    this.vMul[v] = 1
    this.vStage[v] = stage
    this.vBorn[v] = this.clock
    this.vVel[v] = vel
  }

  private fade(v: number, t60: number) {
    this.vStage[v] = STAGE_FADING
    this.vMul[v] = Math.min(this.vMul[v], this.mulForT60(t60))
  }

  noteOn(key: number, vel: number) {
    if (key < 21 || key > 108 || vel <= 0) return
    for (let v = 0; v < MAX_VOICES; v++) {
      if (this.active[v] && this.vKey[v] === key && this.vStage[v] !== STAGE_FADING) this.fade(v, 0.3)
    }
    const ri = this.rootFor[key]
    const [layer, gain] = this.velocityToLayer(vel)
    const sample = this.L.noteSample[ri * this.layers + layer]
    const inc = Math.pow(2, (key - this.L.roots[ri]) / 12) * (this.L.sampleRate / this.sr)
    this.start(sample, key, inc, gain, STAGE_HELD, vel)
    this.holds[key]++
  }

  noteOff(key: number) {
    if (key < 0 || key > 127 || this.holds[key] <= 0) return
    if (--this.holds[key] > 0) return
    for (let v = 0; v < MAX_VOICES; v++) {
      if (!this.active[v] || this.vKey[v] !== key || this.vStage[v] !== STAGE_HELD) continue
      if (key >= UNDAMPED_FROM) this.vStage[v] = STAGE_FREE
      else if (this.pedal) this.vStage[v] = STAGE_SUSTAINED
      else {
        this.fade(v, this.dampT60(key))
        this.releaseNoise(key, this.vVel[v])
      }
    }
  }

  private releaseNoise(key: number, vel: number) {
    const id = this.L.releaseSample[key - 21]
    if (id === undefined || id < 0) return
    this.start(id, -1, this.L.sampleRate / this.sr, 0.035 * (0.4 + (0.6 * vel) / 127), STAGE_FREE, vel)
  }

  setPedal(down: boolean) {
    if (down === this.pedal) return
    this.pedal = down
    if (down) return
    for (let v = 0; v < MAX_VOICES; v++) {
      if (this.active[v] && this.vStage[v] === STAGE_SUSTAINED) this.fade(v, this.dampT60(this.vKey[v]))
    }
  }

  allOff() {
    this.pedal = false
    this.holds.fill(0)
    for (let v = 0; v < MAX_VOICES; v++) if (this.active[v]) this.fade(v, 0.08)
  }

  apply(type: number, key: number, vel: number) {
    if (type === EV_ON) this.noteOn(key, vel)
    else if (type === EV_OFF) this.noteOff(key)
    else if (type === EV_PEDAL) this.setPedal(vel > 0)
    else if (type === EV_ALL_OFF) this.allOff()
  }

  /** Adds all voices into outL/outR between frame indices [from, to). */
  render(outL: Float32Array, outR: Float32Array, from: number, to: number) {
    const d = this.data
    for (let v = 0; v < MAX_VOICES; v++) {
      if (!this.active[v]) continue
      const base = this.vOff[v] * 2
      const last = this.vLen[v] - 3
      const inc = this.vInc[v]
      const mul = this.vMul[v]
      const gain = this.vGain[v]
      let pos = this.vPos[v]
      let env = this.vEnv[v]
      let i = from
      for (; i < to; i++) {
        const idx = pos | 0
        if (idx >= last) break
        const f = pos - idx
        const j = base + idx * 2
        const jm = idx > 0 ? j - 2 : j
        // 4-point cubic Hermite per channel
        let y0 = d[jm], y1 = d[j], y2 = d[j + 2], y3 = d[j + 4]
        const l = ((((0.5 * (y3 - y0) + 1.5 * (y1 - y2)) * f + (y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3)) * f + 0.5 * (y2 - y0)) * f + y1)
        y0 = d[jm + 1]; y1 = d[j + 1]; y2 = d[j + 3]; y3 = d[j + 5]
        const r = ((((0.5 * (y3 - y0) + 1.5 * (y1 - y2)) * f + (y0 - 2.5 * y1 + 2 * y2 - 0.5 * y3)) * f + 0.5 * (y2 - y0)) * f + y1)
        const g = gain * env
        outL[i] += l * g
        outR[i] += r * g
        env *= mul
        pos += inc
      }
      if (i < to || env < 1e-4) this.active[v] = 0
      this.vPos[v] = pos
      this.vEnv[v] = env
    }
    this.clock += to - from
  }
}

/** Builds the lookup layout from the pack index (assets/piano/index.json). Offsets are assigned in index order. */
export function layoutFromIndex(index: PackIndex): { layout: PackLayout; totalFrames: number; files: { file: string; offset: number; frames: number }[] } {
  const offsets: number[] = []
  const frames: number[] = []
  const files: { file: string; offset: number; frames: number }[] = []
  let total = 0
  const add = (file: string, n: number) => {
    offsets.push(total)
    frames.push(n)
    files.push({ file, offset: total, frames: n })
    total += n
    return offsets.length - 1
  }
  const L = index.layers.length
  const noteSample = new Array<number>(index.roots.length * L).fill(-1)
  for (const n of index.notes) noteSample[index.roots.indexOf(n.root) * L + n.layer] = add(n.file, n.frames)
  const releaseSample = new Array<number>(88).fill(-1)
  for (const r of index.release) releaseSample[r.key - 21] = add(r.file, r.frames)
  return {
    layout: { sampleRate: index.sampleRate, roots: index.roots, layerDb: index.layerDb, noteSample, releaseSample, offsets, frames },
    totalFrames: total,
    files,
  }
}

export interface PackIndex {
  version: number
  sampleRate: number
  roots: number[]
  layers: number[]
  layerDb: number[]
  notes: { root: number; layer: number; file: string; frames: number }[]
  release: { key: number; file: string; frames: number }[]
  source: string
}
