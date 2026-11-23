// Tableau d'une classe, adapté au tactile : colonnes d'identité figées à gauche, défilement dans les deux sens, boutons de 38 px,
// saisie directe des notes, fenêtres de saisie pour les textes longs. Mêmes colonnes et mêmes calculs que sur le PC.
import * as C from "../core/columns.js";
import * as M from "../core/model.js";
import { fmtNum, norm } from "../core/util.js";
import { COUNTER_KINDS, buildColumns, counterState, directLevels, gradeMeanOf, gradeState, parseGrade } from "./columns_build.js";
import { alertDialog, confirmDialog, h, menu, promptDialog, toast } from "./dom.js";
import { openStudentSheet } from "./student.js";

let ctx = null;
function measure(text, bold = false) {
  if (!ctx) ctx = document.createElement("canvas").getContext("2d");
  const cs = getComputedStyle(document.body);
  ctx.font = `${bold ? "700 " : ""}${cs.fontSize} ${cs.fontFamily}`;
  return Math.ceil(ctx.measureText(text).width);
}

const ANGLE = 60;
const HORIZONTAL_HEADS = ["num", "nom", "prenom", "infos", "comment", "fiche"];  // titres qui restent à l'horizontale en mode incliné
const rotated = (app, c) => app.values.titresColonnes === "inclines" && !HORIZONTAL_HEADS.includes(c.kind) && !!c.title;
const iconic = (app, c) => app.values.titresColonnes === "icones" && !!c.icon;

/** Largeur d'un titre d'en-tête (majuscules, gras, 0,78 em, espacement 0,02 em : voir le CSS). */
function measureHead(text) {
  if (!ctx) ctx = document.createElement("canvas").getContext("2d");
  const cs = getComputedStyle(document.body), px = parseFloat(cs.fontSize) * 0.78;
  ctx.font = `700 ${px}px ${cs.fontFamily}`;
  return Math.ceil(ctx.measureText(text).width + text.length * px * 0.02);
}

const SIN = Math.sin(ANGLE * Math.PI / 180), COS = Math.cos(ANGLE * Math.PI / 180), MARGIN = 4;

/** Hauteur d'en-tête nécessaire à un titre incliné de cette longueur (px), pour une police de hauteur `t`. */
const rotatedHeight = (len, t) => Math.ceil(len * SIN + t * COS + MARGIN + 6);

/** Titre incliné, raccourci (…) pour tenir sous la hauteur maximale ; il peut déborder sur les colonnes voisines (comme sur le papier).
 *  Retourne [texte, longueur en pixels]. */
function rotatedText(title, cap, t) {
  let text = title.toLocaleUpperCase("fr");
  const room = (cap - t * COS - MARGIN - 6) / SIN;
  if (measureHead(text) > room) {
    while (text && measureHead(text + "…") > room) text = text.slice(0, -1);
    text = text.trimEnd() + "…";
  }
  return [text, measureHead(text)];
}

/** Colonnes qui peuvent rester figées à gauche (début du tableau, jusqu'à la colonne choisie dans les préférences). */
const FREEZE = { aucune: [], nom: ["numero", "nom"], prenom: ["numero", "nom", "prenom"], infos: ["numero", "nom", "prenom", "infos"] };

function sizes(compact) { return compact ? { btn: 34, gap: 3 } : { btn: 40, gap: 3 }; }

function counterButtons(col) {
  const symbolic = col.key === "travail" || col.key === "oubli";
  const incs = col.increments.map((v) => [v, C.incrementLabel(v, symbolic)]);
  const neg = incs.filter(([v]) => v < 0).sort((a, b) => a[0] - b[0]);
  const pos = incs.filter(([v]) => v > 0).sort((a, b) => a[0] - b[0]);
  return neg.length && pos.length ? { left: neg, right: pos } : { left: [...incs].sort((a, b) => Math.abs(a[0]) - Math.abs(b[0])), right: [] };
}

function colWidth(col, compact) {
  const { btn, gap } = sizes(compact);
  const btnW = (label) => Math.max(btn, measure(label, true) + 16) + gap;
  switch (col.kind) {
    case "num": return 46;
    case "nom": return compact ? 128 : 150;
    case "prenom": return compact ? 108 : 124;
    case "infos": return compact ? 130 : 156;
    case "note": return 66;
    case "xnote": return 74;
    case "xtext": return 170;
    case "xlist": return Math.max(118, Math.max(0, ...(col.cfg.choix || []).map((c) => measure(c))) + 44);
    case "xcheck": return 62;
    case "comment": return compact ? 250 : 310;
    case "fiche": return 62;
    case "seance": case "counter": {
      const { left, right } = counterButtons(col);
      return [...left, ...right].reduce((w, [, l]) => w + btnW(l), 0) + 52 + 10;
    }
    case "grade": {
      const names = col.levels;
      const buttons = directLevels(names) ? names.reduce((w, n) => w + Math.max(btn - 4, measure(n, true) + 12) + gap, 0) : measure("Noter ▾", true) + 30;
      return buttons + Math.max(66, Math.max(...names.map((n) => measure(n + "−", true))) + 18) + 10;
    }
    default: return 100;
  }
}

function headerTitle(app, col) {
  return col.title + (col.perPeriod ? ` (${app.per.prefix}${app.t})` : "");
}

function editInfos(app, s) {
  promptDialog({ title: `Informations — ${s.prenom} ${s.nom}`.trim(), multiline: true, value: s.infos, label: "Informations particulières (handicap, PAI, situation…)" })
    .then((v) => { if (v !== null && v.trim() !== s.infos) { s.infos = v.trim(); app.commit(); } });
}

async function editNumber(app, cls, s) {
  const v = await promptDialog({ title: "Numéro de l'élève", numeric: true, value: s.numero ? String(s.numero) : "",
    validate: (x) => (/^\d+$/.test(x.trim()) ? null : "Le n° doit être un nombre entier positif.") });
  if (v === null) return;
  const n = parseInt(v.trim(), 10);
  if (n === s.numero) return;
  const others = cls.eleves.filter((e) => e !== s && e.numero === n);
  if (others.length) {
    const who = others.map((e) => `${e.nom} ${e.prenom}`).join(", ");
    if (!(await confirmDialog(`Le n° ${n} est déjà attribué dans cette classe à : ${who}.\n\nGarder ce doublon ? (les n° en double sont surlignés en rouge)`,
      { title: "N° déjà attribué", okLabel: "Garder le doublon" }))) return;
  }
  s.numero = n;
  app.commit();
}

/** Saisie directe du total d'un compteur (pour corriger : le journal reçoit une entrée « Ajustement manuel »). */
async function editTotal(app, s, col) {
  const t = app.t;
  const nonNeg = col.key === "travail" || col.key === "oubli";
  const [plus, moins] = M.seance(s, t);
  const current = col.kind === "seance" ? (col.key === "seancePlus" ? plus : Math.abs(moins)) : M.total(s, col.event, t);
  const v = await promptDialog({ title: `${col.title} — ${s.prenom} ${s.nom}`.trim(), numeric: true, value: fmtNum(current), label: "Nouveau total",
    hint: "Le journal reçoit une entrée « Ajustement manuel » pour que le total corresponde.",
    validate: (x) => { const f = Number(x.trim().replace(",", ".")); return x.trim() === "" || !Number.isFinite(f) || (nonNeg && f < 0) ? (nonNeg ? "Entrez un nombre positif ou nul." : "Entrez un nombre (par exemple 2,5).") : null; } });
  if (v === null) return;
  const target = Number(v.trim().replace(",", "."));
  if (col.kind === "seance") M.setSeanceTotal(s, t, col.key === "seancePlus" ? "plus" : "moins", Math.abs(target));
  else M.setTotal(s, col.event, t, target);
  app.commit();
}

function gradeMenu(app, s, col, anchor) {
  const g = C.gradeCfg(col.cfg), names = g.niveaux, t = app.t;
  const used = M.gradeEvents(s, col.event, t, g.regle, g.x);
  const items = [{ header: C.ruleLabel(g.regle, g.x, app.per.word) }];
  if (used.length) {
    const letters = used.map((e) => M.gradeLetter(e.v, names));
    const mean = gradeMeanOf(col, s, t);
    items.push({ header: `${letters.length} note(s) prise(s) en compte : ${(letters.length > 10 ? "… " : "") + letters.slice(-10).join(" · ")}` });
    items.push({ header: `Moyenne : ${M.gradeText(mean, names)} (${fmtNum(mean)} sur ${names.length})` });
  } else items.push({ header: "Aucune note prise en compte" });
  const period = M.gradeEvents(s, col.event, t);
  if (period.length) {
    const last = period[period.length - 1];
    items.push({ label: `Annuler la dernière note (${M.gradeLetter(last.v, names)} du ${M.eventDate(last).toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" })})`, icon: "↶",
      onClick: () => { M.removeLast(s, col.event, t); app.commit(); } });
  }
  items.push({ separator: true }, { label: "Historique des notes (fiche de l'élève)…", icon: "📋", onClick: () => openStudentSheet(app, app.currentClass, s) });
  menu(anchor, items);
}

function levelMenu(app, s, col, anchor) {
  const names = col.levels;
  menu(anchor, names.map((n, i) => ({ label: n, onClick: () => { M.addEvent(s, col.event, app.t, names.length - i); app.commit(); } })));
}

// ---------------------------------------------------------------- cellules
function cellFor(app, cls, s, col, dups, scale) {
  const t = app.t, sk = String(t);
  const { btn } = sizes(app.values.affichage === "compact");
  switch (col.kind) {
    case "num": return h("td", { class: "num" + (dups.has(s.numero) ? " dup" : ""), onclick: () => editNumber(app, cls, s) }, s.numero === null || s.numero === undefined ? "" : String(s.numero));
    case "nom": return h("td", { class: "nom name", onclick: () => openStudentSheet(app, cls, s) }, s.nom);
    case "prenom": return h("td", { class: "name", onclick: () => openStudentSheet(app, cls, s) }, s.prenom);
    case "infos": {
      const text = (s.infos || "").split("\n").map((x) => x.trim()).filter(Boolean).join(" · ");
      return h("td", { class: "infos" + (text ? " has" : ""), onclick: () => editInfos(app, s) }, text);
    }
    case "note": {
      const k = col.key.slice(4);
      const input = h("input", { class: "cell", type: "text", inputMode: "decimal", enterKeyHint: "done", value: s.notes[k] === null || s.notes[k] === undefined ? "" : fmtNum(s.notes[k]) });
      input.addEventListener("focus", () => setTimeout(() => input.select(), 0));
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
      input.addEventListener("change", () => {
        let value;
        try { value = parseGrade(input.value, scale); } catch (e) { toast(`Entrez un nombre entre 0 et ${fmtNum(scale)}.`, "bad"); input.value = s.notes[k] === null ? "" : fmtNum(s.notes[k]); return; }
        if (value !== s.notes[k]) { s.notes[k] = value; app.commit(); } else input.value = value === null ? "" : fmtNum(value);
      });
      return h("td", {}, input);
    }
    case "seance": case "counter": {
      const [value, level] = counterState(app, col, s, t);
      const { left, right } = counterButtons(col);
      const b = ([v, label]) => h("button", { class: "cbtn", type: "button", "aria-label": `${col.title} ${label}`, onclick: () => { M.addEvent(s, col.event, t, v); app.commit(); } }, label);
      return h("td", { class: "ctr " + level }, h("div", { class: "cellrow" }, left.map(b),
        h("div", { class: "total", role: "button", onclick: () => editTotal(app, s, col) }, fmtNum(value)), right.map(b)));
    }
    case "grade": {
      const [text, level, n] = gradeState(app, col, s, t);
      const names = col.levels, nn = names.length;
      const label = h("div", { class: "total" + (n ? "" : " none"), role: "button", onclick: (e) => gradeMenu(app, s, col, e.currentTarget) }, text);
      const buttons = directLevels(names)
        ? names.map((name, i) => h("button", { class: "cbtn lvl", type: "button", "aria-label": `${col.title} ${name}`, onclick: () => { M.addEvent(s, col.event, t, nn - i); app.commit(); } }, name))
        : [h("button", { class: "cbtn", type: "button", onclick: (e) => levelMenu(app, s, col, e.currentTarget) }, "Noter ▾")];
      return h("td", { class: "ctr " + level }, h("div", { class: "cellrow" }, buttons, label));
    }
    case "xnote": {
      const maxi = col.cfg.echelle || 10, v = M.extraValue(s, col.cfg, sk);
      const input = h("input", { class: "cell", type: "text", inputMode: "decimal", value: v === null ? "" : fmtNum(v) });
      input.addEventListener("focus", () => setTimeout(() => input.select(), 0));
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") input.blur(); });
      input.addEventListener("change", () => {
        let value;
        try { value = parseGrade(input.value, maxi); } catch (e) { toast(`Entrez un nombre entre 0 et ${fmtNum(maxi)}.`, "bad"); input.value = v === null ? "" : fmtNum(v); return; }
        if (value !== v) { M.setExtra(s, col.key, sk, value); app.commit(); }
      });
      return h("td", {}, input);
    }
    case "xtext": {
      const v = M.extraValue(s, col.cfg, sk) || "";
      return h("td", { class: "comm", onclick: async () => {
        const nv = await promptDialog({ title: `${col.title} — ${s.prenom} ${s.nom}`.trim(), multiline: true, value: v });
        if (nv !== null) { const text = nv.split(/\s+/).filter(Boolean).join(" "); if (text !== v) { M.setExtra(s, col.key, sk, text); app.commit(); } }
      } }, h("div", { class: "txt" }, v));
    }
    case "xlist": {
      const v = M.extraValue(s, col.cfg, sk);
      const sel = h("select", { class: "cell" }, h("option", { value: "" }, ""), (col.cfg.choix || []).map((c) => h("option", { value: c, selected: c === v }, c)));
      sel.value = v || "";
      sel.addEventListener("change", () => { const nv = sel.value || null; if (nv !== v) { M.setExtra(s, col.key, sk, nv); app.commit(); } });
      return h("td", { class: "xlist" }, sel);
    }
    case "xcheck": {
      const done = !!M.extraValue(s, col.cfg, sk);
      return h("td", { class: "xcheck" + (done ? " done" : "") }, h("button", { type: "button", "aria-pressed": done, onclick: () => { M.setExtra(s, col.key, sk, done ? null : true); app.commit(); } }, done ? "☑" : "☐"));
    }
    case "comment": {
      const text = s.comms[sk] || "", max = app.values.appreciationMax;
      return h("td", { class: "comm" + (Array.from(text).length > max ? " over" : ""), onclick: async () => {
        const nv = await promptDialog({ title: `Commentaire de bulletin ${app.per.prefix}${t} — ${s.prenom} ${s.nom}`.trim(), multiline: true, value: text, counter: max });
        if (nv !== null) { const v = nv.split(/\s+/).filter(Boolean).join(" "); if (v !== text) { s.comms[sk] = v; app.commit(); } }
      } }, h("div", { class: "txt" }, text));
    }
    case "fiche": return h("td", { style: { textAlign: "center" } }, h("button", { class: "cbtn", type: "button", "aria-label": "Ouvrir la fiche", onclick: () => openStudentSheet(app, cls, s) }, col.cfg.emoji || "📝"));
    default: return h("td");
  }
}

function footerValue(app, cls, col) {
  const t = String(app.t);
  const vals = col.kind === "note"
    ? cls.eleves.map((s) => s.notes[col.key.slice(4)]).filter((v) => v !== null && v !== undefined)
    : cls.eleves.map((s) => M.extraValue(s, col.cfg, t)).filter((v) => v !== null && v !== undefined);
  return vals.length ? fmtNum(vals.reduce((a, b) => a + b, 0) / vals.length) : "";
}

/** Construit le tableau (zone défilante) d'une classe pour la période affichée et la recherche en cours. */
export function renderTable(app, cls) {
  const compact = app.values.affichage === "compact";
  const cols = buildColumns(app), scale = C.scale(app.state.settings);
  const q = norm(app.search);
  const students = cls.eleves.filter((s) => !q || norm(`${s.nom} ${s.prenom} ${s.infos}`).includes(q));
  const dups = M.duplicateNumbers(cls);
  const widths = cols.map((c) => colWidth(c, compact));
  const lefts = [];
  let acc = 0, nSticky = 0;
  const allowed = FREEZE[app.values.colonneFigee] || [];
  for (let i = 0; i < cols.length && allowed.includes(cols[i].key); i++) { lefts.push(acc); acc += widths[i]; nSticky++; }
  // trop de colonnes figées pour la largeur de l'écran (plus de la moitié) : elles défileraient avec les autres plutôt que de tout cacher
  if (nSticky >= cols.length || acc > window.innerWidth * 0.5) { nSticky = 0; lefts.length = 0; }
  const stickyAttrs = (i) => (i < nSticky ? { class: "stick" + (i === nSticky - 1 ? " last" : ""), style: { left: lefts[i] + "px" } } : {});
  const total = widths.reduce((a, b) => a + b, 0);

  // en-têtes : titre (avec pictogramme si activé), pictogramme seul, ou titre incliné à 60° comme dans un carnet papier
  const cap = compact ? 140 : 170, fontPx = parseFloat(getComputedStyle(document.body).fontSize) * 0.78;
  let rotH = 0;
  const heads = cols.map((c, i) => {
    const sa = stickyAttrs(i), cls = sa.class ? sa.class.split(" ") : [], full = headerTitle(app, c);
    if (rotated(app, c)) {
      const [text, len] = rotatedText(c.title, cap, fontPx);
      rotH = Math.max(rotH, rotatedHeight(len, fontPx));
      // le texte est centré entre deux traits inclinés : sa ligne médiane passe par le milieu de la colonne, au bas de l'en-tête
      const left = Math.round(widths[i] / 2 + (fontPx / 2) / SIN + MARGIN / Math.tan(ANGLE * Math.PI / 180));
      return h("th", { class: [...cls, "rot"].join(" "), style: { ...sa.style, zIndex: String(10 + cols.length - i) }, title: full, "aria-label": full },
        h("div", { class: "rt" }, h("span", { style: { left: left + "px", bottom: MARGIN + "px" } }, text)));
    }
    if (iconic(app, c)) return h("th", { class: [...cls, "iconly"].join(" "), style: sa.style, title: full, "aria-label": full }, h("span", { class: "ico" }, c.icon));
    const icon = c.icon && app.values.pictogrammes === "oui" && app.values.titresColonnes === "texte";
    return h("th", { class: cls.join(" "), style: sa.style, "data-bottom": app.values.titresColonnes === "inclines" ? "1" : null }, icon ? h("span", { class: "ico" }, c.icon) : null, full);
  });
  const head = h("tr", {}, heads);
  const rows = students.map((s) => h("tr", {}, cols.map((c, i) => {
    const td = cellFor(app, cls, s, c, dups, scale);
    const sa = stickyAttrs(i);
    if (sa.class) { td.classList.add(...sa.class.split(" ")); Object.assign(td.style, sa.style); }
    return td;
  })));
  const foot = h("tr", {}, cols.map((c, i) => {
    const sa = stickyAttrs(i);
    const td = h("td", { class: sa.class || "", style: sa.style });
    if (c.kind === "note" || c.kind === "xnote") td.textContent = footerValue(app, cls, c);
    return td;
  }));
  // libellé « Moyenne de la classe » dans la colonne du nom (ou la première colonne)
  const labelIdx = Math.max(0, cols.findIndex((c) => c.key === "nom"));
  foot.children[labelIdx].textContent = compact ? "Moy. classe" : "Moyenne de la classe";

  const table = h("table", { class: "grid", style: { width: total + "px", ...(rotH ? { "--rot-h": rotH + "px" } : {}) } },
    h("colgroup", {}, widths.map((w) => h("col", { style: { width: w + "px" } }))),
    h("thead", {}, head), h("tbody", {}, rows), h("tfoot", {}, foot));
  const wrap = h("div", { class: "tablewrap", style: rotH ? { paddingRight: Math.ceil(rotH * 0.6) + "px" } : {} }, table);
  if (!students.length) {
    wrap.append(h("div", { class: "empty" }, cls.eleves.length ? "Aucun élève ne correspond à la recherche." : "Aucun élève. Utilisez « Importer des élèves… » dans le menu ⋮."));
  }
  return wrap;
}

export { COUNTER_KINDS };
