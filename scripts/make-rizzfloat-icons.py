#!/usr/bin/env python3
"""RizzFloat APK icons — amber rounded square + dark R (matches RizzReply PWA brand)."""
from PIL import Image, ImageDraw, ImageFont
import os

OUT = "/home/z/my-project/android/RizzFloat/res"
FONT = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
AMBER = (245, 158, 11, 255)       # #F59E0B
AMBER_DARK = (120, 53, 15, 255)   # #78350F stroke
DARK = (28, 25, 23, 255)          # #1C1917

def rounded_square(size, radius_ratio=0.22, stroke=0):
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    r = int(size * radius_ratio)
    d.rounded_rectangle([0, 0, size - 1, size - 1], radius=r, fill=AMBER)
    if stroke:
        sw = max(2, int(size * stroke))
        d.rounded_rectangle([sw // 2, sw // 2, size - 1 - sw // 2, size - 1 - sw // 2],
                            radius=r, outline=AMBER_DARK, width=sw)
    return img

def draw_R(img, ratio=0.62):
    size = img.width
    d = ImageDraw.Draw(img)
    fsize = int(size * ratio)
    font = ImageFont.truetype(FONT, fsize)
    # small floating dot accent above-right of R (rizz dot)
    bbox = d.textbbox((0, 0), "R", font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (size - tw) // 2 - bbox[0]
    y = (size - th) // 2 - bbox[1] + int(size * 0.02)
    d.text((x, y), "R", font=font, fill=DARK)
    dot_r = max(3, int(size * 0.05))
    dx = x + tw + int(size * 0.04)
    dy = y - int(size * 0.10)
    d.ellipse([dx, dy, dx + dot_r * 2, dy + dot_r * 2], fill=DARK)
    return img

def launcher(size):
    img = rounded_square(size, stroke=0.03)
    return draw_R(img, ratio=0.60)

def notif(size):
    """White alpha silhouette for the status-bar notification icon."""
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    font = ImageFont.truetype(FONT, int(size * 0.78))
    bbox = d.textbbox((0, 0), "R", font=font)
    tw, th = bbox[2] - bbox[0], bbox[3] - bbox[1]
    x = (size - tw) // 2 - bbox[0]
    y = (size - th) // 2 - bbox[1]
    d.text((x, y), "R", font=font, fill=(255, 255, 255, 255))
    return img

if __name__ == "__main__":
    for dpi, px in [("mdpi", 48), ("hdpi", 72), ("xhdpi", 96), ("xxhdpi", 144), ("xxxhdpi", 192)]:
        d = os.path.join(OUT, f"mipmap-{dpi}")
        os.makedirs(d, exist_ok=True)
        launcher(px).save(os.path.join(d, "ic_launcher.png"))
    d = os.path.join(OUT, "drawable")
    os.makedirs(d, exist_ok=True)
    notif(48).save(os.path.join(d, "notif_icon.png"))
    notif(96).save(os.path.join(d, "notif_icon_x.png"))
    print("icons written to", OUT)
