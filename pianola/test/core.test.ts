import { test } from 'node:test'
import assert from 'node:assert/strict'
import { PianoCore, type PackLayout } from '../src/audio/core.ts'

// Synthetic pack: one root (A4 = 69 = 440 Hz sine), two layers, plus a release noise. 48 kHz, 2 s.
const SR = 48000
function makePack() {
  const frames = SR * 2
  const n = 3
  const data = new Int16Array(frames * 2 * n)
  for (let s = 0; s < 2; s++) {
    const amp = s === 0 ? 4000 : 16000
    for (let i = 0; i < frames; i++) {
      const v = Math.round(amp * Math.sin((2 * Math.PI * 440 * i) / SR))
      data[(s * frames + i) * 2] = v
      data[(s * frames + i) * 2 + 1] = v
    }
  }
  for (let i = 0; i < frames; i++) data[(2 * frames + i) * 2] = data[(2 * frames + i) * 2 + 1] = 1000
  const layout: PackLayout = {
    sampleRate: SR, roots: [69], layerDb: [-24, -12],
    noteSample: [0, 1], releaseSample: new Array(88).fill(2),
    offsets: [0, frames, 2 * frames], frames: [frames, frames, frames],
  }
  return { layout, data }
}

function render(core: PianoCore, frames: number) {
  const L = new Float32Array(frames)
  const R = new Float32Array(frames)
  core.render(L, R, 0, frames)
  return L
}
const rms = (x: Float32Array, a = 0, b = x.length) => { let s = 0; for (let i = a; i < b; i++) s += x[i] * x[i]; return Math.sqrt(s / (b - a)) }
function freq(x: Float32Array, sr: number) {
  let crossings = 0
  for (let i = 1; i < x.length; i++) if (x[i - 1] < 0 && x[i] >= 0) crossings++
  return (crossings * sr) / x.length
}

test('pitch shifting follows equal temperament', () => {
  const { layout, data } = makePack()
  const core = new PianoCore(layout, data, SR)
  core.noteOn(70, 127) // A#4, one semitone up
  const out = render(core, SR)
  const f = freq(out, SR)
  assert.ok(Math.abs(f - 440 * Math.pow(2, 1 / 12)) < 2, `freq ${f}`)
})

test('output sample rate conversion keeps pitch', () => {
  const { layout, data } = makePack()
  const core = new PianoCore(layout, data, 44100)
  core.noteOn(69, 127)
  const out = render(core, 44100)
  assert.ok(Math.abs(freq(out, 44100) - 440) < 2)
})

test('velocity selects layer and scales loudness monotonically', () => {
  const { layout, data } = makePack()
  const levels = [20, 40, 64, 90, 127].map(v => {
    const core = new PianoCore(layout, data, SR)
    core.noteOn(69, v)
    return rms(render(core, 4800))
  })
  for (let i = 1; i < levels.length; i++) assert.ok(levels[i] > levels[i - 1], levels.join(' '))
  const core = new PianoCore(layout, data, SR)
  assert.deepEqual(core.velocityToLayer(127), [1, 1])
  assert.equal(core.velocityToLayer(40)[0], 0)
})

test('note off damps, pedal sustains until released', () => {
  const { layout, data } = makePack()
  const core = new PianoCore(layout, data, SR)
  core.noteOn(60, 100)
  render(core, 4800)
  core.noteOff(60)
  render(core, SR) // 1 s later the damped string is gone (release noise is short too)
  const after = rms(render(core, 4800))
  assert.ok(after < 1e-3, `after release ${after}`)

  const c2 = new PianoCore(layout, data, SR)
  c2.setPedal(true)
  c2.noteOn(60, 100)
  render(c2, 4800)
  c2.noteOff(60)
  render(c2, SR / 2)
  assert.ok(rms(render(c2, 4800)) > 0.01, 'pedal keeps it ringing')
  c2.setPedal(false)
  render(c2, SR)
  assert.ok(rms(render(c2, 4800)) < 1e-3, 'pedal up damps')
})

test('top keys have no dampers', () => {
  const { layout, data } = makePack()
  const core = new PianoCore(layout, data, SR)
  core.noteOn(96, 100)
  render(core, 4800)
  core.noteOff(96)
  render(core, SR / 5) // a damped key this high would be ~60 dB down by now
  assert.ok(rms(render(core, 480)) > 0.01)
})

test('overlapping notes on one key need both offs', () => {
  const { layout, data } = makePack()
  const core = new PianoCore(layout, data, SR)
  core.noteOn(60, 100)
  core.noteOn(60, 100)
  core.noteOff(60)
  render(core, SR)
  assert.ok(rms(render(core, 4800)) > 0.01)
  core.noteOff(60)
  render(core, SR)
  assert.ok(rms(render(core, 4800)) < 1e-3)
})

test('voices end with their sample and allOff silences quickly', () => {
  const { layout, data } = makePack()
  const core = new PianoCore(layout, data, SR)
  core.noteOn(69, 100)
  render(core, SR * 3)
  assert.equal(core.activeVoices, 0)
  for (let k = 40; k < 80; k++) core.noteOn(k, 100)
  core.allOff()
  render(core, SR / 2)
  assert.equal(core.activeVoices, 0)
})

test('polyphony is capped without crashing', () => {
  const { layout, data } = makePack()
  const core = new PianoCore(layout, data, SR)
  for (let i = 0; i < 400; i++) core.noteOn(21 + (i % 88), 100)
  render(core, 1024)
  assert.ok(core.activeVoices <= 256)
})
