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
    def test_largeurs_de_colonnes_par_cle(self):
        d = Path(tempfile.mkdtemp())
        p = Prefs(d)
        self.assertEqual(p.widths("compact"), {})                                  # rien d'enregistré : défauts
        p.set_width("compact", "nom", 160)
        p.set_width("compact", "comm", 5000)
        p.set_width("compact", "numero", 1)
        self.assertEqual(Prefs(d).widths("compact"), {"nom": 160, "comm": 900, "numero": 24})  # bornées, relues
        self.assertEqual(Prefs(d).widths("normal"), {})                            # un mode à la fois
        p.set({"oubliRouge": 7})                                                    # un réglage ne perd pas les colonnes
        self.assertEqual(Prefs(d).widths("compact")["nom"], 160)
        p.forget_width("compact", "nom")
        self.assertNotIn("nom", Prefs(d).widths("compact"))
        p.reset_columns()
        self.assertEqual(Prefs(d).widths("compact"), {})
        p.set_width("normal", "nom", 200)
        p.reset()                                                                   # « valeurs par défaut » remet aussi les colonnes
        self.assertEqual(Prefs(d).widths("normal"), {})
        # ancien format (liste) et fichier invalide : ignorés
        (d / "preferences.json").write_text(json.dumps({"colonnes": {"compact": [28, 112], "normal": "x", "x": {"a": "b"}}}))
        self.assertEqual(Prefs(d).widths("compact"), {})

    def test_onglets(self):
        from suiviclasse.prefs import SCHEMA, TABS
        self.assertEqual(TABS, ["Affichage", "Alertes", "Sauvegardes", "Sécurité et bulletins"])
        self.assertTrue(all(f["tab"] in TABS for f in SCHEMA))
