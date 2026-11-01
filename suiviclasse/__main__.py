"""Lancement :  py suiviclasse   (ou  py -m suiviclasse ,  ou double-clic sur lancer.pyw)"""
import sys
from pathlib import Path

# Rendre le paquet importable quelle que soit la façon dont Python lance ce fichier
# (« py suiviclasse » ne place pas toujours la racine du projet dans sys.path).
ROOT = str(Path(__file__).resolve().parent.parent)
if ROOT not in sys.path:
    sys.path.insert(0, ROOT)

from suiviclasse.ui.app import main

if __name__ == "__main__":
    main()
