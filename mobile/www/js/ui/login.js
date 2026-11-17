// Écran de connexion : créer le coffre, le déverrouiller, ou reprendre le fichier « suivi.enc » du PC.
import { WrongPasswordError } from "../core/vault.js";
import { pickFile } from "../platform.js";
import { alertDialog, h, promptDialog } from "./dom.js";

export const MIN_PW = 8;

export async function showLogin(app, root, onOpen, message = "") {
  const creating = !(await app.vaultExists());
  const pw = h("input", { type: "password", autocomplete: creating ? "new-password" : "current-password", enterKeyHint: creating ? "next" : "go", "aria-label": "Mot de passe" });
  const pw2 = h("input", { type: "password", autocomplete: "new-password", enterKeyHint: "go", "aria-label": "Confirmer le mot de passe" });
  const err = h("div", { class: "error", role: "alert" }, message);
  const bar = h("div", { class: "progress hidden" }, h("div"));
  const btn = h("button", { class: "btn primary", type: "button" }, creating ? "Créer le coffre" : "Déverrouiller");

  const busy = (on) => {
    btn.disabled = on;
    bar.classList.toggle("hidden", !on);
    if (!on) bar.firstChild.style.width = "0";
  };
  const progress = (x) => { bar.firstChild.style.width = Math.round(x * 100) + "%"; };

  async function submit() {
    err.textContent = "";
    try {
      if (creating) {
        if (pw.value.length < MIN_PW) throw new Error(`Le mot de passe doit contenir au moins ${MIN_PW} caractères.`);
        if (pw.value !== pw2.value) throw new Error("Les deux mots de passe sont différents.");
        busy(true);
        await app.createVault(pw.value, progress);
      } else {
        busy(true);
        await app.unlock(pw.value, progress);
        await app.archive("demarrage");
      }
    } catch (e) {
      busy(false);
      err.textContent = e instanceof WrongPasswordError || e instanceof Error ? e.message : String(e);
      return;
    }
    busy(false);
    onOpen();
  }

  async function importFromPc() {
    const f = await pickFile(".enc,application/json,text/plain,*/*");
    if (!f) return;
    const text = new TextDecoder().decode(f.bytes);
    const password = await promptDialog({ title: "Fichier du PC", label: "Mot de passe de ce fichier", value: "", hint: `« ${f.name} » : le mot de passe est celui du coffre sur le PC.` });
    if (password === null) return;
    try {
      busy(true);
      await app.importVault(text, password, progress);
    } catch (e) {
      busy(false);
      await alertDialog(e instanceof WrongPasswordError ? "Mot de passe incorrect, ou fichier abîmé." : e.message);
      return;
    }
    busy(false);
    await app.archive("demarrage");
    onOpen();
  }

  btn.addEventListener("click", submit);
  (creating ? pw2 : pw).addEventListener("keydown", (e) => { if (e.key === "Enter") submit(); });
  if (creating) pw.addEventListener("keydown", (e) => { if (e.key === "Enter") pw2.focus(); });

  root.replaceChildren(h("div", { class: "loginwrap" }, h("div", { class: "login" },
    h("div", { class: "logo" }, "📚"),
    h("h1", {}, "SuiviClasse"),
    h("p", { class: "muted" }, creating ? "Aucune donnée sur cette tablette : créez votre coffre protégé par mot de passe, ou reprenez celui du PC."
      : "Entrez votre mot de passe pour déverrouiller les données."),
    h("label", { class: "field" }, creating ? "Nouveau mot de passe" : "Mot de passe"), pw,
    creating ? [h("label", { class: "field" }, "Confirmer le mot de passe"), pw2,
      h("p", { style: { background: "var(--warn)", padding: "10px 12px", borderRadius: "8px", marginTop: "12px" } }, "⚠ Il n’existe aucun moyen de récupérer les données si le mot de passe est perdu.")] : null,
    err, bar,
    h("div", { class: "actions" }, btn,
      h("button", { class: "btn", type: "button", onclick: importFromPc }, creating ? "Reprendre le fichier suivi.enc du PC…" : "Remplacer par le fichier suivi.enc du PC…")))));
  setTimeout(() => pw.focus(), 100);
}
