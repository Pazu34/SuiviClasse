// Préférences : réglages (même schéma que le PC) et onglet « Colonnes » (colonnes intégrées, de base et personnalisées).
// L'onglet « Colonnes » travaille sur une copie de la configuration, appliquée aux données à « Enregistrer » (une seule modification annulable).
import * as C from "../core/columns.js";
import * as M from "../core/model.js";
import * as PR from "../core/prefs.js";
import { clone, fmtNum } from "../core/util.js";
import { confirmDialog, h, modal, select, toast } from "./dom.js";

const TYPE_LABELS = Object.fromEntries(C.TYPES);
const parseNumber = (text) => { const v = Number(String(text).trim().replace(",", ".")); if (String(text).trim() === "" || !Number.isFinite(v)) throw new Error("Valeur numérique invalide."); return v; };

// ---------------------------------------------------------------- pictogrammes
function emojiPicker(current, onPick) {
  const other = h("input", { type: "text", maxLength: 8, style: { width: "100px" }, placeholder: "😀" });
  let ctl = null;
  const pick = (e) => { onPick(e); ctl.close(); };
  ctl = modal({ title: "Choisir un pictogramme", body: [
    C.EMOJIS.map(([group, items]) => [h("h4", { style: { margin: "12px 0 6px" } }, group), h("div", { class: "emojis" }, items.map((e) => h("button", { type: "button", "aria-pressed": e === current, onclick: () => pick(e) }, e)))]),
    h("div", { class: "row", style: { marginTop: "14px" } }, h("span", {}, "Autre (saisir ou coller) :"), other, h("button", { class: "btn", type: "button", onclick: () => pick(Array.from(other.value.trim()).slice(0, 4).join("")) }, "Utiliser"))],
  actions: [{ label: "Aucun pictogramme", left: true, onClick: () => onPick("") }, { label: "Annuler" }] });
}

// ---------------------------------------------------------------- éditeur de colonne
/** data : réglages actuels ; builtin : clé d'une colonne intégrée ; base : clé d'une colonne de base ; onOk(dict) reçoit le résultat. */
function columnEditor(app, data, onOk, { builtin = null, base = null } = {}) {
  const word = app.per.word;
  const state = { emoji: data.emoji || "" };
  const isNew = !data.id && !builtin && !base;
  const typeFixed = !!(builtin || base);
  const gradeBuiltin = builtin && C.GRADE_KEYS.includes(builtin);
  const firstType = data.type || "compteur";
  const g = C.gradeCfg(data);

  const title = h("input", { type: "text", value: data.titre || "", maxLength: 40, disabled: base === "notes" });
  const emojiBtn = h("button", { class: "btn", type: "button", onclick: () => emojiPicker(state.emoji, (e) => { state.emoji = e; emojiBtn.textContent = e || "(aucun)"; }) }, state.emoji || "(aucun)");
  const typeSel = select(C.TYPES, gradeBuiltin ? "niveaux" : (data.type || "compteur"), { disabled: typeFixed });
  const currentType = () => (gradeBuiltin ? "niveaux" : builtin ? "compteur" : base ? "base" : typeSel.value);

  const incs = h("input", { type: "text", value: C.formatIncrements(data.increments || [-1, 1]), inputMode: "text" });
  const orange = h("input", { type: "text", inputMode: "decimal", value: data.orange ? fmtNum(data.orange) : "" });
  const rouge = h("input", { type: "text", inputMode: "decimal", value: data.rouge ? fmtNum(data.rouge) : "" });
  const scaleIn = h("input", { type: "text", inputMode: "decimal", value: fmtNum(data.echelle || 10), style: { width: "110px" } });
  const choix = h("textarea", { rows: 6, value: (data.choix || []).join("\n") });
  const nlev = select([2, 3, 4, 5].map((n) => [String(n), String(n)]), String(g.niveaux.length), { style: { width: "90px" } });
  const levelIns = Array.from({ length: C.MAX_LEVELS }, (_, i) => h("input", { type: "text", maxLength: C.MAX_LEVEL_LEN, value: i < g.niveaux.length ? g.niveaux[i] : C.DEFAULT_LEVELS[i] }));
  const levelRows = levelIns.map((inp, i) => h("div", { class: "row", style: { margin: "4px 0" } }, h("span", { class: "lbl", style: { width: "170px", flex: "none" } }), inp));
  const ruleSel = select(C.RULES.map(([k, l]) => [k, l.replaceAll("trimestre", word)]), g.regle);
  const xIn = h("input", { type: "text", inputMode: "numeric", value: String(g.x), style: { width: "90px" } });
  const err = h("div", { class: "error" });

  const fIncs = h("div", {}, h("label", { class: "field" }, "Boutons d'incrément"), incs,
    h("div", { class: "hint" }, "Une valeur par bouton, séparées par des « ; » ou des espaces. Exemples : « +0,5 ; +2 », « −1 ; +1 », « −2 −1 +1 +2 ». Les valeurs négatives retirent des points. Jusqu'à 6 boutons."));
  const fAlert = h("div", {}, h("label", { class: "field" }, "Alertes colorées (facultatif)"), h("div", { class: "row" }, h("span", {}, "Orange à partir de"), orange, h("span", {}, "Rouge à partir de"), rouge));
  const fScale = h("div", {}, h("label", { class: "field" }, "Note sur"), h("div", { class: "row" }, scaleIn, h("span", { class: "hint" }, "(10 pour une note /10, 5 pour /5…)")));
  const fChoix = h("div", {}, h("label", { class: "field" }, "Choix du menu (un par ligne)"), choix, h("div", { class: "hint" }, "Exemples : Très bien / Bien / À surveiller. Jusqu'à 20 choix."));
  const fNiv = h("div", {}, h("label", { class: "field" }, "Nombre de niveaux"), nlev, h("label", { class: "field" }, "Noms des niveaux (du meilleur au moins bon)"), levelRows,
    h("div", { class: "hint" }, "À chaque séance un clic attribue un niveau ; la note finale est la moyenne des niveaux (1 point d'écart entre deux niveaux). Avec des noms de plus de 3 caractères, un menu « Noter » remplace les boutons."),
    h("label", { class: "field" }, `Note finale du ${word}`), ruleSel,
    h("div", { class: "row", style: { marginTop: "6px" } }, h("span", {}, "X ="), xIn, h("span", { class: "hint" }, "notes retenues pour les règles « X dernières notes » (3 par défaut)")));
  const hintBase = h("div", { class: "hint" }, { fiche: "Le pictogramme est celui du bouton qui ouvre la fiche, en bout de ligne. Le titre peut rester vide.",
    notes: `Les colonnes de notes s'appellent ${app.per.prefix}1, ${app.per.prefix}2… : leur titre ne se change pas ici.`, nom: "Cette colonne ne peut pas être masquée : elle identifie l'élève." }[base] || "");
  const hintType = h("div", { class: "hint" }, "Changer le type conserve les valeurs déjà saisies : elles réapparaissent si elles sont compatibles (note ↔ texte ↔ menu ↔ case ; un compteur ou des niveaux gardent leur journal).");

  function show() {
    const typ = currentType();
    fIncs.classList.toggle("hidden", typ !== "compteur");
    fAlert.classList.toggle("hidden", !(typ === "compteur" && !builtin));
    fScale.classList.toggle("hidden", typ !== "note");
    fChoix.classList.toggle("hidden", typ !== "liste");
    fNiv.classList.toggle("hidden", typ !== "niveaux");
    hintBase.classList.toggle("hidden", typ !== "base");
    hintType.classList.toggle("hidden", !(!typeFixed && data.id && typeSel.value !== firstType));
    const n = Number(nlev.value);
    levelRows.forEach((row, i) => {
      row.classList.toggle("hidden", i >= n);
      row.querySelector(".lbl").textContent = i === 0 ? "Niveau 1 (le meilleur)" : i === n - 1 ? `Niveau ${i + 1} (le moins bon)` : `Niveau ${i + 1}`;
    });
    xIn.disabled = !C.RULES.find(([k]) => k === ruleSel.value)[0].startsWith("dernieres");
  }
  typeSel.addEventListener("change", show); nlev.addEventListener("change", show); ruleSel.addEventListener("change", show);
  show();

  const ctl = modal({ title: isNew ? "Nouvelle colonne" : "Modifier la colonne", body: [
    h("label", { class: "field" }, "Titre"), title, h("label", { class: "field" }, "Pictogramme"), emojiBtn,
    h("label", { class: "field" }, "Type"), typeSel, hintType,
    h("div", { style: { marginTop: "10px" } }, fIncs, fAlert, fScale, fChoix, fNiv, hintBase), err],
  actions: [{ label: "Annuler" }, { label: "OK", kind: "primary", close: false, onClick: () => {
    const t = title.value.split(/\s+/).filter(Boolean).join(" ");
    if (!t && base !== "fiche") { err.textContent = "Donnez un titre à la colonne."; return; }
    const out = { ...data, titre: t, emoji: state.emoji };
    if (base) { ctl.close(); onOk(out); return; }
    const typ = currentType();
    out.type = typ;
    try {
      if (typ === "compteur") {
        const sign = { seancePlus: 1, seanceMoins: -1 }[builtin] || null;
        const list = C.parseIncrements(incs.value, sign);
        if (!list.length) throw new Error("Saisissez au moins une valeur d'incrément (par exemple « +1 »).");
        out.increments = list;
        if (!builtin) {
          for (const [k, inp] of [["orange", orange], ["rouge", rouge]]) {
            if (inp.value.trim()) { const v = parseNumber(inp.value); if (v <= 0) throw new Error("Les seuils d'alerte doivent être positifs."); out[k] = v; } else delete out[k];
          }
          if (out.orange && out.rouge && out.orange > out.rouge) throw new Error("Le seuil orange doit être inférieur ou égal au seuil rouge.");
        }
      } else if (typ === "niveaux") {
        const names = levelIns.slice(0, Number(nlev.value)).map((i) => i.value.split(/\s+/).filter(Boolean).join(" "));
        if (!names.every(Boolean)) throw new Error("Donnez un nom à chacun des niveaux.");
        if (new Set(names.map((x) => x.toLowerCase())).size < names.length) throw new Error("Les niveaux doivent avoir des noms différents.");
        out.niveaux = names;
        out.regle = ruleSel.value;
        const x = parseInt(xIn.value, 10);
        if (!(x >= 1 && x <= C.MAX_X)) throw new Error(`X doit être un nombre entier entre 1 et ${C.MAX_X}.`);
        out.x = x;
      } else if (typ === "liste") {
        out.choix = C.parseChoices(choix.value);
        if (!out.choix.length) throw new Error("Saisissez au moins un choix pour le menu (un par ligne).");
      } else if (typ === "note") {
        const sc = parseNumber(scaleIn.value);
        if (sc <= 0) throw new Error("Valeur numérique invalide.");
        out.echelle = sc;
      }
    } catch (e) { err.textContent = e.message; return; }
    ctl.close();
    onOk(out);
  } }] });
  return ctl;
}

// ---------------------------------------------------------------- onglet « Colonnes »
class ColumnsTab {
  constructor(app) {
    this.app = app;
    const st = app.state.settings;
    this.origScale = C.scale(st);
    this.origNoteScales = Object.fromEntries(C.customs(st).filter((c) => c.type === "note").map((c) => [c.id, c.echelle]));
    this.origLevels = Object.fromEntries(C.gradeColumns(st, false).map((g) => [g.event, g.niveaux.length]));
    this.scale = h("input", { type: "text", inputMode: "decimal", value: fmtNum(this.origScale), style: { width: "90px" } });
    this.builtin = clone(st.builtin || {});
    this.base = clone(st.base || {});
    this.customs = clone(C.customs(st));
    this.order = C.order(st, this.customs.map((c) => c.id));
    this.hideBase = true;
    this.list = h("div", { class: "list" });
    this.err = h("div", { class: "error" });
    this.el = h("div", {}, h("div", { class: "row wrap" }, h("span", {}, `Notes de ${app.per.prefix}1 à ${app.per.prefix}${app.per.n} sur`), this.scale, h("span", { class: "hint" }, "(20 par défaut ; 10 pour des notes /10)")),
      h("div", { class: "row wrap", style: { margin: "14px 0 6px" } }, h("strong", {}, "Colonnes du tableau"), h("div", { class: "grow" }),
        h("button", { class: "btn small", type: "button", onclick: () => this.add() }, "+ Ajouter une colonne…"),
        h("button", { class: "btn small", type: "button", onclick: () => this.presets() }, "Suggestions…")),
      h("label", { class: "check" }, Object.assign(h("input", { type: "checkbox", checked: true }), {}), "Cacher les colonnes de base (n°, nom, prénom, infos, notes, commentaire, fiche)"),
      this.list, this.err,
      h("p", { class: "hint" }, "Les flèches règlent l'ordre d'affichage de toutes les colonnes. Les colonnes ajoutées se placent avant le commentaire. Décochez « Cacher les colonnes de base » pour changer leur titre, leur pictogramme, leur place ou les masquer (le nom reste toujours affiché)."));
    this.el.querySelector('input[type="checkbox"]').addEventListener("change", (e) => { this.hideBase = e.target.checked; this.refresh(); });
    this.refresh();
  }

  shownKeys() { return this.order.filter((k) => !(k in C.BASE && this.hideBase)); }
  customOf(id) { return this.customs.find((c) => c.id === id) || null; }
  builtinCfg(key) { return C.builtin({ builtin: this.builtin }, key); }
  baseCfg(key) { return C.base({ base: this.base }, key); }
  levelsDetail(c) { return `${c.niveaux.join(" · ")} — ${C.ruleLabel(c.regle, c.x, this.app.per.word).toLowerCase()}`; }

  describe(key) {
    const per = this.app.per;
    if (key in C.BASE) {
      const c = this.baseCfg(key);
      return { visible: c.visible, emoji: c.emoji, titre: c.titre || "(sans titre)", type: "Colonne de base",
        detail: { notes: `Une colonne par période (${per.prefix}1 à ${per.prefix}${per.n})`, nom: "Toujours affichée", fiche: "Bouton en bout de ligne", comm: "Appréciation de la période" }[key] || "" };
    }
    if (key in C.BUILTINS) {
      const c = this.builtinCfg(key), niv = C.GRADE_KEYS.includes(key);
      return { visible: c.visible, emoji: c.emoji, titre: c.titre, type: niv ? "Niveaux (intégré)" : "Compteur (intégré)", detail: niv ? this.levelsDetail(c) : C.formatIncrements(c.increments) };
    }
    const c = this.customOf(key);
    if (!c) return null;
    let detail = c.type === "compteur" ? C.formatIncrements(c.increments) : c.type === "note" ? `/${fmtNum(c.echelle)}` : c.type === "liste" ? c.choix.join(" · ") : c.type === "niveaux" ? this.levelsDetail(c) : "";
    if (c.type === "compteur" && (c.orange || c.rouge)) detail += `  · alertes : ${c.orange ? fmtNum(c.orange) : "–"} / ${c.rouge ? fmtNum(c.rouge) : "–"}`;
    return { visible: c.visible !== false, emoji: c.emoji, titre: c.titre, type: TYPE_LABELS[c.type].split(" (")[0], detail, custom: true };
  }

  refresh() {
    for (const c of this.customs) if (!this.order.includes(c.id)) this.order.splice(this.order.includes("comm") ? this.order.indexOf("comm") : this.order.length, 0, c.id);
    this.list.replaceChildren();
    const keys = this.shownKeys();
    keys.forEach((key, i) => {
      const d = this.describe(key);
      if (!d) return;
      this.list.append(h("div", { class: "item" + (d.visible ? "" : " off") },
        h("input", { type: "checkbox", checked: d.visible, "aria-label": "Afficher", style: { width: "22px", height: "22px", minHeight: 0 }, onchange: () => this.toggle(key) }),
        h("div", { style: { width: "34px", textAlign: "center", fontSize: "1.3em" } }, d.emoji),
        h("div", { class: "t", onclick: () => this.edit(key), style: { cursor: "pointer" } }, d.titre, h("small", {}, `${d.type}${d.detail ? " — " + d.detail : ""}`)),
        h("button", { class: "btn small", type: "button", onclick: () => this.edit(key) }, "Modifier"),
        h("button", { class: "btn icon small", type: "button", disabled: i === 0, "aria-label": "Monter", onclick: () => this.move(key, -1) }, "↑"),
        h("button", { class: "btn icon small", type: "button", disabled: i === keys.length - 1, "aria-label": "Descendre", onclick: () => this.move(key, 1) }, "↓"),
        d.custom ? h("button", { class: "btn icon small danger", type: "button", "aria-label": "Supprimer", onclick: () => this.remove(key) }, "🗑") : null));
    });
  }

  addCustom(col) {
    this.customs.push(col);
    if (!this.order.includes(col.id)) this.order.splice(this.order.includes("comm") ? this.order.indexOf("comm") : this.order.length, 0, col.id);
  }

  add() {
    columnEditor(this.app, { type: "compteur", increments: [-1, 1], echelle: 10 }, (col) => {
      col.id = C.newId(); col.visible = true;
      col = C.sanitizeColumn(col);
      this.addCustom(col);
      this.refresh();
    });
  }

  presets() {
    const byPreset = Object.fromEntries(this.customs.map((c) => [c.preset, c]));
    const checks = C.PRESETS.map((p) => h("input", { type: "checkbox", checked: p.id in byPreset && byPreset[p.id].visible !== false }));
    const ctl = modal({ title: "Suggestions de colonnes", body: [
      h("p", { class: "hint" }, "Cochez les colonnes à ajouter au tableau. Décocher une colonne la masque sans perdre les valeurs déjà saisies."),
      C.PRESETS.map((p, i) => {
        const kind = TYPE_LABELS[p.type].split(" (")[0];
        const extra = p.type === "compteur" ? ` — ${C.formatIncrements(p.increments)}` : p.type === "note" ? ` — /${fmtNum(p.echelle)}` : p.type === "liste" ? ` — ${p.choix.length} choix` : "";
        return h("label", { class: "check", style: { alignItems: "flex-start" } }, checks[i], h("span", {}, `${p.emoji}  ${p.titre}`, h("div", { class: "hint", style: { margin: 0 } }, `${kind}${extra} · ${p.description}`)));
      })],
    actions: [{ label: "Annuler" }, { label: "Appliquer", kind: "primary", onClick: () => {
      C.PRESETS.forEach((p, i) => {
        const col = byPreset[p.id];
        if (col) col.visible = checks[i].checked; else if (checks[i].checked) this.addCustom(C.fromPreset(p));
      });
      this.refresh();
    } }] });
    return ctl;
  }

  edit(key) {
    if (key in C.BASE) {
      const cfg = this.baseCfg(key);
      columnEditor(this.app, cfg, (out) => {
        const d = C.BASE[key], over = {};
        if (out.titre !== d.titre && key !== "notes") over.titre = out.titre;
        if (out.emoji !== d.emoji) over.emoji = out.emoji;
        if (!cfg.visible) over.visible = false;
        this.base[key] = over;
        this.refresh();
      }, { base: key });
    } else if (key in C.BUILTINS) {
      const cfg = this.builtinCfg(key);
      columnEditor(this.app, cfg, (out) => {
        const b = C.BUILTINS[key], over = {};
        if (out.titre !== b.titre) over.titre = out.titre;
        if (out.emoji !== b.emoji) over.emoji = out.emoji;
        if (out.increments && out.increments.length && JSON.stringify(out.increments) !== JSON.stringify(b.increments.map(Number))) over.increments = out.increments;
        if (C.GRADE_KEYS.includes(key)) {  // niveaux et règle : seulement ce qui s'écarte des valeurs par défaut
          if (JSON.stringify(out.niveaux) !== JSON.stringify(C.DEFAULT_LEVELS)) over.niveaux = out.niveaux;
          if (out.regle !== "periode") over.regle = out.regle;
          if (out.x !== 3) over.x = out.x;
        }
        if (cfg.visible !== C.builtinVisible(key)) over.visible = cfg.visible;
        this.builtin[key] = over;
        this.refresh();
      }, { builtin: key });
    } else {
      const col = this.customOf(key);
      columnEditor(this.app, col, (out) => { const c = C.sanitizeColumn(out); for (const k of Object.keys(col)) delete col[k]; Object.assign(col, c); this.refresh(); });
    }
  }

  toggle(key) {
    if (C.ALWAYS_VISIBLE.has(key)) { this.err.textContent = "La colonne « Nom » ne peut pas être masquée : elle identifie l'élève."; this.refresh(); return; }
    this.err.textContent = "";
    if (key in C.BASE || key in C.BUILTINS) {
      const store = key in C.BASE ? this.base : this.builtin;
      const over = store[key] || (store[key] = {});
      const dflt = key in C.BUILTINS ? C.builtinVisible(key) : true;
      const shown = over.visible !== undefined ? !!over.visible : dflt;
      if (!shown === dflt) delete over.visible; else over.visible = !shown;
    } else {
      const col = this.customOf(key);
      col.visible = !(col.visible !== false);
    }
    this.refresh();
  }

  move(key, step) {
    const shown = this.shownKeys(), j = shown.indexOf(key) + step;
    if (j >= 0 && j < shown.length) {  // on échange avec la colonne voisine de la liste (les colonnes cachées ne bougent pas)
      const a = this.order.indexOf(key), b = this.order.indexOf(shown[j]);
      [this.order[a], this.order[b]] = [this.order[b], this.order[a]];
      this.refresh();
    }
  }

  async remove(key) {
    const col = this.customOf(key);
    if (!col) return;
    if (await confirmDialog(`Supprimer la colonne « ${col.titre} » ?\n\nLes valeurs déjà saisies restent enregistrées : si vous recréez la colonne à partir de la même suggestion, elles réapparaissent. Pour simplement la cacher, décochez-la.`, { okLabel: "Supprimer", danger: true, title: "Supprimer la colonne" })) {
      this.customs.splice(this.customs.indexOf(col), 1);
      this.order = this.order.filter((k) => k !== key);
      this.refresh();
    }
  }

  /** Écrit la configuration dans les données. Retourne false si l'onglet contient une erreur (rien n'est alors modifié). */
  async apply() {
    const app = this.app, st = app.state.settings;
    let newScale;
    try { newScale = parseNumber(this.scale.value); if (newScale <= 0) throw new Error(); } catch (e) { this.err.textContent = "Le barème des notes doit être un nombre positif (par exemple 20 ou 10)."; return false; }
    const classes = app.state.classes;
    if (Math.abs(newScale - this.origScale) > 1e-9 && classes.some((c) => c.eleves.some((s) => Object.values(s.notes).some((v) => v !== null && v !== undefined)))) {
      if (await confirmDialog(`Les notes passent de /${fmtNum(this.origScale)} à /${fmtNum(newScale)}.\n\nConvertir les notes déjà saisies (×${fmtNum(newScale / this.origScale)}) ?\nOui : 14 sur 20 devient 7 sur 10. Non : les valeurs restent telles quelles.`, { title: "Barème des notes", okLabel: "Convertir", cancelLabel: "Ne pas convertir" })) M.rescaleNotes(app.state, this.origScale, newScale);
    }
    for (const c of this.customs) {
      const old = this.origNoteScales[c.id];
      if (c.type === "note" && old && Math.abs(c.echelle - old) > 1e-9 && classes.some((k) => k.eleves.some((s) => Object.values((s.extra || {})[c.id] || {}).some((v) => typeof v === "number")))) {
        if (await confirmDialog(`« ${c.titre} » passe de /${fmtNum(old)} à /${fmtNum(c.echelle)}.\n\nConvertir les valeurs déjà saisies ?`, { title: "Barème de la colonne", okLabel: "Convertir", cancelLabel: "Ne pas convertir" })) M.rescaleExtra(app.state, c.id, old, c.echelle);
      }
    }
    // nombre de niveaux modifié : proposer de convertir les notes déjà attribuées (le meilleur niveau reste le meilleur)
    const now = Object.fromEntries(C.gradeColumns({ builtin: this.builtin, colonnes: this.customs }, false).map((g) => [g.event, g]));
    for (const [event, g] of Object.entries(now)) {
      const old = this.origLevels[event], neu = g.niveaux.length;
      if (old && old !== neu && classes.some((k) => k.eleves.some((s) => s.events.some((e) => e.type === event && e.v >= 1)))) {
        if (await confirmDialog(`« ${g.titre} » passe de ${old} à ${neu} niveaux.\n\nConvertir les notes déjà attribuées (le meilleur niveau reste le meilleur, le moins bon reste le moins bon) ?\nNon : les valeurs restent telles quelles.`, { title: "Nombre de niveaux", okLabel: "Convertir", cancelLabel: "Ne pas convertir" })) M.rescaleLevels(app.state, event, old, neu);
      }
    }
    st.echelle = newScale;
    st.builtin = Object.fromEntries(Object.entries(this.builtin).filter(([, v]) => v && Object.keys(v).length));
    st.base = Object.fromEntries(Object.entries(this.base).filter(([, v]) => v && Object.keys(v).length));
    st.colonnes = clone(this.customs);
    st.ordre = [...this.order];
    this.origScale = newScale;
    this.origNoteScales = Object.fromEntries(this.customs.filter((c) => c.type === "note").map((c) => [c.id, c.echelle]));
    this.origLevels = Object.fromEntries(Object.entries(now).map(([e, g]) => [e, g.niveaux.length]));
    return true;
  }
}

// ---------------------------------------------------------------- fenêtre des préférences
const TAB_LABELS = { affichage: "Affichage", colonnes: "Colonnes", alertes: "Alertes", sauvegardes: "Sauvegardes", securite: "Sécurité et bulletins" };
const TAB_OF = { "Affichage": "affichage", "Alertes": "alertes", "Sauvegardes": "sauvegardes", "Sécurité et bulletins": "securite" };

export function openPrefs(app, start = "affichage") {
  const cols = new ColumnsTab(app);
  const controls = {};  // clé du réglage -> champ
  const panels = {};
  const schemaTabs = [...new Set(PR.SCHEMA.map((f) => TAB_OF[f.tab]))];
  for (const tab of schemaTabs) {
    const groups = [...new Set(PR.SCHEMA.filter((f) => TAB_OF[f.tab] === tab).map((f) => f.group))];
    panels[tab] = h("div", {}, groups.map((group) => [h("h4", { style: { margin: "16px 0 6px" } }, group),
      PR.SCHEMA.filter((f) => f.group === group).map((f) => {
        let input;
        if (f.type === "choice") input = select(f.options, app.values[f.key]);
        else input = h("input", { type: "text", inputMode: "decimal", value: String(app.values[f.key]).replace(".", ","), style: { textAlign: "center" } });
        controls[f.key] = input;
        return h("div", { class: "settingrow" }, h("label", {}, f.label), f.type === "choice" ? input : h("div", {}, input, f.unit ? h("div", { class: "unit" }, f.unit) : null));
      })]));
  }
  panels.colonnes = cols.el;
  const order = ["affichage", "colonnes", "alertes", "sauvegardes", "securite"];
  const holder = h("div", { class: "body" });
  const tabs = h("div", { class: "tabs", role: "tablist" });
  const show = (name) => {
    for (const b of tabs.children) b.setAttribute("aria-selected", String(b.dataset.tab === name));
    holder.replaceChildren(panels[name]);
  };
  for (const name of order) tabs.append(h("button", { type: "button", role: "tab", dataset: { tab: name }, onclick: () => show(name) }, TAB_LABELS[name]));

  const ctl = modal({ title: "Préférences", size: "wide", body: null, actions: [
    { label: "Valeurs par défaut", left: true, close: false, onClick: async () => {
      if (await confirmDialog("Revenir aux réglages par défaut ?\n(Les colonnes que vous avez ajoutées sont conservées.)", { title: "Préférences" })) { await app.setPrefs({ ...PR.defaults(), affichage: "normal" }); ctl.close(); app.requestRender(); }
    } },
    { label: "Annuler" },
    { label: "Enregistrer", kind: "primary", close: false, onClick: async () => {
      if (!(await cols.apply())) { show("colonnes"); return; }
      const before = app.values.periodes;
      const values = Object.fromEntries(Object.entries(controls).map(([k, el]) => [k, el.value]));
      await app.setPrefs(values);
      app.commit();  // configuration des colonnes : une seule modification annulable
      await app.vault.prune(app.values.backupKeepRecent, app.values.backupKeepDays);
      ctl.close();
      if (app.values.periodes !== before) toast(app.values.periodes === "semestres" ? "Découpage en semestres : la période 1 devient S1, la période 2 devient S2. Les données de la 3ᵉ période sont conservées." : "Découpage en trimestres : S1 devient T1, S2 devient T2.");
    } }] });
  ctl.el.insertBefore(tabs, ctl.body);
  ctl.body.replaceWith(holder);
  ctl.body = holder;
  show(start);
  return ctl;
}
