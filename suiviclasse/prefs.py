"""Préférences de l'application : fichier JSON lisible (non chiffré, rien de sensible)
dans le dossier de données.

Pour ajouter un réglage, il suffit d'ajouter une entrée à SCHEMA : valeur par défaut,
validation et fenêtre « Préférences » en découlent.
"""
import json
from pathlib import Path

FILE = "preferences.json"

SCHEMA = [
    dict(key="affichage", group="Affichage", label="Densité du tableau", type="choice", default="compact",
         options=[("compact", "Resserré (portable)"), ("normal", "Normal (grand écran)")], unit=""),
    dict(key="oubliOrange", group="Alertes — oublis de matériel", label="Orange à partir de", type="int", min=1, max=99, default=2, unit="oublis par trimestre"),
    dict(key="oubliRouge", group="Alertes — oublis de matériel", label="Rouge à partir de", type="int", min=1, max=99, default=3, unit="oublis par trimestre"),
    dict(key="travailOrange", group="Alertes — travail non fait", label="Orange à partir de", type="int", min=1, max=99, default=2, unit="fois par trimestre"),
    dict(key="travailRouge", group="Alertes — travail non fait", label="Rouge à partir de", type="int", min=1, max=99, default=3, unit="fois par trimestre"),
    dict(key="seancePlusVert", group="Alertes — implication en séance", label="Séance + : vert à partir de", type="number", min=0.5, max=99, default=3, unit="points"),
    dict(key="seanceMoinsRouge", group="Alertes — implication en séance", label="Séance − : rouge à partir de", type="number", min=0.5, max=99, default=2, unit="points (valeur absolue)"),
    dict(key="backupMinutes", group="Sauvegardes automatiques", label="Créer une archive toutes les", type="int", min=0, max=1440, default=15, unit="minutes (0 = désactivé)"),
    dict(key="backupKeepRecent", group="Sauvegardes automatiques", label="Archives récentes conservées", type="int", min=1, max=500, default=20, unit="archives"),
    dict(key="backupKeepDays", group="Sauvegardes automatiques", label="Puis une archive par jour pendant", type="int", min=0, max=3650, default=30, unit="jours"),
    dict(key="appreciationMax", group="Bulletins", label="Longueur maximale d’une appréciation", type="int", min=50, max=5000, default=255, unit="caractères (255 par défaut dans PRONOTE)"),
    dict(key="autoLockMinutes", group="Sécurité", label="Verrouillage automatique après", type="int", min=0, max=240, default=15, unit="minutes d’inactivité (0 = jamais)"),
]


def defaults():
    return {f["key"]: f["default"] for f in SCHEMA}


def sanitize(src):
    """Ramène n'importe quel objet à des valeurs valides (clés inconnues ignorées, manquantes = défaut)."""
    src = src if isinstance(src, dict) else {}
    out = {}
    for f in SCHEMA:
        if f["type"] == "choice":
            v = src.get(f["key"])
            out[f["key"]] = v if v in dict(f["options"]) else f["default"]
            continue
        try:
            v = float(str(src.get(f["key"])).replace(",", "."))
            if v != v or v in (float("inf"), float("-inf")):
                raise ValueError
        except (TypeError, ValueError):
            v = f["default"]
        if f["type"] == "int":
            v = int(round(v))
        v = min(f["max"], max(f["min"], v))
        out[f["key"]] = v
    # l'orange ne peut pas être au-dessus du rouge
    out["oubliOrange"] = min(out["oubliOrange"], out["oubliRouge"])
    out["travailOrange"] = min(out["travailOrange"], out["travailRouge"])
    return out


class Prefs:
    def __init__(self, directory):
        self.file = Path(directory) / FILE
        self.values = self.load()

    def load(self):
        try:
            return sanitize(json.loads(self.file.read_text(encoding="utf-8")))
        except (OSError, ValueError):
            return defaults()

    def set(self, values):
        self.values = sanitize({**self.values, **values})
        self.file.parent.mkdir(parents=True, exist_ok=True)
        self.file.write_text(json.dumps(self.values, indent=2), encoding="utf-8")
        return self.values

    def reset(self):
        return self.set(defaults())
