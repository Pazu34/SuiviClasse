// Stockage des fichiers du coffre (« suivi.enc », « sauvegardes/… », « preferences.json ») : des textes rangés par nom.
// IndexedDB dans le navigateur et dans la WebView Android (persistant, propre à l'application) ; mémoire pour les tests.

export class MemoryStorage {
  constructor() { this.files = new Map(); }
  async get(name) { return this.files.has(name) ? this.files.get(name) : null; }
  async put(name, text) { this.files.set(name, text); }
  async remove(name) { this.files.delete(name); }
  async list(dir) { return [...this.files.keys()].filter((k) => k.startsWith(dir + "/")); }
}

export class IdbStorage {
  constructor(dbName = "suiviclasse") {
    this.dbName = dbName;
    this.db = null;
  }

  async _open() {
    if (this.db) return this.db;
    this.db = await new Promise((resolve, reject) => {
      const req = indexedDB.open(this.dbName, 1);
      req.onupgradeneeded = () => req.result.createObjectStore("files");
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    if (navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    return this.db;
  }

  async _tx(mode, fn) {
    const db = await this._open();
    return new Promise((resolve, reject) => {
      const tx = db.transaction("files", mode);
      const result = fn(tx.objectStore("files"));
      tx.oncomplete = () => resolve(result.result);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  }

  async get(name) {
    const v = await this._tx("readonly", (s) => s.get(name));
    return v === undefined ? null : v;
  }

  async put(name, text) { await this._tx("readwrite", (s) => s.put(text, name)); }
  async remove(name) { await this._tx("readwrite", (s) => s.delete(name)); }

  async list(dir) {
    const keys = await this._tx("readonly", (s) => s.getAllKeys());
    return keys.filter((k) => k.startsWith(dir + "/"));
  }
}
