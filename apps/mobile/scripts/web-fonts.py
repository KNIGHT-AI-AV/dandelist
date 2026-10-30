"""
Writes the web's cuts of the app's fonts (lib/fonts.web.ts): each face as WOFF2 in three parts by script, so the first
frame waits only for the Latin part (about 180 KB for all seven faces, against 724 KB of TTF; Lighthouse, 2026-10-30).

- latin: Google Fonts' latin range plus every character the app's own text uses;
- latin-ext: the rest of Google's latin-ext range;
- rest: whatever else the face covers (Cyrillic, Greek, Vietnamese and so on).

A browser downloads a part only when text needs one of its characters, so nothing loses coverage. Files land in
public/assets/fonts named by their content hash (served for a year, like every other asset), and lib/web-fonts.json
lists them. Run from apps/mobile after a font changes or new text uses a new character (lib/web-fonts.test.ts says
when): python scripts/web-fonts.py (needs fonttools and brotli).
"""
import hashlib
import io
import json
import os
import re

from fontTools import subset
from fontTools.ttLib import TTFont

APP = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(os.path.dirname(APP))
OUT = os.path.join(APP, "public", "assets", "fonts")
MANIFEST = os.path.join(APP, "lib", "web-fonts.json")

# The faces lib/fonts.ts loads, by the family name lib/palette.ts sets.
FACES = {
    "InstrumentSerif_400Regular": "instrument-serif/400Regular/InstrumentSerif_400Regular.ttf",
    "InstrumentSerif_400Regular_Italic": "instrument-serif/400Regular_Italic/InstrumentSerif_400Regular_Italic.ttf",
    "Inter_400Regular": "inter/400Regular/Inter_400Regular.ttf",
    "Inter_500Medium": "inter/500Medium/Inter_500Medium.ttf",
    "Inter_600SemiBold": "inter/600SemiBold/Inter_600SemiBold.ttf",
    "InterTight_400Regular": "inter-tight/400Regular/InterTight_400Regular.ttf",
    "DMMono_400Regular": "dm-mono/400Regular/DMMono_400Regular.ttf",
}

# Google Fonts' own unicode-range splits (fonts.googleapis.com/css2, 2026).
LATIN = "U+0000-00FF,U+0131,U+0152-0153,U+02BB-02BC,U+02C6,U+02DA,U+02DC,U+0304,U+0308,U+0329,U+2000-206F,U+20AC,U+2122,U+2191,U+2193,U+2212,U+2215,U+FEFF,U+FFFD"
LATIN_EXT = "U+0100-02BA,U+02BD-02C5,U+02C7-02CC,U+02CE-02D7,U+02DD-02FF,U+0304,U+0308,U+0329,U+1D00-1DBF,U+1E00-1E9F,U+1EF2-1EFF,U+2020,U+20A0-20AB,U+20AD-20C0,U+2113,U+2C60-2C7F,U+A720-A7FF"

# Where the app's text lives; lib/web-fonts.test.ts scans the same places.
TEXT_DIRS = [os.path.join(APP, d) for d in ("app", "components", "lib")] + [
    os.path.join(REPO, "packages", p, "src") for p in ("catalogue", "cost")
]


def parse(spec):
    points = set()
    for part in spec.split(","):
        a, _, b = part.strip()[2:].partition("-")
        points.update(range(int(a, 16), int(b or a, 16) + 1))
    return points


def css_range(points):
    runs, start, prev = [], None, None
    for p in sorted(points):
        if start is None:
            start = prev = p
        elif p == prev + 1:
            prev = p
        else:
            runs.append((start, prev))
            start = prev = p
    if start is not None:
        runs.append((start, prev))
    return ",".join(f"U+{a:04X}" if a == b else f"U+{a:04X}-{b:04X}" for a, b in runs)


def text_points():
    points = set()
    for top in TEXT_DIRS:
        for folder, _, names in os.walk(top):
            for name in names:
                if re.search(r"\.(tsx?|json)$", name) and ".test." not in name and name != "web-fonts.json":
                    with open(os.path.join(folder, name), encoding="utf-8") as f:
                        points.update(ord(c) for c in f.read() if ord(c) > 126)
    return points


def ttf(rel):
    for base in (os.path.join(APP, "node_modules"), os.path.join(REPO, "node_modules")):
        path = os.path.join(base, "@expo-google-fonts", rel)
        if os.path.exists(path):
            return path
    raise FileNotFoundError(rel)


def woff2(path, points):
    font = TTFont(path)
    options = subset.Options()
    options.layout_features = ["*"]  # keeps tabular figures and every other feature the type roles use
    options.name_IDs = ["*"]  # every cut keeps the font's copyright and OFL licence records, as OFL 1.1 asks
    options.notdef_outline = True
    sub = subset.Subsetter(options)
    sub.populate(unicodes=points)
    sub.subset(font)
    font.flavor = "woff2"
    buf = io.BytesIO()
    font.save(buf)
    return buf.getvalue()


def main():
    os.makedirs(OUT, exist_ok=True)
    for name in os.listdir(OUT):
        if name.endswith(".woff2"):
            os.remove(os.path.join(OUT, name))
    latin = parse(LATIN) | text_points()
    parts = {"latin": latin, "latin-ext": parse(LATIN_EXT) - latin}
    manifest = {}
    for family, rel in FACES.items():
        path = ttf(rel)
        covered = set(TTFont(path).getBestCmap())
        parts["rest"] = covered - parts["latin"] - parts["latin-ext"]
        manifest[family] = []
        for part, points in parts.items():
            points = points & covered
            if not points:
                continue
            data = woff2(path, points)
            name = f"{family}.{part}.{hashlib.md5(data).hexdigest()}.woff2"
            with open(os.path.join(OUT, name), "wb") as f:
                f.write(data)
            manifest[family].append({"url": f"/assets/fonts/{name}", "range": css_range(points)})
            print(f"{name}  {len(data) // 1024} KB  {len(points)} characters")
    with open(MANIFEST, "w", encoding="utf-8", newline="\n") as f:
        json.dump(manifest, f, indent=2)
        f.write("\n")


if __name__ == "__main__":
    main()
