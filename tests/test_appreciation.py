import unittest

from suiviclasse import appreciation as A
from suiviclasse import columns
from suiviclasse.model import add_event, new_student


def student(prenom="Léa", **notes):
    s = new_student("DUPONT", prenom)
    for k, v in notes.items():
        s["notes"][k[1:]] = v  # n1=14 -> notes["1"]
    return s


class RenderTest(unittest.TestCase):
    def test_accords_et_jetons(self):
        t = "{prénom} est {sérieux|sérieuse} et {il} reste {concentré|concentrée} ce {période}. {Il} a progressé{e}."
        self.assertEqual(A.render(t, "Léa", "f", "trimestre"), "Léa est sérieuse et elle reste concentrée ce trimestre. Elle a progressée.")
        self.assertEqual(A.render(t, "Hugo", "m", "semestre"), "Hugo est sérieux et il reste concentré ce semestre. Il a progressé.")
        self.assertEqual(A.render("{Il} est {sérieux|sérieuse}", "X", "", "t"), "Il est sérieux")  # genre inconnu : masculin

    def test_accolades_inconnues_laissees(self):
        self.assertEqual(A.render("a {faute} b", "X", "f"), "a {faute} b")
        self.assertEqual(A.render("{seul}", "X", "f"), "{seul}")
        self.assertEqual(A.render("{a|b|c}", "X", "f"), "b")


class GenreTest(unittest.TestCase):
    def test_genre_devine(self):
        for prenom, g in (("Léa", "f"), ("LÉA", "f"), ("Inès", "f"), ("Marie-Claire", "f"), ("Hugo", "m"), ("Mathéo", "m"), ("Jean-Baptiste", "m"),
                          ("Zzyzx", ""), ("", ""), ("Camille", "")):
            self.assertEqual(A.guess_genre(prenom), g, prenom)

    def test_genre_enregistre_prioritaire(self):
        s = student("Léa")
        self.assertEqual(A.genre_of(s), "f")
        s["genre"] = "m"
        self.assertEqual(A.genre_of(s), "m")


class MotsClesTest(unittest.TestCase):
    def test_ajout_comptage_retrait(self):
        s = student()
        A.add_keyword(s, "bavardages", 1)
        A.add_keyword(s, "efforts", 1)
        A.add_keyword(s, "bavardages", 1)
        A.add_keyword(s, "retards", 2)
        self.assertEqual(A.keywords(s, 1), [("bavardages", 2), ("efforts", 1)])
        self.assertEqual(A.keywords(s, 2), [("retards", 1)])
        self.assertTrue(A.remove_keyword(s, "bavardages", 1))
        self.assertEqual(A.keywords(s, 1), [("bavardages", 1), ("efforts", 1)])
        self.assertFalse(A.remove_keyword(s, "absences", 1))

    def test_les_mots_cles_ne_changent_aucun_total(self):
        from suiviclasse import model
        s = student()
        A.add_keyword(s, "bavardages", 1)
        self.assertEqual(model.stats(s, 1), (0, 0, 0, 0))

    def test_libelle_du_journal(self):
        self.assertEqual(columns.type_label({}, "mot:bavardages"), "Mot-clé : Bavardages")
        self.assertEqual(columns.type_label({}, "mot:inconnu"), "Mot-clé : inconnu")


class SuggestionsTest(unittest.TestCase):
    def test_tranches(self):
        self.assertEqual([A.band_index(n) for n in (0, 7.9, 8, 11.99, 12, 15, 16, 20)], [0, 0, 1, 2, 3, 4, 5, 5])
        self.assertEqual(A.band_index(7, 10), 4)  # 7/10 = 14/20
        for v in (None, "a", "n", "d"):
            self.assertIsNone(A.band_index(v))

    def test_evolution(self):
        self.assertEqual(A.evolution(student(n1=10, n2=12), 2), ("hausse", 2.0))
        self.assertEqual(A.evolution(student(n1=12, n2=10), 2), ("baisse", -2.0))
        self.assertEqual(A.evolution(student(n1=12, n2=12.5), 2)[0], "stable")
        self.assertEqual(A.evolution(student(n1=12, n2="a"), 2), (None, None))
        self.assertEqual(A.evolution(student(n1=12), 1), (None, None))

    def test_ordre_des_rubriques(self):
        s = student(n1=10, n2=14.5)
        A.add_keyword(s, "efforts", 2)
        A.add_keyword(s, "bavardages", 2)
        A.add_keyword(s, "bavardages", 2)
        sug = A.suggestions({}, s, 2)
        self.assertEqual([(g["kind"], g["id"]) for g in sug],
                         [("resultats", "r4"), ("evolution", "hausse"), ("mot", "bavardages"), ("mot", "efforts"), ("conclusion", "c4")])
        self.assertEqual(sug[2]["count"], 2)
        self.assertEqual(A.suggestions({}, student(), 1), [])  # sans note ni mot-clé : rien

    def test_mot_cle_supprime_de_la_banque_est_ignore(self):
        s = student(n1=12)
        A.add_keyword(s, "disparu", 1)
        self.assertEqual([g["kind"] for g in A.suggestions({}, s, 1)], ["resultats", "conclusion"])


class BanqueTest(unittest.TestCase):
    def test_defauts_complets(self):
        b = A.default_bank()
        self.assertEqual(len(b["mots"]), 13)
        self.assertTrue(all(len(m["phrases"]) >= 3 for m in b["mots"]))
        self.assertEqual([x["min"] for x in b["resultats"]], A.BAND_MINS)
        self.assertEqual(A.sanitize_bank(b), b)

    def test_validation(self):
        raw = {"mots": [{"id": "Mon Mot!", "titre": " Mon  mot ", "ton": "?", "phrases": ["  a  b ", "", 3]}, {"id": "x"}, "z",
                        {"id": "monmot", "titre": "doublon"}],
               "resultats": [{"id": "r0", "phrases": ["Seule phrase"]}], "evolution": "n'importe quoi"}
        b = A.sanitize_bank(raw)
        self.assertEqual(b["mots"], [{"id": "monmot", "titre": "Mon mot", "emoji": "", "ton": "=", "auto": "", "phrases": ["a b"]}])
        self.assertEqual(b["resultats"][0]["phrases"], ["Seule phrase"])
        self.assertEqual(b["resultats"][1]["phrases"], A.default_bank()["resultats"][1]["phrases"])
        self.assertEqual(b["evolution"], A.default_bank()["evolution"])

    def test_banque_des_reglages(self):
        custom = A.default_bank()
        custom["mots"] = custom["mots"][:1]
        self.assertEqual(len(A.bank({"appreciation": custom})["mots"]), 1)
        self.assertEqual(len(A.bank({})["mots"]), 13)

    def test_identifiant_libre(self):
        b = A.default_bank()
        self.assertEqual(A.new_keyword_id("Matériel", b), "materiel2")
        self.assertEqual(A.new_keyword_id("Chant & danse", b), "chantdanse")
        self.assertEqual(A.new_keyword_id("!!!", b), "mot")


if __name__ == "__main__":
    unittest.main()


class AideALaSaisieTest(unittest.TestCase):
    def setUp(self):
        self.bank = A.default_bank()
        self.pool = A.completion_pool(self.bank)

    def test_completion_du_dernier_mot(self):
        self.assertEqual(A.complete("bav", self.pool)[0], (3, "bavardages"))
        self.assertEqual(A.complete("tres b", self.pool)[0], (6, "très bien"))  # accents ignorés, deux mots
        self.assertEqual(A.complete("Il est très b", self.pool)[0], (6, "très bien"))
        self.assertEqual(A.complete("Efforts. Pr", self.pool)[0], (2, "Progrès"))  # majuscule conservée
        self.assertEqual(A.complete("dif", self.pool), [(3, "difficultés")])

    def test_rien_a_proposer(self):
        for text in ("", "b", "x", "bavardages ", "bavardages", "zzz", "très bien, "):
            self.assertEqual(A.complete(text, self.pool), [], repr(text))

    def test_limite_et_ordre(self):
        got = A.complete("tr", self.pool, limit=3)
        self.assertEqual(len(got), 3)
        self.assertEqual(got[0], (2, "très bien"))
        self.assertEqual(len({e for _, e in A.complete("pr", self.pool, limit=10)}), len(A.complete("pr", self.pool, limit=10)))

    def test_titres_des_mots_cles_dans_la_base(self):
        self.bank["mots"].append({"id": "oral", "titre": "Prise de parole", "emoji": "", "ton": "=", "phrases": []})
        self.assertIn("prise de parole", A.completion_pool(self.bank))
        self.assertEqual(A.complete("prise d", A.completion_pool(self.bank))[0], (7, "prise de parole"))

    def test_abreviations(self):
        ab = self.bank["abreviations"]
        self.assertEqual(A.expand_abbreviation("Il a eu un tb", ab), (2, "très bien"))
        self.assertEqual(A.expand_abbreviation("Tb", ab), (2, "Très bien"))
        self.assertEqual(A.expand_abbreviation("pn", ab, "Léa", "f"), (2, "Léa"))
        for text in ("etb", "tb ", "", "bonjour"):
            self.assertIsNone(A.expand_abbreviation(text, ab), repr(text))
        accords = [{"abr": "ii", "texte": "{il} est {sérieux|sérieuse}"}]
        self.assertEqual(A.expand_abbreviation("ii", accords, "Léa", "f"), (2, "elle est sérieuse"))
        self.assertEqual(A.expand_abbreviation("Ii", accords, "Hugo", "m"), (2, "Il est sérieux"))

    def test_validation_de_l_aide(self):
        raw = {"vocabulaire": ["  Très   bien ", "TRES BIEN", "", 5, "a" * 100], "abreviations": [{"abr": "T-B!", "texte": " très  bien "}, {"abr": "tb", "texte": "doublon"},
                                                                                              {"abr": "", "texte": "x"}, {"abr": "z", "texte": ""}, "x"]}
        b = A.sanitize_bank(raw)
        self.assertEqual(b["vocabulaire"], ["Très bien", "a" * 60])
        self.assertEqual(b["abreviations"], [{"abr": "tb", "texte": "très bien"}])
        self.assertEqual(A.sanitize_bank({})["vocabulaire"], A.default_bank()["vocabulaire"])
        self.assertEqual(A.sanitize_bank({"vocabulaire": []})["vocabulaire"], [])  # une liste vide est un choix : aucune proposition


class MotsClesAutomatiquesTest(unittest.TestCase):
    def setUp(self):
        from suiviclasse import prefs
        self.values = prefs.defaults()

    def test_seuils_des_preferences(self):
        s = student()
        self.assertEqual(A.auto_keywords({}, self.values, s, 1), [])
        add_event(s, "oubli", 1, 1)
        self.assertEqual(A.auto_keywords({}, self.values, s, 1), [])  # 1 oubli : sous le seuil orange (2)
        add_event(s, "oubli", 1, 1)
        self.assertEqual(A.auto_keywords({}, self.values, s, 1), ["materiel"])
        self.assertEqual(A.auto_keywords({}, {**self.values, "oubliOrange": 5, "oubliRouge": 6}, s, 1), [])
        self.assertEqual(A.auto_keywords({}, self.values, s, 2), [])  # autre période

    def test_seance_et_niveaux(self):
        s = student()
        add_event(s, "seance", 1, 3)
        add_event(s, "seance", 1, -2)
        self.assertEqual(A.auto_keywords({}, self.values, s, 1), ["participation", "attention"])
        for _ in range(2):
            add_event(s, "qualMaison", 1, 5)  # A, A
        add_event(s, "qualSeance", 1, 1)  # E
        self.assertEqual(A.auto_keywords({}, self.values, s, 1), ["participation", "serieux", "difficultes", "attention"])

    def test_suggestions_signalent_les_mots_cles_automatiques(self):
        s = student(n1=12)
        add_event(s, "oubli", 1, 1)
        add_event(s, "oubli", 1, 1)
        sans = [g["id"] for g in A.suggestions({}, s, 1)]
        self.assertNotIn("materiel", sans)  # sans les préférences, pas de détection
        avec = {g["id"]: g for g in A.suggestions({}, s, 1, 20, self.values) if g["kind"] == "mot"}
        self.assertTrue(avec["materiel"]["auto"] and avec["materiel"]["count"] == 0)
        A.add_keyword(s, "materiel", 1)  # noté à la main : plus « automatique »
        avec = {g["id"]: g for g in A.suggestions({}, s, 1, 20, self.values) if g["kind"] == "mot"}
        self.assertFalse(avec["materiel"]["auto"])
        self.assertEqual(avec["materiel"]["count"], 1)

    def test_condition_validee(self):
        raw = {"mots": [{"id": "a", "titre": "A", "auto": "oubli_rouge"}, {"id": "b", "titre": "B", "auto": "n'importe quoi"}, {"id": "c", "titre": "C"}]}
        self.assertEqual([m["auto"] for m in A.sanitize_bank(raw)["mots"]], ["oubli_rouge", "", ""])
        self.assertEqual(len({m["auto"] for m in A.default_bank()["mots"] if m["auto"]}), 6)


class RelectureTest(unittest.TestCase):
    def classe(self):
        from suiviclasse.model import new_class
        c = new_class("6A")
        for prenom in ("Léa", "Hugo", "Zoé", "Noah", "Emma", "Jean-Paul", "Al"):
            c["eleves"].append(new_student("NOM", prenom))
        return c

    def test_alertes(self):
        c = self.classe()
        e = c["eleves"]
        common = "Très bon travail ce trimestre, il faut continuer."
        for s in e[:3]:
            s["comms"]["1"] = common
        e[3]["comms"]["1"] = "Hugo aide Zoé, Al et Jean-Paul. " + "x" * 300
        rows, sm = A.review(c, 1, 255)
        self.assertEqual(sm, {"total": 7, "vides": 3, "trop_longs": 1, "repetees": 3, "prenoms": 1})
        self.assertEqual(rows[0]["repetees"], [common])
        self.assertEqual(rows[3]["autres_prenoms"], ["Hugo", "Zoé"])  # « Al » (2 lettres) et les prénoms composés sont ignorés
        self.assertTrue(rows[4]["vide"] and not rows[4]["trop_long"])
        self.assertEqual((rows[3]["trop_long"], rows[3]["longueur"] > 255), (True, True))

    def test_pas_de_fausse_alerte(self):
        c = self.classe()
        e = c["eleves"]
        e[0]["comms"]["1"] = "Léa progresse. Léa est sérieuse."  # son propre prénom : normal
        e[1]["comms"]["1"] = "hugo hugo"  # sans majuscule : ce n'est pas un prénom oublié
        e[2]["comms"]["1"] = "Bien."  # phrase courte et unique
        rows, sm = A.review(c, 1)
        self.assertEqual((sm["repetees"], sm["prenoms"]), (0, 0))
        self.assertEqual(A.review(c, 2)[1]["vides"], 7)  # autre période : rien d'écrit

    def test_phrases(self):
        self.assertEqual(A.sentences("Un. Deux ! Trois ? Fin…  Dernier"), ["Un.", "Deux !", "Trois ?", "Fin…", "Dernier"])
