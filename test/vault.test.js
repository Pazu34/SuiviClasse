const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Vault, WrongPasswordError } = require('../src/vault');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'vault-'));

test('création, relecture et mot de passe incorrect', () => {
  const dir = tmp();
  const v = new Vault(dir);
  v.create('Pässwörd é', { classes: [{ nom: '6A', eleves: [{ nom: 'Élève' }] }] });
  const raw = fs.readFileSync(path.join(dir, 'suivi.enc'), 'utf8');
  assert.ok(!raw.includes('Élève') && !raw.includes('6A'), 'les données ne doivent pas apparaître en clair');

  const v2 = new Vault(dir);
  assert.throws(() => v2.unlock('mauvais'), WrongPasswordError);
  assert.equal(v2.unlock('Pässwörd é').classes[0].eleves[0].nom, 'Élève');
});

test('sauvegarde, sauvegarde quotidienne et détection de modification', () => {
  const dir = tmp();
  const v = new Vault(dir);
  v.create('secret', { n: 1 });
  v.save({ n: 2 });
  assert.equal(new Vault(dir).unlock('secret').n, 2);

  const f = path.join(dir, 'suivi.enc');
  const j = JSON.parse(fs.readFileSync(f, 'utf8'));
  j.kdf.salt = j.kdf.salt; j.v = 99; // en-tête modifié
  fs.writeFileSync(f, JSON.stringify(j));
  assert.throws(() => new Vault(dir).unlock('secret'), WrongPasswordError);
});

test('changement de mot de passe', () => {
  const dir = tmp();
  const v = new Vault(dir);
  v.create('ancien', { n: 1 });
  assert.throws(() => v.changePassword('faux', 'nouveau', { n: 1 }), WrongPasswordError);
  v.changePassword('ancien', 'nouveau', { n: 3 });
  assert.throws(() => new Vault(dir).unlock('ancien'), WrongPasswordError);
  assert.equal(new Vault(dir).unlock('nouveau').n, 3);
});

test('archives : instantané, absence de doublon, restauration, élagage', () => {
  const dir = tmp();
  const v = new Vault(dir);
  v.create('secret', { n: 1 });
  assert.ok(v.snapshot('auto'));
  assert.equal(v.snapshot('auto'), null, 'rien n\'a changé : pas de nouvelle archive');
  v.save({ n: 2 });
  const second = v.snapshot('manuel');
  assert.ok(second);
  const list = v.listArchives();
  assert.equal(list.length, 2);
  assert.equal(list[0].name, second);
  assert.equal(v.readArchive(list[1].name).n, 1, 'ancienne version lisible avec la clé courante');
  assert.equal(v.readArchive(list[0].name).n, 2);
  assert.throws(() => v.readArchive('../suivi.enc'), /invalide/);

  // changement de mot de passe : les anciennes archives demandent l'ancien mot de passe
  v.changePassword('secret', 'autre', { n: 3 });
  const old = v.listArchives().find(a => a.name === second); // déjà identique au fichier : pas de doublon 'mdp'
  assert.ok(old);
  assert.throws(() => v.readArchive(old.name), e => e.code === 'NEED_PASSWORD');
  assert.throws(() => v.readArchive(old.name, 'faux'), WrongPasswordError);
  assert.equal(v.readArchive(old.name, 'secret').n, 2);

  // élagage : on garde les 2 plus récentes + 1 par jour
  fs.copyFileSync(path.join(dir, 'suivi.enc'), path.join(dir, 'sauvegardes', 'suivi-2020-01-01_10-00-00-auto.enc'));
  fs.copyFileSync(path.join(dir, 'suivi.enc'), path.join(dir, 'sauvegardes', 'suivi-2020-01-01_09-00-00-auto.enc'));
  fs.copyFileSync(path.join(dir, 'suivi.enc'), path.join(dir, 'sauvegardes', 'suivi-2020-01-02.enc'));
  const before = v.listArchives().length;
  const removed = v.prune(2, 1);
  const after = v.listArchives();
  assert.equal(before - removed, after.length);
  assert.equal(after.length, 3); // 2 récentes + la plus récente d'un jour plus ancien
});
