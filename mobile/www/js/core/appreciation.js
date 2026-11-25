// Assistant d'appréciation de bulletin : mots-clés notés en cours de période, phrases types, accords selon le genre.
// Port de suiviclasse/appreciation.py (voir ce fichier pour la description des données et la syntaxe des phrases types).
import { DEFAULT_BANK, FEM_NAMES, MASC_NAMES, PHRASE_FIXES } from "./appreciation_data.js";
import { isNumber } from "./exchange.js";
import { gradeColumns } from "./columns.js";
import { addEvent, gradeFinal, gradeLevel, removeLast, seance, total } from "./model.js";
import { norm, round2 } from "./util.js";

export const BAND_MINS = [0, 8, 10, 12, 14, 16];
export const BAND_TITLES = ["Moins de 8", "De 8 à 10", "De 10 à 12", "De 12 à 14", "De 14 à 16", "16 et plus"];
export const EVOLUTION_DELTA = 1.5;
export const KEYWORD_PREFIX = "mot:";
export const TONES = ["+", "-", "="];
// Conditions qui font apparaître un mot-clé tout seul (voir suiviclasse/appreciation.py)
export const AUTO_CHOICES = [
  ["oubli_orange", "Oublis de matériel : seuil orange atteint"], ["oubli_rouge", "Oublis de matériel : seuil rouge atteint"],
  ["travail_orange", "Travail non fait : seuil orange atteint"], ["travail_rouge", "Travail non fait : seuil rouge atteint"],
  ["seance_plus", "Séance + : seuil vert atteint (implication)"], ["seance_moins", "Séance − : seuil rouge atteint"],
  ["qualSeance_bon", "Travail en séance : bon niveau"], ["qualSeance_faible", "Travail en séance : niveau faible"],
  ["qualMaison_bon", "Travail à la maison : bon niveau"], ["qualMaison_faible", "Travail à la maison : niveau faible"],
];
export const AUTO_IDS = AUTO_CHOICES.map(([k]) => k);
export const REPEAT_MIN_STUDENTS = 3, REPEAT_MIN_WORDS = 4;
export const MAX_ABBR_LEN = 12, MAX_ABBR_TEXT = 120, MAX_VOCAB_LEN = 60, MIN_PREFIX = 2;

const clone = (x) => JSON.parse(JSON.stringify(x));
export const defaultBank = () => clone(DEFAULT_BANK);

const text = (v) => (typeof v === "string" ? v : "");
const collapse = (s) => s.split(/\s+/).filter(Boolean).join(" ");
const cut = (s, n) => Array.from(s).slice(0, n).join("");
const phrases = (raw) => (Array.isArray(raw) ? raw.filter((p) => typeof p === "string" && p.trim()).map(collapse).map((p) => (Object.prototype.hasOwnProperty.call(PHRASE_FIXES, p) ? PHRASE_FIXES[p] : p)) : []);

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
    mots.push({ id, titre, emoji: cut(text(m.emoji), 8), ton: TONES.includes(m.ton) ? m.ton : "=", auto: AUTO_IDS.includes(m.auto) ? m.auto : "", phrases: phrases(m.phrases) });
  }
  out.mots = mots;
  const merged = (key) => {
    const given = {};
    if (Array.isArray(raw[key])) for (const x of raw[key]) if (x && typeof x === "object" && !Array.isArray(x)) given[x.id] = x;
    return base[key].map((b) => ({ ...b, phrases: b.id in given ? phrases(given[b.id].phrases) : b.phrases }));
  };
  for (const key of ["resultats", "conclusions", "evolution", "pistes"]) out[key] = merged(key);
  out.conseils = Array.isArray(raw.conseils) ? raw.conseils.filter((c) => typeof c === "string" && c.trim()).map((c) => cut(collapse(c), 400)) : [...base.conseils];  // conseils de rédaction (liste vide : choix de l'utilisateur)
  // aide à la saisie : mots proposés (sans doublon, casse et accents ignorés) et abréviations (clé en lettres et chiffres, unique)
  const vocab = [], seenV = new Set();
  for (let w of Array.isArray(raw.vocabulaire) ? raw.vocabulaire : base.vocabulaire) {
    w = cut(collapse(text(w)), MAX_VOCAB_LEN);
    if (w && !seenV.has(norm(w))) { seenV.add(norm(w)); vocab.push(w); }
  }
  out.vocabulaire = vocab;
  const abbr = [], seenA = new Set();
  for (const a of Array.isArray(raw.abreviations) ? raw.abreviations : base.abreviations) {
    if (!a || typeof a !== "object" || Array.isArray(a)) continue;
    const key = cut(text(a.abr).toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ""), MAX_ABBR_LEN), texte = cut(collapse(text(a.texte)), MAX_ABBR_TEXT);
    if (key && texte && !seenA.has(key)) { seenA.add(key); abbr.push({ abr: key, texte }); }
  }
  out.abreviations = abbr;
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

// ---------------------------------------------------------------- aide à la saisie
/** Mots et expressions proposés pendant la frappe : le vocabulaire, puis les titres des mots-clés (sans doublon). */
export function completionPool(b) {
  const out = [], seen = new Set();
  for (const w of [...(b.vocabulaire || []), ...(b.mots || []).map((m) => m.titre.toLowerCase())]) {
    if (!seen.has(norm(w))) { seen.add(norm(w)); out.push(w); }
  }
  return out;
}

const upperFirst = (s) => (s ? Array.from(s)[0].toUpperCase() + Array.from(s).slice(1).join("") : s);
const isUpper = (c) => c !== c.toLowerCase();

/** [[nombre de caractères tapés à remplacer, texte proposé]] pour la fin du texte `before` (voir suiviclasse/appreciation.py : complete). */
export function complete(before, pool, limit = 4) {
  const runs = [...before.matchAll(/[\p{L}\p{N}]+/gu)].map((m) => [m.index, m.index + m[0].length]);
  if (!runs.length || runs[runs.length - 1][1] !== before.length) return [];
  const out = [], seen = new Set();
  for (const k of [3, 2, 1]) {
    if (runs.length < k) continue;
    const chain = runs.slice(-k);
    let ok = true;
    for (let i = 0; i < k - 1; i++) if (![" ", "'", "’", "-"].includes(before.slice(chain[i][1], chain[i + 1][0]))) ok = false;
    if (!ok) continue;
    const typed = before.slice(chain[0][0]), nt = norm(typed);
    if (nt.replace(/ /g, "").length < MIN_PREFIX) continue;
    for (const entry of pool) {
      const ne = norm(entry);
      if (ne.startsWith(nt) && ne !== nt && !seen.has(entry)) {
        seen.add(entry);
        out.push([Array.from(typed).length, isUpper(Array.from(typed)[0]) ? upperFirst(entry) : entry]);
        if (out.length >= limit) return out;
      }
    }
  }
  return out;
}

/** [nombre de caractères à remplacer, texte de remplacement] si le dernier mot tapé est une abréviation, sinon null. */
export function expandAbbreviation(before, abbrevs, prenom = "", genre = "", periodWord = "trimestre") {
  const m = before.match(/[\p{L}\p{N}]+$/u);
  if (!m) return null;
  const word = m[0];
  for (const a of abbrevs) {
    if (a.abr === word.toLowerCase()) {
      let texte = render(a.texte, prenom, genre, periodWord);
      if (texte && isUpper(Array.from(word)[0])) texte = upperFirst(texte);
      return [Array.from(word).length, texte];
    }
  }
  return null;
}

// ---------------------------------------------------------------- suggestions d'abréviations d'après les commentaires enregistrés
export const SUGGEST_LIMIT = 25, SUGGEST_MIN_DOCS = 3, SUGGEST_MIN_LEN = 7, SUGGEST_MAX_WORDS = 4;
const STOP = new Set(("le la les un une des du de d l et ou à a au aux en est sont ont il elle ils elles ce cet cette ces se sa son ses que qui ne pas "
  + "par pour sur dans avec sans mais donc or ni car y on nous vous je tu lui leur leurs ma mon mes ta ton tes si comme").split(" "));

function* clausesWords(text) {
  for (const clause of text.split(/[.!?…;:,()«»"\n\r]+/)) {
    const words = clause.toLowerCase().match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu);
    if (words) yield words;
  }
}

function abbreviationFor(text, taken) {
  const letters = (w) => norm(w).replace(/[^a-z0-9]/g, "");
  const words = text.split(" ").map(letters).filter(Boolean);
  if (!words.length) return null;
  let base, spare;
  if (words.length >= 2) { base = words.map((w) => w[0]).join(""); spare = words.join("").slice(words.length); }
  else {
    const w = words[0], cons = [...w.slice(1)].filter((c) => !"aeiouy0123456789".includes(c));
    base = w[0] + cons.slice(0, 2).join(""); spare = w.slice(base.length);
  }
  for (let k = 0; k <= spare.length; k++) {
    const key = base + spare.slice(0, k);
    if (key.length >= 2 && key.length <= 6 && !taken.has(key)) return key;
  }
  return null;
}

/** Abréviations à proposer d'après les commentaires `texts` (voir suiviclasse/appreciation.py : suggest_abbreviations). */
export function suggestAbbreviations(texts, existing = [], excludeWords = [], limit = SUGGEST_LIMIT) {
  const stopNames = new Set(excludeWords.map(norm)), docs = new Map(), corpus = new Set();
  texts.forEach((text, d) => {
    for (const words of clausesWords(text)) {
      for (const w of words) corpus.add(norm(w));
      for (let n = 1; n <= SUGGEST_MAX_WORDS; n++) {
        for (let i = 0; i + n <= words.length; i++) {
          const g = words.slice(i, i + n).join(" ");
          if (!docs.has(g)) docs.set(g, new Set());
          docs.get(g).add(d);
        }
      }
    }
  });
  const coveredText = existing.map((a) => " " + norm(a.texte) + " ");
  const cands = [];
  for (const [text, ds] of docs) {
    const ws = text.split(" ");
    if (ds.size < SUGGEST_MIN_DOCS || Array.from(text).length < SUGGEST_MIN_LEN || STOP.has(ws[0]) || STOP.has(ws[ws.length - 1])) continue;
    if (ws.some((w) => stopNames.has(norm(w))) || coveredText.some((c) => c.includes(" " + norm(text) + " "))) continue;
    cands.push([ds.size * Array.from(text).length, text, ds.size]);
  }
  cands.sort((a, b) => b[0] - a[0] || (a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0));
  const taken = new Set([...existing.map((a) => a.abr), ...STOP, ...corpus]), out = [];
  for (const [, text, n] of cands) {
    if (out.some((c) => (" " + c.texte + " ").includes(" " + text + " ") && c.docs * 1.25 >= n)) continue;
    const key = abbreviationFor(text, taken);
    if (key === null) continue;
    taken.add(key);
    out.push({ abr: key, texte: text, docs: n });
    if (out.length >= limit) break;
  }
  return out;
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

/** Conditions automatiques (AUTO_IDS) remplies par l'élève pour la période t. `values` : préférences (seuils d'alerte). */
export function autoHits(settings, values, student, t) {
  const hits = new Set();
  let n = total(student, "oubli", t);
  if (n >= values.oubliOrange) hits.add("oubli_orange");
  if (n >= values.oubliRouge) hits.add("oubli_rouge");
  n = total(student, "travail", t);
  if (n >= values.travailOrange) hits.add("travail_orange");
  if (n >= values.travailRouge) hits.add("travail_rouge");
  const [plus, moins] = seance(student, t);
  if (plus > 0 && plus >= values.seancePlusVert) hits.add("seance_plus");
  if (moins < 0 && moins <= -values.seanceMoinsRouge) hits.add("seance_moins");
  for (const g of gradeColumns(settings, false)) {
    if (g.key === "qualSeance" || g.key === "qualMaison") {
      const lvl = gradeLevel(gradeFinal(student, g, t), g.niveaux.length);
      if (lvl === "ok") hits.add(g.key + "_bon"); else if (lvl === "warn" || lvl === "bad") hits.add(g.key + "_faible");
    }
  }
  return hits;
}

/** Identifiants des mots-clés dont la condition automatique est remplie (dans l'ordre de la banque). */
export function autoKeywords(settings, values, student, t) {
  const hits = autoHits(settings, values, student, t);
  return bank(settings).mots.filter((m) => m.auto && hits.has(m.auto)).map((m) => m.id);
}

/** Rubriques de phrases types proposées pour l'élève et la période t (voir suiviclasse/appreciation.py : suggestions). */
export function suggestions(settings, student, t, scale = 20, values = null) {
  const b = bank(settings), out = [];
  const n = bandIndex(student.notes[String(t)], scale);
  const pick = (g, kind, extra = {}) => ({ kind, id: g.id, titre: g.titre, phrases: g.phrases, count: 0, ...extra });
  if (n !== null) out.push(pick(b.resultats[n], "resultats"));
  const [ev] = evolution(student, t, scale);
  if (ev) out.push(pick(b.evolution.find((x) => x.id === ev), "evolution"));
  const byId = new Map(b.mots.map((m) => [m.id, m]));
  const noted = keywords(student, t), kws = [...noted].sort((x, y) => y[1] - x[1]);  // tri stable : à égalité, l'ordre d'apparition
  for (const [k, count] of kws) {
    const m = byId.get(k);
    if (m) out.push(pick(m, "mot", { emoji: m.emoji, ton: m.ton, count, auto: false }));
  }
  if (values) {  // mots-clés détectés automatiquement et pas encore notés à la main
    const known = new Set(noted.map(([k]) => k));
    for (const k of autoKeywords(settings, values, student, t)) if (!known.has(k)) { const m = byId.get(k); out.push(pick(m, "mot", { emoji: m.emoji, ton: m.ton, count: 0, auto: true })); }
  }
  // piste de progrès : quand la note est inférieure à 14 sur 20 ou qu'un mot-clé négatif est noté (ou détecté)
  const negative = out.some((g) => g.kind === "mot" && g.ton === "-");
  if ((n !== null && n <= 3) || negative) out.push({ kind: "piste", id: "pistes", titre: b.pistes[0].titre, phrases: b.pistes[0].phrases, count: 0 });
  if (n !== null) out.push(pick(b.conclusions[n], "conclusion"));
  return out;
}

// ---------------------------------------------------------------- relecture de la classe
/** Phrases d'un texte (coupées après . ! ? …). */
export const sentences = (text) => text.split(/(?<=[.!?…])\s+/).map((s) => s.trim()).filter(Boolean);

/** Relecture des appréciations de la période t : [lignes, résumé] (voir suiviclasse/appreciation.py : review). */
export function review(cls, t, maxLen = 255) {
  const key = String(t);
  const texts = Object.fromEntries(cls.eleves.map((s) => [s.id, collapse(String(s.comms[key] === undefined || s.comms[key] === null ? "" : s.comms[key]))]));
  const count = new Map();
  for (const text of Object.values(texts)) {
    for (const sent of new Set(sentences(text).filter((x) => x.split(/\s+/).filter(Boolean).length >= REPEAT_MIN_WORDS).map(norm))) count.set(sent, (count.get(sent) || 0) + 1);
  }
  const words = (x) => x.split(/\s+/).filter(Boolean).length;
  const rows = cls.eleves.map((s) => {
    const text = texts[s.id], repeated = [];
    for (const sent of sentences(text)) if (words(sent) >= REPEAT_MIN_WORDS && (count.get(norm(sent)) || 0) >= REPEAT_MIN_STUDENTS && !repeated.includes(sent)) repeated.push(sent);
    const mine = new Set(s.prenom.split(/[\s-]+/).filter(Boolean));
    const found = new Set(text.match(/\p{L}+/gu) || []);
    const others = [];
    for (const o of cls.eleves) {
      const p = o.prenom.trim();
      if (o === s || Array.from(p).length < 3 || mine.has(p) || p.includes(" ") || p.includes("-")) continue;
      if (found.has(p) && !others.includes(p)) others.push(p);
    }
    const len = Array.from(text).length;
    return { id: s.id, nom: s.nom, prenom: s.prenom, note: s.notes[key] === undefined ? null : s.notes[key], texte: text, longueur: len, vide: !text, trop_long: len > maxLen, repetees: repeated, autres_prenoms: others };
  });
  const n = (f) => rows.filter(f).length;
  return [rows, { total: rows.length, vides: n((r) => r.vide), trop_longs: n((r) => r.trop_long), repetees: n((r) => r.repetees.length), prenoms: n((r) => r.autres_prenoms.length) }];
}
