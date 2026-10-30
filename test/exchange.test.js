const test = require('node:test');
const assert = require('node:assert');
const X = require('../src/renderer/exchange');

test('séparateur et guillemets', () => {
  assert.equal(X.detectDelimiter('Nom\tPrénom\nA\tB'), '\t');
  assert.equal(X.detectDelimiter('Nom;Prénom\nA;B'), ';');
  assert.deepEqual(X.parseTable('﻿Nom;Appréciation\r\n"DUPONT";"Dit ""bien"";\nok"\r\n'), [['Nom', 'Appréciation'], ['DUPONT', 'Dit "bien";\nok']]);
});

test('rôles des colonnes d\'après les titres', () => {
  assert.equal(X.guessRole('Nom'), 'nom');
  assert.equal(X.guessRole('Prénom'), 'prenom');
  assert.equal(X.guessRole('Classe'), 'classe');
  assert.equal(X.guessRole('Moyenne T2'), 'note2');
  assert.equal(X.guessRole('Appréciation 3e trimestre'.replace('3e trimestre', 'Trimestre 3')), 'comm3');
  assert.equal(X.guessRole('Moyenne', 2), 'note2');
  assert.equal(X.guessRole('Né(e) le'), 'naissance');
  assert.equal(X.guessRole('Délégué'), 'ignore');
  assert.ok(X.looksLikeHeader(['Nom', 'Prénom']));
  assert.ok(!X.looksLikeHeader(['DUPONT', '14,5']));
});

test('notes PRONOTE : virgule, annotations', () => {
  assert.deepEqual(X.parseNote('14,5'), { value: 14.5, kind: 'note' });
  assert.equal(X.parseNote('12,25 /20').value, 12.25);
  assert.equal(X.parseNote('21').value, 21);
  assert.equal(X.parseNote('Abs').kind, 'annotation');
  assert.equal(X.parseNote('N.Rdu').kind, 'annotation');
  assert.deepEqual(X.parseNote('Z'), { value: 0, kind: 'zero' });
  assert.deepEqual(X.parseNote('N. Rdu*'), { value: 0, kind: 'zero' });
  assert.equal(X.parseNote('').kind, 'empty');
  assert.equal(X.parseNote('bof').kind, 'invalid');
});

const mk = (nom, prenom) => ({ id: nom, nom, prenom, naissance: '', infos: '', notes: { 1: null, 2: null, 3: null }, comms: { 1: '', 2: '', 3: '' }, events: [] });
const base = { newStudent: (n, p, i) => ({ ...mk(n, p), infos: i }), newClass: nom => ({ id: nom, nom, eleves: [] }) };

test('import : mise à jour des élèves existants, accents/casse ignorés, création de classes', () => {
  const classes = [{ id: 'c1', nom: '6A', eleves: [mk('DUPONT', 'Marie'), mk('LE GALL', 'Anne-Sophie')] }];
  const rows = X.parseTable('Nom\tPrénom\tMoyenne T1\tAppréciation T1\nDupont\tMARIE\t14,5\tBon début\nLe Gall\tAnne Sophie\tAbs\t\nMARTIN\tPaul\t9\t');
  const roles = rows[0].map(h => X.guessRole(h));
  const rep = X.applyTable(classes, rows, { ...base, roles, skip: 1, classId: 'c1', createStudents: false });
  assert.equal(rep.updated, 1); assert.equal(rep.unchanged, 1); assert.deepEqual(rep.unmatched, ['MARTIN Paul']);
  assert.equal(classes[0].eleves[0].notes[1], 14.5);
  assert.equal(classes[0].eleves[0].comms[1], 'Bon début');
  assert.equal(classes[0].eleves[1].notes[1], null);

  const rep2 = X.applyTable(classes, X.parseTable('Classe;Nom et prénom;Note T2\n5B;DURAND Éric;11,5'), { ...base, roles: ['classe', 'nomprenom', 'note2'], skip: 1, classId: 'c1', createStudents: true });
  assert.equal(rep2.created, 1); assert.equal(rep2.createdClasses, 1);
  assert.equal(classes[1].eleves[0].prenom, 'Éric'); assert.equal(classes[1].eleves[0].notes[2], 11.5);
});

test('export : champs choisis, ligne de titres, séparateur, appréciations trop longues', () => {
  const s = mk('DUPONT', 'Marie'); s.notes[2] = 14.5; s.comms[2] = 'x'.repeat(300);
  const cls = { nom: '6A', eleves: [s, { ...mk('MARTIN', 'Paul'), comms: { 1: '', 2: 'Dit "ok"; bien', 3: '' } }] };
  const st = () => ({ plus: 1, moins: -0.5, travail: 2, oubli: 0 });
  const r = X.buildExport(cls, { fields: ['nom', 'prenom', 'note', 'comm'], t: 2, header: true, delim: '\t', maxLen: 255 }, st);
  const lines = r.text.split('\r\n');
  assert.equal(lines[0], 'Nom\tPrénom\tNote du trimestre T2\tAppréciation du trimestre T2');
  assert.ok(lines[1].startsWith('DUPONT\tMarie\t14,5\t'));
  assert.deepEqual(r.tooLong, ['DUPONT Marie (300)']);
  const r2 = X.buildExport(cls, { fields: ['nom', 'comm'], t: 2, header: false, delim: ';' }, st);
  assert.equal(r2.text.split('\r\n')[1], 'MARTIN;"Dit ""ok""; bien"');
});

test('liste d\'élèves copiée depuis PRONOTE (Élève / Né(e) le / Classe)', () => {
  const txt = 'Élève\t"Né(e) le"\tClasse\n"NOM1 Prénom1"\t09/08/2015\t6G\n"NOM2 Prénom2"\t22/07/2015\t6E\n"NOM3 Prénom Composé"\t25/07/2015\t6G\n"NOM4 Prénom4"\t22/08/2015\t6F';
  const rows = X.parseTable(txt);
  assert.deepEqual(rows[0].map(h => X.guessRole(h)), ['nomprenom', 'naissance', 'classe']);
  const classes = [];
  const rep = X.applyTable(classes, rows, { ...base, roles: rows[0].map(h => X.guessRole(h)), skip: 1, classId: null, createStudents: true });
  assert.deepEqual(classes.map(c => c.nom).sort(), ['6E', '6F', '6G']);
  assert.deepEqual(rep.classes, { '6G': 2, '6E': 1, '6F': 1 });
  const g = classes.find(c => c.nom === '6G').eleves;
  assert.deepEqual(g.map(e => [e.nom, e.prenom, e.naissance]), [['NOM1', 'Prénom1', '09/08/2015'], ['NOM3', 'Prénom Composé', '25/07/2015']]);
  // réimporter la même liste ne crée rien
  const rep2 = X.applyTable(classes, rows, { ...base, roles: rows[0].map(h => X.guessRole(h)), skip: 1, classId: null, createStudents: true });
  assert.equal(rep2.created, 0); assert.equal(rep2.unchanged, 4);
  // homonymes : date de naissance différente = autre élève
  const h = X.parseTable('Élève\tNé(e) le\tClasse\nNOM1 Prénom1\t01/01/2014\t6G');
  assert.equal(X.applyTable(classes, h, { ...base, roles: ['nomprenom', 'naissance', 'classe'], skip: 1, classId: null, createStudents: true }).created, 1);
});
