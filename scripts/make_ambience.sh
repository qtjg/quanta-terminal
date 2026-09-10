#!/usr/bin/env bash
# Synthesize a 30s seamless-looping "Tokyo night" ambience (no external assets):
# brown-noise city rumble + two slow-tremolo low sines (air hum).
# Frequencies chosen so every LFO completes an integer number of cycles in 30s
# => loop boundary is continuous (no click).
set -euo pipefail
OUT="/home/z/my-project/public/audio/tokyo-night.mp3"
mkdir -p "$(dirname "$OUT")"

ffmpeg -y \
  -f lavfi -i "anoisesrc=color=brown:sample_rate=44100:amplitude=0.6:seed=42" \
  -f lavfi -i "sine=frequency=110:sample_rate=44100" \
  -f lavfi -i "sine=frequency=165:sample_rate=44100" \
  -filter_complex "[0:a]lowpass=f=320,volume=0.35[rumble];\
[1:a]tremolo=f=0.1:d=0.85,volume=0.045[hum1];\
[2:a]tremolo=f=0.2:d=0.8,volume=0.028[hum2];\
[rumble][hum1][hum2]amix=inputs=3:duration=first:normalize=0,\
aformat=sample_rates=44100:channel_layouts=mono,volume=1.4,alimiter=limit=0.9" \
  -t 30 -b:a 96k "$OUT"

echo "done: $(du -h "$OUT" | cut -f1) -> $OUT"
