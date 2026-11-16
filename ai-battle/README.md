# AI Battle – Claude Fable vs. Codex Saul

Stilisierter 3D-Kurzfilm (2560×1440, 60 fps, ~44,5 s) über ein Duell zweier KI-Maskottchen.
Fertiges Video: [`out/ai-battle-1440p60.mp4`](out/ai-battle-1440p60.mp4)

Alles ist prozedural erzeugt – keine externen Assets, Samples oder Stock-Sounds:

| Teil | Datei | Inhalt |
|---|---|---|
| Arena | `src/arena.js` | Spiegelnder Hex-Boden (Reflector + eigener Shader), Holo-Terminals, Datenstadt, Pylonen, Kolben |
| Figuren | `src/mascots.js` | Beide Mascots inkl. Rig: Federn für Hände/Kopf, Lean, Squash & Stretch, Augen-Mimik, Waffenformen |
| VFX | `src/vfx.js` | Funken, Splitter, Schockwellen, Strahlen, Bolzen, Schwertspuren, Kamera-Shake |
| Konstrukte | `src/constructs.js` | Aegis-Barriere, Käfig, Lotus, Linsenstapel, Scan-Ebene, Zielmarken, Peitsche |
| Film | `src/film.js` | Choreografie, Zeitlupe/Hit-Stop, 59 Kamera-Shots, Ereignisse und Audio-Cues |
| Ton | `audio/score.py` | Musik (D-Moll, 132 BPM) und Sounddesign, framegenau aus `audio/cues.json` |

## Neu rendern

Voraussetzungen: Node 22, Chromium + Playwright, Mesa (llvmpipe), Xvfb, ffmpeg, Python 3 mit numpy/scipy.

```bash
npm install
./render_all.sh                              # Bild: 2672 Frames in 1440p, ~35–45 min auf 4 Kernen
xvfb-run -a node render.mjs cues             # Audio-Cues exportieren
python3 audio/score.py                       # Soundtrack synthetisieren
./finalize.sh                                # Mux -> out/ai-battle-1440p60.mp4
./preview.sh /tmp/stills 0:2672:40 960 540   # schnelle Standbilder zur Kontrolle
```

Der Renderer ist deterministisch (fester Seed, feste Zeitschritte): Jeder Frame wird einzeln in
Chromium gezeichnet, per WebSocket als RGBA an Node übergeben und nach ffmpeg gepipt.

## Ablauf

1. Kalter Einstieg: Klingen prallen aufeinander
2. Tempo gegen Fluss: Codex' Zickzack-Angriff, Claudes Paraden und Konter
3. Design: Aegis-Barriere und Klingenfächer
4. Kritik: Scan, Schwachstellen-Marker, drei Präzisionsschüsse, die Barriere zerbricht
5. Tool-Kontrolle: Codex übernimmt Terminals und Bodenkolben
6. Planung: Claude simuliert drei Zugfolgen, zwei scheitern, die dritte wird ausgeführt
7. Kreativität und Kontext: Spiegel lenken Strahlen um, Hammer, Peitsche, geschleuderter Kolben
8. Execution: fünf gerade Linien, Claude liest das Muster und stellt den Käfig
9. Finale: breites Konstrukt gegen haarfeinen Strahl, Detonation, Patt
