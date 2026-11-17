// Import d'une liste d'élèves ou d'un tableau de notes copié depuis PRONOTE (ou n'importe quel tableur) : mêmes rubriques et mêmes règles que sur le PC.
import * as X from "../core/exchange.js";
import * as M from "../core/model.js";
import { pickFile } from "../platform.js";
import { alertDialog, h, modal, select } from "./dom.js";

const PREVIEW_ROWS = 8;

export function openImport(app, cls) {
  const per = app.per;
  const rolesList = X.roleList(per.prefix, per.n);
  let rows = [], guessed = [], roles = [], ctl = null;

  const text = h("textarea", { rows: 5, placeholder: "Collez ici le tableau copié depuis PRONOTE (ou un tableur)…", style: { whiteSpace: "pre", fontFamily: "monospace", fontSize: ".85em" } });
  const delim = select([["", "Séparateur : automatique"], ["\t", "Tabulation"], [";", "Point-virgule"], [",", "Virgule"]], "");
  const skip = h("input", { type: "number", min: 0, max: 50, value: 0, inputMode: "numeric", style: { width: "80px" } });
  const preview = h("div", { class: "previewtable" });
  const info = h("div", { class: "hint" });
  const summary = h("div", { style: { fontWeight: 600, margin: "6px 0" } });
  const create = h("input", { type: "checkbox", checked: !cls || !cls.eleves.length });
  const err = h("div", { class: "error" });

  const skipCount = () => Math.max(0, parseInt(skip.value, 10) || 0);

  function analyse() {
    err.textContent = "";
    rows = X.parseTable(text.value, delim.value || null);
    roles = [];
    if (rows.length) {
      const hasHeader = X.looksLikeHeader(rows[0]);
      skip.value = hasHeader ? 1 : 0;
      const n = Math.max(...rows.map((r) => r.length));
      guessed = hasHeader ? rows[0].map((x) => X.guessRole(x, app.t)) : n === 1 ? ["nomprenom"] : Array.from({ length: n }, (_, i) => (i < 3 ? ["nom", "prenom", "infos"][i] : "ignore"));
      while (guessed.length < n) guessed.push("ignore");
      const valid = new Set(rolesList.map(([k]) => k));  // un titre « T3 » n'a pas de rubrique en semestres
      guessed = guessed.map((r) => (valid.has(r) ? r : "ignore"));
      if (guessed.includes("classe")) create.checked = true;  // la liste indique les classes : on peut les créer
      roles = [...guessed];
    }
    draw();
  }

  function draw() {
    preview.replaceChildren();
    if (!rows.length) { info.textContent = ""; summary.textContent = ""; return; }
    const n = Math.max(...rows.map((r) => r.length)), k = skipCount();
    const head = h("tr", {}, Array.from({ length: n }, (_, i) => {
      const sel = select(rolesList.map(([key, l]) => [key, l]), roles[i] || "ignore");
      sel.addEventListener("change", () => { roles[i] = sel.value; summarize(); });
      return h("th", {}, sel);
    }));
    const body = rows.slice(0, PREVIEW_ROWS).map((r, ri) => h("tr", { class: ri < k ? "skipped" : "" }, Array.from({ length: n }, (_, i) => h("td", {}, r[i] || ""))));
    preview.append(h("table", {}, h("thead", {}, head), h("tbody", {}, body)));
    info.textContent = `${Math.max(0, rows.length - k)} ligne(s) à importer sur ${rows.length}. Associez chaque colonne à une rubrique ; les lignes grisées (titres) sont ignorées.`;
    summarize();
  }

  const apply = (classes) => X.applyTable(classes, rows, roles, skipCount(), cls ? cls.id : null, create.checked, M.newStudent, M.newClass);

  function summarize() {
    if (!roles.length || !(roles.includes("nom") || roles.includes("nomprenom"))) { summary.textContent = ""; return; }
    const rep = apply(structuredClone(app.state.classes));
    const cl = Object.entries(rep.classes).map(([n, c]) => `${n} (${c})`).join(", ");
    summary.textContent = `Résultat attendu : ${rep.created} élève(s) à créer, ${rep.updated} à mettre à jour`
      + (rep.createdClasses ? `, ${rep.createdClasses} classe(s) à créer` : "") + (cl ? ` — classes : ${cl}` : "")
      + (rep.unmatched.length ? ` — ${rep.unmatched.length} ligne(s) sans classe ou élève inconnu(e), ignorée(s)` : "") + ".";
  }

  async function doImport() {
    if (!(roles.includes("nom") || roles.includes("nomprenom"))) { err.textContent = "Associez au moins une colonne à « Nom » ou « Nom et prénom »."; return false; }
    if (!cls && !roles.includes("classe")) { err.textContent = "Aucune classe n’est ouverte : associez une colonne à « Classe » (ou créez d’abord une classe)."; return false; }
    const known = new Set(app.state.classes.map((c) => c.id));
    const rep = apply(app.state.classes);
    for (const c of app.state.classes) { M.sortStudents(c); M.ensureNumbers(c); }
    if (rep.createdClasses) M.placeNewClasses(app.state, known);
    if (!app.currentClass && app.state.classes.length) app.state.ui.classe = app.state.classes[0].id;
    app.commit();
    ctl.close();
    const lines = [`${rep.created} élève(s) créé(s), ${rep.updated} mis à jour, ${rep.unchanged} inchangé(s)` + (rep.createdClasses ? `, ${rep.createdClasses} classe(s) créée(s)` : "") + "."];
    if (rep.unmatched.length) lines.push("Non trouvés (ignorés) : " + rep.unmatched.slice(0, 15).join(", ") + (rep.unmatched.length > 15 ? "…" : ""));
    if (rep.invalid.length) lines.push("Valeurs de note non reconnues (ignorées) : " + rep.invalid.slice(0, 10).join(" ; "));
    await alertDialog(lines.join("\n\n"), "Import terminé");
    return false;
  }

  text.addEventListener("input", analyse);
  text.addEventListener("paste", () => setTimeout(analyse, 60));
  delim.addEventListener("change", analyse);
  skip.addEventListener("input", draw);
  create.addEventListener("change", summarize);

  ctl = modal({ title: cls ? `Importer dans ${cls.nom}` : "Importer une liste PRONOTE", size: "xl", body: [
    h("p", { class: "hint" }, "Dans PRONOTE, le bouton de copie en haut à droite d’une liste (ou du tableau de notes) place les données dans le presse-papiers : collez-les ici. Un fichier texte exporté de PRONOTE ou d’Excel convient aussi."),
    text,
    h("div", { class: "row wrap", style: { margin: "8px 0" } },
      h("button", { class: "btn", type: "button", onclick: async () => {
        const f = await pickFile(".txt,.csv,.tsv,text/plain,text/csv,*/*");
        if (f) { text.value = X.decodeTextFile(f.bytes); analyse(); }
      } }, "Ouvrir un fichier…"), delim,
      h("span", {}, "Ne pas importer les"), skip, h("span", {}, "premières lignes")),
    preview, info, summary,
    h("label", { class: "check" }, create, "Créer les élèves absents de la classe (sinon, seuls les élèves existants sont mis à jour)"), err],
  actions: [{ label: "Annuler" }, { label: "Importer", kind: "primary", close: false, onClick: doImport }] });
  return ctl;
}
