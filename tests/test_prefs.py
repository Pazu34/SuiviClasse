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
