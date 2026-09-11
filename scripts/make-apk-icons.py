#!/usr/bin/env python3
"""Launcher icons for the RizzReply Android app (all densities)."""
from PIL import Image, ImageDraw, ImageFont
import os

FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
AMBER = (251, 191, 36, 255)
DARK = (13, 15, 18, 255)
BASE = "/home/z/my-project/scripts/android-build/res"

DENSITIES = [
    ("mipmap-mdpi", 48),
    ("mipmap-hdpi", 72),
    ("mipmap-xhdpi", 96),
    ("mipmap-xxhdpi", 144),
    ("mipmap-xxxhdpi", 192),
]

for folder, size in DENSITIES:
    os.makedirs(f"{BASE}/{folder}", exist_ok=True)
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=int(size * 0.22), fill=AMBER)
    r = int(size * 0.045)
    cx, cy = int(size * 0.76), int(size * 0.24)
    d.ellipse([cx - r, cy - r, cx + r, cy + r], fill=DARK)
    font = ImageFont.truetype(FONT, int(size * 0.58))
    bbox = d.textbbox((0, 0), "R", font=font)
    w, h = bbox[2] - bbox[0], bbox[3] - bbox[1]
    d.text(((size - w) / 2 - bbox[0], (size - h) / 2 - bbox[1]), "R", font=font, fill=DARK)
    img.save(f"{BASE}/{folder}/ic_launcher.png")
    print("wrote", folder, size)
