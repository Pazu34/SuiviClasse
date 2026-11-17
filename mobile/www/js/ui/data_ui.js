// Données et mot de passe : échange du fichier « suivi.enc » avec le PC, préférences du PC, changement de mot de passe, classe Test.
import * as M from "../core/model.js";
import { addDemoPlan } from "../core/plan.js";
import { norm } from "../core/util.js";
import { WrongPasswordError } from "../core/vault.js";
import { MIN_PW } from "./login.js";
import { pickFile, shareFile } from "../platform.js";
import { alertDialog, confirmDialog, h, modal, promptDialog, toast } from "./dom.js";

export function openData(app, shell) {
  const err = h("div", { class: "error" });
  const annee = h("input", { type: "text", value: app.state.settings.annee || "", placeholder: "2026-2027" });
  const cur = h("input", { type: "password", autocomplete: "current-password" });
  const n1 = h("input", { type: "password", autocomplete: "new-password" });
  const n2 = h("input", { type: "password", autocomplete: "new-password" });
  let ctl = null;

  const row = (title, text, label, fn, kind = "") => h("div", { class: "item" }, h("div", { class: "t" }, title, h("small", { style: { whiteSpace: "normal" } }, text)),
    h("button", { class: "btn small " + kind, type: "button", onclick: fn }, label));

  async function exportVault() {
    await app.flush();
    const r = await shareFile("suivi.enc", await app.vault.fileText(), "application/json");
    if (r !== "cancelled") toast(r === "shared" ? "Fichier prêt à envoyer ✓" : "Fichier téléchargé ✓");
  }

  async function importVault() {
    const f = await pickFile(".enc,application/json,text/plain,*/*");
    if (!f) return;
    if (!(await confirmDialog(`Remplacer toutes les données de la tablette par le fichier « ${f.name} » ?\n\nUne archive des données actuelles est créée juste avant : vous pourrez la restaurer depuis « Archives ».`,
      { okLabel: "Remplacer", danger: true, title: "Remplacer les données" }))) return;
    const pw = await promptDialog({ title: "Mot de passe du fichier", label: "Mot de passe du coffre du PC", hint: "C'est celui du fichier choisi ; il remplacera le mot de passe actuel de la tablette." });
    if (pw === null) return;
    try {
      await app.archive("import");
      await app.importVault(new TextDecoder().decode(f.bytes), pw);
    } catch (e) { await alertDialog(e instanceof WrongPasswordError ? "Mot de passe incorrect, ou fichier abîmé. Les données de la tablette n'ont pas changé." : e.message); return; }
    ctl.close();
    app.requestRender();
    toast("Données du PC importées ✓");
  }

  async function importPrefs() {
    const f = await pickFile(".json,application/json,text/plain,*/*");
    if (!f) return;
    try { await app.importPrefs(new TextDecoder().decode(f.bytes)); } catch (e) { await alertDialog("Fichier de préférences non reconnu."); return; }
    app.requestRender();
    toast("Préférences du PC importées ✓");
  }

  function addDemo() {
    if (app.state.classes.some((c) => norm(c.nom) === norm(M.DEMO_NAME))) {
      err.textContent = `Une classe « ${M.DEMO_NAME} » existe déjà (supprimez-la d’abord si vous voulez la recréer).`;
      return;
    }
    const demo = M.demoClass();
    addDemoPlan(app.state, demo);
    app.state.classes.push(demo);
    app.state.ui.classe = demo.id;
    app.commit();
    ctl.close();
  }

  async function save() {
    err.textContent = "";
    app.state.settings.annee = annee.value.trim();
    try {
      if (cur.value || n1.value) {
        if (n1.value.length < MIN_PW) throw new Error(`Le nouveau mot de passe doit contenir au moins ${MIN_PW} caractères.`);
        if (n1.value !== n2.value) throw new Error("Les deux nouveaux mots de passe sont différents.");
        await app.flush();
        await app.vault.changePassword(cur.value, n1.value, app.state);
        toast("Mot de passe modifié ✓");
      }
    } catch (e) { err.textContent = e instanceof WrongPasswordError ? "Mot de passe actuel incorrect." : e.message; return false; }
    app.commit();
  }

  ctl = modal({ title: "Données et mot de passe", body: [
    h("label", { class: "field" }, "Année scolaire"), annee,
    h("h4", { style: { margin: "18px 0 6px" } }, "Échanger avec le PC"),
    h("p", { class: "hint" }, "Le fichier « suivi.enc » est le même sur le PC (dossier SuiviClasse-Donnees) et sur la tablette : copiez-le dans un sens ou dans l'autre (câble USB, Drive, courriel, Partage rapide…). Il est chiffré par votre mot de passe."),
    h("div", { class: "list" },
      row("Envoyer les données vers le PC", "Exporte « suivi.enc » (partage Android).", "Exporter", exportVault),
      row("Reprendre les données du PC", "Remplace les données de la tablette par un « suivi.enc » du PC (archive préalable).", "Importer", importVault, "danger"),
      row("Préférences du PC", "Importe un « preferences.json » du PC (seuils d'alerte, découpage de l'année…).", "Importer", importPrefs)),
    h("h4", { style: { margin: "18px 0 6px" } }, "Changer le mot de passe"),
    h("label", { class: "field" }, "Mot de passe actuel"), cur, h("label", { class: "field" }, "Nouveau mot de passe"), n1, h("label", { class: "field" }, "Confirmer"), n2,
    err], actions: [
    { label: "Ajouter la classe Test", left: true, close: false, onClick: addDemo },
    { label: "Fermer" }, { label: "Enregistrer", kind: "primary", onClick: save }] });
  return ctl;
}
