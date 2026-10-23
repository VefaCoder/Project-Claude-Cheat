// 4K export: renders audio offline with the same engine, draws every frame with the same renderer,
// encodes with WebCodecs (VideoToolbox on the Mac) and muxes with Mediabunny.
import {
  Output, MovOutputFormat, Mp4OutputFormat, CanvasSource, AudioBufferSource, canEncodeVideo, canEncodeAudio,
  type Target,
} from 'mediabunny'
import { PianoRenderer } from '../render/renderer.ts'
import { renderSongAudio, masterBuffer, SAMPLE_RATE } from '../audio/engine.ts'
import type { PianoPack } from '../audio/samples.ts'
import type { Song } from '../song/song.ts'

export type ExportFormat = 'mov' | 'mp4'

export interface ExportSettings {
  width: number
  height: number
  fps: number
  format: ExportFormat
  showTitle: boolean
  fallSeconds: number
  reverb: number
}

export interface ExportProgress {
  phase: 'audio' | 'video' | 'finish'
  fraction: number
  frame?: number
  frames?: number
  etaSeconds?: number
}

export interface ExportPlan { videoCodec: 'hevc' | 'avc'; videoBitrate: number; audioCodec: 'pcm-s24' | 'aac' }

/** Picks the best codecs this machine can encode for the requested format. */
export async function planExport(s: Pick<ExportSettings, 'width' | 'height' | 'fps' | 'format'>): Promise<ExportPlan | null> {
  const px = s.width * s.height * s.fps
  const candidates: ('hevc' | 'avc')[] = s.format === 'mov' ? ['hevc', 'avc'] : ['avc', 'hevc']
  for (const codec of candidates) {
    const bitrate = Math.round(px * (codec === 'hevc' ? 0.1 : 0.16))
    if (await canEncodeVideo(codec, { width: s.width, height: s.height, bitrate, frameRate: s.fps })) {
      if (s.format === 'mov') return { videoCodec: codec, videoBitrate: bitrate, audioCodec: 'pcm-s24' }
      if (await canEncodeAudio('aac', { numberOfChannels: 2, sampleRate: SAMPLE_RATE, bitrate: 320_000 })) {
        return { videoCodec: codec, videoBitrate: bitrate, audioCodec: 'aac' }
      }
      return null
    }
  }
  return null
}

export function exportTiming(song: Song, fallSeconds: number) {
  const preroll = fallSeconds + 0.8
  const tail = 3.5
  return { preroll, tail, total: preroll + song.duration + tail }
}

export async function exportVideo(
  song: Song, pack: PianoPack, s: ExportSettings, plan: ExportPlan, target: Target,
  onProgress: (p: ExportProgress) => void, signal: AbortSignal,
): Promise<void> {
  const { preroll, tail, total } = exportTiming(song, s.fallSeconds)
  const check = () => { if (signal.aborted) throw new DOMException('Export abgebrochen', 'AbortError') }

  onProgress({ phase: 'audio', fraction: 0 })
  const rendered = await renderSongAudio(song, pack, s.reverb, preroll, tail)
  check()
  const pcm = masterBuffer(rendered)
  onProgress({ phase: 'audio', fraction: 1 })

  const output = new Output({
    format: s.format === 'mov' ? new MovOutputFormat({ fastStart: false }) : new Mp4OutputFormat({ fastStart: false }),
    target,
  })
  const canvas = new OffscreenCanvas(s.width, s.height)
  const ctx = canvas.getContext('2d', { alpha: false })!
  const video = new CanvasSource(canvas, {
    codec: plan.videoCodec,
    bitrate: plan.videoBitrate,
    keyFrameInterval: 2,
    latencyMode: 'quality',
  })
  const audio = new AudioBufferSource(plan.audioCodec === 'aac' ? { codec: 'aac', bitrate: 320_000 } : { codec: 'pcm-s24' })
  output.addVideoTrack(video, { frameRate: s.fps })
  output.addAudioTrack(audio)
  if (song.title) output.setMetadataTags({ title: song.title, artist: song.composer || undefined })
  await output.start()

  const renderer = new PianoRenderer()
  renderer.setSong(song)
  const frames = Math.ceil(total * s.fps)
  const audioFrames = pcm.length / 2
  let audioAdded = 0
  const addAudioUntil = async (seconds: number) => {
    const upto = Math.min(audioFrames, Math.ceil(seconds * SAMPLE_RATE))
    while (audioAdded < upto) {
      const n = Math.min(SAMPLE_RATE, audioFrames - audioAdded)
      const buf = new AudioBuffer({ length: n, numberOfChannels: 2, sampleRate: SAMPLE_RATE })
      const l = new Float32Array(n)
      const r = new Float32Array(n)
      for (let i = 0; i < n; i++) {
        l[i] = pcm[(audioAdded + i) * 2]
        r[i] = pcm[(audioAdded + i) * 2 + 1]
      }
      buf.copyToChannel(l, 0)
      buf.copyToChannel(r, 1)
      await audio.add(buf)
      audioAdded += n
    }
  }

  const started = performance.now()
  try {
    for (let i = 0; i < frames; i++) {
      check()
      const vt = i / s.fps
      if (vt + 1 > audioAdded / SAMPLE_RATE) await addAudioUntil(vt + 2)
      renderer.draw(ctx, s.width, s.height, vt - preroll, {
        fallSeconds: s.fallSeconds,
        title: s.showTitle && song.title ? { text: song.title, sub: song.composer, alpha: titleAlpha(vt) } : null,
      })
      await video.add(vt, 1 / s.fps)
      if (i % 10 === 0 || i === frames - 1) {
        const elapsed = (performance.now() - started) / 1000
        const fraction = (i + 1) / frames
        onProgress({ phase: 'video', fraction, frame: i + 1, frames, etaSeconds: fraction > 0.02 ? (elapsed / fraction) * (1 - fraction) : undefined })
      }
    }
    await addAudioUntil(Infinity)
    onProgress({ phase: 'finish', fraction: 1 })
    await output.finalize()
  } catch (e) {
    await output.cancel().catch(() => {})
    throw e
  }
}

function titleAlpha(t: number): number {
  if (t < 0.4) return 0
  if (t < 1.4) return (t - 0.4) / 1.0
  if (t < 4.6) return 1
  if (t < 5.8) return 1 - (t - 4.6) / 1.2
  return 0
}
