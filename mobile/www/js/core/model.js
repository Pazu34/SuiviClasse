// Données de l'application : de simples objets (ce qui est écrit dans le coffre chiffré). Port de suiviclasse/model.py.
//
//   {version: 1, settings: {annee: ""}, classes: [classe, …], salles: [], ui: {classe: id, trimestre: 1}}
//   classe = {id, nom, eleves: [eleve, …]}
//   eleve  = {id, nom, prenom, numero, naissance, infos, extra, notes: {"1": 14.5|null, …}, comms: {"1": "", …}, events: [evenement, …]}
//   evenement = {id, type: "seance"|"travail"|"oubli"|"qualSeance"|"qualMaison"|id de colonne, t: 1..3, v, date: ISO 8601 UTC, note}
// Règle d'or : ne jamais perdre une clé inconnue — le fichier est partagé avec le programme du PC.
import { addDemoPlan } from "./plan.js";
import { clone, cmp, fmtNum, norm, nowIso, round2, sum, uid } from "./util.js";

export { uid };

/** Découpage de l'année : trimestres (T1 à T3) ou semestres (S1 et S2). */
export function periods(mode) {
  const sem = mode === "semestres";
  const n = sem ? 2 : 3;
  return { mode: sem ? "semestres" : "trimestres", prefix: sem ? "S" : "T", word: sem ? "semestre" : "trimestre", n,
           keys: Array.from({ length: n }, (_, i) => String(i + 1)) };
}

export const TYPES = { seance: "Séance", travail: "Travail non fait", oubli: "Oubli de matériel" };
export const DEMO_NAME = "Test";

// ---------------------------------------------------------------- création
export function newClass(nom) { return { id: uid(), nom: nom.trim(), eleves: [] }; }

export function newStudent(nom, prenom = "", infos = "") {
  return { id: uid(), nom: nom.trim(), prenom: prenom.trim(), numero: null, naissance: "", infos,
           notes: { "1": null, "2": null, "3": null }, comms: { "1": "", "2": "", "3": "" }, events: [], extra: {} };
}

// (nom, prénom, infos, note T1, commentaire T1, oublis, travail non fait, points de séance, notes A-E en séance, notes A-E à la maison)
const DEMO = [
  ["ANDRÉ", "Léa", "PAI asthme (exemple)", 14.5, "Bon début de trimestre, élève sérieuse.", 0, 0, [1, 0.5, 1], "ABA", "AB"],
  ["BERNARD", "Zoé", "", 11, "Participe volontiers, doit soigner la présentation.", 2, 1, [0.5, -0.5], "BCB", "CB"],
  ["CHARPENTIER", "Lucas", "Dyslexie, tiers temps (exemple)", 9.5, "Des difficultés à rester concentré, à encourager.", 3, 3, [-1, -0.5, 0.5], "DCD", "ED"],
  ["DUBOIS", "Emma", "", 17, "Très bon travail.", 0, 0, [1, 1, 1, 0.5], "AAAB", "AA"],
  ["FONTAINE", "Jules", "", 12, "Peut mieux faire : manque de régularité.", 1, 2, [0.5, -0.5, -0.5], "CBC", ""],
  ["GARCIA", "Inès", "Suivi PAP (exemple)", 13, "", 1, 0, [1, 0.5], "BB", "BA"],
  ["HENRY", "Noah", "", null, "", 4, 2, [-1], "", "E"],
  ["LAMBERT", "Chloé", "", 19, "Excellente élève, très impliquée.", 0, 0, [1, 1, 1], "AAA", "AB"],
];

/** Classe « Test » avec des élèves fictifs, pour essayer le programme. */
export function demoClass() {
  const cls = newClass(DEMO_NAME);
  for (const [nom, prenom, infos, note, comm, oublis, travail, seance, qs, qm] of DEMO) {
    const s = newStudent(nom, prenom, infos);
    s.notes["1"] = note; s.comms["1"] = comm;
    for (let i = 0; i < oublis; i++) addEvent(s, "oubli", 1, 1);
    for (let i = 0; i < travail; i++) addEvent(s, "travail", 1, 1);
    for (const v of seance) addEvent(s, "seance", 1, v);
    for (const l of qs) addEvent(s, "qualSeance", 1, gradeValue(l));
    for (const l of qm) addEvent(s, "qualMaison", 1, gradeValue(l));
    cls.eleves.push(s);
  }
  sortStudents(cls);
  ensureNumbers(cls);
  return cls;
}

export function sortStudents(cls) {
  cls.eleves.sort((a, b) => cmp([norm(a.nom), norm(a.prenom)], [norm(b.nom), norm(b.prenom)]));
}

export function ensureNumbers(cls) {
  const used = cls.eleves.map((s) => s.numero).filter((n) => Number.isInteger(n));
  let next = Math.max(0, ...used) + 1;
  for (const s of cls.eleves) if (!Number.isInteger(s.numero)) s.numero = next++;
}

export function duplicateNumbers(cls) {
  const seen = new Set(), dups = new Set();
  for (const s of cls.eleves) {
    const n = s.numero;
    if (n !== null && n !== undefined) (seen.has(n) ? dups : seen).add(n);
  }
  return dups;
}

export function placeNewClasses(data, knownIds) {
  const old = data.classes.filter((c) => knownIds.has(c.id));
  const added = data.classes.filter((c) => !knownIds.has(c.id)).sort((a, b) => cmp([norm(a.nom)], [norm(b.nom)]));
  data.classes.splice(0, data.classes.length, ...old, ...added);
}

export function moveClass(data, classId, index) {
  const classes = data.classes;
  const i = classes.findIndex((c) => c.id === classId);
  if (i < 0) return false;
  index = index > i ? index - 1 : index;  // la classe déplacée libère sa place
  if (index === i) return false;
  classes.splice(index, 0, classes.splice(i, 1)[0]);
  return true;
}

// ---------------------------------------------------------------- compteurs (journal)
const clean = (x) => { x = round2(x); return x; };

/** Total d'une colonne à compteur sur la période t : somme des incréments du journal. */
export function total(student, type, t) {
  return clean(sum(student.events.filter((e) => e.type === type && e.t === t).map((e) => e.v)));
}

export const count = total;

/** (total des points positifs, total des points négatifs) de séance. */
export function seance(student, t) {
  const vals = student.events.filter((e) => e.type === "seance" && e.t === t).map((e) => e.v);
  return [sum(vals.filter((v) => v > 0)), sum(vals.filter((v) => v < 0))];
}

export function stats(student, t) {
  const [plus, moins] = seance(student, t);
  return [plus, moins, count(student, "travail", t), count(student, "oubli", t)];
}

export function addEvent(student, type, t, v, note = "") {
  const e = { id: uid(), type, t, v, note, date: nowIso() };
  student.events.push(e);
  return e;
}

/** Amène le total d'un compteur à `target` par une entrée « Ajustement manuel » (la différence). */
export function setTotal(student, type, t, target) {
  const diff = round2(Number(target) - total(student, type, t));
  if (Math.abs(diff) > 1e-9) addEvent(student, type, t, diff, "Ajustement manuel");
}

export const setCount = setTotal;

/** Amène le total de séance « plus » ou « moins » (valeur absolue) à `target`. */
export function setSeanceTotal(student, t, bucket, target) {
  const sign = bucket === "plus" ? 1 : -1;
  const [plus, moins] = seance(student, t);
  const cur = sign > 0 ? plus : -moins;
  target = round2(Number(target));
  if (Math.abs(target - cur) < 1e-9) return;
  if (target > cur) { addEvent(student, "seance", t, sign * round2(target - cur), "Ajustement manuel"); return; }
  const need = round2(cur - target);
  let removed = 0;
  for (let i = student.events.length - 1; i >= 0; i--) {
    if (removed >= need - 1e-9) break;
    const e = student.events[i];
    if (e.type === "seance" && e.t === t && e.v * sign > 0) { removed += Math.abs(e.v); student.events.splice(i, 1); }
  }
  if (removed > need + 1e-9) addEvent(student, "seance", t, sign * round2(removed - need), "Ajustement manuel");
}

export function removeLast(student, type, t) {
  for (let i = student.events.length - 1; i >= 0; i--) {
    const e = student.events[i];
    if (e.type === type && e.t === t) { student.events.splice(i, 1); return; }
  }
}

export const eventDate = (e) => new Date(e.date);

/** Couleur d'un compteur : 'ok' (0), 'warn' (≥ orange), 'bad' (≥ rouge) ou ''. */
export function level(n, orange, rouge) {
  return n >= rouge ? "bad" : n >= orange ? "warn" : n === 0 ? "ok" : "";
}

// ---------------------------------------------------------------- colonnes personnalisées (notes, textes, cases)
export function getExtra(student, colId, t, dflt = null) {
  const v = ((student.extra || {})[colId] || {})[String(t)];
  return v === undefined ? dflt : v;
}

export function setExtra(student, colId, t, value) {
  if (value === null || value === undefined || value === "") {
    const col = (student.extra || {})[colId];
    if (col) delete col[String(t)];
  } else {
    if (!student.extra) student.extra = {};
    if (!student.extra[colId]) student.extra[colId] = {};
    student.extra[colId][String(t)] = value;
  }
}

export function rescaleNotes(data, old, neu) {
  let n = 0;
  for (const cls of data.classes) for (const s of cls.eleves) for (const [k, v] of Object.entries(s.notes)) {
    if (v !== null && v !== undefined) { s.notes[k] = round2(v * neu / old); n++; }
  }
  return n;
}

export function rescaleExtra(data, colId, old, neu) {
  let n = 0;
  for (const cls of data.classes) for (const s of cls.eleves) {
    const col = (s.extra || {})[colId] || {};
    for (const [k, v] of Object.entries(col)) if (typeof v === "number") { s.extra[colId][k] = round2(v * neu / old); n++; }
  }
  return n;
}

const YES = new Set(["oui", "vrai", "x", "1", "true", "✓", "✔", "☑"]);

/** Valeur lisible selon le type actuel de la colonne (changer le type conserve les valeurs compatibles). */
export function coerceExtra(value, typ) {
  if (value === null || value === undefined || value === "") return null;
  if (typ === "note") {
    if (typeof value === "boolean") return null;
    if (typeof value === "number") return value;
    const f = Number(String(value).trim().replace(",", "."));
    return String(value).trim() !== "" && Number.isFinite(f) ? f : null;
  }
  if (typ === "texte" || typ === "liste") {
    if (value === true) return "oui";
    if (value === false) return null;
    return typeof value === "number" ? fmtNum(value) : String(value);
  }
  if (typ === "coche") {
    if (typeof value === "number") return value ? true : null;
    return value === true || YES.has(String(value).trim().toLowerCase()) ? true : null;
  }
  return value;
}

export const extraValue = (student, col, t) => coerceExtra(getExtra(student, col.id, t), col.type);

// ---------------------------------------------------------------- notes par niveaux (A à E par défaut)
// Une colonne « à niveaux » propose de 2 à 5 niveaux, du meilleur au moins bon. Chaque note attribuée est une entrée du journal
// dont la valeur « v » est la position à partir du moins bon : le meilleur niveau vaut n (le nombre de niveaux), le moins bon vaut 1.
export const GRADES = "ABCDE";
export const DEFAULT_LEVELS = Array.from(GRADES);
export const GRADE_NAMES = { A: "excellent", B: "bien", C: "moyen", D: "insuffisant", E: "très mauvais" };
export const NOT_GRADED = "non noté";
export const RULES = ["periode", "annee", "dernieres_periode", "dernieres_annee"];
export const DEFAULT_X = 3;

export function gradeValue(letter, levels = DEFAULT_LEVELS) { return levels.length - levels.indexOf(letter); }

export function gradeLetter(value, levels = DEFAULT_LEVELS) {
  const n = levels.length;
  return levels[n - Math.min(n, Math.max(1, Math.trunc(value + 0.5)))];
}

/** Notes prises en compte pour la note finale de la période t (de la plus ancienne à la plus récente). */
export function gradeEvents(student, type, t, rule = "periode", x = DEFAULT_X) {
  const year = rule === "annee" || rule === "dernieres_annee";
  let events = student.events.filter((e) => e.type === type && e.v >= 1 && (year ? e.t <= t : e.t === t));
  events = events.map((e, i) => [e, i]).sort((a, b) => (a[0].date < b[0].date ? -1 : a[0].date > b[0].date ? 1 : a[1] - b[1])).map((p) => p[0]);
  if (rule.startsWith("dernieres")) events = events.slice(-Math.max(1, Math.trunc(x)));
  return events;
}

export function gradeMean(student, type, t, rule = "periode", x = DEFAULT_X, n = GRADES.length) {
  const values = gradeEvents(student, type, t, rule, x).map((e) => Math.min(n, e.v));
  return values.length ? sum(values) / values.length : null;
}

export function gradeFinal(student, g, t) {
  return gradeMean(student, g.event, t, g.regle, g.x, g.niveaux.length);
}

export const gradeNear = (mean, n) => Math.min(n, Math.max(1, Math.trunc(mean + 0.5 + 1e-9)));

export function gradeText(mean, levels = DEFAULT_LEVELS) {
  if (mean === null || mean === undefined) return NOT_GRADED;
  const near = gradeNear(mean, levels.length), gap = mean - near;
  return gradeLetter(near, levels) + (gap > 1 / 6 ? "+" : gap < -1 / 6 ? "−" : "");
}

export const gradeRank = (mean, n) => n - gradeNear(mean, n) + 1;

export function gradeLevel(mean, n = GRADES.length) {
  if (mean === null || mean === undefined) return "";
  const pos = (gradeNear(mean, n) - 1) / (n - 1);  // 1 = meilleur niveau, 0 = moins bon
  return pos >= 0.65 ? "ok" : pos <= 0.05 ? "bad" : pos < 0.35 ? "warn" : "";
}

/** Convertit les notes déjà attribuées quand le nombre de niveaux d'une colonne change. */
export function rescaleLevels(data, type, oldN, newN) {
  let n = 0;
  if (oldN < 2 || newN < 2 || oldN === newN) return n;
  for (const cls of data.classes) for (const s of cls.eleves) for (const e of s.events) {
    if (e.type === type && e.v >= 1) { const v = Math.min(oldN, e.v); e.v = Math.trunc((v - 1) * (newN - 1) / (oldN - 1) + 0.5) + 1; n++; }
  }
  return n;
}

// ---------------------------------------------------------------- données d'un nouveau coffre
export function newData() {
  const demo = demoClass();
  const data = { version: 1, settings: { annee: "" }, classes: [demo], salles: [], ui: { classe: demo.id, trimestre: 1 } };
  addDemoPlan(data, demo);  // une salle et une répartition d'exemple (classe Test)
  return data;
}

export { clone };
