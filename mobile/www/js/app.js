// Contrôleur de l'application : données, préférences, historique annuler/rétablir, enregistrement différé, archives, verrouillage.
// Reproduit le comportement du programme du PC (suiviclasse/ui/app.py).
import * as M from "./core/model.js";
import * as PR from "./core/prefs.js";
import { clone } from "./core/util.js";
import { Vault } from "./core/vault.js";
import { prefersDark } from "./platform.js";

export const SAVE_DELAY_MS = 700;
export const UNDO_MAX = 100;
export const TICK_MS = 15000;

export class App {
  constructor(storage) {
    this.storage = storage;
    this.vault = new Vault(storage);
    this.prefs = PR.defaults();
    this.state = null;
    this.dirty = false;
    this.status = "";
    this.search = "";
    this.undo = []; this.redo = []; this._last = null;
    this._saveTimer = null;
    this._lastArchive = Date.now();
    this._lastActivity = Date.now();
    this.renderHook = null;
    this.lockHook = null;
    this.statusHook = null;
    this.saving = Promise.resolve();
  }

  // ---------- démarrage ----------
  async init() {
    await this.loadPrefs();
    this.applyLook();
    setInterval(() => this._tick(), TICK_MS);
    const touch = () => { this._lastActivity = Date.now(); };
    for (const ev of ["pointerdown", "keydown", "wheel"]) document.addEventListener(ev, touch, { capture: true, passive: true });
    if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener("change", () => this.applyLook());
  }

  // ---------- préférences (fichier « preferences.json », même format que sur le PC) ----------
  async loadPrefs() {
    const text = await this.storage.get(PR.FILE);
    try { this.prefs = text === null ? { ...PR.defaults(), affichage: "normal" } : PR.sanitize(JSON.parse(text)); } catch (e) { this.prefs = PR.defaults(); }
    // sur tablette, la présentation « confortable » (grandes cibles tactiles) est celle par défaut ; le PC propose « resserré »
  }

  get values() { return this.prefs; }

  async setPrefs(partial) {
    this.prefs = PR.sanitize({ ...this.prefs, ...partial });
    await this.storage.put(PR.FILE, JSON.stringify(this.prefs, null, 2));
    this.applyLook();
    return this.prefs;
  }

  /** Remplace les préférences par celles d'un fichier « preferences.json » du PC. */
  async importPrefs(text) {
    const raw = JSON.parse(text);
    if (!raw || typeof raw !== "object") throw new Error("Fichier de préférences non reconnu.");
    return this.setPrefs({ ...PR.defaults(), ...PR.sanitize(raw) });
  }

  applyLook() {
    const mode = this.prefs.theme;
    const dark = mode === "sombre" || (mode === "auto" && prefersDark());
    const root = document.documentElement;
    root.dataset.theme = dark ? "dark" : "light";
    root.dataset.density = this.prefs.affichage === "compact" ? "compact" : "normal";
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.content = dark ? "#1e222a" : "#ffffff";
  }

  // ---------- raccourcis ----------
  get per() { return M.periods(this.prefs.periodes); }

  /** Période affichée (1 à 3 en trimestres, 1 à 2 en semestres). */
  get t() { return Math.min(Math.max(1, Number(this.state.ui.trimestre) || 1), this.per.n); }

  get currentClass() {
    if (!this.state) return null;
    return this.state.classes.find((c) => c.id === this.state.ui.classe) || null;
  }

  setStatus(text) { this.status = text; if (this.statusHook) this.statusHook(text); }
  requestRender() { if (this.renderHook) this.renderHook(); }

  // ---------- coffre ----------
  async vaultExists() { return this.vault.exists(); }

  async createVault(password, onProgress) {
    await this.vault.create(password, M.newData(), onProgress);
    return this.openState(await this.vault.unlock(password, onProgress));
  }

  async unlock(password, onProgress) { return this.openState(await this.vault.unlock(password, onProgress)); }

  /** Remplace le coffre par un fichier « suivi.enc » venu du PC (mot de passe de ce fichier). */
  async importVault(text, password, onProgress) {
    await this.flush();
    return this.openState(await this.vault.replaceWithFile(text, password, onProgress));
  }

  openState(data) {
    this.state = data;
    if (!this.state.ui) this.state.ui = { classe: null, trimestre: 1 };
    if (!this.state.salles) this.state.salles = [];
    if (!this.state.settings) this.state.settings = { annee: "" };
    for (const c of this.state.classes) M.ensureNumbers(c);
    if (!this.currentClass) this.state.ui.classe = this.state.classes.length ? this.state.classes[0].id : null;
    this.dirty = false;
    this.search = "";
    this.resetHistory();
    this._lastArchive = this._lastActivity = Date.now();
    this.setStatus("Enregistré ✓");
    return this.state;
  }

  /** Remplace toutes les données (restauration d'une archive). */
  setState(data) {
    this.openState(data);
    this.dirty = true;
    this.commit();
    this.flush();
  }

  // ---------- enregistrement et historique ----------
  /** À appeler après toute modification : l'enregistre (différé, groupé) et la range dans l'historique. */
  commit() {
    this._pushHistory();
    this.dirty = true;
    this.setStatus("Modifié…");
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.flush(), SAVE_DELAY_MS);
    this.requestRender();
  }

  flush() {
    clearTimeout(this._saveTimer);
    this._saveTimer = null;
    if (!(this.dirty && this.state && this.vault.unlocked)) return this.saving;
    const snapshot = clone(this.state);  // l'état au moment de l'appel : les modifications suivantes seront enregistrées à leur tour
    this.dirty = false;
    this.saving = this.saving.then(() => this.vault.save(snapshot)).then(
      () => { if (!this.dirty) this.setStatus("Enregistré ✓"); },
      (e) => { this.dirty = true; this.setStatus("ÉCHEC enregistrement !"); console.error(e); });
    return this.saving;
  }

  _snap() {
    const { ui, ...rest } = this.state;
    return clone(rest);
  }

  resetHistory() { this.undo = []; this.redo = []; this._last = this.state ? this._snap() : null; }

  _pushHistory() {
    if (this._last === null || !this.state) return;
    const snap = this._snap();
    if (JSON.stringify(snap) !== JSON.stringify(this._last)) {
      this.undo.push(this._last);
      if (this.undo.length > UNDO_MAX) this.undo.splice(0, this.undo.length - UNDO_MAX);
      this.redo.length = 0;
      this._last = snap;
    }
  }

  undoAction() { return this._travel(this.undo, this.redo, "Modification annulée"); }
  redoAction() { return this._travel(this.redo, this.undo, "Modification rétablie"); }

  _travel(source, target, message) {
    if (!this.state) return false;
    this._pushHistory();
    if (!source.length) return false;
    target.push(this._snap());
    const snap = source.pop();
    Object.assign(this.state, clone(snap));  // « ui » (classe, période affichées) n'est pas dans l'historique
    this._last = clone(snap);
    if (!this.currentClass) this.state.ui.classe = this.state.classes.length ? this.state.classes[0].id : null;
    this.dirty = true;
    this.flush();
    this.setStatus(message + " ✓");
    this.requestRender();
    return true;
  }

  // ---------- archives et verrouillage ----------
  async archive(reason) {
    try {
      const name = await this.vault.snapshot(reason);
      await this.vault.prune(this.values.backupKeepRecent, this.values.backupKeepDays);
      this._lastArchive = Date.now();
      return name;
    } catch (e) { return null; }
  }

  async _tick() {
    if (!(this.state && this.vault.unlocked)) return;
    const now = Date.now(), minutes = this.values.backupMinutes;
    if (minutes > 0 && now - this._lastArchive >= minutes * 60000) { await this.flush(); await this.archive("auto"); }
    this.checkAutoLock();
  }

  checkAutoLock() {
    const lock = this.values.autoLockMinutes;
    if (this.state && lock > 0 && Date.now() - this._lastActivity >= lock * 60000) this.lock();
  }

  /** Enregistre, archive puis verrouille : le mot de passe est de nouveau demandé. */
  async lock() {
    if (!this.state) return;
    clearTimeout(this._saveTimer);
    await this.flush();
    if (this.vault.unlocked) await this.archive("fermeture");
    this.vault.lock();
    this.state = null;
    this.undo = []; this.redo = []; this._last = null;
    if (this.lockHook) this.lockHook();
  }

  /** Appelé quand l'application passe en arrière-plan : tout est enregistré tout de suite. */
  async onPause() { if (this.state) { await this.flush(); } }
  onResume() { this.checkAutoLock(); }

  // ---------- classes ----------
  addClass(nom) {
    const c = M.newClass(nom);
    this.state.classes.push(c);
    this.state.ui.classe = c.id;
    this.commit();
    return c;
  }

  renameClass(c, nom) { c.nom = nom.trim(); this.commit(); }

  async deleteClass(c) {
    await this.flush();
    await this.archive("suppression");  // une archive de l'état précédent : « Archives » permet de revenir en arrière
    this.state.classes.splice(this.state.classes.indexOf(c), 1);
    this.state.ui.classe = this.state.classes.length ? this.state.classes[0].id : null;
    this.commit();
  }

  selectClass(id) { this.state.ui.classe = id; this.requestRender(); this.markUi(); }
  setPeriod(t) { this.state.ui.trimestre = t; this.markUi(); this.requestRender(); }
  setView(v) { this.state.ui.vue = v; this.markUi(); this.requestRender(); }

  /** Les choix d'affichage (classe, période, vue) sont enregistrés avec les données mais ne comptent pas comme une modification. */
  markUi() {
    this.dirty = true;
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => this.flush(), SAVE_DELAY_MS * 2);
  }
}
