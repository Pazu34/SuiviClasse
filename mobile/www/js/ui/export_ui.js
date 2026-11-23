// Export d'une classe : champs au choix, comme dans l'export texte de PRONOTE ; le tableau se colle directement dans un tableur.
import * as C from "../core/columns.js";
import * as M from "../core/model.js";
import * as X from "../core/exchange.js";
import { copyText } from "../platform.js";
import { shareOrWarn } from "./share.js";
import { h, modal, select, toast } from "./dom.js";

/** Colonnes ajoutées par l'utilisateur (et notes par niveaux) : exportables comme les autres. */
function extraExports(app) {
  const settings = app.state.settings, out = [];
  for (const g of C.gradeColumns(settings)) {
    out.push([g.key, g.titre + " (moyenne)", (s, t) => { const m = M.gradeFinal(s, g, t); return m === null ? "" : M.gradeText(m, g.niveaux); }]);
  }
  for (const c of C.customs(settings).filter((x) => x.visible && x.type !== "niveaux")) {
    let fn;
    if (c.type === "compteur") fn = (s, t) => X.fmtNum(M.total(s, c.id, t));
    else if (c.type === "note") fn = (s, t) => X.noteText(M.extraValue(s, c, t));
    else if (c.type === "coche") fn = (s, t) => (M.extraValue(s, c, t) ? "oui" : "");
    else fn = (s, t) => M.extraValue(s, c, t) || "";
    out.push([c.id, c.titre, fn]);
  }
  return out;
}

export function openExport(app, cls) {
  const per = app.per, extras = extraExports(app);
  const fieldList = [...X.EXPORT_FIELDS, ...extras.map(([k, l]) => [k, l])];
  const checks = Object.fromEntries(fieldList.map(([k]) => [k, h("input", { type: "checkbox", checked: ["nom", "prenom", "note", "comm"].includes(k) })]));
  const period = select(per.keys.map((k) => [k, `${per.prefix}${k}`]), String(app.t));
  const sep = select([["\t", "Tabulation (collage PRONOTE / Excel)"], [";", "Point-virgule (CSV)"]], "\t");
  const header = h("input", { type: "checkbox", checked: true });
  const warn = h("div", { class: "error" });
  const msg = h("div", { class: "hint" });

  function build() {
    const fields = fieldList.map(([k]) => k).filter((k) => checks[k].checked);
    if (!fields.length) { warn.textContent = "Cochez au moins un champ."; return null; }
    const [text, tooLong] = X.buildExport(cls, fields, Number(period.value), header.checked, sep.value, app.values.appreciationMax, M.stats, per.prefix, per.word, extras);
    warn.textContent = tooLong.length ? `⚠ Appréciation(s) de plus de ${app.values.appreciationMax} caractères (PRONOTE les refuserait ou les tronquerait) : ${tooLong.join(", ")}` : "";
    return text;
  }

  modal({ title: `Exporter ${cls.nom}`, size: "wide", body: [
    h("p", { class: "hint" }, "Choisissez les champs, comme dans l’export texte de PRONOTE. Le tableau copié se colle directement dans un tableur."),
    h("div", { class: "row wrap" }, period, h("span", {}, `← ${per.word}`), sep, h("label", { class: "check" }, header, "Ligne de titres")),
    h("label", { class: "field" }, "Champs à exporter"),
    h("div", { class: "grid2" }, fieldList.map(([k, l]) => h("label", { class: "check" }, checks[k], l.replaceAll("trimestre", per.word)))),
    warn, msg, h("p", { class: "hint" }, "Le fichier enregistré n’est pas chiffré (UTF-8).")],
  actions: [
    { label: "Fermer", left: true },
    { label: "Copier dans le presse-papiers", close: false, onClick: async () => { const t = build(); if (t !== null) { const ok = await copyText(t); toast(ok ? "Copié ✓" : "Copie impossible", ok ? "" : "bad"); } } },
    { label: "Enregistrer / envoyer…", kind: "primary", close: false, onClick: async () => {
      const t = build();
      if (t === null) return;
      const ext = sep.value === ";" ? "csv" : "txt";
      await shareOrWarn(`${cls.nom}-${per.prefix}${period.value}.${ext}`, "\ufeff" + t, "text/plain");
    } }] });
}
