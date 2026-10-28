"""Draws the background textures in assets/atmosphere/ (run once; the PNGs are committed).

- guilloche.png: an engine-turned pattern, the fine machine engraving on watch dials and banknotes. A field of
  interfering waves fills the page and a rose-engine rosette turns just past the top right corner, its centre off the page. White lines on
  transparency; the app tints it with the theme's ink at a few percent, so it reads tone on tone.
- sheen.png: a soft round light the app drifts slowly across the page.

Usage: python scripts/make-atmosphere.py
"""
import math
import os

import numpy as np
from PIL import Image, ImageDraw

OUT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "assets", "atmosphere")
W, H = 1536, 3328  # a tall phone page at about 1.3x; the app covers wider windows with it
SS = 2  # drawn at twice the size, then reduced, for smooth hairlines


def guilloche() -> Image.Image:
    w, h = W * SS, H * SS
    im = Image.new("L", (w, h), 0)
    d = ImageDraw.Draw(im)
    # The field: waves whose phase walks a little from line to line, so neighbours cross and weave.
    n = 170
    gap = h / n
    xs = np.arange(-40, w + 40, 6)
    for k in range(n + 6):
        y0 = (k - 3) * gap
        ys = (y0 + gap * 1.7 * np.sin(2 * math.pi * xs / (w * 0.42) + k * 0.115)
              + gap * 0.6 * np.sin(2 * math.pi * xs / (w * 0.13) - k * 0.071))
        d.line(list(zip(xs.tolist(), ys.tolist())), fill=150, width=SS)
    # The rosette: scalloped rings turned on a rose engine, alternate rings out of phase so they braid.
    # The rosette's centre sits just past the top right corner (owner, 2026-10-28: where the rings met, the page
    # showed a hole). Only its outer arcs reach the page, so the convergence is never on screen, even as it drifts.
    cx, cy = w * 1.04, -h * 0.02
    t = np.linspace(0, 2 * math.pi, 2400)
    rings = 120
    for i in range(rings):
        r0 = w * (0.012 + i * 0.0058)
        amp = w * 0.012 * min(1.0, 0.3 + i / 25)
        r = r0 + amp * np.cos(48 * t + (math.pi if i % 2 else 0) + i * 0.02)
        pts = list(zip((cx + r * np.cos(t)).tolist(), (cy + r * np.sin(t)).tolist()))
        fade = 1.0 if i < rings * 0.6 else max(0.0, 1 - (i - rings * 0.6) / (rings * 0.4))  # the rosette dissolves into the field
        d.line(pts + pts[:1], fill=int(255 * fade), width=SS)
    small = im.resize((W, H), Image.LANCZOS)
    a = np.asarray(small)
    rgba = np.dstack([np.full_like(a, 255), np.full_like(a, 255), np.full_like(a, 255), a])
    return Image.fromarray(rgba, "RGBA").quantize(colors=16, method=Image.Quantize.FASTOCTREE)


def sheen() -> Image.Image:
    s = 512
    y, x = np.mgrid[0:s, 0:s] / (s - 1) - 0.5
    a = np.exp(-(x**2 + y**2) / (2 * 0.17**2))
    a = (a * 255).astype(np.uint8)
    return Image.fromarray(np.dstack([np.full_like(a, 255)] * 3 + [a]), "RGBA")


if __name__ == "__main__":
    os.makedirs(OUT, exist_ok=True)
    guilloche().save(os.path.join(OUT, "guilloche.png"), optimize=True)
    sheen().save(os.path.join(OUT, "sheen.png"), optimize=True)
    for f in sorted(os.listdir(OUT)):
        print(f, os.path.getsize(os.path.join(OUT, f)) // 1024, "KB")
