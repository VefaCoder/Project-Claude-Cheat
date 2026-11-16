#!/bin/bash
# Full 2560x1440@60 render in resumable segments, then concat. usage: render_all.sh [segFrames]
cd "$(dirname "$0")"; SEG=${1:-334}; TOTAL=${TOTAL:-2672}; mkdir -p out/tmp/seg
export LIBGL_ALWAYS_SOFTWARE=1
for ((a=0; a<TOTAL; a+=SEG)); do
  b=$((a+SEG)); f=out/tmp/seg/seg_$(printf %05d $a).mp4
  if [ -f "$f.done" ]; then continue; fi
  xvfb-run -a -s "-screen 0 1280x720x24" node render.mjs video 2560 1440 $a $b "$f" > out/tmp/seg/log_$a.txt 2>&1 && touch "$f.done"
  echo "segment $a done $(date +%T)" >> out/tmp/progress.txt
done
ls out/tmp/seg/seg_*.mp4 | sed "s#^out/tmp/seg/#file '#; s#\$#'#" > out/tmp/seg/list.txt
ffmpeg -y -loglevel error -f concat -safe 0 -i out/tmp/seg/list.txt -c copy out/tmp/video.mp4 && echo "ALL DONE $(date +%T)" >> out/tmp/progress.txt
