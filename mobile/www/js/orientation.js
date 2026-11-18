// Orientation de l'écran : « Automatique » (la tablette décide), « Paysage » ou « Portrait » (verrouillé, même si la rotation
// automatique d'Android est désactivée). Le choix est propre à l'appareil (il n'est pas enregistré dans les données).
// La mise en page suit toujours l'orientation réelle : <html data-orient="paysage|portrait">.
import { lockOrientation } from "./platform.js";

const KEY = "orientation";
export const MODES = ["auto", "paysage", "portrait"];
export const LABELS = { auto: "Automatique", paysage: "Paysage", portrait: "Portrait" };

export function getMode() {
  try { const v = localStorage.getItem(KEY); return MODES.includes(v) ? v : "auto"; } catch (e) { return "auto"; }
}

/** Orientation réellement affichée, d'après la taille de la fenêtre. */
export function current() { return window.innerWidth >= window.innerHeight ? "paysage" : "portrait"; }

export const nextMode = (m) => MODES[(MODES.indexOf(m) + 1) % MODES.length];

function sync() { document.documentElement.dataset.orient = current(); }

/** Applique le mode au système (verrouillage ou déverrouillage). */
export async function applyMode(mode = getMode()) {
  await lockOrientation(mode === "auto" ? null : mode);
  sync();
}

export async function setMode(mode) {
  if (!MODES.includes(mode)) mode = "auto";
  try { localStorage.setItem(KEY, mode); } catch (e) { /* stockage indisponible : le choix vaut pour cette session seulement */ }
  await applyMode(mode);
  return mode;
}

/** À appeler au démarrage : suit les rotations et réapplique le verrouillage choisi. onChange est appelé quand l'orientation réelle change. */
export function initOrientation(onChange) {
  let last = current();
  const update = () => {
    sync();
    if (current() !== last) { last = current(); if (onChange) onChange(last); }
  };
  window.addEventListener("resize", update);
  window.addEventListener("orientationchange", update);
  applyMode();
  return { reapply: () => applyMode() };
}
