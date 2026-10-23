// Runs user code off the main thread. A fresh worker per run; the app kills it on timeout.
import { runPianoScript } from './compile.ts'

self.onmessage = (e: MessageEvent<{ code: string }>) => {
  self.postMessage(runPianoScript(e.data.code))
}
