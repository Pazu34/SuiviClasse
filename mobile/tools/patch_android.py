"""Réglages du projet Android généré par « cap add android » : icônes, numéro de version (numéro de la construction)."""
import os
import re
import shutil
from pathlib import Path

here = Path(__file__).resolve().parent
android = here.parent / "android"
# icônes : dessinées à partir de assets/icon.svg (voir tools/make_app_icon.py) ; on remplace celles du modèle Capacitor
res = android / "app" / "src" / "main" / "res"
shutil.copytree(here / "android-res", res, dirs_exist_ok=True)
gradle = android / "app" / "build.gradle"
text = gradle.read_text(encoding="utf-8")
run = os.environ.get("GITHUB_RUN_NUMBER", "1")
text = re.sub(r"versionCode \d+", f"versionCode {int(run)}", text)
text = re.sub(r'versionName "[^"]*"', f'versionName "1.0.{run}"', text)
gradle.write_text(text, encoding="utf-8")
print("versionCode", run)
