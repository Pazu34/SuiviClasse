"""Colonnes du tableau : colonnes intégrées (réglables) et colonnes personnalisées.

La configuration est enregistrée dans les données chiffrées (state["settings"]) :
    settings["echelle"]   barème des notes (20 par défaut)
    settings["builtin"]   réglages des colonnes intégrées : {clé: {"titre", "emoji", "increments", "visible"}}
    settings["colonnes"]  colonnes personnalisées, dans l'ordre d'affichage :
        {"id", "titre", "emoji", "type", "visible", "increments", "echelle", "orange", "rouge", "preset"}
Types de colonne personnalisée :
    compteur  total à boutons d'incrément (comme « travail non fait ») ; valeurs = entrées du journal
    note      note sur `echelle` (/10, /5…), une par période
    texte     texte libre, un par période
    coche     case à cocher, une par période
Les valeurs des notes, textes et cases sont rangées dans eleve["extra"][id][période].
"""
import re
import secrets

DEFAULT_SCALE = 20
MAX_INCREMENTS = 6
TYPES = [("compteur", "Compteur (boutons + / −)"), ("note", "Note"), ("texte", "Texte"), ("coche", "Case à cocher")]

# Colonnes à compteur intégrées : clé -> réglages par défaut. « court » : titre de la présentation resserrée.
BUILTINS = {
    "seancePlus": {"titre": "Séance +", "court": "Séance +", "emoji": "👍", "increments": [0.5, 1]},
    "seanceMoins": {"titre": "Séance −", "court": "Séance −", "emoji": "👎", "increments": [-0.5, -1]},
    "travail": {"titre": "Travail non fait", "court": "Travail", "emoji": "📝", "increments": [-1, 1]},
    "oubli": {"titre": "Oubli matériel", "court": "Oublis", "emoji": "🎒", "increments": [-1, 1]},
}
BUILTIN_ORDER = ["seancePlus", "seanceMoins", "travail", "oubli"]
# Type d'entrée du journal associé à chaque colonne intégrée
BUILTIN_EVENT = {"seancePlus": "seance", "seanceMoins": "seance", "travail": "travail", "oubli": "oubli"}

# Pictogrammes proposés (regroupés), l'utilisateur peut aussi en saisir un autre.
EMOJIS = [
    ("Travail", ["📝", "📚", "📖", "📓", "📒", "✏", "🖊", "📏", "🧮", "💻", "🔬", "🎨", "🎵", "⚽", "🗺", "🌍"]),
    ("Évaluation", ["⭐", "🌟", "🏅", "🏆", "🎯", "✅", "❌", "💯", "❗", "❓", "📊", "📈"]),
    ("Comportement", ["🙂", "😐", "🙁", "😠", "😴", "🤝", "🗣", "🤫", "👂", "👁", "💬", "👍", "👎", "👏", "🔥"]),
    ("Vie scolaire", ["⏰", "🕒", "📅", "🔔", "📌", "📎", "✍", "📕", "📗", "📘", "🏠", "🎒", "🍎", "💧", "📱", "🔇", "🧹", "🚫", "⚠", "🩺", "❤", "💡", "🧠", "🚀"]),
]

# Suggestions prêtes à l'emploi : l'identifiant est stable, donc retirer puis remettre une suggestion retrouve ses données.
PRESETS = [
    {"id": "p_travail_maison", "titre": "Travail maison", "emoji": "🏠", "type": "compteur", "increments": [-1, 0.5, 2],
     "description": "Points de travail à la maison (+0,5 ou +2)"},
    {"id": "p_retards", "titre": "Retards", "emoji": "⏰", "type": "compteur", "increments": [-1, 1], "orange": 2, "rouge": 3,
     "description": "Nombre de retards en début de cours"},
    {"id": "p_absences", "titre": "Absences", "emoji": "🚫", "type": "compteur", "increments": [-1, 1],
     "description": "Absences au cours"},
    {"id": "p_bavardages", "titre": "Bavardages", "emoji": "💬", "type": "compteur", "increments": [-1, 1], "orange": 3, "rouge": 5,
     "description": "Remarques pour bavardage"},
    {"id": "p_lecon", "titre": "Leçon non apprise", "emoji": "📖", "type": "compteur", "increments": [-1, 1], "orange": 2, "rouge": 3,
     "description": "Leçons non sues"},
    {"id": "p_devoir_retard", "titre": "Devoir en retard", "emoji": "📅", "type": "compteur", "increments": [-1, 1], "orange": 2, "rouge": 3,
     "description": "Travail rendu après la date"},
    {"id": "p_participation", "titre": "Participation orale", "emoji": "🗣", "type": "compteur", "increments": [-1, 0.5, 1],
     "description": "Points de participation à l'oral"},
    {"id": "p_comportement", "titre": "Comportement", "emoji": "🙂", "type": "compteur", "increments": [-2, -1, 1, 2],
     "description": "Bonus et malus de comportement"},
    {"id": "p_bonus", "titre": "Bonus", "emoji": "⭐", "type": "compteur", "increments": [-1, 1],
     "description": "Points bonus"},
    {"id": "p_punition", "titre": "Punitions", "emoji": "📕", "type": "compteur", "increments": [-1, 1], "orange": 1, "rouge": 3,
     "description": "Punitions et retenues"},
    {"id": "p_oral", "titre": "Évaluation orale", "emoji": "🎤", "type": "note", "echelle": 10,
     "description": "Note d'oral sur 10"},
    {"id": "p_carnet", "titre": "Carnet signé", "emoji": "✍", "type": "coche",
     "description": "Carnet de liaison signé"},
    {"id": "p_materiel_ok", "titre": "Matériel complet", "emoji": "🎒", "type": "coche",
     "description": "Matériel complet pour la période"},
    {"id": "p_observation", "titre": "Observation", "emoji": "👁", "type": "texte",
     "description": "Remarque libre par période"},
]


# ---------------------------------------------------------------- incréments
_NUM = re.compile(r"([+\-−–]?)\s*(\d+(?:[.,]\d+)?)")


def parse_increments(text, sign=None):
    """« +0,5 ; +2 ; -1 » -> [0.5, 2.0, -1.0]. Sans signe, un nombre est positif.
    `sign` (+1 ou -1) impose le signe (colonnes séance + / séance −). Au plus 6 valeurs, sans doublon ni zéro."""
    out = []
    for s, num in _NUM.findall(str(text)):
        v = round(float(num.replace(",", ".")), 2)
        if v == 0:
            continue
        v = -v if s in ("-", "−", "–") else v
        if sign:
            v = abs(v) * sign
        if v not in out:
            out.append(v)
    return out[:MAX_INCREMENTS]


def _fmt(n):
    n = round(abs(float(n)), 2)
    return (str(int(n)) if n == int(n) else str(n)).replace(".", ",")


def increment_label(v, symbolic=False):
    """+0,5 · −2 ; avec symbolic, ±1 devient simplement + ou −."""
    if symbolic and abs(v) == 1:
        return "+" if v > 0 else "−"
    return ("+" if v > 0 else "−") + _fmt(v)


def format_increments(values):
    return " ; ".join(increment_label(v) for v in values)


# ---------------------------------------------------------------- configuration
def builtin(settings, key, short=False):
    """Réglages d'une colonne intégrée : valeurs par défaut + ce que l'utilisateur a modifié."""
    base = BUILTINS[key]
    over = (settings.get("builtin") or {}).get(key) or {}
    incs = over.get("increments") or base["increments"]
    return {
        "key": key,
        "titre": over.get("titre") or (base["court"] if short else base["titre"]),
        "emoji": over["emoji"] if "emoji" in over else base["emoji"],
        "increments": [float(v) for v in incs],
        "visible": over.get("visible", True) is not False,
        "type": "compteur",
    }


def scale(settings):
    """Barème des notes (20 par défaut)."""
    try:
        v = float(settings.get("echelle") or DEFAULT_SCALE)
    except (TypeError, ValueError):
        return DEFAULT_SCALE
    return v if v > 0 else DEFAULT_SCALE


def sanitize_column(raw):
    """Colonne personnalisée valide, ou None si inutilisable."""
    if not isinstance(raw, dict) or not raw.get("id"):
        return None
    typ = raw.get("type") if raw.get("type") in dict(TYPES) else "compteur"
    col = {"id": str(raw["id"]), "titre": " ".join(str(raw.get("titre") or "Colonne").split())[:40] or "Colonne",
           "emoji": str(raw.get("emoji") or "")[:4], "type": typ, "visible": raw.get("visible", True) is not False}
    if raw.get("preset"):
        col["preset"] = str(raw["preset"])
    if typ == "compteur":
        col["increments"] = [float(v) for v in (raw.get("increments") or [-1, 1])][:MAX_INCREMENTS] or [-1.0, 1.0]
        for k in ("orange", "rouge"):
            try:
                v = float(raw[k]) if raw.get(k) not in (None, "") else None
            except (TypeError, ValueError):
                v = None
            if v is not None and v > 0:
                col[k] = v
    elif typ == "note":
        try:
            col["echelle"] = float(raw.get("echelle") or 10)
        except (TypeError, ValueError):
            col["echelle"] = 10.0
        if col["echelle"] <= 0:
            col["echelle"] = 10.0
    return col


def customs(settings):
    """Colonnes personnalisées, dans l'ordre d'affichage."""
    out, seen = [], set()
    for raw in settings.get("colonnes") or []:
        col = sanitize_column(raw)
        if col and col["id"] not in seen:
            seen.add(col["id"])
            out.append(col)
    return out


def new_id():
    return "c_" + secrets.token_hex(3)


def from_preset(preset):
    """Colonne personnalisée créée à partir d'une suggestion."""
    col = {k: v for k, v in preset.items() if k != "description"}
    col["preset"] = preset["id"]
    return sanitize_column(col)


def event_type(settings, key):
    """Type d'entrée du journal associé à une colonne (intégrée : seance/travail/oubli ; personnalisée : son id)."""
    return BUILTIN_EVENT.get(key, key)


def type_label(settings, event_type_):
    """Nom lisible d'un type d'entrée du journal (pour la fiche élève)."""
    for key in ("travail", "oubli"):
        if event_type_ == key:
            return builtin(settings, key)["titre"]
    if event_type_ == "seance":
        return "Séance"
    for col in customs(settings):
        if col["id"] == event_type_:
            return col["titre"]
    return event_type_
