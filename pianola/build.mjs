// Bundles the renderer, the language worker and the audio worklet into dist/.
import * as esbuild from 'esbuild'
import fs from 'node:fs'

const prod = process.argv.includes('--prod') || process.env.NODE_ENV === 'production'
const common = { bundle: true, target: 'chrome130', sourcemap: !prod, minify: prod, logLevel: 'warning', legalComments: 'none' }

fs.rmSync('dist', { recursive: true, force: true })
fs.mkdirSync('dist', { recursive: true })

await Promise.all([
  esbuild.build({ ...common, entryPoints: { app: 'src/app/main.ts' }, outdir: 'dist', format: 'esm', loader: { '.woff2': 'file' } }),
  esbuild.build({ ...common, entryPoints: { 'lang-worker': 'src/lang/worker.ts' }, outdir: 'dist', format: 'iife' }),
  esbuild.build({ ...common, entryPoints: { 'piano-worklet': 'src/audio/worklet.ts' }, outdir: 'dist', format: 'iife' }),
])
for (const f of ['index.html', 'styles.css']) fs.copyFileSync(`src/${f}`, `dist/${f}`)
console.log('built dist/' + (prod ? ' (production)' : ''))
