"""Emplacement des données : à côté du programme (clé USB), ou dossier choisi par l'utilisateur."""
import json
import os
import sys
from pathlib import Path

CONFIG = "SuiviClasse-config.json"


def base_dir():
    """Dossier du programme : à côté du .exe une fois empaqueté, sinon racine du projet."""
    if getattr(sys, "frozen", False):
        return Path(sys.executable).resolve().parent
    return Path(__file__).resolve().parent.parent


def data_dir():
    if os.environ.get("SUIVI_DATA_DIR"):
        return Path(os.environ["SUIVI_DATA_DIR"])
    try:
        chosen = json.loads((base_dir() / CONFIG).read_text(encoding="utf-8")).get("dataDir")
    except (OSError, ValueError):
        chosen = None
    return (base_dir() / chosen) if chosen else base_dir() / "SuiviClasse-Donnees"


def remember_data_dir(path):
    """Mémorise le dossier choisi (sans erreur si la clé est en lecture seule)."""
    try:
        (base_dir() / CONFIG).write_text(json.dumps({"dataDir": str(path)}, indent=2), encoding="utf-8")
    except OSError:
        pass
