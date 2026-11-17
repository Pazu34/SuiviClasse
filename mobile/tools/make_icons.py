"""Fabrique les icônes de l'application Android (PNG) sans dépendance : une grille de places de classe sur fond bleu.
Usage : python3 make_icons.py <dossier res d'Android>"""
import struct
import sys
import zlib
from pathlib import Path

BLUE, WHITE = (0x2F, 0x5F, 0xD0, 255), (255, 255, 255, 255)
SIZES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
FOREGROUND = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}


def png(w, h, pixel):
    raw = b"".join(b"\x00" + b"".join(bytes(pixel(x, y)) for x in range(w)) for y in range(h))
    def chunk(tag, data):
        c = struct.pack(">I", len(data)) + tag + data
        return c + struct.pack(">I", zlib.crc32(tag + data) & 0xFFFFFFFF)
    return b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 6, 0, 0, 0)) + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b"")


def in_round(x, y, x0, y0, x1, y1, r):
    if not (x0 <= x < x1 and y0 <= y < y1):
        return False
    cx = min(max(x, x0 + r), x1 - r - 1)
    cy = min(max(y, y0 + r), y1 - r - 1)
    return (x - cx) ** 2 + (y - cy) ** 2 <= r * r


def design(size, background):
    """Quatre places et un tableau, dans un carré de 108 unités (zone sûre d'une icône adaptative : 66 au centre)."""
    s = size / 108.0
    seats = [(30, 30, 52, 46), (56, 30, 78, 46), (30, 50, 52, 66), (56, 50, 78, 66)]
    board = (36, 74, 72, 80)
    def pixel(x, y):
        for (a, b, c, d) in seats + [board]:
            if in_round(x, y, a * s, b * s, c * s, d * s, 3 * s):
                return WHITE
        return BLUE if background else (0, 0, 0, 0)
    return pixel


def main(res):
    res = Path(res)
    for dens, size in SIZES.items():
        d = res / f"mipmap-{dens}"
        d.mkdir(parents=True, exist_ok=True)
        full = png(size, size, design(size, True))
        (d / "ic_launcher.png").write_bytes(full)
        (d / "ic_launcher_round.png").write_bytes(full)
    for dens, size in FOREGROUND.items():
        d = res / f"mipmap-{dens}"
        (d / "ic_launcher_foreground.png").write_bytes(png(size, size, design(size, False)))
    vals = res / "values"
    vals.mkdir(parents=True, exist_ok=True)
    (vals / "ic_launcher_background.xml").write_text('<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">#2F5FD0</color>\n</resources>\n', encoding="utf-8")
    print("icônes écrites dans", res)


if __name__ == "__main__":
    main(sys.argv[1])
