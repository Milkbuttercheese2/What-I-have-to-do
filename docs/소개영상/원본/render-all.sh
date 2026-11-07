#!/usr/bin/env bash
# 영상을 조각으로 병렬 렌더한 뒤 이어 붙이고 음성을 합친다.
set -e
TOTAL=$(node -p "Math.ceil(JSON.parse(require('fs').readFileSync('cues.json')).TOTAL*60)")
WORKERS=4
mkdir -p seg; rm -f seg/*.mp4 seg.txt
STEP=$(( TOTAL / WORKERS + 1 ))
pids=()
for ((i=0;i<WORKERS;i++)); do
  A=$(( i*STEP + 1 )); B=$(( A+STEP )); [ $B -gt $((TOTAL+1)) ] && B=$((TOTAL+1))
  node render.mjs $A $B seg/$i.mp4 > seg/$i.log 2>&1 &
  pids+=($!)
  echo "file 'seg/$i.mp4'" >> seg.txt
done
for p in "${pids[@]}"; do wait $p; done
cat seg/*.log
ffmpeg -y -loglevel error -f concat -safe 0 -i seg.txt -c copy master.mp4
ffmpeg -y -loglevel error -i master.mp4 -i final.wav -vf "scale=in_range=pc:out_range=tv:in_color_matrix=bt601:out_color_matrix=bt709:flags=lanczos,format=yuv420p" -c:v libx264 -preset slow -tune animation -crf 14 -colorspace bt709 -color_primaries bt709 -color_trc bt709 -color_range tv -c:a aac -b:a 192k -shortest -movflags +faststart clip.mp4
ffprobe -v error -show_entries stream=codec_type,width,height,nb_frames,duration -show_entries format=duration,size -of compact clip.mp4
