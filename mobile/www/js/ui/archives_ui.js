// Archives : copies chiffrées horodatées du coffre, avec les mêmes noms que sur le PC (les deux programmes les lisent).
import { NeedPasswordError, WrongPasswordError } from "../core/vault.js";
import { shareOrWarn } from "./share.js";
import { alertDialog, confirmDialog, h, modal, promptDialog, toast } from "./dom.js";

export const REASONS = { suppression: "avant suppression d’une classe", auto: "automatique", manuel: "manuelle", demarrage: "à l’ouverture", fermeture: "à la fermeture",
  restauration: "avant restauration", mdp: "avant changement de mot de passe", import: "avant import du fichier du PC" };

export async function openArchives(app) {
  await app.flush();
  const v = app.values;
  const list = h("div", { class: "list" });
  const info = h("p", { class: "hint" }, v.backupMinutes > 0
    ? `Une archive chiffrée est créée toutes les ${v.backupMinutes} min si les données ont changé, ainsi qu’à l’ouverture et à la fermeture. Les modifications sont par ailleurs enregistrées en continu dans le fichier principal.`
    : "Les archives automatiques périodiques sont désactivées (voir Préférences). Les modifications restent enregistrées en continu.");
  let ctl = null;

  async function draw() {
    list.replaceChildren();
    const archives = await app.vault.listArchives();
    if (!archives.length) list.append(h("div", { class: "item muted" }, "Aucune archive pour le moment."));
    for (const a of archives) {
      const when = a.date.toLocaleString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
      list.append(h("div", { class: "item" }, h("div", { class: "t" }, when, h("small", {}, `${REASONS[a.reason] || a.reason || "—"} · ${Math.max(1, Math.round(a.size / 1024))} Ko`)),
        h("button", { class: "btn small", type: "button", onclick: () => restore(a, when) }, "Restaurer"),
        h("button", { class: "btn small", type: "button", "aria-label": "Envoyer cette archive", onclick: async () => { await shareOrWarn(a.name, await app.vault.archiveText(a.name), "application/json"); } }, "⭱"),
        h("button", { class: "btn small danger", type: "button", "aria-label": "Supprimer cette archive", onclick: async () => {
          if (await confirmDialog("Supprimer cette archive ?", { okLabel: "Supprimer", danger: true })) { await app.vault.deleteArchive(a.name); draw(); }
        } }, "🗑")));
    }
  }

  async function restore(a, when) {
    if (!(await confirmDialog(`Restaurer les données du ${when} ?\n\nLes données actuelles seront remplacées (une archive de l’état actuel est créée juste avant, vous pourrez y revenir).`, { okLabel: "Restaurer", title: "Restaurer" }))) return;
    let data;
    try {
      try { data = await app.vault.readArchive(a.name); }
      catch (e) {
        if (!(e instanceof NeedPasswordError)) throw e;
        const pw = await promptDialog({ title: "Mot de passe de l’archive", label: "Cette archive date d’un autre mot de passe. Entrez celui qui était utilisé à ce moment-là :" });
        if (pw === null) return;
        data = await app.vault.readArchive(a.name, pw);
      }
    } catch (e) { await alertDialog(e instanceof WrongPasswordError ? "Mot de passe incorrect, ou archive abîmée." : e.message); return; }
    await app.archive("restauration");
    await app.vault.save(data);
    ctl.close();
    app.openState(data);
    app.requestRender();
    toast("Données restaurées ✓");
  }

  ctl = modal({ title: "Archives des données", size: "wide", body: [info, list], actions: [
    { label: "Archiver maintenant", left: true, close: false, onClick: async () => { await app.archive("manuel"); await draw(); } },
    { label: "Fermer", kind: "primary" }] });
  draw();
}
