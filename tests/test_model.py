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
        self.assertTrue(any(model.moyenne(e) is None for e in eleves))

    def test_chaque_appel_donne_une_classe_independante(self):
        a, b = model.demo_class(), model.demo_class()
        self.assertNotEqual(a["id"], b["id"])
        a["eleves"][0]["notes"]["1"] = 1.0
        self.assertNotEqual(b["eleves"][0]["notes"]["1"], 1.0)


if __name__ == "__main__":
    unittest.main()
