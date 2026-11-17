// Compatibilité du coffre avec le programme du PC : chaque sens doit fonctionner, y compris archives et changement de mot de passe.
import assert from "node:assert/strict";
import test from "node:test";
import { FsStorage, py, tmpdir } from "./helpers.mjs";
import { Vault, WrongPasswordError, NeedPasswordError } from "../www/js/core/vault.js";

const PW = "Mot de passe é🙂 — test";
const DATA = {
  version: 1, settings: { annee: "2026-2027", echelle: 20, builtin: { qualSeance: { niveaux: ["Oui", "Non"] } } },
  classes: [{ id: "c1", nom: "6ᵉ B", eleves: [{ id: "e1", nom: "DUPONT", prenom: "Zoé 🙂", numero: 1, naissance: "01/02/2014", infos: "PAI\nasthme",
    notes: { "1": 14.5, "2": null, "3": null }, comms: { "1": "Bien", "2": "", "3": "" },
    events: [{ id: "x1", type: "seance", t: 1, v: 0.5, note: "", date: "2026-10-01T10:00:00.000Z" }], extra: {} }] }],
  salles: [], ui: { classe: "c1", trimestre: 1 },
};

const pyOpen = (dir, pw = PW) => py(`
import sys, json
from suiviclasse.vault import Vault
v = Vault(sys.argv[1] if len(sys.argv) > 1 else ${JSON.stringify(dir)})
print(json.dumps(v.unlock(${JSON.stringify(pw)}), ensure_ascii=False))`);

test("un coffre créé par le PC s'ouvre dans l'application Android", async () => {
  const dir = tmpdir();
  py(`
import json
from suiviclasse.vault import Vault
Vault(${JSON.stringify(dir)}).create(${JSON.stringify(PW)}, json.loads(sys.stdin.read()))`, DATA);
  const v = new Vault(new FsStorage(dir));
  assert.deepEqual(await v.unlock(PW), DATA);
});

test("un coffre créé par l'application Android s'ouvre sur le PC", async () => {
  const dir = tmpdir();
  const v = new Vault(new FsStorage(dir));
  await v.create(PW, DATA);
  assert.deepEqual(pyOpen(dir), DATA);
  // enregistrement répété : nouvel IV à chaque fois, toujours lisible des deux côtés
  const t1 = await v.fileText();
  DATA.classes[0].eleves[0].notes["2"] = 12;
  await v.save(DATA);
  assert.notEqual(await v.fileText(), t1);
  assert.equal(pyOpen(dir).classes[0].eleves[0].notes["2"], 12);
  DATA.classes[0].eleves[0].notes["2"] = null;
});

test("mauvais mot de passe et fichier altéré sont refusés", async () => {
  const dir = tmpdir();
  const st = new FsStorage(dir);
  await new Vault(st).create(PW, DATA);
  await assert.rejects(new Vault(st).unlock("autre"), WrongPasswordError);
  const raw = JSON.parse(await st.get("suivi.enc"));
  raw.kdf.N = 16384;  // l'en-tête est authentifié : le modifier invalide le fichier même avec le bon mot de passe
  await st.put("suivi.enc", JSON.stringify(raw));
  await assert.rejects(new Vault(st).unlock(PW), WrongPasswordError);
});

test("le mot de passe est normalisé (NFC) comme sur le PC", async () => {
  const dir = tmpdir();
  const v = new Vault(new FsStorage(dir));
  await v.create("été", DATA);          // « é » décomposé
  assert.deepEqual(pyOpen(dir, "été"), DATA);  // « é » composé, saisi sur le PC
});

test("archives : noms et contenus lisibles des deux côtés ; élagage identique", async () => {
  const dir = tmpdir();
  const st = new FsStorage(dir);
  const v = new Vault(st);
  await v.create(PW, DATA);
  const name = await v.snapshot("manuel");
  assert.match(name, /^suivi-\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}-manuel\.enc$/);
  assert.equal(await v.snapshot("manuel"), null, "rien n'a changé depuis la dernière archive");
  const fromPy = py(`
import json
from suiviclasse.vault import Vault
v = Vault(${JSON.stringify(dir)})
print(json.dumps([a["name"] for a in v.list_archives()]))`);
  assert.deepEqual(fromPy, [name]);
  assert.deepEqual(await v.readArchive(name), DATA);
  // une archive créée par le PC apparaît côté Android
  const pyName = py(`
from suiviclasse.vault import Vault
v = Vault(${JSON.stringify(dir)}); v.unlock(${JSON.stringify(PW)})
import json
d = v.unlock(${JSON.stringify(PW)}); d["settings"]["annee"] = "x"; v.save(d)
print(json.dumps(v.snapshot("auto")))`);
  const seen = (await v.listArchives()).find((x) => x.name === pyName);
  assert.ok(seen, "l'archive du PC est listée côté Android");
  assert.equal(seen.reason, "auto");
});

test("changement de mot de passe : archives d'avant gardent l'ancien", async () => {
  const dir = tmpdir();
  const v = new Vault(new FsStorage(dir));
  await v.create(PW, DATA);
  await assert.rejects(v.changePassword("faux", "nouveau", DATA), WrongPasswordError);
  await v.changePassword(PW, "nouveau", DATA);
  assert.deepEqual(pyOpen(dir, "nouveau"), DATA);
  const [arch] = await v.listArchives();
  assert.equal(arch.reason, "mdp");
  await assert.rejects(v.readArchive(arch.name), NeedPasswordError);
  assert.deepEqual(await v.readArchive(arch.name, PW), DATA);
});

test("importer le fichier du PC remplace le coffre (avec son mot de passe) et archive l'ancien", async () => {
  const pcDir = tmpdir(), tabDir = tmpdir();
  py(`
import json
from suiviclasse.vault import Vault
Vault(${JSON.stringify(pcDir)}).create("mdp-pc", json.loads(sys.stdin.read()))`, DATA);
  const tab = new Vault(new FsStorage(tabDir));
  await tab.create("mdp-tablette", { classes: [], salles: [], settings: {}, ui: {} });
  const text = await new FsStorage(pcDir).get("suivi.enc");
  await assert.rejects(tab.replaceWithFile(text, "mauvais"), WrongPasswordError);
  assert.deepEqual(await tab.replaceWithFile(text, "mdp-pc"), DATA);
  assert.deepEqual(await new Vault(new FsStorage(tabDir)).unlock("mdp-pc"), DATA);
  assert.equal((await tab.listArchives())[0].reason, "import");
});

test("prune : mêmes règles que le PC", async () => {
  const dir = tmpdir();
  const st = new FsStorage(dir);
  const v = new Vault(st);
  await v.create(PW, DATA);
  const names = ["2026-10-01_09-00-00", "2026-10-01_10-00-00", "2026-10-02_09-00-00", "2026-10-03_09-00-00", "2026-10-03_11-00-00"];
  for (const n of names) await st.put(`sauvegardes/suivi-${n}-auto.enc`, "x" + n);
  const removedJs = await v.prune(2, 1);
  const left = (await v.listArchives()).map((a) => a.name);
  // Python sur la même arborescence de départ
  const dir2 = tmpdir();
  const st2 = new FsStorage(dir2);
  for (const n of names) await st2.put(`sauvegardes/suivi-${n}-auto.enc`, "x" + n);
  const resPy = py(`
import json
from suiviclasse.vault import Vault
v = Vault(${JSON.stringify(dir2)})
n = v.prune(2, 1)
print(json.dumps([n, [a["name"] for a in v.list_archives()]]))`);
  assert.equal(removedJs, resPy[0]);
  assert.deepEqual(left, resPy[1]);
});
