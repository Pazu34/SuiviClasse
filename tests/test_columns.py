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
        base = C.builtin({}, "oubli")
        self.assertEqual((base["titre"], base["emoji"], base["increments"], base["visible"]), ("Oubli matériel", "🎒", [-1, 1], True))
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


class ColonnesDeBaseTest(unittest.TestCase):
    def test_reglages_par_defaut_et_modifies(self):
        b = C.base({}, "comm")
        self.assertEqual((b["titre"], b["visible"]), ("Commentaire bulletin", True))
        self.assertEqual((C.base({}, "infos")["titre"], C.base({}, "infos", short=True)["titre"]), ("Infos (PAI…)", "Infos"))
        self.assertEqual(C.base({}, "fiche")["emoji"], "📝")
        st = {"base": {"prenom": {"titre": "Prénoms", "visible": False}, "fiche": {"emoji": "🔍"}, "nom": {"visible": False}}}
        self.assertEqual((C.base(st, "prenom")["titre"], C.base(st, "prenom")["visible"]), ("Prénoms", False))
        self.assertEqual(C.base(st, "fiche")["emoji"], "🔍")
        self.assertTrue(C.base(st, "nom")["visible"], "le nom ne peut pas être masqué")

    def test_ordre_des_colonnes(self):
        self.assertEqual(C.order({}, []), C.DEFAULT_ORDER)
        self.assertEqual(C.order({}, ["c1", "c2"]), ["numero", "nom", "prenom", "infos", "notes", "qualSeance", "qualMaison", "seancePlus", "seanceMoins",
                                                     "travail", "oubli", "c1", "c2", "comm", "fiche"])
        # ordre choisi : on le respecte ; les colonnes manquantes reprennent leur place, les inconnues sont ignorées
        st = {"ordre": ["prenom", "nom", "inconnue", "c1", "travail", "prenom"]}
        got = C.order(st, ["c1", "c2"])
        self.assertEqual(got[0], "numero")                              # « numero » manquait : il reprend sa place habituelle (en tête)
        self.assertEqual(got[got.index("prenom") + 1], "infos")         # « infos » manquait : il se place après sa voisine habituelle
        self.assertLess(got.index("prenom"), got.index("nom"))
        self.assertEqual(sorted(got), sorted(C.DEFAULT_ORDER + ["c1", "c2"]))
        self.assertLess(got.index("c1"), got.index("travail"))
        self.assertLess(got.index("c2"), got.index("comm"))


class MenuDeroulantTest(unittest.TestCase):
    def test_analyse_des_choix(self):
        self.assertEqual(C.parse_choices("Excellente\nBonne\n  Bonne \nÀ améliorer ; Insuffisante\n\n"), ["Excellente", "Bonne", "À améliorer", "Insuffisante"])
        self.assertEqual(C.parse_choices(["  a  ", "", "a", "b"]), ["a", "b"])
        self.assertEqual(len(C.parse_choices("\n".join(str(i) for i in range(50)))), C.MAX_CHOICES)
        self.assertEqual(len(C.parse_choices("x" * 100)[0]), C.MAX_CHOICE_LEN)
        self.assertEqual(C.parse_choices(""), [])

    def test_colonne_liste(self):
        col = C.sanitize_column({"id": "l1", "titre": "Attitude", "type": "liste", "choix": ["A", "B", "A"]})
        self.assertEqual((col["type"], col["choix"]), ("liste", ["A", "B"]))
        self.assertIn("liste", dict(C.TYPES))
        self.assertTrue(any(p["type"] == "liste" and p["choix"] for p in C.PRESETS))

    def test_reglages_conserves_au_changement_de_type(self):
        liste = C.sanitize_column({"id": "x", "titre": "T", "type": "liste", "choix": ["A", "B"], "increments": [1, 2]})
        texte = C.sanitize_column({**liste, "type": "texte"})                      # on change de type…
        self.assertEqual((texte["type"], texte["choix"], texte["increments"]), ("texte", ["A", "B"], [1.0, 2.0]))
        self.assertEqual(C.sanitize_column({**texte, "type": "liste"})["choix"], ["A", "B"])   # …puis on revient : choix retrouvés
        self.assertEqual("choix" in C.sanitize_column({"id": "y", "type": "compteur"}), False)  # rien d'inventé pour les autres


class ChangementDeTypeTest(unittest.TestCase):
    def test_valeurs_reprises_selon_le_type(self):
        c = model.coerce_extra
        self.assertEqual((c("7,5", "note"), c("Bonne", "note"), c(True, "note"), c(8.5, "note")), (7.5, None, None, 8.5))
        self.assertEqual((c(8.5, "texte"), c(True, "liste"), c("Bonne", "liste"), c("", "texte"), c(False, "texte")), ("8,5", "oui", "Bonne", None, None))
        self.assertEqual((c("Oui", "coche"), c(True, "coche"), c(1, "coche"), c("Bonne", "coche"), c(0, "coche")), (True, True, True, None, None))

    def test_extra_value_utilise_le_type_actuel(self):
        s = model.new_student("X")
        model.set_extra(s, "c", 1, "7,5")
        self.assertEqual(model.extra_value(s, {"id": "c", "type": "note"}, 1), 7.5)
        self.assertEqual(model.extra_value(s, {"id": "c", "type": "texte"}, 1), "7,5")
        self.assertIsNone(model.extra_value(s, {"id": "c", "type": "coche"}, 1))


class IconesTest(unittest.TestCase):
    def test_png_valide_et_couleur(self):
        import struct
        import zlib

        from suiviclasse.ui import icons
        data = icons.arrow_png("#336699", 16)
        self.assertEqual(data[:8], b"\x89PNG\r\n\x1a\n")
        w, h = struct.unpack(">II", data[16:24])
        self.assertEqual((w, h), (16, 16))
        idat = data[data.index(b"IDAT") + 4:data.index(b"IEND") - 8]
        raw = zlib.decompress(idat)
        rows = [raw[i * (1 + 64) + 1:(i + 1) * (1 + 64)] for i in range(16)]
        alphas = [row[k + 3] for row in rows for k in range(0, 64, 4)]
        self.assertTrue(any(a > 200 for a in alphas), "la flèche est dessinée")
        self.assertTrue(any(a == 0 for a in alphas), "le fond reste transparent")
        self.assertTrue(any(0 < a < 255 for a in alphas), "les bords sont lissés")
        px = next(row[k:k + 4] for row in rows for k in range(0, 64, 4) if row[k + 3] > 200)
        self.assertEqual(tuple(px[:3]), (0x33, 0x66, 0x99))
        self.assertNotEqual(icons.arrow_png("#336699", 16, flip=True), data, "« rétablir » est le symétrique de « annuler »")


class NotesLettresTest(unittest.TestCase):
    """Colonnes « Travail en séance » et « Travail à la maison » : une lettre de A à E par séance, moyenne par période."""

    def eleve(self, seance="", maison="", t=1):
        s = model.new_student("Martin", "Léa")
        for letter in seance:
            model.add_event(s, "qualSeance", t, model.grade_value(letter))
        for letter in maison:
            model.add_event(s, "qualMaison", t, model.grade_value(letter))
        return s

    def test_lettres_et_valeurs(self):
        self.assertEqual([model.grade_value(x) for x in "ABCDE"], [5, 4, 3, 2, 1])
        self.assertEqual([model.grade_letter(v) for v in (5, 4, 3, 2, 1)], list("ABCDE"))

    def test_non_note(self):
        s = self.eleve()
        self.assertIsNone(model.grade_mean(s, "qualSeance", 1))
        self.assertEqual(model.grade_text(model.grade_mean(s, "qualSeance", 1)), "non noté")
        self.assertEqual(model.grade_level(None), "")

    def test_moyenne_par_colonne_et_par_periode(self):
        s = self.eleve("AB", "E")
        model.add_event(s, "qualSeance", 2, model.grade_value("E"))   # un autre trimestre : ne compte pas
        self.assertEqual(model.grade_mean(s, "qualSeance", 1), 4.5)
        self.assertEqual(model.grade_text(model.grade_mean(s, "qualSeance", 1)), "A−")
        self.assertEqual(model.grade_text(model.grade_mean(s, "qualMaison", 1)), "E")
        self.assertEqual(model.grade_text(model.grade_mean(s, "qualSeance", 2)), "E")
        self.assertEqual(model.grade_text(model.grade_mean(s, "qualMaison", 3)), "non noté")

    def test_lettre_de_la_moyenne(self):
        got = {m: model.grade_text(m) for m in (5, 4.6, 4.3, 4, 3.7, 3.1, 3, 2.9, 2.8, 2.3, 2, 1.5, 1.2, 1)}
        self.assertEqual(got, {5: "A", 4.6: "A−", 4.3: "B+", 4: "B", 3.7: "B−", 3.1: "C", 3: "C", 2.9: "C", 2.8: "C−",
                               2.3: "D+", 2: "D", 1.5: "D−", 1.2: "E+", 1: "E"})
        self.assertEqual([model.grade_level(m) for m in (5, 4, 3, 2, 1)], ["ok", "ok", "", "warn", "bad"])

    def test_annuler_la_derniere_note(self):
        s = self.eleve("ABC")
        model.remove_last(s, "qualSeance", 1)
        self.assertEqual(model.grade_mean(s, "qualSeance", 1), 4.5)
        self.assertEqual(len(model.grade_events(s, "qualSeance", 1)), 2)

    def test_les_notes_n_alterent_pas_les_compteurs(self):
        s = self.eleve("AAA", "BB")
        self.assertEqual(model.stats(s, 1), (0, 0, 0, 0))

    def test_affichage_par_defaut(self):
        visible = [k for k in C.BUILTIN_ORDER if C.builtin({}, k)["visible"]]
        self.assertEqual(visible, ["qualSeance", "qualMaison", "oubli"])
        self.assertEqual(C.builtin({}, "qualMaison")["type"], "niveaux")
        # un ancien compteur masqué par défaut se réaffiche à la demande
        self.assertTrue(C.builtin({"builtin": {"travail": {"visible": True}}}, "travail")["visible"])
        self.assertFalse(C.builtin({"builtin": {"qualSeance": {"visible": False}}}, "qualSeance")["visible"])

    def test_libelle_du_journal(self):
        self.assertEqual(C.type_label({}, "qualSeance"), "Travail en séance")
        self.assertEqual(C.type_label({"builtin": {"qualMaison": {"titre": "Devoirs"}}}, "qualMaison"), "Devoirs")

    def test_classe_test_avec_notes(self):
        cls = model.demo_class()
        mean = {s["prenom"]: model.grade_text(model.grade_mean(s, "qualSeance", 1)) for s in cls["eleves"]}
        self.assertEqual(mean["Noah"], "non noté")
        self.assertEqual(mean["Emma"], "A−")
        self.assertEqual(model.grade_text(model.grade_mean(next(s for s in cls["eleves"] if s["prenom"] == "Jules"), "qualMaison", 1)), "non noté")


class NiveauxPersonnalisesTest(unittest.TestCase):
    """Colonnes à niveaux ajoutées par l'utilisateur : 2 à 5 niveaux nommés, règle de la note finale (moyenne ou X dernières notes)."""

    def eleve(self, notes):
        """notes : [(période, valeur)] dans l'ordre d'attribution ; les dates croissent avec l'ordre."""
        s = model.new_student("Martin", "Léa")
        for i, (t, v) in enumerate(notes):
            model.add_event(s, "c1", t, v)
            s["events"][-1]["date"] = f"2026-09-{10 + i:02d}T10:00:00.000Z"
        return s

    def final(self, s, t, regle, x=3, n=5):
        return model.grade_mean(s, "c1", t, regle, x, n)

    def test_les_quatre_regles(self):
        # T1 : 5, 1, 3 ; T2 : 4, 2, 5, 5
        s = self.eleve([(1, 5), (1, 1), (1, 3), (2, 4), (2, 2), (2, 5), (2, 5)])
        self.assertEqual(self.final(s, 1, "periode"), 3)
        self.assertEqual(self.final(s, 2, "periode"), 4)                               # (4+2+5+5)/4
        self.assertAlmostEqual(self.final(s, 2, "annee"), 25 / 7)                      # tout depuis le début de l'année
        self.assertEqual(self.final(s, 1, "annee"), 3)                                 # le T2 ne compte pas pour le bulletin du T1
        self.assertAlmostEqual(self.final(s, 2, "dernieres_periode", 3), 4)            # 2, 5, 5 -> 4
        self.assertAlmostEqual(self.final(s, 2, "dernieres_periode", 2), 5)            # 5, 5
        self.assertAlmostEqual(self.final(s, 2, "dernieres_annee", 5), 19 / 5)         # 3, 4, 2, 5, 5 -> les 5 dernières, toutes périodes
        self.assertAlmostEqual(self.final(s, 1, "dernieres_annee", 2), 2)              # 1 et 3 : seules les notes jusqu'au T1 comptent

    def test_moins_de_notes_que_x(self):
        s = self.eleve([(1, 4), (1, 2)])
        self.assertEqual(self.final(s, 1, "dernieres_periode", 5), 3)                  # on moyenne ce qui existe
        self.assertIsNone(self.final(s, 2, "dernieres_periode", 3))                    # rien au T2 : non noté
        self.assertEqual(model.grade_text(self.final(s, 2, "periode")), "non noté")
        self.assertEqual(self.final(s, 2, "annee"), 3)                                 # mais l'année a des notes

    def test_ordre_chronologique_et_pas_ordre_du_journal(self):
        s = self.eleve([(1, 5), (1, 1), (1, 3)])
        s["events"][0]["date"] = "2026-10-01T10:00:00.000Z"                            # la note « 5 » est en fait la plus récente
        self.assertEqual(self.final(s, 1, "dernieres_periode", 1), 5)

    def test_noms_de_niveaux_personnalises(self):
        niv = ["Très bien", "Bien", "À revoir"]
        self.assertEqual([model.grade_text(m, niv) for m in (None, 3, 2.7, 2, 1.2, 1)],
                         ["non noté", "Très bien", "Très bien−", "Bien", "À revoir+", "À revoir"])
        self.assertEqual([model.grade_value(x, niv) for x in niv], [3, 2, 1])
        self.assertEqual(model.grade_rank(2.2, 3), 2)

    def test_couleurs_selon_le_nombre_de_niveaux(self):
        self.assertEqual([model.grade_level(v, 2) for v in (2, 1)], ["ok", "bad"])
        self.assertEqual([model.grade_level(v, 3) for v in (3, 2, 1)], ["ok", "", "bad"])
        self.assertEqual([model.grade_level(v, 4) for v in (4, 3, 2, 1)], ["ok", "ok", "warn", "bad"])
        self.assertEqual([model.grade_level(v, 5) for v in (5, 4, 3, 2, 1)], ["ok", "ok", "", "warn", "bad"])

    def test_note_hors_echelle_ramenee_au_meilleur_niveau(self):
        s = self.eleve([(1, 5)])                                                       # enregistrée quand il y avait 5 niveaux
        self.assertEqual(self.final(s, 1, "periode", n=3), 3)

    def test_analyse_des_niveaux(self):
        self.assertEqual(C.parse_levels("Très bien\nBien\n\nbien\nMoyen\nFaible\nTrès faible\nde trop"), ["Très bien", "Bien", "Moyen", "Faible", "Très faible"])
        self.assertEqual(C.parse_levels(["Seul"]), C.DEFAULT_LEVELS)                  # moins de deux niveaux : A à E
        self.assertEqual(len(C.parse_levels(["x" * 50, "y"])[0]), C.MAX_LEVEL_LEN)

    def test_analyse_de_la_regle(self):
        self.assertEqual(C.parse_rule("dernieres_annee", "5"), ("dernieres_annee", 5))
        self.assertEqual(C.parse_rule("n'importe quoi", None), ("periode", 3))        # X vaut 3 par défaut
        self.assertEqual(C.parse_rule("annee", "250"), ("annee", 99))
        self.assertEqual(C.parse_rule("annee", "-4"), ("annee", 1))
        self.assertEqual(C.rule_label("dernieres_periode", 4, "semestre"), "Moyenne des 4 dernières notes du semestre")
        self.assertEqual(C.rule_label("annee", 3), "Moyenne des notes depuis le début de l'année")

    def test_colonne_personnalisee_a_niveaux(self):
        col = C.sanitize_column({"id": "c1", "type": "niveaux", "titre": "Oral", "niveaux": ["Oui", "Moyen", "Non"], "regle": "dernieres_annee", "x": 2})
        self.assertEqual((col["niveaux"], col["regle"], col["x"]), (["Oui", "Moyen", "Non"], "dernieres_annee", 2))
        defaut = C.sanitize_column({"id": "c2", "type": "niveaux"})
        self.assertEqual((defaut["niveaux"], defaut["regle"], defaut["x"]), (C.DEFAULT_LEVELS, "periode", 3))
        st = {"colonnes": [col, {"id": "c3", "type": "compteur"}], "builtin": {"qualMaison": {"niveaux": ["Oui", "Non"], "regle": "annee"}}}
        got = C.grade_columns(st)
        self.assertEqual([g["key"] for g in got], ["qualSeance", "qualMaison", "c1"])
        self.assertEqual([g["event"] for g in got], ["qualSeance", "qualMaison", "c1"])
        self.assertEqual((got[1]["niveaux"], got[1]["regle"]), (["Oui", "Non"], "annee"))
        self.assertEqual(len(C.grade_columns({"builtin": {"qualSeance": {"visible": False}}})), 1)

    def test_changement_du_nombre_de_niveaux(self):
        data = {"classes": [{"eleves": [self.eleve([(1, 5), (1, 4), (1, 3), (1, 2), (1, 1)])]}]}
        other = model.new_student("X", "Y")
        model.add_event(other, "autre", 1, 5)
        data["classes"][0]["eleves"].append(other)
        self.assertEqual(model.rescale_levels(data, "c1", 5, 3), 5)
        self.assertEqual([e["v"] for e in data["classes"][0]["eleves"][0]["events"]], [3, 3, 2, 2, 1])   # 5->3, 4->3 (2,25+1), 3->2, 2->2, 1->1
        self.assertEqual(data["classes"][0]["eleves"][1]["events"][0]["v"], 5)                          # une autre colonne n'est pas touchée
        self.assertEqual(model.rescale_levels(data, "c1", 3, 3), 0)
