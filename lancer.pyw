"""Double-clic sous Windows pour lancer SuiviClasse sans fenêtre de console."""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from suiviclasse.ui.app import main

main()
