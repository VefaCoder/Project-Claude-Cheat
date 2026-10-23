import { parse } from 'acorn'
import { createRuntime, stripFences } from './pianoscript.ts'
import type { Song } from '../song/song.ts'

export type CompileOutcome =
  | { ok: true; song: Song }
  | { ok: false; message: string; line?: number }

const API_NAMES = ['title', 'composer', 'tempo', 'meter', 'pickup', 'humanize', 'bar', 'transpose', 'sync', 'voice'] as const

/** Runs a PianoScript program and returns the song or a German error with a line number. */
export function runPianoScript(source: string): CompileOutcome {
  const code = stripFences(source)
  const { api, finish } = createRuntime(code)
  let fn: (...args: unknown[]) => unknown
  try {
    // No newline before the user code: line numbers in stack traces match the editor.
    fn = (0, eval)(`(function(${API_NAMES.join(',')}){${code}\n})\n//# sourceURL=song.js`)
  } catch (e) {
    return { ok: false, ...syntaxError(code, e as Error) }
  }
  try {
    fn(...API_NAMES.map(n => api[n]))
    return { ok: true, song: finish() }
  } catch (e) {
    const err = e as Error & { line?: number }
    let line = err.line
    if (line === undefined) {
      const m = /song\.js:(\d+):\d+/.exec(err.stack ?? '')
      if (m) line = Number(m[1])
    }
    return { ok: false, message: translate(err), line }
  }
}

function syntaxError(code: string, e: Error): { message: string; line?: number } {
  try {
    parse(code, { ecmaVersion: 'latest', sourceType: 'script', allowReturnOutsideFunction: true })
  } catch (pe) {
    const p = pe as Error & { loc?: { line: number } }
    return { message: `Syntaxfehler: ${p.message.replace(/\s*\(\d+:\d+\)$/, '')}`, line: p.loc?.line }
  }
  return { message: `Syntaxfehler: ${e.message}` }
}

function translate(e: Error): string {
  if (e.name === 'ScriptError') return e.message
  if (e instanceof ReferenceError) {
    const m = /^(\S+) is not defined/.exec(e.message)
    if (m) return `"${m[1]}" ist nicht definiert`
  }
  if (e instanceof TypeError) return `Typfehler: ${e.message}`
  return e.message || String(e)
}
