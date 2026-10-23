#!/usr/bin/env bash
# Downloads the original Salamander Grand Piano V3 (48 kHz / 24 bit) into $1.
# Tries freepats.zenvoid.org first, then archive.org. Exits non-zero if neither works.
set -euo pipefail
dest="$1"
mkdir -p "$dest"
tmp="$(mktemp -d)"

try_url() {
  local url="$1"
  echo "Lade $url"
  curl -fL --retry 3 --retry-delay 5 --connect-timeout 30 -o "$tmp/pack" "$url" || return 1
  case "$url" in
    *.tar.xz) tar -xJf "$tmp/pack" -C "$dest" ;;
    *.tar.bz2) tar -xjf "$tmp/pack" -C "$dest" ;;
    *.tar.gz|*.tgz) tar -xzf "$tmp/pack" -C "$dest" ;;
    *.zip) unzip -q "$tmp/pack" -d "$dest" ;;
    *.7z) 7z x -o"$dest" "$tmp/pack" >/dev/null ;;
    *) return 1 ;;
  esac
  rm -f "$tmp/pack"
  local n
  n=$(find "$dest" -type f \( -name '*v16.flac' -o -name '*v16.wav' \) | wc -l)
  echo "gefundene v16-Samples: $n"
  [ "$n" -ge 30 ]
}

# 1) freepats: parse the download page for the 48 kHz / 24 bit archive
page="https://freepats.zenvoid.org/Piano/acoustic-grand-piano.html"
if html="$(curl -fsL --retry 3 "$page")"; then
  for pat in '48khz24bit' '44khz16bit'; do
    link="$(printf '%s' "$html" | grep -oE 'href="[^"]*SalamanderGrandPiano[^"]*'"$pat"'[^"]*\.(tar\.xz|tar\.bz2|zip|7z)"' | head -n1 | sed -E 's/^href="//; s/"$//')" || true
    if [ -n "$link" ]; then
      case "$link" in http*) url="$link" ;; /*) url="https://freepats.zenvoid.org$link" ;; *) url="https://freepats.zenvoid.org/Piano/$link" ;; esac
      if try_url "$url"; then echo "OK freepats ($pat)"; exit 0; fi
    fi
  done
fi

# 2) archive.org item
if meta="$(curl -fsL --retry 3 https://archive.org/metadata/SalamanderGrandPianoV3)"; then
  for pat in '48khz24bit' '48khz' '44'; do
    name="$(printf '%s' "$meta" | python3 -c "import json,sys; fs=[f['name'] for f in json.load(sys.stdin).get('files',[])]; print(next((f for f in fs if '$pat' in f.lower() and f.lower().endswith(('.tar.xz','.tar.bz2','.zip','.7z','.tar.gz'))), ''))")"
    if [ -n "$name" ] && try_url "https://archive.org/download/SalamanderGrandPianoV3/$name"; then echo "OK archive.org ($name)"; exit 0; fi
  done
fi

echo "Salamander-Originale nicht erreichbar" >&2
exit 1
