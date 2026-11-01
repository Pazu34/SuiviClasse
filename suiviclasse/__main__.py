"""Lancement :  py -m suiviclasse   (ou, depuis le dossier du projet :  py suiviclasse)"""
import sys
from pathlib import Path

if __package__ in (None, ""):  # lancé comme « py suiviclasse » : rendre le paquet importable
    sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from suiviclasse.ui.app import main

if __name__ == "__main__":
    main()
