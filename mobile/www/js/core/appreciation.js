// Assistant d'appréciation de bulletin : mots-clés notés en cours de période, phrases types, accords selon le genre.
// Port de suiviclasse/appreciation.py (voir ce fichier pour la description des données et la syntaxe des phrases types).
import { DEFAULT_BANK, FEM_NAMES, MASC_NAMES } from "./appreciation_data.js";
import { isNumber } from "./exchange.js";
import { addEvent, removeLast } from "./model.js";
import { norm, round2 } from "./util.js";

export const BAND_MINS = [0, 8, 10, 12, 14, 16];
export const BAND_TITLES = ["Moins de 8", "De 8 à 10", "De 10 à 12", "De 12 à 14", "De 14 à 16", "16 et plus"];
export const EVOLUTION_DELTA = 1.5;
export const KEYWORD_PREFIX = "mot:";
export const TONES = ["+", "-", "="];

const clone = (x) => JSON.parse(JSON.stringify(x));
export const defaultBank = () => clone(DEFAULT_BANK);

const text = (v) => (typeof v === "string" ? v : "");
const collapse = (s) => s.split(/\s+/).filter(Boolean).join(" ");
const cut = (s, n) => Array.from(s).slice(0, n).join("");
const phrases = (raw) => (Array.isArray(raw) ? raw.filter((p) => typeof p === "string" && p.trim()).map(collapse) : []);

/** Ramène n'importe quel objet à une banque valide (rubriques absentes = valeurs par défaut ; mots-clés de l'utilisateur). */
export function sanitizeBank(raw) {
  const base = defaultBank();
  raw = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
  const out = {}, seen = new Set(), mots = [];
  const src = Array.isArray(raw.mots) ? raw.mots : base.mots;
  for (const m of src) {
    if (!m || typeof m !== "object" || Array.isArray(m)) continue;
    const titre = cut(collapse(text(m.titre)), 40);
    const id = cut(text(m.id).toLowerCase().replace(/[^a-z0-9_]/g, ""), 30);
    if (!titre || !id || seen.has(id)) continue;
    seen.add(id);
    mots.push({ id, titre, emoji: cut(text(m.emoji), 8), ton: TONES.includes(m.ton) ? m.ton : "=", phrases: phrases(m.phrases) });
  }
  out.mots = mots;
  const merged = (key) => {
    const given = {};
    if (Array.isArray(raw[key])) for (const x of raw[key]) if (x && typeof x === "object" && !Array.isArray(x)) given[x.id] = x;
    return base[key].map((b) => ({ ...b, phrases: b.id in given ? phrases(given[b.id].phrases) : b.phrases }));
  };
  for (const key of ["resultats", "conclusions", "evolution"]) out[key] = merged(key);
  return out;
}

/** Banque de phrases en vigueur (celle des réglages, sinon celle par défaut). */
export function bank(settings) {
  const raw = settings && settings.appreciation;
  return raw && (typeof raw !== "object" || Object.keys(raw).length) ? sanitizeBank(raw) : defaultBank();
}

/** Identifiant libre pour un nouveau mot-clé, tiré de son titre. */
export function newKeywordId(titre, b) {
  const base = cut(norm(titre).replace(/[^a-z0-9]/g, ""), 20) || "mot";
  const used = new Set(b.mots.map((m) => m.id));
  let id = base, n = 2;
  while (used.has(id)) { id = `${base}${n}`; n++; }
  return id;
}

// ---------------------------------------------------------------- phrases et accords
export function render(template, prenom = "", genre = "", periodWord = "trimestre") {
  const fem = genre === "f";
  return template.replace(/\{([^{}]*)\}/g, (all, c) => {
    if (c === "prénom" || c === "prenom") return prenom;
    if (c === "période" || c === "periode") return periodWord;
    if (c === "il") return fem ? "elle" : "il";
    if (c === "Il") return fem ? "Elle" : "Il";
    if (c === "e") return fem ? "e" : "";
    if (c.includes("|")) { const parts = c.split("|"); return fem && parts.length > 1 ? parts[1] : parts[0]; }
    return all;
  });
}

// ---------------------------------------------------------------- genre
const GENRE_OF = new Map([...FEM_NAMES.map((n) => [norm(n), "f"]), ...MASC_NAMES.map((n) => [norm(n), "m"])]);

/** 'f' ou 'm' d'après le prénom (prénoms courants, premier prénom d'un prénom composé) ; '' si on ne sait pas. */
export function guessGenre(prenom) {
  const first = prenom ? norm(prenom).trim().split(/[\s-]+/)[0] : "";
  return GENRE_OF.get(first) || "";
}

/** Genre enregistré pour l'élève ('f' ou 'm'), sinon celui deviné d'après son prénom (peut être ''). */
export const genreOf = (student) => (student.genre === "f" || student.genre === "m" ? student.genre : guessGenre(student.prenom || ""));

// ---------------------------------------------------------------- mots-clés notés en cours de période
export const keywordEvents = (student, t) => student.events.filter((e) => e.type.startsWith(KEYWORD_PREFIX) && e.t === t);

/** [[identifiant, nombre de fois]] des mots-clés notés pendant la période t, dans l'ordre de première apparition. */
export function keywords(student, t) {
  const counts = new Map();
  const evs = keywordEvents(student, t).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  for (const e of evs) { const k = e.type.slice(KEYWORD_PREFIX.length); counts.set(k, (counts.get(k) || 0) + 1); }
  return [...counts];
}

export const addKeyword = (student, kwId, t) => addEvent(student, KEYWORD_PREFIX + kwId, t, 1);
export const removeKeyword = (student, kwId, t) => removeLast(student, KEYWORD_PREFIX + kwId, t);

/** Tranche de note (0 à 5) d'une note sur `scale`, ramenée sur 20 ; null si la note est absente ou particulière. */
export function bandIndex(note, scale = 20) {
  if (!isNumber(note) || !scale) return null;
  const r = note / scale * 20;
  let n = 0;
  BAND_MINS.forEach((m, i) => { if (r >= m) n = i; });
  return n;
}

/** [genre d'évolution ('hausse', 'baisse', 'stable') ou null, écart sur 20 ou null]. */
export function evolution(student, t, scale = 20) {
  if (t <= 1) return [null, null];
  const a = student.notes[String(t - 1)], b = student.notes[String(t)];
  if (!(isNumber(a) && isNumber(b)) || !scale) return [null, null];
  const d = round2((b - a) / scale * 20);
  return [d >= EVOLUTION_DELTA ? "hausse" : d <= -EVOLUTION_DELTA ? "baisse" : "stable", d];
}

/** Rubriques de phrases types proposées pour l'élève et la période t (voir suiviclasse/appreciation.py : suggestions). */
export function suggestions(settings, student, t, scale = 20) {
  const b = bank(settings), out = [];
  const n = bandIndex(student.notes[String(t)], scale);
  const pick = (g, kind, extra = {}) => ({ kind, id: g.id, titre: g.titre, phrases: g.phrases, count: 0, ...extra });
  if (n !== null) out.push(pick(b.resultats[n], "resultats"));
  const [ev] = evolution(student, t, scale);
  if (ev) out.push(pick(b.evolution.find((x) => x.id === ev), "evolution"));
  const byId = new Map(b.mots.map((m) => [m.id, m]));
  const kws = keywords(student, t).sort((x, y) => y[1] - x[1]);  // tri stable : à égalité, l'ordre d'apparition
  for (const [k, count] of kws) {
    const m = byId.get(k);
    if (m) out.push(pick(m, "mot", { emoji: m.emoji, ton: m.ton, count }));
  }
  if (n !== null) out.push(pick(b.conclusions[n], "conclusion"));
  return out;
}
