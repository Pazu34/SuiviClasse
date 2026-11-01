"""Données de l'application : de simples dictionnaires (ce qui est écrit dans le coffre chiffré)
et quelques fonctions de calcul.

    {"version": 1, "settings": {"annee": ""}, "classes": [classe, …], "ui": {"classe": id, "trimestre": 1}}
    classe = {"id", "nom", "eleves": [eleve, …]}
    eleve  = {"id", "nom", "prenom", "numero", "naissance", "infos", "extra",
              "notes": {"1": 14.5 | None, "2": …, "3": …}, "comms": {"1": "", …}, "events": [evenement, …]}
    evenement = {"id", "type": "seance" | "travail" | "oubli", "t": 1..3, "v": ±0.5, ±1 (séance) ou 1,
                 "date": ISO 8601 UTC, "note": ""}
Les notes et commentaires sont indexés par le numéro de période écrit en texte ("1", "2", "3") : trimestres 1 à 3,
ou semestres 1 et 2 (préférence « Découpage de l'année » ; la 3e période est alors masquée mais conservée).
"""
import secrets
from datetime import datetime, timezone

from .exchange import fmt_num, norm

def periods(mode):
    """Découpage de l'année choisi dans les préférences : trimestres (T1 à T3) ou semestres (S1 et S2)."""
    prefix, word, n = {"semestres": ("S", "semestre", 2)}.get(mode, ("T", "trimestre", 3))
    return {"mode": "semestres" if n == 2 else "trimestres", "prefix": prefix, "word": word, "n": n,
            "keys": [str(i) for i in range(1, n + 1)]}


TYPES = {"seance": "Séance", "travail": "Travail non fait", "oubli": "Oubli de matériel"}


def uid():
    return secrets.token_hex(5)


DEMO_NAME = "Test"


def new_data():
    """Données d'un nouveau coffre : une classe d'essai (voir demo_class) pour découvrir le programme."""
    demo = demo_class()
    return {"version": 1, "settings": {"annee": ""}, "classes": [demo], "ui": {"classe": demo["id"], "trimestre": 1}}


def new_class(nom):
    return {"id": uid(), "nom": nom.strip(), "eleves": []}


def new_student(nom, prenom="", infos=""):
    return {"id": uid(), "nom": nom.strip(), "prenom": prenom.strip(), "numero": None, "naissance": "", "infos": infos,
            "notes": {"1": None, "2": None, "3": None}, "comms": {"1": "", "2": "", "3": ""}, "events": [], "extra": {}}


# (nom, prénom, infos, note T1, commentaire T1, oublis, travail non fait, points de séance)
_DEMO = [
    ("ANDRÉ", "Léa", "PAI asthme (exemple)", 14.5, "Bon début de trimestre, élève sérieuse.", 0, 0, [1, 0.5, 1]),
    ("BERNARD", "Zoé", "", 11, "Participe volontiers, doit soigner la présentation.", 2, 1, [0.5, -0.5]),
    ("CHARPENTIER", "Lucas", "Dyslexie, tiers temps (exemple)", 9.5, "Des difficultés à rester concentré, à encourager.", 3, 3, [-1, -0.5, 0.5]),
    ("DUBOIS", "Emma", "", 17, "Très bon travail.", 0, 0, [1, 1, 1, 0.5]),
    ("FONTAINE", "Jules", "", 12, "Peut mieux faire : manque de régularité.", 1, 2, [0.5, -0.5, -0.5]),
    ("GARCIA", "Inès", "Suivi PAP (exemple)", 13, "", 1, 0, [1, 0.5]),
    ("HENRY", "Noah", "", None, "", 4, 2, [-1]),
    ("LAMBERT", "Chloé", "", 19, "Excellente élève, très impliquée.", 0, 0, [1, 1, 1]),
]


def demo_class():
    """Classe « Test » avec des élèves fictifs et quelques données, pour essayer le programme.
    Elle se supprime comme n'importe quelle classe (bouton « Supprimer la classe »)."""
    cls = new_class(DEMO_NAME)
    for nom, prenom, infos, note, comm, oublis, travail, seance in _DEMO:
        s = new_student(nom, prenom, infos)
        s["notes"]["1"], s["comms"]["1"] = note, comm
        for _ in range(oublis):
            add_event(s, "oubli", 1, 1)
        for _ in range(travail):
            add_event(s, "travail", 1, 1)
        for v in seance:
            add_event(s, "seance", 1, v)
        cls["eleves"].append(s)
    sort_students(cls)
    ensure_numbers(cls)
    return cls


def sort_students(cls):
    cls["eleves"].sort(key=lambda s: (norm(s["nom"]), norm(s["prenom"])))


def ensure_numbers(cls):
    """Donne un n° aux élèves qui n'en ont pas (dans l'ordre de la liste), sans toucher à ceux qui en ont un."""
    used = [s["numero"] for s in cls["eleves"] if isinstance(s.get("numero"), int)]
    nxt = max(used, default=0) + 1
    for s in cls["eleves"]:
        if not isinstance(s.get("numero"), int):
            s["numero"] = nxt
            nxt += 1


def duplicate_numbers(cls):
    """Ensemble des n° utilisés par plusieurs élèves de la classe."""
    seen, dups = set(), set()
    for s in cls["eleves"]:
        n = s.get("numero")
        if n is not None:
            (dups if n in seen else seen).add(n)
    return dups


def sort_classes(data):
    data["classes"].sort(key=lambda c: norm(c["nom"]))


def _clean(x):
    x = round(x, 2)
    return int(x) if x == int(x) else x


def total(student, type_, t):
    """Total d'une colonne à compteur sur la période t : somme des incréments enregistrés au journal."""
    return _clean(sum(e["v"] for e in student["events"] if e["type"] == type_ and e["t"] == t))


count = total  # nom historique : « travail non fait » et « oublis » étaient de simples nombres d'entrées


def seance(student, t):
    """(total des points positifs, total des points négatifs) du trimestre."""
    vals = [e["v"] for e in student["events"] if e["type"] == "seance" and e["t"] == t]
    return sum(v for v in vals if v > 0), sum(v for v in vals if v < 0)


def stats(student, t):
    plus, moins = seance(student, t)
    return plus, moins, count(student, "travail", t), count(student, "oubli", t)


def moyenne(student, n=3):
    """Moyenne des notes des n premières périodes (celles qui sont renseignées)."""
    vals = [v for k, v in student["notes"].items() if v is not None and int(k) <= n]
    return sum(vals) / len(vals) if vals else None


def add_event(student, type_, t, v, note=""):
    student["events"].append({"id": uid(), "type": type_, "t": t, "v": v, "note": note,
                              "date": datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")})


def set_total(student, type_, t, target):
    """Amène le total d'une colonne à compteur à `target` par une entrée « Ajustement manuel » (la différence)."""
    diff = round(float(target) - total(student, type_, t), 2)
    if abs(diff) > 1e-9:
        add_event(student, type_, t, diff, "Ajustement manuel")


set_count = set_total


def set_seance_total(student, t, bucket, target):
    """Amène le total de séance « plus » ou « moins » (valeur absolue) à `target`.
    Pour monter : une entrée d'ajustement. Pour descendre : on retire les dernières entrées du même signe
    et, si on a retiré trop, on remet la différence."""
    sign = 1 if bucket == "plus" else -1
    plus, moins = seance(student, t)
    cur = plus if sign > 0 else -moins
    target = round(float(target), 2)
    if abs(target - cur) < 1e-9:
        return
    if target > cur:
        add_event(student, "seance", t, sign * round(target - cur, 2), "Ajustement manuel")
        return
    need, removed = round(cur - target, 2), 0.0
    for i in range(len(student["events"]) - 1, -1, -1):
        if removed >= need - 1e-9:
            break
        e = student["events"][i]
        if e["type"] == "seance" and e["t"] == t and e["v"] * sign > 0:
            removed += abs(e["v"])
            del student["events"][i]
    if removed > need + 1e-9:
        add_event(student, "seance", t, sign * round(removed - need, 2), "Ajustement manuel")


def get_extra(student, col_id, t, default=None):
    """Valeur d'une colonne personnalisée (note, texte ou case) pour la période t."""
    return (student.get("extra") or {}).get(col_id, {}).get(str(t), default)


def set_extra(student, col_id, t, value):
    """Enregistre la valeur ; None (ou texte vide) l'efface."""
    if value is None or value == "":
        (student.get("extra") or {}).get(col_id, {}).pop(str(t), None)
    else:
        student.setdefault("extra", {}).setdefault(col_id, {})[str(t)] = value


def rescale_notes(data, old, new):
    """Convertit les notes des trimestres d'un barème à un autre (/20 -> /10 : ×0,5). Retourne le nombre de notes changées."""
    n = 0
    for cls in data["classes"]:
        for s in cls["eleves"]:
            for k, v in s["notes"].items():
                if v is not None:
                    s["notes"][k] = round(v * new / old, 2)
                    n += 1
    return n


def rescale_extra(data, col_id, old, new):
    """Idem pour une colonne personnalisée de type note."""
    n = 0
    for cls in data["classes"]:
        for s in cls["eleves"]:
            for k, v in (s.get("extra") or {}).get(col_id, {}).items():
                if isinstance(v, (int, float)):
                    s["extra"][col_id][k] = round(v * new / old, 2)
                    n += 1
    return n


_YES = {"oui", "vrai", "x", "1", "true", "✓", "✔", "☑"}


def coerce_extra(value, typ):
    """Valeur lisible selon le type actuel de la colonne. Si l'on change le type d'une colonne, les valeurs déjà saisies
    sont conservées et reprises quand elles sont compatibles (note ↔ texte ↔ menu, case) ; sinon elles sont ignorées."""
    if value is None or value == "":
        return None
    if typ == "note":
        if isinstance(value, bool):
            return None
        if isinstance(value, (int, float)):
            return value
        try:
            return float(str(value).strip().replace(",", "."))
        except ValueError:
            return None
    if typ in ("texte", "liste"):
        if value is True:
            return "oui"
        if value is False:
            return None
        return fmt_num(value) if isinstance(value, (int, float)) else str(value)
    if typ == "coche":
        if isinstance(value, (int, float)):
            return True if value else None
        return True if value is True or str(value).strip().lower() in _YES else None
    return value


def extra_value(student, col, t):
    """Valeur d'une colonne personnalisée (dictionnaire de configuration `col`) pour la période t, selon son type."""
    return coerce_extra(get_extra(student, col["id"], t), col["type"])


def remove_last(student, type_, t):
    for i in range(len(student["events"]) - 1, -1, -1):
        e = student["events"][i]
        if e["type"] == type_ and e["t"] == t:
            del student["events"][i]
            return


def event_datetime(event):
    """Date locale d'un événement."""
    return datetime.fromisoformat(event["date"].replace("Z", "+00:00")).astimezone()


def level(n, orange, rouge):
    """Couleur d'un compteur : 'ok' (0), 'warn' (≥ orange), 'bad' (≥ rouge) ou '' ."""
    return "bad" if n >= rouge else "warn" if n >= orange else "ok" if n == 0 else ""
