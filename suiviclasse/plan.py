"""Plan de classe : salles (plans génériques de places) et répartitions des élèves d'une classe dans une salle.

Données (rangées dans les données chiffrées) :
    state["salles"]  = [salle, …]
    salle  = {"id", "nom", "place": {"w", "h"}, "places": [{"id", "x", "y"}, …], "reperes": [{"id", "texte", "x", "y", "w", "h", "angle"}, …]}
             Les places ont toutes la même taille (« place » : chaise + bureau) ; les repères (tableau, bureau du professeur,
             porte…) sont des rectangles étiquetés où l'on ne place personne ; « angle » (0 ou 90) est l'orientation du texte.
             Coordonnées en pixels, à 100 % de zoom. Par défaut le tableau et le bureau sont en bas du plan : on regarde la classe
             comme le professeur, qui lui fait face.
    classe["plans"]       = [plan, …]        plusieurs répartitions possibles (par trimestre, par chapitre…)
    classe["plan_actif"]  = id de la répartition affichée
    plan   = {"id", "nom", "salle": id de la salle, "places": {id de la place: id de l'élève}}
"""
import random
import re

from .exchange import norm
from .model import uid

PLACE_W, PLACE_H = 168, 92
GRID = 10  # pas d'alignement dans l'éditeur
DISPLAY_MODES = [("prenom_nom", "Prénom Nom"), ("prenom", "Prénom"), ("nom", "Nom"),
                 ("prenom_i", "Prénom + initiale du nom"), ("initiales", "Initiales")]
MARKERS = ["Tableau", "Bureau du professeur", "Porte", "Fenêtre"]


# ---------------------------------------------------------------- noms affichés
def display_name(student, mode="prenom_nom"):
    prenom, nom = student.get("prenom", "").strip(), student.get("nom", "").strip()
    cap = nom.title() if nom.isupper() else nom  # « DUPONT » s'affiche « Dupont »
    if mode == "prenom":
        return prenom or cap
    if mode == "nom":
        return cap or prenom
    if mode == "initiales":
        return (prenom[:1] + nom[:1]).upper() or "?"
    if mode == "prenom_i":
        return (f"{prenom} {nom[:1].upper()}." if nom else prenom).strip()
    return f"{prenom} {cap}".strip()


# ---------------------------------------------------------------- salles
def new_salle(nom="Nouvelle salle"):
    return {"id": uid(), "nom": nom, "place": {"w": PLACE_W, "h": PLACE_H}, "places": [], "reperes": []}


def add_place(salle, x, y):
    p = {"id": uid(), "x": int(x), "y": int(y)}
    salle["places"].append(p)
    return p


def marker_size(texte):
    """Dimensions par défaut d'un repère selon son nom."""
    return (360, 34) if texte == "Tableau" else (260, 34) if "Bureau" in texte else (130, 34)


def add_marker(salle, texte, x, y, w=None, h=None, angle=0):
    dw, dh = marker_size(texte)
    m = {"id": uid(), "texte": texte, "x": int(x), "y": int(y), "w": int(w or dw), "h": int(h or dh), "angle": angle}
    salle["reperes"].append(m)
    return m


def next_marker_spot(salle, w, h):
    """Emplacement d'un nouveau repère : en bas du plan, sous les places, à la suite des repères déjà posés sur cette bande."""
    bottom = max((p["y"] + salle["place"]["h"] for p in salle["places"]), default=40)
    y = bottom + 30
    band = [m for m in salle["reperes"] if m["y"] >= bottom]
    x = max((m["x"] + m["w"] + 20 for m in band), default=40)
    return x, y


def add_rows(salle, rows, cols, x0=40, y0=40, gap_x=14, gap_y=22, pair_gap=0, group=1):
    """Rangées de places (lignes × colonnes). `group` : nombre de places côte à côte avant un espace plus large `pair_gap`
    (2 = binômes). Retourne les places créées."""
    w, h = salle["place"]["w"], salle["place"]["h"]
    out = []
    for r in range(rows):
        x = x0
        for c in range(cols):
            if c and group > 1 and c % group == 0:
                x += pair_gap
            out.append(add_place(salle, x, y0 + r * (h + gap_y)))
            x += w + gap_x
    return out


def add_islands(salle, rows, cols, per_row=2, per_col=2, x0=40, y0=40, gap_x=6, gap_y=6, island_gap=40):
    """Îlots de `per_row` × `per_col` places collées, disposés en `rows` × `cols` îlots."""
    w, h = salle["place"]["w"], salle["place"]["h"]
    iw, ih = per_row * w + (per_row - 1) * gap_x, per_col * h + (per_col - 1) * gap_y
    out = []
    for ir in range(rows):
        for ic in range(cols):
            ox, oy = x0 + ic * (iw + island_gap), y0 + ir * (ih + island_gap)
            for j in range(per_col):
                for i in range(per_row):
                    out.append(add_place(salle, ox + i * (w + gap_x), oy + j * (h + gap_y)))
    return out


def snap(v, grid=GRID):
    return int(round(v / grid) * grid)


def bounds(salle, margin=40):
    """Taille (largeur, hauteur) nécessaire pour afficher toute la salle."""
    w, h = salle["place"]["w"], salle["place"]["h"]
    xs = [p["x"] + w for p in salle["places"]] + [m["x"] + m["w"] for m in salle["reperes"]]
    ys = [p["y"] + h for p in salle["places"]] + [m["y"] + m["h"] for m in salle["reperes"]]
    return max(xs, default=400) + margin, max(ys, default=300) + margin


def front_is_bottom(salle):
    """Le tableau est-il sous les places (point de vue du professeur) ? Alors le devant de la classe est en bas du plan."""
    if not salle["places"]:
        return False
    mean = sum(p["y"] for p in salle["places"]) / len(salle["places"])
    return any(norm(m["texte"]) == "tableau" and m["y"] > mean for m in salle["reperes"])


def reading_order(salle):
    """Identifiants des places dans l'ordre de remplissage : rangée par rangée en partant du côté du tableau
    (le devant de la classe), de gauche à droite."""
    h = salle["place"]["h"]
    rows = sorted(salle["places"], key=lambda p: (round(p["y"] / (h * 0.6)), p["x"]))
    if front_is_bottom(salle):  # rangées du bas vers le haut, chaque rangée de gauche à droite
        rows = sorted(salle["places"], key=lambda p: (-round(p["y"] / (h * 0.6)), p["x"]))
    return [p["id"] for p in rows]


def find(salles, salle_id):
    return next((s for s in salles if s["id"] == salle_id), None)


def demo_salle():
    """Salle d'exemple, vue du professeur : trois rangées de quatre places, le tableau et le bureau en bas du plan."""
    s = new_salle("Salle d'exemple")
    add_rows(s, 3, 4)
    width = 4 * s["place"]["w"] + 3 * 14
    x, y = next_marker_spot(s, 360, 34)
    add_marker(s, "Tableau", x + (width - 360) // 2 - 120, y)
    bureau = marker_size("Bureau du professeur")[0]
    add_marker(s, "Bureau du professeur", x + width - bureau, y)
    return s


# ---------------------------------------------------------------- répartitions
def new_plan(nom, salle_id):
    return {"id": uid(), "nom": nom, "salle": salle_id, "places": {}}


def plans(cls):
    return cls.setdefault("plans", [])


def active_plan(cls):
    """Répartition affichée de la classe (la première si aucune n'est choisie), ou None."""
    lst = cls.get("plans") or []
    return next((p for p in lst if p["id"] == cls.get("plan_actif")), lst[0] if lst else None)


def place_of(plan, student_id):
    return next((p for p, s in plan["places"].items() if s == student_id), None)


def unassign(plan, student_id):
    for p in [p for p, s in plan["places"].items() if s == student_id]:
        del plan["places"][p]


def assign(plan, place_id, student_id):
    """Place l'élève ; s'il y a déjà quelqu'un, les deux échangent leur place (ou l'occupant n'a plus de place si l'élève n'en avait pas)."""
    origin = place_of(plan, student_id)
    occupant = plan["places"].get(place_id)
    if occupant == student_id:
        return
    unassign(plan, student_id)
    if occupant is not None and origin is not None:
        plan["places"][origin] = occupant
    plan["places"][place_id] = student_id


def clean(plan, salle, cls):
    """Retire de la répartition les places qui n'existent plus dans la salle et les élèves supprimés ou en double.
    Sans salle (supprimée, ou pas encore choisie), rien n'est touché : les placements sont conservés."""
    if salle is None:
        return
    ids = {p["id"] for p in salle["places"]}
    students = {s["id"] for s in cls["eleves"]}
    seen = set()
    for place_id, sid in list(plan["places"].items()):
        if place_id not in ids or sid not in students or sid in seen:
            del plan["places"][place_id]
        else:
            seen.add(sid)


def without_place(plan, cls):
    """Élèves de la classe sans place, dans l'ordre alphabétique des noms (puis des prénoms)."""
    placed = set(plan["places"].values())
    return sorted((s for s in cls["eleves"] if s["id"] not in placed), key=lambda s: (norm(s["nom"]), norm(s["prenom"])))


def list_name(s):
    """« NOM Prénom » : libellé des listes d'élèves (nom en majuscules)."""
    return f"{s['nom'].upper()} {s['prenom']}".strip()


def auto_fill(plan, salle, cls, mode="alpha", keep=True, rng=None):
    """Répartit les élèves dans les places libres de la salle.
    mode : « alpha » (ordre alphabétique, rangée par rangée) ou « hasard ». keep : garder les élèves déjà placés.
    Retourne le nombre d'élèves qui n'ont pas pu être placés (plus d'élèves que de places)."""
    if not keep:
        plan["places"].clear()
    clean(plan, salle, cls)
    free = [p for p in reading_order(salle) if p not in plan["places"]]
    students = without_place(plan, cls)
    if mode == "hasard":
        (rng or random).shuffle(students)
    for place_id, s in zip(free, students):
        plan["places"][place_id] = s["id"]
    return max(0, len(students) - len(free))


# ---------------------------------------------------------------- boutons d'incrément
def primary_increment(increments):
    """Incrément appliqué par un clic sur la pastille d'un compteur : le premier positif, sinon le premier."""
    return next((v for v in increments if v > 0), increments[0] if increments else 1)


def initial_text(text):
    """Première lettre en capitale d'un titre de colonne (repli quand une colonne n'a pas de pictogramme)."""
    m = re.search(r"\w", norm(text))
    return m.group(0).upper() if m else "?"


# ---------------------------------------------------------------- éditeur de salle
def next_free_spot(salle, max_width=1100):
    """Premier emplacement libre (au pas de la grille de places) pour ajouter une place sans en recouvrir une autre."""
    w, h = salle["place"]["w"], salle["place"]["h"]
    step_x, step_y = w + 14, h + 22
    y = 80
    for _ in range(60):
        x = 40
        while x + w <= max_width:
            if not any(abs(p["x"] - x) < w and abs(p["y"] - y) < h for p in salle["places"]):
                return x, y
            x += step_x
        y += step_y
    return 40, y


def align(items, how):
    """Aligne ou répartit des éléments (places ou repères, dictionnaires avec x, y) : left, top, hspace, vspace."""
    if len(items) < 2:
        return
    if how == "left":
        x = min(i["x"] for i in items)
        for i in items:
            i["x"] = x
    elif how == "top":
        y = min(i["y"] for i in items)
        for i in items:
            i["y"] = y
    elif how in ("hspace", "vspace") and len(items) > 2:
        key = "x" if how == "hspace" else "y"
        ordered = sorted(items, key=lambda i: i[key])
        lo, hi = ordered[0][key], ordered[-1][key]
        for n, i in enumerate(ordered):
            i[key] = snap(lo + (hi - lo) * n / (len(ordered) - 1))


def copy_salle(salle, nom):
    """Copie d'une salle avec de nouveaux identifiants (les répartitions de l'original ne s'appliquent pas à la copie)."""
    out = {"id": uid(), "nom": nom, "place": dict(salle["place"]),
           "places": [{**p, "id": uid()} for p in salle["places"]], "reperes": [{**m, "id": uid()} for m in salle["reperes"]]}
    return out


# ---------------------------------------------------------------- repères : taille et orientation
MIN_MARKER = 20
CORNERS = ("nw", "ne", "sw", "se")


def resize_marker(m, corner, px, py):
    """Déplace un coin du repère jusqu'au point (px, py) (coordonnées du plan, alignées sur la grille) ; taille minimale 20."""
    px, py = snap(px), snap(py)
    x0, y0, x1, y1 = m["x"], m["y"], m["x"] + m["w"], m["y"] + m["h"]
    if "w" in corner:
        x0 = min(px, x1 - MIN_MARKER)
    else:
        x1 = max(px, x0 + MIN_MARKER)
    if corner.startswith("n"):
        y0 = min(py, y1 - MIN_MARKER)
    else:
        y1 = max(py, y0 + MIN_MARKER)
    m["x"], m["y"], m["w"], m["h"] = max(0, x0), max(0, y0), x1 - max(0, x0), y1 - max(0, y0)


def rotate_marker(m):
    """Pivote un repère de 90° autour de son centre : largeur et hauteur s'échangent, le texte passe de l'horizontal au vertical (et inversement)."""
    cx, cy = m["x"] + m["w"] / 2, m["y"] + m["h"] / 2
    m["w"], m["h"] = m["h"], m["w"]
    m["x"], m["y"] = max(0, snap(cx - m["w"] / 2)), max(0, snap(cy - m["h"] / 2))
    m["angle"] = 90 if m.get("angle", 0) == 0 else 0


def rotate_room(salle):
    """Retourne toute la salle de 180° (places et repères) : passer du point de vue des élèves à celui du professeur, ou l'inverse.
    Le texte des repères reste lisible."""
    w, h = salle["place"]["w"], salle["place"]["h"]
    items = [(p, w, h) for p in salle["places"]] + [(m, m["w"], m["h"]) for m in salle["reperes"]]
    if not items:
        return
    lo_x, hi_x = min(i["x"] for i, _, _ in items), max(i["x"] + iw for i, iw, _ in items)
    lo_y, hi_y = min(i["y"] for i, _, _ in items), max(i["y"] + ih for i, _, ih in items)
    for i, iw, ih in items:
        i["x"], i["y"] = lo_x + hi_x - (i["x"] + iw), lo_y + hi_y - (i["y"] + ih)


def add_demo_plan(data, cls):
    """Ajoute (si besoin) la salle d'exemple et une répartition alphabétique de `cls` dedans (classe « Test »)."""
    salles = data.setdefault("salles", [])
    salle = next((s for s in salles if s["nom"] == "Salle d'exemple"), None)
    if salle is None:
        salle = demo_salle()
        salles.append(salle)
    p = new_plan("Plan d'exemple", salle["id"])
    auto_fill(p, salle, cls, "alpha")
    cls.setdefault("plans", []).append(p)
    cls["plan_actif"] = p["id"]
    return p
