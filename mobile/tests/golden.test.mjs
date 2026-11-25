// Tests « dorés » : chaque fonction de la logique est exécutée en Python (programme du PC) et en JavaScript (tablette)
// sur les mêmes entrées ; les résultats doivent être identiques. C'est ce qui garantit des calculs et des données compatibles.
import assert from "node:assert/strict";
import test from "node:test";
import { py } from "./helpers.mjs";
import * as prefs from "../www/js/core/prefs.js";
import * as C from "../www/js/core/columns.js";
import * as M from "../www/js/core/model.js";
import * as P from "../www/js/core/plan.js";
import * as X from "../www/js/core/exchange.js";

const clone = (x) => JSON.parse(JSON.stringify(x));
/** Retire les identifiants et dates (aléatoires) pour comparer la structure. */
const bare = (x) => JSON.parse(JSON.stringify(x, (k, v) => (k === "id" || k === "date" ? undefined : v)));
const same = (a, b, msg) => assert.deepEqual(JSON.parse(JSON.stringify(a)), JSON.parse(JSON.stringify(b)), msg);

// ---------------------------------------------------------------- préférences et colonnes
test("préférences : validation identique", () => {
  const cases = [{}, null, "x", { oubliOrange: "5", oubliRouge: "2" }, { travailOrange: 99, travailRouge: 1 }, { seancePlusVert: "2,5", backupMinutes: "abc" },
    { autoLockMinutes: -5, appreciationMax: 99999 }, { periodes: "semestres", theme: "sombre", affichage: "normal", planAffichage: "initiales" },
    { periodes: "inconnu", theme: 3 }, { backupKeepRecent: 2.5, backupKeepDays: 3.5 }, { oubliRouge: "", seanceMoinsRouge: " 1,5 " },
    { colonneFigee: "infos" }, { colonneFigee: "aucune" }, { colonneFigee: "nom" }, { colonneFigee: "partout" },
    { niveauxAffichage: "boutons" }, { niveauxAffichage: "menu" }, { niveauxAffichage: "x" }, { titresColonnes: "icones" }, { titresColonnes: "inclines" }, { titresColonnes: "vertical" }];
  const out = py(`
import json, sys
from suiviclasse import prefs
print(json.dumps([prefs.sanitize(c) for c in json.load(sys.stdin)]))`, cases);
  cases.forEach((c, i) => same(prefs.sanitize(c), out[i], JSON.stringify(c)));
  same(prefs.defaults(), py(`
import json
from suiviclasse import prefs
print(json.dumps(prefs.defaults()))`));
});

test("colonnes : incréments, menus, niveaux, règles", () => {
  const inc = [["+0,5 ; +2 ; -1", null], ["0,5 2 −1 2", null], ["", null], ["abc", null], ["1 2 3 4 5 6 7 8", null], ["1 2", -1], ["-1 −2", 1], ["+0,125 -0,004", null], ["–3", null]];
  const labels = [[0.5, -2, 1], [-1, 1, 0.25], []];
  const choices = ["Très bien\nBien;;Passable\n bien ", ["a", "a", " b  c ", "x".repeat(60)], "", Array.from({ length: 30 }, (_, i) => "c" + i)];
  const levels = ["Très bien\nBien\n\nbien\nMoyen\nFaible\nTrès faible\nde trop", ["Seul"], [], ["A", "a", "B"], ["x".repeat(50), "y"], "O;N"];
  const rules = [["dernieres_annee", "5"], ["zz", ""], ["periode", "0"], ["annee", "250"], ["annee", "-4"], [null, null], ["dernieres_periode", "2,7"], ["periode", "abc"]];
  const out = py(`
import json, sys
from suiviclasse import columns as C
d = json.load(sys.stdin)
print(json.dumps({
 "inc": [C.parse_increments(t, s) for t, s in d["inc"]],
 "lab": [C.format_increments(v) for v in d["labels"]],
 "sym": [C.increment_label(v, True) for v in (1, -1, 2, -0.5)],
 "ch": [C.parse_choices(c) for c in d["choices"]],
 "lv": [C.parse_levels(c) for c in d["levels"]],
 "rule": [list(C.parse_rule(r, x)) for r, x in d["rules"]],
 "rl": [C.rule_label(r, x, w) for r, x, w in [("dernieres_periode", 4, "semestre"), ("annee", 3, "trimestre"), ("dernieres_annee", 3, "trimestre")]],
}))`, { inc, labels, choices, levels, rules });
  inc.forEach(([t, s], i) => same(C.parseIncrements(t, s), out.inc[i], t));
  labels.forEach((v, i) => same(C.formatIncrements(v), out.lab[i]));
  same([1, -1, 2, -0.5].map((v) => C.incrementLabel(v, true)), out.sym);
  choices.forEach((c, i) => same(C.parseChoices(c), out.ch[i]));
  levels.forEach((c, i) => same(C.parseLevels(c), out.lv[i], JSON.stringify(c)));
  rules.forEach(([r, x], i) => same(C.parseRule(r, x), out.rule[i], `${r} ${x}`));
  same([["dernieres_periode", 4, "semestre"], ["annee", 3, "trimestre"], ["dernieres_annee", 3, "trimestre"]].map(([r, x, w]) => C.ruleLabel(r, x, w)), out.rl);
});

test("colonnes : configuration (intégrées, base, ordre, personnalisées)", () => {
  const settings = [
    {}, { echelle: 10 }, { echelle: "abc" }, { echelle: -3 },
    { builtin: { travail: { titre: "Devoirs", increments: [2], visible: true }, oubli: { emoji: "" }, qualSeance: { niveaux: ["Oui", "Non"], regle: "annee", x: 5, visible: false } } },
    { base: { prenom: { titre: "Prénoms", visible: false }, fiche: { emoji: "🔍" }, nom: { visible: false } } },
    { ordre: ["prenom", "nom", "inconnue", "c1", "travail", "prenom"], colonnes: [{ id: "c1", titre: "Oral", type: "niveaux", niveaux: ["Très bien", "Bien", "Passable"], regle: "dernieres_annee", x: 2 }, { id: "c2", type: "compteur" }] },
    { colonnes: [{ id: "a", type: "note", echelle: "12,5" }, { id: "b", type: "liste", choix: "x\ny" }, { id: "b", type: "texte" }, { id: "", type: "coche" }, "pas un dict",
      { id: "n", titre: "  Titre   avec   espaces  ", emoji: "🙂🙂🙂🙂🙂🙂", type: "inconnu", orange: "2", rouge: "-1", increments: [0.5, "1", 2, 3, 4, 5, 6, 7] }] },
  ];
  const out = py(`
import json, sys
from suiviclasse import columns as C
S = json.load(sys.stdin)
res = []
for st in S:
    cu = C.customs(st)
    res.append({"customs": cu, "order": C.order(st, [c["id"] for c in cu]), "scale": C.scale(st),
        "builtin": {k: C.builtin(st, k) for k in C.BUILTINS}, "short": {k: C.builtin(st, k, True)["titre"] for k in C.BUILTINS},
        "base": {k: C.base(st, k) for k in C.BASE}, "grades": C.grade_columns(st, False),
        "labels": [C.type_label(st, e) for e in ("seance", "travail", "oubli", "qualSeance", "qualMaison", "c1", "autre")]})
print(json.dumps(res))`, settings);
  settings.forEach((st, i) => {
    const cu = C.customs(st), o = out[i];
    same(cu, o.customs, `customs #${i}`);
    same(C.order(st, cu.map((c) => c.id)), o.order, `order #${i}`);
    same(C.scale(st), o.scale, `scale #${i}`);
    same(Object.fromEntries(Object.keys(C.BUILTINS).map((k) => [k, C.builtin(st, k)])), o.builtin, `builtin #${i}`);
    same(Object.fromEntries(Object.keys(C.BUILTINS).map((k) => [k, C.builtin(st, k, true).titre])), o.short, `short #${i}`);
    same(Object.fromEntries(Object.keys(C.BASE).map((k) => [k, C.base(st, k)])), o.base, `base #${i}`);
    same(C.gradeColumns(st, false), o.grades, `grades #${i}`);
    same(["seance", "travail", "oubli", "qualSeance", "qualMaison", "c1", "autre"].map((e) => C.typeLabel(st, e)), o.labels, `labels #${i}`);
  });
});

test("colonnes : suggestions et pictogrammes identiques au PC", () => {
  const out = py(`
import json
from suiviclasse import columns as C
print(json.dumps({"p": C.PRESETS, "e": C.EMOJIS, "fp": [C.from_preset(p) for p in C.PRESETS]}))`);
  same(C.PRESETS, out.p);
  same(C.EMOJIS, out.e);
  same(C.PRESETS.map((p) => C.fromPreset(p)), out.fp);
});

// ---------------------------------------------------------------- données : compteurs, niveaux, colonnes
function eleve() {
  const s = M.newStudent("Martin", "Léa");
  const ev = (type, t, v, date, note = "") => s.events.push({ id: "e" + s.events.length, type, t, v, note, date });
  ev("seance", 1, 0.5, "2026-10-01T10:00:00.000Z"); ev("seance", 1, -1, "2026-10-02T10:00:00.000Z"); ev("seance", 1, 1, "2026-10-03T10:00:00.000Z");
  ev("seance", 2, 0.5, "2026-12-03T10:00:00.000Z"); ev("travail", 1, 1, "2026-10-03T10:00:00.000Z"); ev("travail", 1, 1, "2026-10-04T10:00:00.000Z");
  ev("oubli", 2, 1, "2026-12-04T10:00:00.000Z"); ev("c1", 1, 5, "2026-10-01T09:00:00.000Z"); ev("c1", 1, 1, "2026-10-02T09:00:00.000Z");
  ev("c1", 1, 3, "2026-10-03T09:00:00.000Z"); ev("c1", 2, 4, "2026-12-01T09:00:00.000Z"); ev("c1", 2, 2, "2026-12-02T09:00:00.000Z");
  ev("c1", 2, 5, "2026-12-03T09:00:00.000Z"); ev("c1", 3, 5, "2027-03-03T09:00:00.000Z"); ev("c1", 1, 4, "2026-10-01T09:00:00.000Z");
  ev("seance", 1, 0.1, "2026-10-05T10:00:00.000Z"); ev("seance", 1, 0.2, "2026-10-06T10:00:00.000Z");
  return s;
}

test("modèle : totaux, séance, statistiques, notes par niveaux et règles", () => {
  const s = eleve();
  const rules = ["periode", "annee", "dernieres_periode", "dernieres_annee"];
  const out = py(`
import json, sys
from suiviclasse import model as M
s = json.load(sys.stdin)
r = {"tot": [[M.total(s, ty, t) for t in (1, 2, 3)] for ty in ("seance", "travail", "oubli", "c1")],
     "seance": [list(M.seance(s, t)) for t in (1, 2, 3)], "stats": [list(M.stats(s, t)) for t in (1, 2, 3)],
     "grade": {}}
for rule in ${JSON.stringify(rules)}:
    for x in (1, 2, 3, 10):
        for n in (3, 5):
            r["grade"][f"{rule}/{x}/{n}"] = [[M.grade_mean(s, "c1", t, rule, x, n) for t in (1, 2, 3)],
                [[e["v"] for e in M.grade_events(s, "c1", t, rule, x)] for t in (1, 2, 3)]]
r["text"] = [[m, M.grade_text(m, lv), M.grade_level(m, len(lv)), M.grade_rank(m, len(lv))] for lv in (["A","B","C","D","E"], ["Oui", "Non"], ["x","y","z"], ["1","2","3","4"]) for m in (1, 1.3, 1.5, 1.7, 2, 2.5, 2.9, 3, 3.49, 3.5, 4, 4.5, 4.9, 5)]
r["none"] = [M.grade_text(None), M.grade_level(None)]
r["values"] = [[M.grade_value(l), M.grade_letter(v)] for l in "ABCDE" for v in (1, 2.4, 2.5, 5)]
print(json.dumps(r))`, s);
  same([["seance", "travail", "oubli", "c1"].map((ty) => [1, 2, 3].map((t) => M.total(s, ty, t)))][0], out.tot);
  same([1, 2, 3].map((t) => M.seance(s, t)), out.seance);
  same([1, 2, 3].map((t) => M.stats(s, t)), out.stats);
  for (const rule of rules) for (const x of [1, 2, 3, 10]) for (const n of [3, 5]) {
    same([[1, 2, 3].map((t) => M.gradeMean(s, "c1", t, rule, x, n)), [1, 2, 3].map((t) => M.gradeEvents(s, "c1", t, rule, x).map((e) => e.v))],
      out.grade[`${rule}/${x}/${n}`], `${rule}/${x}/${n}`);
  }
  const lvls = [["A", "B", "C", "D", "E"], ["Oui", "Non"], ["x", "y", "z"], ["1", "2", "3", "4"]];
  const ms = [1, 1.3, 1.5, 1.7, 2, 2.5, 2.9, 3, 3.49, 3.5, 4, 4.5, 4.9, 5];
  same(lvls.flatMap((lv) => ms.map((m) => [m, M.gradeText(m, lv), M.gradeLevel(m, lv.length), M.gradeRank(m, lv.length)])), out.text);
  same([M.gradeText(null), M.gradeLevel(null)], out.none);
  same(["A", "B", "C", "D", "E"].flatMap((l) => [1, 2.4, 2.5, 5].map((v) => [M.gradeValue(l), M.gradeLetter(v)])), out.values);
});

test("modèle : ajustements de totaux et journal", () => {
  const ops = [["add", "oubli", 1, 1], ["add", "oubli", 1, 1], ["setTotal", "oubli", 1, 5], ["setTotal", "oubli", 1, 2.5], ["setTotal", "travail", 1, 0.125],
    ["setSeance", 1, "plus", 4], ["setSeance", 1, "plus", 1.5], ["setSeance", 1, "moins", 3], ["setSeance", 1, "moins", 0.5], ["removeLast", "oubli", 1],
    ["removeLast", "inconnu", 1], ["add", "seance", 2, -0.5], ["setSeance", 2, "moins", 0]];
  const out = py(`
import json, sys
from suiviclasse import model as M
ops = json.load(sys.stdin)
s = M.new_student("A", "B")
res = []
for op in ops:
    k = op[0]
    if k == "add": M.add_event(s, op[1], op[2], op[3])
    elif k == "setTotal": M.set_total(s, op[1], op[2], op[3])
    elif k == "setSeance": M.set_seance_total(s, op[1], op[2], op[3])
    elif k == "removeLast": M.remove_last(s, op[1], op[2])
    res.append([[(e["type"], e["t"], e["v"], e["note"]) for e in s["events"]], M.total(s, "oubli", 1), M.total(s, "travail", 1), list(M.seance(s, 1))])
print(json.dumps(res))`, ops);
  const s = M.newStudent("A", "B");
  ops.forEach((op, i) => {
    if (op[0] === "add") M.addEvent(s, op[1], op[2], op[3]);
    else if (op[0] === "setTotal") M.setTotal(s, op[1], op[2], op[3]);
    else if (op[0] === "setSeance") M.setSeanceTotal(s, op[1], op[2], op[3]);
    else M.removeLast(s, op[1], op[2]);
    same([s.events.map((e) => [e.type, e.t, e.v, e.note]), M.total(s, "oubli", 1), M.total(s, "travail", 1), M.seance(s, 1)], out[i], `étape ${i} ${JSON.stringify(op)}`);
  });
});

test("modèle : valeurs de colonnes personnalisées, conversions, numéros, classes", () => {
  const vals = [null, "", 0, 12, "12,5", " 3 ", "abc", true, false, "oui", "X", "✓", "non", 2.5, "0"];
  const out = py(`
import json, sys
from suiviclasse import model as M
from suiviclasse.exchange import fmt_num
d = json.load(sys.stdin)
r = {"coerce": [[M.coerce_extra(v, t) for t in ("note", "texte", "liste", "coche")] for v in d["vals"]]}
r["fmt"] = [fmt_num(x) for x in (0, 3, 3.0, 14.5, 14.125, 14.135, 0.005, 2.675, 1e-3, 100.126)]
cls = {"eleves": [{"nom": "Z", "numero": 3}, {"nom": "A", "numero": None}, {"nom": "B", "numero": 3}, {"nom": "C"}, {"nom": "D", "numero": 7}]}
M.ensure_numbers(cls); r["numbers"] = [e["numero"] for e in cls["eleves"]]; r["dups"] = sorted(M.duplicate_numbers(cls))
data = {"classes": [{"id": "a", "nom": "6A"}, {"id": "b", "nom": "6B"}, {"id": "c", "nom": "6C"}]}
r["move"] = []
for cid, idx in (("a", 3), ("c", 0), ("b", 1), ("b", 1), ("a", 0)):
    r["move"].append([M.move_class(data, cid, idx), [c["id"] for c in data["classes"]]])
d2 = {"classes": [{"id": "z", "nom": "Zèbre"}, {"id": "n1", "nom": "5e"}, {"id": "n2", "nom": "Alpha"}, {"id": "old", "nom": "Mu"}]}
M.place_new_classes(d2, {"z", "old"}); r["place"] = [c["id"] for c in d2["classes"]]
r["periods"] = [M.periods(m) for m in ("trimestres", "semestres", "x")]
r["rescale"] = []
st = {"classes": [{"eleves": [{"notes": {"1": 14.5, "2": None, "3": 7}, "extra": {"c": {"1": 8, "2": "x"}}}]}]}
r["rescale"].append([M.rescale_notes(st, 20, 10), st["classes"][0]["eleves"][0]["notes"]])
r["rescale"].append([M.rescale_extra(st, "c", 10, 5), st["classes"][0]["eleves"][0]["extra"]])
print(json.dumps(r))`, { vals });
  same(vals.map((v) => ["note", "texte", "liste", "coche"].map((t) => M.coerceExtra(v, t))), out.coerce, "coerce");
  same([0, 3, 3.0, 14.5, 14.125, 14.135, 0.005, 2.675, 1e-3, 100.126].map(M.fmtNum ?? X.fmtNum), out.fmt, "fmt_num");
  const cls = { eleves: [{ nom: "Z", numero: 3 }, { nom: "A", numero: null }, { nom: "B", numero: 3 }, { nom: "C" }, { nom: "D", numero: 7 }] };
  M.ensureNumbers(cls);
  same(cls.eleves.map((e) => e.numero), out.numbers, "numéros");
  same([...M.duplicateNumbers(cls)].sort(), out.dups);
  const data = { classes: [{ id: "a", nom: "6A" }, { id: "b", nom: "6B" }, { id: "c", nom: "6C" }] };
  [["a", 3], ["c", 0], ["b", 1], ["b", 1], ["a", 0]].forEach(([id, idx], i) => same([M.moveClass(data, id, idx), data.classes.map((c) => c.id)], out.move[i], `move ${i}`));
  const d2 = { classes: [{ id: "z", nom: "Zèbre" }, { id: "n1", nom: "5e" }, { id: "n2", nom: "Alpha" }, { id: "old", nom: "Mu" }] };
  M.placeNewClasses(d2, new Set(["z", "old"]));
  same(d2.classes.map((c) => c.id), out.place);
  same(["trimestres", "semestres", "x"].map(M.periods), out.periods);
  const st = { classes: [{ eleves: [{ notes: { 1: 14.5, 2: null, 3: 7 }, extra: { c: { 1: 8, 2: "x" } } }] }] };
  same([M.rescaleNotes(st, 20, 10), st.classes[0].eleves[0].notes], out.rescale[0]);
  same([M.rescaleExtra(st, "c", 10, 5), st.classes[0].eleves[0].extra], out.rescale[1]);
});

test("modèle : classe Test identique (hors identifiants)", () => {
  const out = py(`
import json
from suiviclasse import model as M, plan as P
d = M.new_data()
print(json.dumps(d))`);
  const js = M.newData();
  const strip = (d) => {
    const c = bare(d);
    for (const s of c.classes[0].eleves) s.events = s.events.map((e) => [e.type, e.t, e.v, e.note]);
    c.classes[0].plans = c.classes[0].plans.map((p) => ({ nom: p.nom, n: Object.keys(p.places).length }));
    delete c.classes[0].plan_actif;
    delete c.ui.classe;
    return c;
  };
  same(strip(js), strip(out));
});

// ---------------------------------------------------------------- menu d'un titre de colonne
test("colonnes : afficher/masquer, pictogramme, colonnes maintenues au début et déplacements identiques au Python", () => {
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const steps = [
    ["set_visible", "oubli", false], ["set_visible", "infos", false], ["set_visible", "nom", false], ["set_visible", "inconnue", false],
    ["set_emoji", "notes", "📝"], ["set_emoji", "travail", "🏠"], ["set_icon_only", "notes", true], ["set_icon_only", "travail", true], ["set_icon_only", "notes", false],
    ["pin", "oubli"], ["pin", "oubli"], ["unpin", "nom"], ["pin", "qualSeance"], ["unpin", "numero"], ["pin", "c1"],
    ["move", "oubli", "prenom"], ["move", "nom", "comm"], ["move", "qualMaison", "numero"], ["move", "c1", "mots"], ["set_visible", "infos", true], ["unpin", "oubli"],
  ];
  const base = { colonnes: [{ id: "c1", titre: "Oral", type: "texte" }], builtin: { oubli: { titre: "Oubli" } } };
  const out = py(`
import json, sys
from suiviclasse import columns as C
d = json.load(sys.stdin)
st = d["base"]
res = []
for step in d["steps"]:
    op, args = step[0], step[1:]
    if op == "move":
        order = [k for k in C.order(st, [c["id"] for c in C.customs(st)]) if k != args[0]]
        order.insert(order.index(args[1]), args[0])
        C.apply_move(st, order, args[0], d["pref"]); r = None
    elif op == "set_visible": r = C.set_visible(st, *args)
    elif op == "set_emoji": r = C.set_emoji(st, *args)
    elif op == "set_icon_only": C.set_icon_only(st, *args); r = None
    elif op == "pin": C.pin(st, args[0], d["pref"]); r = None
    elif op == "unpin": C.unpin(st, args[0], d["pref"]); r = None
    res.append([r, C.pinned_keys(st, d["pref"]), C.order(st, [c["id"] for c in C.customs(st)]), C.hidden_columns(st), C.icon_only_keys(st),
                C.base(st, "notes")["emoji"], C.builtin(st, "travail")["emoji"], st.get("epingles"), st.get("icones")])
print(json.dumps(res))`, { base, steps, pref: "infos" });
  const st = clone(base);
  steps.forEach((step, n) => {
    const [op, ...args] = step;
    let r = null;
    if (op === "move") {
      const order = C.order(st, C.customs(st).map((c) => c.id)).filter((k) => k !== args[0]);
      order.splice(order.indexOf(args[1]), 0, args[0]);
      C.applyMove(st, order, args[0], "infos");
    } else if (op === "set_visible") r = C.setVisible(st, ...args);
    else if (op === "set_emoji") r = C.setEmoji(st, ...args);
    else if (op === "set_icon_only") C.setIconOnly(st, ...args);
    else if (op === "pin") C.pin(st, args[0], "infos");
    else if (op === "unpin") C.unpin(st, args[0], "infos");
    const ids = C.customs(st).map((c) => c.id);
    same([r, C.pinnedKeys(st, "infos"), C.order(st, ids), C.hiddenColumns(st), C.iconOnlyKeys(st), C.base(st, "notes").emoji, C.builtin(st, "travail").emoji, st.epingles === undefined ? null : st.epingles, st.icones === undefined ? null : st.icones], out[n], `étape ${n} ${JSON.stringify(step)}`);
  });
  same([C.configKey("note", "note2"), C.configKey("grade", "qualSeance"), C.configKey("comment", "comm")], ["notes", "qualSeance", "comm"]);
});
