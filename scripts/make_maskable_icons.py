#!/usr/bin/env python3
"""Create Android maskable (adaptive) PWA icons from the existing brand icons.

Maskable spec: the icon must be full-bleed (its own background fills every
pixel — Android will crop it to any shape), and all meaningful content must
sit inside the safe zone: a centered circle of radius = 40% of the canvas.

We composite the existing full icon at 62% of the canvas onto a solid
brand-background (#0D0F12) square, which keeps the mark well inside the safe
zone while the background reaches every edge.
"""
from PIL import Image
from pathlib import Path

BG = (13, 15, 18, 255)  # #0D0F12 — same as manifest background_color
PUBLIC = Path("/home/z/my-project/public/icons")
SCALE = 0.62  # mark footprint vs canvas

def make_maskable(src: Path, out: Path, size: int) -> None:
    im = Image.open(src).convert("RGBA")
    # Fit the source (letterbox if non-square) onto a transparent square
    side = max(im.size)
    sq = Image.new("RGBA", (side, side), (0, 0, 0, 0))
    sq.paste(im, ((side - im.width) // 2, (side - im.height) // 2))

    canvas = Image.new("RGBA", (size, size), BG)
    inner = int(size * SCALE)
    mark = sq.resize((inner, inner), Image.LANCZOS)
    canvas.alpha_composite(mark, ((size - inner) // 2, (size - inner) // 2))
    canvas.convert("RGB").save(out, "PNG", optimize=True)
    print(f"wrote {out} ({size}x{size})")

make_maskable(PUBLIC / "icon-512.png", PUBLIC / "icon-512-maskable.png", 512)
make_maskable(PUBLIC / "icon-192.png", PUBLIC / "icon-192-maskable.png", 192)
