// Liste ordonnée des colonnes du tableau selon la configuration (données) et la période (port de ui/table.py : build_columns).
import * as C from "../core/columns.js";
import * as M from "../core/model.js";
import { initialText } from "../core/plan.js";
import { fmtNum } from "../core/util.js";

export const COUNTER_KINDS = ["seance", "counter"];

export class Col {
  constructor(key, kind, title, icon = "", cfg = {}, event = null, perPeriod = false) {
    Object.assign(this, { key, kind, title, icon, cfg, perPeriod });
    this.event = event || key;  // type d'entrée du journal (colonnes à compteur et à niveaux)
  }

  get increments() { return this.cfg.increments || []; }
  get levels() { return C.gradeCfg(this.cfg).niveaux; }
}

export function buildColumns(app) {
  const settings = app.state.settings, per = app.per;
  const compact = app.values.affichage === "compact";
  const sc = C.scale(settings);
  const noteSuffix = !compact ? ` /${fmtNum(sc)}` : "";
  const defs = {};  // clé de configuration -> colonnes produites (« notes » : une colonne par période)
  for (const [key, kind] of [["numero", "num"], ["nom", "nom"], ["prenom", "prenom"], ["infos", "infos"]]) {
    const b = C.base(settings, key, compact);
    if (b.visible) defs[key] = [new Col(key, kind, b.titre, b.emoji)];
  }
  let b = C.base(settings, "notes", compact);
  if (b.visible) defs.notes = per.keys.map((k) => new Col(`note${k}`, "note", `${per.prefix}${k}${noteSuffix}`, b.emoji));
  for (const key of C.BUILTIN_ORDER) {
    const cfg = C.builtin(settings, key, compact);
    if (!cfg.visible) continue;
    const kind = C.GRADE_KEYS.includes(key) ? "grade" : key.startsWith("seance") ? "seance" : "counter";
    defs[key] = [new Col(key, kind, cfg.titre, cfg.emoji, cfg, C.BUILTIN_EVENT[key], true)];
  }
  const customs = C.customs(settings);
  const kinds = { compteur: "counter", note: "xnote", texte: "xtext", liste: "xlist", coche: "xcheck", niveaux: "grade" };
  for (const c of customs.filter((x) => x.visible)) defs[c.id] = [new Col(c.id, kinds[c.type], c.titre, c.emoji, c, null, true)];
  b = C.base(settings, "comm", compact);
  if (b.visible) defs.comm = [new Col("comm", "comment", b.titre, b.emoji)];
  b = C.base(settings, "fiche", compact);
  if (b.visible) defs.fiche = [new Col("fiche", "fiche", b.titre, "", { emoji: b.emoji })];
  return C.order(settings, customs.map((c) => c.id)).flatMap((key) => defs[key] || []);
}

// ---------------------------------------------------------------- valeurs affichées (communes au tableau et au plan de classe)
/** [valeur, niveau d'alerte] d'une colonne à compteur pour un élève et une période. Niveau : 'ok', 'warn', 'bad' ou ''. */
export function counterState(app, col, student, t) {
  const v = app.values;
  if (col.kind === "seance") {
    const [plus, moins] = M.seance(student, t);
    if (col.key === "seancePlus") return [plus, plus >= v.seancePlusVert ? "ok" : ""];
    return [moins, moins <= -v.seanceMoinsRouge ? "bad" : moins < 0 ? "warn" : ""];
  }
  const n = M.total(student, col.event, t);
  if (col.key === "travail" || col.key === "oubli") return [n, M.level(n, v[col.key + "Orange"], v[col.key + "Rouge"])];
  const { orange, rouge } = col.cfg;  // colonne personnalisée : alerte seulement si des seuils existent
  return [n, orange || rouge ? M.level(n, orange || Infinity, rouge || Infinity) : ""];
}

export function gradeMeanOf(col, student, t) {
  const g = C.gradeCfg(col.cfg);
  return M.gradeMean(student, col.event, t, g.regle, g.x, g.niveaux.length);
}

/** [note finale affichée, niveau d'alerte, nombre de notes prises en compte]. */
export function gradeState(app, col, student, t) {
  const g = C.gradeCfg(col.cfg), mean = gradeMeanOf(col, student, t);
  return [M.gradeText(mean, g.niveaux), M.gradeLevel(mean, g.niveaux.length), M.gradeEvents(student, col.event, t, g.regle, g.x).length];
}

export const directLevels = (levels) => levels.every((n) => Array.from(n).length <= 3);

/** Pastilles d'un élève (une par colonne à compteur ou à niveaux) : [{col, level, text}]. Commun au plan de classe et au mode séance.
 *  « – » tant qu'aucune note ne compte ; pour des noms de niveaux longs, le rang (« 2/4 »). */
export function chipTexts(app, cols, s, t) {
  const icons = app.values.pictogrammes === "oui";
  return cols.map((col) => {
    if (col.kind === "grade") {
      const [text, level, n] = gradeState(app, col, s, t);
      let label = n ? text : "–";
      if (n && !directLevels(col.levels)) label = `${M.gradeRank(gradeMeanOf(col, s, t), col.levels.length)}/${col.levels.length}`;
      const title = C.GRADE_KEYS.includes(col.key) ? C.builtin(app.state.settings, col.key, true).titre : col.title;
      return { col, level, text: `${icons && col.icon ? col.icon : initialText(title)}${label}` };
    }
    const [value, level] = counterState(app, col, s, t);
    return { col, level, text: `${icons && col.icon ? col.icon : initialText(col.title)}${fmtNum(value)}` };
  });
}

/** '' -> null ; '14,5' -> 14.5 ; texte invalide ou hors de 0..maxi -> lève une erreur. */
export function parseGrade(text, maxi = 20) {
  text = String(text).trim();
  if (!text) return null;
  const v = Number(text.replace(",", "."));
  if (!Number.isFinite(v) || v < 0 || v > maxi) throw new Error("hors limites");
  return v;
}
