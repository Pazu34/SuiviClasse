// Tableau d'une classe, adapté au tactile : colonnes d'identité figées à gauche, défilement dans les deux sens, boutons de 38 px,
// saisie directe des notes, fenêtres de saisie pour les textes longs. Mêmes colonnes et mêmes calculs que sur le PC.
import * as C from "../core/columns.js";
import { isNumber, noteText } from "../core/exchange.js";
import * as M from "../core/model.js";
import { fmtNum, norm } from "../core/util.js";
import { COUNTER_KINDS, buildColumns, columnTexts, configKey, counterState, directLevels, gradeMeanOf, gradeState, parseGrade } from "./columns_build.js";
import { keywordCell } from "./appreciation_ui.js";
import { copyText } from "../platform.js";
import { alertDialog, confirmDialog, h, menu, promptDialog, toast } from "./dom.js";
import { emojiPicker } from "./prefs_ui.js";
import { openStudentSheet } from "./student.js";

let ctx = null;
function measure(text, bold = false) {
  if (!ctx) ctx = document.createElement("canvas").getContext("2d");
  const cs = getComputedStyle(document.body);
  ctx.font = `${bold ? "700 " : ""}${cs.fontSize} ${cs.fontFamily}`;
  return Math.ceil(ctx.measureText(text).width);
}

const ANGLE = 60;
const iconic = (app, c) => !!c.icon && (app.values.titresColonnes === "icones" || C.iconOnlyKeys(app.state.settings).includes(configKey(c)));  // réglage global ou colonne par colonne
const rotated = (app, c) => app.values.titresColonnes === "inclines" && !!c.title && !iconic(app, c);  // toutes les colonnes titrées (pas « fiche »)

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

// ---------------------------------------------------------------- saisie au clavier : Entrée valide et passe à la ligne du dessous
/** Case située sous `td` (même colonne, ligne suivante affichée) : {row, col} (rangs dans le corps du tableau). */
function below(td) {
  const tr = td.closest("tr"), rows = [...tr.parentElement.children];
  return { row: rows.indexOf(tr) + 1, col: [...tr.children].indexOf(td) };
}

/** Met le curseur dans la case visée (ou ouvre sa fenêtre de saisie pour un commentaire). Appelée aussi après la reconstruction du
 *  tableau que provoque toute modification : la cible se retrouve par son rang. */
export function applyPendingFocus(app, root) {
  const f = app.pendingFocus;
  if (!f) return;
  if (Date.now() > f.until) { app.pendingFocus = null; return; }
  const tr = root.querySelectorAll("table.grid tbody tr")[f.row], td = tr && tr.children[f.col];
  if (!td) { app.pendingFocus = null; return; }
  app.pendingFocus = null;
  if (f.open) { td.click(); return; }
  const el = td.querySelector("input, select, textarea");
  if (el) { el.focus(); if (el.select) el.select(); if (el.scrollIntoView) el.scrollIntoView({ block: "nearest", inline: "nearest" }); }
}

/** Saisie validée par Entrée dans `td` : `commit()` enregistre (retourne "invalid", true si modifié, false sinon), puis on passe en dessous. */
function enterAdvance(app, td, commit) {
  app.pendingFocus = { ...below(td), until: Date.now() + 800 };
  const r = commit();
  if (r === "invalid") app.pendingFocus = null;
  else if (!r) applyPendingFocus(app, td.closest("table").parentElement);  // rien n'a changé : pas de reconstruction, on passe tout de suite
}

/** Commentaire / texte : fenêtre de saisie ; Entrée valide puis ouvre la fenêtre de l'élève suivant. */
async function editText(app, td, { title, value, counter = null, save }) {
  let viaEnter = false;
  const nv = await promptDialog({ title, multiline: true, value, counter, enterSubmits: () => { viaEnter = true; } });
  if (nv === null) return;
  const text = nv.split(/\s+/).filter(Boolean).join(" ");
  if (viaEnter) app.pendingFocus = { ...below(td), open: true, until: Date.now() + 800 };
  if (text !== value) save(text);
  else if (viaEnter) applyPendingFocus(app, td.closest("table") ? td.closest("table").parentElement : document);
}


function sizes(compact) { return compact ? { btn: 34, gap: 3 } : { btn: 40, gap: 3 }; }

function counterButtons(col) {
  const symbolic = col.key === "travail" || col.key === "oubli";
  const incs = col.increments.map((v) => [v, C.incrementLabel(v, symbolic)]);
  const neg = incs.filter(([v]) => v < 0).sort((a, b) => a[0] - b[0]);
  const pos = incs.filter(([v]) => v > 0).sort((a, b) => a[0] - b[0]);
  return neg.length && pos.length ? { left: neg, right: pos } : { left: [...incs].sort((a, b) => Math.abs(a[0]) - Math.abs(b[0])), right: [] };
}

/** Un bouton par niveau ? Seulement si le réglage « Un bouton par niveau » est choisi et que les noms sont courts ; sinon « Noter ▾ » ouvre le menu des niveaux. */
const levelButtons = (app, names) => app.values.niveauxAffichage === "boutons" && directLevels(names);

function colWidth(col, compact, app) {
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
    case "mots": return compact ? 170 : 210;
    case "seance": case "counter": {
      const { left, right } = counterButtons(col);
      return [...left, ...right].reduce((w, [, l]) => w + btnW(l), 0) + 52 + 10;
    }
    case "grade": {
      const names = col.levels;
      const buttons = levelButtons(app, names) ? names.reduce((w, n) => w + Math.max(btn - 4, measure(n, true) + 12) + gap, 0) : measure("Noter ▾", true) + 30;
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
      const input = h("input", { class: "cell", type: "text", inputMode: "decimal", enterKeyHint: "next", value: noteText(s.notes[k]) });
      const td = h("td", {}, input);
      input.addEventListener("focus", () => { const v0 = input.value; setTimeout(() => { if (input.value === v0) input.select(); }, 0); });  // sélection au toucher, sans effacer ce qu'on a déjà tapé
      const commit = () => {
        let value;
        try { value = parseGrade(input.value, scale); } catch (e) { toast(`Entrez un nombre entre 0 et ${fmtNum(scale)}, ou a (absent), n (non noté), d (dispensé).`, "bad"); input.value = noteText(s.notes[k]); return "invalid"; }
        if (value !== s.notes[k]) { s.notes[k] = value; app.commit(); return true; }
        input.value = noteText(value);
        return false;
      };
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); enterAdvance(app, td, commit); } });  // valide et passe à l'élève suivant
      input.addEventListener("change", commit);
      return td;
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
      const buttons = levelButtons(app, names)
        ? names.map((name, i) => h("button", { class: "cbtn lvl", type: "button", "aria-label": `${col.title} ${name}`, onclick: () => { M.addEvent(s, col.event, t, nn - i); app.commit(); } }, name))
        : [h("button", { class: "cbtn", type: "button", onclick: (e) => levelMenu(app, s, col, e.currentTarget) }, "Noter ▾")];
      return h("td", { class: "ctr " + level }, h("div", { class: "cellrow" }, buttons, label));
    }
    case "xnote": {
      const maxi = col.cfg.echelle || 10, v = M.extraValue(s, col.cfg, sk);
      const input = h("input", { class: "cell", type: "text", inputMode: "decimal", enterKeyHint: "next", value: noteText(v) });
      const td = h("td", {}, input);
      let cur = v;
      input.addEventListener("focus", () => { const v0 = input.value; setTimeout(() => { if (input.value === v0) input.select(); }, 0); });  // sélection au toucher, sans effacer ce qu'on a déjà tapé
      const commit = () => {
        let value;
        try { value = parseGrade(input.value, maxi); } catch (e) { toast(`Entrez un nombre entre 0 et ${fmtNum(maxi)}, ou a (absent), n (non noté), d (dispensé).`, "bad"); input.value = noteText(cur); return "invalid"; }
        if (value !== cur) { cur = value; M.setExtra(s, col.key, sk, value); app.commit(); return true; }
        input.value = noteText(value);
        return false;
      };
      input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); enterAdvance(app, td, commit); } });
      input.addEventListener("change", commit);
      return td;
    }
    case "xtext": {
      const v = M.extraValue(s, col.cfg, sk) || "";
      const td = h("td", { class: "comm" }, h("div", { class: "txt" }, v));
      td.onclick = () => editText(app, td, { title: `${col.title} — ${s.prenom} ${s.nom}`.trim(), value: v, save: (text) => { M.setExtra(s, col.key, sk, text); app.commit(); } });
      return td;
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
      const td = h("td", { class: "comm" + (Array.from(text).length > max ? " over" : "") }, h("div", { class: "txt" }, text));
      td.onclick = () => editText(app, td, { title: `Commentaire de bulletin ${app.per.prefix}${t} — ${s.prenom} ${s.nom}`.trim(), value: text, counter: max, save: (v) => { s.comms[sk] = v; app.commit(); } });
      return td;
    }
    case "mots": return h("td", { class: "mots" }, keywordCell(app, s));
    case "fiche": return h("td", { style: { textAlign: "center" } }, h("button", { class: "cbtn", type: "button", "aria-label": "Ouvrir la fiche", onclick: () => openStudentSheet(app, cls, s) }, col.cfg.emoji || "📝"));
    default: return h("td");
  }
}

function footerValue(app, cls, col) {
  const t = String(app.t);
  const vals = col.kind === "note"
    ? cls.eleves.map((s) => s.notes[col.key.slice(4)]).filter(isNumber)   // Abs, Disp et N.Not ne comptent pas dans la moyenne
    : cls.eleves.map((s) => M.extraValue(s, col.cfg, t)).filter(isNumber);
  return vals.length ? fmtNum(vals.reduce((a, b) => a + b, 0) / vals.length) : "";
}

// ---------------------------------------------------------------- réorganiser les colonnes : glisser un titre, le déposer entre deux colonnes
/** Place la colonne i avant (ou après) la colonne j ; l'ordre est enregistré avec les données (comme « Monter / Descendre »). */
function moveColumn(app, cols, i, j, after) {
  const src = configKey(cols[i]), dst = configKey(cols[j]);
  if (src === dst) return;
  const settings = app.state.settings;
  const current = C.order(settings, C.customs(settings).map((c) => c.id));
  const order = current.filter((k) => k !== src);
  order.splice(order.indexOf(dst) + (after ? 1 : 0), 0, src);
  if (order.join() !== current.join()) { C.applyMove(settings, order, src, app.values.colonneFigee); app.commit(); }
}

// ---------------------------------------------------------------- menu d'un titre de colonne (clic droit, ou toucher le titre)
function columnMenu(app, cls, cols, i, anchor) {
  const col = cols[i], settings = app.state.settings, key = configKey(col), pref = app.values.colonneFigee;
  const pinned = C.pinnedKeys(settings, pref).includes(key), iconOnly = C.iconOnlyKeys(settings).includes(key);
  const apply = (fn) => () => { fn(); app.commit(); };
  const copy = (withNames) => async () => {
    let values = columnTexts(app, cls, col);
    if (withNames) values = values.map((v, n) => `${cls.eleves[n].nom} ${cls.eleves[n].prenom}\t${v}`);
    const ok = await copyText(values.join("\r\n"));
    toast(ok ? `Colonne « ${col.title || col.key} » copiée : ${values.length} lignes${withNames ? " avec les noms" : ""}` : "Copie impossible.", ok ? "" : "bad");
  };
  const pick = () => emojiPicker(col.icon, (emoji) => { C.setEmoji(settings, key, emoji); C.setIconOnly(settings, key, !!emoji); app.commit(); });
  const hidden = C.hiddenColumns(settings);
  menu(anchor, [
    ...(col.kind !== "fiche" ? [{ label: "Copier la colonne (une valeur par ligne)", icon: "⧉", onClick: copy(false) }, { label: "Copier la colonne avec les noms des élèves", icon: "⧉", onClick: copy(true) }, { separator: true }] : []),
    { label: pinned ? "Ne plus maintenir au début du tableau" : "Maintenir au début du tableau (à gauche)", icon: "📌", onClick: apply(() => (pinned ? C.unpin : C.pin)(settings, key, pref)) },
    ...(col.kind !== "fiche" ? [{ label: iconOnly ? "Changer le pictogramme…" : "Remplacer le titre par un pictogramme…", icon: "🏷", onClick: pick }] : []),
    ...(iconOnly ? [{ label: "Rétablir le titre", icon: "Aa", onClick: apply(() => C.setIconOnly(settings, key, false)) }] : []),
    { label: "Cacher la colonne", icon: "🙈", disabled: C.ALWAYS_VISIBLE.has(key), onClick: apply(() => C.setVisible(settings, key, false)) },
    ...(hidden.length ? [{ separator: true }, { header: "Colonnes cachées" }, ...hidden.map(([k, title]) => ({ label: `Réafficher : ${title}`, icon: "👁", onClick: apply(() => C.setVisible(settings, k, true)) }))] : []),
    { separator: true },
    { label: "Réglages des colonnes…", icon: "⚙", onClick: async () => (await import("./prefs_ui.js")).openPrefs(app, "colonnes") },
  ], {});
}

/** Souris : glisser le titre ; écran tactile : appui long sur le titre, puis glisser (un glissement immédiat fait défiler le tableau). */
function enableColumnDrag(app, cls, wrap, heads, cols) {
  let drag = null, guide = null, ghost = null, scroller = null, lastX = 0;
  const targetAt = (x, y) => {
    const th = document.elementsFromPoint(x, y).find((el) => el.tagName === "TH" && heads.includes(el));
    if (th) { const r = th.getBoundingClientRect(); return [heads.indexOf(th), x > r.left + r.width / 2]; }
    const first = heads[0].getBoundingClientRect(), last = heads[heads.length - 1].getBoundingClientRect();
    return x < first.left ? [0, false] : [heads.length - 1, true];
  };
  const place = (x) => {
    lastX = x;
    const [j, after] = targetAt(x, drag.y);
    const r = heads[j].getBoundingClientRect(), w = wrap.getBoundingClientRect();
    guide.style.left = (after ? r.right : r.left) - 1 + "px"; guide.style.top = w.top + "px"; guide.style.height = w.height + "px";
    ghost.style.left = x + 8 + "px"; ghost.style.top = drag.y + 8 + "px";
    return [j, after];
  };
  const begin = (x) => {
    drag.on = true;
    guide = h("div", { class: "colguide" });
    ghost = h("div", { class: "dragghost" }, cols[drag.i].title || "Colonne");
    document.body.append(guide, ghost);
    scroller = setInterval(() => {  // près d'un bord de l'écran : le tableau défile
      const w = wrap.getBoundingClientRect();
      if (lastX < w.left + 48) wrap.scrollLeft -= 14; else if (lastX > w.right - 48) wrap.scrollLeft += 14;
      place(lastX);
    }, 30);
    place(x);
  };
  const end = (e, ok) => {
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    window.removeEventListener("pointercancel", onCancel);
    window.removeEventListener("touchmove", onTouchMove);
    if (!drag) return;
    clearTimeout(drag.timer);
    clearInterval(scroller);
    const d = drag; drag = null;
    if (guide) { guide.remove(); ghost.remove(); guide = ghost = null; }
    if (d.on && ok) { const [j, after] = targetAt(e.clientX, d.y); moveColumn(app, cols, d.i, j, after); }
  };
  const onMove = (e) => {
    if (!drag) return;
    if (!drag.on) {
      const moved = Math.hypot(e.clientX - drag.x0, e.clientY - drag.y0);
      if (drag.touch) { if (moved > 12) end(e, false); } else if (moved > 6) begin(e.clientX);
      return;
    }
    place(e.clientX);
  };
  const onUp = (e) => {
    const d = drag, tap = d && !d.on && Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 8;
    end(e, true);
    if (tap) columnMenu(app, cls, cols, d.i, heads[d.i]);  // un simple toucher (ou clic) sur le titre ouvre le menu
  };
  const onCancel = (e) => end(e, false);
  const onTouchMove = (e) => { if (drag && drag.on) e.preventDefault(); };
  heads.forEach((th, i) => th.addEventListener("contextmenu", (e) => {  // clic droit ; l'appui long tactile sert au glissement
    e.preventDefault();
    if (!(drag && drag.on) && e.pointerType !== "touch" && !(e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents)) columnMenu(app, cls, cols, i, { x: e.clientX, y: e.clientY });
  }));
  heads.forEach((th, i) => th.addEventListener("pointerdown", (e) => {
    if (e.button > 0 || drag) return;
    const r = th.getBoundingClientRect();
    drag = { i, x0: e.clientX, y0: e.clientY, y: r.top + r.height / 2, on: false, touch: e.pointerType !== "mouse", timer: null };
    if (drag.touch) drag.timer = setTimeout(() => { if (drag) { begin(drag.x0); if (navigator.vibrate) navigator.vibrate(15); } }, 380);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onCancel);
    window.addEventListener("touchmove", onTouchMove, { passive: false });
  }));
}

/** Construit le tableau (zone défilante) d'une classe pour la période affichée et la recherche en cours. */
export function renderTable(app, cls) {
  const compact = app.values.affichage === "compact";
  const cols = buildColumns(app), scale = C.scale(app.state.settings);
  const q = norm(app.search);
  const students = cls.eleves.filter((s) => !q || norm(`${s.nom} ${s.prenom} ${s.infos}`).includes(q));
  const dups = M.duplicateNumbers(cls);
  const widths = cols.map((c) => colWidth(c, compact, app));
  const lefts = [];
  let acc = 0, nSticky = 0;
  const allowed = new Set(C.pinnedKeys(app.state.settings, app.values.colonneFigee));  // colonnes maintenues au début (clic sur un titre)
  for (let i = 0; i < cols.length && allowed.has(configKey(cols[i])); i++) { lefts.push(acc); acc += widths[i]; nSticky++; }
  // trop de colonnes figées pour la largeur de l'écran (plus de la moitié) : elles défileraient avec les autres plutôt que de tout cacher
  if (nSticky >= cols.length || acc > window.innerWidth * 0.5) { nSticky = 0; lefts.length = 0; }
  const stickyAttrs = (i) => (i < nSticky ? { class: "stick" + (i === nSticky - 1 ? " last" : ""), style: { left: lefts[i] + "px" } } : {});
  const total = widths.reduce((a, b) => a + b, 0);

  // en-têtes : titre (avec pictogramme si activé), pictogramme seul, ou titre incliné à 60° comme dans un carnet papier
  const cap = compact ? 150 : 180, fontPx = parseFloat(getComputedStyle(document.body).fontSize) * 0.78;
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
  enableColumnDrag(app, cls, wrap, heads, cols);
  if (!students.length) {
    wrap.append(h("div", { class: "empty" }, cls.eleves.length ? "Aucun élève ne correspond à la recherche." : "Aucun élève. Utilisez « Importer des élèves… » dans le menu ⋮."));
  }
  return wrap;
}

export { COUNTER_KINDS };
