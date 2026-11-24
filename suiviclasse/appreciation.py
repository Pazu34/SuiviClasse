"""Assistant d'appréciation de bulletin : mots-clés notés en cours de période, phrases types, accords selon le genre.

Données (dans le fichier chiffré, communes au PC et à la tablette) :
  - par élève : des entrées du journal de type « mot:<identifiant du mot-clé> » (date, période) et, facultativement, « genre » ('f' ou 'm') ;
  - dans les réglages : « appreciation », la banque de phrases (voir default_bank). Absente, elle vaut la banque par défaut.

Syntaxe des phrases types (accords) :
  {prénom}        le prénom de l'élève          {période}   « trimestre » ou « semestre »
  {il} / {Il}     il / elle  (Il / Elle)        {e}         rien ou « e »  (« attentif{ve} » s'écrit plutôt {attentif|attentive})
  {masculin|féminin}   l'un ou l'autre selon le genre : « {sérieux|sérieuse} », « {concentré|concentrée} »
Toute autre accolade est laissée telle quelle (une faute de frappe reste visible)."""
import copy
import re

from .exchange import is_number, norm

# Tranches de note, ramenées sur 20 : [0;8[ [8;10[ [10;12[ [12;14[ [14;16[ [16;20]
BAND_MINS = [0, 8, 10, 12, 14, 16]
BAND_TITLES = ["Moins de 8", "De 8 à 10", "De 10 à 12", "De 12 à 14", "De 14 à 16", "16 et plus"]
EVOLUTION_DELTA = 1.5  # écart (sur 20) à partir duquel on parle de progrès ou de baisse
KEYWORD_PREFIX = "mot:"
TONES = ("+", "-", "=")  # mot-clé positif, négatif ou neutre (couleur de la pastille)

_KEYWORDS = [
    ("materiel", "Matériel", "🎒", "-", [
        "{prénom} oublie trop souvent son matériel, ce qui gêne le travail en classe.",
        "Le matériel n'est pas toujours apporté : {il} doit être plus {rigoureux|rigoureuse}.",
        "Les oublis de matériel sont trop fréquents."]),
    ("bavardages", "Bavardages", "💬", "-", [
        "Les bavardages perturbent le travail de {prénom} et celui de ses camarades.",
        "{Il} doit limiter ses bavardages pour rester {concentré|concentrée}.",
        "Trop de bavardages en classe."]),
    ("efforts", "Efforts", "💪", "+", [
        "Des efforts sont à souligner.",
        "{prénom} fournit des efforts appréciables, qu'il faut poursuivre.",
        "Les efforts sont réels mais doivent s'inscrire dans la durée."]),
    ("participation", "Participation", "🙋", "+", [
        "{Il} participe volontiers et de façon pertinente.",
        "Bonne participation orale.",
        "{prénom} s'implique activement dans le cours."]),
    ("absences", "Absences", "📅", "-", [
        "Les absences nuisent à la continuité des apprentissages.",
        "{Il} doit rattraper les cours manqués pendant ses absences.",
        "Trop d'absences ce {période}."]),
    ("retards", "Retards", "⏰", "-", [
        "Les retards sont trop fréquents.",
        "{Il} doit faire preuve de plus de ponctualité.",
        "Des retards répétés pénalisent {prénom}."]),
    ("serieux", "Sérieux", "📚", "+", [
        "{Il} est {sérieux|sérieuse} et {investi|investie}.",
        "Élève {sérieux|sérieuse} et {appliqué|appliquée}.",
        "Le sérieux de {prénom} est apprécié."]),
    ("progres", "Progrès", "📈", "+", [
        "Des progrès encourageants sont à noter.",
        "{prénom} progresse nettement, c'est à souligner.",
        "Les progrès sont réels : il faut continuer."]),
    ("difficultes", "Difficultés", "🧩", "-", [
        "{prénom} rencontre des difficultés : il faut revoir régulièrement les leçons.",
        "Des lacunes persistent ; un travail de révision est nécessaire.",
        "{Il} ne doit pas hésiter à poser des questions."]),
    ("travail", "Travail à la maison", "🏠", "-", [
        "Le travail à la maison n'est pas fait régulièrement.",
        "Les leçons sont insuffisamment apprises.",
        "{prénom} doit s'investir davantage dans le travail personnel."]),
    ("attention", "Attention", "🎯", "-", [
        "{Il} manque d'attention en classe.",
        "L'attention de {prénom} est irrégulière.",
        "{Il} doit rester {concentré|concentrée} tout au long de l'heure."]),
    ("soin", "Soin", "✏️", "+", [
        "Un travail soigné.",
        "Le soin apporté aux cahiers est apprécié.",
        "{Il} doit soigner davantage la présentation de ses travaux."]),
    ("comportement", "Comportement", "🤝", "+", [
        "Comportement agréable et respectueux.",
        "{prénom} a une attitude positive en classe.",
        "{Il} est un élément {moteur|motrice} dans la classe."]),
]

_RESULTS = [
    ["Les résultats sont insuffisants ce {période}.", "{prénom} obtient des résultats très fragiles ce {période}.",
     "Le niveau actuel de {prénom} est préoccupant."],
    ["Les résultats sont fragiles.", "Les résultats restent insuffisants pour valider les acquis.",
     "{prénom} est en difficulté et doit consolider ses acquis."],
    ["Des résultats passables.", "Les résultats sont corrects mais peuvent progresser.", "Un niveau moyen, qui laisse place à des progrès."],
    ["Des résultats assez satisfaisants.", "Un ensemble correct : {prénom} a les moyens de faire mieux.", "Bon {période} dans l'ensemble."],
    ["De bons résultats.", "{prénom} obtient de bons résultats, c'est encourageant.", "Un bon {période}."],
    ["Excellents résultats.", "Très bon {période}, bravo.", "Des résultats remarquables."],
]

_EVOLUTION = [
    ("hausse", "En progrès", ["Résultats en progrès par rapport au {période} précédent.", "Une belle progression par rapport au {période} précédent.",
                              "{Il} progresse : c'est encourageant."]),
    ("baisse", "En baisse", ["Résultats en baisse par rapport au {période} précédent.", "Attention au relâchement : les résultats sont en retrait.",
                             "{prénom} doit se ressaisir : les résultats ont baissé."]),
    ("stable", "Stables", ["Résultats stables.", "Les résultats se maintiennent.", "Un travail régulier."]),
]

_CONCLUSIONS = [
    ["Il faut reprendre le travail de façon régulière.", "Un sursaut est indispensable le {période} prochain.",
     "{prénom} doit demander de l'aide et s'investir sans attendre."],
    ["Il faut travailler régulièrement pour combler les lacunes.", "Un travail plus soutenu est nécessaire."],
    ["Il faut poursuivre les efforts pour progresser.", "Plus de rigueur permettra de progresser."],
    ["{Il} peut progresser en travaillant avec régularité.", "À poursuivre, avec un peu plus d'investissement."],
    ["Bon travail, à poursuivre.", "Encouragements."],
    ["Félicitations !", "Félicitations pour ce {période} remarquable.", "Continuer ainsi."],
]


def default_bank():
    """Banque de phrases par défaut (copie neuve à chaque appel)."""
    return {
        "mots": [{"id": i, "titre": t, "emoji": e, "ton": ton, "phrases": list(p)} for i, t, e, ton, p in _KEYWORDS],
        "resultats": [{"id": f"r{n}", "titre": BAND_TITLES[n], "min": BAND_MINS[n], "phrases": list(_RESULTS[n])} for n in range(6)],
        "evolution": [{"id": i, "titre": t, "phrases": list(p)} for i, t, p in _EVOLUTION],
        "conclusions": [{"id": f"c{n}", "titre": BAND_TITLES[n], "min": BAND_MINS[n], "phrases": list(_CONCLUSIONS[n])} for n in range(6)],
    }


def _text(v):
    return v if isinstance(v, str) else ""


def _phrases(raw):
    out = []
    for p in raw if isinstance(raw, list) else []:
        if isinstance(p, str) and p.strip():
            out.append(" ".join(p.split()))
    return out


def sanitize_bank(raw):
    """Ramène n'importe quel objet à une banque valide : les rubriques absentes reprennent leurs valeurs par défaut, les mots-clés
    sont ceux de l'utilisateur (identifiants uniques, titre non vide, ton « + », « - » ou « = »), les phrases sont des textes non vides."""
    base = default_bank()
    raw = raw if isinstance(raw, dict) else {}
    out = {}
    mots, seen = [], set()
    src = raw.get("mots") if isinstance(raw.get("mots"), list) else base["mots"]
    for m in src:
        if not isinstance(m, dict):
            continue
        titre = " ".join(_text(m.get("titre")).split())[:40]
        ident = re.sub(r"[^a-z0-9_]", "", _text(m.get("id")).lower())[:30]
        if not titre or not ident or ident in seen:
            continue
        seen.add(ident)
        ton = m.get("ton") if m.get("ton") in TONES else "="
        mots.append({"id": ident, "titre": titre, "emoji": _text(m.get("emoji"))[:8], "ton": ton, "phrases": _phrases(m.get("phrases"))})
    out["mots"] = mots
    for key in ("resultats", "conclusions"):  # tranches de note : titres et seuils sont fixes, seules les phrases se modifient
        given = {x.get("id"): x for x in raw.get(key, []) if isinstance(x, dict)} if isinstance(raw.get(key), list) else {}
        out[key] = [{**b, "phrases": _phrases(given[b["id"]].get("phrases")) if b["id"] in given else b["phrases"]} for b in base[key]]
    given = {x.get("id"): x for x in raw.get("evolution", []) if isinstance(x, dict)} if isinstance(raw.get("evolution"), list) else {}
    out["evolution"] = [{**b, "phrases": _phrases(given[b["id"]].get("phrases")) if b["id"] in given else b["phrases"]} for b in base["evolution"]]
    return out


def bank(settings):
    """Banque de phrases en vigueur (celle des réglages, sinon celle par défaut)."""
    raw = (settings or {}).get("appreciation")
    return sanitize_bank(raw) if raw else default_bank()


def new_keyword_id(titre, bank_):
    """Identifiant libre pour un nouveau mot-clé, tiré de son titre."""
    base = re.sub(r"[^a-z0-9]", "", norm(titre))[:20] or "mot"
    ident, n = base, 2
    used = {m["id"] for m in bank_["mots"]}
    while ident in used:
        ident, n = f"{base}{n}", n + 1
    return ident


# ---------------------------------------------------------------- phrases et accords
def render(template, prenom="", genre="", period_word="trimestre"):
    """Phrase type -> texte, avec le prénom, les accords du genre ('f' ou 'm' ; autre = masculin) et le mot « trimestre » / « semestre »."""
    fem = genre == "f"

    def sub(m):
        c = m.group(1)
        if c in ("prénom", "prenom"):
            return prenom
        if c in ("période", "periode"):
            return period_word
        if c == "il":
            return "elle" if fem else "il"
        if c == "Il":
            return "Elle" if fem else "Il"
        if c == "e":
            return "e" if fem else ""
        if "|" in c:
            parts = c.split("|")
            return parts[1] if fem and len(parts) > 1 else parts[0]
        return m.group(0)

    return re.sub(r"\{([^{}]*)\}", sub, template)


# ---------------------------------------------------------------- genre
_FEM = ("emma léa jade louise chloé alice manon inès sarah lina zoé louna lola eva anna juliette clara mila rose ambre océane margaux maëlys lucie léna "
        "jeanne romane adèle charlotte agathe capucine élise éloïse emilie marie julie laura pauline mathilde noémie lou nina ella maëlle mélissa célia "
        "anaïs yasmine samia amina fatima aya salma sara nour meryem imane lilou elsa gabrielle victoria valentine candice axelle justine marine morgane "
        "laurine ophélie lisa maya nathalie sophie isabelle katia kenza leïla maëva naïa elena giulia sofia sophia olivia zélie apolline héloïse angèle "
        "anouk ayla livia mia lana tess thaïs cléa clémence constance joséphine garance iris lya lily lyna maïlys mélina méline elisa eléa lena océane "
        "assia khadija maria marwa nadia rania sirine soumaya wissal zahra amélie audrey aurélie bérénice carla céline christine claire cécile delphine "
        "dorine emmanuelle estelle fanny flavie florence hélène inaya jasmine johanna laetitia léonie liv louane lorie lucille magali maëlie margot "
        "mélanie myriam nolwenn orane pénélope perrine rachel raphaëlle romy salomé stella suzanne sylvie tiphaine ysée yasmina").split()
_MASC = ("gabriel louis raphaël jules adam lucas léo hugo arthur nathan liam ethan paul tom théo noah mohamed maxime antoine alexandre thomas nicolas baptiste "
         "clément enzo mathis mathéo victor axel rayan yanis ilyes amine ismaël youssef karim bilal samuel samy noé timéo evan gabin tristan lény maël eliott "
         "esteban martin oscar valentin romain quentin kévin julien florian pierre jean jacques daniel david dylan anthony lilian matteo marius augustin "
         "basile côme ulysse hector pablo diego lorenzo nolan naël ayoub anis adrien aurélien benjamin bastien charles corentin damien fabien guillaume "
         "henri ibrahim jérémy jonathan kylian léon loïc louka mehdi mickaël nils olivier rémi robin simon stéphane théodore vincent wassim yann yassine "
         "zakaria elias ilan isaac abdel alexis alan alban ali amir andré bruno cédric christophe christian dimitri dorian émile éric étienne fabrice "
         "félix francis frédéric gaël gaspard georges gérard grégoire gustave ian igor jason jean-baptiste joseph joshua jordan lewis luc ludovic malik "
         "marc marwan mathieu maximilien mayeul michel nassim noam omar patrick philippe rafael ramy raphael rodrigue sami sébastien serge tanguy thibault "
         "tiago timothée tony xavier yoann yohan younes yves zacharie").split()
_GENRE_OF = {norm(n): "f" for n in _FEM}
_GENRE_OF.update({norm(n): "m" for n in _MASC})


def guess_genre(prenom):
    """'f' ou 'm' d'après le prénom (prénoms courants, premier prénom d'un prénom composé) ; '' si on ne sait pas."""
    first = re.split(r"[\s\-]+", norm(prenom or "").strip())[0] if prenom else ""
    return _GENRE_OF.get(first, "")


def genre_of(student):
    """Genre enregistré pour l'élève ('f' ou 'm'), sinon celui deviné d'après son prénom (peut être '')."""
    g = student.get("genre")
    return g if g in ("f", "m") else guess_genre(student.get("prenom", ""))


# ---------------------------------------------------------------- mots-clés notés en cours de période
def keyword_events(student, t):
    return [e for e in student["events"] if e["type"].startswith(KEYWORD_PREFIX) and e["t"] == t]


def keywords(student, t):
    """Mots-clés notés pendant la période t : [(identifiant, nombre de fois)], dans l'ordre de première apparition."""
    counts = {}
    for e in sorted(keyword_events(student, t), key=lambda e: e["date"]):
        k = e["type"][len(KEYWORD_PREFIX):]
        counts[k] = counts.get(k, 0) + 1
    return list(counts.items())


def add_keyword(student, kw_id, t):
    """Note le mot-clé pour l'élève (entrée du journal datée, période t)."""
    from . import model
    model.add_event(student, KEYWORD_PREFIX + kw_id, t, 1)


def remove_keyword(student, kw_id, t):
    """Retire la dernière occurrence du mot-clé dans la période t ; retourne True si une entrée a été retirée."""
    from . import model
    return model.remove_last(student, KEYWORD_PREFIX + kw_id, t)


def band_index(note, scale=20):
    """Tranche de note (0 à 5) d'une note sur `scale`, ramenée sur 20 ; None si la note est absente ou particulière (Abs, Disp, N.Not)."""
    if not is_number(note) or not scale:
        return None
    r = note / scale * 20
    n = 0
    for i, m in enumerate(BAND_MINS):
        if r >= m:
            n = i
    return n


def evolution(student, t, scale=20):
    """'hausse', 'baisse' ou 'stable' selon l'écart avec la note de la période précédente ; None sans deux notes comparables.
    Retourne (genre d'évolution, écart sur 20)."""
    if t <= 1:
        return None, None
    a, b = student["notes"].get(str(t - 1)), student["notes"].get(str(t))
    if not (is_number(a) and is_number(b)) or not scale:
        return None, None
    d = round((b - a) / scale * 20, 2)
    return ("hausse" if d >= EVOLUTION_DELTA else "baisse" if d <= -EVOLUTION_DELTA else "stable"), d


def suggestions(settings, student, t, scale=20):
    """Rubriques de phrases types proposées pour l'élève et la période t : [{"kind", "id", "titre", "emoji", "ton", "count", "phrases"}].
    Dans l'ordre : résultats (selon la note), évolution, un groupe par mot-clé noté (le plus fréquent d'abord), conclusion (selon la note)."""
    b = bank(settings)
    out = []
    n = band_index(student["notes"].get(str(t)), scale)
    if n is not None:
        out.append({"kind": "resultats", **{k: b["resultats"][n][k] for k in ("id", "titre", "phrases")}, "count": 0})
    ev, _ = evolution(student, t, scale)
    if ev:
        g = next(x for x in b["evolution"] if x["id"] == ev)
        out.append({"kind": "evolution", "id": g["id"], "titre": g["titre"], "phrases": g["phrases"], "count": 0})
    by_id = {m["id"]: m for m in b["mots"]}
    for k, count in sorted(keywords(student, t), key=lambda kc: -kc[1]):  # tri stable : à égalité, l'ordre d'apparition
        m = by_id.get(k)
        if m:
            out.append({"kind": "mot", "id": m["id"], "titre": m["titre"], "emoji": m["emoji"], "ton": m["ton"], "phrases": m["phrases"], "count": count})
    if n is not None:
        out.append({"kind": "conclusion", **{k: b["conclusions"][n][k] for k in ("id", "titre", "phrases")}, "count": 0})
    return out


def clone_bank(settings):
    return copy.deepcopy(bank(settings))
