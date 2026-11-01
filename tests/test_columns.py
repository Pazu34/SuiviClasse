import unittest

from suiviclasse import columns as C
from suiviclasse import exchange as X
from suiviclasse import model


class IncrementsTest(unittest.TestCase):
    def test_analyse_des_increments(self):
        self.assertEqual(C.parse_increments("+0,5 ; +2 ; -1"), [0.5, 2.0, -1.0])
        self.assertEqual(C.parse_increments("0,5 2 −1 2"), [0.5, 2.0, -1.0])       # sans signe = positif, doublons retirés
        self.assertEqual(C.parse_increments("1 2", sign=-1), [-1.0, -2.0])          # séance − : signe imposé
        self.assertEqual(C.parse_increments("-1 -2", sign=1), [1.0, 2.0])
        self.assertEqual(C.parse_increments("rien ; 0"), [])
        self.assertEqual(len(C.parse_increments("1 2 3 4 5 6 7 8")), C.MAX_INCREMENTS)

    def test_libelles(self):
        self.assertEqual(C.format_increments([-1, 0.5, 2]), "−1 ; +0,5 ; +2")
        self.assertEqual([C.increment_label(v, True) for v in (1, -1, 0.5, 2)], ["+", "−", "+0,5", "+2"])
        self.assertEqual(C.increment_label(1), "+1")


class ConfigurationTest(unittest.TestCase):
    def test_colonnes_integrees(self):
        base = C.builtin({}, "travail")
        self.assertEqual((base["titre"], base["emoji"], base["increments"], base["visible"]), ("Travail non fait", "📝", [-1, 1], True))
        self.assertEqual(C.builtin({}, "travail", short=True)["titre"], "Travail")
        over = {"builtin": {"travail": {"titre": "Devoirs", "increments": [2], "visible": False}, "oubli": {"emoji": ""}}}
        self.assertEqual(C.builtin(over, "travail", short=True)["titre"], "Devoirs")   # un titre choisi vaut pour toutes les présentations
        self.assertEqual((C.builtin(over, "travail")["increments"], C.builtin(over, "travail")["visible"]), ([2.0], False))
        self.assertEqual(C.builtin(over, "oubli")["emoji"], "")

    def test_barème(self):
        self.assertEqual((C.scale({}), C.scale({"echelle": "10"}), C.scale({"echelle": 0}), C.scale({"echelle": "x"})), (20, 10.0, 20, 20))

    def test_colonnes_personnalisees(self):
        raw = [{"id": "a", "titre": "  Travail   maison ", "type": "compteur", "increments": [0.5, 2], "orange": "3", "rouge": ""},
               {"id": "b", "titre": "Oral", "type": "note", "echelle": "10"}, {"id": "a", "titre": "doublon"}, {"titre": "sans id"}, "n'importe quoi",
               {"id": "c", "type": "inconnu"}]
        cols = C.customs({"colonnes": raw})
        self.assertEqual([c["id"] for c in cols], ["a", "b", "c"])
        self.assertEqual((cols[0]["titre"], cols[0]["increments"], cols[0]["orange"], "rouge" in cols[0]), ("Travail maison", [0.5, 2.0], 3.0, False))
        self.assertEqual((cols[1]["type"], cols[1]["echelle"]), ("note", 10.0))
        self.assertEqual(cols[2]["type"], "compteur")                                # type inconnu : compteur
        self.assertTrue(all(c["visible"] for c in cols))

    def test_suggestions(self):
        ids = [p["id"] for p in C.PRESETS]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertGreaterEqual(len(ids), 10)
        for p in C.PRESETS:
            col = C.from_preset(p)
            self.assertEqual((col["id"], col["preset"], col["type"]), (p["id"], p["id"], p["type"]))
            self.assertTrue(col["titre"])
        self.assertTrue(any(p["type"] == t for p in C.PRESETS for t in ("compteur", "note", "coche", "texte")))
        self.assertTrue(all(isinstance(e, str) and e for _, group in C.EMOJIS for e in group))

    def test_etiquette_du_journal(self):
        st = {"colonnes": [{"id": "x1", "titre": "Retards", "type": "compteur"}], "builtin": {"oubli": {"titre": "Matériel"}}}
        self.assertEqual([C.type_label(st, t) for t in ("seance", "travail", "oubli", "x1", "inconnu")],
                         ["Séance", "Travail non fait", "Matériel", "Retards", "inconnu"])


class ValeursTest(unittest.TestCase):
    def test_totaux_et_ajustements(self):
        s = model.new_student("DUPONT")
        for v in (0.5, 2, -1):
            model.add_event(s, "x1", 1, v)
        self.assertEqual(model.total(s, "x1", 1), 1.5)
        self.assertEqual(model.total(s, "x1", 2), 0)
        model.set_total(s, "x1", 1, 4)
        self.assertEqual(model.total(s, "x1", 1), 4)
        self.assertEqual(s["events"][-1]["note"], "Ajustement manuel")
        model.set_total(s, "x1", 1, 4)
        self.assertEqual(len(s["events"]), 4, "pas de nouvelle entrée si le total ne change pas")

    def test_valeurs_supplementaires(self):
        s = model.new_student("DUPONT")
        self.assertIsNone(model.get_extra(s, "c1", 1))
        model.set_extra(s, "c1", 1, 8.5)
        model.set_extra(s, "c1", 2, "ok")
        self.assertEqual((model.get_extra(s, "c1", 1), model.get_extra(s, "c1", 2), model.get_extra(s, "c1", 3, "")), (8.5, "ok", ""))
        model.set_extra(s, "c1", 1, None)
        self.assertIsNone(model.get_extra(s, "c1", 1))
        old = {"nom": "X", "events": []}                       # élève créé avant les colonnes personnalisées
        self.assertIsNone(model.get_extra(old, "c1", 1))
        model.set_extra(old, "c1", 1, True)
        self.assertTrue(model.get_extra(old, "c1", 1))

    def test_changement_de_bareme(self):
        d = model.new_data()
        cls = d["classes"][0]
        cls["eleves"][0]["notes"] = {"1": 14.0, "2": None, "3": 7.0}
        model.set_extra(cls["eleves"][0], "o", 1, 8.0)
        self.assertEqual(model.rescale_notes(d, 20, 10), sum(1 for c in d["classes"] for s in c["eleves"] for v in s["notes"].values() if v is not None))
        self.assertEqual((cls["eleves"][0]["notes"]["1"], cls["eleves"][0]["notes"]["3"]), (7.0, 3.5))
        self.assertEqual(model.rescale_extra(d, "o", 10, 5), 1)
        self.assertEqual(model.get_extra(cls["eleves"][0], "o", 1), 4.0)

    def test_export_avec_colonnes_personnalisees(self):
        s = model.new_student("DUPONT", "Marie")
        c = model.new_class("6A")
        c["eleves"].append(s)
        model.add_event(s, "x1", 1, 2)
        extras = [("x1", "Travail maison", lambda e, t: X.fmt_num(model.total(e, "x1", t))), ("c2", "Carnet", lambda e, t: "oui")]
        text, _ = X.build_export(c, ["nom", "x1", "c2"], 1, True, ";", 0, model.stats, "S", "semestre", extras)
        self.assertEqual(text.split("\r\n"), ["Nom;Travail maison S1;Carnet S1", "DUPONT;2;oui"])


if __name__ == "__main__":
    unittest.main()
