#!/bin/bash
# Mux the rendered picture with the synthesized soundtrack into the delivery file.
cd "$(dirname "$0")"; CRF=${1:-16}
ffmpeg -y -loglevel error -i out/tmp/video.mp4 -i audio/soundtrack.wav \
  -c:v libx264 -preset slow -crf $CRF -pix_fmt yuv420p -profile:v high -level 5.2 -r 60 -g 120 \
  -colorspace bt709 -color_primaries bt709 -color_trc bt709 \
  -c:a aac -b:a 320k -ar 48000 -shortest -movflags +faststart out/ai-battle-1440p60.mp4
ffprobe -v error -show_entries format=duration,size,bit_rate:stream=codec_name,width,height,r_frame_rate,sample_rate,channels -of default=nw=1 out/ai-battle-1440p60.mp4
