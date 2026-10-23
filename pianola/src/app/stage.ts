import { PianoRenderer, computeLayout, keyAt } from '../render/renderer.ts'

export interface StageHost {
  time(): number
  playing(): boolean
  keyDown(key: number): void
  keyUp(key: number): void
}

/** The live falling-notes view: sizes the canvas, runs the frame loop and turns clicks into key presses. */
export class Stage {
  readonly renderer = new PianoRenderer()
  fallSeconds = 2.6
  private ctx: CanvasRenderingContext2D
  private dirty = true
  private held = -1
  private lastInteraction = 0
  private canvas: HTMLCanvasElement
  private host: StageHost

  constructor(canvas: HTMLCanvasElement, host: StageHost) {
    this.canvas = canvas
    this.host = host
    this.ctx = canvas.getContext('2d', { alpha: false })!
    new ResizeObserver(() => this.resize()).observe(canvas)
    this.resize()
    canvas.addEventListener('pointerdown', e => this.pointer(e, 'down'))
    canvas.addEventListener('pointermove', e => this.pointer(e, 'move'))
    canvas.addEventListener('pointerup', e => this.pointer(e, 'up'))
    canvas.addEventListener('pointercancel', e => this.pointer(e, 'up'))
    canvas.addEventListener('lostpointercapture', () => this.release())
    const loop = () => {
      // keep animating a little after interaction so sparks can fade out
      if (this.dirty || this.host.playing() || performance.now() - this.lastInteraction < 1200) this.draw()
      requestAnimationFrame(loop)
    }
    requestAnimationFrame(loop)
  }

  invalidate() { this.dirty = true }

  private resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2)
    const w = Math.max(1, Math.round(this.canvas.clientWidth * dpr))
    const h = Math.max(1, Math.round(this.canvas.clientHeight * dpr))
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w
      this.canvas.height = h
    }
    this.draw()
  }

  private draw() {
    this.dirty = false
    const { width, height } = this.canvas
    this.renderer.draw(this.ctx, width, height, this.host.time(), { fallSeconds: this.fallSeconds })
  }

  private keyFromEvent(e: PointerEvent): number {
    const r = this.canvas.getBoundingClientRect()
    const sx = this.canvas.width / r.width
    const sy = this.canvas.height / r.height
    return keyAt(computeLayout(this.canvas.width, this.canvas.height), (e.clientX - r.left) * sx, (e.clientY - r.top) * sy)
  }

  private pointer(e: PointerEvent, kind: 'down' | 'move' | 'up') {
    const key = this.keyFromEvent(e)
    this.canvas.style.cursor = key >= 0 ? 'pointer' : 'default'
    if (kind === 'down') {
      if (key < 0) return
      this.canvas.setPointerCapture(e.pointerId)
      this.press(key)
    } else if (kind === 'move') {
      if (this.held >= 0 && key >= 0 && key !== this.held) { this.release(); this.press(key) }
    } else this.release()
  }

  private press(key: number) {
    this.held = key
    this.host.keyDown(key)
    this.renderer.setLivePressed([key])
    this.lastInteraction = performance.now()
    this.dirty = true
  }

  private release() {
    if (this.held < 0) return
    this.host.keyUp(this.held)
    this.held = -1
    this.renderer.setLivePressed([])
    this.lastInteraction = performance.now()
    this.dirty = true
  }
}
