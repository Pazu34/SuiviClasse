// Colonnes du tableau : colonnes intégrées (réglables) et colonnes personnalisées. Port de suiviclasse/columns.py.
// La configuration est enregistrée dans les données chiffrées (state.settings) : voir la description détaillée dans columns.py.
import { bank as appreciationBank } from "./appreciation.js";
import { EMOJIS, PRESETS } from "./columns_data.js";
import { cps, pyFloat, pyRound } from "./util.js";

export { EMOJIS, PRESETS };

export const DEFAULT_SCALE = 20;
export const MAX_INCREMENTS = 6;
export const MAX_CHOICES = 20, MAX_CHOICE_LEN = 40;
export const TYPES = [["compteur", "Compteur (boutons + / −)"], ["note", "Note"], ["texte", "Texte"],
  ["liste", "Menu déroulant"], ["coche", "Case à cocher"], ["niveaux", "Niveaux par séance (2 à 5)"]];
export const MIN_LEVELS = 2, MAX_LEVELS = 5, MAX_LEVEL_LEN = 20;
export const DEFAULT_LEVELS = ["A", "B", "C", "D", "E"];
export const RULES = [["periode", "Moyenne des notes du trimestre"],
  ["annee", "Moyenne des notes depuis le début de l'année"],
  ["dernieres_periode", "Moyenne des X dernières notes du trimestre"],
  ["dernieres_annee", "Moyenne des X dernières notes de l'année"]];
export const MAX_X = 99;

export const BUILTINS = {
  qualSeance: { titre: "Travail en séance", court: "Séance", emoji: "📚", increments: [], lettres: true },
  qualMaison: { titre: "Travail à la maison", court: "Maison", emoji: "🏠", increments: [], lettres: true },
  seancePlus: { titre: "Séance +", court: "Séance +", emoji: "👍", increments: [0.5, 1], visible: false },
  seanceMoins: { titre: "Séance −", court: "Séance −", emoji: "👎", increments: [-0.5, -1], visible: false },
  travail: { titre: "Travail non fait", court: "Travail", emoji: "📝", increments: [-1, 1], visible: false },
  oubli: { titre: "Oubli matériel", court: "Oublis", emoji: "🎒", increments: [-1, 1] },
};
export const BUILTIN_ORDER = ["qualSeance", "qualMaison", "seancePlus", "seanceMoins", "travail", "oubli"];
export const GRADE_KEYS = ["qualSeance", "qualMaison"];
export const BUILTIN_EVENT = { qualSeance: "qualSeance", qualMaison: "qualMaison", seancePlus: "seance", seanceMoins: "seance",
  travail: "travail", oubli: "oubli" };

export const BASE = {
  numero: { titre: "n°", court: "n°", emoji: "" },
  nom: { titre: "Nom", court: "Nom", emoji: "" },
  prenom: { titre: "Prénom", court: "Prénom", emoji: "" },
  infos: { titre: "Infos (PAI…)", court: "Infos", emoji: "" },
  notes: { titre: "Notes", court: "Notes", emoji: "" },
  comm: { titre: "Commentaire bulletin", court: "Commentaire bulletin", emoji: "" },
  mots: { titre: "Mots-clés", court: "Mots-clés", emoji: "🏷" },
  fiche: { titre: "", court: "", emoji: "📝" },
};
export const BASE_ORDER = ["numero", "nom", "prenom", "infos", "notes", "mots", "comm", "fiche"];
export const DEFAULT_ORDER = ["numero", "nom", "prenom", "infos", "notes", "qualSeance", "qualMaison", "seancePlus", "seanceMoins", "travail",
  "oubli", "mots", "comm", "fiche"];
export const ALWAYS_VISIBLE = new Set(["nom"]);

const collapse = (s) => String(s).trim().split(/\s+/).filter(Boolean).join(" ");
const truthy = (v) => v !== undefined && v !== null && v !== "" && v !== false && v !== 0 && !(Array.isArray(v) && !v.length);
const splitLines = (text) => String(text).split(/[\n;]/);

// ---------------------------------------------------------------- menus déroulants
export function parseChoices(text) {
  const items = Array.isArray(text) ? text : splitLines(text);
  const out = [];
  for (const item of items) {
    const c = cps(collapse(item), 0, MAX_CHOICE_LEN);
    if (c && !out.includes(c)) out.push(c);
  }
  return out.slice(0, MAX_CHOICES);
}

// ---------------------------------------------------------------- niveaux et règle de la note finale
export function parseLevels(items) {
  items = Array.isArray(items) ? items : splitLines(items);
  const out = [];
  for (const item of items) {
    const name = cps(collapse(item), 0, MAX_LEVEL_LEN);
    if (name && !out.some((o) => o.toLowerCase() === name.toLowerCase())) out.push(name);
  }
  return out.length >= MIN_LEVELS ? out.slice(0, MAX_LEVELS) : [...DEFAULT_LEVELS];
}

export function parseRule(regle, x) {
  regle = RULES.some(([k]) => k === regle) ? regle : "periode";
  let n = Math.trunc(pyFloat(String(x).replace(",", ".")));
  if (!Number.isFinite(n)) n = 3;
  return [regle, n ? Math.min(MAX_X, Math.max(1, n)) : 3];
}

export function ruleLabel(regle, x, word = "trimestre") {
  return RULES.find(([k]) => k === regle)[1].replaceAll("trimestre", word).replace(" X ", ` ${x} `);
}

export function gradeCfg(cfg) {
  const [regle, x] = parseRule(cfg.regle, cfg.x);
  return { niveaux: parseLevels(truthy(cfg.niveaux) ? cfg.niveaux : DEFAULT_LEVELS), regle, x };
}

// ---------------------------------------------------------------- incréments
const NUM = /([+\-−–]?)\s*(\d+(?:[.,]\d+)?)/g;

export function parseIncrements(text, sign = null) {
  const out = [];
  for (const m of String(text).matchAll(NUM)) {
    let v = pyRound(parseFloat(m[2].replace(",", ".")) * 100) / 100;
    if (v === 0) continue;
    v = ["-", "−", "–"].includes(m[1]) ? -v : v;
    if (sign) v = Math.abs(v) * sign;
    if (!out.includes(v)) out.push(v);
  }
  return out.slice(0, MAX_INCREMENTS);
}

function fmt(n) {
  n = pyRound(Math.abs(Number(n)) * 100) / 100;
  return String(n).replace(".", ",");
}

export function incrementLabel(v, symbolic = false) {
  if (symbolic && Math.abs(v) === 1) return v > 0 ? "+" : "−";
  return (v > 0 ? "+" : "−") + fmt(v);
}

export const formatIncrements = (values) => values.map((v) => incrementLabel(v)).join(" ; ");

// ---------------------------------------------------------------- configuration
export function builtinVisible(key) { return BUILTINS[key].visible !== false; }

export function builtin(settings, key, short = false) {
  const base = BUILTINS[key];
  const over = ((settings.builtin || {})[key]) || {};
  const incs = truthy(over.increments) ? over.increments : base.increments;
  const out = {
    key,
    titre: over.titre || (short ? base.court : base.titre),
    emoji: "emoji" in over ? over.emoji : base.emoji,
    increments: incs.map(Number),
    visible: Boolean("visible" in over ? over.visible : builtinVisible(key)),
    type: GRADE_KEYS.includes(key) ? "niveaux" : "compteur",
  };
  if (GRADE_KEYS.includes(key)) Object.assign(out, gradeCfg(over));
  return out;
}

export function base(settings, key, short = false) {
  const d = BASE[key];
  const over = ((settings.base || {})[key]) || {};
  return {
    key,
    titre: "titre" in over ? over.titre : (short ? d.court : d.titre),
    emoji: "emoji" in over ? over.emoji : d.emoji,
    visible: ALWAYS_VISIBLE.has(key) || over.visible !== false,
    type: "base",
  };
}

export function order(settings, customIds) {
  const known = [...DEFAULT_ORDER, ...customIds.filter((i) => !DEFAULT_ORDER.includes(i))];
  const out = [];
  for (const k of settings.ordre || []) if (known.includes(k) && !out.includes(k)) out.push(k);
  for (const k of DEFAULT_ORDER) {
    if (out.includes(k)) continue;
    const i = DEFAULT_ORDER.indexOf(k);
    const prev = DEFAULT_ORDER.slice(0, i).reverse().find((p) => out.includes(p));
    out.splice(prev !== undefined ? out.indexOf(prev) + 1 : 0, 0, k);
  }
  for (const k of customIds) {
    if (!out.includes(k)) out.splice(out.includes("comm") ? out.indexOf("comm") : out.length, 0, k);
  }
  return out;
}

// ---------------------------------------------------------------- actions du menu d'un titre de colonne (voir suiviclasse/columns.py)
export const PIN_DEFAULTS = { aucune: [], nom: ["numero", "nom"], prenom: ["numero", "nom", "prenom"], infos: ["numero", "nom", "prenom", "infos"] };

/** Clé de configuration d'une colonne affichée : les colonnes T1, T2, T3 forment un seul groupe, « notes ». */
export const configKey = (kind, key) => (kind === "note" ? "notes" : key);

function entry(settings, key) {
  if (key in BASE) { settings.base = settings.base || {}; return (settings.base[key] = settings.base[key] || {}); }
  if (key in BUILTINS) { settings.builtin = settings.builtin || {}; return (settings.builtin[key] = settings.builtin[key] || {}); }
  return (settings.colonnes || []).find((r) => r && typeof r === "object" && r.id === key) || null;
}

/** Affiche ou masque une colonne (le nom reste toujours affiché). Retourne true si c'est fait. */
export function setVisible(settings, key, visible) {
  if (!visible && ALWAYS_VISIBLE.has(key)) return false;
  const e = entry(settings, key);
  if (!e) return false;
  e.visible = !!visible;
  return true;
}

export function setEmoji(settings, key, emoji) {
  const e = entry(settings, key);
  if (!e) return false;
  e.emoji = emoji;
  return true;
}

/** Colonnes masquées : [[clé, titre]], dans l'ordre d'affichage. */
export function hiddenColumns(settings) {
  const cs = customs(settings), out = [];
  for (const key of order(settings, cs.map((c) => c.id))) {
    const c = key in BASE ? base(settings, key) : key in BUILTINS ? builtin(settings, key) : cs.find((x) => x.id === key);
    if (c && !c.visible) out.push([key, c.titre || key]);
  }
  return out;
}

/** Colonnes maintenues au début du tableau, dans l'ordre : celles de l'utilisateur, sinon celles du réglage de départ. */
export function pinnedKeys(settings, defaultPref = "prenom") {
  const known = order(settings, customs(settings).map((c) => c.id));
  const wanted = Array.isArray(settings.epingles) ? settings.epingles.filter((k) => known.includes(k)) : (PIN_DEFAULTS[defaultPref] || PIN_DEFAULTS.prenom).filter((k) => known.includes(k));
  return known.filter((k) => wanted.includes(k));
}

function reposition(settings, key, pins, keepPlace = false) {
  const current = order(settings, customs(settings).map((c) => c.id));
  const rest = current.filter((k) => k !== key);
  const pos = pins.length ? Math.max(...pins.filter((p) => rest.includes(p)).map((p) => rest.indexOf(p))) + 1 : keepPlace ? current.indexOf(key) : 0;
  rest.splice(pos, 0, key);
  settings.ordre = rest;
}

/** Maintient la colonne au début du tableau : elle se place juste après les colonnes déjà épinglées. */
export function pin(settings, key, defaultPref = "prenom") {
  const pins = pinnedKeys(settings, defaultPref);
  if (pins.includes(key)) return;
  reposition(settings, key, pins);
  settings.epingles = [...pins, key];
}

/** La colonne n'est plus maintenue ; elle passe juste après les colonnes qui le restent. */
export function unpin(settings, key, defaultPref = "prenom") {
  const pins = pinnedKeys(settings, defaultPref).filter((p) => p !== key);
  reposition(settings, key, pins, true);
  settings.epingles = pins;
}

/** Enregistre un nouvel ordre après le déplacement de la colonne `moved` (déposée dans le bloc du début, elle est maintenue ; sortie, elle ne l'est plus). */
export function applyMove(settings, newOrder, moved, defaultPref = "prenom") {
  let pins = pinnedKeys(settings, defaultPref);
  const last = Math.max(-1, ...pins.filter((p) => p !== moved && newOrder.includes(p)).map((p) => newOrder.indexOf(p)));
  const i = newOrder.indexOf(moved);
  if (pins.includes(moved) && i > last) pins = pins.filter((p) => p !== moved);
  else if (!pins.includes(moved) && i < last) pins.push(moved);
  settings.ordre = newOrder;
  pins = newOrder.filter((k) => pins.includes(k));
  const dflt = pinnedKeys({ ...settings, epingles: null }, defaultPref);
  if ("epingles" in settings || pins.join() !== dflt.join()) settings.epingles = pins;
}

export const iconOnlyKeys = (settings) => (Array.isArray(settings.icones) ? settings.icones.filter((k) => typeof k === "string") : []);

export function setIconOnly(settings, key, on) {
  const keys = iconOnlyKeys(settings).filter((k) => k !== key);
  settings.icones = on ? [...keys, key] : keys;
}

export function scale(settings) {
  const v = pyFloat(truthy(settings.echelle) ? settings.echelle : DEFAULT_SCALE);
  if (!Number.isFinite(v)) return DEFAULT_SCALE;
  return v > 0 ? v : DEFAULT_SCALE;
}

export function sanitizeColumn(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw) || !truthy(raw.id)) return null;
  const typ = TYPES.some(([k]) => k === raw.type) ? raw.type : "compteur";
  const col = { id: String(raw.id), titre: cps(collapse(truthy(raw.titre) ? raw.titre : "Colonne"), 0, 40) || "Colonne",
    emoji: cps(String(truthy(raw.emoji) ? raw.emoji : ""), 0, 4), type: typ, visible: raw.visible !== false };
  if (truthy(raw.preset)) col.preset = String(raw.preset);
  // Les réglages propres à un type sont conservés même s'il n'est pas actif : revenir à un type précédent les retrouve.
  if (truthy(raw.increments) || typ === "compteur") {
    col.increments = (truthy(raw.increments) ? raw.increments : [-1, 1]).map(Number).slice(0, MAX_INCREMENTS);
    if (!col.increments.length) col.increments = [-1, 1];
  }
  for (const k of ["orange", "rouge"]) {
    const v = raw[k] !== undefined && raw[k] !== null && raw[k] !== "" ? pyFloat(raw[k]) : null;
    if (v !== null && Number.isFinite(v) && v > 0) col[k] = v;
  }
  if (truthy(raw.niveaux) || typ === "niveaux") Object.assign(col, gradeCfg(raw));
  if (truthy(raw.choix) || typ === "liste") col.choix = parseChoices(truthy(raw.choix) ? raw.choix : []);
  if (truthy(raw.echelle) || typ === "note") {
    col.echelle = truthy(raw.echelle) ? pyFloat(raw.echelle) : 10;
    if (!Number.isFinite(col.echelle) || col.echelle <= 0) col.echelle = 10;
  }
  return col;
}

export function customs(settings) {
  const out = [], seen = new Set();
  for (const raw of settings.colonnes || []) {
    const col = sanitizeColumn(raw);
    if (col && !seen.has(col.id)) { seen.add(col.id); out.push(col); }
  }
  return out;
}

export function newId() {
  const b = crypto.getRandomValues(new Uint8Array(3));
  return "c_" + Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
}

export function fromPreset(preset) {
  const col = Object.fromEntries(Object.entries(preset).filter(([k]) => k !== "description"));
  col.preset = preset.id;
  return sanitizeColumn(col);
}

/** Colonnes à niveaux (intégrées puis personnalisées) : {key, event, titre, emoji, niveaux, regle, x, visible}. */
export function gradeColumns(settings, visibleOnly = true) {
  const out = [];
  for (const key of GRADE_KEYS) out.push({ ...builtin(settings, key), event: BUILTIN_EVENT[key] });
  for (const col of customs(settings)) if (col.type === "niveaux") out.push({ ...col, key: col.id, event: col.id });
  return out.filter((c) => c.visible || !visibleOnly);
}

export const eventType = (settings, key) => BUILTIN_EVENT[key] || key;

export function typeLabel(settings, ev) {
  for (const key of ["travail", "oubli", ...GRADE_KEYS]) if (ev === key) return builtin(settings, key).titre;
  if (ev === "seance") return "Séance";
  for (const col of customs(settings)) if (col.id === ev) return col.titre;
  if (ev.startsWith("mot:")) {  // mot-clé noté pour l'appréciation de bulletin
    const key = ev.slice(4), m = appreciationBank(settings).mots.find((x) => x.id === key);
    return "Mot-clé : " + (m ? m.titre : key);
  }
  return ev;
}
