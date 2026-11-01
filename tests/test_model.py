import unittest

from suiviclasse import model


class ModelTest(unittest.TestCase):
    def test_nouveau_coffre_contient_la_classe_test(self):
        d = model.new_data()
        self.assertEqual([c["nom"] for c in d["classes"]], ["Test"])
        self.assertEqual(d["ui"]["classe"], d["classes"][0]["id"])
        eleves = d["classes"][0]["eleves"]
        self.assertGreaterEqual(len(eleves), 6)
        self.assertEqual([e["nom"] for e in eleves], sorted(e["nom"] for e in eleves))
        # chaque élève a la structure complète attendue par le reste du programme
        for e in eleves:
            self.assertEqual(set(e["notes"]), {"1", "2", "3"})
            self.assertEqual(set(e["comms"]), {"1", "2", "3"})
            self.assertIn("naissance", e)
        # il y a de quoi voir les trois couleurs d'alerte et les infos particulières
        self.assertTrue(any(model.count(e, "oubli", 1) >= 3 for e in eleves))
        self.assertTrue(any(e["infos"] for e in eleves))

    def test_chaque_appel_donne_une_classe_independante(self):
        a, b = model.demo_class(), model.demo_class()
        self.assertNotEqual(a["id"], b["id"])
        a["eleves"][0]["notes"]["1"] = 1.0
        self.assertNotEqual(b["eleves"][0]["notes"]["1"], 1.0)


if __name__ == "__main__":
    unittest.main()


class SaisieManuelleTest(unittest.TestCase):
    def student(self):
        return model.new_student("DUPONT", "Marie")

    def test_numeros(self):
        c = model.new_class("6A")
        for nom in ("A", "B", "C"):
            c["eleves"].append(model.new_student(nom))
        model.ensure_numbers(c)
        self.assertEqual([s["numero"] for s in c["eleves"]], [1, 2, 3])
        c["eleves"].append(model.new_student("D"))
        c["eleves"][0]["numero"] = 9
        model.ensure_numbers(c)  # les n° existants ne changent pas, le nouveau prend le suivant
        self.assertEqual([s["numero"] for s in c["eleves"]], [9, 2, 3, 10])
        self.assertEqual(model.duplicate_numbers(c), set())
        c["eleves"][1]["numero"] = 3
        self.assertEqual(model.duplicate_numbers(c), {3})
        # anciennes données sans n°
        old = model.new_class("6B")
        old["eleves"] = [{"nom": "X"}, {"nom": "Y"}]
        model.ensure_numbers(old)
        self.assertEqual([s["numero"] for s in old["eleves"]], [1, 2])

    def test_compteurs(self):
        s = self.student()
        model.set_count(s, "oubli", 1, 3)
        self.assertEqual(model.count(s, "oubli", 1), 3)
        model.set_count(s, "oubli", 1, 1)
        self.assertEqual(model.count(s, "oubli", 1), 1)
        model.set_count(s, "oubli", 1, 1)
        self.assertEqual(model.count(s, "oubli", 1), 1)
        self.assertEqual(model.count(s, "oubli", 2), 0, "un autre trimestre n'est pas touché")

    def test_totaux_de_seance(self):
        s = self.student()
        for v in (1, 0.5, 1, -0.5, -1):
            model.add_event(s, "seance", 1, v)
        self.assertEqual(model.seance(s, 1), (2.5, -1.5))
        model.set_seance_total(s, 1, "plus", 4)       # monter
        self.assertEqual(model.seance(s, 1), (4, -1.5))
        model.set_seance_total(s, 1, "plus", 1.5)     # descendre : retire des entrées entières
        self.assertEqual(model.seance(s, 1)[0], 1.5)
        model.set_seance_total(s, 1, "plus", 0.25)    # descendre d'une valeur qui ne tombe pas juste
        self.assertEqual(model.seance(s, 1)[0], 0.25)
        model.set_seance_total(s, 1, "moins", 3)
        self.assertEqual(model.seance(s, 1)[1], -3)
        model.set_seance_total(s, 1, "moins", 0)
        self.assertEqual(model.seance(s, 1), (0.25, 0))
        self.assertEqual(model.seance(s, 2), (0, 0))


class PeriodesTest(unittest.TestCase):
    def test_trimestres_et_semestres(self):
        t, s = model.periods("trimestres"), model.periods("semestres")
        self.assertEqual((t["n"], t["prefix"], t["word"], t["keys"]), (3, "T", "trimestre", ["1", "2", "3"]))
        self.assertEqual((s["n"], s["prefix"], s["word"], s["keys"]), (2, "S", "semestre", ["1", "2"]))
        self.assertEqual(model.periods("n'importe quoi")["mode"], "trimestres")


class OrdreDesClassesTest(unittest.TestCase):
    def data(self, *noms):
        d = {"classes": [model.new_class(n) for n in noms]}
        return d, [c["id"] for c in d["classes"]]

    def noms(self, d):
        return [c["nom"] for c in d["classes"]]

    def test_deplacement(self):
        d, ids = self.data("A", "B", "C", "D")
        self.assertTrue(model.move_class(d, ids[0], 3))             # A avant D (position 3) : B C A D
        self.assertEqual(self.noms(d), ["B", "C", "A", "D"])
        self.assertTrue(model.move_class(d, ids[3], 0))             # D en tête
        self.assertEqual(self.noms(d), ["D", "B", "C", "A"])
        self.assertTrue(model.move_class(d, ids[1], 4))             # B à la fin
        self.assertEqual(self.noms(d), ["D", "C", "A", "B"])
        self.assertFalse(model.move_class(d, ids[1], 4))            # déjà à la fin
        self.assertFalse(model.move_class(d, ids[2], 2))            # C (2e) devant son voisin de droite : même place
        self.assertFalse(model.move_class(d, "inconnue", 0))

    def test_nouvelles_classes_a_la_fin_sans_toucher_a_l_ordre(self):
        d, ids = self.data("6C", "6A", "Test")                       # ordre choisi par l'utilisateur
        d["classes"] += [model.new_class("5B"), model.new_class("5A")]
        model.place_new_classes(d, set(ids))
        self.assertEqual(self.noms(d), ["6C", "6A", "Test", "5A", "5B"])
