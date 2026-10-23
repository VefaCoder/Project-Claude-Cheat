import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parsePitch, parseDuration, tokenize, transpose, stripFences } from '../src/lang/pianoscript.ts'
import { runPianoScript } from '../src/lang/compile.ts'
import { TempoMap } from '../src/song/song.ts'

const ok = (code: string) => {
  const r = runPianoScript(code)
  if (!r.ok) assert.fail(`compile failed: ${r.message} (line ${r.line})`)
  return r.song
}
const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`)

test('pitches', () => {
  assert.equal(parsePitch('C4'), 60)
  assert.equal(parsePitch('A0'), 21)
  assert.equal(parsePitch('C8'), 108)
  assert.equal(parsePitch('c#4'), 61)
  assert.equal(parsePitch('Db4'), 61)
  assert.equal(parsePitch('bb3'), 58)
  assert.equal(parsePitch('B3'), 59)
  assert.equal(parsePitch('Cb4'), 59)
  assert.equal(parsePitch('F##2'), 43)
  assert.equal(parsePitch('E♭5'), 75)
  assert.equal(parsePitch('H4'), null)
  assert.equal(parsePitch('C'), null)
})

test('durations', () => {
  assert.equal(parseDuration('/4'), 1)
  assert.equal(parseDuration('/1'), 4)
  assert.equal(parseDuration('/8.'), 0.75)
  assert.equal(parseDuration('/4..'), 1.75)
  near(parseDuration('/12'), 1 / 3)
  near(parseDuration('/8t'), 1 / 3)
  assert.equal(parseDuration(2.5), 2.5)
  assert.throws(() => parseDuration('/0'))
  assert.throws(() => parseDuration('4'))
})

test('tokenizer basics and errors', () => {
  const t = tokenize('C4/8. D#4~ [C3 E3 G3]/2& r/16 | mf < f ped * T=90 M=3/4 // comment\n e5@100 % other')
  assert.deepEqual(t.map(x => x.t), ['note', 'note', 'open', 'note', 'note', 'note', 'close', 'rest', 'bar', 'dyn', 'hairpin', 'dyn', 'pedal', 'pedal', 'tempo', 'meter', 'note'])
  assert.throws(() => tokenize('H4'), /H heißt hier B/)
  assert.throws(() => tokenize('C/4'), /ohne Oktavzahl/)
  assert.throws(() => tokenize('C4x'), /Unbekannte Note/)
  assert.throws(() => tokenize('quatsch'), /Unbekanntes Zeichen/)
})

test('sequencing, sticky durations, chords and ties', () => {
  const s = ok(`
    tempo(60)
    const v = voice("rh")
    v.play("C4/4 D4 E4/8 F4 [C4 E4 G4]/2 G4/4~ G4/8 A4")
  `)
  const n = s.notes.map(x => [x.key, +x.start.toFixed(3), +x.dur.toFixed(3)])
  assert.deepEqual(n, [
    [60, 0, 1], [62, 1, 1], [64, 2, 0.5], [65, 2.5, 0.5],
    [60, 3, 2], [64, 3, 2], [67, 3, 2],
    [67, 5, 1.5], [69, 6.5, 0.5],
  ])
})

test('standalone tie and chord ties', () => {
  const s = ok(`tempo(60); voice("a").play("[C4 E4]/2 ~ [C4 G4]/4")`)
  const c = s.notes.find(n => n.key === 60)!
  assert.equal(c.dur, 3)
  assert.equal(s.notes.find(n => n.key === 64)!.dur, 2)
  assert.equal(s.notes.find(n => n.key === 67)!.start, 2)
})

test('dynamics, accents, explicit velocity and hairpins', () => {
  const s = ok(`tempo(60); voice("a").play("p C4/4 < D4 E4 F4 f G4 C5> D5@10")`)
  const vel = s.notes.map(n => n.vel)
  assert.deepEqual(vel, [48, 48, 63, 77, 92, 110, 10])
})

test('tempo map with ramps', () => {
  const tm = new TempoMap([{ beat: 0, bpm: 60, ramp: false }, { beat: 4, bpm: 120, ramp: false }])
  assert.equal(tm.toSeconds(4), 4)
  assert.equal(tm.toSeconds(6), 5)
  const ramp = new TempoMap([{ beat: 0, bpm: 60, ramp: false }, { beat: 4, bpm: 120, ramp: true }])
  // integral of 60/(60+15x) dx from 0..4 = 4 ln 2
  near(ramp.toSeconds(4), 4 * Math.log(2))
  near(ramp.toSeconds(5), 4 * Math.log(2) + 0.5)
})

test('tempo tokens are global', () => {
  const s = ok(`tempo(60)
    voice("a").play("C4/4 C4 T=120 C4 C4")
    voice("b").play("C3/1 C3/4")`)
  const b = s.notes.filter(n => n.key === 48)
  near(b[1].start, 3) // 2 beats @60 + 2 beats @120
})

test('pedal marks, re-pedal and staccato', () => {
  const s = ok(`tempo(60); voice("a").play("ped C4/4 D4 ped E4 * F4'")`)
  assert.deepEqual(s.pedal, [
    { time: 0, down: true }, { time: 2, down: false }, { time: 2, down: true }, { time: 3, down: false },
  ])
  assert.equal(s.notes[3].dur, 0.5)
})

test('bar checks with pickup and meter', () => {
  const s = ok(`meter(3, 8); pickup("/8")
    const r = voice("rh")
    r.play("E5/16 D#5 | E5 D#5 E5 B4 D5 C5 | A4/8 r/16 C4 E4 | B4/8")`)
  assert.equal(s.warnings.length, 1)
  assert.match(s.warnings[0].message, /Takt 2: 1.25 statt 1.5/)
  assert.equal(s.warnings[0].line, 3)
  near(s.bars[0], 0.5 * 0.6) // pickup = one eighth at default 100 bpm
})

test('sync, at, bar() and voices api', () => {
  const s = ok(`tempo(60); meter(4, 4)
    const a = voice("a"), b = voice("b")
    a.play("C4/1 C4/1"); b.play("C3/1")
    sync()
    b.play("D3/4")
    a.at(bar(2)).note("E4", "/4").chord(["G4", 72], "/2").rest("/4")
    if (a.time !== 8) throw new Error("time " + a.time)`)
  near(s.notes.find(n => n.key === 50)!.start, 8)
  near(s.notes.find(n => n.key === 64)!.start, 4)
})

test('hands and colors inferred from pitch', () => {
  const s = ok(`voice("x").play("C2 D2 E2"); voice("y").play("C5 D5"); voice("z", {color: "#123456"}).play("C4")`)
  assert.equal(s.voices[0].hand, 'left')
  assert.equal(s.voices[1].hand, 'right')
  assert.equal(s.voices[2].color, '#123456')
})

test('rolled chords and humanize stay deterministic', () => {
  const code = `tempo(60); humanize(); voice("a").play("[C3 G3 E4]/2& C4/4 D4 E4")`
  const a = ok(code)
  const b = ok(code)
  assert.deepEqual(a.notes, b.notes)
  const plain = ok(`tempo(60); voice("a").play("[C3 G3 E4]/2&")`)
  near(plain.notes[1].start - plain.notes[0].start, 0.028)
})

test('transpose helper', () => {
  assert.equal(transpose('C4/8 [E4 G4]/2 Bb3~ | r', 2), 'D4/8 [F#4 A4]/2 C4~ | r')
  const s = ok(`voice("a").play(transpose("C4 E4", 12))`)
  assert.deepEqual(s.notes.map(n => n.key), [72, 76])
})

test('errors carry line numbers', () => {
  let r = runPianoScript(`tempo(80)\nconst v = voice("a")\nv.play(\`C4 D4\n  E4 H4\`)`)
  assert.equal(r.ok, false)
  if (!r.ok) { assert.match(r.message, /H heißt hier B/); assert.equal(r.line, 4) }
  r = runPianoScript(`tempo(80)\nconst x = (\n`)
  assert.equal(r.ok, false)
  if (!r.ok) { assert.match(r.message, /Syntaxfehler/); assert.equal(r.line, 3) }
  r = runPianoScript(`tempo(80)\n\nfoo()`)
  assert.equal(r.ok, false)
  if (!r.ok) { assert.match(r.message, /"foo" ist nicht definiert/); assert.equal(r.line, 3) }
  r = runPianoScript(`voice("a").note("Q4")`)
  assert.equal(r.ok, false)
  if (!r.ok) assert.equal(r.line, 1)
})

test('markdown fences are stripped', () => {
  assert.equal(stripFences('Hier:\n```javascript\ntempo(90)\n```\nViel Spaß'), 'tempo(90)\n')
  const s = ok('```js\nvoice("a").play("C4")\n```')
  assert.equal(s.notes.length, 1)
})

test('out of range notes are dropped with a warning', () => {
  const s = ok(`voice("a").play("C9 A0 G#0")`)
  assert.equal(s.notes.length, 1)
  assert.equal(s.warnings.length, 2)
})
