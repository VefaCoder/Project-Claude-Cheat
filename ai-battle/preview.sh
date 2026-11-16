#!/bin/bash
# usage: preview.sh <outdir> <frames-spec> [w h]
cd "$(dirname "$0")"
LIBGL_ALWAYS_SOFTWARE=1 xvfb-run -a -s "-screen 0 1280x720x24" node render.mjs stills ${3:-960} ${4:-540} "$1" "$2" 2>&1 | grep -vE "^\s*$" | tr '\r' '\n' | grep -E "ERROR|Error|error|done|film:|at " | head -30
