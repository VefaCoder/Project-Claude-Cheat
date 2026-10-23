// Falling-notes renderer. Pure canvas drawing, identical for the live view and the 4K export.
import { isBlackKey, type Song, type SongNote } from '../song/song.ts'

type Ctx = CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D

export interface RenderOptions {
  fallSeconds: number // time a note needs from the top edge to the keys (at 16:9)
  range?: [number, number] // visible keys, default all 88
  title?: { text: string; sub: string; alpha: number } | null
}

interface Palette { base: string; light: string; dark: string; glow: string; rgb: [number, number, number] }
interface Layout {
  W: number; H: number; s: number
  lo: number; hi: number
  ww: number; bw: number
  keysTop: number; hitY: number; kbH: number; blackH: number
  x: Float64Array; w: Float64Array
}

// Height of the note area measured in white-key widths for a 16:9 frame; keeps bar proportions identical
// across sizes and aspect ratios (portrait simply shows more of the future).
const FALL_KEYS = 23.3

const FIRST = 21
const LAST = 108
const BLACK_OFFSET: Record<number, number> = { 1: -0.1, 3: 0.1, 6: -0.12, 8: 0, 10: 0.12 }
const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Display", "Helvetica Neue", "Inter", sans-serif'

function hexRgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
const mix = (c: [number, number, number], t: [number, number, number], k: number) =>
  `rgb(${c.map((v, i) => Math.round(v + (t[i] - v) * k)).join(',')})`

function palette(hex: string): Palette {
  const rgb = hexRgb(hex)
  return {
    base: `rgb(${rgb.join(',')})`,
    light: mix(rgb, [255, 255, 255], 0.45),
    dark: mix(rgb, [0, 0, 0], 0.38),
    glow: `rgba(${rgb.join(',')},`,
    rgb,
  }
}

// deterministic hash -> [0,1)
function h01(a: number, b: number): number {
  let x = Math.imul(a ^ 0x9e3779b9, 0x85ebca6b) ^ Math.imul(b + 0x7f4a7c15, 0xc2b2ae35)
  x ^= x >>> 15
  x = Math.imul(x, 0x2c1b3c6d)
  x ^= x >>> 12
  return (x >>> 0) / 4294967296
}

export function computeLayout(W: number, H: number, range: [number, number] = [FIRST, LAST]): Layout {
  const [lo, hi] = range
  const s = Math.min(W, H) / 1080
  let whites = 0
  for (let k = lo; k <= hi; k++) if (!isBlackKey(k)) whites++
  const ww = W / whites
  const kbH = Math.min(H * 0.25, ww * 5.7)
  const felt = Math.max(2, kbH * 0.045)
  const keysTop = H - kbH
  const x = new Float64Array(128).fill(-1e6)
  const w = new Float64Array(128)
  const bw = ww * 0.58
  let wi = 0
  for (let k = lo; k <= hi; k++) {
    if (isBlackKey(k)) {
      const c = wi * ww + BLACK_OFFSET[k % 12] * ww
      x[k] = c - bw / 2
      w[k] = bw
    } else {
      x[k] = wi * ww
      w[k] = ww
      wi++
    }
  }
  return { W, H, s, lo, hi, ww, bw, keysTop, hitY: keysTop - felt, kbH, blackH: kbH * 0.63, x, w }
}

export function pixelsPerSecond(L: Layout, fallSeconds: number): number {
  return (L.ww * FALL_KEYS) / fallSeconds
}

/** Seconds of music visible above the keys. */
export function visibleSeconds(W: number, H: number, fallSeconds: number, range?: [number, number]): number {
  const L = computeLayout(W, H, range)
  return L.hitY / pixelsPerSecond(L, fallSeconds)
}

/** Key range for narrow (portrait) frames: the notes actually used, widened to whole octaves, at least 3 octaves. */
export function autoRange(song: Song): [number, number] {
  if (!song.notes.length) return [48, 84]
  let lo = 127
  let hi = 0
  for (const n of song.notes) { lo = Math.min(lo, n.key); hi = Math.max(hi, n.key) }
  lo = Math.max(FIRST, lo - (lo % 12)) // down to C
  hi = Math.min(LAST, hi + ((12 - (hi % 12)) % 12)) // up to C
  while (hi - lo < 36) {
    if (lo - 12 >= FIRST) lo -= 12
    if (hi - lo < 36 && hi + 12 <= LAST) hi += 12
    if (lo - 12 < FIRST && hi + 12 > LAST) break
  }
  if (hi - lo > 64) return [FIRST, LAST]
  if (isBlackKey(lo)) lo--
  if (isBlackKey(hi)) hi++
  return [lo, hi]
}

/** Key under a canvas point, or -1. Black keys win where they overlap. */
export function keyAt(L: Layout, px: number, py: number): number {
  if (py < L.keysTop || py > L.H) return -1
  if (py < L.keysTop + L.blackH) {
    for (let k = L.lo; k <= L.hi; k++) if (isBlackKey(k) && px >= L.x[k] && px < L.x[k] + L.w[k]) return k
  }
  for (let k = L.lo; k <= L.hi; k++) if (!isBlackKey(k) && px >= L.x[k] && px < L.x[k] + L.w[k]) return k
  return -1
}

function roundRect(ctx: Ctx, x: number, y: number, w: number, h: number, r: number) {
  r = Math.max(0, Math.min(r, w / 2, h / 2))
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.arcTo(x + w, y, x + w, y + h, r)
  ctx.arcTo(x + w, y + h, x, y + h, r)
  ctx.arcTo(x, y + h, x, y, r)
  ctx.arcTo(x, y, x + w, y, r)
  ctx.closePath()
}

// Static noise tile, about one 8-bit step: breaks up banding of the dark gradient after video compression.
let noiseTile: OffscreenCanvas | null = null
function noise(): OffscreenCanvas {
  if (noiseTile) return noiseTile
  const c = new OffscreenCanvas(128, 128)
  const g = c.getContext('2d')!
  const img = g.createImageData(128, 128)
  for (let i = 0; i < img.data.length; i += 4) {
    img.data[i] = img.data[i + 1] = img.data[i + 2] = 255
    img.data[i + 3] = Math.floor(h01(i, 7) * 3)
  }
  g.putImageData(img, 0, 0)
  noiseTile = c
  return c
}

export class PianoRenderer {
  private song: Song | null = null
  private notes: SongNote[] = []
  private maxDur = 0
  private pals: Palette[] = []
  private live = new Map<number, Palette>()

  setSong(song: Song) {
    this.song = song
    this.notes = song.notes
    this.maxDur = song.notes.reduce((m, n) => Math.max(m, n.dur), 0)
    this.pals = song.voices.map(v => palette(v.color))
  }

  /** Keys pressed by the mouse, shown with a neutral highlight. */
  setLivePressed(keys: Iterable<number>) {
    this.live.clear()
    const p = palette('#cfd8ff')
    for (const k of keys) this.live.set(k, p)
  }

  draw(ctx: Ctx, W: number, H: number, t: number, opts: RenderOptions) {
    const L = computeLayout(W, H, opts.range)
    const pressed = new Map<number, Palette>(this.live)
    const active: { n: SongNote; i: number }[] = []

    this.background(ctx, L)
    const pps = pixelsPerSecond(L, opts.fallSeconds)
    if (this.song) this.barLines(ctx, L, t, pps)

    // visible notes: start within the window, or still sounding
    const notes = this.notes
    const lo = t - this.maxDur - 0.05
    let i0 = 0
    let hi = notes.length
    while (i0 < hi) { const m = (i0 + hi) >> 1; if (notes[m].start < lo) i0 = m + 1; else hi = m }
    const tEnd = t + L.hitY / pps + 0.1
    const visible: number[] = []
    for (let i = i0; i < notes.length && notes[i].start <= tEnd; i++) {
      const n = notes[i]
      if (n.start + n.dur < t || n.key < L.lo || n.key > L.hi) continue
      visible.push(i)
      if (n.start <= t) {
        active.push({ n, i })
        pressed.set(n.key, this.pals[n.voice] ?? palette('#3fb6ff'))
      }
    }

    ctx.save()
    ctx.beginPath()
    ctx.rect(0, 0, W, L.hitY)
    ctx.clip()
    for (const pass of [false, true]) {
      for (const i of visible) {
        const n = notes[i]
        if (isBlackKey(n.key) !== pass) continue
        this.noteBar(ctx, L, n, t, pps)
      }
    }
    ctx.restore()

    this.effects(ctx, L, t, active)
    this.keyboard(ctx, L, pressed)
    if (opts.title && opts.title.alpha > 0.001) this.titleCard(ctx, L, opts.title)
  }

  private background(ctx: Ctx, L: Layout) {
    const g = ctx.createLinearGradient(0, 0, 0, L.hitY)
    g.addColorStop(0, '#05060b')
    g.addColorStop(1, '#0d1120')
    ctx.fillStyle = g
    ctx.fillRect(0, 0, L.W, L.hitY)
    const pattern = ctx.createPattern(noise(), 'repeat')
    if (pattern) {
      ctx.fillStyle = pattern
      ctx.fillRect(0, 0, L.W, L.hitY)
    }
    // octave and E/F guide lines
    ctx.fillStyle = 'rgba(255,255,255,0.055)'
    for (let k = L.lo; k <= L.hi; k++) if (k % 12 === 0) ctx.fillRect(Math.round(L.x[k]), 0, Math.max(1, L.s), L.hitY)
    ctx.fillStyle = 'rgba(255,255,255,0.025)'
    for (let k = L.lo; k <= L.hi; k++) if (k % 12 === 5) ctx.fillRect(Math.round(L.x[k]), 0, Math.max(1, L.s), L.hitY)
  }

  private barLines(ctx: Ctx, L: Layout, t: number, pps: number) {
    const bars = this.song!.bars
    ctx.fillStyle = 'rgba(255,255,255,0.05)'
    for (const b of bars) {
      const y = L.hitY - (b - t) * pps
      if (y < 0 || y > L.hitY) continue
      ctx.fillRect(0, Math.round(y), L.W, Math.max(1, L.s))
    }
  }

  private noteBar(ctx: Ctx, L: Layout, n: SongNote, t: number, pps: number) {
    const pal = this.pals[n.voice] ?? palette('#3fb6ff')
    const black = isBlackKey(n.key)
    const gap = black ? L.bw * 0.06 : L.ww * 0.1
    const x = L.x[n.key] + gap
    const w = L.w[n.key] - gap * 2
    const yBottom = L.hitY - (n.start - t) * pps
    const yTop = L.hitY - (n.start + n.dur - t) * pps + 1.5 * L.s
    const h = Math.max(yBottom - yTop, 3 * L.s)
    const r = Math.min(w * 0.32, 7 * L.s)
    const playing = n.start <= t
    const g = ctx.createLinearGradient(x, 0, x + w, 0)
    if (black) {
      g.addColorStop(0, pal.base)
      g.addColorStop(1, pal.dark)
    } else {
      g.addColorStop(0, pal.light)
      g.addColorStop(0.45, pal.base)
      g.addColorStop(1, pal.dark)
    }
    if (playing) {
      ctx.save()
      ctx.shadowColor = pal.glow + '0.9)'
      ctx.shadowBlur = 22 * L.s
    }
    roundRect(ctx, x, yBottom - h, w, h, r)
    ctx.fillStyle = g
    ctx.fill()
    if (playing) ctx.restore()
    ctx.lineWidth = Math.max(1, 1.2 * L.s)
    ctx.strokeStyle = playing ? 'rgba(255,255,255,0.75)' : 'rgba(255,255,255,0.22)'
    ctx.stroke()
  }

  private effects(ctx: Ctx, L: Layout, t: number, active: { n: SongNote; i: number }[]) {
    ctx.save()
    ctx.globalCompositeOperation = 'lighter'
    const s = L.s
    for (const { n } of active) {
      const pal = this.pals[n.voice]
      if (!pal || n.key < L.lo || n.key > L.hi) continue
      const cx = L.x[n.key] + L.w[n.key] / 2
      const fresh = Math.max(0, 1 - (t - n.start) / 0.35)
      // light column rising from the key
      const colH = (90 + 90 * fresh) * s
      const cg = ctx.createLinearGradient(0, L.hitY - colH, 0, L.hitY)
      cg.addColorStop(0, pal.glow + '0)')
      cg.addColorStop(1, pal.glow + (0.22 + 0.3 * fresh).toFixed(3) + ')')
      ctx.fillStyle = cg
      ctx.fillRect(L.x[n.key] - L.ww * 0.15, L.hitY - colH, L.w[n.key] + L.ww * 0.3, colH)
      // impact glow
      const R = L.ww * (1.6 + 1.6 * fresh)
      const rg = ctx.createRadialGradient(cx, L.hitY, 0, cx, L.hitY, R)
      rg.addColorStop(0, pal.glow + (0.55 + 0.4 * fresh).toFixed(3) + ')')
      rg.addColorStop(1, pal.glow + '0)')
      ctx.fillStyle = rg
      ctx.fillRect(cx - R, L.hitY - R, R * 2, R * 2)
    }
    // sparks: deterministic particles, emitted while a note sounds
    const rate = 36
    for (const { n, i } of active) this.sparks(ctx, L, t, n, i, rate)
    for (const n of this.recentlyEnded(t)) this.sparks(ctx, L, t, n.n, n.i, rate)
    ctx.restore()
  }

  private recentlyEnded(t: number): { n: SongNote; i: number }[] {
    const out: { n: SongNote; i: number }[] = []
    const notes = this.notes
    let lo = 0
    let hi = notes.length
    const from = t - this.maxDur - 1
    while (lo < hi) { const m = (lo + hi) >> 1; if (notes[m].start < from) lo = m + 1; else hi = m }
    for (let i = lo; i < notes.length && notes[i].start <= t; i++) {
      const end = notes[i].start + notes[i].dur
      if (end <= t && end > t - 0.9) out.push({ n: notes[i], i })
    }
    return out
  }

  private sparks(ctx: Ctx, L: Layout, t: number, n: SongNote, idx: number, rate: number) {
    const pal = this.pals[n.voice]
    if (!pal || n.key < L.lo || n.key > L.hi) return
    const s = L.s
    const cx = L.x[n.key] + L.w[n.key] / 2
    const end = Math.min(n.start + n.dur, t)
    const first = Math.ceil(Math.max(n.start, t - 0.9) * rate)
    const last = Math.floor(end * rate)
    const strength = 0.55 + (n.vel / 127) * 0.6
    ctx.fillStyle = pal.light
    for (let e = first; e <= last; e++) {
      const age = t - e / rate
      const life = 0.45 + 0.45 * h01(idx, e)
      if (age < 0 || age > life) continue
      const ang = (h01(e, idx * 7 + 1) - 0.5) * 1.3
      const sp = (110 + 170 * h01(idx * 3 + 2, e)) * s * strength
      const px = cx + (h01(idx + 5, e * 3) - 0.5) * L.w[n.key] * 0.8 + Math.sin(ang) * sp * age
      const py = L.hitY - Math.cos(ang) * sp * age + 160 * s * age * age
      const k = 1 - age / life
      ctx.globalAlpha = Math.min(1, k * k * 0.95)
      ctx.beginPath()
      ctx.arc(px, py, (0.9 + 1.9 * h01(e * 5, idx + 9)) * s * (0.5 + 0.5 * k), 0, Math.PI * 2)
      ctx.fill()
    }
    ctx.globalAlpha = 1
  }

  private keyboard(ctx: Ctx, L: Layout, pressed: Map<number, Palette>) {
    const s = L.s
    const top = L.keysTop
    ctx.fillStyle = '#121214'
    ctx.fillRect(0, top, L.W, L.H - top)
    // felt strip above the keys
    const fg = ctx.createLinearGradient(0, L.hitY, 0, top)
    fg.addColorStop(0, '#6d1219')
    fg.addColorStop(1, '#2c0609')
    ctx.fillStyle = fg
    ctx.fillRect(0, L.hitY, L.W, top - L.hitY)
    ctx.fillStyle = 'rgba(255,255,255,0.35)'
    ctx.fillRect(0, L.hitY, L.W, Math.max(1, 0.8 * s))

    const whiteG = ctx.createLinearGradient(0, top, 0, L.H)
    whiteG.addColorStop(0, '#d9d9d4')
    whiteG.addColorStop(0.08, '#f3f3ef')
    whiteG.addColorStop(0.9, '#fbfbf8')
    whiteG.addColorStop(1, '#d6d6d0')
    const r = Math.min(L.ww * 0.12, 5 * s)
    for (let k = L.lo; k <= L.hi; k++) {
      if (isBlackKey(k)) continue
      const x = L.x[k] + 0.5 * s
      const w = L.w[k] - 1.2 * s
      const p = pressed.get(k)
      if (p) {
        const pg = ctx.createLinearGradient(0, top, 0, L.H)
        pg.addColorStop(0, p.dark)
        pg.addColorStop(0.25, p.base)
        pg.addColorStop(1, p.light)
        ctx.fillStyle = pg
      } else ctx.fillStyle = whiteG
      roundRect(ctx, x, top, w, L.kbH - (p ? 0 : 1.5 * s), r)
      ctx.fill()
    }
    // shadow cast by the felt onto the keys
    const sh = ctx.createLinearGradient(0, top, 0, top + 10 * s)
    sh.addColorStop(0, 'rgba(0,0,0,0.45)')
    sh.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = sh
    ctx.fillRect(0, top, L.W, 10 * s)

    const blackG = ctx.createLinearGradient(0, top, 0, top + L.blackH)
    blackG.addColorStop(0, '#0b0b0d')
    blackG.addColorStop(0.75, '#2a2a30')
    blackG.addColorStop(1, '#141417')
    for (let k = L.lo; k <= L.hi; k++) {
      if (!isBlackKey(k)) continue
      const x = L.x[k]
      const w = L.w[k]
      const p = pressed.get(k)
      // drop shadow
      ctx.fillStyle = 'rgba(0,0,0,0.35)'
      roundRect(ctx, x + 1.5 * s, top, w, L.blackH + 2.5 * s, 3 * s)
      ctx.fill()
      if (p) {
        const pg = ctx.createLinearGradient(0, top, 0, top + L.blackH)
        pg.addColorStop(0, p.dark)
        pg.addColorStop(1, p.base)
        ctx.fillStyle = pg
      } else ctx.fillStyle = blackG
      roundRect(ctx, x, top - 2 * s, w, L.blackH + 2 * s, 2.5 * s)
      ctx.fill()
      // front bevel highlight
      if (!p) {
        const bh = L.blackH * 0.12
        const hg = ctx.createLinearGradient(0, top + L.blackH - bh, 0, top + L.blackH)
        hg.addColorStop(0, 'rgba(255,255,255,0.10)')
        hg.addColorStop(1, 'rgba(255,255,255,0.02)')
        ctx.fillStyle = hg
        roundRect(ctx, x + w * 0.12, top + L.blackH - bh, w * 0.76, bh - 1 * s, 2 * s)
        ctx.fill()
      }
    }
  }

  private titleCard(ctx: Ctx, L: Layout, title: { text: string; sub: string; alpha: number }) {
    const s = L.s
    ctx.save()
    ctx.globalAlpha = title.alpha
    ctx.textBaseline = 'alphabetic'
    ctx.fillStyle = '#ffffff'
    ctx.shadowColor = 'rgba(0,0,0,0.6)'
    ctx.shadowBlur = 18 * s
    ctx.font = `600 ${Math.round(58 * s)}px ${FONT}`
    ctx.fillText(title.text, 72 * s, 128 * s)
    if (title.sub) {
      ctx.globalAlpha = title.alpha * 0.72
      ctx.font = `400 ${Math.round(30 * s)}px ${FONT}`
      ctx.fillText(title.sub, 74 * s, 176 * s)
    }
    ctx.restore()
  }
}
