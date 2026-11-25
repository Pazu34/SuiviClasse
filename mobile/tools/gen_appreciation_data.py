"""Génère mobile/www/js/core/appreciation_data.js (banque de phrases par défaut, prénoms) depuis le programme du PC.
À relancer si suiviclasse/appreciation.py change :  python3 mobile/tools/gen_appreciation_data.py"""
import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT))
from suiviclasse import appreciation as A  # noqa: E402

out = ROOT / "mobile" / "www" / "js" / "core" / "appreciation_data.js"
text = ("// Fichier généré par mobile/tools/gen_appreciation_data.py d'après suiviclasse/appreciation.py : ne pas modifier à la main.\n"
        f"export const DEFAULT_BANK = {json.dumps(A.default_bank(), ensure_ascii=False, indent=1)};\n\n"
        f"export const PHRASE_FIXES = {json.dumps(A.PHRASE_FIXES, ensure_ascii=False, indent=1)};\n\n"
        f"export const FEM_NAMES = {json.dumps(A._FEM, ensure_ascii=False)};\n\n"
        f"export const MASC_NAMES = {json.dumps(A._MASC, ensure_ascii=False)};\n")
out.write_text(text, encoding="utf-8")
print("écrit :", out, len(text), "octets")
