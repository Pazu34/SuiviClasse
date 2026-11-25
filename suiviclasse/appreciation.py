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
# Conditions qui font apparaître un mot-clé tout seul (d'après les compteurs et les notes de l'élève, avec les seuils des préférences)
AUTO_CHOICES = [
    ("oubli_orange", "Oublis de matériel : seuil orange atteint"), ("oubli_rouge", "Oublis de matériel : seuil rouge atteint"),
    ("travail_orange", "Travail non fait : seuil orange atteint"), ("travail_rouge", "Travail non fait : seuil rouge atteint"),
    ("seance_plus", "Séance + : seuil vert atteint (implication)"), ("seance_moins", "Séance − : seuil rouge atteint"),
    ("qualSeance_bon", "Travail en séance : bon niveau"), ("qualSeance_faible", "Travail en séance : niveau faible"),
    ("qualMaison_bon", "Travail à la maison : bon niveau"), ("qualMaison_faible", "Travail à la maison : niveau faible"),
]
AUTO_IDS = [k for k, _ in AUTO_CHOICES]

_KEYWORDS = [
    ("materiel", "Matériel", "🎒", "-", "oubli_orange", [
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
    ("participation", "Participation", "🙋", "+", "seance_plus", [
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
    ("serieux", "Sérieux", "📚", "+", "qualMaison_bon", [
        "{Il} est {sérieux|sérieuse} et {investi|investie}.",
        "Élève {sérieux|sérieuse} et {appliqué|appliquée}.",
        "Le sérieux de {prénom} est apprécié."]),
    ("progres", "Progrès", "📈", "+", [
        "Des progrès encourageants sont à noter.",
        "{prénom} progresse nettement, c'est à souligner.",
        "Les progrès sont réels : il faut continuer."]),
    ("difficultes", "Difficultés", "🧩", "-", "qualSeance_faible", [
        "{prénom} rencontre des difficultés : il faut revoir régulièrement les leçons.",
        "Des lacunes persistent ; un travail de révision est nécessaire.",
        "{Il} ne doit pas hésiter à poser des questions."]),
    ("travail", "Travail à la maison", "🏠", "-", "travail_orange", [
        "Le travail à la maison n'est pas fait régulièrement.",
        "Les leçons sont insuffisamment apprises.",
        "{prénom} doit s'investir davantage dans le travail personnel."]),
    ("attention", "Attention", "🎯", "-", "seance_moins", [
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
        "{Il} est un élément moteur dans la classe."]),  # « moteur » qualifie « élément » (masculin), pas l'élève
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

# Phrases corrigées dans une version précédente de la banque : si l'utilisateur a enregistré l'ancienne formulation, elle est remplacée.
PHRASE_FIXES = {"{Il} est un élément {moteur|motrice} dans la classe.": "{Il} est un élément moteur dans la classe."}

# Pistes de progrès : un conseil concret et applicable dès la période suivante (les bilans périodiques comportent « des conseils pour progresser »).
_PISTES = [
    "Relire la leçon le soir même et refaire quelques exercices permettrait de consolider les acquis.",
    "Apprendre régulièrement les leçons, en petites séances, aiderait à mieux mémoriser.",
    "Reprendre les évaluations corrigées et refaire les exercices ratés aiderait à combler les lacunes.",
    "Poser des questions dès qu'un point n'est pas compris permettrait de lever les blocages.",
    "Relire attentivement les consignes avant de commencer un exercice limiterait les erreurs.",
    "Noter le travail à faire dans l'agenda et s'y tenir aiderait à travailler régulièrement.",
    "Préparer son sac et son matériel la veille éviterait les oublis.",
    "Prendre la parole plus souvent à l'oral permettrait de gagner en assurance.",
    "Soigner la présentation (écriture, cahier) rendrait le travail plus lisible.",
    "Un accompagnement (aide aux devoirs, tutorat, soutien) serait bénéfique pour progresser.",
]

# Conseils de rédaction affichés dans l'assistant (modifiables) : synthèse de recommandations institutionnelles et académiques, voir le README.
_CONSEILS = [
    "Trois temps : un constat précis (acquis, progrès), un point à travailler, puis une piste concrète pour la période suivante.",
    "Parler du travail et des acquis, pas de la personne : « manque de régularité dans le travail personnel » plutôt que « élève paresseux ».",
    "Éviter les formules vagues (« élève en difficulté », « peut mieux faire ») : dire où est la difficulté et ce qui peut aider.",
    "Ne pas répéter la note ou la moyenne : le bulletin les affiche déjà. Apporter une information en plus.",
    "Valoriser les efforts et les progrès, sans rien retirer à l'exigence.",
    "Comportement et assiduité : décrire l'effet sur le travail (« les bavardages gênent la concentration ») plutôt que juger l'élève. Assiduité, ponctualité et participation peuvent figurer au bulletin.",
    "Rester factuel : le bulletin est conservé et peut être lu par l'élève, sa famille et d'autres enseignants. Pas d'éléments de vie privée ou de santé, pas de comparaison avec d'autres élèves, pas de « don » ou de « manque de don ».",
    "Ne pas généraliser une observation ponctuelle ; nuancer quand c'est utile.",
    "Écrire pour être compris de l'élève et de sa famille : pas de jargon, des phrases courtes.",
    "Respecter la longueur maximale (255 caractères dans PRONOTE par défaut) : l'essentiel d'abord.",
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


# Aide à la saisie : mots et expressions proposés pendant la frappe, abréviations remplacées automatiquement.
_VOCAB = ("très bien|assez bien|bon travail|très bon travail|travail sérieux|travail régulier|travail insuffisant|travail soigné|résultats satisfaisants|"
          "résultats insuffisants|résultats fragiles|résultats en progrès|résultats en baisse|ensemble satisfaisant|ensemble fragile|"
          "bonne participation|participation orale|participation active|bavardages|bavardeur|bavardeuse|efforts|progrès|progresse|progression|"
          "difficultés|lacunes|fragilités|régularité|rigueur|rigoureux|rigoureuse|investissement|investi|investie|implication|impliqué|impliquée|"
          "sérieux|sérieuse|appliqué|appliquée|attentif|attentive|attention|concentration|concentré|concentrée|motivé|motivée|motivation|"
          "comportement|comportement exemplaire|attitude|attitude positive|ponctualité|retards|absences|matériel|oublis de matériel|"
          "leçons|apprendre ses leçons|travail personnel|travail à la maison|révisions|réviser|persévérer|persévérance|ténacité|autonomie|"
          "autonome|curieux|curieuse|curiosité|dynamique|volontaire|discret|discrète|passif|passive|dispersé|dispersée|fatigué|fatiguée|"
          "encouragements|félicitations|bravo|à poursuivre|à encourager|à surveiller|peut progresser|doit se ressaisir|doit progresser|"
          "doit s'investir|un sursaut est nécessaire|continuer ainsi|poursuivre les efforts|trimestre|semestre|élève|classe|cours").split("|")
_ABBR = [("tb", "très bien"), ("ab", "assez bien"), ("bt", "bon travail"), ("tbt", "très bon travail"), ("rs", "résultats satisfaisants"),
         ("ri", "résultats insuffisants"), ("rf", "résultats fragiles"), ("pn", "{prénom}"), ("ens", "ensemble"), ("pb", "problème"),
         ("pte", "participation"), ("cpt", "comportement"), ("eff", "efforts"), ("prog", "progrès"), ("fel", "félicitations"),
         ("enc", "encouragements"), ("att", "attention"), ("conc", "concentration"), ("trv", "travail"), ("tjrs", "toujours"),
         ("bcp", "beaucoup"), ("qd", "quand"), ("pdt", "pendant"), ("tjs", "toujours"), ("mat", "matériel")]
MAX_ABBR_LEN, MAX_ABBR_TEXT, MAX_VOCAB_LEN = 12, 120, 60
MIN_PREFIX = 2  # nombre minimal de lettres tapées avant de proposer un mot


def default_bank():
    """Banque de phrases par défaut (copie neuve à chaque appel)."""
    return {
        "mots": [{"id": k[0], "titre": k[1], "emoji": k[2], "ton": k[3], "auto": k[4] if len(k) == 6 else "", "phrases": list(k[-1])} for k in _KEYWORDS],
        "resultats": [{"id": f"r{n}", "titre": BAND_TITLES[n], "min": BAND_MINS[n], "phrases": list(_RESULTS[n])} for n in range(6)],
        "evolution": [{"id": i, "titre": t, "phrases": list(p)} for i, t, p in _EVOLUTION],
        "conclusions": [{"id": f"c{n}", "titre": BAND_TITLES[n], "min": BAND_MINS[n], "phrases": list(_CONCLUSIONS[n])} for n in range(6)],
        "pistes": [{"id": "pistes", "titre": "Pistes de progrès", "phrases": list(_PISTES)}],
        "conseils": list(_CONSEILS),
        "vocabulaire": list(_VOCAB),
        "abreviations": [{"abr": a, "texte": t} for a, t in _ABBR],
    }


def _text(v):
    return v if isinstance(v, str) else ""


def _phrases(raw):
    out = []
    for p in raw if isinstance(raw, list) else []:
        if isinstance(p, str) and p.strip():
            p = " ".join(p.split())
            out.append(PHRASE_FIXES.get(p, p))
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
        auto = m.get("auto") if m.get("auto") in AUTO_IDS else ""
        mots.append({"id": ident, "titre": titre, "emoji": _text(m.get("emoji"))[:8], "ton": ton, "auto": auto, "phrases": _phrases(m.get("phrases"))})
    out["mots"] = mots
    for key in ("resultats", "conclusions"):  # tranches de note : titres et seuils sont fixes, seules les phrases se modifient
        given = {x.get("id"): x for x in raw.get(key, []) if isinstance(x, dict)} if isinstance(raw.get(key), list) else {}
        out[key] = [{**b, "phrases": _phrases(given[b["id"]].get("phrases")) if b["id"] in given else b["phrases"]} for b in base[key]]
    given = {x.get("id"): x for x in raw.get("evolution", []) if isinstance(x, dict)} if isinstance(raw.get("evolution"), list) else {}
    out["evolution"] = [{**b, "phrases": _phrases(given[b["id"]].get("phrases")) if b["id"] in given else b["phrases"]} for b in base["evolution"]]
    given = {x.get("id"): x for x in raw.get("pistes", []) if isinstance(x, dict)} if isinstance(raw.get("pistes"), list) else {}
    out["pistes"] = [{**b, "phrases": _phrases(given[b["id"]].get("phrases")) if b["id"] in given else b["phrases"]} for b in base["pistes"]]
    if isinstance(raw.get("conseils"), list):  # conseils de rédaction : une liste de textes (vide si l'utilisateur l'a vidée)
        out["conseils"] = [" ".join(c.split())[:400] for c in raw["conseils"] if isinstance(c, str) and c.strip()]
    else:
        out["conseils"] = list(base["conseils"])
    # aide à la saisie : mots proposés (sans doublon, casse et accents ignorés) et abréviations (clé en lettres et chiffres, unique)
    vocab, seen_v = [], set()
    for w in raw["vocabulaire"] if isinstance(raw.get("vocabulaire"), list) else base["vocabulaire"]:
        w = " ".join(_text(w).split())[:MAX_VOCAB_LEN]
        if w and norm(w) not in seen_v:
            seen_v.add(norm(w))
            vocab.append(w)
    out["vocabulaire"] = vocab
    abbr, seen_a = [], set()
    for a in raw["abreviations"] if isinstance(raw.get("abreviations"), list) else base["abreviations"]:
        if not isinstance(a, dict):
            continue
        key = re.sub(r"[\W_]+", "", _text(a.get("abr")).lower())[:MAX_ABBR_LEN]
        texte = " ".join(_text(a.get("texte")).split())[:MAX_ABBR_TEXT]
        if key and texte and key not in seen_a:
            seen_a.add(key)
            abbr.append({"abr": key, "texte": texte})
    out["abreviations"] = abbr
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


# ---------------------------------------------------------------- aide à la saisie
def completion_pool(bank_):
    """Mots et expressions proposés pendant la frappe : le vocabulaire, puis les titres des mots-clés (sans doublon)."""
    out, seen = [], set()
    for w in list(bank_.get("vocabulaire", [])) + [m["titre"].lower() for m in bank_.get("mots", [])]:
        if norm(w) not in seen:
            seen.add(norm(w))
            out.append(w)
    return out


def complete(before, pool, limit=4):
    """Compléments proposés pour la fin du texte tapé `before` : [(nombre de caractères tapés à remplacer, texte proposé)].
    On compare les 1 à 3 derniers mots tapés au début de chaque entrée du vocabulaire (casse, accents et apostrophes ignorés) ;
    les plus longs correspondances passent d'abord ; une majuscule initiale tapée est conservée. Au moins MIN_PREFIX lettres."""
    runs = [(m.start(), m.end()) for m in re.finditer(r"[^\W_]+", before)]
    if not runs or runs[-1][1] != len(before):
        return []
    out, seen = [], set()
    for k in (3, 2, 1):
        if len(runs) < k:
            continue
        chain = runs[-k:]
        if any(before[chain[i][1]:chain[i + 1][0]] not in (" ", "'", "’", "-") for i in range(k - 1)):
            continue
        typed = before[chain[0][0]:]
        nt = norm(typed)
        if len(nt.replace(" ", "")) < MIN_PREFIX:
            continue
        for entry in pool:
            ne = norm(entry)
            if ne.startswith(nt) and ne != nt and entry not in seen:
                seen.add(entry)
                out.append((len(typed), entry[0].upper() + entry[1:] if typed[0].isupper() else entry))
                if len(out) >= limit:
                    return out
    return out


def expand_abbreviation(before, abbrevs, prenom="", genre="", period_word="trimestre"):
    """Si le dernier mot tapé est une abréviation (casse ignorée) : (nombre de caractères à remplacer, texte de remplacement) ; sinon None.
    Le remplacement peut contenir les accords de render() ; une majuscule initiale est conservée."""
    m = re.search(r"[^\W_]+$", before)
    if not m:
        return None
    word = m.group(0)
    for a in abbrevs:
        if a["abr"] == word.lower():
            texte = render(a["texte"], prenom, genre, period_word)
            if texte and word[0].isupper():
                texte = texte[0].upper() + texte[1:]
            return len(word), texte
    return None


# ---------------------------------------------------------------- suggestions d'abréviations d'après les commentaires enregistrés
SUGGEST_LIMIT = 25      # propositions au plus à chaque demande
SUGGEST_MIN_DOCS = 3    # une expression doit figurer dans au moins autant de commentaires
SUGGEST_MIN_LEN = 7     # et compter au moins autant de caractères (sinon l'abréviation n'économise rien)
SUGGEST_MAX_WORDS = 4
_STOP = frozenset("le la les un une des du de d l et ou à a au aux en est sont ont il elle ils elles ce cet cette ces se sa son ses que qui ne pas "
                  "par pour sur dans avec sans mais donc or ni car y on nous vous je tu lui leur leurs ma mon mes ta ton tes si comme".split())


def _clauses_words(text):
    """Mots (minuscules) de chaque proposition d'un texte : les expressions ne traversent ni ponctuation ni parenthèse."""
    for clause in re.split(r"[.!?…;:,()«»\"\n\r]+", text):
        words = re.findall(r"[^\W_]+(?:['’\-][^\W_]+)*", clause.lower())
        if words:
            yield words


def _abbreviation_for(text, taken):
    """Abréviation proposée pour une expression : initiales des mots (« très bon travail » → « tbt »), ou, pour un mot seul, sa première lettre
    suivie de ses premières consonnes (« participation » → « prt »). On allonge avec les lettres suivantes jusqu'à trouver une clé libre (jamais un mot
    courant, jamais une abréviation déjà prise) ; None si on n'en trouve pas."""
    letters = lambda w: re.sub(r"[^a-z0-9]", "", norm(w))
    words = [letters(w) for w in text.split(" ") if letters(w)]
    if not words:
        return None
    if len(words) >= 2:
        base = "".join(w[0] for w in words)
        spare = "".join(words)[len(words):]
    else:
        w = words[0]
        cons = [c for c in w[1:] if c not in "aeiouy0123456789"]
        base = w[0] + "".join(cons[:2])
        spare = w[len(base):]
    for k in range(len(spare) + 1):
        key = base + spare[:k]
        if 2 <= len(key) <= 6 and key not in taken:
            return key
    return None


def suggest_abbreviations(texts, existing=(), exclude_words=(), limit=SUGGEST_LIMIT):
    """Abréviations à proposer d'après les commentaires `texts` (liste de textes) : les mots et expressions de 1 à 4 mots qui reviennent dans le plus de
    commentaires (au moins 3), sans article ni préposition au début ou à la fin, ni nom d'élève (`exclude_words`), pas déjà couverts par `existing`
    (liste de {"abr", "texte"}). Classées par économie de frappe ; au plus `limit`. Retourne [{"abr", "texte", "docs"}]."""
    stop_names = {norm(w) for w in exclude_words}
    docs, corpus = {}, set()
    for d, text in enumerate(texts):
        for words in _clauses_words(text):
            corpus.update(norm(w) for w in words)
            for n in range(1, SUGGEST_MAX_WORDS + 1):
                for i in range(len(words) - n + 1):
                    docs.setdefault(" ".join(words[i:i + n]), set()).add(d)
    covered = {norm(a["texte"]) for a in existing}
    covered_text = [" " + c + " " for c in covered]
    cands = []
    for text, ds in docs.items():
        ws = text.split(" ")
        if len(ds) < SUGGEST_MIN_DOCS or len(text) < SUGGEST_MIN_LEN or ws[0] in _STOP or ws[-1] in _STOP:
            continue
        if any(norm(w) in stop_names for w in ws) or any(" " + norm(text) + " " in c for c in covered_text):  # déjà couverte par une abréviation
            continue
        cands.append((len(ds) * len(text), text, len(ds)))
    cands.sort(key=lambda c: (-c[0], c[1]))
    taken = {a["abr"] for a in existing} | _STOP | corpus
    out = []
    for score, text, n in cands:
        if any(f" {text} " in f" {c['texte']} " and c["docs"] * 1.25 >= n for c in out):  # déjà dans une expression plus longue, presque aussi fréquente
            continue
        key = _abbreviation_for(text, taken)
        if key is None:
            continue
        taken.add(key)
        out.append({"abr": key, "texte": text, "docs": n})
        if len(out) >= limit:
            break
    return out


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


def auto_hits(settings, values, student, t):
    """Conditions automatiques (AUTO_IDS) remplies par l'élève pour la période t. `values` : préférences (seuils d'alerte)."""
    from . import columns, model
    hits = set()
    n = model.total(student, "oubli", t)
    if n >= values["oubliOrange"]:
        hits.add("oubli_orange")
    if n >= values["oubliRouge"]:
        hits.add("oubli_rouge")
    n = model.total(student, "travail", t)
    if n >= values["travailOrange"]:
        hits.add("travail_orange")
    if n >= values["travailRouge"]:
        hits.add("travail_rouge")
    plus, moins = model.seance(student, t)
    if plus > 0 and plus >= values["seancePlusVert"]:
        hits.add("seance_plus")
    if moins < 0 and moins <= -values["seanceMoinsRouge"]:
        hits.add("seance_moins")
    for g in columns.grade_columns(settings, visible_only=False):
        if g["key"] in ("qualSeance", "qualMaison"):
            lvl = model.grade_level(model.grade_final(student, g, t), len(g["niveaux"]))
            if lvl == "ok":
                hits.add(g["key"] + "_bon")
            elif lvl in ("warn", "bad"):
                hits.add(g["key"] + "_faible")
    return hits


def auto_keywords(settings, values, student, t):
    """Identifiants des mots-clés dont la condition automatique est remplie (dans l'ordre de la banque)."""
    hits = auto_hits(settings, values, student, t)
    return [m["id"] for m in bank(settings)["mots"] if m["auto"] and m["auto"] in hits]


def suggestions(settings, student, t, scale=20, values=None):
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
    noted = keywords(student, t)
    for k, count in sorted(noted, key=lambda kc: -kc[1]):  # tri stable : à égalité, l'ordre d'apparition
        m = by_id.get(k)
        if m:
            out.append({"kind": "mot", "id": m["id"], "titre": m["titre"], "emoji": m["emoji"], "ton": m["ton"], "phrases": m["phrases"], "count": count, "auto": False})
    if values is not None:  # mots-clés détectés automatiquement et pas encore notés à la main
        known = {k for k, _ in noted}
        for k in auto_keywords(settings, values, student, t):
            if k not in known:
                m = by_id[k]
                out.append({"kind": "mot", "id": m["id"], "titre": m["titre"], "emoji": m["emoji"], "ton": m["ton"], "phrases": m["phrases"], "count": 0, "auto": True})
    # piste de progrès : quand la note est inférieure à 14 sur 20 ou qu'un mot-clé négatif est noté (ou détecté)
    negative = any(g["kind"] == "mot" and g["ton"] == "-" for g in out)
    if (n is not None and n <= 3) or negative:
        out.append({"kind": "piste", "id": "pistes", "titre": b["pistes"][0]["titre"], "phrases": b["pistes"][0]["phrases"], "count": 0})
    if n is not None:
        out.append({"kind": "conclusion", **{k: b["conclusions"][n][k] for k in ("id", "titre", "phrases")}, "count": 0})
    return out


# ---------------------------------------------------------------- relecture de la classe
REPEAT_MIN_STUDENTS = 3  # une phrase utilisée dans au moins autant d'appréciations est signalée
REPEAT_MIN_WORDS = 4


def sentences(text):
    """Phrases d'un texte (coupées après . ! ? …)."""
    return [s.strip() for s in re.split(r"(?<=[.!?…])\s+", text) if s.strip()]


def review(cls, t, max_len=255):
    """Relecture des appréciations de la période t : une ligne par élève, dans l'ordre de la classe, avec les alertes :
    vide, trop longue, phrases utilisées dans au moins 3 appréciations, prénoms d'autres élèves de la classe (oubli à corriger).
    Retourne (lignes, résumé)."""
    key = str(t)
    texts = {s["id"]: " ".join(str(s["comms"].get(key, "")).split()) for s in cls["eleves"]}
    count = {}
    for text in texts.values():
        for sent in {norm(x) for x in sentences(text) if len(x.split()) >= REPEAT_MIN_WORDS}:
            count[sent] = count.get(sent, 0) + 1
    rows = []
    for s in cls["eleves"]:
        text = texts[s["id"]]
        repeated = []
        for sent in sentences(text):
            if len(sent.split()) >= REPEAT_MIN_WORDS and count.get(norm(sent), 0) >= REPEAT_MIN_STUDENTS and sent not in repeated:
                repeated.append(sent)
        mine = {w for w in re.split(r"[\s\-]+", s["prenom"]) if w}
        words = set(re.findall(r"[^\W\d_]+", text))
        others = []
        for o in cls["eleves"]:
            p = o["prenom"].strip()
            if o is s or len(p) < 3 or p in mine or " " in p or "-" in p:  # prénoms composés ignorés
                continue
            if p in words and p not in others:
                others.append(p)
        rows.append({"id": s["id"], "nom": s["nom"], "prenom": s["prenom"], "note": s["notes"].get(key), "texte": text, "longueur": len(text),
                     "vide": not text, "trop_long": len(text) > max_len, "repetees": repeated, "autres_prenoms": others})
    summary = {"total": len(rows), "vides": sum(r["vide"] for r in rows), "trop_longs": sum(r["trop_long"] for r in rows),
               "repetees": sum(bool(r["repetees"]) for r in rows), "prenoms": sum(bool(r["autres_prenoms"]) for r in rows)}
    return rows, summary


def clone_bank(settings):
    return copy.deepcopy(bank(settings))
