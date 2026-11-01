"""Échanges de tableaux avec PRONOTE (et tout tableur) : analyse de texte collé ou de fichiers
texte, association de colonnes, lecture des notes avec les annotations PRONOTE, export.

Fonctions pures (aucune interface) : faciles à tester et à lire.
"""
import re
import unicodedata


def norm(s):
    """Minuscules, sans accents, tirets/apostrophes/espaces ramenés à un espace."""
    s = unicodedata.normalize("NFD", str(s if s is not None else ""))
    s = "".join(c for c in s if not unicodedata.combining(c)).lower()
    return re.sub(r"[-_'’\s]+", " ", s).strip()


def detect_delimiter(text):
    """PRONOTE copie les listes avec des tabulations ; les fichiers texte peuvent utiliser ; ou ,"""
    first = text.lstrip("﻿").splitlines()[0] if text.strip() else ""
    for d in ("\t", ";", ","):
        if d in first:
            return d
    return "\t"


def parse_table(text, delim=None):
    """Analyse CSV/TSV avec guillemets (les retours à la ligne dans une cellule sont gérés)."""
    text = text.lstrip("﻿")
    delim = delim or detect_delimiter(text)
    rows, row, cell, quoted, i = [], [], "", False, 0
    while i < len(text):
        c = text[i]
        if quoted:
            if c == '"':
                if text[i + 1:i + 2] == '"':
                    cell += '"'
                    i += 1
                else:
                    quoted = False
            else:
                cell += c
        elif c == '"' and cell == "":
            quoted = True
        elif c == delim:
            row.append(cell)
            cell = ""
        elif c in "\r\n":
            if c == "\r" and text[i + 1:i + 2] == "\n":
                i += 1
            row.append(cell)
            rows.append(row)
            row, cell = [], ""
        else:
            cell += c
        i += 1
    if cell != "" or row:
        row.append(cell)
        rows.append(row)
    return [[c.strip() for c in r] for r in rows if any(c.strip() for c in r)]


ROLES = [
    ("ignore", "Champ ignoré"), ("nom", "Nom"), ("prenom", "Prénom"), ("nomprenom", "Nom et prénom"),
    ("classe", "Classe"), ("naissance", "Date de naissance"), ("infos", "Infos (PAI…)"),
    ("note1", "Note T1"), ("note2", "Note T2"), ("note3", "Note T3"),
    ("comm1", "Appréciation T1"), ("comm2", "Appréciation T2"), ("comm3", "Appréciation T3"),
]


def guess_role(header, default_t=1):
    """Devine le rôle d'une colonne d'après son titre ; default_t = trimestre si le titre n'en précise pas."""
    h = norm(header)
    m = re.search(r"\b(?:t|trimestre\s*)([123])\b", h) or re.search(r"\b([123])\s*(?:er|e|eme|d)?\s*trimestre\b", h)
    t = m.group(1) if m else str(default_t or 1)
    if re.fullmatch(r"nom et prenom|eleve|nom prenom|nom complet", h):
        return "nomprenom"
    if re.fullmatch(r"nom( de famille| usuel)?", h):
        return "nom"
    if "prenom" in h:
        return "prenom"
    if h.startswith("classe"):
        return "classe"
    if re.match(r"ne\(e\) le|ne le", h) or "naissance" in h:
        return "naissance"
    if re.search(r"appreciation|commentaire|observation", h):
        return "comm" + t
    if re.search(r"moyenne|^note|^moy", h):
        return "note" + t
    if re.search(r"pai|handicap|^info|amenagement|particular", h):
        return "infos"
    return "ignore"


def looks_like_header(row):
    """La première ligne est-elle une ligne de titres ? (aucune cellule ne ressemble à une note)"""
    return bool(row) and all(not re.fullmatch(r"\d+([.,]\d+)?", c) for c in row) \
        and any(guess_role(c) != "ignore" for c in row)


def split_full_name(s):
    """« DUPONT Jean-Pierre » : mots en majuscules = nom ; sinon le premier mot est le nom."""
    w = s.split()
    if len(w) < 2:
        return (w[0] if w else ""), ""
    i = 0
    while i < len(w) - 1 and w[i] == w[i].upper() and re.search(r"[A-ZÀ-Ý]", w[i]):
        i += 1
    if i == 0:
        return w[0], " ".join(w[1:])
    return " ".join(w[:i]), " ".join(w[i:])


def parse_note(raw):
    """Note d'un tableur PRONOTE : virgule décimale, « /20 » toléré, annotations PRONOTE
    (A, D, N, I, R, Abs, Disp, N.Not, Inap, N.Rdu = non comptées ; Z, W, Abs*, N.Rdu* = comptées 0).
    Retourne (valeur, genre) avec genre dans empty / note / zero / annotation / invalid."""
    s = str(raw if raw is not None else "").strip()
    if s == "":
        return None, "empty"
    t = re.sub(r"/\s*\d+([.,]\d+)?$", "", re.sub(r"\s", "", s)).replace(",", ".")
    try:
        return float(t), "note"
    except ValueError:
        pass
    if re.fullmatch(r"(?i)z|w|abs\*|n\.?\s*rdu\*", s):
        return 0.0, "zero"
    if re.fullmatch(r"(?i)a|d|n|i|r|abs|disp|n\.?\s*not|inap|n\.?\s*rdu", s):
        return None, "annotation"
    return None, "invalid"


def _key(nom, prenom):
    return norm(nom) + "|" + norm(prenom)


def apply_table(classes, rows, roles, skip, class_id, create_students, new_student, new_class):
    """Applique un tableau à des classes (modifiées en place) et retourne un compte rendu.

    roles : un rôle par colonne ; skip : nombre de lignes de titres ; class_id : classe courante
    (ou None) ; new_student(nom, prenom, infos) et new_class(nom) fabriquent les objets.
    """
    rep = {"classes": {}, "created": 0, "updated": 0, "unchanged": 0, "createdClasses": 0,
           "unmatched": [], "invalid": []}

    def get(row, role):
        return row[roles.index(role)] if role in roles and roles.index(role) < len(row) else ""

    current = next((c for c in classes if c["id"] == class_id), None)
    for row in rows[skip:]:
        nom, prenom = get(row, "nom"), get(row, "prenom")
        if not nom and "nomprenom" in roles:
            nom, prenom = split_full_name(get(row, "nomprenom"))
        if not nom:
            continue
        cls = current
        cname = get(row, "classe")
        if cname:
            cls = next((c for c in classes if norm(c["nom"]) == norm(cname)), None)
            if cls is None and create_students:
                cls = new_class(cname)
                classes.append(cls)
                rep["createdClasses"] += 1
        if cls is None:
            rep["unmatched"].append(f"{nom} {prenom}".strip())
            continue
        naiss = get(row, "naissance")
        # deux homonymes se distinguent par leur date de naissance (si elle est connue des deux côtés)
        s = next((e for e in cls["eleves"] if _key(e["nom"], e["prenom"]) == _key(nom, prenom)
                  and not (naiss and e.get("naissance") and e["naissance"] != naiss)), None)
        is_new = False
        if s is None:
            if not create_students:
                rep["unmatched"].append(f"{nom} {prenom}".strip())
                continue
            s = new_student(nom, prenom, "")
            cls["eleves"].append(s)
            is_new = True
            rep["created"] += 1
        changed = False
        if naiss and naiss != s.get("naissance"):
            s["naissance"] = naiss
            changed = not is_new
        infos = get(row, "infos")
        if infos and infos != s["infos"]:
            s["infos"] = infos
            changed = True
        for t in "123":
            if "note" + t in roles:
                raw = get(row, "note" + t)
                value, kind = parse_note(raw)
                if kind == "invalid":
                    rep["invalid"].append(f"{s['nom']} {s['prenom']} : « {raw} »")
                elif kind != "empty" and s["notes"][t] != value and value is not None:
                    s["notes"][t] = value
                    changed = True
            if "comm" + t in roles:
                c = get(row, "comm" + t)
                if c and c != s["comms"][t]:
                    s["comms"][t] = c
                    changed = True
        rep["classes"][cls["nom"]] = rep["classes"].get(cls["nom"], 0) + 1
        if not is_new:
            rep["updated" if changed else "unchanged"] += 1
    return rep


EXPORT_FIELDS = [
    ("numero", "N°"), ("nom", "Nom"), ("prenom", "Prénom"), ("classe", "Classe"), ("infos", "Infos (PAI…)"),
    ("note", "Note du trimestre"), ("comm", "Appréciation du trimestre"),
    ("seancePlus", "Séance +"), ("seanceMoins", "Séance −"), ("travail", "Travail non fait"), ("oubli", "Oublis de matériel"),
]
_PER_TRIMESTER = {"note", "comm", "seancePlus", "seanceMoins", "travail", "oubli"}


def fmt_num(n):
    """14.5 -> « 14,5 » ; 3.0 -> « 3 »."""
    n = round(float(n) * 100) / 100
    return (str(int(n)) if n == int(n) else str(n)).replace(".", ",")


def build_export(cls, fields, t, header, delim, max_len, stats):
    """Construit le texte d'export. stats(eleve, t) -> (séance +, séance −, travail, oublis).
    Retourne (texte, appréciations trop longues)."""
    labels = dict(EXPORT_FIELDS)

    def q(v):
        s = re.sub(r"\r?\n", " ", str("" if v is None else v))
        return '"' + s.replace('"', '""') + '"' if delim in s or '"' in s else s

    lines, too_long = [], []
    if header:
        lines.append(delim.join(q(labels[f] + (f" T{t}" if f in _PER_TRIMESTER else "")) for f in fields))
    for s in cls["eleves"]:
        plus, moins, travail, oubli = stats(s, int(t))
        note = s["notes"][str(t)]
        comm = s["comms"][str(t)]
        v = {"numero": s.get("numero") or "", "nom": s["nom"], "prenom": s["prenom"], "classe": cls["nom"], "infos": s["infos"],
             "note": "" if note is None else fmt_num(note), "comm": comm,
             "seancePlus": fmt_num(plus), "seanceMoins": fmt_num(moins), "travail": travail, "oubli": oubli}
        if max_len and "comm" in fields and len(comm) > max_len:
            too_long.append(f"{s['nom']} {s['prenom']} ({len(comm)})")
        lines.append(delim.join(q(v[f]) for f in fields))
    return "\r\n".join(lines), too_long


def read_text_file(path):
    """Lit un fichier texte exporté de PRONOTE ou d'Excel : UTF-8 (avec ou sans BOM) ou Windows-1252."""
    from pathlib import Path
    data = Path(path).read_bytes()
    try:
        return data.decode("utf-8-sig")
    except UnicodeDecodeError:
        return data.decode("cp1252", errors="replace")
