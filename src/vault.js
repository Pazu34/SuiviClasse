'use strict';
// Coffre chiffré : un seul fichier « suivi.enc » dans le dossier de données.
// Clé dérivée du mot de passe avec scrypt, chiffrement AES-256-GCM (authentifié :
// toute modification du fichier ou mauvais mot de passe est détecté).
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

const FILE = 'suivi.enc';
const KDF = { N: 1 << 15, r: 8, p: 1 };
const MAXMEM = 256 * 1024 * 1024;
const ARCHIVE_DIR = 'sauvegardes';
// suivi-2026-10-30_15-42-10[-motif].enc  (ancien format : suivi-2026-10-30.enc)
const ARCHIVE_RE = /^suivi-(\d{4})-(\d{2})-(\d{2})(?:_(\d{2})-(\d{2})-(\d{2}))?(?:-([a-z]+))?\.enc$/;

class WrongPasswordError extends Error {
  constructor() { super('Mot de passe incorrect (ou fichier corrompu).'); this.code = 'WRONG_PASSWORD'; }
}

function deriveKey(password, salt, params) {
  return crypto.scryptSync(password.normalize('NFC'), salt, 32, { ...params, maxmem: MAXMEM });
}

function encrypt(key, salt, params, data) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const header = { format: 'suiviclasse', v: 1, kdf: { alg: 'scrypt', ...params, salt: salt.toString('base64') } };
  cipher.setAAD(Buffer.from(JSON.stringify(header)));
  const ct = Buffer.concat([cipher.update(JSON.stringify(data), 'utf8'), cipher.final()]);
  return JSON.stringify({ ...header, iv: iv.toString('base64'), tag: cipher.getAuthTag().toString('base64'), data: ct.toString('base64') });
}

class Vault {
  constructor(dir) {
    this.dir = dir;
    this.file = path.join(dir, FILE);
    this.key = null;
    this.salt = null;
    this.params = null;
  }

  exists() { return fs.existsSync(this.file); }
  get unlocked() { return this.key !== null; }

  create(password, data) {
    if (this.exists()) throw new Error('Un coffre existe déjà dans ce dossier.');
    fs.mkdirSync(this.dir, { recursive: true });
    this.params = { ...KDF };
    this.salt = crypto.randomBytes(16);
    this.key = deriveKey(password, this.salt, this.params);
    this._write(data);
  }

  unlock(password) {
    const raw = JSON.parse(fs.readFileSync(this.file, 'utf8'));
    if (raw.format !== 'suiviclasse') throw new Error('Fichier de données non reconnu.');
    const params = { N: raw.kdf.N, r: raw.kdf.r, p: raw.kdf.p };
    const salt = Buffer.from(raw.kdf.salt, 'base64');
    const key = deriveKey(password, salt, params);
    const header = { format: raw.format, v: raw.v, kdf: raw.kdf };
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(raw.iv, 'base64'));
      d.setAAD(Buffer.from(JSON.stringify(header)));
      d.setAuthTag(Buffer.from(raw.tag, 'base64'));
      const pt = Buffer.concat([d.update(Buffer.from(raw.data, 'base64')), d.final()]);
      this.key = key; this.salt = salt; this.params = params;
      return JSON.parse(pt.toString('utf8'));
    } catch (e) {
      throw new WrongPasswordError();
    }
  }

  save(data) {
    if (!this.key) throw new Error('Coffre verrouillé.');
    this._write(data);
  }

  changePassword(oldPassword, newPassword, data) {
    deriveCheck(this, oldPassword);
    this.snapshot('mdp'); // les archives antérieures gardent l'ancien mot de passe
    this.params = { ...KDF };
    this.salt = crypto.randomBytes(16);
    this.key = deriveKey(newPassword, this.salt, this.params);
    this._write(data);
  }

  lock() { if (this.key) this.key.fill(0); this.key = null; }

  _write(data) {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, encrypt(this.key, this.salt, this.params, data));
    fs.renameSync(tmp, this.file);
  }

  /* ---------- archives ---------- */
  get archiveDir() { return path.join(this.dir, ARCHIVE_DIR); }

  // Copie le fichier chiffré tel quel (aucune clé nécessaire). Ne fait rien si rien n'a changé
  // depuis la dernière archive. Retourne le nom du fichier créé ou null.
  snapshot(reason = 'manuel') {
    if (!this.exists()) return null;
    const list = this.listArchives();
    const hash = f => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
    if (list.length && hash(path.join(this.archiveDir, list[0].name)) === hash(this.file)) return null;
    fs.mkdirSync(this.archiveDir, { recursive: true });
    const d = new Date(), p2 = n => String(n).padStart(2, '0');
    const stamp = `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}_${p2(d.getHours())}-${p2(d.getMinutes())}-${p2(d.getSeconds())}`;
    const name = `suivi-${stamp}-${reason}.enc`;
    if (fs.existsSync(path.join(this.archiveDir, name))) return null; // même seconde, même motif
    fs.copyFileSync(this.file, path.join(this.archiveDir, name));
    return name;
  }

  // Plus récentes d'abord.
  listArchives() {
    let names = [];
    try { names = fs.readdirSync(this.archiveDir); } catch { return []; }
    return names.map(name => {
      const m = ARCHIVE_RE.exec(name);
      if (!m) return null;
      const date = new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0), +(m[6] || 0));
      return { name, date: date.toISOString(), reason: m[7] || '', size: fs.statSync(path.join(this.archiveDir, name)).size };
    }).filter(Boolean).sort((a, b) => b.name.localeCompare(a.name));
  }

  // Garde les `recent` archives les plus récentes, plus la dernière de chacun des `days` jours précédents.
  prune(recent, days) {
    const list = this.listArchives();
    const keep = new Set(list.slice(0, recent).map(a => a.name));
    const seenDays = new Set();
    for (const a of list.slice(recent)) {
      const day = a.name.slice(6, 16);
      if (!seenDays.has(day) && seenDays.size < days) { seenDays.add(day); keep.add(a.name); }
    }
    const removed = list.filter(a => !keep.has(a.name));
    for (const a of removed) fs.unlinkSync(path.join(this.archiveDir, a.name));
    return removed.length;
  }

  deleteArchive(name) {
    if (!ARCHIVE_RE.test(name)) throw new Error('Nom d’archive invalide.');
    fs.unlinkSync(path.join(this.archiveDir, name));
  }

  // Déchiffre une archive. Sans mot de passe, utilise la clé courante si l'archive a été
  // faite avec le même mot de passe ; sinon NEED_PASSWORD (archive d'avant un changement de mot de passe).
  readArchive(name, password) {
    if (!ARCHIVE_RE.test(name)) throw new Error('Nom d’archive invalide.');
    const raw = JSON.parse(fs.readFileSync(path.join(this.archiveDir, name), 'utf8'));
    const salt = Buffer.from(raw.kdf.salt, 'base64');
    let key;
    if (password != null) key = deriveKey(password, salt, { N: raw.kdf.N, r: raw.kdf.r, p: raw.kdf.p });
    else if (this.key && salt.equals(this.salt)) key = this.key;
    else { const e = new Error('Cette archive date d’un autre mot de passe.'); e.code = 'NEED_PASSWORD'; throw e; }
    try {
      const d = crypto.createDecipheriv('aes-256-gcm', key, Buffer.from(raw.iv, 'base64'));
      d.setAAD(Buffer.from(JSON.stringify({ format: raw.format, v: raw.v, kdf: raw.kdf })));
      d.setAuthTag(Buffer.from(raw.tag, 'base64'));
      return JSON.parse(Buffer.concat([d.update(Buffer.from(raw.data, 'base64')), d.final()]).toString('utf8'));
    } catch { throw new WrongPasswordError(); }
  }
}

function deriveCheck(vault, password) {
  const key = deriveKey(password, vault.salt, vault.params);
  if (!crypto.timingSafeEqual(key, vault.key)) throw new WrongPasswordError();
}

module.exports = { Vault, WrongPasswordError, FILE };
