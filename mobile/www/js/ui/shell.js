// Structure de l'écran principal : barre du haut (vues, périodes, recherche, annuler/rétablir, menu), barre des classes, contenu.
import { overlayCount, confirmDialog, h, menu, promptDialog, toast, modal } from "./dom.js";
import { LABELS, current, getMode, nextMode, setMode } from "../orientation.js";
import { renderSeance } from "./seance.js";
import { renderTable } from "./table.js";

const lazy = {
  prefs: () => import("./prefs_ui.js"), importer: () => import("./import_ui.js"), exporter: () => import("./export_ui.js"),
  archives: () => import("./archives_ui.js"), data: () => import("./data_ui.js"), plan: () => import("./plan_view.js"),
  classes: () => import("./classes_ui.js"),
};

export class Shell {
  constructor(app, root) {
    this.app = app;
    this.root = root;
    this.scheduled = false;
    this.search = h("input", { type: "search", placeholder: "Rechercher", "aria-label": "Rechercher un élève", enterKeyHint: "search" });
    this.search.addEventListener("input", () => { app.search = this.search.value; this.renderContent(); });
    this.statusEl = h("div", { class: "status" });
    this.content = null;
    this.planModule = null;
  }

  show() {
    this.search.value = this.app.search || "";
    this.render();
    lazy.plan().then((m) => { this.planModule = m; if (this.app.state && this.app.state.ui.vue === "plan") this.renderContent(); });
    for (const k of ["prefs", "importer", "exporter", "archives", "data", "classes"]) lazy[k]();  // préchargement
  }

  schedule() {
    if (window.__syncRender && this.app.state) { this.render(); return; }  // tests : reconstruction immédiate
    if (this.scheduled || !this.app.state) return;
    this.scheduled = true;
    requestAnimationFrame(() => { this.scheduled = false; if (this.app.state) this.render(); });
  }

  setStatus(text) { this.statusEl.textContent = text; }

  render() {
    const app = this.app, s = app.state;
    if (!s) return;
    if (Number(s.ui.trimestre) > app.per.n) s.ui.trimestre = 1;  // passage de trimestres à semestres
    const cls = app.currentClass;
    const old = this.root.querySelector(".tablewrap, .canvaswrap, .seancewrap");
    const scroll = old ? [old.scrollLeft, old.scrollTop] : null;
    const view = app.seance ? "seance" : s.ui.vue === "plan" ? "plan" : "tableau";

    const undo = h("button", { class: "btn icon", type: "button", "aria-label": "Annuler", disabled: !app.undo.length, onclick: () => app.undoAction() }, "↶");
    const redo = h("button", { class: "btn icon", type: "button", "aria-label": "Rétablir", disabled: !app.redo.length, onclick: () => app.redoAction() }, "↷");
    const topbar = h("div", { class: "topbar" },
      h("div", { class: "brandbox" }, this.orientButton(), h("div", { class: "brand" }, "📚 SuiviClasse")),
      cls ? h("div", { class: "seg", role: "group", "aria-label": "Vue" }, [["tableau", "Tableau"], ["plan", "Plan de classe"], ["seance", "Séance"]].map(([v, l]) =>
        h("button", { type: "button", "aria-pressed": view === v, onclick: () => app.setView(v) }, l))) : null,
      cls ? h("div", { class: "seg", role: "group", "aria-label": "Période" }, app.per.keys.map((k) =>
        h("button", { type: "button", "aria-pressed": app.t === Number(k), onclick: () => app.setPeriod(Number(k)) }, `${app.per.prefix}${k}`))) : null,
      cls ? h("div", { class: "searchbox" }, this.search) : null,
      h("div", { class: "grow" }), this.statusEl, undo, redo,
      h("button", { class: "btn icon", type: "button", "aria-label": "Menu", onclick: (e) => this.mainMenu(e.currentTarget) }, "⋮"));

    const chips = h("div", { class: "chips", role: "group", "aria-label": "Classes" }, s.classes.map((c) =>
      h("button", { class: "chip", type: "button", "aria-pressed": c.id === s.ui.classe, onclick: () => app.selectClass(c.id) }, c.nom)));
    const classbar = h("div", { class: "classbar" }, chips,
      h("button", { class: "btn icon", type: "button", "aria-label": "Ajouter une classe", onclick: () => this.addClass() }, "+"),
      !s.classes.length ? h("button", { class: "btn primary", type: "button", onclick: () => this.importList() }, "Importer une liste PRONOTE") : null);

    this.content = h("div", { class: "content" });
    this.root.replaceChildren(topbar, classbar, this.content);
    this.setStatus(app.status);
    this.renderContent(scroll);
    // la classe sélectionnée reste visible dans la barre des classes
    const sel = chips.querySelector('[aria-pressed="true"]');
    if (sel && sel.scrollIntoView) sel.scrollIntoView({ inline: "nearest", block: "nearest" });
  }

  renderContent(scroll = null) {
    const app = this.app, cls = app.currentClass;
    if (!this.content) return;
    const old = this.content.querySelector(".tablewrap, .canvaswrap, .seancewrap");
    if (!scroll && old) scroll = [old.scrollLeft, old.scrollTop];
    if (!cls) {
      this.content.replaceChildren(h("div", { class: "empty" }, "Aucune classe. Touchez « + » pour en créer une, ou le menu ⋮ → « Importer une liste PRONOTE »."));
      return;
    }
    const info = h("div", { class: "classinfo" }, h("h2", {}, cls.nom), h("span", { class: "muted" }, `${cls.eleves.length} élève${cls.eleves.length > 1 ? "s" : ""}`),
      h("div", { class: "grow" }));
    let body;
    if (app.seance) body = renderSeance(app, cls, this);
    else if (app.state.ui.vue === "plan") {
      body = this.planModule ? this.planModule.renderPlan(app, cls, this) : h("div", { class: "empty" }, "Chargement du plan de classe…");
    } else body = renderTable(app, cls);
    this.content.replaceChildren(info, body);
    const wrap = this.content.querySelector(".tablewrap, .canvaswrap, .seancewrap");
    if (scroll && wrap) { wrap.scrollLeft = scroll[0]; wrap.scrollTop = scroll[1]; }
  }

  /** Petit bouton en haut à gauche : Automatique → Paysage → Portrait. Le dessin montre l'orientation actuelle ; « A » = automatique. */
  orientButton() {
    const mode = getMode();
    const b = h("button", { class: "btn icon orientbtn", type: "button", "data-mode": mode,
      title: `Orientation : ${LABELS[mode]}`, "aria-label": `Orientation de l'écran : ${LABELS[mode]}. Toucher pour changer.`,
      onclick: async () => {
        const m = await setMode(nextMode(getMode()));
        toast(m === "auto" ? "Orientation automatique : suit la rotation de la tablette" : `Écran verrouillé en ${LABELS[m].toLowerCase()}`);
        this.render();
      } },
      h("span", { class: "rot", "data-o": current() }), mode === "auto" ? h("span", { class: "rotauto" }, "A") : null);
    return b;
  }

  // ---------- actions ----------
  async addClass() {
    const nom = await promptDialog({ title: "Nouvelle classe", label: "Nom de la classe (ex. 6A)", validate: (v) => (v.trim() ? null : "Donnez un nom à la classe.") });
    if (nom && nom.trim()) this.app.addClass(nom);
  }

  async importList() { (await lazy.importer()).openImport(this.app, null); }

  mainMenu(anchor) {
    const app = this.app, cls = app.currentClass;
    menu(anchor, [
      { label: cls ? "Importer des élèves…" : "Importer une liste PRONOTE…", icon: "⭳", onClick: async () => (await lazy.importer()).openImport(app, cls) },
      cls ? { label: "Exporter (PRONOTE, tableur)…", icon: "⭱", onClick: async () => (await lazy.exporter()).openExport(app, cls) } : { separator: true },
      { separator: true },
      cls ? { label: "Renommer la classe…", icon: "✏", onClick: async () => { const n = await promptDialog({ title: "Renommer la classe", label: "Nouveau nom", value: cls.nom, validate: (v) => (v.trim() ? null : "Donnez un nom à la classe.") }); if (n) app.renameClass(cls, n); } } : null,
      cls ? { label: "Supprimer la classe…", icon: "🗑", danger: true, onClick: async () => {
        if (await confirmDialog(`Supprimer la classe ${cls.nom} et ses ${cls.eleves.length} élèves ?\n\nUne archive des données actuelles est créée juste avant : vous pourrez la restaurer depuis « Archives » en cas d’erreur.`, { okLabel: "Supprimer", danger: true, title: "Supprimer la classe" })) await app.deleteClass(cls);
      } } : null,
      { label: "Ordre des classes…", icon: "↕", onClick: async () => (await lazy.classes()).openClassOrder(app) },
      { separator: true },
      { label: "Colonnes…", icon: "▦", onClick: async () => (await lazy.prefs()).openPrefs(app, "colonnes") },
      { label: "Préférences…", icon: "⚙", onClick: async () => (await lazy.prefs()).openPrefs(app) },
      { label: "Archives…", icon: "🕘", onClick: async () => (await lazy.archives()).openArchives(app) },
      { label: "Données (PC, mot de passe)…", icon: "🗂", onClick: async () => (await lazy.data()).openData(app, this) },
      { separator: true },
      { label: "Verrouiller", icon: "🔒", onClick: () => app.lock() },
    ].filter(Boolean), { align: "right" });
  }

  /** Retour (bouton Android) : ferme d'abord les fenêtres ouvertes. */
  hasOverlay() { return overlayCount() > 0; }
}

export { modal, toast };
