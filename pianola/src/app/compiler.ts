import type { CompileOutcome } from '../lang/compile.ts'

/** Runs PianoScript in a throwaway worker so endless loops can be stopped. */
export function compile(code: string, timeoutMs = 8000): Promise<CompileOutcome> {
  return new Promise(resolve => {
    const worker = new Worker('lang-worker.js')
    const done = (r: CompileOutcome) => {
      clearTimeout(timer)
      worker.terminate()
      resolve(r)
    }
    const timer = setTimeout(() => done({ ok: false, message: `Der Code läuft länger als ${timeoutMs / 1000} Sekunden und wurde abgebrochen (Endlosschleife?)` }), timeoutMs)
    worker.onmessage = e => done(e.data as CompileOutcome)
    worker.onerror = e => {
      e.preventDefault()
      done({ ok: false, message: e.message || 'Unbekannter Fehler', line: e.lineno || undefined })
    }
    worker.postMessage({ code })
  })
}
