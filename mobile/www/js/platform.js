// Pont avec la plateforme : application Android (Capacitor) ou navigateur. Tout est facultatif : sans Capacitor (navigateur,
// tests), on retombe sur les mécanismes du navigateur.
import { b64encode, utf8 } from "./core/bytes.js";

const cap = () => (typeof window !== "undefined" ? window.Capacitor : undefined);
export const isNative = () => { const c = cap(); return !!(c && c.isNativePlatform && c.isNativePlatform()); };
const plugin = (name) => { const c = cap(); return c && c.Plugins ? c.Plugins[name] : undefined; };

/** Enregistre un fichier texte pour l'utilisateur : feuille de partage Android (Drive, Fichiers, courriel…) ou téléchargement. */
export async function shareFile(name, text, mime = "text/plain") {
  if (isNative() && plugin("Filesystem") && plugin("Share")) {
    try {
      const fs = plugin("Filesystem");
      const w = await fs.writeFile({ path: `export/${name}`, data: b64encode(utf8(text)), directory: "CACHE", recursive: true });
      await plugin("Share").share({ title: name, dialogTitle: "Enregistrer ou envoyer", files: [w.uri] });
      return "shared";
    } catch (e) {
      if (String(e && e.message || e).toLowerCase().includes("cancel")) return "cancelled";
      // repli : téléchargement ci-dessous
    }
  }
  const blob = new Blob([text], { type: mime + ";charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = name; document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
  return "downloaded";
}

export async function copyText(text) {
  try { await navigator.clipboard.writeText(text); return true; } catch (e) { /* repli */ }
  const ta = document.createElement("textarea");
  ta.value = text; ta.style.position = "fixed"; ta.style.opacity = "0";
  document.body.append(ta); ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
  ta.remove();
  return ok;
}

/** Choisit un fichier (sélecteur système) ; retourne {name, bytes} ou null. */
export function pickFile(accept = "") {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    if (accept) input.accept = accept;
    input.style.display = "none";
    input.addEventListener("change", async () => {
      const f = input.files && input.files[0];
      input.remove();
      resolve(f ? { name: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null);
    });
    input.addEventListener("cancel", () => { input.remove(); resolve(null); });
    document.body.append(input);
    input.click();
  });
}

/** Abonnements propres à Android : bouton retour, application mise en arrière-plan. */
export function onNative({ back, pause, resume }) {
  const app = plugin("App");
  if (app && app.addListener) {
    if (back) app.addListener("backButton", back);
    if (pause || resume) app.addListener("appStateChange", (s) => (s.isActive ? resume && resume() : pause && pause()));
  }
  document.addEventListener("visibilitychange", () => (document.hidden ? pause && pause() : resume && resume()));
  window.addEventListener("pagehide", () => pause && pause());
}

export function prefersDark() {
  return !!(window.matchMedia && window.matchMedia("(prefers-color-scheme: dark)").matches);
}

/** Empêche la mise en veille de l'écran pendant les séances (si le navigateur le permet). */
export async function keepAwake() {
  try { if (navigator.wakeLock) return await navigator.wakeLock.request("screen"); } catch (e) { /* facultatif */ }
  return null;
}
