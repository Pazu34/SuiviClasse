// Coffre chiffré : le MÊME format de fichier que le programme du PC (suiviclasse/vault.py).
//
//   {"format":"suiviclasse","v":1,"kdf":{"alg":"scrypt","N":32768,"r":8,"p":1,"salt":"…"},"iv":"…","tag":"…","data":"…"}
//
// Clé = scrypt(mot de passe NFC, sel) ; chiffrement AES-256-GCM, l'en-tête (JSON compact) servant de donnée authentifiée.
// Un fichier « suivi.enc » créé sur le PC s'ouvre ici et inversement. Les archives sont des copies horodatées de ce fichier,
// avec les mêmes noms que sur le PC : « sauvegardes/suivi-AAAA-MM-JJ_HH-MM-SS-motif.enc ».
import { b64decode, b64encode, concat, randomBytes, unutf8, utf8 } from "./bytes.js";
import { deriveKey as defaultDerive } from "./kdf.js";

export const FILE = "suivi.enc";
export const ARCHIVE_DIR = "sauvegardes";
export const KDF = { N: 1 << 15, r: 8, p: 1 };
const ARCHIVE_RE = /^suivi-(\d{4})-(\d{2})-(\d{2})(?:_(\d{2})-(\d{2})-(\d{2}))?(?:-([a-z]+))?\.enc$/;

export class WrongPasswordError extends Error {
  constructor() { super("Mot de passe incorrect (ou fichier corrompu)."); this.code = "WRONG_PASSWORD"; }
}

export class NeedPasswordError extends Error {
  constructor() { super("Cette archive date d’un autre mot de passe."); this.code = "NEED_PASSWORD"; }
}

const headerBytes = (header) => utf8(JSON.stringify(header));  // JSON compact, comme Python (separators=(",", ":"))

async function aesKey(raw, usage) {
  return crypto.subtle.importKey("raw", raw, "AES-GCM", false, [usage]);
}

async function encrypt(key, salt, params, data) {
  const header = { format: "suiviclasse", v: 1, kdf: { alg: "scrypt", N: params.N, r: params.r, p: params.p, salt: b64encode(salt) } };
  const iv = randomBytes(12);
  const sealed = new Uint8Array(await crypto.subtle.encrypt(
    { name: "AES-GCM", iv, additionalData: headerBytes(header), tagLength: 128 }, await aesKey(key, "encrypt"), utf8(JSON.stringify(data))));
  const ct = sealed.subarray(0, sealed.length - 16), tag = sealed.subarray(sealed.length - 16);  // WebCrypto : texte chiffré puis étiquette
  return JSON.stringify({ ...header, iv: b64encode(iv), tag: b64encode(tag), data: b64encode(ct) });
}

async function decrypt(key, raw) {
  const header = { format: raw.format, v: raw.v, kdf: raw.kdf };
  try {
    const sealed = concat(b64decode(raw.data), b64decode(raw.tag));
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: b64decode(raw.iv), additionalData: headerBytes(header), tagLength: 128 }, await aesKey(key, "decrypt"), sealed);
    return JSON.parse(unutf8(new Uint8Array(plain)));
  } catch (e) {
    throw new WrongPasswordError();
  }
}

function parseRaw(text) {
  let raw;
  try { raw = JSON.parse(text); } catch (e) { throw new Error("Fichier de données non reconnu."); }
  if (!raw || raw.format !== "suiviclasse" || !raw.kdf) throw new Error("Fichier de données non reconnu.");
  return raw;
}

const kdfParams = (raw) => ({ params: { N: raw.kdf.N, r: raw.kdf.r, p: raw.kdf.p }, salt: b64decode(raw.kdf.salt) });
const pad = (n) => String(n).padStart(2, "0");

export class Vault {
  /** storage : { get(nom), put(nom, texte), remove(nom), list(dossier) } (voir storage.js) */
  constructor(storage, derive = defaultDerive) {
    this.storage = storage;
    this.derive = derive;
    this.key = this.salt = this.params = null;
  }

  async exists() { return (await this.storage.get(FILE)) !== null; }
  get unlocked() { return this.key !== null; }

  async create(password, data, onProgress) {
    if (await this.exists()) throw new Error("Un coffre existe déjà.");
    this.params = { ...KDF };
    this.salt = randomBytes(16);
    this.key = await this.derive(password, this.salt, this.params, onProgress);
    await this._write(data);
  }

  async unlock(password, onProgress) {
    const raw = parseRaw(await this.storage.get(FILE));
    const { params, salt } = kdfParams(raw);
    const key = await this.derive(password, salt, params, onProgress);
    const data = await decrypt(key, raw);
    this.key = key; this.salt = salt; this.params = params;
    return data;
  }

  async save(data) {
    if (!this.key) throw new Error("Coffre verrouillé.");
    await this._write(data);
  }

  async changePassword(oldPassword, newPassword, data, onProgress) {
    const old = await this.derive(oldPassword, this.salt, this.params, onProgress);
    if (!this.key || old.length !== this.key.length || old.some((b, i) => b !== this.key[i])) throw new WrongPasswordError();
    await this.snapshot("mdp");  // les archives antérieures gardent l'ancien mot de passe
    this.params = { ...KDF };
    this.salt = randomBytes(16);
    this.key = await this.derive(newPassword, this.salt, this.params, onProgress);
    await this._write(data);
  }

  lock() { this.key = null; }

  async _write(data) {
    await this.storage.put(FILE, await encrypt(this.key, this.salt, this.params, data));
  }

  /** Texte du fichier chiffré tel qu'il est enregistré (pour l'exporter vers le PC). */
  async fileText() { return this.storage.get(FILE); }

  /** Remplace le coffre par un fichier « suivi.enc » venu d'ailleurs (PC) : le mot de passe de CE fichier est exigé. */
  async replaceWithFile(text, password, onProgress) {
    const raw = parseRaw(text);
    const { params, salt } = kdfParams(raw);
    const key = await this.derive(password, salt, params, onProgress);
    const data = await decrypt(key, raw);
    if (await this.exists()) await this.snapshot("import");
    await this.storage.put(FILE, text);
    this.key = key; this.salt = salt; this.params = params;
    return data;
  }

  // ---------- archives ----------
  async snapshot(reason = "manuel") {
    const current = await this.storage.get(FILE);
    if (current === null) return null;
    const archives = await this.listArchives();
    if (archives.length && (await this.storage.get(`${ARCHIVE_DIR}/${archives[0].name}`)) === current) return null;
    const d = new Date();
    const name = `suivi-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}-${pad(d.getMinutes())}-${pad(d.getSeconds())}-${reason}.enc`;
    if ((await this.storage.get(`${ARCHIVE_DIR}/${name}`)) !== null) return null;  // même seconde, même motif
    await this.storage.put(`${ARCHIVE_DIR}/${name}`, current);
    return name;
  }

  /** Plus récentes d'abord : [{name, date, reason, size}]. */
  async listArchives() {
    const out = [];
    for (const full of await this.storage.list(ARCHIVE_DIR)) {
      const name = full.split("/").pop();
      const m = ARCHIVE_RE.exec(name);
      if (!m) continue;
      const [, y, mo, d, hh, mi, ss, reason] = m;
      const text = await this.storage.get(full);
      out.push({ name, reason: reason || "", size: text ? text.length : 0,
                 date: new Date(+y, +mo - 1, +d, +(hh || 0), +(mi || 0), +(ss || 0)) });
    }
    return out.sort((a, b) => (a.name < b.name ? 1 : a.name > b.name ? -1 : 0));
  }

  /** Garde les `recent` archives les plus récentes, plus la dernière de chacun des `days` jours précédents. */
  async prune(recent, days) {
    const archives = await this.listArchives();
    const keep = new Set(archives.slice(0, recent).map((a) => a.name));
    const seen = new Set();
    for (const a of archives.slice(recent)) {
      const day = a.name.slice(6, 16);
      if (!seen.has(day) && seen.size < days) { seen.add(day); keep.add(a.name); }
    }
    const removed = archives.filter((a) => !keep.has(a.name));
    for (const a of removed) await this.storage.remove(`${ARCHIVE_DIR}/${a.name}`);
    return removed.length;
  }

  async deleteArchive(name) {
    if (!ARCHIVE_RE.test(name)) throw new Error("Nom d’archive invalide.");
    await this.storage.remove(`${ARCHIVE_DIR}/${name}`);
  }

  async archiveText(name) {
    if (!ARCHIVE_RE.test(name)) throw new Error("Nom d’archive invalide.");
    return this.storage.get(`${ARCHIVE_DIR}/${name}`);
  }

  /** Déchiffre une archive. Sans mot de passe : clé courante si l'archive a été faite avec le même mot de passe. */
  async readArchive(name, password = null, onProgress) {
    const raw = parseRaw(await this.archiveText(name));
    const { params, salt } = kdfParams(raw);
    let key;
    if (password !== null) key = await this.derive(password, salt, params, onProgress);
    else if (this.key && this.salt && salt.length === this.salt.length && salt.every((b, i) => b === this.salt[i])) key = this.key;
    else throw new NeedPasswordError();
    return decrypt(key, raw);
  }
}
