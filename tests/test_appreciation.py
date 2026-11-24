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
        self.assertEqual(b["mots"], [{"id": "monmot", "titre": "Mon mot", "emoji": "", "ton": "=", "phrases": ["a b"]}])
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
