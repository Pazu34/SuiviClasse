"""Coffre chiffré : un seul fichier « suivi.enc » dans le dossier de données.

Clé dérivée du mot de passe avec scrypt, chiffrement AES-256-GCM (authentifié :
toute modification du fichier, ou un mauvais mot de passe, est détectée).
Les archives sont de simples copies de ce fichier, horodatées, dans « sauvegardes/ ».
"""
import base64
import hashlib
import json
import os
import re
import secrets
import shutil
import unicodedata
from datetime import datetime
from pathlib import Path

from cryptography.hazmat.primitives.ciphers.aead import AESGCM

FILE = "suivi.enc"
ARCHIVE_DIR = "sauvegardes"
KDF = {"N": 1 << 15, "r": 8, "p": 1}
MAXMEM = 256 * 1024 * 1024
# suivi-2026-10-30_15-42-10[-motif].enc   (ancien format : suivi-2026-10-30.enc)
ARCHIVE_RE = re.compile(
    r"^suivi-(\d{4})-(\d{2})-(\d{2})(?:_(\d{2})-(\d{2})-(\d{2}))?(?:-([a-z]+))?\.enc$"
)


class WrongPasswordError(Exception):
    code = "WRONG_PASSWORD"

    def __init__(self):
        super().__init__("Mot de passe incorrect (ou fichier corrompu).")


class NeedPasswordError(Exception):
    code = "NEED_PASSWORD"

    def __init__(self):
        super().__init__("Cette archive date d’un autre mot de passe.")


def _derive_key(password, salt, params):
    return hashlib.scrypt(
        unicodedata.normalize("NFC", password).encode("utf-8"),
        salt=salt, n=params["N"], r=params["r"], p=params["p"], maxmem=MAXMEM, dklen=32,
    )


def _header_bytes(header):
    # même sérialisation compacte que la version JavaScript : elle sert de donnée authentifiée
    return json.dumps(header, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def _encrypt(key, salt, params, data):
    header = {"format": "suiviclasse", "v": 1,
              "kdf": {"alg": "scrypt", **params, "salt": base64.b64encode(salt).decode()}}
    iv = secrets.token_bytes(12)
    sealed = AESGCM(key).encrypt(iv, json.dumps(data, ensure_ascii=False, separators=(",", ":")).encode("utf-8"),
                                 _header_bytes(header))
    ct, tag = sealed[:-16], sealed[-16:]
    return json.dumps({**header, "iv": base64.b64encode(iv).decode(),
                       "tag": base64.b64encode(tag).decode(), "data": base64.b64encode(ct).decode()})


def _decrypt(key, raw):
    header = {"format": raw["format"], "v": raw["v"], "kdf": raw["kdf"]}
    try:
        sealed = base64.b64decode(raw["data"]) + base64.b64decode(raw["tag"])
        plain = AESGCM(key).decrypt(base64.b64decode(raw["iv"]), sealed, _header_bytes(header))
        return json.loads(plain.decode("utf-8"))
    except Exception:
        raise WrongPasswordError() from None


def _kdf_params(raw):
    k = raw["kdf"]
    return {"N": k["N"], "r": k["r"], "p": k["p"]}, base64.b64decode(k["salt"])


def _sha256(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


class Vault:
    def __init__(self, directory):
        self.dir = Path(directory)
        self.file = self.dir / FILE
        self.key = None
        self.salt = None
        self.params = None

    def exists(self):
        return self.file.exists()

    @property
    def unlocked(self):
        return self.key is not None

    # ---------- coffre ----------
    def create(self, password, data):
        if self.exists():
            raise FileExistsError("Un coffre existe déjà dans ce dossier.")
        self.dir.mkdir(parents=True, exist_ok=True)
        self.params = dict(KDF)
        self.salt = secrets.token_bytes(16)
        self.key = _derive_key(password, self.salt, self.params)
        self._write(data)

    def unlock(self, password):
        raw = json.loads(self.file.read_text(encoding="utf-8"))
        if raw.get("format") != "suiviclasse":
            raise ValueError("Fichier de données non reconnu.")
        params, salt = _kdf_params(raw)
        key = _derive_key(password, salt, params)
        data = _decrypt(key, raw)
        self.key, self.salt, self.params = key, salt, params
        return data

    def save(self, data):
        if not self.key:
            raise RuntimeError("Coffre verrouillé.")
        self._write(data)

    def change_password(self, old, new, data):
        if not self.key or not secrets.compare_digest(_derive_key(old, self.salt, self.params), self.key):
            raise WrongPasswordError()
        self.snapshot("mdp")  # les archives antérieures gardent l'ancien mot de passe
        self.params = dict(KDF)
        self.salt = secrets.token_bytes(16)
        self.key = _derive_key(new, self.salt, self.params)
        self._write(data)

    def lock(self):
        self.key = None

    def _write(self, data):
        tmp = self.file.with_name(FILE + ".tmp")
        tmp.write_text(_encrypt(self.key, self.salt, self.params, data), encoding="utf-8")
        os.replace(tmp, self.file)

    # ---------- archives ----------
    @property
    def archive_dir(self):
        return self.dir / ARCHIVE_DIR

    def snapshot(self, reason="manuel"):
        """Copie le fichier chiffré tel quel. Ne fait rien si rien n'a changé depuis la dernière
        archive. Retourne le nom du fichier créé, ou None."""
        if not self.exists():
            return None
        archives = self.list_archives()
        if archives and _sha256(self.archive_dir / archives[0]["name"]) == _sha256(self.file):
            return None
        self.archive_dir.mkdir(parents=True, exist_ok=True)
        name = f"suivi-{datetime.now():%Y-%m-%d_%H-%M-%S}-{reason}.enc"
        dest = self.archive_dir / name
        if dest.exists():  # même seconde, même motif
            return None
        shutil.copyfile(self.file, dest)
        return name

    def list_archives(self):
        """Plus récentes d'abord : [{name, date (datetime), reason, size}]."""
        if not self.archive_dir.is_dir():
            return []
        out = []
        for f in self.archive_dir.iterdir():
            m = ARCHIVE_RE.match(f.name)
            if m:
                y, mo, d, hh, mi, ss, reason = m.groups()
                out.append({"name": f.name, "reason": reason or "", "size": f.stat().st_size,
                            "date": datetime(int(y), int(mo), int(d), int(hh or 0), int(mi or 0), int(ss or 0))})
        return sorted(out, key=lambda a: a["name"], reverse=True)

    def prune(self, recent, days):
        """Garde les `recent` archives les plus récentes, plus la dernière de chacun des `days` jours précédents."""
        archives = self.list_archives()
        keep = {a["name"] for a in archives[:recent]}
        seen = set()
        for a in archives[recent:]:
            day = a["name"][6:16]
            if day not in seen and len(seen) < days:
                seen.add(day)
                keep.add(a["name"])
        removed = [a for a in archives if a["name"] not in keep]
        for a in removed:
            (self.archive_dir / a["name"]).unlink()
        return len(removed)

    def delete_archive(self, name):
        if not ARCHIVE_RE.match(name):
            raise ValueError("Nom d’archive invalide.")
        (self.archive_dir / name).unlink()

    def read_archive(self, name, password=None):
        """Déchiffre une archive. Sans mot de passe, utilise la clé courante si l'archive a été faite
        avec le même mot de passe ; sinon NeedPasswordError (archive d'avant un changement de mot de passe)."""
        if not ARCHIVE_RE.match(name):
            raise ValueError("Nom d’archive invalide.")
        raw = json.loads((self.archive_dir / name).read_text(encoding="utf-8"))
        params, salt = _kdf_params(raw)
        if password is not None:
            key = _derive_key(password, salt, params)
        elif self.key is not None and salt == self.salt:
            key = self.key
        else:
            raise NeedPasswordError()
        return _decrypt(key, raw)
