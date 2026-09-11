#!/usr/bin/env python3
"""Generate RizzReply PWA icons (192 + 512): amber rounded square, dark R."""
from PIL import Image, ImageDraw, ImageFont

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
BG = (13, 15, 18, 255)        # #0D0F12 dark
AMBER = (251, 191, 36, 255)   # #FBBF24 brand

for size in (192, 512):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    # Full-bleed rounded square (safe under maskable crop)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=AMBER)
    # Sparkle dot accent (top-right)
    r = int(size * 0.045)
    cx, cy = int(size * 0.76), int(size * 0.24)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=BG)
    # Big R
    font = ImageFont.truetype(FONT, int(size * 0.58))
    bbox = d.textbbox((0, 0), "R", font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((size - w) / 2 - bbox[0], (size - h) / 2 - bbox[1]), "R", font=font, fill=BG)
    out = f"/home/z/my-project/public/rizz/icon-{size}.png"
    img.save(out)
    print("wrote", out)
