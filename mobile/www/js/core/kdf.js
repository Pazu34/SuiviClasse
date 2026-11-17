// Dérivation de la clé : scrypt dans un Worker si possible (l'interface reste fluide), sinon dans le fil principal.
import { scrypt } from "./scrypt.js";

export async function deriveKey(password, salt, params, onProgress) {
  const pw = new TextEncoder().encode(password.normalize("NFC"));  // même normalisation que le programme du PC
  if (typeof Worker !== "undefined" && typeof location !== "undefined") {
    try {
      return await new Promise((resolve, reject) => {
        const w = new Worker(new URL("./scrypt-worker.js", import.meta.url), { type: "module" });
        w.onmessage = (e) => {
          if (e.data.progress !== undefined) { if (onProgress) onProgress(e.data.progress); return; }
          w.terminate();
          e.data.key ? resolve(e.data.key) : reject(new Error(e.data.error || "scrypt"));
        };
        w.onerror = (e) => { w.terminate(); reject(new Error("worker")); };
        w.postMessage({ password: pw, salt, N: params.N, r: params.r, p: params.p, dkLen: 32 });
      });
    } catch (e) { /* Worker indisponible : calcul direct ci-dessous */ }
  }
  return scrypt(pw, salt, params.N, params.r, params.p, 32, onProgress);
}
