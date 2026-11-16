#!/usr/bin/env python3
"""Procedural soundtrack + sound design for the AI battle film.
Everything is synthesised from scratch (no samples). Reads audio/cues.json exported by the
film (`node render.mjs cues`) so every sound is frame-accurate. Writes audio/soundtrack.wav."""
import json, os, sys
import numpy as np
from scipy import signal
from scipy.io import wavfile

SR = 48000
HERE = os.path.dirname(os.path.abspath(__file__))
C = json.load(open(os.path.join(HERE, 'cues.json')))
DUR = C['duration'] + 0.02
N = int(DUR * SR)
M = C['marks']
rng = np.random.default_rng(7)

# ----------------------------------------------------------------------------- helpers
def n2f(n): return 440.0 * 2 ** ((n - 69) / 12)
def T(d): return np.arange(int(d * SR)) / SR
def noise(d): return rng.standard_normal(int(d * SR))
def expenv(d, tau, a=0.002):
    t = T(d); return np.minimum(1, t / a) * np.exp(-t / tau)
def hann(d):
    n = int(d * SR); return np.hanning(n) if n > 1 else np.ones(n)
def filt(x, kind, f, order=2):
    f = np.clip(np.atleast_1d(f), 20, SR / 2 - 200)
    sos = signal.butter(order, f if len(f) > 1 else f[0], kind, fs=SR, output='sos')
    return signal.sosfilt(sos, x)
def lp(x, f, o=2): return filt(x, 'low', f, o)
def hp(x, f, o=2): return filt(x, 'high', f, o)
def bp(x, f0, f1, o=2): return filt(x, 'band', [f0, f1], o)
def gliss(d, f0, f1, curve=1.0, exp=True):
    t = T(d); u = (t / max(d, 1e-6)) ** curve
    f = f0 * (f1 / f0) ** u if exp else f0 + (f1 - f0) * u
    return 2 * np.pi * np.cumsum(f) / SR
def saw(ph): return 2 * ((ph / (2 * np.pi)) % 1.0) - 1
def sq(ph, w=0.5): return np.where(((ph / (2 * np.pi)) % 1.0) < w, 1.0, -1.0)
def tri(ph): return 2 * np.abs(saw(ph)) - 1
def supersaw(f, d, voices=5, det=0.012, seed=0):
    r = np.random.default_rng(seed + int(f * 10)); t = T(d); o = np.zeros(len(t))
    for i in range(voices):
        dt = 1 + det * (i - (voices - 1) / 2) / max(1, (voices - 1) / 2)
        o += saw(2 * np.pi * f * dt * t + r.uniform(0, 6.28))
    return o / voices
def fade(x, a=0.004, r=0.01):
    x = x.copy(); na, nr = min(len(x) // 2, int(a * SR)), min(len(x) // 2, int(r * SR))
    if na: x[:na] *= np.linspace(0, 1, na)
    if nr: x[-nr:] *= np.linspace(1, 0, nr)
    return x
def xfade_filters(x, kinds):
    """cheap 'moving filter': crossfade between statically filtered copies. kinds: list of callables"""
    ys = [k(x) for k in kinds]; n = len(x); out = np.zeros(n); m = len(ys)
    pos = np.linspace(0, m - 1, n)
    for i, y in enumerate(ys): out += y * np.clip(1 - np.abs(pos - i), 0, 1)
    return out

class Bus:
    def __init__(self): self.d = np.zeros((N, 2)); self.rev = np.zeros((N, 2))
    def add(self, x, t, gain=1.0, pan=0.0, rev=0.0):
        i = int(round(t * SR))
        if i >= N or len(x) == 0: return
        if i < 0: x = x[-i:]; i = 0
        x = x[:N - i]; p = np.clip(pan, -1, 1) * 0.5 + 0.5
        l, r = np.cos(p * np.pi / 2) * gain, np.sin(p * np.pi / 2) * gain
        self.d[i:i + len(x), 0] += x * l; self.d[i:i + len(x), 1] += x * r
        if rev > 0: self.rev[i:i + len(x), 0] += x * l * rev; self.rev[i:i + len(x), 1] += x * r * rev

def make_ir(d=2.8, bright=5000, seed=3):
    r = np.random.default_rng(seed); t = T(d); ir = np.zeros((len(t), 2))
    for c in range(2):
        x = r.standard_normal(len(t)) * np.exp(-t / (d / 5.5)); x = lp(x, bright); x[:int(0.012 * SR)] *= np.linspace(0, 1, int(0.012 * SR))
        ir[:, c] = x
    return ir / np.sqrt((ir ** 2).sum(0)).max()
def reverb(x, ir):
    o = np.zeros_like(x)
    for c in range(2): o[:, c] = signal.fftconvolve(x[:, c], ir[:, c])[:len(x)]
    return o

# ----------------------------------------------------------------------------- drum / percussion voices
def kick(f0=130, f1=42, d=0.42, punch=1.0):
    ph = gliss(d, f0, f1, 0.35); x = np.sin(ph) * expenv(d, 0.16)
    return np.tanh((x + hp(noise(d), 3000) * expenv(d, 0.004) * 0.35 * punch) * 1.6)
def taiko(f=78, d=0.9):
    ph = gliss(d, f * 1.9, f, 0.18); x = np.sin(ph) * expenv(d, 0.28) + 0.4 * np.sin(ph * 1.52) * expenv(d, 0.12)
    x += lp(noise(d), 900) * expenv(d, 0.035) * 0.9 + bp(noise(d), 1500, 4000) * expenv(d, 0.012) * 0.35
    return np.tanh(x * 1.4)
def snare(d=0.3):
    x = bp(noise(d), 900, 7000) * expenv(d, 0.07) + np.sin(gliss(d, 240, 170)) * expenv(d, 0.05) * 0.6
    return np.tanh(x * 1.5)
def hat(d=0.05, f=8000): return hp(noise(d), f, 4) * expenv(d, d / 3.5, 0.001)
def tick(f=2400, d=0.05): return (np.sin(2 * np.pi * f * T(d)) * 0.6 + hp(noise(d), 5000) * 0.3) * expenv(d, 0.01, 0.0005)
def boom(d=2.4, f=52, drive=1.8):
    ph = gliss(d, f * 2.6, f * 0.85, 0.25); x = np.sin(ph) * expenv(d, d / 5.0) * 0.8 + lp(noise(d), 420) * expenv(d, 0.22) * 1.3 + bp(noise(d), 300, 3500) * expenv(d, 0.07) * 0.9
    return np.tanh(x * drive)
def braam(notes=(26, 38, 45), d=3.0):
    x = np.zeros(int(d * SR))
    for n in notes: x += supersaw(n2f(n), d, 7, 0.02, seed=n)
    x = xfade_filters(x, [lambda v: lp(v, 500, 4), lambda v: lp(v, 2200, 4), lambda v: lp(v, 900, 4)])
    t = T(d); e = np.minimum(1, t / 0.03) * np.exp(-t / (d / 2.6)); return np.tanh(x * e * 2.2)
def riser(d=1.5, f0=180, f1=1800):
    t = T(d); u = t / d
    tone = sum(saw(gliss(d, f0 * r, f1 * r, 1.6)) for r in (1, 1.5, 2.01)) / 3
    nz = xfade_filters(noise(d), [lambda v: lp(v, 500), lambda v: bp(v, 800, 3000), lambda v: hp(v, 3500)])
    return (lp(tone, 5000) * 0.35 + nz * 0.6) * u ** 2.2

# ----------------------------------------------------------------------------- tonal voices
def spicc(f, d=0.16, bright=3200):
    x = supersaw(f, d, 3, 0.006, seed=1); return lp(x, bright) * expenv(d, 0.05, 0.004)
def pad(freqs, d, bright=1700, att=0.6, rel=0.8, seed=5):
    x = np.zeros(int(d * SR))
    for f in freqs: x += supersaw(f, d, 5, 0.009, seed=seed)
    x = lp(x / len(freqs), bright, 2); t = T(d); e = np.minimum(1, t / att) * np.minimum(1, (d - t) / rel)
    return x * np.clip(e, 0, 1)
def choir(freqs, d, att=0.5, rel=0.7):
    x = np.zeros(int(d * SR))
    for f in freqs: x += supersaw(f, d, 4, 0.006, seed=9) * (1 + 0.004 * np.sin(2 * np.pi * 5.2 * T(d)))
    x = x / len(freqs); y = bp(x, 600, 900) * 1.0 + bp(x, 1000, 1300) * 0.6 + bp(x, 2500, 3100) * 0.25
    t = T(d); e = np.clip(np.minimum(t / att, (d - t) / rel), 0, 1); return y * e * 2.2
def brass(f, d, bright=1.0):
    t = T(d); vib = 1 + 0.004 * np.sin(2 * np.pi * 5.5 * t) * np.minimum(1, t / 0.3)
    ph = 2 * np.pi * np.cumsum(f * vib) / SR; x = (saw(ph) + saw(ph * 1.004 + 1) + saw(ph * 0.996 + 2)) / 3
    att = np.minimum(1, t / 0.05); y = lp(x, 900 * bright, 2) * (1 - att * 0.55) + lp(x, 2300 * bright, 2) * att * 0.55
    e = np.minimum(1, t / 0.035) * np.minimum(1, (d - t) / 0.08) * (0.75 + 0.25 * np.exp(-t / 0.25)); return np.tanh(y * np.clip(e, 0, 1) * 1.6)
def bassn(f, d, drive=1.0, bright=520):
    t = T(d); x = saw(2 * np.pi * f * t) * 0.8 + sq(2 * np.pi * f * 2 * t) * 0.25 + np.sin(2 * np.pi * f * t) * 0.4
    return np.tanh(lp(x, bright, 2) * expenv(d, d * 0.6, 0.004) * 1.5 * drive)
def bell(f, d=1.6, warm=1.0):
    t = T(d); idx = 3.2 * np.exp(-t / 0.18) + 0.25
    x = np.sin(2 * np.pi * f * t + idx * np.sin(2 * np.pi * f * 3.51 * t)) * np.exp(-t / (d / 3.2))
    x += 0.45 * warm * np.sin(2 * np.pi * f * t) * np.exp(-t / (d / 2.2)) + 0.12 * np.sin(2 * np.pi * f * 2.0 * t) * np.exp(-t / 0.3)
    return fade(x, 0.002, 0.02)
def blip(f, d=0.07, crush=True):
    t = T(d); x = sq(2 * np.pi * f * t, 0.25) * expenv(d, d / 3, 0.001)
    if crush: x = np.round(x * 5) / 5
    return lp(x, 7000)

# ----------------------------------------------------------------------------- sfx generators
def whoosh(d=0.3, lo=300, hi=2600, tone=0.0, f0=900, f1=300):
    x = xfade_filters(noise(d), [lambda v: bp(v, lo, lo * 3), lambda v: bp(v, hi * 0.5, hi * 1.5), lambda v: bp(v, lo * 1.3, lo * 4)]) * hann(d) ** 1.4
    if tone: x += np.sin(gliss(d, f0, f1)) * hann(d) * tone
    return x
def zip_(d=0.13, f0=5200, f1=900):
    return (np.sin(gliss(d, f0, f1, 0.6)) * 0.5 + hp(noise(d), 3500) * 0.7) * expenv(d, d / 2.5, 0.003) + tick(3800, 0.02)[:int(d * SR)].sum() * 0
def metal(base=520, d=1.1, bright=1.0, size=1.0, seed=0):
    r = np.random.default_rng(seed + 11); t = T(d); x = np.zeros(len(t))
    for k, ratio in enumerate((1, 1.58, 2.24, 2.92, 3.61, 4.7, 5.93, 7.4)):
        x += np.sin(2 * np.pi * base * ratio * (1 + r.uniform(-0.01, 0.01)) * t + r.uniform(0, 6)) * np.exp(-t / (d / (2.2 + k * 0.9))) * (bright ** k) / (1 + k * 0.35)
    x += hp(noise(d), 2500) * expenv(d, 0.02, 0.0005) * 1.6 + bp(noise(d), 500, 2500) * expenv(d, 0.05) * 0.5 * size
    if size > 1: x += np.sin(gliss(d, 150, 45, 0.3)) * expenv(d, 0.2) * 1.4 * (size - 1)
    return np.tanh(fade(x, 0.0005, 0.02) * 0.9)
def punch(d=0.5, size=1.0):
    x = np.sin(gliss(d, 170, 42, 0.25)) * expenv(d, 0.12 * size) * 1.4 + lp(noise(d), 1200) * expenv(d, 0.03) * 1.3 + hp(noise(d), 2500) * expenv(d, 0.008) * 0.8
    return np.tanh(x * 2.0)
def shatter(d=1.0, n=60, lo=2200, hi=9500, seed=0):
    r = np.random.default_rng(seed + 31); x = hp(noise(d), 3000) * expenv(d, 0.09, 0.001) * 0.9
    for _ in range(n):
        t0 = abs(r.normal(0, d * 0.16)); dd = r.uniform(0.04, 0.35); f = r.uniform(lo, hi); i = int(t0 * SR)
        p = np.sin(2 * np.pi * f * T(dd)) * np.exp(-T(dd) / (dd / 4)) * r.uniform(0.15, 0.5)
        if i < len(x): x[i:i + len(p)] += p[:len(x) - i]
    return fade(x, 0.0005, 0.03)
def pew(d=0.11): return (np.sin(gliss(d, 3400, 520, 0.5)) + 0.4 * sq(gliss(d, 6800, 1040, 0.5))) * expenv(d, d / 3.2, 0.0006) + hp(noise(d), 6000) * expenv(d, 0.006, 0.0003) * 0.8
def beep2(f1=1900, f2=2500, d=0.045): return np.concatenate([fade(sq(2 * np.pi * f1 * T(d), 0.5), 0.001, 0.003), fade(sq(2 * np.pi * f2 * T(d), 0.5), 0.001, 0.006)]) * 0.5
def shimmer(d=0.4, base=72, up=True, n=6):
    x = np.zeros(int((d + 1.0) * SR)); sc = [0, 2, 4, 7, 9, 12, 14, 16, 19]
    for k in range(n):
        i = int(k * d / n * SR); nn = base + (sc[k] if up else sc[n - 1 - k]); b = bell(n2f(nn), 0.9) * 0.5; x[i:i + len(b)] += b[:len(x) - i]
    return x + np.pad(hp(noise(d), 6000) * hann(d) * 0.15, (0, len(x) - int(d * SR)))
def laser(d=0.5):
    t = T(d); x = saw(2 * np.pi * 174 * t) + saw(2 * np.pi * 261.5 * t) * 0.7 + sq(2 * np.pi * 87 * t) * 0.5
    x = bp(x, 300, 3800) * (0.7 + 0.3 * np.sin(2 * np.pi * 43 * t)) + hp(noise(d), 4500) * 0.25
    return np.tanh(fade(x, 0.004, 0.06) * 1.6) + np.pad(pew(0.12) * 0.8, (0, max(0, len(t) - int(0.12 * SR))))[:len(t)]
def thunk(d=0.45):
    x = np.sin(gliss(d, 120, 48, 0.3)) * expenv(d, 0.1) * 1.3 + metal(310, d, 0.7, 1.0, seed=5) * 0.5
    sv = saw(gliss(0.14, 180, 520)) * hann(0.14) * 0.25; x[:len(sv)] += lp(sv, 2500)
    return np.tanh(x * 1.5)

# ----------------------------------------------------------------------------- buses
music, sfx = Bus(), Bus()
BPM = 132.0; BEAT = 60 / BPM; S16 = BEAT / 4; SLOT = 8 * BEAT
CH = [(38, [50, 53, 57], 'Dm'), (34, [46, 50, 53], 'Bb'), (31, [43, 46, 50], 'Gm'), (33, [45, 49, 52], 'A')]
SECT = [(0, 'fight'), (M['designStart'], 'claude'), (M['critique'], 'codex'), (M['control'], 'machine'), (M['low'], 'low'), (M['plan'], 'mind'), (M['planExec'], 'hero'),
        (M['execution'], 'exec'), (M['charge'], 'charge'), (M['fire'], 'clash'), (M['detonate'], 'void'), (M['after'], 'after'), (M['finalDash'], 'final'), (M['end'], 'black')]
def sect(t):
    s = SECT[0]
    for q in SECT:
        if q[0] <= t + 1e-6: s = q
    return s
def sect_end(t):
    for q in SECT:
        if q[0] > t + 1e-6: return q[0]
    return DUR

# ---- sustained layers per chord slot
nslots = int(DUR / SLOT) + 1
for k in range(nslots):
    t0 = k * SLOT; root, tri_, _ = CH[k % 4]
    # split the slot at section boundaries so every section gets its own colour
    cuts = [t0] + [q[0] for q in SECT if t0 < q[0] < t0 + SLOT] + [min(t0 + SLOT, DUR)]
    for a, b in zip(cuts[:-1], cuts[1:]):
        d = b - a; name = sect(a)[1]
        if d < 0.12: continue
        fr = [n2f(n) for n in tri_]
        if name in ('fight', 'hero', 'clash'):
            g = {'fight': 0.34, 'hero': 0.42, 'clash': 0.46}[name]
            music.add(pad([n2f(root + 12)] + fr + [n2f(tri_[0] + 12)], d + 0.3, 2000, 0.08, 0.35), a, g, -0.15, 0.35)
            music.add(pad([f * 2 for f in fr], d + 0.3, 2600, 0.1, 0.35, seed=8), a, g * 0.6, 0.2, 0.4)
            if name != 'fight': music.add(choir([f * 2 for f in fr], d + 0.3, 0.15, 0.4), a, 0.26, 0.0, 0.5)
            music.add(np.sin(2 * np.pi * n2f(root) * T(d)) * fade(np.ones(int(d * SR)), 0.02, 0.1), a, 0.09)
        elif name == 'claude':
            music.add(choir([f * 2 for f in fr], d + 0.5, 0.5, 0.7), a, 0.36, -0.1, 0.6); music.add(pad(fr, d + 0.5, 1500, 0.5, 0.7), a, 0.3, 0.1, 0.4)
            music.add(bassn(n2f(root), d, 0.7, 260) * 0.0 + np.sin(2 * np.pi * n2f(root) * T(d)) * fade(np.ones(int(d * SR)), 0.1, 0.3), a, 0.1)
        elif name == 'codex':
            music.add(hp(pad([f * 4 for f in fr[:2]], d + 0.2, 5200, 0.3, 0.3, seed=2), 1800), a, 0.07, 0.3, 0.3)
            music.add(np.sin(2 * np.pi * n2f(root) * T(d)) * fade(np.ones(int(d * SR)), 0.02, 0.1), a, 0.09)
        elif name == 'machine':
            music.add(np.tanh(lp(supersaw(n2f(root - 12), d, 5, 0.02) + supersaw(n2f(root), d, 5, 0.02) * 0.6, 420, 4) * 3) * fade(np.ones(int(d * SR)), 0.02, 0.1), a, 0.2, 0, 0.2)
            music.add(pad([n2f(root + 12), n2f(root + 13)], d + 0.2, 1500, 0.2, 0.3), a, 0.10, 0.0, 0.4)
        elif name in ('low', 'exec'):
            music.add(lp(supersaw(n2f(38), d + 0.4, 5, 0.015), 260, 4) * fade(np.ones(int((d + 0.4) * SR)), 0.3, 0.4), a, 0.2)
            if name == 'low': music.add(pad([n2f(62), n2f(65)], d + 0.6, 900, 0.8, 0.8), a, 0.07, 0, 0.6)
        elif name == 'mind':
            music.add(pad([n2f(74), n2f(81), n2f(86), n2f(78)], d + 0.4, 3200, 0.9, 0.6, seed=4), a, 0.2, 0.0, 0.8); music.add(np.sin(2 * np.pi * n2f(38) * T(d)) * fade(np.ones(int(d * SR)), 0.3, 0.3), a, 0.07)
        elif name == 'charge':
            music.add(pad([n2f(root + 12)] + fr, d + 0.2, 2400, d * 0.8, 0.2) * np.linspace(0.3, 1, int((d + 0.2) * SR)) ** 2, a, 0.3, 0, 0.4)
            music.add(choir([f * 2 for f in fr], d + 0.2, d * 0.8, 0.2), a, 0.2, 0, 0.5)
        elif name == 'after':
            music.add(pad([n2f(50), n2f(57), n2f(62), n2f(65)], d + 1.0, 1100, 0.8, 1.0), a, 0.17, 0, 0.7); music.add(np.sin(2 * np.pi * n2f(38) * T(d)) * fade(np.ones(int(d * SR)), 0.3, 0.5), a, 0.07)

# ---- step sequencer (16ths)
steps = int(DUR / S16)
KICK_F = 'x..x..x.x..x..x.'; KICK_M = 'x.........x..x..'; PENT = [0, 3, 5, 7, 10, 12, 15, 17]
for i in range(steps):
    t = i * S16; name = sect(t)[1]; st = i % 16; slot = int(t / SLOT) % 4; root, tri_, _ = CH[slot]; bar = i // 16
    hum = rng.uniform(0.85, 1.0)
    if name in ('fight', 'hero', 'clash'):
        big = name != 'fight'
        if KICK_F[st] == 'x' or (name == 'clash' and st % 2 == 0): music.add(kick(), t, 0.62 if name != 'clash' else 0.5)
        if st in (4, 12): music.add(snare(), t, 0.36, 0.05, 0.25); music.add(taiko(92, 0.6), t, 0.3, -0.2, 0.3)
        if st == 0: music.add(taiko(70), t, 0.6, 0.15, 0.4)
        if st in (10, 14) and bar % 2: music.add(taiko(110, 0.5), t, 0.34 * hum, 0.3, 0.3)
        music.add(hat(0.04 if st % 2 else 0.06), t, (0.10 if st % 2 else 0.16) * hum, 0.25)
        arp = [root + 12, tri_[2], root + 24, tri_[1] + 12, root + 12, tri_[2] + 12, root + 24, tri_[0] + 12][st % 8]
        acc = 1.0 if st % 4 == 0 else 0.62
        music.add(spicc(n2f(arp), 0.15, 3600 if big else 3000), t, 0.36 * acc * hum, -0.35, 0.3); music.add(spicc(n2f(arp + 12), 0.13, 4200), t, 0.18 * acc * hum, 0.4, 0.35)
        if st % 2 == 0: music.add(bassn(n2f(root + (12 if st in (6, 14) else 0)), S16 * 1.9, 1.1), t, 0.34)
    elif name == 'claude':
        if st == 0: music.add(taiko(64, 1.0), t, 0.32, 0, 0.5)
        if st % 4 == 2: music.add(tick(1800, 0.04), t, 0.08, 0.3, 0.4)
        nn = tri_[0] + 12 + PENT[(st * 3 + bar * 2) % 8]
        if st % 2 == 0 or st in (3, 11): music.add(bell(n2f(nn), 1.3), t, 0.17 * hum, -0.4 + 0.8 * ((st * 5) % 7) / 6, 0.6)
    elif name == 'codex':
        if st % 4 == 0: music.add(kick(110, 45, 0.3, 1.4), t, 0.5)
        music.add(hat(0.03, 9000), t, (0.13 if st % 4 == 2 else 0.07) * hum, -0.25)
        if st % 8 == 4: music.add(tick(3200, 0.03), t, 0.12, 0.3, 0.2)
        seq = [0, 12, 7, 12, 3, 12, 7, 15, 0, 12, 7, 12, 10, 12, 7, 3][st]
        music.add(blip(n2f(root + 36 + seq), 0.06), t, 0.12, 0.6 if st % 2 else -0.6, 0.2)
        music.add(bassn(n2f(root), S16 * 0.8, 1.0, 300), t, 0.3 if st % 4 != 3 else 0.0)
    elif name == 'machine':
        if KICK_M[st] == 'x': music.add(kick(140, 38, 0.55, 1.2), t, 0.72);
        if st == 8: music.add(snare(0.4), t, 0.5, 0, 0.45); music.add(taiko(60, 1.1), t, 0.55, 0, 0.5)
        if st % 2 == 0: music.add(np.tanh(bassn(n2f(root - 0), S16 * 1.8, 1.6, 520) * 2.5), t, 0.26)
        if st in (3, 6, 11, 14): music.add(metal(240 + 40 * (st % 3), 0.25, 0.6, 1.0, seed=st) * 0.6, t, 0.14, 0.5 if st % 2 else -0.5, 0.3)
        if st in (0, 2): music.add(brass(n2f(62 + (1 if st == 2 else 0)), S16 * 1.8, 0.8), t, 0.16, 0, 0.35)
        music.add(hat(0.025, 10000), t, 0.05 * hum, 0.2)
    elif name == 'low':
        if st in (0, 3): music.add(kick(70, 40, 0.3, 0.2), t, 0.34 if st == 0 else 0.22)
    elif name == 'mind':
        if st % 4 == 0: music.add(tick(2900, 0.03), t, 0.13, -0.3 if (st // 4) % 2 else 0.3, 0.8)
        if st % 8 == 6: rb = bell(n2f(74 + PENT[(bar + st) % 8]), 0.9)[::-1]; music.add(fade(rb, 0.05, 0.01), t - 0.9, 0.09, 0.2, 0.7)
    elif name == 'exec':
        music.add(hat(0.025, 9500), t, (0.12 if st % 4 == 0 else 0.06) * hum, -0.2); music.add(hat(0.02, 11000), t + S16 / 2, 0.04, 0.3)
        seq = [0, 7, 12, 7, 15, 12, 7, 12][st % 8]; music.add(blip(n2f(74 + seq), 0.04), t, 0.05, 0.5 if st % 2 else -0.5, 0.25)
        if st % 8 == 0: music.add(kick(100, 42, 0.3, 1.2), t, 0.36)
    elif name == 'charge':
        u = (t - M['charge']) / (M['fire'] - M['charge'])
        music.add(snare(0.12), t, 0.06 + 0.3 * u ** 2, 0.1, 0.3)
        if u > 0.5: music.add(snare(0.1), t + S16 / 2, 0.05 + 0.25 * u ** 2, -0.1, 0.3)
        if st % 4 == 0: music.add(taiko(66 + 20 * u, 0.7), t, 0.3 + 0.35 * u, 0, 0.4)
        music.add(bell(n2f(tri_[st % 3] + 24), 0.5), t, 0.05 + 0.05 * u, -0.5, 0.5); music.add(blip(n2f(74 + 12 * int(u * 2) + [0, 7][st % 2]), 0.04), t, 0.04 + 0.04 * u, 0.5, 0.2)
    elif name == 'after':
        pass

# ---- melodies
def theme(t0, t1, gain=0.3):
    k0 = int(np.ceil(t0 / BEAT)); k = k0
    pat = [(0, 2, 0), (2, 1, 1), (3, 1, 2), (4, 3, 3), (7, 1, 2)]  # (beat, len, degree) per slot
    while k * BEAT < t1:
        slot = int(k * BEAT / SLOT); root, tri_, _ = CH[slot % 4]; b = k - slot * 8
        for bt, ln, deg in pat:
            if abs(bt - b) < 1e-6:
                nn = [tri_[0] + 12, tri_[1] + 12, tri_[2] + 12, tri_[0] + 24][deg]; d = min(ln * BEAT, t1 - k * BEAT)
                if d > 0.1: music.add(brass(n2f(nn), d), k * BEAT, gain, -0.1, 0.4); music.add(brass(n2f(nn - 12), d, 0.8), k * BEAT, gain * 0.7, 0.15, 0.35)
        k += 1
theme(M['planExec'] + 0.2, M['execution'] - 0.3, 0.4); theme(M['fire'], M['detonate'] - 0.2, 0.44)
# opening statement
music.add(braam((26, 38, 45), 3.2), 0.34, 0.5, 0, 0.5)
# aftermath dialogue: bell (Claude) answered by blips (Codex)
ta = M['after']
for j, (dt, nn) in enumerate([(0.5, 74), (0.95, 81), (1.4, 77)]): music.add(bell(n2f(nn), 2.4), ta + dt, 0.2, -0.45, 0.8)
for j, (dt, nn) in enumerate([(1.95, 86), (2.07, 81), (2.19, 86)]): music.add(blip(n2f(nn), 0.09, False), ta + dt, 0.11, 0.45, 0.6)
# transitions: risers into the big section changes, booms on arrival
for key, d, g in [('critique', 0.9, 0.2), ('control', 1.2, 0.3), ('planExec', 1.6, 0.42), ('execution', 0.8, 0.2), ('fire', 1.9, 0.5), ('end', 0.42, 0.35)]:
    music.add(riser(d), M[key] - d, g, 0, 0.3)
music.add(riser(3.0, 240, 2600), M['detonate'] - 3.0, 0.3, 0, 0.3)
for key, g in [('designStart', 0.25), ('control', 0.4), ('planExec', 0.5), ('fire', 0.5)]:
    music.add(boom(2.2), M[key], g, 0, 0.5)
music.add(braam((26, 38, 45), 3.0), M['control'], 0.42, 0, 0.5); music.add(braam((26, 38, 50), 2.6), M['fire'], 0.42, 0, 0.5); music.add(braam((26, 33, 38), 2.4), M['planExec'], 0.3, 0, 0.5)
# reversed swell into the cold open so frame 0 already carries energy
music.add(riser(0.33, 300, 2400), 0.0, 0.35, 0, 0.2)
for j in range(5): music.add(taiko(70 + j * 6, 0.3), 0.02 + j * 0.065, 0.2 + j * 0.07, 0.0, 0.3)

# ----------------------------------------------------------------------------- SFX from cues
def ev_span(e): return max(0.05, (e.get('tEnd') or e['t']) - e['t'])
G = {}
def reg(*names):
    def deco(f):
        for n in names: G[n] = f
        return f
    return deco
A = lambda e, x, g=1.0, rev=0.2, dt=0.0, pan=None: sfx.add(x, e['t'] + dt, g, e.get('x', 0) * 0.75 if pan is None else pan, rev)

@reg('clash')
def _(e): p = e.get('p', 1.0); A(e, metal(640 + rng.uniform(-90, 90), 0.9, 0.95, 1.0, seed=int(e['t'] * 100)), 0.42 * p, 0.35); A(e, punch(0.25, 0.6), 0.25 * p, 0.1)
@reg('clash_big')
def _(e): A(e, metal(520, 1.8, 1.0, 2.0, seed=1), 0.62, 0.5); A(e, metal(1310, 1.2, 0.9, 1.0, seed=2), 0.3, 0.5); A(e, boom(2.0, 55), 0.7, 0.4); A(e, punch(0.5, 1.2), 0.5, 0.2)
@reg('clash_gold')
def _(e): A(e, metal(430, 1.2, 0.85, 1.6, seed=3), 0.45, 0.4); A(e, shatter(0.8, 40, 1800, 7000, seed=3), 0.22, 0.4)
@reg('shield_hit')
def _(e): A(e, metal(880 + rng.uniform(-60, 120), 0.7, 0.8, 1.0, seed=int(e['t'] * 50)), 0.2, 0.5); A(e, bell(n2f(86), 0.6), 0.1, 0.5)
@reg('hammer')
def _(e): A(e, boom(2.6, 46, 2.2), 0.95, 0.5); A(e, metal(210, 2.0, 0.9, 2.4, seed=6), 0.6, 0.5); A(e, punch(0.6, 1.5), 0.6, 0.2); A(e, bell(n2f(50), 2.0), 0.2, 0.6)
@reg('hit')
def _(e): A(e, punch(0.45, 1.0), 0.6, 0.2); A(e, metal(380, 0.4, 0.6, 1.0, seed=8), 0.16, 0.3)
@reg('hit_small')
def _(e): A(e, punch(0.3, 0.7), 0.4, 0.2); A(e, metal(900, 0.3, 0.7, 1.0, seed=9), 0.12, 0.3)
@reg('hit_big')
def _(e): A(e, punch(0.7, 1.6), 0.8, 0.25); A(e, boom(1.8, 50, 2.0), 0.7, 0.4); A(e, metal(300, 0.8, 0.7, 1.5, seed=10), 0.25, 0.4); A(e, hp(noise(0.03), 2000) * expenv(0.03, 0.005), 0.5, 0.2)
@reg('land')
def _(e): A(e, punch(0.25, 0.6), 0.22, 0.15)
@reg('land_hard')
def _(e): A(e, punch(0.5, 1.2), 0.5, 0.25); A(e, lp(noise(0.4), 500) * expenv(0.4, 0.1), 0.3, 0.2)
@reg('slide')
def _(e): A(e, bp(noise(0.5), 1200, 6000) * expenv(0.5, 0.16, 0.02), 0.09, 0.15)
@reg('dash', 'dodge', 'exec_dash', 'final_dash')
def _(e):
    A(e, zip_(0.14), 0.3, 0.2); A(e, whoosh(0.2, 800, 5000), 0.2, 0.2)
    if e['name'] == 'exec_dash': A(e, kick(150, 45, 0.3, 1.5), 0.6, 0.1, pan=0); A(e, blip(n2f(86 + 2 * e.get('n', 0)), 0.05), 0.12, 0.3)
    if e['name'] == 'final_dash': A(e, whoosh(0.4, 300, 3000, 0.3, 300, 1500), 0.4, 0.3, pan=0)
@reg('dash_big')
def _(e): A(e, zip_(0.22, 6000, 500), 0.42, 0.3); A(e, whoosh(0.35, 500, 4500, 0.2, 2000, 300), 0.35, 0.3)
@reg('dash_c', 'jump', 'spring', 'heave', 'throw', 'whoosh_in')
def _(e): d = 0.5 if e['name'] in ('heave', 'whoosh_in') else 0.28; A(e, whoosh(d, 260, 2200, 0.12, 500, 900), 0.24 if e['name'] != 'whoosh_in' else 0.4, 0.25)
@reg('swing_c')
def _(e): A(e, whoosh(0.24, 350, 2800, 0.1, 1400, 700), 0.26, 0.25); A(e, bell(n2f(84 + int(rng.integers(0, 4)) * 2), 0.4), 0.035, 0.5)
@reg('swing_x')
def _(e): A(e, whoosh(0.1, 1500, 7000), 0.26, 0.15); A(e, zip_(0.08, 7000, 2500), 0.14, 0.15)
@reg('swing_heavy')
def _(e): A(e, whoosh(0.45, 150, 1400, 0.25, 200, 90), 0.5, 0.3)
@reg('glaive')
def _(e): A(e, whoosh(0.5, 400, 3200, 0.25, 700, 1900), 0.22, 0.35); A(e, bell(n2f(79), 0.5), 0.05, 0.5)
@reg('glaive_stick')
def _(e): A(e, metal(760, 0.5, 0.8, 1.2, seed=12), 0.3, 0.35); A(e, punch(0.2, 0.5), 0.25, 0.1)
@reg('cut')
def _(e):
    if e.get('x') is None: return  # camera cuts share the name: silent
    A(e, metal(1500, 0.35, 0.9, 1.0, seed=13), 0.24, 0.3); A(e, shatter(0.5, 22, 2500, 8000, seed=int(e['t'] * 10)), 0.2, 0.35)
@reg('cut_big')
def _(e): A(e, metal(1900, 0.9, 1.0, 1.0, seed=14), 0.4, 0.5); A(e, hp(noise(0.02), 4000) * expenv(0.02, 0.003), 0.7, 0.2); A(e, punch(0.4, 1.0), 0.4, 0.2)
@reg('bolt')
def _(e): A(e, pew(), 0.3, 0.2)
@reg('chime')
def _(e): A(e, bell(n2f(74 + PENT[e.get('n', 0) % 8]), 1.4), 0.17, 0.6)
@reg('build')
def _(e):
    n = e.get('n', 12); d = ev_span(e)
    for k in range(n): sfx.add(bell(n2f(62 + PENT[k % 8] + 12 * (k // 8)), 0.9), e['t'] + 0.05 + k * d / n, 0.11, -0.4 + 0.5 * k / n, 0.6); sfx.add(tick(2000 + 150 * k, 0.03), e['t'] + 0.05 + k * d / n, 0.05, -0.2, 0.3)
    A(e, hp(noise(d), 5000) * hann(d), 0.05, 0.4)
@reg('halo')
def _(e): A(e, choir([n2f(62), n2f(69), n2f(74)], 1.0, 0.35, 0.5), 0.2, 0.6); A(e, shimmer(0.35, 74), 0.1, 0.6, 0.15)
@reg('shield_up', 'mirror', 'morph')
def _(e): A(e, shimmer(0.12, 76 if e['name'] != 'morph' else 69, True, 4), 0.2, 0.5); A(e, whoosh(0.15, 1500, 6000), 0.1, 0.3)
@reg('reflect')
def _(e): A(e, bell(n2f(93), 0.7), 0.2, 0.6); A(e, pew(0.16), 0.22, 0.3)
@reg('analyze')
def _(e):
    for k, f in enumerate((2400, 1900, 2900)): sfx.add(blip(f, 0.05, False), e['t'] + k * 0.07, 0.12, e.get('x', 0) * 0.7, 0.3)
    A(e, lp(supersaw(n2f(38), 0.9, 3, 0.02), 300) * hann(0.9), 0.25, 0.2)
@reg('scan')
def _(e):
    d = ev_span(e); A(e, np.sin(gliss(d, 500, 2600, 0.8)) * hann(d) * (0.6 + 0.4 * np.sin(2 * np.pi * 31 * T(d))), 0.11, 0.4)
    A(e, hp(noise(d), 6000) * hann(d), 0.05, 0.3)
    for k in range(int(d / 0.05)): sfx.add(blip(float(rng.choice([1800, 2400, 3200, 4200])), 0.025, True), e['t'] + k * 0.05 + rng.uniform(0, 0.02), 0.035, rng.uniform(-0.6, 0.6), 0.2)
@reg('lock', 'acquire')
def _(e): A(e, beep2(1700 + 200 * e.get('n', 0), 2300 + 200 * e.get('n', 0)), 0.2, 0.3); (e['name'] == 'acquire') and A(e, bp(noise(0.12), 200, 900) * expenv(0.12, 0.03), 0.25, 0.2)
@reg('crack')
def _(e): A(e, shatter(0.4, 14, 3000, 9000, seed=20 + e.get('n', 0)), 0.3, 0.4); A(e, metal(1100, 0.3, 0.8, 1.0, seed=21), 0.2, 0.3)
@reg('shatter')
def _(e): A(e, shatter(1.8, 110, 1800, 9500, seed=int(e['t'])), 0.5, 0.5); A(e, boom(1.4, 60), 0.4, 0.3); A(e, metal(700, 0.8, 0.9, 1.2, seed=22), 0.2, 0.4)
@reg('shatter_small', 'weapon_break')
def _(e): A(e, shatter(0.8, 40, 2400, 9000, seed=int(e['t'] * 3)), 0.32, 0.45)
@reg('explode')
def _(e): A(e, boom(1.6, 58), 0.6, 0.4); A(e, shatter(1.0, 50, 2000, 8000, seed=int(e['t'] * 7)), 0.3, 0.4); A(e, bp(noise(0.5), 300, 3000) * expenv(0.5, 0.1), 0.4, 0.3)
@reg('slowmo_in', 'plan_in')
def _(e):
    d = 0.3 if e.get('short') else 0.7
    A(e, np.sin(gliss(d, 520, 55, 0.5)) * expenv(d, d / 2.5, 0.01), 0.35, 0.4, pan=0); A(e, lp(noise(d), 700) * hann(d), 0.25, 0.4, pan=0)
    if e['name'] == 'plan_in': A(e, bell(n2f(62), 3.0), 0.2, 0.9, pan=0); A(e, boom(2.0, 40, 1.2), 0.4, 0.5, pan=0)
@reg('slowmo_out', 'plan_out')
def _(e): d = 0.25; A(e, whoosh(d, 300, 5000, 0.3, 120, 900), 0.35, 0.3, dt=-d, pan=0)
@reg('grind')
def _(e): d = ev_span(e); t = T(d); x = bp(noise(d), 1800, 7000) * (0.5 + 0.5 * np.abs(np.sin(2 * np.pi * 47 * t))) + np.sin(2 * np.pi * 2400 * t + 3 * np.sin(2 * np.pi * 90 * t)) * 0.25; A(e, fade(x, 0.03, 0.08), 0.13, 0.3)
@reg('rise', 'descend')
def _(e): up = e['name'] == 'rise'; A(e, lp(saw(gliss(0.8, 70 if up else 160, 160 if up else 70)), 600) * hann(0.8), 0.22, 0.3)
@reg('takeover')
def _(e):
    d = 1.3; t = T(d); A(e, np.tanh(lp(saw(gliss(d, 48, 62)) * (0.6 + 0.4 * sq(2 * np.pi * 16 * t)), 500, 4) * 3) * hann(d), 0.4, 0.3, pan=0)
    for k in range(8): sfx.add(blip(n2f(62 + [0, 3, 7, 10][k % 4] + 12 * (k // 4)), 0.05), e['t'] + 0.15 + k * 0.07, 0.11, -0.5 + k / 7, 0.3)
@reg('pillar')
def _(e): A(e, thunk(), 0.5, 0.3); A(e, lp(noise(0.3), 300) * expenv(0.3, 0.07), 0.3, 0.2)
@reg('tbeam')
def _(e): d = ev_span(e) + 0.05; A(e, laser(d), 0.26, 0.3)
@reg('target_all')
def _(e):
    t = 0.0; k = 0
    while t < 0.55: sfx.add(blip(1800 + 120 * k, 0.03, False), e['t'] + t, 0.1, rng.uniform(-0.6, 0.6), 0.3); t += max(0.03, 0.11 - 0.012 * k); k += 1
@reg('breath')
def _(e): A(e, bp(noise(0.5), 500, 2500) * hann(0.5) ** 2, 0.1, 0.5)
@reg('ghost')
def _(e): A(e, fade(bell(n2f(81 + int(rng.integers(0, 3)) * 2), 0.8)[::-1], 0.05, 0.01), 0.13, 0.8, dt=-0.5)
@reg('plan_fail')
def _(e): A(e, lp(sq(gliss(0.18, 420, 180)), 1800) * expenv(0.18, 0.06), 0.16, 0.6); A(e, shatter(0.3, 10, 1500, 4000, seed=40 + e.get('n', 0)), 0.1, 0.6)
@reg('plan_ok')
def _(e):
    for nn in (74, 78, 81, 86): A(e, bell(n2f(nn), 2.2), 0.14, 0.8, pan=0)
@reg('power_down')
def _(e): d = 0.8; t = T(d); A(e, lp(saw(gliss(d, 520, 38, 0.7)), 2400) * (0.5 + 0.5 * sq(2 * np.pi * 22 * t)) * expenv(d, 0.4, 0.01), 0.35, 0.3, pan=0)
@reg('whip')
def _(e): A(e, whoosh(0.2, 900, 6000, 0.2, 400, 2400), 0.3, 0.3)
@reg('whip_crack')
def _(e): A(e, hp(noise(0.05), 2500) * expenv(0.05, 0.006, 0.0003), 0.6, 0.45); A(e, bell(n2f(88), 0.4), 0.1, 0.5)
@reg('spinup')
def _(e): d = ev_span(e) + 0.4; t = T(d); A(e, lp(saw(gliss(d, 60, 900, 1.8)) * (0.6 + 0.4 * np.sin(gliss(d, 8, 60))), 3000) * (t / d) ** 1.5, 0.22, 0.3)
@reg('condense')
def _(e): A(e, whoosh(0.25, 4000, 600), 0.2, 0.3, dt=-0.2); A(e, tick(4200, 0.04), 0.3, 0.3); A(e, np.sin(2 * np.pi * 3136 * T(0.9)) * expenv(0.9, 0.25, 0.002), 0.08, 0.6)
@reg('cage_build')
def _(e):
    for k in range(10): sfx.add(tick(1500 + 180 * k, 0.03), e['t'] + 0.02 * k, 0.12, 0.1, 0.4); sfx.add(bell(n2f(74 + PENT[k % 8]), 0.5), e['t'] + 0.02 * k, 0.07, 0.1, 0.6)
@reg('cage_shut')
def _(e): A(e, metal(260, 1.4, 0.85, 1.8, seed=50), 0.5, 0.5); A(e, punch(0.3, 0.8), 0.3, 0.2)
@reg('charge_c')
def _(e):
    d = ev_span(e); u = T(d) / d; A(e, choir([n2f(n) for n in (62, 69, 74, 77)], d, d * 0.9, 0.05) * u, 0.3, 0.6)
    for k in range(int(d / 0.09)): sfx.add(bell(n2f(74 + PENT[k % 8] + 12 * (k // 12)), 0.4), e['t'] + k * 0.09, 0.03 + 0.05 * k * 0.09 / d, e['x'] * 0.7, 0.6)
@reg('charge_x')
def _(e):
    d = ev_span(e); t = 0.0; k = 0
    while t < d: u = t / d; sfx.add(blip(600 + 2400 * u ** 2, 0.03, False), e['t'] + t, 0.06 + 0.1 * u, e['x'] * 0.7, 0.3); t += 0.11 - 0.085 * u; k += 1
    A(e, np.sin(gliss(d, 300, 3000, 2.0)) * (T(d) / d) ** 2, 0.1, 0.4)
@reg('fire')
def _(e): A(e, boom(2.4, 48, 2.2), 0.9, 0.5); A(e, pew(0.3), 0.35, 0.4, pan=0.5); A(e, shimmer(0.15, 62), 0.3, 0.6, pan=-0.5); A(e, bp(noise(0.6), 200, 4000) * expenv(0.6, 0.12), 0.45, 0.4)
@reg('beam_clash')
def _(e):
    d = ev_span(e); t = T(d); u = t / d
    roar = np.tanh(lp(supersaw(55, d, 7, 0.03) + supersaw(82.4, d, 5, 0.03) * 0.6, 900, 2) * 2.5) * (0.7 + 0.3 * np.sin(2 * np.pi * 11 * t))
    hiss = bp(noise(d), 1500, 8000) * (0.6 + 0.4 * np.sin(2 * np.pi * 53 * t)); thin = np.sin(2 * np.pi * 2637 * t + 2 * np.sin(2 * np.pi * 67 * t)) * 0.4
    warm = lp(supersaw(146.8, d, 5, 0.012), 1400) * (0.8 + 0.2 * np.sin(2 * np.pi * 6 * t))
    env = fade(0.55 + 0.45 * u, 0.03, 0.02)
    sfx.add(roar * env, e['t'], 0.26, 0, 0.3); sfx.add(hiss * env, e['t'], 0.09, 0, 0.3); sfx.add(thin * env, e['t'], 0.06, 0.55, 0.3); sfx.add(warm * env, e['t'], 0.16, -0.55, 0.3)
    A(e, metal(480, 1.6, 1.0, 2.2, seed=60), 0.6, 0.5); A(e, boom(2.0, 50), 0.7, 0.4)
@reg('adapt_c')
def _(e):
    for nn in (62, 69, 74, 78): A(e, bell(n2f(nn), 1.6), 0.13, 0.7)
    A(e, whoosh(0.4, 300, 3000, 0.2, 300, 900), 0.3, 0.3)
@reg('adapt_x')
def _(e):
    for k in range(6): sfx.add(blip(2000 + 500 * k, 0.035, False), e['t'] + k * 0.04, 0.12, 0.5, 0.3)
    A(e, zip_(0.2, 2000, 7000), 0.25, 0.3)
@reg('unstable')
def _(e): d = ev_span(e); t = T(d); A(e, (np.sin(gliss(d, 200, 2400, 1.5)) * 0.4 + bp(noise(d), 500, 6000) * 0.6) * (0.5 + 0.5 * sq(gliss(d, 14, 40))) * (t / d) ** 1.3, 0.3, 0.4, pan=0)
@reg('detonate')
def _(e):
    A(e, boom(4.0, 38, 2.6), 1.25, 0.6, pan=0); A(e, boom(2.5, 70, 2.0), 0.7, 0.5, pan=0); A(e, lp(noise(2.6), 5000) * expenv(2.6, 0.5, 0.002), 0.55, 0.6, pan=0)
    A(e, shatter(2.6, 160, 1500, 9000, seed=99), 0.4, 0.6, pan=0); A(e, np.sin(2 * np.pi * 3520 * T(3.2)) * expenv(3.2, 1.1, 0.3), 0.035, 0.3, pan=0)
    A(e, metal(180, 3.0, 0.9, 2.6, seed=77), 0.5, 0.6, pan=0)
@reg('aftermath')
def _(e):
    d = ev_span(e); A(e, lp(noise(d), 400) * hann(d) * (0.7 + 0.3 * np.sin(2 * np.pi * 0.7 * T(d))), 0.2, 0.3, pan=0)
    for k in range(26): tt = rng.uniform(0.1, d); sfx.add(np.sin(2 * np.pi * rng.uniform(2500, 7000) * T(0.2)) * expenv(0.2, 0.04, 0.001), e['t'] + tt, rng.uniform(0.015, 0.05), rng.uniform(-0.8, 0.8), 0.6)
@reg('nod_x')
def _(e): A(e, beep2(1500, 1900, 0.06), 0.1, 0.5)
@reg('nod_c')
def _(e): A(e, bell(n2f(81), 1.2), 0.12, 0.7)
@reg('final_clash')
def _(e): A(e, metal(520, 2.4, 1.0, 2.4, seed=1), 0.75, 0.9, pan=0); A(e, metal(1310, 1.6, 0.9, 1.0, seed=2), 0.3, 0.9, pan=0); A(e, boom(1.6, 50, 2.4), 0.9, 0.6, pan=0); A(e, punch(0.5, 1.4), 0.6, 0.3, pan=0)

missing = set()
for e in C['events']:
    f = G.get(e['name'])
    if f is None: missing.add(e['name']); continue
    f(e)
if missing: print('no generator for:', sorted(missing))

# ----------------------------------------------------------------------------- mix
ir_m, ir_s = make_ir(3.0, 4500, 3), make_ir(2.2, 6500, 5)
mus = music.d + reverb(music.rev, ir_m) * 0.9
fxm = sfx.d + reverb(sfx.rev, ir_s) * 0.8
t = np.arange(N) / SR
def win(a, b, ra=0.06, rb=0.12): return np.clip((t - a) / ra, 0, 1) * np.clip((b - t) / rb, 0, 1)
ev = {n: [e for e in C['events'] if e['name'] == n] for n in ('slowmo_in', 'slowmo_out', 'plan_in', 'plan_out', 'detonate', 'hit_big', 'clash_big', 'hammer', 'shatter', 'fire', 'cut_big')}
# slow-motion: music goes "under water" and drops back
under = np.zeros(N)
outs = sorted([e['t'] for e in ev['slowmo_out'] + ev['plan_out']])
for e in ev['slowmo_in'] + ev['plan_in']:
    b = next((o for o in outs if o > e['t']), e['t'] + 0.5)
    if e.get('short'): b = e['t'] + 0.45
    under = np.maximum(under, win(e['t'], b, 0.05, 0.1))
under = np.maximum(under, win(M['detonate'], M['after'] + 0.4, 0.02, 0.8))
mus_lp = np.stack([lp(mus[:, c], 420, 2) for c in range(2)], 1)
mus = mus * (1 - under[:, None]) + mus_lp * under[:, None] * 0.8
# duck music under the biggest impacts
duck = np.ones(N)
for n in ('hit_big', 'clash_big', 'hammer', 'shatter', 'fire', 'cut_big', 'detonate'):
    for e in ev[n]:
        i = int(e['t'] * SR); L = int(0.45 * SR); seg = 1 - 0.55 * np.exp(-np.arange(L) / (0.14 * SR)); duck[i:i + L] = np.minimum(duck[i:i + L], seg[:max(0, N - i)])
mus *= duck[:, None]
# silence after the cut to black: only tails survive
gate = np.clip((M['end'] + 0.02 - t) / 0.02, 0, 1); mus *= gate[:, None]
mix = mus * 0.9 + fxm * 1.0
mix[:, 0] = hp(mix[:, 0], 36, 4); mix[:, 1] = hp(mix[:, 1], 36, 4)
_sl = signal.butter(4, 100, 'low', fs=SR, output='sos'); _sh = signal.butter(2, 3200, 'high', fs=SR, output='sos')
for c in range(2):  # zero-phase shelving: tame the sub region, open the top
    low = signal.sosfiltfilt(_sl, mix[:, c]); mix[:, c] = (mix[:, c] - low) + 0.5 * low + 0.35 * signal.sosfiltfilt(_sh, mix[:, c])
# glue + limiter
rms = np.sqrt(np.mean(mix ** 2)); mix *= 0.125 / rms
mix = np.tanh(mix * 1.5) / np.tanh(1.5)
mix *= 0.97 / np.abs(mix).max()
tail = np.clip((DUR - t) / 0.15, 0, 1); mix *= tail[:, None]
wavfile.write(os.path.join(HERE, 'soundtrack.wav'), SR, (mix * 32767).astype(np.int16))
print('wrote soundtrack.wav  %.2fs  rms %.1f dBFS  peak %.2f' % (DUR, 20 * np.log10(np.sqrt(np.mean(mix ** 2))), np.abs(mix).max()))
