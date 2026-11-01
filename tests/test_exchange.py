import unittest

from suiviclasse import exchange as X
from suiviclasse.model import new_class, new_student, stats


def student(nom, prenom):
    return new_student(nom, prenom)


def cls(nom, *eleves):
    c = new_class(nom)
    c["eleves"].extend(eleves)
    return c


def apply(classes, rows, roles, skip=1, class_id=None, create=True):
    return X.apply_table(classes, rows, roles, skip, class_id, create, new_student, new_class)


class ExchangeTest(unittest.TestCase):
    def test_separateur_et_guillemets(self):
        self.assertEqual(X.detect_delimiter("Nom\tPrénom\nA\tB"), "\t")
        self.assertEqual(X.detect_delimiter("Nom;Prénom\nA;B"), ";")
        self.assertEqual(X.parse_table('﻿Nom;Appréciation\r\n"DUPONT";"Dit ""bien"";\nok"\r\n'),
                         [["Nom", "Appréciation"], ["DUPONT", 'Dit "bien";\nok']])

    def test_roles_des_colonnes(self):
        g = X.guess_role
        self.assertEqual([g("Nom"), g("Prénom"), g("Classe"), g("Moyenne T2"), g("Appréciation Trimestre 3")],
                         ["nom", "prenom", "classe", "note2", "comm3"])
        self.assertEqual(g("Moyenne", 2), "note2")
        self.assertEqual(g("Né(e) le"), "naissance")
        self.assertEqual(g("Délégué"), "ignore")
        self.assertTrue(X.looks_like_header(["Nom", "Prénom"]))
        self.assertFalse(X.looks_like_header(["DUPONT", "14,5"]))

    def test_notes_pronote(self):
        p = X.parse_note
        self.assertEqual(p("14,5"), (14.5, "note"))
        self.assertEqual(p("12,25 /20")[0], 12.25)
        self.assertEqual(p("21")[0], 21)
        self.assertEqual(p("Abs")[1], "annotation")
        self.assertEqual(p("N.Rdu")[1], "annotation")
        self.assertEqual(p("Z"), (0.0, "zero"))
        self.assertEqual(p("N. Rdu*"), (0.0, "zero"))
        self.assertEqual(p("")[1], "empty")
        self.assertEqual(p("bof")[1], "invalid")

    def test_nom_complet(self):
        self.assertEqual(X.split_full_name("NOM3 Prénom Composé"), ("NOM3", "Prénom Composé"))
        self.assertEqual(X.split_full_name("DE LA FONTAINE Jean"), ("DE LA FONTAINE", "Jean"))
        self.assertEqual(X.split_full_name("LE GALL Anne-Sophie"), ("LE GALL", "Anne-Sophie"))
        self.assertEqual(X.split_full_name("Martin Paul"), ("Martin", "Paul"))

    def test_import_met_a_jour_les_eleves_existants(self):
        classes = [cls("6A", student("DUPONT", "Marie"), student("LE GALL", "Anne-Sophie"))]
        rows = X.parse_table("Nom\tPrénom\tMoyenne T1\tAppréciation T1\nDupont\tMARIE\t14,5\tBon début\n"
                             "Le Gall\tAnne Sophie\tAbs\t\nMARTIN\tPaul\t9\t")
        rep = apply(classes, rows, [X.guess_role(h) for h in rows[0]], class_id=classes[0]["id"], create=False)
        self.assertEqual((rep["updated"], rep["unchanged"], rep["unmatched"]), (1, 1, ["MARTIN Paul"]))
        e = classes[0]["eleves"]
        self.assertEqual((e[0]["notes"]["1"], e[0]["comms"]["1"], e[1]["notes"]["1"]), (14.5, "Bon début", None))

        rows = X.parse_table("Classe;Nom et prénom;Note T2\n5B;DURAND Éric;11,5")
        rep = apply(classes, rows, ["classe", "nomprenom", "note2"], class_id=classes[0]["id"])
        self.assertEqual((rep["created"], rep["createdClasses"]), (1, 1))
        self.assertEqual((classes[1]["eleves"][0]["prenom"], classes[1]["eleves"][0]["notes"]["2"]), ("Éric", 11.5))

    def test_annotation_ne_modifie_pas_une_note_existante(self):
        c = cls("6A", student("DUPONT", "Marie"))
        c["eleves"][0]["notes"]["1"] = 12.0
        rows = X.parse_table("Nom\tPrénom\tMoyenne T1\nDUPONT\tMarie\tAbs")
        apply([c], rows, ["nom", "prenom", "note1"], class_id=c["id"], create=False)
        self.assertEqual(c["eleves"][0]["notes"]["1"], 12.0)

    def test_liste_d_eleves_copiee_depuis_pronote(self):
        txt = ('Élève\t"Né(e) le"\tClasse\n"NOM1 Prénom1"\t09/08/2015\t6G\n"NOM2 Prénom2"\t22/07/2015\t6E\n'
               '"NOM3 Prénom Composé"\t25/07/2015\t6G\n"NOM4 Prénom4"\t22/08/2015\t6F')
        rows = X.parse_table(txt)
        roles = [X.guess_role(h) for h in rows[0]]
        self.assertEqual(roles, ["nomprenom", "naissance", "classe"])
        classes = []
        rep = apply(classes, rows, roles)
        self.assertEqual(sorted(c["nom"] for c in classes), ["6E", "6F", "6G"])
        self.assertEqual(rep["classes"], {"6G": 2, "6E": 1, "6F": 1})
        g = next(c for c in classes if c["nom"] == "6G")["eleves"]
        self.assertEqual([(e["nom"], e["prenom"], e["naissance"]) for e in g],
                         [("NOM1", "Prénom1", "09/08/2015"), ("NOM3", "Prénom Composé", "25/07/2015")])
        rep = apply(classes, rows, roles)  # réimport : aucun doublon
        self.assertEqual((rep["created"], rep["unchanged"]), (0, 4))
        homonyme = X.parse_table("Élève\tNé(e) le\tClasse\nNOM1 Prénom1\t01/01/2014\t6G")
        self.assertEqual(apply(classes, homonyme, roles)["created"], 1)

    def test_export(self):
        s = student("DUPONT", "Marie")
        s["notes"]["2"] = 14.5
        s["comms"]["2"] = "x" * 300
        m = student("MARTIN", "Paul")
        m["comms"]["2"] = 'Dit "ok"; bien'
        c = cls("6A", s, m)
        st = lambda e, t: (1, -0.5, 2, 0)
        text, long = X.build_export(c, ["nom", "prenom", "note", "comm"], 2, True, "\t", 255, st)
        lines = text.split("\r\n")
        self.assertEqual(lines[0], "Nom\tPrénom\tNote du trimestre T2\tAppréciation du trimestre T2")
        self.assertTrue(lines[1].startswith("DUPONT\tMarie\t14,5\t"))
        self.assertEqual(long, ["DUPONT Marie (300)"])
        text, _ = X.build_export(c, ["nom", "comm"], 2, False, ";", 0, st)
        self.assertEqual(text.split("\r\n")[1], 'MARTIN;"Dit ""ok""; bien"')


if __name__ == "__main__":
    unittest.main()
