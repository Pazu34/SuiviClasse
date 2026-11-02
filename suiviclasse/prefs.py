"""Préférences de l'application : fichier JSON lisible (non chiffré, rien de sensible)
dans le dossier de données.

Pour ajouter un réglage, il suffit d'ajouter une entrée à SCHEMA : valeur par défaut,
validation et fenêtre « Préférences » en découlent.
"""
import json
from pathlib import Path

FILE = "preferences.json"

SCHEMA = [
    dict(key="periodes", group="Affichage", label="Découpage de l’année", type="choice", default="trimestres",
         options=[("trimestres", "Trimestres (T1 à T3)"), ("semestres", "Semestres (S1 et S2)")], unit=""),
    dict(key="theme", group="Affichage", label="Thème", type="choice", default="clair",
         options=[("clair", "Clair"), ("sombre", "Sombre"), ("auto", "Automatique (suit Windows)")], unit=""),
    dict(key="pictogrammes", group="Affichage", label="Pictogrammes dans les titres", type="choice", default="oui",
         options=[("oui", "Oui"), ("non", "Non")], unit=""),
    dict(key="planAffichage", group="Affichage", label="Noms dans le plan de classe", type="choice", default="prenom_nom",
         options=[("prenom_nom", "Prénom Nom"), ("prenom", "Prénom"), ("nom", "Nom"),
                  ("prenom_i", "Prénom + initiale du nom"), ("initiales", "Initiales")], unit=""),
    dict(key="affichage", group="Affichage", label="Densité du tableau", type="choice", default="compact",
         options=[("compact", "Resserré (portable)"), ("normal", "Normal (grand écran)")], unit=""),
    dict(key="oubliOrange", group="Alertes — oublis de matériel", label="Orange à partir de", type="int", min=1, max=99, default=2, unit="par période"),
    dict(key="oubliRouge", group="Alertes — oublis de matériel", label="Rouge à partir de", type="int", min=1, max=99, default=3, unit="par période"),
    dict(key="travailOrange", group="Alertes — travail non fait", label="Orange à partir de", type="int", min=1, max=99, default=2, unit="par période"),
    dict(key="travailRouge", group="Alertes — travail non fait", label="Rouge à partir de", type="int", min=1, max=99, default=3, unit="par période"),
    dict(key="seancePlusVert", group="Alertes — implication en séance", label="Séance + : vert à partir de", type="number", min=0.5, max=99, default=3, unit="pts"),
    dict(key="seanceMoinsRouge", group="Alertes — implication en séance", label="Séance − : rouge à partir de", type="number", min=0.5, max=99, default=2, unit="pts (valeur absolue)"),
    dict(key="backupMinutes", group="Sauvegardes automatiques", label="Créer une archive toutes les", type="int", min=0, max=1440, default=15, unit="min (0 = désactivé)"),
    dict(key="backupKeepRecent", group="Sauvegardes automatiques", label="Archives récentes conservées", type="int", min=1, max=500, default=20, unit="archives"),
    dict(key="backupKeepDays", group="Sauvegardes automatiques", label="Puis 1 archive par jour pendant", type="int", min=0, max=3650, default=30, unit="jours"),
    dict(key="appreciationMax", group="Bulletins", label="Appréciation : longueur max.", type="int", min=50, max=5000, default=255, unit="caractères (PRONOTE : 255)"),
    dict(key="autoLockMinutes", group="Sécurité", label="Verrouiller après", type="int", min=0, max=240, default=15, unit="min d’inactivité (0 = jamais)"),
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


# Onglet de la fenêtre « Préférences » où apparaît chaque groupe de réglages (l'onglet « Colonnes » est à part).
TAB_OF_GROUP = {"Affichage": "Affichage", "Sauvegardes automatiques": "Sauvegardes",
                "Sécurité": "Sécurité et bulletins", "Bulletins": "Sécurité et bulletins"}
for _f in SCHEMA:
    _f["tab"] = TAB_OF_GROUP.get(_f["group"], "Alertes")
TABS = list(dict.fromkeys(f["tab"] for f in SCHEMA))

COLUMN_MIN, COLUMN_MAX = 24, 900  # largeur d'une colonne du tableau, en pixels


def sanitize_columns(raw):
    """{"compact": {"nom": 108, …}, "normal": {…}} -> même forme, largeurs bornées ; le reste est ignoré."""
    out = {}
    if isinstance(raw, dict):
        for mode, widths in raw.items():
            if isinstance(widths, dict):
                clean = {str(k): int(min(COLUMN_MAX, max(COLUMN_MIN, w))) for k, w in widths.items()
                         if isinstance(w, (int, float)) and not isinstance(w, bool)}
                if clean:
                    out[str(mode)] = clean
    return out


class Prefs:
    def __init__(self, directory):
        self.file = Path(directory) / FILE
        self.saved_columns = {}
        self.values = self.load()

    def load(self):
        try:
            raw = json.loads(self.file.read_text(encoding="utf-8"))
        except (OSError, ValueError):
            return defaults()
        self.saved_columns = sanitize_columns(raw.get("colonnes") if isinstance(raw, dict) else None)
        return sanitize(raw)

    def _write(self):
        self.file.parent.mkdir(parents=True, exist_ok=True)
        data = dict(self.values)
        if self.saved_columns:
            data["colonnes"] = self.saved_columns
        self.file.write_text(json.dumps(data, indent=2), encoding="utf-8")

    def set(self, values):
        self.values = sanitize({**self.values, **values})
        self._write()
        return self.values

    def reset(self):
        """Valeurs par défaut pour tous les réglages, largeurs de colonnes comprises."""
        self.saved_columns = {}
        return self.set(defaults())

    # ---------- largeurs de colonnes (réglées à la souris dans le tableau, par clé de colonne) ----------
    def widths(self, mode):
        """Largeurs enregistrées pour la présentation `mode` : {clé de colonne: pixels}."""
        return dict(self.saved_columns.get(mode, {}))

    def set_width(self, mode, key, width):
        self.saved_columns.setdefault(mode, {})[key] = int(min(COLUMN_MAX, max(COLUMN_MIN, width)))
        self._write()

    def forget_width(self, mode, key):
        self.saved_columns.get(mode, {}).pop(key, None)
        self._write()

    def reset_columns(self):
        self.saved_columns = {}
        self._write()
