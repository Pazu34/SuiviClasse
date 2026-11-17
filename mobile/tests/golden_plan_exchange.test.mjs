// Tests « dorés » (suite) : plan de classe, import et export — résultats identiques en Python et en JavaScript.
import assert from "node:assert/strict";
import test from "node:test";
import { py } from "./helpers.mjs";
import * as M from "../www/js/core/model.js";
import * as P from "../www/js/core/plan.js";
import * as X from "../www/js/core/exchange.js";

const same = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);
const bare = (x) => JSON.parse(JSON.stringify(x, (k, v) => (k === "id" || k === "date" ? undefined : v)));

const NAMES = [["DUPONT", "Marie"], ["Dupont", "marie"], ["LE GALL", "Anne-Sophie"], ["Benaoui", "Rayan"], ["Bendaoud", "Rayan"], ["Ben", "Rayan"],
  ["BENALI", "Rachid"], ["Éloi", "Paul"], ["ELIOT", "Paul"], ["O'NEIL", "Sean"], ["", "Solo"], ["Seul", ""], ["", ""], ["Martin", "Léa"], ["MARTIN", "Léa"],
  ["Müller", "Zoé"], ["Nguyen", "🙂Emoji"], ["d'Artagnan", "Jean-Pierre"], ["  Espace ", " Premier "], ["ÀÉÎ", "ÇA"]];

const mkStudents = () => NAMES.map(([nom, prenom], i) => ({ id: "s" + i, nom, prenom }));

test("plan : noms affichés dans tous les modes", () => {
  const students = mkStudents();
  const modes = P.DISPLAY_MODES.map(([k]) => k);
  const out = py(`
import json, sys
from suiviclasse import plan as P
st = json.load(sys.stdin)
r = {}
for m in ${JSON.stringify(modes)}:
    r[m] = {"one": [P.display_name(s, m) for s in st], "all": P.display_names(st, m)}
r["list"] = [P.list_name(s) for s in st]
r["initial"] = [P.initial_text(t) for t in ("Séance", "  🙂 x", "", "—", "Maison", "_a")]
print(json.dumps(r))`, students);
  for (const m of modes) {
    same(students.map((s) => P.displayName(s, m)), out[m].one, `display_name ${m}`);
    same(P.displayNames(students, m), out[m].all, `display_names ${m}`);
  }
  same(students.map(P.listName), out.list);
  same(["Séance", "  🙂 x", "", "—", "Maison", "_a"].map(P.initialText), out.initial);
});

test("plan : construction des salles, ordre de remplissage, bornes, alignement", () => {
  const out = py(`
import json, sys
from suiviclasse import plan as P
r = {}
s = P.new_salle("Test")
P.add_rows(s, 2, 3)
P.add_rows(s, 1, 4, 300, 400, group=2, pair_gap=30)
P.add_islands(s, 2, 1, per_row=3, per_col=2, x0=800, y0=60)
x, y = P.next_marker_spot(s, 0, 0)
P.add_marker(s, "Porte", x, y); P.add_marker(s, "Tableau", 10, 3, angle=90); P.add_marker(s, "Fenêtre", 5, 5, 0, 77)
r["salle"] = s
r["order"] = P.reading_order(s)
r["front"] = P.front_is_bottom(s)
r["bounds"] = [list(P.bounds(s)), list(P.bounds(P.new_salle()))]
r["snaps"] = [P.snap(v) for v in (4, 5, 6, 14, 15, 16, 25, -5, 0.4, 7.5)]
r["free"] = [list(P.next_free_spot(s)), list(P.next_free_spot(P.new_salle())), list(P.next_free_spot(s, 300))]
r["demo"] = P.demo_salle()
d = P.demo_salle()
r["demo_order"] = [[p["x"], p["y"]] for p in sorted(d["places"], key=lambda p: P.reading_order(d).index(p["id"]))]
r["demo_front"] = P.front_is_bottom(d)
top = P.new_salle(); P.add_rows(top, 2, 2); P.add_marker(top, "Tableau", 40, 0)
r["top_front"] = P.front_is_bottom(top)
import copy
items = copy.deepcopy(s["places"][:5])
res = []
for how in ("left", "top", "hspace", "vspace"):
    it = copy.deepcopy(items); P.align(it, how); res.append([[i["x"], i["y"]] for i in it])
r["align"] = res
m = {"x": 100, "y": 100, "w": 200, "h": 100}
steps = []
for corner, px, py_ in (("se", 304, 196), ("nw", 50, 60), ("se", 0, 0), ("ne", 500, 20), ("sw", -50, 900)):
    P.resize_marker(m, corner, px, py_); steps.append(dict(m))
r["resize"] = steps
mm = {"x": 100, "y": 100, "w": 130, "h": 34}
rot = []
for _ in range(3):
    P.rotate_marker(mm); rot.append(dict(mm))
r["rotate"] = rot
room = copy.deepcopy(s); P.rotate_room(room)
r["room"] = room
r["room_front"] = P.front_is_bottom(room)
r["copy"] = P.copy_salle(s, "Copie")
r["sizes"] = [list(P.marker_size(t)) for t in ("Tableau", "Bureau du professeur", "Autre", "bureau")]
print(json.dumps(r))`);
  const s = P.newSalle("Test");
  P.addRows(s, 2, 3);
  P.addRows(s, 1, 4, { x0: 300, y0: 400, group: 2, pairGap: 30 });
  P.addIslands(s, 2, 1, { perRow: 3, perCol: 2, x0: 800, y0: 60 });
  const [x, y] = P.nextMarkerSpot(s);
  P.addMarker(s, "Porte", x, y); P.addMarker(s, "Tableau", 10, 3, null, null, 90); P.addMarker(s, "Fenêtre", 5, 5, 0, 77);
  same(bare(s), bare(out.salle), "salle");
  const idx = (sal) => P.readingOrder(sal).map((id) => sal.places.findIndex((p) => p.id === id));
  const pidx = (sal, ids) => ids.map((id) => sal.places.findIndex((p) => p.id === id));
  same(idx(s), pidx(out.salle, out.order), "ordre de lecture");
  same(P.frontIsBottom(s), out.front);
  same([P.bounds(s), P.bounds(P.newSalle())], out.bounds);
  same([4, 5, 6, 14, 15, 16, 25, -5, 0.4, 7.5].map((v) => P.snap(v)), out.snaps, "snap");
  same([P.nextFreeSpot(s), P.nextFreeSpot(P.newSalle()), P.nextFreeSpot(s, 300)], out.free);
  same(bare(P.demoSalle()), bare(out.demo), "salle d'exemple");
  const d = P.demoSalle();
  same(P.readingOrder(d).map((id) => { const p = d.places.find((q) => q.id === id); return [p.x, p.y]; }), out.demo_order, "ordre salle d'exemple");
  same(P.frontIsBottom(d), out.demo_front);
  const top = P.newSalle(); P.addRows(top, 2, 2); P.addMarker(top, "Tableau", 40, 0);
  same(P.frontIsBottom(top), out.top_front);
  const items = s.places.slice(0, 5);
  same(["left", "top", "hspace", "vspace"].map((how) => { const it = structuredClone(items); P.align(it, how); return it.map((i) => [i.x, i.y]); }), out.align, "align");
  const m = { x: 100, y: 100, w: 200, h: 100 };
  same([["se", 304, 196], ["nw", 50, 60], ["se", 0, 0], ["ne", 500, 20], ["sw", -50, 900]].map(([c, px, pyy]) => { P.resizeMarker(m, c, px, pyy); return { ...m }; }), out.resize, "resize");
  const mm = { x: 100, y: 100, w: 130, h: 34 };
  same([0, 1, 2].map(() => { P.rotateMarker(mm); return { ...mm }; }), out.rotate, "rotate");
  const room = structuredClone(s); P.rotateRoom(room);
  same(bare(room), bare(out.room), "salle retournée");
  same(P.frontIsBottom(room), out.room_front);
  same(bare(P.copySalle(s, "Copie")), bare(out.copy));
  same(["Tableau", "Bureau du professeur", "Autre", "bureau"].map(P.markerSize), out.sizes);
});

test("plan : répartitions (assign, clean, auto_fill)", () => {
  const students = Array.from({ length: 9 }, (_, i) => ({ id: "s" + i, nom: ["Zed", "Alpha", "Mu", "Beta", "Éta", "Eta", "Kappa", "Omega", "Chi"][i], prenom: "P" + i }));
  const ops = [["fill", "alpha", true], ["assign", "p0", "s3"], ["assign", "p1", "s3"], ["assign", "p5", "s7"], ["unassign", "s2"], ["fill", "alpha", true],
    ["removePlaces", ["p2", "p3"]], ["clean"], ["fill", "alpha", false], ["removeStudent", "s4"], ["fill", "alpha", true], ["assign", "p9", "s1"]];
  const out = py(`
import json, sys
from suiviclasse import plan as P
st = json.load(sys.stdin)
salle = P.new_salle("S"); P.add_rows(salle, 3, 3); P.add_marker(salle, "Tableau", 40, 400)
for i, p in enumerate(salle["places"]): p["id"] = "p%d" % i
cls = {"eleves": st}
plan = P.new_plan("x", salle["id"])
res = []
for op in json.loads(${JSON.stringify(JSON.stringify(ops))}):
    k = op[0]
    if k == "fill": r = P.auto_fill(plan, salle, cls, op[1], op[2])
    elif k == "assign": P.assign(plan, op[1], op[2]); r = None
    elif k == "unassign": P.unassign(plan, op[1]); r = None
    elif k == "removePlaces": salle["places"] = [p for p in salle["places"] if p["id"] not in op[1]]; r = None
    elif k == "clean": P.clean(plan, salle, cls); r = None
    elif k == "removeStudent": cls["eleves"] = [s for s in cls["eleves"] if s["id"] != op[1]]; r = None
    res.append([r, dict(plan["places"]), [s["id"] for s in P.without_place(plan, cls)], P.place_of(plan, "s3")])
print(json.dumps(res))`, students);
  const salle = P.newSalle("S"); P.addRows(salle, 3, 3); P.addMarker(salle, "Tableau", 40, 400);
  salle.places.forEach((p, i) => { p.id = "p" + i; });
  const cls = { eleves: structuredClone(students) };
  const plan = P.newPlan("x", salle.id);
  ops.forEach((op, i) => {
    let r = null;
    if (op[0] === "fill") r = P.autoFill(plan, salle, cls, op[1], op[2]);
    else if (op[0] === "assign") P.assign(plan, op[1], op[2]);
    else if (op[0] === "unassign") P.unassign(plan, op[1]);
    else if (op[0] === "removePlaces") salle.places = salle.places.filter((p) => !op[1].includes(p.id));
    else if (op[0] === "clean") P.clean(plan, salle, cls);
    else cls.eleves = cls.eleves.filter((s) => s.id !== op[1]);
    same([r, plan.places, P.withoutPlace(plan, cls).map((s) => s.id), P.placeOf(plan, "s3")], out[i], `étape ${i} ${JSON.stringify(op)}`);
  });
  // le remplissage au hasard place chacun au plus une fois
  const c2 = { eleves: structuredClone(students) }, p2 = P.newPlan("h", salle.id);
  P.autoFill(p2, P.demoSalle(), c2, "hasard");
});

// ---------------------------------------------------------------- import / export
test("échanges : lecture de tableaux, rubriques, notes, noms", () => {
  const tables = ["a\tb\tc\n1\t2\t3", "﻿Nom;Prénom\r\nDUPONT;Zoé\r\n", 'x;"a;b";"c ""q"" d"\n"multi\nligne";2;3', "  \n \n", "un seul", "a,b\n1,2\n\n3,4", "a\t\"b\nc\"\td", 'ab"c;d'];
  const headers = ["Nom", "Prénom", "Élève", "Né(e) le", "Classe 6B", "Moyenne T2", "Appréciation 3e trimestre", "Note 1er semestre", "PAI", "Infos", "Handicap",
    "Date de naissance", "Observation", "n°", "", "Nom de famille", "Nom usuel", "Nom et prénom", "Commentaire S1", "Moy. générale"];
  const names = ["DUPONT Jean-Pierre", "Jean Dupont", "LE GALL Anne Sophie", "Seul", "", "  A  B ", "MARTIN", "De LA FONTAINE Jean", "ÉLOI Paul"];
  const notes = ["14,5", "14.5", "12/20", " 7 ,5 ", "", "Abs", "abs*", "Z", "W", "N.Not", "n. rdu", "n.rdu*", "D", "abc", "1e2", "--", "20 / 20", "inap", "I", "NaN"];
  const rows = [["Nom", "Prénom", "Classe"], ["14", "x"], ["Nom", "14,5"], [], ["Élève", "Né(e) le", "Classe"], ["Classe", "Note T1"]];
  const out = py(`
import json, sys
from suiviclasse import exchange as X
d = json.load(sys.stdin)
r = {"tables": [X.parse_table(t) for t in d["tables"]],
     "delims": [X.detect_delimiter(t) for t in d["tables"]],
     "roles": [X.guess_role(h) for h in d["headers"]], "roles3": [X.guess_role(h, 3) for h in d["headers"]],
     "split": [list(X.split_full_name(n)) for n in d["names"]],
     "notes": [list(X.parse_note(n)) for n in d["notes"] if n.lower() != "nan"],
     "head": [X.looks_like_header(r) for r in d["rows"]],
     "rl": [X.role_list(p, n) for p, n in (("T", 3), ("S", 2))],
     "norm": [X.norm(t) for t in d["names"] + d["headers"]]}
print(json.dumps(r))`, { tables, headers, names, notes, rows });
  same(tables.map((t) => X.parseTable(t)), out.tables, "parse_table");
  same(tables.map((t) => X.detectDelimiter(t)), out.delims, "détection du séparateur");
  same(headers.map((h) => X.guessRole(h)), out.roles, "rôles");
  same(headers.map((h) => X.guessRole(h, 3)), out.roles3, "rôles T3");
  same(names.map(X.splitFullName), out.split, "noms complets");
  same(notes.filter((n) => n.toLowerCase() !== "nan").map(X.parseNote), out.notes, "notes");
  same(rows.map(X.looksLikeHeader), out.head, "ligne de titres");
  same([X.roleList("T", 3), X.roleList("S", 2)], out.rl);
  same([...names, ...headers].map(X.norm), out.norm, "norm");
});

test("échanges : application d'un tableau Pronote (création, mise à jour, homonymes)", () => {
  const start = () => [{ id: "k1", nom: "6B", eleves: [
    { id: "e1", nom: "DUPONT", prenom: "Marie", naissance: "01/01/2014", infos: "", notes: { "1": 10, "2": null, "3": null }, comms: { "1": "", "2": "", "3": "" } },
    { id: "e2", nom: "DUPONT", prenom: "Marie", naissance: "02/02/2014", infos: "PAI", notes: { "1": null, "2": null, "3": null }, comms: { "1": "ok", "2": "", "3": "" } }] },
    { id: "k2", nom: "5 A", eleves: [] }];
  const cases = [
    { rows: [["Élève", "Né(e) le", "Classe"], ["DUPONT Marie", "02/02/2014", "6B"], ["MARTIN Léa", "03/03/2013", "6b"], ["BERNARD Zoé", "", "Nouvelle"], ["", "", "6B"]],
      roles: ["nomprenom", "naissance", "classe"], skip: 1, classId: null, create: true },
    { rows: [["Nom", "Prénom", "Note T1", "Appréciation T1", "Infos", "Note T2"], ["Dupont", "Marie", "14,5", "Bien", "PAI asthme", "abc"], ["Dupont", "marie", "Abs", "", "", "12"], ["Inconnu", "Zoé", "8", "x", "", ""]],
      roles: ["nom", "prenom", "note1", "comm1", "infos", "note2"], skip: 1, classId: "k1", create: false },
    { rows: [["Inconnu", "Zoé"], ["Autre", "Paul"]], roles: ["nom", "prenom"], skip: 0, classId: "k2", create: true },
    { rows: [["Inconnu", "Zoé"]], roles: ["nom", "prenom"], skip: 0, classId: null, create: true },
    { rows: [["Seul"]], roles: ["nomprenom"], skip: 0, classId: "k1", create: true },
  ];
  const out = py(`
import json, sys
from suiviclasse import exchange as X, model as M
cases = json.load(sys.stdin)
START = json.loads(${JSON.stringify(JSON.stringify(start()))})
import copy
res = []
for c in cases:
    classes = copy.deepcopy(START)
    rep = X.apply_table(classes, c["rows"], c["roles"], c["skip"], c["classId"], c["create"], M.new_student, M.new_class)
    res.append([rep, classes])
print(json.dumps(res))`, cases);
  cases.forEach((c, i) => {
    const classes = start();
    const rep = X.applyTable(classes, c.rows, c.roles, c.skip, c.classId, c.create, M.newStudent, M.newClass);
    same(rep, out[i][0], `compte rendu ${i}`);
    same(bare(classes), bare(out[i][1]), `classes ${i}`);
  });
});

test("échanges : export (champs, guillemets, colonnes supplémentaires)", () => {
  const cls = { nom: "6 B", eleves: [
    { nom: "DUPONT", prenom: "Marie", numero: 1, infos: "PAI;\nasthme", notes: { "1": 14.5, "2": null, "3": 7 }, comms: { "1": 'Dit "bien"', "2": "", "3": "a;b" },
      events: [{ type: "seance", t: 1, v: 1.5 }, { type: "seance", t: 1, v: -0.5 }, { type: "travail", t: 1, v: 1 }, { type: "oubli", t: 1, v: 1 }, { type: "oubli", t: 1, v: 1 }] },
    { nom: "Éloi", prenom: "Paul", numero: null, infos: "", notes: { "1": null, "2": 12.25, "3": null }, comms: { "1": "x".repeat(300), "2": "", "3": "" }, events: [] }] };
  const fields = ["numero", "nom", "prenom", "classe", "infos", "note", "comm", "seancePlus", "seanceMoins", "travail", "oubli"];
  const out = py(`
import json, sys
from suiviclasse import exchange as X, model as M
cls = json.load(sys.stdin)
res = []
for delim in ("\\t", ";"):
    for header in (True, False):
        for t in (1, 2):
            for prefix, word in (("T", "trimestre"), ("S", "semestre")):
                extra = [("c9", "Oral (moyenne)", lambda s, t: "x" if s["nom"] == "DUPONT" else "")]
                res.append(X.build_export(cls, ${JSON.stringify(fields)}, t, header, delim, 255, M.stats, prefix, word, extra))
res.append(X.build_export(cls, ["nom"], 1, True, "\\t", 0, M.stats))
print(json.dumps(res))`, cls);
  let n = 0;
  for (const delim of ["\t", ";"]) for (const header of [true, false]) for (const t of [1, 2]) for (const [prefix, word] of [["T", "trimestre"], ["S", "semestre"]]) {
    const extra = [["c9", "Oral (moyenne)", (s) => (s.nom === "DUPONT" ? "x" : "")]];
    same(X.buildExport(cls, fields, t, header, delim, 255, M.stats, prefix, word, extra), out[n], `export ${n}`);
    n++;
  }
  same(X.buildExport(cls, ["nom"], 1, true, "\t", 0, M.stats), out[n]);
});
