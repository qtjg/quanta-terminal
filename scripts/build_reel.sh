#!/bin/bash
# Build japan-reel.mp4 — cinematic Ken Burns slideshow from downloaded stills
set -e
cd /home/z/my-project/scripts
mkdir -p reel_src
cd reel_src

# 8 stills for the reel (gallery + hero pool)
URLS=(
  "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/ef6dc890f671.jpg"
  "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/025a24a12421.png"
  "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/9cd2530d3e9f.jpg"
  "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/7e0f45a363ff.jpg"
  "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/6ce8e47c0eac.jpg"
  "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/eadd40c88df2.jpg"
  "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/d0999ab972b4.jpg"
  "https://z-cdn.chatglm.cn/image-search-mcp/images-ppt/2b80c36a4d3e.jpg"
)
i=1
for u in "${URLS[@]}"; do
  ext="${u##*.}"
  curl -sL "$u" -o "img$i.$ext"
  i=$((i+1))
done
ls -la

cd /home/z/my-project/scripts/reel_src
# Normalize all to numbered png-friendly jpg inputs
declare -a IN=()
for f in img1.* img2.* img3.* img4.* img5.* img6.* img7.* img8.*; do
  IN+=("$f")
done
echo "inputs: ${IN[@]}"

D=4      # segment seconds
FPS=24
OF="1920x1080"

# Build filter graph: Ken Burns per input + xfade chain + audio drone
FILTER=""
MAP=""
prev=""
for idx in 0 1 2 3 4 5 6 7; do
  n=$((idx+1))
  if [ $((idx % 2)) -eq 0 ]; then
    Z="zoom+0.0009"
  else
    Z="if(lte(zoom,1.0),1.16,max(1.0,zoom-0.0009))"
  fi
  FILTER+="[$idx:v]scale=2112:1188,zoompan=z='$Z':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':d=$((D*FPS)):s=${OF}:fps=${FPS},setsar=1[v$idx];"
done
# xfade chain with 1s crossfades
off=$D
for idx in 0 1 2 3 4 5 6; do
  a=$idx; b=$((idx+1)); out="x$idx"
  if [ $idx -eq 0 ]; then A="[v0]"; else A="[prev$((idx-1))]"; fi
  FILTER+="${A}[v$b]xfade=transition=fade:duration=1:offset=${off}[prev$idx];"
  off=$(awk "BEGIN{print $off + ($D - 1)}")
done
FILTER+="[prev6]format=yuv420p[vout];"
FILTER+="aevalsrc='0.055*sin(110*t)+0.045*sin(164.81*t)+0.035*sin(220*t)+0.02*sin(277.18*t)':s=44100:d=29,tremolo=f=0.13:d=0.35,lowpass=f=900,afade=t=in:st=0:d=3,afade=t=out:st=25:d=4[aout]"

TOTAL=$(awk "BEGIN{print 7*4 - 6*1}")  # 22s video
echo "total duration: $TOTAL"

ffmpeg -y \
  -loop 1 -t $D -i "${IN[0]}" \
  -loop 1 -t $D -i "${IN[1]}" \
  -loop 1 -t $D -i "${IN[2]}" \
  -loop 1 -t $D -i "${IN[3]}" \
  -loop 1 -t $D -i "${IN[4]}" \
  -loop 1 -t $D -i "${IN[5]}" \
  -loop 1 -t $D -i "${IN[6]}" \
  -loop 1 -t $D -i "${IN[7]}" \
  -filter_complex "$FILTER" \
  -map "[vout]" -map "[aout]" \
  -c:v libx264 -preset veryfast -crf 25 -profile:v high -level 4.0 \
  -c:a aac -b:a 128k -movflags +faststart -shortest \
  /home/z/my-project/public/videos/japan-reel.mp4

echo "=== output ==="
ls -la /home/z/my-project/public/videos/
ffprobe -v error -show_entries format=duration,size -of default=noprint_wrappers=1 /home/z/my-project/public/videos/japan-reel.mp4
