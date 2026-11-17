// Aides de test : stockage sur disque (même dossier que le programme Python) et appels à Python.
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");

export class FsStorage {
  constructor(dir) { this.dir = dir; }
  _p(name) { return path.join(this.dir, ...name.split("/")); }
  async get(name) { try { return fs.readFileSync(this._p(name), "utf8"); } catch (e) { return null; } }
  async put(name, text) { fs.mkdirSync(path.dirname(this._p(name)), { recursive: true }); fs.writeFileSync(this._p(name), text, "utf8"); }
  async remove(name) { try { fs.unlinkSync(this._p(name)); } catch (e) { /* déjà absent */ } }
  async list(dir) {
    try { return fs.readdirSync(this._p(dir)).map((f) => `${dir}/${f}`); } catch (e) { return []; }
  }
}

export const tmpdir = () => fs.mkdtempSync(path.join(os.tmpdir(), "suivi-"));

/** Exécute du code Python (programme du PC importable) ; retourne la sortie JSON analysée. */
export function py(code, input = null) {
  const r = spawnSync("python3.12", ["-I", "-c", `import sys; sys.path.insert(0, ${JSON.stringify(ROOT)})\n${code}`],
                      { input: input === null ? undefined : JSON.stringify(input), encoding: "utf8", maxBuffer: 1 << 28 });
  if (r.status !== 0) throw new Error("Python a échoué :\n" + r.stderr);
  return r.stdout.trim() ? JSON.parse(r.stdout) : null;
}
