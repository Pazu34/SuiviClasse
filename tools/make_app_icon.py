"""Fabrique toutes les icônes de l'application à partir des dessins « assets/icon.svg » (détaillé) et « assets/icon-small.svg » (simplifié
pour les très petites tailles) : icône Windows (.ico), icône de fenêtre Tk, icônes Android (adaptatives), icône de la version web.

À relancer seulement quand le dessin change (les fichiers produits sont versionnés) :
    cd mobile && npm ci          # fournit Playwright / Chromium pour le rendu
    python3 tools/make_app_icon.py
Dépendance : Pillow."""
import base64
import io
import re
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
ASSETS = ROOT / "assets"
ANDROID_RES = ROOT / "mobile" / "tools" / "android-res"
DENSITIES = {"mdpi": 48, "hdpi": 72, "xhdpi": 96, "xxhdpi": 144, "xxxhdpi": 192}
ADAPTIVE = {"mdpi": 108, "hdpi": 162, "xhdpi": 216, "xxhdpi": 324, "xxxhdpi": 432}
BACKGROUND = "#2F5FD0"
_tmp = Path(tempfile.mkdtemp())


def render(svg_text, size):
    src, out = _tmp / "in.svg", _tmp / f"out{size}.png"
    src.write_text(svg_text, encoding="utf-8")
    subprocess.check_call(["node", str(ROOT / "tools" / "render_svg.mjs"), str(src), str(out), str(size)])
    return Image.open(out).convert("RGBA")


def foreground_svg(svg, scale=0.64):
    """Le dessin sans le fond arrondi, réduit pour tenir dans la zone sûre d'une icône adaptative (fond fourni à part)."""
    svg = re.sub(r'<g id="bgshape">.*?</g>', "", svg, count=1, flags=re.S)
    svg = svg.replace('<g id="art">', f'<g id="art" transform="translate(256 256) scale({scale}) translate(-272 -285)">', 1)
    return svg


def circle(img):
    mask = Image.new("L", img.size, 0)
    ImageDraw.Draw(mask).ellipse((0, 0, img.width - 1, img.height - 1), fill=255)
    out = Image.new("RGBA", img.size, (0, 0, 0, 0))
    out.paste(img, (0, 0), mask)
    return out


def main():
    full, small = (ASSETS / "icon.svg").read_text(encoding="utf-8"), (ASSETS / "icon-small.svg").read_text(encoding="utf-8")
    pick = lambda n: small if n <= 32 else full
    # Windows : .ico à plusieurs tailles (les plus petites avec le dessin simplifié)
    sizes = [16, 24, 32, 48, 64, 128, 256]
    imgs = [render(pick(n), n) for n in sizes]
    imgs[-1].save(ASSETS / "suiviclasse.ico", format="ICO", sizes=[(n, n) for n in sizes], append_images=imgs[:-1])
    render(full, 512).save(ASSETS / "icon-512.png", optimize=True)
    # fenêtre Tk (iconphoto) : PNG 32 et 128 intégrés au programme, rien à embarquer à côté de l'exécutable
    parts = []
    for n in (32, 128):
        buf = io.BytesIO(); render(pick(n), n).save(buf, "PNG", optimize=True)
        parts.append(base64.b64encode(buf.getvalue()).decode())
    (ROOT / "suiviclasse" / "ui" / "appicon.py").write_text(
        '"""Icône de l\'application (générée par tools/make_app_icon.py à partir de assets/icon.svg : ne pas modifier à la main)."""\n'
        f"PNG_32 = (\n{wrap(parts[0])}\n)\nPNG_128 = (\n{wrap(parts[1])}\n)\n", encoding="utf-8")
    # Android : icônes classiques (carré arrondi / rond) et couche de premier plan de l'icône adaptative
    fg = foreground_svg(full)
    for dens, n in DENSITIES.items():
        d = ANDROID_RES / f"mipmap-{dens}"; d.mkdir(parents=True, exist_ok=True)
        img = render(full if n > 32 else small, n)
        img.save(d / "ic_launcher.png", optimize=True)
        circle(render(full, n * 2).resize((n, n), Image.LANCZOS)).save(d / "ic_launcher_round.png", optimize=True)
    for dens, n in ADAPTIVE.items():
        render(fg, n).save(ANDROID_RES / f"mipmap-{dens}" / "ic_launcher_foreground.png", optimize=True)
    vals = ANDROID_RES / "values"; vals.mkdir(parents=True, exist_ok=True)
    (vals / "ic_launcher_background.xml").write_text(
        f'<?xml version="1.0" encoding="utf-8"?>\n<resources>\n    <color name="ic_launcher_background">{BACKGROUND}</color>\n</resources>\n', encoding="utf-8")
    # version web (icône de l'onglet et de l'écran d'accueil)
    (ROOT / "mobile" / "www" / "icon.svg").write_text(full, encoding="utf-8")
    for n in (192, 512):
        render(full, n).save(ROOT / "mobile" / "www" / f"icon-{n}.png", optimize=True)
    print("icônes écrites")


def wrap(b64, width=100):
    return "\n".join(f'    "{b64[i:i + width]}"' for i in range(0, len(b64), width))


if __name__ == "__main__":
    main()
