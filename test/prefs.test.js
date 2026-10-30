const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { Prefs, defaults, sanitize } = require('../src/prefs');

const tmp = () => fs.mkdtempSync(path.join(os.tmpdir(), 'prefs-'));

test('valeurs par défaut si le fichier est absent ou illisible', () => {
  const dir = tmp();
  assert.deepEqual(new Prefs(dir).values, defaults());
  fs.writeFileSync(path.join(dir, 'preferences.json'), '{ pas du json');
  assert.deepEqual(new Prefs(dir).values, defaults());
});

test('enregistrement, relecture, validation et réglages manquants', () => {
  const dir = tmp();
  const p = new Prefs(dir);
  p.set({ oubliRouge: 5, oubliOrange: 4, autoLockMinutes: 0, seancePlusVert: '2,5'.replace(',', '.') });
  const q = new Prefs(dir);
  assert.equal(q.values.oubliRouge, 5);
  assert.equal(q.values.autoLockMinutes, 0);
  assert.equal(q.values.seancePlusVert, 2.5);
  // un fichier ancien auquel il manque des clés reçoit les valeurs par défaut
  fs.writeFileSync(path.join(dir, 'preferences.json'), JSON.stringify({ oubliRouge: 6 }));
  const r = new Prefs(dir).values;
  assert.equal(r.oubliRouge, 6);
  assert.equal(r.travailRouge, defaults().travailRouge);
});

test('sanitize borne les valeurs et garde orange ≤ rouge', () => {
  const v = sanitize({ oubliRouge: 2, oubliOrange: 9, autoLockMinutes: -4, travailRouge: 'abc', inconnu: 1 });
  assert.equal(v.oubliOrange, 2);
  assert.equal(v.autoLockMinutes, 0);
  assert.equal(v.travailRouge, defaults().travailRouge);
  assert.ok(!('inconnu' in v));
});
