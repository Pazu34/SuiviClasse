import json
import tempfile
import unittest
from pathlib import Path

from suiviclasse.prefs import Prefs, defaults, sanitize


class PrefsTest(unittest.TestCase):
    def test_defauts_si_fichier_absent_ou_illisible(self):
        d = Path(tempfile.mkdtemp())
        self.assertEqual(Prefs(d).values, defaults())
        (d / "preferences.json").write_text("{ pas du json")
        self.assertEqual(Prefs(d).values, defaults())

    def test_enregistrement_relecture_et_reglages_manquants(self):
        d = Path(tempfile.mkdtemp())
        Prefs(d).set({"oubliRouge": 5, "oubliOrange": 4, "autoLockMinutes": 0, "seancePlusVert": "2,5"})
        v = Prefs(d).values
        self.assertEqual((v["oubliRouge"], v["autoLockMinutes"], v["seancePlusVert"]), (5, 0, 2.5))
        (d / "preferences.json").write_text(json.dumps({"oubliRouge": 6}))
        v = Prefs(d).values
        self.assertEqual(v["oubliRouge"], 6)
        self.assertEqual(v["travailRouge"], defaults()["travailRouge"])

    def test_sanitize_borne_et_garde_orange_sous_rouge(self):
        v = sanitize({"oubliRouge": 2, "oubliOrange": 9, "autoLockMinutes": -4, "travailRouge": "abc", "inconnu": 1})
        self.assertEqual(v["oubliOrange"], 2)
        self.assertEqual(v["autoLockMinutes"], 0)
        self.assertEqual(v["travailRouge"], defaults()["travailRouge"])
        self.assertNotIn("inconnu", v)


if __name__ == "__main__":
    unittest.main()


class ChoixTest(unittest.TestCase):
    def test_densite_du_tableau(self):
        self.assertEqual(defaults()["affichage"], "compact")
        self.assertEqual(sanitize({"affichage": "normal"})["affichage"], "normal")
        self.assertEqual(sanitize({"affichage": "n'importe quoi"})["affichage"], "compact")


class ColonnesTest(unittest.TestCase):
    def test_largeurs_de_colonnes(self):
        d = Path(tempfile.mkdtemp())
        p = Prefs(d)
        self.assertEqual(p.columns("compact", [30, 40]), [30, 40])           # par défaut
        p.set_columns("compact", [30, 999, 5])
        self.assertEqual(Prefs(d).columns("compact", [1, 2, 3]), [30, 900, 24])  # bornées, relues
        self.assertEqual(Prefs(d).columns("normal", [1, 2, 3]), [1, 2, 3])       # un mode à la fois
        self.assertEqual(Prefs(d).columns("compact", [1, 2]), [1, 2])            # nombre de colonnes changé : défaut
        p.set({"oubliRouge": 7})                                                  # un réglage ne perd pas les colonnes
        self.assertEqual(Prefs(d).columns("compact", [1, 2, 3]), [30, 900, 24])
        p.reset_columns()
        self.assertEqual(Prefs(d).columns("compact", [1, 2, 3]), [1, 2, 3])
        p.set_columns("normal", [50, 60]); p.reset()
        self.assertEqual(Prefs(d).columns("normal", [50, 60]), [50, 60])
        (d / "preferences.json").write_text(json.dumps({"colonnes": {"compact": "n'importe quoi", "x": [1, "a"]}}))
        self.assertEqual(Prefs(d).columns("compact", [1, 2]), [1, 2])
