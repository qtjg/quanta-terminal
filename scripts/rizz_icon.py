"""Generate RizzReply extension icon (128px) — amber rounded square, black bolt."""
from PIL import Image, ImageDraw

SIZE = 128
img = Image.new("RGBA", (SIZE, SIZE), (0, 0, 0, 0))
d = ImageDraw.Draw(img)

# Rounded square background
d.rounded_rectangle([4, 4, SIZE - 4, SIZE - 4], radius=28, fill=(251, 191, 36, 255))

# Sparkle: 4-point star (diamond-ish) centered
cx, cy = SIZE // 2, SIZE // 2
r_long, r_short = 40, 12
star = [
    (cx, cy - r_long),
    (cx + r_short, cy - r_short),
    (cx + r_long, cy),
    (cx + r_short, cy + r_short),
    (cx, cy + r_long),
    (cx - r_short, cy + r_short),
    (cx - r_long, cy),
    (cx - r_short, cy - r_short),
]
d.polygon(star, fill=(0, 0, 0, 255))

# Small companion sparkle top-right
sx, sy = SIZE - 30, 30
small = [
    (sx, sy - 12),
    (sx + 4, sy - 4),
    (sx + 12, sy),
    (sx + 4, sy + 4),
    (sx, sy + 12),
    (sx - 4, sy + 4),
    (sx - 12, sy),
    (sx - 4, sy - 4),
]
d.polygon(small, fill=(0, 0, 0, 200))

img.save("/home/z/my-project/extension/icon.png")
print("icon saved")
