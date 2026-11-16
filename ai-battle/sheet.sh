#!/bin/bash
# usage: sheet.sh <dir> [cols rows tilew]
d=$1; c=${2:-4}; r=${3:-5}; w=${4:-480}
rm -f $d/sheet_*.jpg
ffmpeg -y -loglevel error -start_number 0 -i $d/f_%04d.png -vf "scale=$w:-1,drawtext=text='%{n}':x=6:y=6:fontsize=18:fontcolor=white:box=1:boxcolor=black@0.5,tile=${c}x${r}" -q:v 3 $d/sheet_%02d.jpg
ls $d/sheet_*.jpg
