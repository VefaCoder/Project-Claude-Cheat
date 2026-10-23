// Song model shared by audio engine, renderer and exporter. All times in seconds.

export interface TempoPoint { beat: number; bpm: number; ramp: boolean }
export interface MeterPoint { beat: number; num: number; den: number }

export interface SongNote {
  start: number
  dur: number
  key: number // MIDI 21..108
  vel: number // 1..127
  voice: number
}

export interface PedalEvent { time: number; down: boolean }

export interface VoiceInfo {
  name: string
  color: string
  hand: 'left' | 'right'
}

export interface Warning { message: string; line?: number }

export interface Song {
  title: string
  composer: string
  voices: VoiceInfo[]
  notes: SongNote[] // sorted by start, then key
  pedal: PedalEvent[] // sorted by time
  bars: number[] // bar line times
  duration: number // end of the last note
  warnings: Warning[]
}

export const LOWEST_KEY = 21 // A0
export const HIGHEST_KEY = 108 // C8

export function emptySong(): Song {
  return { title: '', composer: '', voices: [], notes: [], pedal: [], bars: [], duration: 0, warnings: [] }
}

/** Converts beat positions (quarter notes) to seconds. Supports instant and linear (ramped) tempo changes. */
export class TempoMap {
  private pts: TempoPoint[]
  private secs: number[] = []

  constructor(points: TempoPoint[]) {
    const pts = [...points].sort((a, b) => a.beat - b.beat)
    if (!pts.length || pts[0].beat > 0) pts.unshift({ beat: 0, bpm: pts[0]?.bpm ?? 100, ramp: false })
    this.pts = pts
    let t = 0
    for (let i = 0; i < pts.length; i++) {
      this.secs.push(t)
      if (i + 1 < pts.length) t += this.segment(i, pts[i + 1].beat - pts[i].beat)
    }
  }

  private segment(i: number, delta: number): number {
    const p = this.pts[i]
    const next = this.pts[i + 1]
    if (next && next.ramp && next.beat > p.beat) {
      const k = (next.bpm - p.bpm) / (next.beat - p.beat)
      if (Math.abs(k) > 1e-9) return (60 / k) * Math.log((p.bpm + k * delta) / p.bpm)
    }
    return (60 * delta) / p.bpm
  }

  toSeconds(beat: number): number {
    const pts = this.pts
    let lo = 0
    let hi = pts.length - 1
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1
      if (pts[mid].beat <= beat) lo = mid
      else hi = mid - 1
    }
    return this.secs[lo] + this.segment(lo, beat - pts[lo].beat)
  }

  bpmAt(beat: number): number {
    let i = 0
    while (i + 1 < this.pts.length && this.pts[i + 1].beat <= beat) i++
    const p = this.pts[i]
    const next = this.pts[i + 1]
    if (next && next.ramp) return p.bpm + ((next.bpm - p.bpm) * (beat - p.beat)) / (next.beat - p.beat)
    return p.bpm
  }
}

/** Bar start positions in beats, from the pickup up to (and including) the first bar line at or after `endBeat`. */
export function barBeats(meters: MeterPoint[], pickup: number, endBeat: number): number[] {
  const ms = [...meters].sort((a, b) => a.beat - b.beat)
  if (!ms.length) ms.push({ beat: 0, num: 4, den: 4 })
  const out: number[] = []
  let b = pickup
  let guard = 0
  while (guard++ < 100000) {
    out.push(b)
    if (b >= endBeat - 1e-9) break
    let m = ms[0]
    for (const x of ms) if (x.beat <= b + 1e-9) m = x
    b += (m.num * 4) / m.den
  }
  return out
}

export function midiName(key: number): string {
  const names = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
  return names[key % 12] + (Math.floor(key / 12) - 1)
}

export function isBlackKey(key: number): boolean {
  const k = key % 12
  return k === 1 || k === 3 || k === 6 || k === 8 || k === 10
}
