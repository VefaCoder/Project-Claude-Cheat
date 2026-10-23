import { BufferTarget, StreamTarget, type StreamTargetChunk, type Target } from 'mediabunny'
import { createEditor } from './editor.ts'
import { compile } from './compiler.ts'
import { Stage } from './stage.ts'
import { EXAMPLES, FUER_ELISE } from './examples.ts'
import { buildPrompt, buildFixPrompt, LANGUAGE_GUIDE } from './prompt.ts'
import { icons, logo } from './icons.ts'
import { bridge, isMac, saveText, openText, download } from './platform.ts'
import { AudioEngine } from '../audio/engine.ts'
import { loadPiano, type PianoPack } from '../audio/samples.ts'
import { exportVideo, planExport, exportTiming, type ExportSettings, type ExportFormat } from '../export/export.ts'
import { stripFences } from '../lang/pianoscript.ts'
import { emptySong, type Song, type Warning } from '../song/song.ts'

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T

// ------------------------------------------------------------------ settings
interface Settings {
  reverb: number; volume: number; zoom: number; split: number
  res: string; fps: string; format: ExportFormat; title: boolean
}
const SETTINGS_KEY = 'pianola.settings.v1'
const CODE_KEY = 'pianola.code.v1'
const defaults: Settings = { reverb: 0.35, volume: 0.9, zoom: 2.6, split: 40, res: '3840x2160', fps: '60', format: 'mov', title: true }
const settings: Settings = (() => {
  try { return { ...defaults, ...JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? '{}') } } catch { return { ...defaults } }
})()
const saveSettings = () => { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)) } catch { /* private mode */ } }
const storedCode = (() => { try { return localStorage.getItem(CODE_KEY) } catch { return null } })()

// ------------------------------------------------------------------ state
let song: Song = emptySong()
let pack: PianoPack | null = null
let problems: (Warning & { severity: 'error' | 'warning' })[] = []
let fileName = 'Unbenannt'
let compileSeq = 0
let compileTimer = 0
const engine = new AudioEngine()

// ------------------------------------------------------------------ static UI
if (bridge && isMac) document.body.classList.add('mac-electron')
$('logo').innerHTML = logo
$('btnPrompt').innerHTML = `${icons.sparkles}<span>Mit KI erstellen</span>`
$('btnExport').innerHTML = `${icons.film}<span>Video exportieren</span>`
$('btnExamples').innerHTML = `${icons.book}<span>Beispiele</span>`
$('btnOpen').innerHTML = icons.open
$('btnSave').innerHTML = icons.save
$('btnRun').innerHTML = `${icons.run}<span>Ausführen</span><kbd>${isMac ? '⌘↵' : 'Strg+↵'}</kbd>`
$('btnRestart').innerHTML = icons.restart
$('icoSpeed').innerHTML = icons.speed
$('icoHall').innerHTML = icons.hall
$('icoVol').innerHTML = icons.volume
$('icoPrompt').innerHTML = icons.sparkles
$('icoExport').innerHTML = icons.film
$('btnCopyPrompt').innerHTML = `${icons.copy}<span>Prompt kopieren</span>`
$('btnPasteAnswer').innerHTML = `${icons.paste}<span>Antwort einfügen</span>`
$('btnFixPrompt').innerHTML = `${icons.copy}<span>Korrektur für KI kopieren</span>`
$('langRef').textContent = LANGUAGE_GUIDE
for (const b of document.querySelectorAll<HTMLElement>('[data-close]')) b.innerHTML = icons.close

function toast(text: string) {
  const t = $('toast')
  t.innerHTML = `${icons.check}<span></span>`
  t.querySelector('span')!.textContent = text
  t.hidden = false
  clearTimeout((toast as unknown as { timer: number }).timer)
  ;(toast as unknown as { timer: number }).timer = window.setTimeout(() => { t.hidden = true }, 2600)
}

const fmtTime = (s: number) => {
  s = Math.max(0, s)
  const m = Math.floor(s / 60)
  return `${m}:${String(Math.floor(s % 60)).padStart(2, '0')}`
}

// ------------------------------------------------------------------ editor & compile
const editor = createEditor($('editor'), storedCode ?? FUER_ELISE, code => {
  try { localStorage.setItem(CODE_KEY, code) } catch { /* ignore */ }
  clearTimeout(compileTimer)
  compileTimer = window.setTimeout(() => void runCode(false), 650)
}, () => void runCode(true))

function setStatus(kind: 'ok' | 'err' | 'warn' | 'busy' | '', text: string) {
  $('status').className = `status ${kind}`
  $('statusText').textContent = text
}

async function runCode(playFromStart: boolean) {
  clearTimeout(compileTimer)
  const seq = ++compileSeq
  setStatus('busy', 'Wird übersetzt …')
  const res = await compile(editor.getCode())
  if (seq !== compileSeq) return
  if (!res.ok) {
    problems = [{ message: res.message, line: res.line, severity: 'error' }]
    setStatus('err', res.line ? `Fehler in Zeile ${res.line}` : 'Fehler im Code')
    renderProblems()
    return
  }
  applySong(res.song)
  if (playFromStart) {
    engine.seek(0)
    play()
  }
}

function applySong(s: Song) {
  song = s
  stage.renderer.setSong(s)
  engine.setSong(s)
  stage.invalidate()
  $('songTitle').textContent = s.title || 'Ohne Titel'
  $('songComposer').textContent = s.composer
  document.title = s.title ? `${s.title} · Pianola` : 'Pianola'
  $('tTotal').textContent = fmtTime(s.duration)
  problems = s.warnings.map(w => ({ ...w, severity: 'warning' as const }))
  const summary = `${s.notes.length} Noten · ${fmtTime(s.duration)} · ${s.voices.length} ${s.voices.length === 1 ? 'Stimme' : 'Stimmen'}`
  if (problems.length) setStatus('warn', `${summary} · ${problems.length} ${problems.length === 1 ? 'Hinweis' : 'Hinweise'}`)
  else setStatus('ok', summary)
  renderProblems()
  updateTransport()
}

function renderProblems() {
  editor.showProblems(problems)
  const box = $('problems')
  box.hidden = problems.length === 0
  const errors = problems.filter(p => p.severity === 'error').length
  $('problemsTitle').textContent = errors ? 'Fehler' : `Hinweise (${problems.length})`
  const list = $('problemsList')
  list.innerHTML = ''
  for (const p of problems) {
    const li = document.createElement('li')
    li.className = p.severity
    li.innerHTML = p.severity === 'error' ? icons.error : icons.warn
    const ln = document.createElement('span')
    ln.className = 'ln'
    ln.textContent = p.line ? `Z. ${p.line}` : ''
    const msg = document.createElement('span')
    msg.textContent = p.message
    li.append(ln, msg)
    if (p.line) li.onclick = () => editor.goToLine(p.line!)
    list.append(li)
  }
}

// ------------------------------------------------------------------ stage & transport
const stage = new Stage($<HTMLCanvasElement>('stage'), {
  time: () => engine.position,
  playing: () => engine.playing,
  keyDown: k => engine.keyDown(k),
  keyUp: k => engine.keyUp(k),
})
stage.fallSeconds = settings.zoom

function play() {
  if (!engine.ready) { toast('Der Flügel lädt noch …'); return }
  engine.play()
  updateTransport()
}
function togglePlay() {
  if (engine.playing) engine.pause()
  else play()
  updateTransport()
}
engine.onEnded = () => updateTransport()

const seek = $<HTMLInputElement>('seek')
let scrubbing = false
function updateTransport() {
  $('btnPlay').innerHTML = engine.playing ? icons.pause : icons.play
  const dur = song.duration || 0
  const pos = Math.min(engine.position, dur)
  $('tNow').textContent = fmtTime(pos)
  if (!scrubbing) {
    seek.value = String(dur > 0 ? Math.round((pos / dur) * 1000) : 0)
    fill(seek)
  }
}
function fill(input: HTMLInputElement) {
  const min = Number(input.min || 0)
  const max = Number(input.max || 100)
  input.style.setProperty('--fill', `${((Number(input.value) - min) / (max - min)) * 100}%`)
}
const tick = () => {
  if (engine.playing) updateTransport()
  requestAnimationFrame(tick)
}
requestAnimationFrame(tick)

$('btnPlay').onclick = togglePlay
$('btnRestart').onclick = () => { engine.seek(0); stage.invalidate(); updateTransport() }
seek.addEventListener('input', () => {
  scrubbing = true
  fill(seek)
  engine.seek((Number(seek.value) / 1000) * song.duration)
  stage.invalidate()
  $('tNow').textContent = fmtTime(engine.position)
})
seek.addEventListener('change', () => { scrubbing = false })

function bindRange(id: string, value: number, apply: (v: number) => void) {
  const el = $<HTMLInputElement>(id)
  el.value = String(value)
  fill(el)
  el.addEventListener('input', () => { fill(el); apply(Number(el.value)); saveSettings() })
}
bindRange('zoom', settings.zoom, v => { settings.zoom = v; stage.fallSeconds = v; stage.invalidate() })
bindRange('reverb', settings.reverb, v => { settings.reverb = v; engine.setReverb(v) })
bindRange('volume', settings.volume, v => { settings.volume = v; engine.setVolume(v) })

// ------------------------------------------------------------------ splitter
{
  const pane = $('editorPane')
  const splitter = $('splitter')
  pane.style.width = `${settings.split}%`
  splitter.addEventListener('pointerdown', e => {
    splitter.setPointerCapture(e.pointerId)
    splitter.classList.add('drag')
    const move = (ev: PointerEvent) => {
      const pct = Math.max(22, Math.min(70, (ev.clientX / window.innerWidth) * 100))
      pane.style.width = `${pct}%`
      settings.split = Math.round(pct * 10) / 10
    }
    const up = () => {
      splitter.classList.remove('drag')
      splitter.removeEventListener('pointermove', move)
      saveSettings()
    }
    splitter.addEventListener('pointermove', move)
    splitter.addEventListener('pointerup', up, { once: true })
  })
}

// ------------------------------------------------------------------ files & examples
const menu = $('examplesMenu')
for (const ex of EXAMPLES) {
  const b = document.createElement('button')
  b.textContent = ex.name
  b.onclick = () => { menu.hidden = true; editor.setCode(ex.code); void runCode(false) }
  menu.append(b)
}
$('btnExamples').onclick = e => { e.stopPropagation(); menu.hidden = !menu.hidden }
document.addEventListener('click', () => { menu.hidden = true })

async function openFile() {
  const f = await openText()
  if (!f) return
  fileName = f.name.replace(/\.(pianola|js|txt)$/i, '')
  editor.setCode(stripFences(f.content))
  void runCode(false)
}
async function saveFile() {
  const name = `${(song.title || fileName).replace(/[\\/:*?"<>|]/g, '')}.pianola`
  const saved = await saveText(name, editor.getCode())
  if (saved) toast('Gesichert')
}
$('btnOpen').onclick = () => void openFile()
$('btnSave').onclick = () => void saveFile()
$('btnRun').onclick = () => void runCode(true)

// ------------------------------------------------------------------ clipboard & AI prompt
async function clipboardWrite(text: string) {
  if (bridge) await bridge.clipboardWrite(text)
  else await navigator.clipboard.writeText(text)
}
async function clipboardRead(): Promise<string> {
  if (bridge) return bridge.clipboardRead()
  return navigator.clipboard.readText()
}

const dlgPrompt = $<HTMLDialogElement>('dlgPrompt')
const pieceInput = $<HTMLInputElement>('pieceInput')
function openPrompt() {
  dlgPrompt.showModal()
  pieceInput.focus()
}
$('btnPrompt').onclick = openPrompt
$('btnCopyPrompt').onclick = async () => {
  if (!pieceInput.value.trim()) { pieceInput.focus(); toast('Erst eintragen, welches Stück es sein soll'); return }
  await clipboardWrite(buildPrompt(pieceInput.value))
  toast('Prompt kopiert, jetzt in deine KI einfügen')
}
pieceInput.addEventListener('keydown', e => { if (e.key === 'Enter') $('btnCopyPrompt').click() })
$('btnPasteAnswer').onclick = async () => {
  const text = (await clipboardRead()).trim()
  if (!text) { toast('Die Zwischenablage ist leer'); return }
  editor.setCode(stripFences(text))
  dlgPrompt.close()
  await runCode(true)
}
$('btnFixPrompt').onclick = async () => {
  await clipboardWrite(buildFixPrompt(problems))
  toast('Korrektur-Auftrag kopiert, in den KI-Chat einfügen')
}

// ------------------------------------------------------------------ export
const dlgExport = $<HTMLDialogElement>('dlgExport')
let exporting: AbortController | null = null

function segValue(name: string): string {
  return dlgExport.querySelector<HTMLButtonElement>(`.seg[data-name="${name}"] button.on`)!.value
}
function setSeg(name: string, value: string) {
  for (const b of dlgExport.querySelectorAll<HTMLButtonElement>(`.seg[data-name="${name}"] button`)) b.classList.toggle('on', b.value === value)
}
for (const seg of dlgExport.querySelectorAll<HTMLElement>('.seg')) {
  seg.addEventListener('click', e => {
    const b = (e.target as HTMLElement).closest('button')
    if (!b || b.disabled || exporting) return
    setSeg(seg.dataset.name!, b.value)
    void updateExportSummary()
  })
}
$<HTMLInputElement>('optTitle').addEventListener('change', () => { void updateExportSummary() })

function exportSettings(): ExportSettings {
  const [width, height] = segValue('res').split('x').map(Number)
  return {
    width, height, fps: Number(segValue('fps')), format: segValue('format') as ExportFormat,
    showTitle: $<HTMLInputElement>('optTitle').checked, fallSeconds: settings.zoom, reverb: settings.reverb,
  }
}

async function updateExportSummary() {
  const s = exportSettings()
  settings.res = segValue('res'); settings.fps = segValue('fps'); settings.format = s.format; settings.title = s.showTitle
  saveSettings()
  const plan = await planExport(s)
  const start = $<HTMLButtonElement>('btnExportStart')
  if (!plan) {
    $('exportSummary').textContent = s.format === 'mp4'
      ? 'MP4 mit AAC-Ton wird auf diesem Rechner nicht unterstützt. Bitte MOV wählen.'
      : 'Dieser Rechner kann dieses Videoformat nicht kodieren.'
    start.disabled = true
    return
  }
  start.disabled = !engine.ready || !song.notes.length
  const length = exportTiming(song, s).total
  const codec = plan.videoCodec === 'hevc' ? 'HEVC (H.265)' : 'H.264'
  const audio = plan.audioCodec === 'pcm-s24' ? 'PCM 24 Bit / 48 kHz, unkomprimiert' : 'AAC 320 kbit/s'
  const mbit = Math.round(plan.videoBitrate / 1e6)
  $('exportSummary').innerHTML = ''
  const line = (t: string) => { const d = document.createElement('div'); d.textContent = t; $('exportSummary').append(d) }
  line(`${s.width} × ${s.height} · ${s.fps} fps · ${codec} ${mbit} Mbit/s`)
  line(`Ton: ${audio}, Konzertflügel mit Hall`)
  line(`Videolänge ${fmtTime(length)} · Datei ca. ${Math.max(1, Math.round((length * (plan.videoBitrate + 2.4e6)) / 8 / 1e6))} MB`)
}

function openExport() {
  if (!song.notes.length) { toast('Erst ein Stück ausführen'); return }
  engine.pause()
  updateTransport()
  setSeg('res', settings.res); setSeg('fps', settings.fps); setSeg('format', settings.format)
  $<HTMLInputElement>('optTitle').checked = settings.title
  $('exportProgress').hidden = true
  dlgExport.showModal()
  void updateExportSummary()
}
$('btnExport').onclick = openExport
dlgExport.addEventListener('cancel', e => { if (exporting) e.preventDefault() })
$('btnExportCancel').onclick = () => {
  if (exporting) exporting.abort()
  else dlgExport.close()
}

$('btnExportStart').onclick = async () => {
  if (!pack || exporting) return
  const s = exportSettings()
  const plan = await planExport(s)
  if (!plan) return
  const base = (song.title || fileName).replace(/[\\/:*?"<>|]/g, '') || 'Pianola'
  const name = `${base} ${s.height > s.width ? '4K Hochformat' : s.width >= 3840 ? '4K' : 'HD'}.${s.format}`

  let target: Target
  let handle: { id: number; path: string } | null = null
  let memory: BufferTarget | null = null
  if (bridge) {
    handle = await bridge.exportBegin(name, s.format)
    if (!handle) return
    const id = handle.id
    target = new StreamTarget(new WritableStream<StreamTargetChunk>({
      write: chunk => bridge!.exportWrite(id, chunk.position, chunk.data),
    }), { chunked: true })
  } else {
    memory = new BufferTarget()
    target = memory
  }

  exporting = new AbortController()
  const startBtn = $<HTMLButtonElement>('btnExportStart')
  startBtn.disabled = true
  $('exportProgress').hidden = false
  const bar = $('exportBar')
  const phase = $('exportPhase')
  const eta = $('exportEta')
  bar.style.width = '0%'
  eta.textContent = ''
  try {
    await exportVideo(song, pack, s, plan, target, p => {
      if (p.phase === 'audio') { phase.textContent = 'Ton wird gerendert …'; bar.style.width = '2%' }
      else if (p.phase === 'video') {
        phase.textContent = `Bild ${p.frame} von ${p.frames}`
        bar.style.width = `${2 + p.fraction * 97}%`
        eta.textContent = p.etaSeconds !== undefined ? `noch ca. ${fmtTime(p.etaSeconds)}` : ''
      } else { phase.textContent = 'Datei wird abgeschlossen …'; bar.style.width = '100%' }
    }, exporting.signal)
    if (handle) {
      await bridge!.exportFinish(handle.id)
      void bridge!.reveal(handle.path)
    } else if (memory?.buffer) {
      download(new Blob([memory.buffer], { type: s.format === 'mov' ? 'video/quicktime' : 'video/mp4' }), name)
    }
    dlgExport.close()
    toast('Video fertig exportiert')
  } catch (e) {
    if (handle) await bridge!.exportAbort(handle.id)
    const aborted = (e as Error).name === 'AbortError'
    phase.textContent = aborted ? 'Abgebrochen' : `Fehler: ${(e as Error).message}`
    eta.textContent = ''
    if (!aborted) console.error(e)
  } finally {
    exporting = null
    startBtn.disabled = false
  }
}

// ------------------------------------------------------------------ dialogs, shortcuts, menu
for (const d of [dlgPrompt, dlgExport]) {
  d.querySelector('[data-close]')!.addEventListener('click', () => { if (!(d === dlgExport && exporting)) d.close() })
  d.addEventListener('click', e => { if (e.target === d && !(d === dlgExport && exporting)) d.close() })
}

function command(cmd: string) {
  if (cmd === 'open') void openFile()
  else if (cmd === 'save') void saveFile()
  else if (cmd === 'export') openExport()
  else if (cmd === 'prompt') openPrompt()
  else if (cmd === 'run') void runCode(true)
  else if (cmd === 'play') togglePlay()
}
bridge?.onMenu(command)

document.addEventListener('keydown', e => {
  const mod = isMac ? e.metaKey : e.ctrlKey
  const inText = (e.target as HTMLElement).closest('.cm-editor, input, textarea, dialog')
  if (mod && e.key === 'Enter') { e.preventDefault(); void runCode(true) }
  else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); void saveFile() }
  else if (mod && e.key.toLowerCase() === 'o') { e.preventDefault(); void openFile() }
  else if (mod && e.key.toLowerCase() === 'e') { e.preventDefault(); openExport() }
  else if (!inText && e.key === ' ') { e.preventDefault(); togglePlay() }
  else if (!inText && e.key === 'ArrowLeft') { engine.seek(engine.position - 5); stage.invalidate(); updateTransport() }
  else if (!inText && e.key === 'ArrowRight') { engine.seek(engine.position + 5); stage.invalidate(); updateTransport() }
})

// ------------------------------------------------------------------ boot
void runCode(false)
;(async () => {
  const bar = $('loadingBar')
  try {
    pack = await loadPiano('piano/', f => { bar.style.width = `${Math.round(f * 100)}%` }, bridge ? {
      info: key => bridge!.cacheInfo(key),
      write: (key, offset, data, last) => bridge!.cacheWrite(key, offset, data, last),
    } : undefined)
    await engine.init(pack, settings.reverb, settings.volume)
    $('loading').classList.add('done')
    void updateExportSummary()
  } catch (e) {
    console.error(e)
    $('loadingSub').textContent = `Klavier konnte nicht geladen werden: ${(e as Error).message}`
  }
})()

// test hook for automated checks
;(window as unknown as { pianola_debug: unknown }).pianola_debug = {
  engine, stage, get song() { return song }, get pack() { return pack }, runCode, exportVideo, planExport, BufferTarget, StreamTarget,
}
