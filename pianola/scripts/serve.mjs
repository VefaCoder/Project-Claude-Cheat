// Dev server for the browser build: dist/ at /, the sample pack at /piano/.
// Sends COOP/COEP so SharedArrayBuffer works, like the Electron app:// protocol does.
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'

const port = Number(process.argv[2] || 5173)
const roots = [['/piano/', 'assets/piano'], ['/', process.argv[3] || 'dist']]
const types = {
  '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.flac': 'audio/flac', '.map': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml', '.woff2': 'font/woff2',
}

http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname)
  if (p === '/') p = '/index.html'
  const [prefix, dir] = roots.find(([pre]) => p.startsWith(pre))
  const file = path.join(dir, p.slice(prefix.length))
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end(); return }
    res.writeHead(200, {
      'Content-Type': types[path.extname(file)] || 'application/octet-stream',
      'Cross-Origin-Opener-Policy': 'same-origin',
      'Cross-Origin-Embedder-Policy': 'require-corp',
      'Cache-Control': 'no-store',
    })
    res.end(data)
  })
}).listen(port, () => console.log(`http://localhost:${port}`))
