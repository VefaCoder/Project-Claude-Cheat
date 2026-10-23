import { EV_ALL_OFF, EV_OFF, EV_ON, EV_PEDAL } from './core.ts'
import { hallImpulse } from './reverb.ts'
import type { PianoPack } from './samples.ts'
import type { Song } from '../song/song.ts'

export const WORKLET_URL = 'piano-worklet.js'
export const SAMPLE_RATE = 48000
const MASTER = 0.42
const WET = 0.75

export interface TimedEvent { time: number; type: number; key: number; vel: number }

/** Flattens a song into sorted piano events. At equal times: note-off, pedal-up, pedal-down, note-on. */
export function songEvents(song: Song): TimedEvent[] {
  const ev: (TimedEvent & { p: number })[] = []
  for (const n of song.notes) {
    ev.push({ time: n.start, type: EV_ON, key: n.key, vel: n.vel, p: 3 })
    ev.push({ time: n.start + n.dur, type: EV_OFF, key: n.key, vel: 0, p: 0 })
  }
  for (const p of song.pedal) ev.push({ time: p.time, type: EV_PEDAL, key: 0, vel: p.down ? 1 : 0, p: p.down ? 2 : 1 })
  ev.sort((a, b) => a.time - b.time || a.p - b.p)
  return ev.map(({ time, type, key, vel }) => ({ time, type, key, vel }))
}

interface Graph {
  node: AudioWorkletNode
  out: GainNode
  wet: GainNode
}

async function buildGraph(ctx: BaseAudioContext, pack: PianoPack, reverb: number, events?: Float64Array): Promise<Graph> {
  await ctx.audioWorklet.addModule(WORKLET_URL)
  const node = new AudioWorkletNode(ctx, 'pianola-piano', {
    numberOfInputs: 0,
    numberOfOutputs: 1,
    outputChannelCount: [2],
    processorOptions: { layout: pack.layout, data: pack.data, events },
  })
  const out = ctx.createGain()
  out.gain.value = MASTER
  const conv = ctx.createConvolver()
  const [l, r] = hallImpulse(ctx.sampleRate)
  const ir = ctx.createBuffer(2, l.length, ctx.sampleRate)
  ir.copyToChannel(l, 0)
  ir.copyToChannel(r, 1)
  conv.buffer = ir
  const wet = ctx.createGain()
  wet.gain.value = reverb * WET
  node.connect(out)
  node.connect(conv).connect(wet).connect(out)
  return { node, out, wet }
}

export class AudioEngine {
  readonly ctx: AudioContext
  private g: Graph | null = null
  private master: GainNode | null = null
  private events: TimedEvent[] = []
  private idx = 0
  private timer = 0
  private t0Ctx = 0
  private t0Song = 0
  private pausedAt = 0
  private songEnd = 0
  playing = false
  onEnded: () => void = () => {}

  constructor() {
    this.ctx = new AudioContext({ sampleRate: SAMPLE_RATE, latencyHint: 'interactive' })
  }

  get ready() { return this.g !== null }

  async init(pack: PianoPack, reverb: number, volume: number) {
    const g = await buildGraph(this.ctx, pack, reverb)
    const master = this.ctx.createGain()
    master.gain.value = volume
    const limiter = this.ctx.createDynamicsCompressor()
    limiter.threshold.value = -3
    limiter.knee.value = 0
    limiter.ratio.value = 20
    limiter.attack.value = 0.002
    limiter.release.value = 0.2
    g.out.connect(master).connect(limiter).connect(this.ctx.destination)
    this.g = g
    this.master = master
  }

  private post(msg: unknown) { this.g?.node.port.postMessage(msg) }

  setReverb(amount: number) { this.g?.wet.gain.setTargetAtTime(amount * WET, this.ctx.currentTime, 0.05) }
  setVolume(v: number) { this.master?.gain.setTargetAtTime(v, this.ctx.currentTime, 0.03) }

  setSong(song: Song) {
    const wasPlaying = this.playing
    const at = Math.min(this.position, song.duration + 1.5)
    this.stop()
    this.events = songEvents(song)
    this.songEnd = song.duration + 1.5
    this.pausedAt = at
    if (wasPlaying) this.play()
  }

  keyDown(key: number, vel = 88) {
    this.resume()
    this.post({ cmd: 'now', type: EV_ON, key, vel })
  }

  keyUp(key: number) { this.post({ cmd: 'now', type: EV_OFF, key, vel: 0 }) }

  private resume() { if (this.ctx.state !== 'running') void this.ctx.resume() }

  /** Song time of the sound that is audible right now. */
  get position(): number {
    if (!this.playing) return this.pausedAt
    let now = this.ctx.currentTime
    const ts = this.ctx.getOutputTimestamp?.()
    if (ts && ts.contextTime !== undefined && ts.performanceTime) {
      now = ts.contextTime + Math.max(0, performance.now() - ts.performanceTime) / 1000
    }
    return Math.max(this.t0Song, this.t0Song + now - this.t0Ctx)
  }

  get duration() { return this.songEnd }

  play(): boolean {
    if (this.playing) return true
    if (!this.g) return false
    this.resume()
    if (this.pausedAt >= this.songEnd - 0.05) this.pausedAt = 0
    this.playing = true
    this.t0Song = this.pausedAt
    this.t0Ctx = this.ctx.currentTime + 0.08
    this.idx = this.events.findIndex(e => e.time >= this.t0Song - 1e-6)
    if (this.idx < 0) this.idx = this.events.length
    // restore the pedal state at the start position
    let pedalDown = false
    for (let i = 0; i < this.idx; i++) if (this.events[i].type === EV_PEDAL) pedalDown = this.events[i].vel > 0
    if (pedalDown) this.post({ cmd: 'events', ev: new Float64Array([Math.round(this.t0Ctx * SAMPLE_RATE), EV_PEDAL, 0, 1]) })
    this.tick()
    this.timer = window.setInterval(() => this.tick(), 25)
    return true
  }

  private tick() {
    const horizon = this.t0Song + (this.ctx.currentTime + 0.3 - this.t0Ctx)
    const batch: number[] = []
    while (this.idx < this.events.length && this.events[this.idx].time < horizon) {
      const e = this.events[this.idx++]
      batch.push(Math.round((this.t0Ctx + e.time - this.t0Song) * SAMPLE_RATE), e.type, e.key, e.vel)
    }
    if (batch.length) this.post({ cmd: 'events', ev: new Float64Array(batch) })
    if (this.position >= this.songEnd) {
      this.pause()
      this.pausedAt = this.songEnd
      this.onEnded()
    }
  }

  pause() {
    if (!this.playing) return
    this.pausedAt = Math.min(this.position, this.songEnd)
    this.stop()
  }

  private stop() {
    window.clearInterval(this.timer)
    if (this.playing) this.post({ cmd: 'clear' })
    this.playing = false
  }

  seek(t: number) {
    const wasPlaying = this.playing
    this.stop()
    this.post({ cmd: 'clear' })
    this.pausedAt = Math.max(0, Math.min(t, this.songEnd))
    if (wasPlaying) this.play()
  }

  panic() { this.post({ cmd: 'now', type: EV_ALL_OFF, key: 0, vel: 0 }) }
}

/** Renders a song offline: identical engine, sample-accurate. `preroll` seconds of silence before the first note. */
export async function renderSongAudio(song: Song, pack: PianoPack, reverb: number, preroll: number, tail: number): Promise<AudioBuffer> {
  const length = Math.ceil((preroll + song.duration + tail) * SAMPLE_RATE)
  const ctx = new OfflineAudioContext(2, length, SAMPLE_RATE)
  const ev = songEvents(song)
  const flat = new Float64Array(ev.length * 4)
  ev.forEach((e, i) => flat.set([Math.round((e.time + preroll) * SAMPLE_RATE), e.type, e.key, e.vel], i * 4))
  const g = await buildGraph(ctx, pack, reverb, flat)
  g.out.connect(ctx.destination)
  return ctx.startRendering()
}

/** Peak-normalises to -1 dBFS and returns interleaved float samples. */
export function masterBuffer(buf: AudioBuffer, fadeOutSeconds = 2): Float32Array {
  const l = buf.getChannelData(0)
  const r = buf.getChannelData(1)
  let peak = 1e-9
  for (let i = 0; i < l.length; i++) peak = Math.max(peak, Math.abs(l[i]), Math.abs(r[i]))
  const gain = Math.pow(10, -1 / 20) / peak
  const out = new Float32Array(l.length * 2)
  const fade = Math.min(l.length, Math.round(fadeOutSeconds * buf.sampleRate))
  for (let i = 0; i < l.length; i++) {
    const k = i >= l.length - fade ? 0.5 + 0.5 * Math.cos((Math.PI * (i - (l.length - fade))) / fade) : 1
    out[i * 2] = l[i] * gain * k
    out[i * 2 + 1] = r[i] * gain * k
  }
  return out
}
