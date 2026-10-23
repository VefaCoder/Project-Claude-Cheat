#!/usr/bin/env python3
"""Builds the app's piano sample pack from the Salamander Grand Piano V3.

  --source salamander --dir <folder>   original 48 kHz / 24 bit release (FLAC or WAV), searched recursively
  --source dev-ogg                     the OGG copies published on npm (@audio-samples/*), for development

Writes <out>/index.json plus 16 bit FLAC files: trimmed to a consistent attack, faded tails, TPDF dither.
"""
import argparse, io, json, os, re, sys, tarfile, urllib.request
import numpy as np
import soundfile as sf

LAYERS = [2, 4, 6, 8, 10, 12, 14, 16]   # 8 of the 16 Salamander velocity layers, evenly spaced in loudness
ROOTS = list(range(21, 109, 3))          # A0, C1, D#1 ... C8: every minor third
NAMES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B']
SR = 48000
NPM = 'https://registry.npmjs.org/@audio-samples/{p}/-/{p}-1.0.5.tgz'


def note_name(midi):
    return f'{NAMES[midi % 12]}{midi // 12 - 1}'


def fetch_dev_ogg(cache):
    os.makedirs(cache, exist_ok=True)
    for p in [f'piano-velocity{v}' for v in LAYERS] + ['piano-release']:
        marker = os.path.join(cache, p + '.done')
        if os.path.exists(marker):
            continue
        print('download', p, flush=True)
        data = urllib.request.urlopen(NPM.format(p=p)).read()
        with tarfile.open(fileobj=io.BytesIO(data)) as tar:
            for m in tar.getmembers():
                if m.isfile() and m.name.endswith('.ogg'):
                    with open(os.path.join(cache, os.path.basename(m.name)), 'wb') as f:
                        f.write(tar.extractfile(m).read())
        open(marker, 'w').close()
    return cache


def index_files(root):
    notes, rel = {}, {}
    for d, _, files in os.walk(root):
        for f in files:
            m = re.match(r'^([A-G]#?)(\d)v(\d+)\.(flac|wav|ogg)$', f)
            if m:
                midi = NAMES.index(m.group(1)) + 12 * (int(m.group(2)) + 1)
                notes[(midi, int(m.group(3)))] = os.path.join(d, f)
            m = re.match(r'^rel(\d+)\.(flac|wav|ogg)$', f)
            if m:
                rel[20 + int(m.group(1))] = os.path.join(d, f)
    return notes, rel


def load(path):
    x, sr = sf.read(path, dtype='float64', always_2d=True)
    if x.shape[1] == 1:
        x = np.repeat(x, 2, axis=1)
    x = x[:, :2]
    if sr != SR:
        from scipy.signal import resample_poly
        g = np.gcd(sr, SR)
        x = resample_poly(x, SR // g, sr // g, axis=0)
    return x


def shape(x, onset_db, end_db, pre_ms=1.5, fade_out_ms=120):
    a = np.abs(x).max(axis=1)
    peak = a.max()
    if peak <= 0:
        return x[:1] * 0
    on = int(np.argmax(a > peak * 10 ** (onset_db / 20)))
    start = max(0, on - int(SR * pre_ms / 1000))
    above = np.nonzero(a > peak * 10 ** (end_db / 20))[0]
    end = max(start + 64, int(above[-1]) + 1)
    y = x[start:end].copy()
    fi = min(48, len(y))
    y[:fi] *= (0.5 - 0.5 * np.cos(np.linspace(0, np.pi, fi)))[:, None]
    fo = min(int(SR * fade_out_ms / 1000), len(y) // 2)
    y[len(y) - fo:] *= (0.5 + 0.5 * np.cos(np.linspace(0, np.pi, fo)))[:, None]
    return y


def to16(y, rng):
    d = (rng.random(y.shape) - rng.random(y.shape))  # TPDF, +-1 LSB
    return np.clip(np.round(y * 32767 + d), -32768, 32767).astype(np.int16)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--source', choices=['salamander', 'dev-ogg'], required=True)
    ap.add_argument('--dir', help='Salamander folder (for --source salamander)')
    ap.add_argument('--out', required=True)
    ap.add_argument('--cache', default=os.path.join(os.path.dirname(__file__), '..', '.cache', 'dev-ogg'))
    args = ap.parse_args()

    src = args.dir if args.source == 'salamander' else fetch_dev_ogg(args.cache)
    notes, rel = index_files(src)
    missing = [(r, v) for r in ROOTS for v in LAYERS if (r, v) not in notes]
    if missing:
        sys.exit(f'missing samples: {missing[:5]} ... ({len(missing)})')

    os.makedirs(os.path.join(args.out, 's'), exist_ok=True)
    os.makedirs(os.path.join(args.out, 'r'), exist_ok=True)
    rng = np.random.default_rng(1234)
    out = {'version': 1, 'sampleRate': SR, 'roots': ROOTS, 'layers': LAYERS, 'notes': [], 'release': [],
           'source': 'Salamander Grand Piano V3, Alexander Holm, CC BY 3.0 (' + args.source + ')'}
    loud = {v: [] for v in LAYERS}
    for r in ROOTS:
        for li, v in enumerate(LAYERS):
            y = shape(load(notes[(r, v)]), onset_db=-40, end_db=-66)
            a = np.abs(y).max(axis=1)
            on = int(np.argmax(a > a.max() * 0.01))
            seg = y[on:on + int(0.3 * SR)]
            loud[v].append(10 * np.log10(np.mean(seg ** 2) + 1e-12))
            name = f's/{r}_{v}.flac'
            sf.write(os.path.join(args.out, name), to16(y, rng), SR, subtype='PCM_16')
            out['notes'].append({'root': r, 'layer': li, 'file': name, 'frames': len(y)})
        print('root', note_name(r), flush=True)
    for k in range(21, 109):
        if k not in rel:
            continue
        y = shape(load(rel[k]), onset_db=-30, end_db=-60, pre_ms=1, fade_out_ms=60)
        name = f'r/{k}.flac'
        sf.write(os.path.join(args.out, name), to16(y, rng), SR, subtype='PCM_16')
        out['release'].append({'key': k, 'file': name, 'frames': len(y)})
    out['layerDb'] = [round(float(np.median(loud[v])), 2) for v in LAYERS]
    with open(os.path.join(args.out, 'index.json'), 'w') as f:
        json.dump(out, f, indent=1)
    total = sum(n['frames'] for n in out['notes']) + sum(n['frames'] for n in out['release'])
    print(f"done: {len(out['notes'])} notes, {len(out['release'])} release, {total / SR:.0f} s audio, "
          f"{total * 4 / 1e6:.0f} MB in memory, layer dB {out['layerDb']}")


if __name__ == '__main__':
    main()
