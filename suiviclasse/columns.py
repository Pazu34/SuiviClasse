"""Colonnes du tableau : colonnes intégrées (réglables) et colonnes personnalisées.

La configuration est enregistrée dans les données chiffrées (state["settings"]) :
    settings["echelle"]   barème des notes (20 par défaut)
    settings["builtin"]   réglages des colonnes à compteur intégrées : {clé: {"titre", "emoji", "increments", "visible"}}
    settings["base"]      réglages des colonnes de base (n°, nom, prénom, infos, notes, commentaire, fiche) : {clé: {"titre", "emoji", "visible"}}
    settings["ordre"]     ordre d'affichage de toutes les colonnes (clés) ; les colonnes absentes de la liste reprennent leur place habituelle
    settings["colonnes"]  colonnes personnalisées, dans l'ordre d'affichage :
        {"id", "titre", "emoji", "type", "visible", "increments", "echelle", "choix", "orange", "rouge", "preset"}
Colonnes à niveaux : à chaque séance on attribue un niveau choisi parmi 2 à 5 (A à E par défaut, du meilleur au moins bon). La colonne
affiche la note finale de la période, calculée selon une règle (moyenne de la période, de l'année, ou des X dernières notes) ;
« non noté » si aucune note ne compte. Les colonnes intégrées « Travail en séance » (qualSeance) et « Travail à la maison » (qualMaison)
sont de ce type ; leurs réglages (niveaux, regle, x) sont dans settings["builtin"] comme leur titre.
    niveaux   noms des niveaux, du meilleur au moins bon (2 à 5)        regle   periode | annee | dernieres_periode | dernieres_annee
    x         nombre de notes retenues par les règles « dernières » (3 par défaut)
Types de colonne personnalisée :
    compteur  total à boutons d'incrément (comme « travail non fait ») ; valeurs = entrées du journal
    note      note sur `echelle` (/10, /5…), une par période
    texte     texte libre, un par période
    liste     menu déroulant : une valeur parmi `choix` (saisis par l'utilisateur), une par période
    coche     case à cocher, une par période
    niveaux   menu de 2 à 5 niveaux à attribuer à chaque séance (entrées du journal, comme un compteur) ; voir ci-dessus
Les valeurs des notes, textes et cases sont rangées dans eleve["extra"][id][période].
"""
import re
import secrets

DEFAULT_SCALE = 20
MAX_INCREMENTS = 6
MAX_CHOICES, MAX_CHOICE_LEN = 20, 40
TYPES = [("compteur", "Compteur (boutons + / −)"), ("note", "Note"), ("texte", "Texte"),
         ("liste", "Menu déroulant"), ("coche", "Case à cocher"), ("niveaux", "Niveaux par séance (2 à 5)")]
MIN_LEVELS, MAX_LEVELS, MAX_LEVEL_LEN = 2, 5, 20
DEFAULT_LEVELS = ["A", "B", "C", "D", "E"]
# Règles de calcul de la note finale d'une période (le libellé complet remplace X et « trimestre » à l'affichage)
RULES = [("periode", "Moyenne des notes du trimestre"),
         ("annee", "Moyenne des notes depuis le début de l'année"),
         ("dernieres_periode", "Moyenne des X dernières notes du trimestre"),
         ("dernieres_annee", "Moyenne des X dernières notes de l'année")]
MAX_X = 99

# Colonnes à compteur intégrées : clé -> réglages par défaut. « court » : titre de la présentation resserrée.
# « visible » : affichage par défaut (les anciens compteurs de séance et de travail sont remplacés par les notes de A à E,
# mais restent disponibles dans « Colonnes… » avec leurs données). « lettres » : colonne de notes de A à E.
BUILTINS = {
    "qualSeance": {"titre": "Travail en séance", "court": "Séance", "emoji": "📚", "increments": [], "lettres": True},
    "qualMaison": {"titre": "Travail à la maison", "court": "Maison", "emoji": "🏠", "increments": [], "lettres": True},
    "seancePlus": {"titre": "Séance +", "court": "Séance +", "emoji": "👍", "increments": [0.5, 1], "visible": False},
    "seanceMoins": {"titre": "Séance −", "court": "Séance −", "emoji": "👎", "increments": [-0.5, -1], "visible": False},
    "travail": {"titre": "Travail non fait", "court": "Travail", "emoji": "📝", "increments": [-1, 1], "visible": False},
    "oubli": {"titre": "Oubli matériel", "court": "Oublis", "emoji": "🎒", "increments": [-1, 1]},
}
BUILTIN_ORDER = ["qualSeance", "qualMaison", "seancePlus", "seanceMoins", "travail", "oubli"]
GRADE_KEYS = ("qualSeance", "qualMaison")  # colonnes de notes de A à E
# Type d'entrée du journal associé à chaque colonne intégrée
BUILTIN_EVENT = {"qualSeance": "qualSeance", "qualMaison": "qualMaison", "seancePlus": "seance", "seanceMoins": "seance",
                 "travail": "travail", "oubli": "oubli"}

# Colonnes de base. « notes » désigne l'ensemble des colonnes de note de période (T1 à T3 ou S1 et S2).
BASE = {
    "numero": {"titre": "n°", "court": "n°", "emoji": ""},
    "nom": {"titre": "Nom", "court": "Nom", "emoji": ""},
    "prenom": {"titre": "Prénom", "court": "Prénom", "emoji": ""},
    "infos": {"titre": "Infos (PAI…)", "court": "Infos", "emoji": ""},
    "notes": {"titre": "Notes", "court": "Notes", "emoji": ""},
    "comm": {"titre": "Commentaire bulletin", "court": "Commentaire bulletin", "emoji": ""},
    "fiche": {"titre": "", "court": "", "emoji": "📝"},  # pour « fiche », le pictogramme est celui du bouton de chaque ligne
}
BASE_ORDER = ["numero", "nom", "prenom", "infos", "notes", "comm", "fiche"]
# Ordre par défaut de toutes les colonnes ; les colonnes personnalisées s'insèrent avant « comm ».
DEFAULT_ORDER = ["numero", "nom", "prenom", "infos", "notes", "qualSeance", "qualMaison", "seancePlus", "seanceMoins", "travail", "oubli",
                 "comm", "fiche"]
ALWAYS_VISIBLE = {"nom"}  # sans le nom, le tableau n'identifierait plus personne

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
    {"id": "p_attitude", "titre": "Attitude en classe", "emoji": "🙂", "type": "liste",
     "choix": ["Excellente", "Bonne", "Passable", "À améliorer"], "description": "Menu : appréciation de l'attitude"},
    {"id": "p_maitrise", "titre": "Niveau de maîtrise", "emoji": "🎯", "type": "liste",
     "choix": ["Non acquis", "En cours d'acquisition", "Acquis", "Dépassé"], "description": "Menu : compétence non acquise à dépassée"},
    {"id": "p_oral", "titre": "Évaluation orale", "emoji": "🎤", "type": "note", "echelle": 10,
     "description": "Note d'oral sur 10"},
    {"id": "p_carnet", "titre": "Carnet signé", "emoji": "✍", "type": "coche",
     "description": "Carnet de liaison signé"},
    {"id": "p_materiel_ok", "titre": "Matériel complet", "emoji": "🎒", "type": "coche",
     "description": "Matériel complet pour la période"},
    {"id": "p_observation", "titre": "Observation", "emoji": "👁", "type": "texte",
     "description": "Remarque libre par période"},
]


# ---------------------------------------------------------------- menus déroulants
def parse_choices(text):
    """Un choix par ligne (ou séparés par « ; ») -> liste sans doublon ni ligne vide (20 choix de 40 caractères au plus)."""
    items = text if isinstance(text, (list, tuple)) else re.split(r"[\n;]", str(text))
    out = []
    for item in items:
        c = " ".join(str(item).split())[:MAX_CHOICE_LEN]
        if c and c not in out:
            out.append(c)
    return out[:MAX_CHOICES]


# ---------------------------------------------------------------- niveaux et règle de la note finale
def parse_levels(items):
    """Noms de niveaux (liste ou un par ligne) -> de 2 à 5 noms distincts (20 caractères au plus). Moins de 2 noms valides : A à E."""
    items = items if isinstance(items, (list, tuple)) else re.split(r"[\n;]", str(items))
    out = []
    for item in items:
        name = " ".join(str(item).split())[:MAX_LEVEL_LEN]
        if name and name.lower() not in [o.lower() for o in out]:
            out.append(name)
    return out[:MAX_LEVELS] if len(out) >= MIN_LEVELS else list(DEFAULT_LEVELS)


def parse_rule(regle, x):
    """(règle, X) valides : règle inconnue -> moyenne de la période ; X entier de 1 à 99, 3 par défaut."""
    regle = regle if regle in dict(RULES) else "periode"
    try:
        x = int(float(str(x).replace(",", ".")))
    except (TypeError, ValueError):
        x = 3
    return regle, min(MAX_X, max(1, x)) if x else 3


def rule_label(regle, x, word="trimestre"):
    """Libellé d'une règle, avec X et le mot « trimestre » (ou « semestre ») remplacés."""
    label = dict(RULES)[regle].replace("trimestre", word).replace(" X ", f" {x} ")
    return label


def grade_cfg(cfg):
    """Réglages normalisés (niveaux, règle, X) d'une colonne à niveaux (colonne intégrée ou personnalisée)."""
    regle, x = parse_rule(cfg.get("regle"), cfg.get("x"))
    return {"niveaux": parse_levels(cfg.get("niveaux") or DEFAULT_LEVELS), "regle": regle, "x": x}


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
    out = {
        "key": key,
        "titre": over.get("titre") or (base["court"] if short else base["titre"]),
        "emoji": over["emoji"] if "emoji" in over else base["emoji"],
        "increments": [float(v) for v in incs],
        "visible": bool(over.get("visible", builtin_visible(key))),
        "type": "niveaux" if key in GRADE_KEYS else "compteur",
    }
    if key in GRADE_KEYS:
        out.update(grade_cfg(over))
    return out


def builtin_visible(key):
    """Affichage par défaut d'une colonne intégrée."""
    return BUILTINS[key].get("visible", True)


def base(settings, key, short=False):
    """Réglages d'une colonne de base : valeurs par défaut + ce que l'utilisateur a modifié."""
    d = BASE[key]
    over = (settings.get("base") or {}).get(key) or {}
    return {
        "key": key,
        "titre": over["titre"] if "titre" in over else (d["court"] if short else d["titre"]),
        "emoji": over["emoji"] if "emoji" in over else d["emoji"],
        "visible": key in ALWAYS_VISIBLE or over.get("visible", True) is not False,
        "type": "base",
    }


def order(settings, custom_ids):
    """Clés de toutes les colonnes dans l'ordre d'affichage : l'ordre choisi par l'utilisateur, complété par la place
    habituelle des colonnes qu'il n'a pas encore placées (les nouvelles colonnes personnalisées vont avant « comm »)."""
    known = DEFAULT_ORDER + [i for i in custom_ids if i not in DEFAULT_ORDER]
    out = []
    for k in settings.get("ordre") or []:
        if k in known and k not in out:
            out.append(k)
    for k in DEFAULT_ORDER:
        if k not in out:
            i = DEFAULT_ORDER.index(k)
            prev = next((p for p in reversed(DEFAULT_ORDER[:i]) if p in out), None)
            out.insert(out.index(prev) + 1 if prev else 0, k)
    for k in custom_ids:
        if k not in out:
            out.insert(out.index("comm") if "comm" in out else len(out), k)
    return out


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
    # Les réglages propres à un type sont conservés même s'il n'est pas actif : revenir à un type précédent les retrouve.
    if raw.get("increments") or typ == "compteur":
        col["increments"] = [float(v) for v in (raw.get("increments") or [-1, 1])][:MAX_INCREMENTS] or [-1.0, 1.0]
    for k in ("orange", "rouge"):
        try:
            v = float(raw[k]) if raw.get(k) not in (None, "") else None
        except (TypeError, ValueError):
            v = None
        if v is not None and v > 0:
            col[k] = v
    if raw.get("niveaux") or typ == "niveaux":
        col.update(grade_cfg(raw))
    if raw.get("choix") or typ == "liste":
        col["choix"] = parse_choices(raw.get("choix") or [])
    if raw.get("echelle") or typ == "note":
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


def grade_columns(settings, visible_only=True):
    """Colonnes à niveaux (intégrées puis personnalisées) : dictionnaires {key, event, titre, emoji, niveaux, regle, x, visible}."""
    out = []
    for key in GRADE_KEYS:
        cfg = builtin(settings, key)
        out.append({**cfg, "event": BUILTIN_EVENT[key]})
    for col in customs(settings):
        if col["type"] == "niveaux":
            out.append({**col, "key": col["id"], "event": col["id"]})
    return [c for c in out if c["visible"] or not visible_only]


def event_type(settings, key):
    """Type d'entrée du journal associé à une colonne (intégrée : seance/travail/oubli ; personnalisée : son id)."""
    return BUILTIN_EVENT.get(key, key)


def type_label(settings, event_type_):
    """Nom lisible d'un type d'entrée du journal (pour la fiche élève)."""
    for key in ("travail", "oubli") + GRADE_KEYS:
        if event_type_ == key:
            return builtin(settings, key)["titre"]
    if event_type_ == "seance":
        return "Séance"
    for col in customs(settings):
        if col["id"] == event_type_:
            return col["titre"]
    return event_type_
