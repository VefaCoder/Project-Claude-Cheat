**Pianola**: KI-programmierbares Klavier mit Falling-Notes-Ansicht und 4K-Videoexport.

### Installieren (schnellster Weg)

Terminal öffnen, diese eine Zeile einfügen, Enter:

```
a=$([ "$(uname -m)" = arm64 ] && echo AppleSilicon || echo Intel); curl -fL -o /tmp/Pianola.zip "https://github.com/VefaCoder/Project-Claude-Cheat/releases/latest/download/Pianola-Mac-$a.zip" && rm -rf /Applications/Pianola.app && ditto -x -k /tmp/Pianola.zip /Applications && open /Applications/Pianola.app
```

### Oder per Hand

1. Passende ZIP unten laden: **AppleSilicon** (M1 bis M4 und neuer) oder **Intel**.
2. Entpacken, `Pianola.app` in den Ordner *Programme* ziehen.
3. Beim ersten Start meldet macOS, dass die App nicht geprüft werden kann (sie ist nicht bei Apple registriert). Dann: **Systemeinstellungen → Datenschutz & Sicherheit → „Dennoch öffnen“**. Das ist nur einmal nötig.

Klang: Salamander Grand Piano V3 (Yamaha C5) von Alexander Holm, CC BY 3.0.
