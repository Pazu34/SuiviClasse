import random
import unittest

from suiviclasse import model
from suiviclasse import plan as P


def classe(*noms):
    c = model.new_class("6A")
    for nom, prenom in noms:
        c["eleves"].append(model.new_student(nom, prenom))
    model.sort_students(c)
    return c


class NomsTest(unittest.TestCase):
    def test_modes_d_affichage(self):
        s = model.new_student("DUPONT", "Marie")
        got = {m: P.display_name(s, m) for m, _ in P.DISPLAY_MODES}
        self.assertEqual(got, {"prenom_nom": "Marie Dupont", "prenom": "Marie", "nom": "Dupont", "prenom_i": "Marie D.", "initiales": "MD"})
        self.assertEqual(P.display_name(model.new_student("LE GALL", "Anne-Sophie"), "initiales"), "AL")
        self.assertEqual(P.display_name(model.new_student("Martin", ""), "prenom"), "Martin")   # repli si un champ est vide
        self.assertEqual(P.display_name(model.new_student("", ""), "initiales"), "?")


class SalleTest(unittest.TestCase):
    def test_generateurs(self):
        s = P.new_salle("Salle 12")
        self.assertEqual(len(P.add_rows(s, 3, 4)), 12)
        self.assertEqual(len({p["id"] for p in s["places"]}), 12)
        self.assertEqual(len(P.add_islands(s, 2, 2)), 16)                 # 4 îlots de 4 places
        self.assertEqual(len(P.add_rows(P.new_salle(), 2, 6, group=2, pair_gap=30)), 12)
        xs = sorted({p["x"] for p in P.add_rows(P.new_salle(), 1, 4, group=2, pair_gap=30)})
        self.assertGreater(xs[2] - xs[1], xs[1] - xs[0])                   # espace plus large entre les binômes

    def test_ordre_de_lecture_et_dimensions(self):
        s = P.new_salle()
        P.add_place(s, 300, 200)
        P.add_place(s, 40, 205)      # même rangée (à quelques pixels près) mais plus à gauche
        P.add_place(s, 40, 20)
        order = P.reading_order(s)
        self.assertEqual([next(p for p in s["places"] if p["id"] == i)["x"] for i in order], [40, 40, 300])
        self.assertEqual(next(p for p in s["places"] if p["id"] == order[0])["y"], 20)
        w, h = P.bounds(s)
        self.assertGreaterEqual(w, 300 + P.PLACE_W)
        self.assertGreaterEqual(h, 205 + P.PLACE_H)
        self.assertEqual(P.snap(47), 50)

    def test_salle_d_exemple(self):
        s = P.demo_salle()
        self.assertEqual((len(s["places"]), [m["texte"] for m in s["reperes"]]), (12, ["Tableau", "Bureau du professeur"]))

    def test_tableau_et_bureau_en_bas_par_defaut(self):
        s = P.demo_salle()
        bas_des_places = max(p["y"] + s["place"]["h"] for p in s["places"])
        for m in s["reperes"]:
            self.assertGreater(m["y"], bas_des_places)
        self.assertTrue(P.front_is_bottom(s))

    def test_remplissage_depuis_le_tableau(self):
        s = P.demo_salle()
        premiere = next(p for p in s["places"] if p["id"] == P.reading_order(s)[0])
        self.assertEqual(premiere["y"], max(p["y"] for p in s["places"]))  # rangée la plus proche du tableau
        haut = P.new_salle()
        P.add_rows(haut, 2, 2)
        P.add_marker(haut, "Tableau", 40, 0)
        self.assertFalse(P.front_is_bottom(haut))

    def test_nouvelle_salle_commence_en_haut(self):
        s = P.new_salle()
        P.add_rows(s, 1, 1)
        self.assertEqual(s["places"][0]["y"], 40)

    def test_redimensionner_un_repere(self):
        m = P.add_marker(P.new_salle(), "Porte", 100, 100)
        P.resize_marker(m, "se", 304, 196)
        self.assertEqual((m["x"], m["y"], m["w"], m["h"]), (100, 100, 200, 100))
        P.resize_marker(m, "nw", 50, 60)
        self.assertEqual((m["x"], m["y"], m["w"], m["h"]), (50, 60, 250, 140))
        P.resize_marker(m, "se", 0, 0)  # taille minimale
        self.assertEqual((m["w"], m["h"]), (P.MIN_MARKER, P.MIN_MARKER))

    def test_pivoter_un_repere(self):
        m = P.add_marker(P.new_salle(), "Porte", 100, 100, 130, 34)
        centre = (m["x"] + m["w"] / 2, m["y"] + m["h"] / 2)
        P.rotate_marker(m)
        self.assertEqual((m["w"], m["h"], m["angle"]), (34, 130, 90))
        self.assertAlmostEqual(m["x"] + m["w"] / 2, centre[0], delta=P.GRID)
        self.assertAlmostEqual(m["y"] + m["h"] / 2, centre[1], delta=P.GRID)
        P.rotate_marker(m)
        self.assertEqual((m["w"], m["h"], m["angle"]), (130, 34, 0))

    def test_retourner_la_salle(self):
        s = P.demo_salle()
        avant = P.front_is_bottom(s)
        P.rotate_room(s)
        self.assertNotEqual(P.front_is_bottom(s), avant)
        self.assertEqual(len(s["places"]), 12)
        P.rotate_room(s)
        self.assertEqual(P.front_is_bottom(s), avant)

    def test_ancien_repere_sans_angle(self):
        s = P.new_salle()
        s["reperes"].append({"id": "a", "texte": "Porte", "x": 0, "y": 0, "w": 130, "h": 34})
        self.assertEqual(P.copy_salle(s, "Copie")["reperes"][0].get("angle", 0), 0)


class RepartitionTest(unittest.TestCase):
    def setUp(self):
        self.salle = P.new_salle()
        self.places = P.add_rows(self.salle, 2, 3)
        self.cls = classe(("ANDRÉ", "Léa"), ("BERNARD", "Zoé"), ("CAMUS", "Paul"), ("DUBOIS", "Emma"))
        self.ids = [s["id"] for s in self.cls["eleves"]]
        self.plan = P.new_plan("Plan T1", self.salle["id"])

    def test_placer_echanger_deplacer(self):
        a, b, c = self.places[0]["id"], self.places[1]["id"], self.places[2]["id"]
        P.assign(self.plan, a, self.ids[0])
        P.assign(self.plan, b, self.ids[1])
        P.assign(self.plan, a, self.ids[1])                      # élève 1 sur la place de l'élève 0 : ils échangent
        self.assertEqual(self.plan["places"], {a: self.ids[1], b: self.ids[0]})
        P.assign(self.plan, c, self.ids[1])                      # vers une place libre : sa place précédente se libère
        self.assertEqual(self.plan["places"], {c: self.ids[1], b: self.ids[0]})
        P.assign(self.plan, b, self.ids[2])                      # élève sans place sur une place occupée : l'occupant n'a plus de place
        self.assertEqual(self.plan["places"], {c: self.ids[1], b: self.ids[2]})
        self.assertEqual([s["nom"] for s in P.without_place(self.plan, self.cls)], ["ANDRÉ", "DUBOIS"])
        P.unassign(self.plan, self.ids[1])
        self.assertIsNone(P.place_of(self.plan, self.ids[1]))

    def test_remplissage_automatique(self):
        left = P.auto_fill(self.plan, self.salle, self.cls, "alpha")
        self.assertEqual(left, 0)
        order = P.reading_order(self.salle)
        self.assertEqual([self.plan["places"][p] for p in order[:4]], self.ids)       # ordre alphabétique, rangée par rangée
        P.assign(self.plan, order[0], self.ids[3])                                    # on modifie à la main…
        before = dict(self.plan["places"])
        P.auto_fill(self.plan, self.salle, self.cls, "alpha", keep=True)               # …« garder » ne touche à rien
        self.assertEqual(self.plan["places"], before)
        P.auto_fill(self.plan, self.salle, self.cls, "hasard", keep=False, rng=random.Random(3))
        self.assertEqual(sorted(self.plan["places"].values()), sorted(self.ids))      # tout le monde est placé une seule fois
        self.assertNotEqual([self.plan["places"].get(p) for p in order[:4]], self.ids)

    def test_trop_d_eleves(self):
        small = P.new_salle()
        P.add_rows(small, 1, 2)
        plan = P.new_plan("p", small["id"])
        self.assertEqual(P.auto_fill(plan, small, self.cls), 2)
        self.assertEqual(len(plan["places"]), 2)

    def test_nettoyage(self):
        P.auto_fill(self.plan, self.salle, self.cls)
        self.salle["places"].pop(0)                                   # une place supprimée de la salle
        self.cls["eleves"].pop(1)                                     # un élève supprimé de la classe
        P.clean(self.plan, self.salle, self.cls)
        ids = {p["id"] for p in self.salle["places"]}
        students = {s["id"] for s in self.cls["eleves"]}
        self.assertTrue(all(p in ids and s in students for p, s in self.plan["places"].items()))
        self.assertEqual(len(self.plan["places"]), 2)                 # 4 élèves placés, moins la place supprimée, moins l’élève supprimé

    def test_repartition_active(self):
        self.assertIsNone(P.active_plan(self.cls))
        p1, p2 = P.new_plan("T1", "s"), P.new_plan("T2", "s")
        P.plans(self.cls).extend([p1, p2])
        self.assertIs(P.active_plan(self.cls), p1)                    # par défaut : la première
        self.cls["plan_actif"] = p2["id"]
        self.assertIs(P.active_plan(self.cls), p2)
        self.cls["plan_actif"] = "supprimée"
        self.assertIs(P.active_plan(self.cls), p1)


class IncrementsTest(unittest.TestCase):
    def test_increment_principal(self):
        self.assertEqual((P.primary_increment([-1, 1]), P.primary_increment([0.5, 1]), P.primary_increment([-0.5, -1]), P.primary_increment([])), (1, 0.5, -0.5, 1))
        self.assertEqual((P.initial_text("Travail maison"), P.initial_text("éval"), P.initial_text("")), ("T", "E", "?"))


if __name__ == "__main__":
    unittest.main()


class EditeurTest(unittest.TestCase):
    def test_prochaine_place_libre(self):
        s = P.new_salle()
        x1, y1 = P.next_free_spot(s)
        P.add_place(s, x1, y1)
        x2, y2 = P.next_free_spot(s)
        self.assertNotEqual((x1, y1), (x2, y2))
        for _ in range(30):                                   # on remplit : jamais deux places superposées
            P.add_place(s, *P.next_free_spot(s))
        pos = [(p["x"], p["y"]) for p in s["places"]]
        self.assertEqual(len(pos), len(set(pos)))

    def test_alignement(self):
        s = P.new_salle()
        a, b, c = P.add_place(s, 40, 100), P.add_place(s, 130, 150), P.add_place(s, 400, 230)
        P.align([a, b, c], "left")
        self.assertEqual({a["x"], b["x"], c["x"]}, {40})
        P.align([a, b, c], "top")
        self.assertEqual({a["y"], b["y"], c["y"]}, {100})
        a2, b2, c2 = P.add_place(s, 0, 0), P.add_place(s, 30, 0), P.add_place(s, 200, 0)
        P.align([a2, b2, c2], "hspace")
        self.assertEqual((a2["x"], b2["x"], c2["x"]), (0, 100, 200))

    def test_copie_de_salle(self):
        s = P.demo_salle()
        c = P.copy_salle(s, "Copie")
        self.assertEqual((c["nom"], len(c["places"]), len(c["reperes"])), ("Copie", 12, 2))
        self.assertTrue({p["id"] for p in c["places"]}.isdisjoint({p["id"] for p in s["places"]}))
        self.assertNotEqual(c["id"], s["id"])

    def test_nouveau_coffre_contient_une_salle_et_une_repartition(self):
        d = model.new_data()
        self.assertEqual(len(d["salles"]), 1)
        cls = d["classes"][0]
        plan = P.active_plan(cls)
        self.assertEqual(plan["salle"], d["salles"][0]["id"])
        self.assertEqual(len(plan["places"]), len(cls["eleves"]))


class SalleSupprimeeTest(unittest.TestCase):
    def test_sans_salle_les_placements_sont_conserves(self):
        salle = P.new_salle()
        P.add_rows(salle, 1, 2)
        cls = classe(("A", "a"), ("B", "b"))
        plan = P.new_plan("p", salle["id"])
        P.auto_fill(plan, salle, cls)
        before = dict(plan["places"])
        P.clean(plan, None, cls)                       # la salle a été supprimée
        self.assertEqual(plan["places"], before)
