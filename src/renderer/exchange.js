'use strict';
// Échanges de tableaux avec PRONOTE (et tout tableur) : analyse de texte collé / de fichiers
// texte, association de colonnes, lecture des notes avec les annotations PRONOTE, export.
// Fonctionne dans le navigateur (global `Exchange`) et sous Node (tests).
(function (root) {
  const norm = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[-_'’\s]+/g, ' ').trim();

  // PRONOTE copie les listes avec des tabulations ; les fichiers texte peuvent utiliser ; ou ,
  function detectDelimiter(text) {
    const first = text.replace(/^\ufeff/, '').split(/\r?\n/)[0] || '';
    return ['\t', ';', ','].find(d => first.includes(d)) || '\t';
  }

  // Analyse CSV/TSV avec guillemets (les retours à la ligne dans une cellule sont gérés).
  function parseTable(text, delim) {
    text = String(text).replace(/^﻿/, '');
    delim = delim || detectDelimiter(text);
    const rows = []; let row = [], cell = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
      else if (c === '"' && cell === '') q = true;
      else if (c === delim) { row.push(cell); cell = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
      else cell += c;
    }
    if (cell !== '' || row.length) { row.push(cell); rows.push(row); }
    return rows.filter(r => r.some(c => c.trim() !== '')).map(r => r.map(c => c.trim()));
  }

  const ROLES = [
    ['ignore', 'Champ ignoré'], ['nom', 'Nom'], ['prenom', 'Prénom'], ['nomprenom', 'Nom et prénom'], ['classe', 'Classe'], ['naissance', 'Date de naissance'], ['infos', 'Infos (PAI…)'],
    ['note1', 'Note T1'], ['note2', 'Note T2'], ['note3', 'Note T3'],
    ['comm1', 'Appréciation T1'], ['comm2', 'Appréciation T2'], ['comm3', 'Appréciation T3'],
  ];

  // Devine le rôle d'une colonne d'après son titre ; defaultT = trimestre à utiliser si le titre n'en précise pas.
  function guessRole(header, defaultT) {
    const h = norm(header);
    const t = (/\b(?:t|trimestre\s*)([123])\b/.exec(h) || /\b([123])\s*(?:er|e|eme|d)?\s*trimestre\b/.exec(h) || [])[1] || String(defaultT || 1);
    if (/^(nom et prenom|eleve|nom prenom|nom complet)$/.test(h)) return 'nomprenom';
    if (/^nom( de famille| usuel)?$/.test(h)) return 'nom';
    if (/prenom/.test(h)) return 'prenom';
    if (/^classe/.test(h)) return 'classe';
    if (/^ne\(e\) le|^ne le|naissance/.test(h)) return 'naissance';
    if (/appreciation|commentaire|observation/.test(h)) return 'comm' + t;
    if (/moyenne|^note|^moy/.test(h)) return 'note' + t;
    if (/pai|handicap|^info|amenagement|particular/.test(h)) return 'infos';
    return 'ignore';
  }

  // La première ligne est-elle une ligne de titres ? (aucune cellule ne ressemble à une note)
  function looksLikeHeader(row) {
    return row.length > 0 && row.every(c => !/^\d+([.,]\d+)?$/.test(c)) && row.some(c => guessRole(c) !== 'ignore');
  }

  // « DUPONT Jean-Pierre » : mots en majuscules = nom ; sinon premier mot = nom.
  function splitFullName(s) {
    const w = s.trim().split(/\s+/).filter(Boolean);
    if (w.length < 2) return { nom: w[0] || '', prenom: '' };
    let i = 0; while (i < w.length - 1 && w[i] === w[i].toUpperCase() && /[A-ZÀ-Ý]/.test(w[i])) i++;
    return i === 0 ? { nom: w[0], prenom: w.slice(1).join(' ') } : { nom: w.slice(0, i).join(' '), prenom: w.slice(i).join(' ') };
  }

  // Note d'un tableur PRONOTE : virgule décimale, « /20 » toléré, annotations PRONOTE
  // (A, D, N, I, R, Abs, Disp, N.Not, Inap, N.Rdu = non comptées ; Z, W, Abs*, N.Rdu* = comptées 0).
  function parseNote(raw) {
    const s = String(raw ?? '').trim();
    if (s === '') return { value: null, kind: 'empty' };
    const n = Number(s.replace(/\s/g, '').replace(',', '.').replace(/\/\s*\d+([.,]\d+)?$/, ''));
    if (Number.isFinite(n)) return { value: n, kind: 'note' };
    if (/^(z|w|abs\*|n\.?\s*rdu\*)$/i.test(s)) return { value: 0, kind: 'zero' };
    if (/^(a|d|n|i|r|abs|disp|n\.?\s*not|inap|n\.?\s*rdu)$/i.test(s)) return { value: null, kind: 'annotation' };
    return { value: null, kind: 'invalid' };
  }

  const keyOf = (nom, prenom) => norm(nom) + '|' + norm(prenom);

  /**
   * Applique un tableau à des classes.
   * opts : { roles: [rôle par colonne], skip: nb de lignes de titres, classId (classe courante),
   *          createStudents: bool, newStudent(nom, prenom, infos), newClass(nom), uid }
   * Modifie `classes` en place ; retourne un compte rendu.
   */
  function applyTable(classes, rows, opts) {
    const rep = { classes: {}, created: 0, updated: 0, unchanged: 0, createdClasses: 0, unmatched: [], invalid: [], toolong: 0 };
    const col = r => opts.roles.indexOf(r);
    const get = (row, r) => { const i = col(r); return i < 0 ? '' : (row[i] ?? ''); };
    const current = classes.find(c => c.id === opts.classId);
    for (const row of rows.slice(opts.skip)) {
      let nom = get(row, 'nom'), prenom = get(row, 'prenom');
      if (!nom && col('nomprenom') >= 0) ({ nom, prenom } = splitFullName(get(row, 'nomprenom')));
      if (!nom) continue;
      let cls = current;
      const cname = get(row, 'classe');
      if (cname) {
        cls = classes.find(c => norm(c.nom) === norm(cname));
        if (!cls && opts.createStudents) { cls = opts.newClass(cname); classes.push(cls); rep.createdClasses++; }
      }
      if (!cls) { rep.unmatched.push(`${nom} ${prenom}`.trim()); continue; }
      const naiss = get(row, 'naissance');
      // deux homonymes se distinguent par leur date de naissance (si elle est connue des deux côtés)
      let s = cls.eleves.find(e => keyOf(e.nom, e.prenom) === keyOf(nom, prenom) && !(naiss && e.naissance && e.naissance !== naiss));
      let isNew = false;
      if (!s) {
        if (!opts.createStudents) { rep.unmatched.push(`${nom} ${prenom}`.trim()); continue; }
        s = opts.newStudent(nom, prenom, ''); cls.eleves.push(s); isNew = true; rep.created++;
      }
      let changed = false;
      if (naiss && naiss !== s.naissance) { s.naissance = naiss; changed = !isNew || changed; }
      const infos = get(row, 'infos');
      if (infos && infos !== s.infos) { s.infos = infos; changed = true; }
      for (const t of [1, 2, 3]) {
        if (col('note' + t) >= 0) {
          const p = parseNote(get(row, 'note' + t));
          if (p.kind === 'invalid') rep.invalid.push(`${s.nom} ${s.prenom} : « ${get(row, 'note' + t)} »`);
          else if (p.kind !== 'empty' && s.notes[t] !== p.value) { s.notes[t] = p.value; changed = true; }
        }
        if (col('comm' + t) >= 0) {
          const c = get(row, 'comm' + t);
          if (c && c !== s.comms[t]) { s.comms[t] = c; changed = true; }
        }
      }
      rep.classes[cls.nom] = (rep.classes[cls.nom] || 0) + 1;
      if (!isNew) rep[changed ? 'updated' : 'unchanged']++;
    }
    return rep;
  }

  const EXPORT_FIELDS = [
    ['nom', 'Nom'], ['prenom', 'Prénom'], ['classe', 'Classe'], ['infos', 'Infos (PAI…)'],
    ['note', 'Note du trimestre'], ['comm', 'Appréciation du trimestre'],
    ['seancePlus', 'Séance +'], ['seanceMoins', 'Séance −'], ['travail', 'Travail non fait'], ['oubli', 'Oublis de matériel'],
  ];
  const fmtNum = n => String(Math.round(n * 100) / 100).replace('.', ',');

  /**
   * Construit le texte d'export. stats(s, t) → { plus, moins, travail, oubli } fourni par l'application.
   * opts : { fields: [clés], t, header: bool, delim: '\t' | ';', maxLen }
   */
  function buildExport(cls, opts, stats) {
    const q = v => { const s = String(v ?? '').replace(/\r?\n/g, ' '); return s.includes(opts.delim) || s.includes('"') ? `"${s.replace(/"/g, '""')}"` : s; };
    const label = Object.fromEntries(EXPORT_FIELDS);
    const lines = []; const tooLong = [];
    if (opts.header) lines.push(opts.fields.map(f => q(label[f] + (['note', 'comm', 'seancePlus', 'seanceMoins', 'travail', 'oubli'].includes(f) ? ` T${opts.t}` : ''))).join(opts.delim));
    for (const s of cls.eleves) {
      const st = stats(s, opts.t);
      const v = { nom: s.nom, prenom: s.prenom, classe: cls.nom, infos: s.infos, note: s.notes[opts.t] == null ? '' : fmtNum(s.notes[opts.t]), comm: s.comms[opts.t],
        seancePlus: fmtNum(st.plus), seanceMoins: fmtNum(st.moins), travail: st.travail, oubli: st.oubli };
      if (opts.maxLen && opts.fields.includes('comm') && s.comms[opts.t].length > opts.maxLen) tooLong.push(`${s.nom} ${s.prenom} (${s.comms[opts.t].length})`);
      lines.push(opts.fields.map(f => q(v[f])).join(opts.delim));
    }
    return { text: lines.join('\r\n'), tooLong };
  }

  const api = { norm, detectDelimiter, parseTable, ROLES, guessRole, looksLikeHeader, splitFullName, parseNote, applyTable, EXPORT_FIELDS, buildExport };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.Exchange = api;
})(typeof window !== 'undefined' ? window : globalThis);
