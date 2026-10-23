# Pianola

Ein Klavier für den Mac, das von einer KI programmiert wird. Die Noten fallen als leuchtende Balken auf eine 88-Tasten-Klaviatur, gespielt wird mit einem echten, gesampelten Konzertflügel. Fertige Stücke lassen sich als 4K-Video exportieren.

- **Echter Flügelklang:** Salamander Grand Piano (Yamaha C5), alle 88 Tasten, 8 Anschlagstufen, Dämpfer, Pedal, Konzertsaal-Hall
- **PianoScript:** normales JavaScript plus kompakte Notenschrift. Jede KI (ChatGPT, Claude, Gemini) kann damit Stücke schreiben, von Kinderlied bis Chopin
- **4K-Export:** 3840 × 2160 oder Hochformat, 60 fps, HEVC, Ton unkomprimiert als 24 Bit / 48 kHz PCM
- Läuft komplett lokal und offline

## Installieren

Siehe [Release-Seite](https://github.com/VefaCoder/Project-Claude-Cheat/releases/latest). Schnellster Weg, im Terminal:

```
a=$([ "$(uname -m)" = arm64 ] && echo AppleSilicon || echo Intel); curl -fL -o /tmp/Pianola.zip "https://github.com/VefaCoder/Project-Claude-Cheat/releases/latest/download/Pianola-Mac-$a.zip" && rm -rf /Applications/Pianola.app && ditto -x -k /tmp/Pianola.zip /Applications && open /Applications/Pianola.app
```

## So entsteht ein Stück

1. **Mit KI erstellen** klicken, Stück eintragen (z. B. „Clair de Lune von Debussy“), **Prompt kopieren**.
2. Prompt in die KI einfügen und abschicken.
3. Antwort kopieren, in Pianola **Antwort einfügen**. Das Stück läuft sofort los.
4. Meldet Pianola Probleme (z. B. ein Takt ist zu lang), über **Korrektur für KI kopieren** zurück an die KI geben.
5. **Video exportieren**.

Ehrlicher Hinweis: Pianola spielt alles, was im Code steht. Ob die KI ein Stück auswendig richtig kennt, ist eine andere Frage. Bekannte Stücke klappen gut, lange oder seltene Werke enthalten oft Fehler.

## PianoScript in 30 Sekunden

```js
title("Beispiel"); tempo(84); meter(4, 4)
const rh = voice("Rechte Hand"), lh = voice("Linke Hand")
rh.play(`mf E5/4 D5 C5 D5 | E5/4 E5 E5/2 | p < D5/4 D5 E5 F5 | f G5/1 |`)
lh.play(`ped C3/8 G3 E4 G3 C3 G3 E4 G3 | ped [C2 C3]/1 * |`)
```

Tonhöhe `C4` (mittleres C), `F#3`, `Bb5` · Dauer `/4` Viertel, `/8.` punktiert, `/12` Triole · Akkord `[C4 E4 G4]/2` · Pause `r/8` · Bindebogen `C4/2~ C4/8` · Dynamik `p mf f` · Crescendo `<` · Pedal `ped` und `*` · Tempo `T=90`. Die komplette Referenz steckt in der App unter **Mit KI erstellen**.

## Entwickeln

```
npm install
npm run samples:dev     # Klaviersamples (Entwicklerkopie) aufbereiten, braucht python3 mit numpy und soundfile
npm test
npm run dev             # Electron starten
```

Die Mac-App baut GitHub Actions (`.github/workflows/pianola-mac.yml`) mit den Original-Samples in 48 kHz / 24 Bit.

## Lizenzen

Code: MIT. Klaviersamples: Salamander Grand Piano V3 von Alexander Holm, [CC BY 3.0](https://creativecommons.org/licenses/by/3.0/).
