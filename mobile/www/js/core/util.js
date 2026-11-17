// Utilitaires communs, avec les mêmes comportements que ceux de Python pour que les deux programmes calculent pareil.
import { randomBytes } from "./bytes.js";

/** round() de Python : arrondi « au pair » pour les moitiés exactes (2,5 -> 2 ; 3,5 -> 4). */
export function pyRound(x) {
  const f = Math.floor(x), d = x - f;
  if (d < 0.5) return f;
  if (d > 0.5) return f + 1;
  return f % 2 === 0 ? f : f + 1;
}

/** float() de Python : NaN si la valeur n'est pas un nombre valide (chaîne vide, texte parasite…). */
export function pyFloat(x) {
  if (typeof x === "number") return x;
  if (typeof x === "boolean") return x ? 1 : 0;
  const s = String(x).trim();
  return s === "" ? NaN : Number(s);
}

/** round(x, 2) de Python. */
export const round2 = (x) => pyRound(x * 100) / 100;

/** 14.5 -> « 14,5 » ; 3.0 -> « 3 » (exchange.fmt_num). */
export function fmtNum(n) {
  n = pyRound(Number(n) * 100) / 100;
  return (Number.isInteger(n) ? String(n) : String(n)).replace(".", ",");
}

/** Minuscules, sans accents, tirets/apostrophes/espaces ramenés à un espace (exchange.norm). */
export function norm(s) {
  s = String(s === null || s === undefined ? "" : s).normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase();
  return s.replace(/[-_'’\s]+/g, " ").trim();
}

/** Identifiant : 10 caractères hexadécimaux (secrets.token_hex(5)). */
export function uid() {
  return Array.from(randomBytes(5), (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Date UTC ISO à la milliseconde, terminée par Z (comme model.add_event). */
export const nowIso = () => new Date().toISOString();

/** str.isupper() de Python. */
export const isUpper = (s) => s !== s.toLowerCase() && s === s.toUpperCase();

/** str.title() de Python : première lettre de chaque mot en capitale, le reste en minuscules. */
export function title(s) {
  return s.replace(/\p{L}[\p{L}\p{M}]*/gu, (w) => { const c = Array.from(w); return c[0].toUpperCase() + c.slice(1).join("").toLowerCase(); });
}

/** Tranche de points de code (s[a:b] de Python, sans couper un pictogramme en deux). */
export const cps = (s, a, b) => Array.from(s).slice(a, b).join("");

/** Comparaison de deux clés de tri (tableaux de chaînes ou de nombres), comme les tuples de Python. */
export function cmp(a, b) {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] < b[i]) return -1;
    if (a[i] > b[i]) return 1;
  }
  return a.length - b.length;
}

export const clone = (x) => structuredClone(x);
export const sum = (xs) => xs.reduce((a, b) => a + b, 0);
