"""Petites icônes dessinées par le programme (aucun fichier image à embarquer) : flèches « annuler » / « rétablir ».

Chaque icône est une image PNG transparente fabriquée en mémoire, lissée (anti-crénelage), à la couleur voulue :
elle suit donc le thème clair ou sombre."""
import base64
import math
import struct
import tkinter
import zlib

SUPER = 4  # sous-échantillonnage pour lisser les bords


def _png(width, height, rgba_rows):
    """Encode une image RGBA 8 bits en PNG."""
    raw = b"".join(b"\x00" + bytes(row) for row in rgba_rows)

    def chunk(kind, data):
        body = kind + data
        return struct.pack(">I", len(data)) + body + struct.pack(">I", zlib.crc32(body) & 0xFFFFFFFF)

    return (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", width, height, 8, 6, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress(raw, 9)) + chunk(b"IEND", b""))


def _in_triangle(p, a, b, c):
    def sign(p1, p2, p3):
        return (p1[0] - p3[0]) * (p2[1] - p3[1]) - (p2[0] - p3[0]) * (p1[1] - p3[1])
    d1, d2, d3 = sign(p, a, b), sign(p, b, c), sign(p, c, a)
    return not ((d1 < 0 or d2 < 0 or d3 < 0) and (d1 > 0 or d2 > 0 or d3 > 0))


def _covered(x, y):
    """Le point (x, y) du carré unité est-il dans la flèche « annuler » (arc ouvert vers la droite, pointe en bas à gauche) ?"""
    cx, cy, r, half = 0.52, 0.60, 0.27, 0.075
    d = math.hypot(x - cx, y - cy)
    if abs(d - r) <= half and y <= cy + 0.10:                      # arc : demi-cercle supérieur, un peu prolongé à droite
        return True
    return _in_triangle((x, y), (0.25 - 0.17, cy - 0.01), (0.25 + 0.17, cy - 0.01), (0.25, cy + 0.25))  # pointe vers le bas


def arrow_png(color, size=18, flip=False):
    """Icône « annuler » (flip=False) ou « rétablir » (flip=True : symétrique) de couleur `color` (« #rrggbb »), en PNG."""
    r, g, b = (int(color[i:i + 2], 16) for i in (1, 3, 5))
    rows = []
    for j in range(size):
        row = []
        for i in range(size):
            hits = 0
            for sj in range(SUPER):
                for si in range(SUPER):
                    x, y = (i + (si + 0.5) / SUPER) / size, (j + (sj + 0.5) / SUPER) / size
                    hits += _covered(1 - x if flip else x, y)
            row += [r, g, b, round(255 * hits / SUPER ** 2)]
        rows.append(row)
    return _png(size, size, rows)


def arrow_image(master, color, flip=False, size=18):
    """Image Tk de l'icône (à garder référencée tant qu'elle est affichée)."""
    return tkinter.PhotoImage(master=master, data=base64.b64encode(arrow_png(color, size, flip)))
