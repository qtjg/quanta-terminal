"""Generate apple-icon.png (180) + manifest icon PNGs (192/512) with a torii mark."""
from PIL import Image, ImageDraw

FLAME = (255, 87, 34, 255)
BG = (13, 15, 18, 255)


def torii(draw, s, ox=0, oy=0):
    """Draw a simple torii gate scaled to canvas size s."""
    # kasagi (top curved beam) — approximate with two stacked rounded bars
    kw = int(s * 0.80)
    kx = ox + (s - kw) // 2
    ky = oy + int(s * 0.24)
    draw.rounded_rectangle([kx, ky, kx + kw, ky + int(s * 0.035)], radius=int(s * 0.02), fill=FLAME)
    draw.rounded_rectangle(
        [kx + int(s * 0.03), ky + int(s * 0.045), kx + kw - int(s * 0.03), ky + int(s * 0.085)],
        radius=int(s * 0.015),
        fill=FLAME,
    )
    # nuki (second beam)
    ny = oy + int(s * 0.46)
    draw.rounded_rectangle(
        [kx + int(s * 0.07), ny, kx + kw - int(s * 0.07), ny + int(s * 0.05)],
        radius=int(s * 0.012),
        fill=FLAME,
    )
    # pillars
    pw = int(s * 0.075)
    ph = int(s * 0.50)
    py = oy + int(s * 0.28)
    px1 = ox + int(s * 0.22)
    px2 = ox + s - int(s * 0.22) - pw
    draw.rectangle([px1, py, px1 + pw, py + ph], fill=FLAME)
    draw.rectangle([px2, py, px2 + pw, py + ph], fill=FLAME)
    # centre strut
    cx = ox + s // 2 - int(s * 0.03)
    draw.rectangle([cx, ky + int(s * 0.09), cx + int(s * 0.06), ny], fill=FLAME)


for size, path in [(180, "src/app/apple-icon.png"), (192, "public/icons/icon-192.png"), (512, "public/icons/icon-512.png")]:
    img = Image.new("RGBA", (size, size), BG)
    d = ImageDraw.Draw(img)
    torii(d, size)
    img.save(path)
    print(f"wrote {path} ({size}x{size})")
