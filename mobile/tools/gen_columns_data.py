"""Génère mobile/www/js/core/columns_data.js (pictogrammes et suggestions de colonnes) depuis le programme du PC.
À relancer si suiviclasse/columns.py change :  python3 mobile/tools/gen_columns_data.py"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from suiviclasse import columns  # noqa: E402

out = ROOT / "mobile" / "www" / "js" / "core" / "columns_data.js"
text = ("// Fichier généré par mobile/tools/gen_columns_data.py d'après suiviclasse/columns.py : ne pas modifier à la main.\n"
        f"export const EMOJIS = {json.dumps(columns.EMOJIS, ensure_ascii=False, indent=1)};\n\n"
        f"export const PRESETS = {json.dumps(columns.PRESETS, ensure_ascii=False, indent=1)};\n")
out.write_text(text, encoding="utf-8")
print("écrit :", out, len(text), "octets")
