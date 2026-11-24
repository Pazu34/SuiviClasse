// Fiche d'un élève : feuille latérale (identité, infos, notes et commentaires de chaque période, autres colonnes, journal daté).
import * as C from "../core/columns.js";
import { noteText } from "../core/exchange.js";
import * as M from "../core/model.js";
import { fmtNum } from "../core/util.js";
import { directLevels, parseGrade } from "./columns_build.js";
import { keywordBar } from "./appreciation_ui.js";
import { confirmDialog, h, menu, modal, toast } from "./dom.js";

const collapse = (s) => s.split(/\s+/).filter(Boolean).join(" ");

/** Texte récapitulatif d'une période (notes finales, compteurs). */
export function statsText(app, s, k) {
  const settings = app.state.settings, parts = [];
  const [plus, moins] = M.seance(s, k);
  for (const g of C.gradeColumns(settings)) {
    const key = g.key;
    const short = C.GRADE_KEYS.includes(key) && g.titre === C.BUILTINS[key].titre ? C.builtin(settings, key, true).titre : g.titre;
    parts.push(`${short.toLowerCase()} ${M.gradeText(M.gradeFinal(s, g, k), g.niveaux)}`);
  }
  if (["seancePlus", "seanceMoins"].some((key) => C.builtin(settings, key).visible)) parts.push(`Séance + ${fmtNum(plus)} · − ${fmtNum(moins)}`);
  for (const key of ["travail", "oubli"]) {
    const cfg = C.builtin(settings, key);
    if (cfg.visible) parts.push(`${cfg.titre.toLowerCase()} ${fmtNum(M.total(s, key, k))}`);
  }
  for (const c of C.customs(settings)) if (c.visible && c.type === "compteur") parts.push(`${c.titre.toLowerCase()} ${fmtNum(M.total(s, c.id, k))}`);
  return parts.join(" · ");
}

export function openStudentSheet(app, cls, s) {
  const settings = app.state.settings, per = app.per, t = app.t, scale = C.scale(settings);
  const levelsOf = () => Object.fromEntries(C.gradeColumns(settings, false).map((g) => [g.event, g.niveaux]));
  let ctl = null;

  const commit = () => { app.commit(); };
  const field = (label, input) => h("div", {}, h("label", { class: "field" }, label), input);

  // ----- identité
  const inNom = h("input", { type: "text", value: s.nom, autocapitalize: "characters" });
  const inPrenom = h("input", { type: "text", value: s.prenom });
  const inNaiss = h("input", { type: "text", value: s.naissance || "", placeholder: "jj/mm/aaaa", inputMode: "numeric" });
  const commitIdentity = () => {
    const nom = inNom.value.trim();
    if (!nom) { inNom.value = s.nom; return; }
    const old = [s.nom, s.prenom, s.naissance || ""].join("\u0000");
    s.nom = nom; s.prenom = inPrenom.value.trim(); s.naissance = inNaiss.value.trim();
    if (old !== [s.nom, s.prenom, s.naissance].join("\u0000")) {
      M.sortStudents(cls);
      commit();
      if (ctl) ctl.el.querySelector("header h3").textContent = `${s.nom} ${s.prenom}`;
    }
  };
  for (const i of [inNom, inPrenom, inNaiss]) i.addEventListener("change", commitIdentity);

  const infos = h("textarea", { rows: 3, value: s.infos });
  infos.addEventListener("change", () => { if (infos.value !== s.infos) { s.infos = infos.value; commit(); } });

  // ----- périodes : note + commentaire
  const periodBlocks = per.keys.map((k) => {
    const note = h("input", { type: "text", inputMode: "decimal", value: noteText(s.notes[k]), "aria-label": `Note ${per.prefix}${k}` });
    const stats = h("div", { class: "stats" });
    const counter = h("div", { class: "hint", style: { textAlign: "right" } });
    const comm = h("textarea", { rows: 3, value: s.comms[k] });
    const upd = () => { const n = Array.from(comm.value).length, mx = app.values.appreciationMax; counter.textContent = `${n} / ${mx}`; counter.style.color = n > mx ? "var(--bad-text)" : ""; };
    comm.addEventListener("input", upd); upd();
    comm.addEventListener("change", () => { if (comm.value !== s.comms[k]) { s.comms[k] = comm.value; commit(); } });
    note.addEventListener("change", () => {
      let v;
      try { v = parseGrade(note.value, scale); } catch (e) { toast(`Entrez un nombre entre 0 et ${fmtNum(scale)}, ou a (absent), n (non noté), d (dispensé).`, "bad"); note.value = noteText(s.notes[k]); return; }
      if (v !== s.notes[k]) { s.notes[k] = v; commit(); }
      note.value = noteText(v);
    });
    const refresh = () => { stats.textContent = statsText(app, s, Number(k)); };
    refresh();
    return { k, refresh, el: h("div", {}, h("div", { class: "periodrow" }, h("strong", {}, `${per.word[0].toUpperCase()}${per.word.slice(1)} ${k}`), note, stats, counter), comm) };
  });

  // ----- autres colonnes (période affichée)
  const extraCols = C.customs(settings).filter((c) => c.visible && ["note", "texte", "liste", "coche"].includes(c.type));
  const extraRows = extraCols.map((c) => {
    const label = (c.emoji ? c.emoji + " " : "") + c.titre + (c.type === "note" ? ` (/${fmtNum(c.echelle)})` : "");
    const v = M.extraValue(s, c, t);
    if (c.type === "coche") {
      const cb = h("input", { type: "checkbox", checked: !!v });
      cb.addEventListener("change", () => { M.setExtra(s, c.id, t, cb.checked ? true : null); commit(); });
      return h("label", { class: "check" }, cb, label);
    }
    let input;
    if (c.type === "liste") {
      input = h("select", {}, h("option", { value: "" }, ""), c.choix.map((x) => h("option", { value: x }, x)));
      input.value = v || "";
      input.addEventListener("change", () => { const nv = input.value || null; if (nv !== v) { M.setExtra(s, c.id, t, nv); commit(); } });
    } else {
      input = h("input", { type: "text", value: v === null ? "" : c.type === "note" ? noteText(v) : v, inputMode: c.type === "note" ? "decimal" : "text" });
      input.addEventListener("change", () => {
        let nv;
        if (c.type === "note") {
          try { nv = parseGrade(input.value, c.echelle); } catch (e) { toast(`Entrez un nombre entre 0 et ${fmtNum(c.echelle)}, ou a (absent), n (non noté), d (dispensé).`, "bad"); input.value = noteText(v); return; }
        } else nv = collapse(input.value);
        M.setExtra(s, c.id, t, nv); commit();
      });
    }
    return field(label, input);
  });

  // ----- journal
  const precision = h("input", { type: "text", placeholder: "Précision (facultative) pour la prochaine entrée…" });
  const quick = h("div", {});
  const journal = h("div", { class: "journal" });
  const after = () => { commit(); refreshDynamic(); };
  const add = (type, v) => { M.addEvent(s, type, t, v, precision.value.trim()); precision.value = ""; after(); };

  const buildQuick = () => {
    quick.replaceChildren();
    for (const g of C.gradeColumns(settings)) {
      const names = g.niveaux, n = names.length;
      const line = h("div", { class: "gradeline" }, h("span", { class: "name" }, `${g.emoji ? g.emoji + " " : ""}${g.titre}`));
      if (directLevels(names)) names.forEach((name, i) => line.append(h("button", { class: "btn", type: "button", onclick: () => add(g.event, n - i) }, name)));
      else line.append(h("button", { class: "btn", type: "button", onclick: (e) => menu(e.currentTarget, names.map((name, i) => ({ label: name, onClick: () => add(g.event, n - i) }))) }, "Noter ▾"));
      quick.append(line);
    }
    const counters = [];
    for (const key of C.BUILTIN_ORDER.filter((k) => !C.GRADE_KEYS.includes(k))) {
      const cfg = C.builtin(settings, key);
      if (cfg.visible) {
        const name = key.startsWith("seance") && cfg.titre === C.BUILTINS[key].titre ? "Séance" : cfg.titre;
        for (const v of cfg.increments) counters.push([`${name} ${C.incrementLabel(v)}`, C.BUILTIN_EVENT[key], v]);
      }
    }
    for (const c of C.customs(settings)) if (c.visible && c.type === "compteur") for (const v of c.increments) counters.push([`${c.titre} ${C.incrementLabel(v)}`, c.id, v]);
    if (counters.length) quick.append(h("div", { class: "row wrap", style: { marginTop: "6px" } }, counters.map(([label, type, v]) => h("button", { class: "btn small", type: "button", onclick: () => add(type, v) }, label))));
  };

  const refreshJournal = () => {
    journal.replaceChildren();
    const levels = levelsOf();
    const events = [...s.events].reverse().filter((e) => e.t === t);
    if (!events.length) journal.append(h("div", { class: "entry muted" }, "Aucune entrée sur cette période."));
    for (const e of events) {
      let name = C.typeLabel(settings, e.type);
      if (levels[e.type]) name += " : " + M.gradeLetter(e.v, levels[e.type]);
      else if (e.type === "seance" || e.v !== 1) name += " " + C.incrementLabel(e.v);
      const d = M.eventDate(e);
      journal.append(h("div", { class: "entry" }, h("div", { class: "when" }, d.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" })),
        h("div", { class: "what" }, name, e.note ? h("small", { class: "muted" }, "  — " + e.note) : null),
        h("button", { class: "btn ghost icon small del", type: "button", "aria-label": "Supprimer cette entrée", onclick: () => { s.events = s.events.filter((x) => x.id !== e.id); after(); } }, "🗑")));
    }
  };

  function refreshDynamic() { periodBlocks.forEach((b) => b.refresh()); refreshJournal(); }
  buildQuick();
  refreshDynamic();

  const body = h("div", { class: "sheet" },
    h("div", { class: "grid2" }, field("Nom", inNom), field("Prénom", inPrenom)),
    field("Né(e) le", inNaiss),
    h("h4", {}, "Informations particulières (handicap, PAI, situation…)"), infos,
    h("h4", {}, "Notes et commentaires de bulletin"), periodBlocks.map((b) => b.el),
    extraRows.length ? [h("h4", {}, `Autres colonnes (${per.prefix}${t})`), extraRows] : null,
    h("h4", {}, `Mots-clés pour l'appréciation (${per.prefix}${t})`), keywordBar(app, s, refreshJournal),
    h("h4", {}, `Journal du ${per.word} ${t}`), precision, quick, journal);

  ctl = modal({ title: `${s.nom} ${s.prenom}`.trim(), side: true, body, actions: [
    { label: "Supprimer cet élève", kind: "danger", left: true, close: false, onClick: async () => {
      if (await confirmDialog(`Supprimer définitivement ${s.prenom} ${s.nom} ?`, { okLabel: "Supprimer", danger: true })) {
        cls.eleves.splice(cls.eleves.indexOf(s), 1);
        commit();
        ctl.close();
      }
    } },
    { label: "Fermer", kind: "primary", onClick: () => { commitIdentity(); } }] });
  return ctl;
}
