#!/usr/bin/env python3
"""Generate the stellarlens OG image (1200x630) matching the site's minimal
gray-900 / white aesthetic. Brand tokens from apps/web/app/page.tsx + layout.tsx:
wordmark "stellarlens", primary gray-900 (#111827), secondary gray-500 (#6b7280),
white background. No logo asset exists in the repo, so we render a clean
typographic card with a subtle on-chain motif (a small "lens" ring + node dots)."""
from PIL import Image, ImageDraw, ImageFont

W, H = 1200, 630
BG = (255, 255, 255)          # white
INK = (17, 24, 39)            # gray-900
MUT = (107, 114, 128)         # gray-500
LINE = (229, 231, 235)        # gray-200
ACCENT = (64, 128, 255)       # subtle blue for the lens ring

img = Image.new("RGB", (W, H), BG)
d = ImageDraw.Draw(img)

# --- subtle top border accent (thin gray-200 rule) ---
d.rectangle([0, 0, W, 6], fill=INK)

# --- fonts ---
def font(path, size):
    return ImageFont.truetype(path, size)

f_word = font("/home/paperclip/.fonts/Montserrat-SemiBold.ttf", 96)
f_tag  = font("/home/paperclip/.fonts/Montserrat-SemiBold.ttf", 40)
f_sub  = font("/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf", 30)

# --- wordmark ---
d.text((80, 120), "stellarlens", font=f_word, fill=INK)

# --- tagline ---
d.text((80, 250), "Indexing and monitoring for Soroban contracts", font=f_tag, fill=INK)

# --- sub-line ---
d.text((80, 330), "Events · Transfers · Signed webhooks · API, SDK & CLI", font=f_sub, fill=MUT)

# --- lens motif (right side): concentric ring + node dots ---
cx, cy = 960, 300
r_outer, r_inner = 150, 96
d.ellipse([cx - r_outer, cy - r_outer, cx + r_outer, cy + r_outer], outline=LINE, width=3)
d.ellipse([cx - r_inner, cy - r_inner, cx + r_inner, cy + r_inner], outline=ACCENT, width=3)
# node dots on the ring
import math
for i in range(6):
    a = math.radians(i * 60 - 90)
    x = cx + r_outer * math.cos(a)
    y = cy + r_outer * math.sin(a)
    d.ellipse([x - 10, y - 10, x + 10, y + 10], fill=INK)
# center dot
d.ellipse([cx - 18, cy - 18, cx + 18, cy + 18], fill=ACCENT)

# --- footer rule + url ---
d.rectangle([80, 520, W - 80, 522], fill=LINE)
d.text((80, 545), "stellarlens-web.vercel.app", font=f_sub, fill=MUT)

out = "apps/web/public/og.png"
img.save(out, "PNG")
print("wrote", out, img.size)
