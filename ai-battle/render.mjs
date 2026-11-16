// Deterministic offline renderer: drives the film page frame by frame in Chromium (Mesa llvmpipe),
// receives raw RGBA frames over a WebSocket and pipes them into ffmpeg.
// usage: xvfb-run -a node render.mjs video [w h start end out.mp4]
//        xvfb-run -a node render.mjs stills w h outDir f1,f2,...   (or a:b:step)
//        xvfb-run -a node render.mjs cues
import http from 'http'; import fs from 'fs'; import path from 'path'; import { spawn } from 'child_process';
import { createRequire } from 'module'; import { WebSocketServer } from 'ws';
const require = createRequire(import.meta.url);
let chromium; try { ({ chromium } = require('playwright')); } catch { ({ chromium } = require('/opt/node-tools/node_modules/playwright')); }

const [mode = 'video', ...rest] = process.argv.slice(2);
const root = path.resolve(path.dirname(new URL(import.meta.url).pathname));
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.mjs': 'text/javascript', '.json': 'application/json', '.png': 'image/png' };
const srv = http.createServer((req, res) => {
  const p = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  fs.readFile(p, (e, d) => { if (e) { res.writeHead(404); res.end(); return; } res.writeHead(200, { 'content-type': mime[path.extname(p)] || 'application/octet-stream' }); res.end(d); });
});
await new Promise((r) => srv.listen(0, r));
const port = srv.address().port;

let W = 2560, H = 1440, frames = null, ff = null, outInfo = '';
function parseFrames(spec, total) {
  if (spec.includes(':')) { const [a, b, st = 1] = spec.split(':').map(Number); const o = []; for (let i = a; i < Math.min(b, total); i += st) o.push(i); return o; }
  return spec.split(',').map(Number);
}
const wss = new WebSocketServer({ port: 0, maxPayload: 1 << 28 });
const wsPort = wss.address().port;
let got = 0; const t0 = Date.now();
wss.on('connection', (s) => s.on('message', (d) => {
  got++;
  const ok = ff.stdin.write(d, () => {});
  const ack = () => s.send('k');
  if (ok) ack(); else ff.stdin.once('drain', ack);
  if (got % 30 === 0 || mode === 'stills') process.stdout.write(`\r${got}/${frames.length} frames  ${((Date.now() - t0) / got / 1000).toFixed(2)} s/f   `);
}));

const browser = await chromium.launch({ headless: false, args: ['--use-gl=angle', '--use-angle=gl', '--ignore-gpu-blocklist', '--disable-gpu-vsync', '--disable-frame-rate-limit', '--disable-background-timer-throttling', '--disable-renderer-backgrounding', '--disable-backgrounding-occluded-windows'] });
const page = await browser.newPage();
page.on('console', (m) => { const t = m.text(); if (!/GPU stall|GL Driver Message/.test(t)) console.log('[page]', t); });
page.on('pageerror', (e) => { console.log('PAGE ERROR', e.message, e.stack); });

if (mode === 'stills') { W = +rest[0]; H = +rest[1]; }
if (mode === 'video' && rest.length >= 2) { W = +rest[0]; H = +rest[1]; }
await page.goto(`http://localhost:${port}/index.html?w=${W}&h=${H}&ws=${wsPort}`);
await page.waitForFunction('window.film && window.film.ready', null, { timeout: 120000 });
const info = await page.evaluate('window.film.info()');
console.log('film:', JSON.stringify(info));

if (mode === 'cues') {
  const cues = await page.evaluate('window.film.cues()');
  fs.writeFileSync(path.join(root, 'audio/cues.json'), JSON.stringify(cues, null, 1));
  console.log('wrote cues', cues.events.length);
} else {
  if (mode === 'stills') {
    const dir = rest[2]; fs.mkdirSync(dir, { recursive: true });
    frames = parseFrames(rest[3], info.totalFrames);
    ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-i', '-', '-vf', 'vflip', '-start_number', '0', path.join(dir, 'f_%04d.png')], { stdio: ['pipe', 'inherit', 'inherit'] });
    outInfo = dir;
  } else {
    const a = +(rest[2] ?? 0), b = +(rest[3] ?? info.totalFrames), out = rest[4] || 'out/tmp/video.mp4', step = +(rest[5] ?? 1);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    frames = []; for (let i = a; i < Math.min(b, info.totalFrames); i += step) frames.push(i);
    ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'rawvideo', '-pix_fmt', 'rgba', '-s', `${W}x${H}`, '-r', String(60 / step), '-i', '-',
      '-vf', 'vflip', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', W > 1300 ? '10' : '18', '-pix_fmt', 'yuv420p', out], { stdio: ['pipe', 'inherit', 'inherit'] });
    outInfo = out;
  }
  await page.evaluate((f) => window.film.renderFrames(f), frames);
  ff.stdin.end();
  await new Promise((r) => ff.on('close', r));
  console.log(`\ndone -> ${outInfo}  (${((Date.now() - t0) / 1000).toFixed(0)} s)`);
}
await browser.close(); srv.close(); wss.close();
