// PianoScript: plain JavaScript plus a small music API and a compact note notation.
// The runtime collects everything in beats (quarter notes) and converts to seconds at the end.

import {
  TempoMap, barBeats, HIGHEST_KEY, LOWEST_KEY,
  type MeterPoint, type PedalEvent, type Song, type SongNote, type TempoPoint, type VoiceInfo, type Warning,
} from '../song/song.ts'

export class ScriptError extends Error {
  line?: number
  offset?: number
  constructor(message: string, line?: number) {
    super(message)
    this.name = 'ScriptError'
    this.line = line
  }
}

export const DYNAMICS: Record<string, number> = { ppp: 22, pp: 34, p: 48, mp: 62, mf: 76, f: 92, ff: 106, fff: 120 }
const LETTERS: Record<string, number> = { c: 0, d: 2, e: 4, f: 5, g: 7, a: 9, b: 11 }
const ACCIDENTALS: Record<string, number> = { '': 0, n: 0, '#': 1, '##': 2, '♯': 1, b: -1, bb: -2, '♭': -1 }
const SHARP_NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']

const RIGHT_COLORS = ['#3fb6ff', '#9b8cff', '#2fe0c8', '#5d8bff']
const LEFT_COLORS = ['#ff8a3d', '#ff5fa2', '#ffc53d', '#ff6b5b']

const PITCH_SRC = '([A-Ga-g])(##|#|bb|b|♯|♭|n)?(-?\\d)'
const DUR_SRC = '\\/(\\d+(?:\\.\\d+)?)(t?)(\\.*)'
const SEP = /[\s,;|[\]]/

/** "C#4" -> 61. Returns null if the text is not a pitch. Middle C = C4 = 60. */
export function parsePitch(text: string): number | null {
  const m = new RegExp(`^${PITCH_SRC}$`).exec(text)
  return m ? keyOf(m[1], m[2], m[3]) : null
}

function keyOf(letter: string, acc: string | undefined, oct: string): number {
  return 12 * (Number(oct) + 1) + LETTERS[letter.toLowerCase()] + ACCIDENTALS[acc ?? '']
}

export function pitchName(key: number): string {
  return SHARP_NAMES[((key % 12) + 12) % 12] + (Math.floor(key / 12) - 1)
}

/** Duration in beats: "/4" = 1, "/8." = 0.75, "/12" = 1/3. Plain numbers are beats. */
export function parseDuration(d: string | number): number {
  if (typeof d === 'number') {
    if (!(d > 0) || !Number.isFinite(d)) throw new ScriptError(`Ungültige Dauer ${d}`)
    return d
  }
  const m = new RegExp(`^${DUR_SRC}$`).exec(String(d).trim())
  if (!m) throw new ScriptError(`Ungültige Dauer "${d}" (Beispiele: "/4", "/8.", "/16")`)
  return durFromMatch(m)
}

function durFromMatch(m: RegExpExecArray): number {
  const n = Number(m[1])
  if (!(n > 0)) throw new ScriptError(`Ungültige Dauer "${m[0]}"`)
  let beats = 4 / n
  if (m[2]) beats *= 2 / 3
  let add = beats
  for (let i = 0; i < m[3].length; i++) { add /= 2; beats += add }
  return beats
}

// ---------------------------------------------------------------- tokens

interface Mods { dur?: number; tie: boolean; stacc: boolean; accent: boolean; vel?: number; roll: boolean }
type NoteToken = { t: 'note'; key: number; off: number } & Mods
type Token =
  | NoteToken
  | { t: 'rest'; dur?: number; off: number }
  | { t: 'open'; off: number }
  | ({ t: 'close'; off: number } & Mods)
  | { t: 'tie'; off: number }
  | { t: 'bar'; repeat: boolean; off: number }
  | { t: 'dyn'; vel: number; off: number }
  | { t: 'hairpin'; off: number }
  | { t: 'pedal'; down: boolean; off: number }
  | { t: 'tempo'; bpm: number; ramp: boolean; off: number }
  | { t: 'meter'; num: number; den: number; off: number }

function tokenError(msg: string, offset: number): never {
  const e = new ScriptError(msg)
  e.offset = offset
  throw e
}

export function tokenize(src: string): Token[] {
  const out: Token[] = []
  const pitchY = new RegExp(PITCH_SRC, 'y')
  const durY = new RegExp(DUR_SRC, 'y')
  const velY = /@(\d{1,3})/y
  const barY = /:?\|+[:\]]?/y
  const wordY = /[^\s,;|[\]]+/y
  const n = src.length
  let i = 0

  const mods = (start: number): [Mods, number] => {
    const m: Mods = { tie: false, stacc: false, accent: false, roll: false }
    let j = start
    durY.lastIndex = j
    const d = durY.exec(src)
    if (d) { m.dur = durFromMatch(d); j = durY.lastIndex }
    for (;;) {
      const c = src[j]
      if (c === '~') { m.tie = true; j++ }
      else if (c === "'") { m.stacc = true; j++ }
      else if (c === '>') { m.accent = true; j++ }
      else if (c === '&') { m.roll = true; j++ }
      else if (c === '@') {
        velY.lastIndex = j
        const v = velY.exec(src)
        if (!v) tokenError('Nach "@" muss eine Lautstärke 1–127 stehen', j)
        m.vel = Math.max(1, Math.min(127, Number(v[1])))
        j = velY.lastIndex
      } else break
    }
    return [m, j]
  }
  const word = (at: number) => { wordY.lastIndex = at; return wordY.exec(src)?.[0] ?? src[at] }

  while (i < n) {
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r' || c === ',' || c === ';') { i++; continue }
    if (c === '%' || (c === '/' && src[i + 1] === '/')) { while (i < n && src[i] !== '\n') i++; continue }
    if (c === '|' || (c === ':' && src[i + 1] === '|')) {
      barY.lastIndex = i
      const m = barY.exec(src)!
      out.push({ t: 'bar', repeat: m[0].includes(':'), off: i })
      i = barY.lastIndex
      continue
    }
    if (c === '[') { out.push({ t: 'open', off: i }); i++; continue }
    if (c === ']') {
      const [m, j] = mods(i + 1)
      out.push({ t: 'close', off: i, ...m })
      i = j
      continue
    }
    if (c === '*') { out.push({ t: 'pedal', down: false, off: i }); i++; continue }
    if (c === '~') { out.push({ t: 'tie', off: i }); i++; continue }
    if ((c === '<' || c === '>') && (i + 1 >= n || SEP.test(src[i + 1]))) { out.push({ t: 'hairpin', off: i }); i++; continue }

    pitchY.lastIndex = i
    const pm = pitchY.exec(src)
    if (pm) {
      const [m, j] = mods(pitchY.lastIndex)
      if (j < n && !SEP.test(src[j])) tokenError(`Unbekannte Note "${word(i)}"`, i)
      out.push({ t: 'note', key: keyOf(pm[1], pm[2], pm[3]), off: i, ...m })
      i = j
      continue
    }

    const w = word(i)
    const lw = w.toLowerCase()
    if (lw === 'r' || lw.startsWith('r/')) {
      let dur: number | undefined
      if (w.length > 1) {
        const d = new RegExp(`^${DUR_SRC}$`).exec(w.slice(1))
        if (!d) tokenError(`Ungültige Pause "${w}"`, i)
        dur = durFromMatch(d)
      }
      out.push({ t: 'rest', dur, off: i })
    } else if (w in DYNAMICS) {
      out.push({ t: 'dyn', vel: DYNAMICS[w], off: i })
    } else if (/^(cresc|dim|decresc)\.?$/.test(lw)) {
      out.push({ t: 'hairpin', off: i })
    } else if (lw === 'ped' || lw === 'ped.') {
      out.push({ t: 'pedal', down: true, off: i })
    } else if (/^t[=~]\d+(\.\d+)?$/i.test(w)) {
      out.push({ t: 'tempo', bpm: Number(w.slice(2)), ramp: w[1] === '~', off: i })
    } else if (/^m=\d+\/\d+$/i.test(w)) {
      const [num, den] = w.slice(2).split('/').map(Number)
      out.push({ t: 'meter', num, den, off: i })
    } else if (/^[hH](#|b)?-?\d/.test(w)) {
      tokenError(`Unbekannte Note "${w}" (H heißt hier B, B heißt Bb)`, i)
    } else if (/^[A-Ga-g](##|#|bb|b|♯|♭)?(\/|~|$)/.test(w)) {
      tokenError(`Note "${w}" ohne Oktavzahl (z. B. ${w.replace(/^([A-Ga-g](?:##|#|bb|b|♯|♭)?)/, '$14')})`, i)
    } else {
      tokenError(`Unbekanntes Zeichen "${w}"`, i)
    }
    i += w.length
  }
  return out
}

/** Transposes every pitch inside a notation string by `semitones`. */
export function transpose(notation: string, semitones: number): string {
  const re = new RegExp(`(^|[\\s[\\],;|])${PITCH_SRC}(?=[/\\s\\]~'@&>,;|]|$)`, 'g')
  return String(notation).replace(re, (_all, pre, l, acc, oct) => pre + pitchName(keyOf(l, acc, oct) + semitones))
}

// ---------------------------------------------------------------- runtime

interface RawNote {
  start: number // beats
  dur: number // notated beats
  key: number
  vel: number
  voice: number
  stacc: boolean
  roll: number // index inside a rolled chord, -1 if none
  velFixed: boolean
}

interface Hairpin { start: number; vel: number; notes: RawNote[] }
interface NoteSpec { key: number; dur: number; tie: boolean; stacc: boolean; vel?: number }

export interface VoiceOptions { color?: string; hand?: 'left' | 'right' }

const EPS = 1e-6
const fmt = (x: number) => String(Math.round(x * 1000) / 1000)
const round6 = (x: number) => Math.round(x * 1e6) / 1e6

function countLines(s: string, upto: number): number {
  let line = 1
  for (let i = 0; i < upto && i < s.length; i++) if (s.charCodeAt(i) === 10) line++
  return line
}

class Runtime {
  title = ''
  composer = ''
  tempoPts = new Map<number, TempoPoint>()
  meters = new Map<number, MeterPoint>()
  pedalMarks: { beat: number; down: boolean; seq: number }[] = []
  pickupBeats = 0
  humanizeAmount = 0
  voices: VoiceState[] = []
  warnings: Warning[] = []

  code: string
  constructor(code: string) { this.code = code }

  warn(message: string, line?: number) {
    if (this.warnings.length < 40) this.warnings.push({ message, line })
  }

  meterList(): MeterPoint[] {
    const list = [...this.meters.values()].sort((a, b) => a.beat - b.beat)
    if (!list.length || list[0].beat > 0) list.unshift({ beat: 0, num: 4, den: 4 })
    return list
  }

  barLenAt(beat: number): number {
    let m = this.meterList()[0]
    for (const x of this.meterList()) if (x.beat <= beat + EPS) m = x
    return (m.num * 4) / m.den
  }

  /** Beat where bar `n` starts (bar 1 starts after the pickup). */
  barStart(n: number): number {
    if (!Number.isInteger(n) || n < 1) throw new ScriptError(`bar(${n}): Taktnummer muss 1 oder größer sein`)
    let b = this.pickupBeats
    for (let i = 1; i < n; i++) b += this.barLenAt(b)
    return b
  }

  /** Number of the bar containing `beat` (0 = pickup). */
  barNumber(beat: number): number {
    if (beat < this.pickupBeats - 1e-4) return 0
    let b = this.pickupBeats
    let bar = 1
    while (bar < 100000) {
      const len = this.barLenAt(b)
      if (beat < b + len - 1e-4) return bar
      b += len
      bar++
    }
    return bar
  }

  /** Line of the user's code that called into the API. */
  callerLine(): number | undefined {
    const m = /song\.js:(\d+):\d+/.exec(new Error().stack ?? '')
    return m ? Number(m[1]) : undefined
  }

  /** Maps offsets inside a notation string to source lines. */
  locator(str: string): (off: number) => number | undefined {
    const callLine = this.callerLine()
    const idx = str.length > 3 ? this.code.indexOf(str) : -1
    if (idx >= 0) {
      const base = countLines(this.code, idx)
      return off => base + countLines(str, off) - 1
    }
    return () => callLine
  }
}

class VoiceState {
  cursor = 0
  barMark = 0
  lastDur = 1
  vel = DYNAMICS.mf
  notes: RawNote[] = []
  last: RawNote[] = []
  ties = new Map<number, RawNote>()
  hairpin: Hairpin | null = null
  rt: Runtime
  index: number
  name: string
  opts: VoiceOptions
  constructor(rt: Runtime, index: number, name: string, opts: VoiceOptions) {
    this.rt = rt
    this.index = index
    this.name = name
    this.opts = opts
  }

  jump(beat: number) {
    this.cursor = beat
    this.barMark = beat
    this.ties.clear()
    this.last = []
  }

  addNotes(items: NoteSpec[], advance: number, roll: boolean, line?: number) {
    const keep = new Map<number, RawNote>()
    const created: RawNote[] = []
    let rollIdx = 0
    const list = roll ? [...items].sort((a, b) => a.key - b.key) : items
    for (const it of list) {
      if (it.key < LOWEST_KEY || it.key > HIGHEST_KEY) {
        this.rt.warn(`Stimme "${this.name}": ${pitchName(it.key)} liegt außerhalb der 88 Tasten (A0–C8) und wird ignoriert`, line)
        continue
      }
      const open = this.ties.get(it.key)
      if (open && Math.abs(open.start + open.dur - this.cursor) < 1e-4) {
        open.dur += it.dur
        if (it.tie) keep.set(it.key, open)
        created.push(open)
        continue
      }
      const note: RawNote = {
        start: this.cursor, dur: it.dur, key: it.key, vel: it.vel ?? this.vel, voice: this.index,
        stacc: it.stacc, roll: roll ? rollIdx++ : -1, velFixed: it.vel !== undefined,
      }
      this.notes.push(note)
      created.push(note)
      if (this.hairpin && !note.velFixed) this.hairpin.notes.push(note)
      if (it.tie) keep.set(it.key, note)
    }
    this.ties = keep
    this.last = created
    this.cursor += advance
  }

  resolveHairpin(target: number) {
    const h = this.hairpin
    if (!h) return
    const span = Math.max(this.cursor - h.start, EPS)
    for (const n of h.notes) n.vel = Math.round(h.vel + ((target - h.vel) * (n.start - h.start)) / span)
    this.hairpin = null
  }

  velFor(m: Mods): number | undefined {
    if (m.vel !== undefined) return m.vel
    return m.accent ? Math.min(127, this.vel + 18) : undefined
  }

  barCheck(line?: number) {
    const seg = this.cursor - this.barMark
    const expected = this.barMark < this.rt.pickupBeats - 1e-4 ? this.rt.pickupBeats - this.barMark : this.rt.barLenAt(this.barMark)
    if (Math.abs(seg - expected) > 1e-4) {
      const bar = this.rt.barNumber(this.barMark)
      const where = bar === 0 ? 'Auftakt' : `Takt ${bar}`
      this.rt.warn(`Stimme "${this.name}", ${where}: ${fmt(seg)} statt ${fmt(expected)} Schläge`, line)
    }
    this.barMark = this.cursor
  }

  play(str: string) {
    if (typeof str !== 'string') throw new ScriptError(`play() erwartet Text mit Noten, bekam ${typeof str}`)
    const lineOf = this.rt.locator(str)
    let tokens: Token[]
    try {
      tokens = tokenize(str)
    } catch (e) {
      const se = e as ScriptError
      throw new ScriptError(`Stimme "${this.name}": ${se.message}`, lineOf(se.offset ?? 0))
    }
    let chord: NoteToken[] | null = null
    let chordOff = 0
    for (const tk of tokens) {
      const line = () => lineOf(tk.off)
      if (chord && tk.t !== 'note' && tk.t !== 'close') {
        throw new ScriptError(`Stimme "${this.name}": In einem Akkord [ ] sind nur Noten erlaubt`, line())
      }
      switch (tk.t) {
        case 'note': {
          if (chord) { chord.push(tk); break }
          const dur = tk.dur ?? this.lastDur
          this.lastDur = dur
          this.addNotes([{ key: tk.key, dur, tie: tk.tie, stacc: tk.stacc, vel: this.velFor(tk) }], dur, false, line())
          break
        }
        case 'open':
          if (chord) throw new ScriptError(`Stimme "${this.name}": Akkord in Akkord ist nicht erlaubt`, line())
          chord = []
          chordOff = tk.off
          break
        case 'close': {
          if (!chord) throw new ScriptError(`Stimme "${this.name}": "]" ohne passendes "["`, line())
          if (!chord.length) throw new ScriptError(`Stimme "${this.name}": Leerer Akkord`, lineOf(chordOff))
          const dur = tk.dur ?? this.lastDur
          this.lastDur = dur
          const cv = this.velFor(tk)
          this.addNotes(
            chord.map(n => ({ key: n.key, dur: n.dur ?? dur, tie: n.tie || tk.tie, stacc: n.stacc || tk.stacc, vel: this.velFor(n) ?? cv })),
            dur, tk.roll, line(),
          )
          chord = null
          break
        }
        case 'tie':
          for (const n of this.last) this.ties.set(n.key, n)
          break
        case 'rest': {
          const dur = tk.dur ?? this.lastDur
          this.lastDur = dur
          this.ties.clear()
          this.last = []
          this.cursor += dur
          break
        }
        case 'bar':
          if (tk.repeat) this.rt.warn(`Stimme "${this.name}": Wiederholungszeichen werden nicht ausgeführt. Bitte ausschreiben oder eine Schleife benutzen.`, line())
          this.barCheck(line())
          break
        case 'dyn':
          this.resolveHairpin(tk.vel)
          this.vel = tk.vel
          break
        case 'hairpin':
          this.hairpin = { start: this.cursor, vel: this.vel, notes: [] }
          break
        case 'pedal':
          this.rt.pedalMarks.push({ beat: this.cursor, down: tk.down, seq: this.rt.pedalMarks.length })
          break
        case 'tempo':
          if (!(tk.bpm >= 10 && tk.bpm <= 400)) throw new ScriptError(`Tempo ${tk.bpm} ist unrealistisch (10–400)`, line())
          this.rt.tempoPts.set(round6(this.cursor), { beat: round6(this.cursor), bpm: tk.bpm, ramp: tk.ramp })
          break
        case 'meter':
          if (!(tk.num > 0 && [1, 2, 4, 8, 16, 32].includes(tk.den))) throw new ScriptError(`Taktart ${tk.num}/${tk.den} ist ungültig`, line())
          this.rt.meters.set(round6(this.cursor), { beat: round6(this.cursor), num: tk.num, den: tk.den })
          break
      }
    }
    if (chord) throw new ScriptError(`Stimme "${this.name}": "[" ohne passendes "]"`, lineOf(chordOff))
  }
}

function toKey(p: string | number): number {
  if (typeof p === 'number') {
    if (!Number.isInteger(p)) throw new ScriptError(`Tonhöhe ${p} muss eine ganze Zahl (MIDI) sein`)
    return p
  }
  const k = parsePitch(String(p).trim())
  if (k === null) throw new ScriptError(`Unbekannte Note "${p}"`)
  return k
}

// mulberry32: deterministic, so preview and export humanize identically
function rng(seed: number) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

export interface VoiceApi {
  play(notation: string): VoiceApi
  note(pitch: string | number, dur?: string | number, opts?: { vel?: number; tie?: boolean }): VoiceApi
  chord(pitches: (string | number)[], dur?: string | number, opts?: { vel?: number; roll?: boolean }): VoiceApi
  rest(dur?: string | number): VoiceApi
  at(beat: number): VoiceApi
  readonly time: number
}

/** Builds the API for one run. `code` is the full user source (used to map errors to lines). */
export function createRuntime(code: string) {
  const rt = new Runtime(code)
  const states = new WeakMap<VoiceApi, VoiceState>()

  const guard = <A extends unknown[], R>(fn: (...a: A) => R) => (...a: A): R => {
    try { return fn(...a) } catch (e) {
      if (e instanceof ScriptError && e.line === undefined) e.line = rt.callerLine()
      throw e
    }
  }

  const makeVoice = (st: VoiceState): VoiceApi => {
    const dur = (d?: string | number) => (d === undefined ? st.lastDur : parseDuration(d))
    const v: VoiceApi = {
      play: guard((s: string) => { st.play(s); return v }),
      note: guard((p: string | number, d?: string | number, o: { vel?: number; tie?: boolean } = {}) => {
        const len = dur(d)
        st.lastDur = len
        st.addNotes([{ key: toKey(p), dur: len, tie: !!o.tie, stacc: false, vel: o.vel }], len, false, rt.callerLine())
        return v
      }),
      chord: guard((ps: (string | number)[], d?: string | number, o: { vel?: number; roll?: boolean } = {}) => {
        if (!Array.isArray(ps) || !ps.length) throw new ScriptError('chord() erwartet eine Liste von Noten, z. B. ["C4", "E4", "G4"]')
        const len = dur(d)
        st.lastDur = len
        st.addNotes(ps.map(p => ({ key: toKey(p), dur: len, tie: false, stacc: false, vel: o.vel })), len, !!o.roll, rt.callerLine())
        return v
      }),
      rest: guard((d?: string | number) => {
        const len = dur(d)
        st.lastDur = len
        st.ties.clear()
        st.last = []
        st.cursor += len
        return v
      }),
      at: guard((beat: number) => {
        if (!(beat >= 0) || !Number.isFinite(beat)) throw new ScriptError(`at(${beat}): Position muss eine Zahl ≥ 0 sein`)
        st.jump(beat)
        return v
      }),
      get time() { return st.cursor },
    }
    states.set(v, st)
    return v
  }

  const api = {
    title: guard((t: string) => { rt.title = String(t) }),
    composer: guard((c: string) => { rt.composer = String(c) }),
    tempo: guard((bpm: number, atBeat: number = 0) => {
      if (!(bpm >= 10 && bpm <= 400)) throw new ScriptError(`tempo(${bpm}) ist unrealistisch (10–400)`)
      rt.tempoPts.set(round6(atBeat), { beat: round6(atBeat), bpm, ramp: false })
    }),
    meter: guard((num: number, den: number, atBeat: number = 0) => {
      if (!(num > 0 && [1, 2, 4, 8, 16, 32].includes(den))) throw new ScriptError(`meter(${num}, ${den}) ist ungültig`)
      rt.meters.set(round6(atBeat), { beat: round6(atBeat), num, den })
    }),
    pickup: guard((d: string | number) => { rt.pickupBeats = parseDuration(d) }),
    humanize: guard((amount: number = 1) => { rt.humanizeAmount = Math.max(0, Math.min(3, Number(amount) || 0)) }),
    bar: guard((n: number) => rt.barStart(n)),
    transpose: guard((s: string, semis: number) => transpose(s, semis)),
    sync: guard((...vs: VoiceApi[]) => {
      const targets = vs.length ? vs.map(v => states.get(v)).filter((s): s is VoiceState => !!s) : rt.voices
      const max = Math.max(0, ...targets.map(s => s.cursor))
      for (const s of targets) s.jump(max)
    }),
    voice: guard((name?: string, opts: VoiceOptions = {}): VoiceApi => {
      const label = name === undefined ? `Stimme ${rt.voices.length + 1}` : String(name)
      let st = rt.voices.find(v => v.name === label)
      if (!st) {
        st = new VoiceState(rt, rt.voices.length, label, opts ?? {})
        rt.voices.push(st)
      }
      return makeVoice(st)
    }),
  }
  return { api, finish: () => finish(rt) }
}

function finish(rt: Runtime): Song {
  for (const v of rt.voices) {
    if (v.hairpin) {
      rt.warn(`Stimme "${v.name}": Crescendo/Decrescendo ohne Ziel-Dynamik am Ende`)
      v.hairpin = null
    }
  }
  const raw = rt.voices.flatMap(v => v.notes)
  if (!rt.tempoPts.size) rt.tempoPts.set(0, { beat: 0, bpm: 100, ramp: false })
  const tm = new TempoMap([...rt.tempoPts.values()])
  const rand = rng(0x9e3779b1 ^ raw.length)
  const gauss = () => { let s = 0; for (let i = 0; i < 4; i++) s += rand(); return (s - 2) * 0.866 }
  const H = rt.humanizeAmount

  const notes: SongNote[] = []
  for (const r of raw) {
    let start = tm.toSeconds(r.start)
    let end = tm.toSeconds(r.start + r.dur)
    if (r.stacc) end = start + (end - start) * 0.5
    if (r.roll > 0) start += Math.min(r.roll * 0.028, (end - start) * 0.5)
    let vel = r.vel
    if (H > 0) {
      start += gauss() * 0.006 * H
      end += gauss() * 0.006 * H
      vel += gauss() * 3.5 * H
    }
    start = Math.max(0, start)
    notes.push({ start, dur: Math.max(0.02, end - start), key: r.key, vel: Math.max(1, Math.min(127, Math.round(vel))), voice: r.voice })
  }
  notes.sort((a, b) => a.start - b.start || a.key - b.key)

  // "ped" while the pedal is already down re-pedals: up and down at the same moment.
  const marks = [...rt.pedalMarks].sort((a, b) => a.beat - b.beat || Number(a.down) - Number(b.down) || a.seq - b.seq)
  const pedal: PedalEvent[] = []
  let down = false
  for (const m of marks) {
    const time = tm.toSeconds(m.beat)
    if (m.down) {
      if (down) pedal.push({ time, down: false })
      pedal.push({ time, down: true })
      down = true
    } else if (down) {
      pedal.push({ time, down: false })
      down = false
    }
  }

  let endBeat = 0
  for (const r of raw) endBeat = Math.max(endBeat, r.start + r.dur)
  for (const v of rt.voices) endBeat = Math.max(endBeat, v.cursor)
  const bars = barBeats(rt.meterList(), rt.pickupBeats, endBeat).map(b => tm.toSeconds(b))

  // Hand and color: explicit options win, otherwise the average pitch decides.
  let rightN = 0
  let leftN = 0
  const voices: VoiceInfo[] = rt.voices.map(v => {
    const avg = v.notes.length ? v.notes.reduce((s, n) => s + n.key, 0) / v.notes.length : 60
    const hand: 'left' | 'right' = v.opts.hand === 'left' || v.opts.hand === 'right' ? v.opts.hand : avg >= 60 ? 'right' : 'left'
    const color = typeof v.opts.color === 'string' && /^#[0-9a-f]{6}$/i.test(v.opts.color)
      ? v.opts.color
      : hand === 'right' ? RIGHT_COLORS[rightN++ % RIGHT_COLORS.length] : LEFT_COLORS[leftN++ % LEFT_COLORS.length]
    return { name: v.name, color, hand }
  })

  const duration = notes.reduce((m, n) => Math.max(m, n.start + n.dur), 0)
  if (!notes.length) rt.warn('Das Stück enthält noch keine Noten')
  return { title: rt.title, composer: rt.composer, voices, notes, pedal, bars, duration, warnings: rt.warnings }
}

/** AI chats wrap code in Markdown fences; keep only the largest fenced block. */
export function stripFences(code: string): string {
  const blocks = [...code.matchAll(/```[a-zA-Z]*[^\n]*\n([\s\S]*?)```/g)].map(m => m[1])
  if (!blocks.length) return code
  return blocks.reduce((a, b) => (b.length > a.length ? b : a))
}
