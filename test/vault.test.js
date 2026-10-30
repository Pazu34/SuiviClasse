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
  assert.equal(fs.readdirSync(path.join(dir, 'sauvegardes')).length, 1);
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
