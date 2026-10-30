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
const KEEP_BACKUPS = 15;

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
    this._backup();
    this._write(data);
  }

  changePassword(oldPassword, newPassword, data) {
    deriveCheck(this, oldPassword);
    this.params = { ...KDF };
    this.salt = crypto.randomBytes(16);
    this.key = deriveKey(newPassword, this.salt, this.params);
    this._backup();
    this._write(data);
  }

  lock() { if (this.key) this.key.fill(0); this.key = null; }

  _write(data) {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, encrypt(this.key, this.salt, this.params, data));
    fs.renameSync(tmp, this.file);
  }

  // Une copie par jour au maximum, les plus anciennes sont supprimées.
  _backup() {
    if (!this.exists()) return;
    const dir = path.join(this.dir, 'sauvegardes');
    fs.mkdirSync(dir, { recursive: true });
    const day = new Date().toISOString().slice(0, 10);
    const dest = path.join(dir, `suivi-${day}.enc`);
    if (!fs.existsSync(dest)) fs.copyFileSync(this.file, dest);
    const all = fs.readdirSync(dir).filter(f => /^suivi-\d{4}-\d{2}-\d{2}\.enc$/.test(f)).sort();
    for (const f of all.slice(0, Math.max(0, all.length - KEEP_BACKUPS))) fs.unlinkSync(path.join(dir, f));
  }
}

function deriveCheck(vault, password) {
  const key = deriveKey(password, vault.salt, vault.params);
  if (!crypto.timingSafeEqual(key, vault.key)) throw new WrongPasswordError();
}

module.exports = { Vault, WrongPasswordError, FILE };
