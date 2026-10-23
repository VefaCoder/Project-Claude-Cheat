// Electron main process: window, app:// protocol (with cross-origin isolation for SharedArrayBuffer),
// native menus and the small file/clipboard API used by the renderer.
const { app, BrowserWindow, protocol, ipcMain, dialog, Menu, shell, clipboard, powerSaveBlocker } = require('electron')
const path = require('node:path')
const fs = require('node:fs')
const { Readable } = require('node:stream')

protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, codeCache: true } },
])

const root = path.join(__dirname, '..')
const distDir = path.join(root, 'dist')
const pianoDir = app.isPackaged ? path.join(process.resourcesPath, 'piano') : path.join(root, 'assets', 'piano')
const cacheDir = path.join(app.getPath('userData'), 'samples')
const smokeArg = process.argv.find(a => a.startsWith('--smoke-test='))
const smokeDir = smokeArg ? smokeArg.slice('--smoke-test='.length) : null

const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.flac': 'audio/flac', '.pcm': 'application/octet-stream', '.png': 'image/png', '.svg': 'image/svg+xml', '.map': 'application/json',
}

function respond(file) {
  const headers = {
    'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
    'Cross-Origin-Opener-Policy': 'same-origin',
    'Cross-Origin-Embedder-Policy': 'require-corp',
    'Cross-Origin-Resource-Policy': 'same-origin',
  }
  let stat
  try { stat = fs.statSync(file) } catch { return new Response('not found', { status: 404 }) }
  if (!stat.isFile()) return new Response('not found', { status: 404 })
  headers['Content-Length'] = String(stat.size)
  if (stat.size < 8 << 20) return new Response(fs.readFileSync(file), { headers })
  return new Response(Readable.toWeb(fs.createReadStream(file, { highWaterMark: 4 << 20 })), { headers })
}

function handleApp(request) {
  let rel = decodeURIComponent(new URL(request.url).pathname)
  let base = distDir
  if (rel.startsWith('/piano/')) { base = pianoDir; rel = rel.slice(7) }
  else if (rel.startsWith('/cache/')) { base = cacheDir; rel = rel.slice(7) }
  if (rel === '/' || rel === '') rel = 'index.html'
  const file = path.normalize(path.join(base, rel))
  if (file !== base && !file.startsWith(base + path.sep)) return new Response('forbidden', { status: 403 })
  return respond(file)
}

let win = null
const send = cmd => win?.webContents.send('menu', cmd)

function createWindow() {
  win = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 980,
    minHeight: 620,
    show: false,
    backgroundColor: '#07080d',
    title: 'Pianola',
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 18, y: 19 },
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      sandbox: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      autoplayPolicy: 'no-user-gesture-required',
      spellcheck: false,
    },
  })
  win.once('ready-to-show', () => win.show())
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https:\/\//.test(url)) void shell.openExternal(url)
    return { action: 'deny' }
  })
  win.webContents.on('will-navigate', e => e.preventDefault())
  win.on('closed', () => { win = null })
  void win.loadURL('app://pianola/index.html')
  if (smokeDir) runSmokeTest(win)
}

function buildMenu() {
  const isMac = process.platform === 'darwin'
  const item = (label, accelerator, cmd) => ({ label, accelerator, click: () => send(cmd) })
  Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{
      label: 'Pianola',
      submenu: [
        { role: 'about', label: 'Über Pianola' },
        { type: 'separator' },
        { role: 'services', label: 'Dienste' },
        { type: 'separator' },
        { role: 'hide', label: 'Pianola ausblenden' },
        { role: 'hideOthers', label: 'Andere ausblenden' },
        { role: 'unhide', label: 'Alle einblenden' },
        { type: 'separator' },
        { role: 'quit', label: 'Pianola beenden' },
      ],
    }] : []),
    {
      label: 'Ablage',
      submenu: [
        item('Öffnen …', 'CmdOrCtrl+O', 'open'),
        item('Sichern …', 'CmdOrCtrl+S', 'save'),
        { type: 'separator' },
        item('Video exportieren …', 'CmdOrCtrl+E', 'export'),
        ...(isMac ? [] : [{ type: 'separator' }, { role: 'quit', label: 'Beenden' }]),
      ],
    },
    {
      label: 'Bearbeiten',
      submenu: [
        { role: 'undo', label: 'Widerrufen' },
        { role: 'redo', label: 'Wiederholen' },
        { type: 'separator' },
        { role: 'cut', label: 'Ausschneiden' },
        { role: 'copy', label: 'Kopieren' },
        { role: 'paste', label: 'Einsetzen' },
        { role: 'selectAll', label: 'Alles auswählen' },
      ],
    },
    {
      label: 'Wiedergabe',
      submenu: [
        item('Code ausführen', 'CmdOrCtrl+Return', 'run'),
        item('Abspielen / Pause', undefined, 'play'),
        { type: 'separator' },
        item('Mit KI erstellen …', 'CmdOrCtrl+K', 'prompt'),
      ],
    },
    {
      label: 'Darstellung',
      submenu: [
        { role: 'togglefullscreen', label: 'Vollbild' },
        { role: 'resetZoom', label: 'Originalgröße' },
        { role: 'zoomIn', label: 'Vergrößern' },
        { role: 'zoomOut', label: 'Verkleinern' },
        ...(app.isPackaged ? [] : [{ type: 'separator' }, { role: 'toggleDevTools' }]),
      ],
    },
    { role: 'windowMenu', label: 'Fenster' },
  ]))
}

// ------------------------------------------------------------------ IPC
const exports_ = new Map()
let nextExport = 1

ipcMain.handle('file:save', async (_e, defaultName, content) => {
  const r = await dialog.showSaveDialog(win, {
    defaultPath: path.join(app.getPath('documents'), defaultName),
    filters: [{ name: 'Pianola-Song', extensions: ['pianola'] }, { name: 'JavaScript', extensions: ['js'] }],
  })
  if (r.canceled || !r.filePath) return null
  await fs.promises.writeFile(r.filePath, content, 'utf8')
  return r.filePath
})

ipcMain.handle('file:open', async () => {
  const r = await dialog.showOpenDialog(win, {
    properties: ['openFile'],
    filters: [{ name: 'Pianola-Song', extensions: ['pianola', 'js', 'txt'] }],
  })
  if (r.canceled || !r.filePaths.length) return null
  const file = r.filePaths[0]
  return { name: path.basename(file), content: await fs.promises.readFile(file, 'utf8') }
})

ipcMain.handle('export:begin', async (_e, defaultName, ext) => {
  let file
  if (smokeDir) file = path.join(smokeDir, `smoke.${ext}`)
  else {
    const r = await dialog.showSaveDialog(win, {
      defaultPath: path.join(app.getPath('videos'), defaultName),
      filters: [{ name: ext === 'mov' ? 'QuickTime-Film' : 'MPEG-4-Video', extensions: [ext] }],
    })
    if (r.canceled || !r.filePath) return null
    file = r.filePath
  }
  const id = nextExport++
  exports_.set(id, { fd: fs.openSync(file, 'w'), file, blocker: powerSaveBlocker.start('prevent-app-suspension') })
  return { id, path: file }
})

ipcMain.handle('export:write', (_e, id, position, data) => {
  const x = exports_.get(id)
  if (!x) throw new Error('Export nicht gefunden')
  const buf = Buffer.from(data.buffer, data.byteOffset, data.byteLength)
  let off = 0
  while (off < buf.length) off += fs.writeSync(x.fd, buf, off, buf.length - off, position + off)
})

function closeExport(id, remove) {
  const x = exports_.get(id)
  if (!x) return
  exports_.delete(id)
  try { fs.closeSync(x.fd) } catch { /* already closed */ }
  powerSaveBlocker.stop(x.blocker)
  if (remove) fs.rmSync(x.file, { force: true })
}
ipcMain.handle('export:finish', (_e, id) => closeExport(id, false))
ipcMain.handle('export:abort', (_e, id) => closeExport(id, true))
ipcMain.handle('reveal', (_e, file) => { if (!smokeDir) shell.showItemInFolder(file) })

const KEY_RE = /^piano-[0-9a-f]{1,8}-\d{1,12}$/
ipcMain.handle('cache:info', (_e, key) => {
  if (!KEY_RE.test(key)) return { exists: false, url: '' }
  const file = path.join(cacheDir, `${key}.pcm`)
  const size = Number(key.split('-')[2])
  let exists = false
  try { exists = fs.statSync(file).size === size } catch { /* missing */ }
  return { exists, url: `app://pianola/cache/${key}.pcm` }
})

ipcMain.handle('cache:write', async (_e, key, offset, data, last) => {
  if (!KEY_RE.test(key)) throw new Error('ungültiger Cache-Schlüssel')
  await fs.promises.mkdir(cacheDir, { recursive: true })
  const part = path.join(cacheDir, `${key}.part`)
  const fh = await fs.promises.open(part, offset === 0 ? 'w' : 'r+')
  try { await fh.write(Buffer.from(data.buffer, data.byteOffset, data.byteLength), 0, data.byteLength, offset) } finally { await fh.close() }
  if (last) {
    await fs.promises.rename(part, path.join(cacheDir, `${key}.pcm`))
    for (const f of await fs.promises.readdir(cacheDir)) {
      if (!f.startsWith(key)) await fs.promises.rm(path.join(cacheDir, f), { force: true })
    }
  }
})

ipcMain.handle('clipboard:read', () => clipboard.readText())
ipcMain.handle('clipboard:write', (_e, text) => clipboard.writeText(String(text)))

// ------------------------------------------------------------------ smoke test (CI only)
function runSmokeTest(w) {
  const out = (name, data) => fs.writeFileSync(path.join(smokeDir, name), data)
  const fail = msg => { out('smoke.json', JSON.stringify({ ok: false, error: String(msg) }, null, 1)); app.exit(1) }
  setTimeout(() => fail('timeout'), 240000)
  w.webContents.on('console-message', (e, _level, message) => console.log('[renderer]', message ?? e.message))
  w.webContents.once('did-finish-load', async () => {
    try {
      const t0 = Date.now()
      await w.webContents.executeJavaScript('new Promise((res, rej) => { const t = setInterval(() => { const d = window.pianola_debug; if (d && d.engine.ready && d.song.notes.length) { clearInterval(t); res() } }, 100); setTimeout(() => rej(new Error("samples not ready")), 180000) })')
      const loadMs = Date.now() - t0
      await new Promise(r => setTimeout(r, 1500))
      out('screenshot.png', (await w.webContents.capturePage()).toPNG())
      const result = await w.webContents.executeJavaScript(`(async () => {
        const d = window.pianola_debug
        const plans = {}
        for (const f of ['mov', 'mp4']) plans[f] = await d.planExport({ width: 3840, height: 2160, fps: 60, format: f })
        const plan = plans.mov
        let exportMs = null, exportError = null, frames = 0
        if (plan) {
          const song = structuredClone(d.song)
          song.notes = song.notes.filter(n => n.start < 3)
          song.pedal = song.pedal.filter(p => p.time < 3)
          song.duration = Math.max(...song.notes.map(n => n.start + n.dur))
          const h = await window.pianola.exportBegin('smoke', 'mov')
          const target = new d.StreamTarget(new WritableStream({ write: c => window.pianola.exportWrite(h.id, c.position, c.data) }), { chunked: true })
          const t = performance.now()
          try {
            await d.exportVideo(song, d.pack, { width: 3840, height: 2160, fps: 60, format: 'mov', showTitle: true, fallSeconds: 2.6, reverb: 0.35 }, plan, target, p => { if (p.frame) frames = p.frame }, new AbortController().signal)
            await window.pianola.exportFinish(h.id)
          } catch (e) { exportError = String(e && e.message || e); await window.pianola.exportAbort(h.id) }
          exportMs = performance.now() - t
        }
        return { plans, exportMs, exportError, frames, notes: d.song.notes.length, status: document.getElementById('statusText').textContent }
      })()`)
      out('smoke.json', JSON.stringify({ ok: true, loadMs, ...result }, null, 1))
      app.exit(0)
    } catch (e) { fail(e && e.stack || e) }
  })
}

// ------------------------------------------------------------------ lifecycle
app.setName('Pianola')
app.whenReady().then(() => {
  protocol.handle('app', handleApp)
  app.setAboutPanelOptions({
    applicationName: 'Pianola',
    applicationVersion: app.getVersion(),
    credits: 'Klavierklang: Salamander Grand Piano V3 von Alexander Holm (CC BY 3.0)',
  })
  buildMenu()
  createWindow()
  app.on('activate', () => { if (!win) createWindow() })
})
app.on('window-all-closed', () => { if (process.platform !== 'darwin' || smokeDir) app.quit() })
