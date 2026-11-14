"""
Generate the placeholder app icons (tally marks on a blue rounded square).

Only needed when you want to redraw the icons; the app never runs this.
    pip install pillow
    python3 tools/make_icons.py
"""
from pathlib import Path
from PIL import Image, ImageDraw

BLUE = (59, 110, 168, 255)      # matches theme_color #3b6ea8
WHITE = (255, 255, 255, 255)
SCALE = 4                       # draw 4x larger, then shrink = smooth edges
OUT = Path(__file__).resolve().parent.parent / "icons"


def rounded_line(draw, start, end, width):
    """A thick line with round ends."""
    draw.line([start, end], fill=WHITE, width=width)
    r = width / 2
    for x, y in (start, end):
        draw.ellipse([x - r, y - r, x + r, y + r], fill=WHITE)


def draw_tally(draw, cx, cy, size):
    """Four upright marks crossed by a diagonal, fitting in a size x size box."""
    w = round(size * 0.075)
    top, bottom = cy - size * 0.38, cy + size * 0.38
    gap = size * 0.19
    xs = [cx - 1.5 * gap + i * gap for i in range(4)]
    for x in xs:
        rounded_line(draw, (x, top), (x, bottom), w)
    rounded_line(draw, (xs[0] - gap * 0.75, bottom - size * 0.12),
                 (xs[-1] + gap * 0.75, top + size * 0.12), w)


def make(px, maskable, filename):
    big = px * SCALE
    img = Image.new("RGBA", (big, big), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        # Full-bleed background; the OS crops it to a circle/squircle, so keep
        # the artwork well inside the central 80% safe zone.
        d.rectangle([0, 0, big, big], fill=BLUE)
        art = big * 0.55
    else:
        d.rounded_rectangle([0, 0, big - 1, big - 1], radius=big * 0.22, fill=BLUE)
        art = big * 0.70
    draw_tally(d, big / 2, big / 2, art)
    img.resize((px, px), Image.LANCZOS).save(OUT / filename, optimize=True)
    print("wrote", OUT / filename)


if __name__ == "__main__":
    OUT.mkdir(exist_ok=True)
    make(192, False, "icon-192.png")
    make(512, False, "icon-512.png")
    make(512, True, "icon-maskable-512.png")
