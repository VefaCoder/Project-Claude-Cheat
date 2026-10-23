import { layoutFromIndex, type PackIndex, type PackLayout } from './core.ts'

export interface PianoPack {
  layout: PackLayout
  data: Int16Array // backed by a SharedArrayBuffer so realtime and export worklets share it
  index: PackIndex
}

/** Optional on-disk cache of the decoded samples (raw PCM), provided by the Electron main process. */
export interface SampleCache {
  info(key: string): Promise<{ exists: boolean; url: string }>
  write(key: string, offset: number, data: Uint8Array, last: boolean): Promise<void>
}

function fnv1a(s: string): string {
  let h = 0x811c9dc5
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193)
  return (h >>> 0).toString(16)
}

/**
 * Loads the sample pack. The first run decodes the FLAC files in parallel; with a cache the decoded PCM is stored
 * and later starts just read it back. Progress goes from 0 to 1.
 */
export async function loadPiano(base: string, onProgress?: (fraction: number) => void, cache?: SampleCache): Promise<PianoPack> {
  const indexText = await (await fetch(base + 'index.json')).text()
  const index: PackIndex = JSON.parse(indexText)
  const { layout, totalFrames, files } = layoutFromIndex(index)
  const bytes = totalFrames * 4
  const buffer = typeof SharedArrayBuffer !== 'undefined' ? new SharedArrayBuffer(bytes) : new ArrayBuffer(bytes)
  const data = new Int16Array(buffer)
  const key = `piano-${fnv1a(indexText)}-${bytes}`

  if (cache) {
    try {
      const info = await cache.info(key)
      if (info.exists && (await readInto(info.url, new Uint8Array(buffer), onProgress))) return { layout, data, index }
    } catch { /* fall back to decoding */ }
  }

  const decoders = Array.from({ length: 6 }, () => new OfflineAudioContext(2, 1, index.sampleRate))
  let done = 0
  let next = 0
  const work = async (w: number) => {
    while (next < files.length) {
      const f = files[next++]
      const url = base + f.file.split('/').map(encodeURIComponent).join('/')
      const audio = await decoders[w].decodeAudioData(await (await fetch(url)).arrayBuffer())
      const l = audio.getChannelData(0)
      const r = audio.numberOfChannels > 1 ? audio.getChannelData(1) : l
      const len = Math.min(f.frames, audio.length)
      let o = f.offset * 2
      for (let i = 0; i < len; i++) {
        data[o++] = Math.max(-32768, Math.min(32767, Math.round(l[i] * 32768)))
        data[o++] = Math.max(-32768, Math.min(32767, Math.round(r[i] * 32768)))
      }
      onProgress?.(++done / files.length)
    }
  }
  await Promise.all(decoders.map((_, w) => work(w)))
  if (cache) void writeCache(cache, key, new Uint8Array(buffer))
  return { layout, data, index }
}

async function readInto(url: string, target: Uint8Array, onProgress?: (f: number) => void): Promise<boolean> {
  const res = await fetch(url)
  if (!res.ok || !res.body) return false
  const reader = res.body.getReader()
  let off = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    if (off + value.length > target.length) return false
    target.set(value, off)
    off += value.length
    onProgress?.(off / target.length)
  }
  return off === target.length
}

async function writeCache(cache: SampleCache, key: string, all: Uint8Array) {
  const CHUNK = 16 << 20
  try {
    for (let off = 0; off < all.length; off += CHUNK) {
      const end = Math.min(all.length, off + CHUNK)
      const copy = new Uint8Array(end - off) // plain ArrayBuffer: IPC can't carry shared memory
      copy.set(all.subarray(off, end))
      await cache.write(key, off, copy, end === all.length)
    }
  } catch (e) {
    console.warn('sample cache not written', e)
  }
}
