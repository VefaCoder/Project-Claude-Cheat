import { test } from 'node:test'
import assert from 'node:assert/strict'
import { autoRange, visibleSeconds, computeLayout, keyAt } from '../src/render/renderer.ts'
import { emptySong, type Song } from '../src/song/song.ts'

const songWith = (keys: number[]): Song => ({ ...emptySong(), notes: keys.map((key, i) => ({ start: i, dur: 1, key, vel: 80, voice: 0 })) })

test('16:9 frames show exactly the fall time', () => {
  for (const [w, h] of [[1920, 1080], [3840, 2160]]) {
    const v = visibleSeconds(w, h, 2.6)
    assert.ok(Math.abs(v - 2.6) < 0.03, `${w}x${h}: ${v}`)
  }
  assert.ok(visibleSeconds(2160, 3840, 2.6, autoRange(songWith([60, 79]))) > 3.5) // portrait looks further ahead
})

test('portrait zoom covers the used keys in whole octaves', () => {
  assert.deepEqual(autoRange(songWith([60, 79])), [48, 84])
  assert.deepEqual(autoRange(songWith([22, 107])), [21, 108])
  assert.deepEqual(autoRange(songWith([21, 30])), [21, 60])
  const [lo, hi] = autoRange(songWith([64]))
  assert.ok(lo <= 64 && hi >= 64 && hi - lo >= 36)
})

test('key hit testing prefers black keys', () => {
  const L = computeLayout(1920, 1080)
  const cs = 61 // C#4
  const x = L.x[cs] + L.w[cs] / 2
  assert.equal(keyAt(L, x, L.keysTop + 5), cs)
  assert.equal(keyAt(L, x, 1075), x < L.x[62] ? 60 : 62)
  assert.equal(keyAt(L, x, L.hitY - 10), -1)
})
