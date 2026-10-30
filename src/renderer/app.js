'use strict';

/* ---------- utilitaires ---------- */
const $app = document.getElementById('app');
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36).slice(-4);
const TYPES = { seance: 'Séance', travail: 'Travail non fait', oubli: 'Oubli de matériel' };
const MIN_PW = 8;

function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else if (k === 'class') el.className = v;
    else if (v !== false && v != null) el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) if (c != null && c !== false) el.append(c.nodeType ? c : document.createTextNode(c));
  return el;
}
const fmt = n => (Math.round(n * 100) / 100).toString().replace('.', ',');
const parseNum = s => { const n = parseFloat(String(s).replace(',', '.')); return Number.isFinite(n) ? n : null; };
const fmtDate = iso => new Date(iso).toLocaleString('fr-FR', { dateStyle: 'short', timeStyle: 'short' });
const collator = new Intl.Collator('fr', { sensitivity: 'base' });

function newData() {
  return { version: 1, settings: { annee: '' }, classes: [], ui: { classe: null, trimestre: 1 } };
}

/* ---------- état ---------- */
let state = null;        // données déchiffrées
let prefs = null;        // { values, schema, file } : préférences (fichier preferences.json)
let password = null;     // gardé en mémoire uniquement le temps de la session (pour le changement de mot de passe)
let saveTimer = null, lockTimer = null, dirty = false;
let search = '';
let openStudent = null;  // { classId, studentId }

const cls = () => state.classes.find(c => c.id === state.ui.classe) || null;
const tri = () => state.ui.trimestre;
const count = (s, type, t) => s.events.filter(e => e.type === type && e.t === t).length;
const seance = (s, t) => s.events.filter(e => e.type === 'seance' && e.t === t).reduce((a, e) => ({ plus: a.plus + (e.v > 0 ? e.v : 0), moins: a.moins + (e.v < 0 ? e.v : 0) }), { plus: 0, moins: 0 });
const moyenne = s => { const v = [1, 2, 3].map(t => s.notes[t]).filter(n => n != null); return v.length ? v.reduce((a, b) => a + b) / v.length : null; };

function newStudent(nom, prenom = '', infos = '') {
  return { id: uid(), nom: nom.trim(), prenom: prenom.trim(), naissance: '', infos, notes: { 1: null, 2: null, 3: null }, comms: { 1: '', 2: '', 3: '' }, events: [] };
}
function sortStudents(c) { c.eleves.sort((a, b) => collator.compare(a.nom, b.nom) || collator.compare(a.prenom, b.prenom)); }

/* ---------- enregistrement ---------- */
function setSaved(msg, err) { const el = document.getElementById('saved'); if (el) { el.textContent = msg; el.className = err ? 'err' : ''; } }
function commit() {
  dirty = true; setSaved('Modifié…');
  clearTimeout(saveTimer);
  saveTimer = setTimeout(flush, 500);
}
async function flush() {
  clearTimeout(saveTimer);
  if (!dirty || !state) return;
  try { await window.api.save(state); dirty = false; setSaved('Enregistré ✓'); }
  catch (e) { setSaved('ÉCHEC enregistrement !', true); alert('Enregistrement impossible : ' + e.message); }
}
function resetIdle() {
  clearTimeout(lockTimer);
  const min = prefs ? prefs.values.autoLockMinutes : 15;
  if (state && min > 0) lockTimer = setTimeout(() => lockApp(), min * 60 * 1000);
}
['click', 'keydown', 'mousemove'].forEach(ev => document.addEventListener(ev, resetIdle, { passive: true }));

async function lockApp() {
  await flush();
  await window.api.lock();
  state = null; password = null; openStudent = null; search = '';
  clearTimeout(lockTimer);
  showLogin();
}

/* ---------- connexion ---------- */
async function showLogin(message) {
  const st = await window.api.status();
  const creating = !st.exists;
  const pw = h('input', { type: 'password', id: 'pw', autofocus: true, autocomplete: 'off' });
  const pw2 = h('input', { type: 'password', id: 'pw2', autocomplete: 'off' });
  const err = h('div', { class: 'error', id: 'err' }, message || '');
  const submit = async () => {
    err.textContent = '';
    try {
      if (creating) {
        if (pw.value.length < MIN_PW) throw new Error(`Le mot de passe doit contenir au moins ${MIN_PW} caractères.`);
        if (pw.value !== pw2.value) throw new Error('Les deux mots de passe sont différents.');
        state = await window.api.create(pw.value, newData());
      } else {
        state = await window.api.unlock(pw.value);
      }
      password = pw.value;
      state.ui = state.ui || { classe: null, trimestre: 1 };
      if (!cls() && state.classes.length) state.ui.classe = state.classes[0].id;
      prefs = await window.api.getPrefs();
      resetIdle();
      render();
    } catch (e) { err.textContent = e.message; }
  };
  const onKey = e => { if (e.key === 'Enter') submit(); };
  pw.addEventListener('keydown', onKey); pw2.addEventListener('keydown', onKey);
  $app.replaceChildren(h('div', { class: 'login' },
    h('h1', {}, 'SuiviClasse'),
    h('p', { class: 'muted' }, creating ? 'Aucune donnée dans ce dossier : créez votre coffre protégé par mot de passe.' : 'Entrez votre mot de passe pour déverrouiller les données.'),
    h('label', { for: 'pw' }, creating ? 'Nouveau mot de passe' : 'Mot de passe'), pw,
    creating && h('label', { for: 'pw2' }, 'Confirmer le mot de passe'),
    creating && pw2,
    creating && h('div', { class: 'warning' }, '⚠ Il n’existe aucun moyen de récupérer les données si le mot de passe est perdu.'),
    err,
    h('div', { class: 'actions' },
      h('button', { class: 'primary', onclick: submit }, creating ? 'Créer' : 'Déverrouiller'),
      h('span', { class: 'spacer' }),
      h('button', { onclick: async () => { const r = await window.api.chooseDir(); if (r) showLogin(); } }, 'Autre dossier…')),
    h('p', { class: 'muted', style: 'font-size:12px;margin-bottom:0' }, 'Dossier de données : ' + st.dir)));
  pw.focus();
}

/* ---------- rendu principal ---------- */
function render() {
  if (!state) return;
  const c = cls();
  $app.replaceChildren(
    h('div', { class: 'top' },
      h('div', { class: 'tabs' }, state.classes.map(k => h('button', { class: k.id === state.ui.classe ? 'active' : '', onclick: () => { state.ui.classe = k.id; render(); } }, k.nom)),
        h('button', { onclick: addClass, title: 'Ajouter une classe' }, '＋ Classe')),
      h('button', { class: state.classes.length ? '' : 'primary', onclick: () => importDialog(cls()), title: 'Coller une liste d’élèves copiée depuis PRONOTE' }, '⭳ Importer une liste PRONOTE'),
      h('span', { class: 'spacer' }),
      h('div', { class: 'tri' }, [1, 2, 3].map(t => h('button', { class: t === tri() ? 'active' : '', onclick: () => { state.ui.trimestre = t; render(); } }, 'T' + t))),
      h('input', { type: 'search', placeholder: 'Rechercher un élève…', value: search, oninput: e => { search = e.target.value; renderTable(); } }),
      h('span', { id: 'saved' }, dirty ? 'Modifié…' : 'Enregistré ✓'),
      h('button', { onclick: showPrefs, title: 'Préférences (Ctrl+,)' }, '⚙ Préférences'),
      h('button', { onclick: showArchives, title: 'Sauvegardes et retour en arrière' }, '🕘 Archives'),
      h('button', { onclick: showSettings }, '🗂 Données'),
      h('button', { onclick: lockApp }, '🔒 Verrouiller')),
    h('div', { class: 'main' }, c ? classView(c) : h('div', { class: 'empty' }, 'Aucune classe. Cliquez sur « ⭳ Importer une liste PRONOTE » (les classes sont créées automatiquement) ou sur « ＋ Classe ».')));
  if (c) renderTable();
  if (openStudent) showStudent();
}

function classView(c) {
  return h('div', {},
    h('div', { class: 'classbar' },
      h('h2', {}, c.nom, h('span', { class: 'muted', style: 'font-size:13px;font-weight:400' }, ` — ${c.eleves.length} élèves`)),
      h('button', { onclick: () => importDialog(c) }, '⭳ Importer / ajouter des élèves…'),
      h('button', { onclick: () => exportDialog(c) }, '⭱ Exporter (PRONOTE, tableur)…'),
      h('button', { onclick: () => renameClass(c) }, 'Renommer'),
      h('button', { class: 'danger', onclick: () => deleteClass(c) }, 'Supprimer la classe')),
    h('div', { class: 'wrap' }, h('table', { id: 'tbl' })));
}

function counter(s, type, t, orange, rouge) {
  const n = count(s, type, t);
  const cl = n >= rouge ? 'bad' : n >= orange ? 'warn' : n === 0 ? 'ok' : '';
  return h('span', { class: 'counter ' + cl },
    h('button', { title: 'Retirer le dernier', onclick: () => removeLast(s, type, t) }, '−'),
    h('b', {}, String(n)),
    h('button', { title: 'Ajouter', onclick: () => addEvent(s, type, t, 1) }, '＋'));
}
function seanceCell(s, t) {
  const { plus, moins } = seance(s, t);
  const btn = (v, label) => h('button', { onclick: () => addEvent(s, 'seance', t, v) }, label);
  return [
    h('td', {}, h('span', { class: 'counter ' + (plus >= prefs.values.seancePlusVert ? 'ok' : '') }, btn(0.5, '+0,5'), btn(1, '+1'), h('b', {}, fmt(plus)))),
    h('td', {}, h('span', { class: 'counter ' + (moins <= -prefs.values.seanceMoinsRouge ? 'bad' : moins < 0 ? 'warn' : '') }, btn(-0.5, '−0,5'), btn(-1, '−1'), h('b', {}, fmt(moins)))),
  ];
}

function overClass(el, len) {
  const max = prefs.values.appreciationMax;
  el.classList.toggle('over', len > max);
  el.title = len > max ? `${len} caractères : dépasse la limite de ${max} (PRONOTE)` : `${len} / ${max} caractères`;
}
function commentInput(s, t) {
  const el = h('input', { class: 'comm', value: s.comms[t], placeholder: 'Commentaire pour le bulletin…',
    oninput: e => overClass(e.target, e.target.value.length), onchange: e => { s.comms[t] = e.target.value; commit(); } });
  overClass(el, s.comms[t].length);
  return el;
}

function renderTable() {
  const c = cls(), tbl = document.getElementById('tbl');
  if (!c || !tbl) return;
  const t = tri(), q = search.trim().toLowerCase();
  const rows = c.eleves.map((s, i) => ({ s, i })).filter(({ s }) => !q || `${s.nom} ${s.prenom} ${s.infos}`.toLowerCase().includes(q));
  const noteInput = (s, k) => h('input', { class: 'note', value: s.notes[k] == null ? '' : fmt(s.notes[k]), placeholder: '/20',
    onchange: e => {
      const raw = e.target.value.trim(), n = parseNum(raw);
      if (raw === '') s.notes[k] = null;
      else if (n == null || n < 0 || n > 20) { alert('Note invalide : entrez un nombre entre 0 et 20.'); e.target.value = s.notes[k] == null ? '' : fmt(s.notes[k]); return; }
      else s.notes[k] = n;
      commit(); renderTable();
    } });
  tbl.replaceChildren(
    h('thead', {}, h('tr', {}, ['n°', 'Nom', 'Prénom', 'Infos (PAI…)', 'T1 /20', 'T2 /20', 'T3 /20', 'Moy.', `Séance + (T${t})`, `Séance − (T${t})`, `Travail non fait (T${t})`, `Oubli matériel (T${t})`, `Commentaire T${t}`].map(x => h('th', {}, x)))),
    h('tbody', {}, rows.map(({ s, i }) => {
      const m = moyenne(s);
      return h('tr', {},
        h('td', { class: 'num' }, String(i + 1)),
        h('td', { class: 'name', title: 'Ouvrir la fiche', onclick: () => { openStudent = { classId: c.id, studentId: s.id }; showStudent(); } }, s.nom),
        h('td', {}, s.prenom),
        h('td', { class: 'infos', title: s.infos }, s.infos ? h('span', { class: 'tag' }, s.infos.split('\n')[0].slice(0, 40)) : ''),
        [1, 2, 3].map(k => h('td', {}, noteInput(s, k))),
        h('td', {}, m == null ? '' : fmt(m)),
        seanceCell(s, t),
        h('td', {}, counter(s, 'travail', t, prefs.values.travailOrange, prefs.values.travailRouge)),
        h('td', {}, counter(s, 'oubli', t, prefs.values.oubliOrange, prefs.values.oubliRouge)),
        h('td', {}, commentInput(s, t)));
    })),
    h('tfoot', {}, h('tr', {}, h('td', { colspan: 4 }, 'Moyenne de la classe'),
      [1, 2, 3].map(k => { const v = c.eleves.map(s => s.notes[k]).filter(n => n != null); return h('td', {}, v.length ? fmt(v.reduce((a, b) => a + b) / v.length) : ''); }),
      h('td', { colspan: 6 }))));
  if (!rows.length) tbl.append(h('caption', { class: 'empty' }, c.eleves.length ? 'Aucun élève ne correspond à la recherche.' : 'Aucun élève. Utilisez « ＋ Ajouter des élèves ».'));
}

/* ---------- événements ---------- */
function addEvent(s, type, t, v, note = '') {
  s.events.push({ id: uid(), type, t, v, date: new Date().toISOString(), note });
  commit(); renderTable(); if (openStudent) showStudent();
}
function removeLast(s, type, t) {
  for (let i = s.events.length - 1; i >= 0; i--) if (s.events[i].type === type && s.events[i].t === t) { s.events.splice(i, 1); break; }
  commit(); renderTable(); if (openStudent) showStudent();
}

/* ---------- fenêtres modales ---------- */
function modal(title, body, actions) {
  const close = () => { back.remove(); box.remove(); };
  const back = h('div', { class: 'backdrop', onclick: close });
  const box = h('div', { class: 'modal', role: 'dialog' }, h('h3', {}, title), body, h('div', { class: 'actions' }, actions(close)));
  document.body.append(back, box);
  const first = box.querySelector('input,textarea'); if (first) first.focus();
  return close;
}
function promptText(title, label, value, ok) {
  const inp = h('input', { value: value || '' });
  const go = close => { if (inp.value.trim()) { ok(inp.value.trim()); close(); } };
  modal(title, h('div', {}, h('label', {}, label), inp), close => [h('button', { onclick: close }, 'Annuler'), h('button', { class: 'primary', onclick: () => go(close) }, 'OK')]);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') document.querySelector('.modal .primary').click(); });
}

function addClass() {
  promptText('Nouvelle classe', 'Nom de la classe (ex. 6A)', '', nom => {
    const c = { id: uid(), nom, eleves: [] };
    state.classes.push(c); state.ui.classe = c.id; commit(); render();
  });
}
function renameClass(c) { promptText('Renommer la classe', 'Nouveau nom', c.nom, nom => { c.nom = nom; commit(); render(); }); }
function deleteClass(c) {
  if (!confirm(`Supprimer définitivement la classe ${c.nom} et ses ${c.eleves.length} élèves ?`)) return;
  state.classes = state.classes.filter(k => k !== c);
  state.ui.classe = state.classes[0]?.id || null; commit(); render();
}

function copyText(text) {
  return navigator.clipboard.writeText(text).catch(() => {
    const t = h('textarea', { style: 'position:fixed;opacity:0' }, text); document.body.append(t); t.select(); document.execCommand('copy'); t.remove();
  });
}

function importDialog(c) {
  const X = Exchange;
  let rows = [];
  const roleSelects = [];
  const ta = h('textarea', { rows: 5, placeholder: 'Collez ici (Ctrl+V) des colonnes copiées depuis PRONOTE ou un tableur…\nUne simple liste « NOM Prénom » (une ligne par élève) fonctionne aussi.' });
  const delimSel = h('select', {}, [['', 'Séparateur : automatique'], ['\t', 'Tabulation'], [';', 'Point-virgule'], [',', 'Virgule']].map(([v, l]) => h('option', { value: v }, l)));
  const skip = h('input', { type: 'number', min: 0, value: 0, style: 'width:64px' });
  const create = h('input', { type: 'checkbox', checked: !c || c.eleves.length === 0 });
  const preview = h('div', { class: 'wrap', style: 'max-height:260px;margin-top:8px' });
  const info = h('div', { class: 'muted', style: 'margin-top:6px' });
  const summary = h('div', { style: 'margin-top:6px;font-weight:600' });
  const err = h('div', { class: 'error' });

  const drawPreview = () => {
    roleSelects.length = 0;
    const n = Math.max(0, ...rows.map(r => r.length)), k = parseInt(skip.value) || 0;
    if (!rows.length) { preview.replaceChildren(); info.textContent = ''; return; }
    const head = h('tr', {}, Array.from({ length: n }, (_, i) => {
      const sel = h('select', {}, X.ROLES.map(([v, l]) => h('option', { value: v }, l)));
      sel.value = roleSelects[i]?.value || guessed[i] || 'ignore'; sel.addEventListener('change', summarize); roleSelects.push(sel); return h('th', {}, sel);
    }));
    preview.replaceChildren(h('table', {}, h('thead', {}, head), h('tbody', {}, rows.slice(0, 8).map((r, ri) =>
      h('tr', { style: ri < k ? 'opacity:.45' : '' }, Array.from({ length: n }, (_, i) => h('td', {}, r[i] || '')))))));
    info.textContent = `${Math.max(0, rows.length - k)} ligne(s) à importer sur ${rows.length}. Associez chaque colonne à une rubrique ; les lignes grisées (titres) sont ignorées.`;
    summarize();
  };
  // Aperçu du résultat sur une copie des données : classes concernées, élèves nouveaux / mis à jour.
  const summarize = () => {
    if (!roleSelects.length) { summary.textContent = ''; return; }
    const roles = roleSelects.map(x => x.value);
    if (!roles.includes('nom') && !roles.includes('nomprenom')) { summary.textContent = ''; return; }
    const rep = X.applyTable(JSON.parse(JSON.stringify(state.classes)), rows, importOpts(roles));
    const cl = Object.entries(rep.classes).map(([n, k]) => `${n} (${k})`).join(', ');
    summary.textContent = `Résultat attendu : ${rep.created} élève(s) à créer, ${rep.updated} à mettre à jour` + (rep.createdClasses ? `, ${rep.createdClasses} classe(s) à créer` : '') + (cl ? ` — classes : ${cl}` : '') + (rep.unmatched.length ? ` — ${rep.unmatched.length} ligne(s) sans classe ou élève inconnu(e), ignorée(s)` : '') + '.';
  };
  const importOpts = roles => ({ roles, skip: parseInt(skip.value) || 0, classId: c ? c.id : null, createStudents: create.checked,
    newStudent, newClass: nom => ({ id: uid(), nom, eleves: [] }) });
  let guessed = [];
  const analyse = () => {
    err.textContent = '';
    rows = X.parseTable(ta.value, delimSel.value || undefined);
    if (!rows.length) { drawPreview(); return; }
    const hasHeader = X.looksLikeHeader(rows[0]);
    skip.value = hasHeader ? 1 : 0;
    const n = Math.max(...rows.map(r => r.length));
    guessed = hasHeader ? rows[0].map(x => X.guessRole(x, tri())) : Array.from({ length: n }, (_, i) => n === 1 ? 'nomprenom' : ['nom', 'prenom', 'infos'][i] || 'ignore');
    while (guessed.length < n) guessed.push('ignore');
    drawPreview();
  };
  ta.addEventListener('input', analyse); delimSel.addEventListener('change', analyse); skip.addEventListener('input', drawPreview); create.addEventListener('change', summarize);

  const close = modal(c ? `Importer dans ${c.nom}` : 'Importer une liste PRONOTE', h('div', {},
    h('p', { class: 'muted' }, 'Dans PRONOTE, le bouton de copie en haut à droite d’une liste (ou du tableau de notes) place les données dans le presse-papiers : collez-les ici. Un fichier texte exporté de PRONOTE ou d’Excel convient aussi.'),
    ta,
    h('div', { class: 'row' }, h('button', { onclick: async () => {
      try { const t = await window.api.importFile([{ name: 'Texte / CSV', extensions: ['txt', 'csv', 'tsv'] }]); if (t != null) { ta.value = t; analyse(); } } catch (e) { err.textContent = e.message; }
    } }, 'Ouvrir un fichier…'), delimSel, h('label', { style: 'min-width:0;font-weight:400' }, 'Ne pas importer les ', skip, ' premières lignes')),
    preview, info, summary,
    h('label', { style: 'font-weight:400' }, create, ' Créer les élèves absents de la classe (sinon, seuls les élèves existants sont mis à jour)'),
    err), close => [
      h('button', { onclick: close }, 'Annuler'),
      h('button', { class: 'primary', onclick: () => {
        const roles = roleSelects.map(x => x.value);
        if (!c && !roles.includes('classe')) { err.textContent = 'Aucune classe n’est ouverte : associez une colonne à « Classe » (ou créez d’abord une classe).'; return; }
        if (!roles.includes('nom') && !roles.includes('nomprenom')) { err.textContent = 'Associez au moins une colonne à « Nom » ou « Nom et prénom ».'; return; }
        const rep = X.applyTable(state.classes, rows, importOpts(roles));
        state.classes.forEach(sortStudents);
        if (rep.createdClasses) state.classes.sort((x, y) => collator.compare(x.nom, y.nom));
        if (!cls() && state.classes.length) state.ui.classe = state.classes[0].id;
        commit(); close(); render();
        const lines = [`${rep.created} élève(s) créé(s), ${rep.updated} mis à jour, ${rep.unchanged} inchangé(s)` + (rep.createdClasses ? `, ${rep.createdClasses} classe(s) créée(s)` : '') + '.'];
        if (rep.unmatched.length) lines.push(`Non trouvés (ignorés) : ${rep.unmatched.slice(0, 15).join(', ')}${rep.unmatched.length > 15 ? '…' : ''}`);
        if (rep.invalid.length) lines.push(`Valeurs de note non reconnues (ignorées) : ${rep.invalid.slice(0, 10).join(' ; ')}`);
        alert(lines.join('\n\n'));
      } }, 'Importer')]);
  document.querySelector('.modal:last-of-type').classList.add('wide');
  ta.focus();
}

/* ---------- fiche élève ---------- */
function showStudent() {
  document.querySelector('.drawer')?.remove(); document.querySelector('.backdrop.d')?.remove();
  const c = state.classes.find(k => k.id === openStudent?.classId);
  const s = c?.eleves.find(e => e.id === openStudent.studentId);
  if (!s) { openStudent = null; return; }
  const closeDrawer = () => { openStudent = null; document.querySelector('.drawer')?.remove(); document.querySelector('.backdrop.d')?.remove(); renderTable(); };
  const t = tri();
  const field = (label, key) => h('div', { class: 'row' }, h('label', {}, label), h('input', { value: s[key], onchange: e => { s[key] = e.target.value.trim(); if (key !== 'infos') sortStudents(c); commit(); renderTable(); } }));
  const journal = s.events.map((e, idx) => ({ e, idx })).filter(({ e }) => e.t === t).reverse();
  const noteIn = h('input', { placeholder: 'Précision (facultatif) pour la prochaine entrée…' });
  const quick = (type, v, label) => h('button', { onclick: () => { addEvent(s, type, t, v, noteIn.value.trim()); } }, label);
  const drawer = h('div', { class: 'drawer' },
    h('div', { class: 'row' }, h('h2', { style: 'margin:0;flex:1' }, `${s.nom} ${s.prenom}`), h('button', { onclick: closeDrawer }, '✕ Fermer')),
    h('p', { class: 'muted' }, `Classe ${c.nom}`),
    field('Nom', 'nom'), field('Prénom', 'prenom'), field('Né(e) le', 'naissance'),
    h('h3', {}, 'Informations particulières (handicap, PAI, situation…)'),
    h('textarea', { rows: 4, onchange: e => { s.infos = e.target.value; commit(); renderTable(); } }, s.infos),
    h('h3', {}, 'Notes et commentaires de bulletin'),
    [1, 2, 3].map(k => h('div', {},
      h('div', { class: 'row' }, h('label', {}, `Trimestre ${k}`),
        h('input', { class: 'note', value: s.notes[k] == null ? '' : fmt(s.notes[k]), placeholder: '/20', onchange: e => {
          const raw = e.target.value.trim(), n = parseNum(raw);
          if (raw === '') s.notes[k] = null; else if (n == null || n < 0 || n > 20) { alert('Note invalide (0 à 20).'); return; } else s.notes[k] = n;
          commit(); renderTable(); } }),
        h('span', { class: 'muted' }, `Séance + ${fmt(seance(s, k).plus)} · − ${fmt(seance(s, k).moins)} · travail ${count(s, 'travail', k)} · oublis ${count(s, 'oubli', k)}`)),
      (() => {
        const cnt = h('div', { class: 'muted', style: 'text-align:right;font-size:12px' });
        const upd = len => { cnt.textContent = `${len} / ${prefs.values.appreciationMax}`; cnt.classList.toggle('over', len > prefs.values.appreciationMax); };
        const ta = h('textarea', { rows: 3, placeholder: `Commentaire du trimestre ${k}`, oninput: e => upd(e.target.value.length), onchange: e => { s.comms[k] = e.target.value; commit(); renderTable(); } }, s.comms[k]);
        upd(s.comms[k].length); return [ta, cnt];
      })())),
    h('h3', {}, `Journal du trimestre ${t}`),
    noteIn,
    h('div', { class: 'row' }, quick('seance', 0.5, 'Séance +0,5'), quick('seance', 1, 'Séance +1'), quick('seance', -0.5, 'Séance −0,5'), quick('seance', -1, 'Séance −1'),
      quick('travail', 1, 'Travail non fait'), quick('oubli', 1, 'Oubli matériel')),
    h('div', { class: 'journal' }, journal.length ? journal.map(({ e }) => h('div', {},
      h('span', { class: 'd' }, fmtDate(e.date)),
      h('b', {}, TYPES[e.type] + (e.type === 'seance' ? ' ' + (e.v > 0 ? '+' : '−') + fmt(Math.abs(e.v)) : '')),
      h('span', { class: 'n' }, e.note),
      h('button', { title: 'Supprimer cette entrée', onclick: () => { s.events = s.events.filter(x => x.id !== e.id); commit(); renderTable(); showStudent(); } }, '🗑'))) : h('div', { class: 'muted' }, 'Aucune entrée.')),
    h('p', {}, h('button', { class: 'danger', onclick: () => {
      if (!confirm(`Supprimer définitivement ${s.prenom} ${s.nom} ?`)) return;
      c.eleves = c.eleves.filter(x => x !== s); commit(); closeDrawer();
    } }, 'Supprimer cet élève')));
  const back = h('div', { class: 'backdrop d', onclick: closeDrawer });
  document.body.append(back, drawer);
}

/* ---------- paramètres ---------- */
function showPrefs() {
  if (!prefs || document.querySelector('.modal.prefs')) return;
  const inputs = {};
  const groups = [...new Set(prefs.schema.map(f => f.group))];
  const msg = h('div', { class: 'error' });
  const body = h('div', {}, groups.map(g => h('fieldset', {}, h('legend', {}, g),
    prefs.schema.filter(f => f.group === g).map(f => {
      inputs[f.key] = h('input', { type: 'number', min: f.min, max: f.max, step: f.type === 'int' ? 1 : 0.5, value: prefs.values[f.key] });
      return h('div', { class: 'pref' }, h('label', {}, f.label), inputs[f.key], h('span', { class: 'muted' }, f.unit || ''));
    }))),
    h('p', { class: 'muted', style: 'font-size:12px' }, 'Réglages enregistrés dans : ' + prefs.file), msg);
  const apply = async (call, close) => {
    try { prefs = await call(); resetIdle(); close(); render(); }
    catch (e) { msg.textContent = e.message; }
  };
  const close = modal('Préférences', body, close => [
    h('button', { onclick: () => { if (confirm('Revenir aux réglages par défaut ?')) apply(() => window.api.resetPrefs(), close); } }, 'Valeurs par défaut'),
    h('span', { class: 'spacer' }), h('button', { onclick: close }, 'Annuler'),
    h('button', { class: 'primary', onclick: () => {
      const v = Object.fromEntries(prefs.schema.map(f => [f.key, inputs[f.key].value]));
      apply(() => window.api.setPrefs(v), close);
    } }, 'Enregistrer')]);
  body.closest('.modal').classList.add('prefs');
}
document.addEventListener('keydown', e => { if (e.ctrlKey && e.key === ',') { e.preventDefault(); showPrefs(); } });

function showSettings() {
  const annee = h('input', { value: state.settings.annee, placeholder: 'ex. 2026-2027' });
  const cur = h('input', { type: 'password', autocomplete: 'off' }), n1 = h('input', { type: 'password', autocomplete: 'off' }), n2 = h('input', { type: 'password', autocomplete: 'off' });
  const msg = h('div', { class: 'error' });
  modal('Données et mot de passe', h('div', {},
    h('label', {}, 'Année scolaire'), annee,
    h('h3', { style: 'margin-top:20px' }, 'Changer le mot de passe'),
    h('label', {}, 'Mot de passe actuel'), cur, h('label', {}, 'Nouveau mot de passe'), n1, h('label', {}, 'Confirmer'), n2, msg,
    h('p', { class: 'muted', style: 'font-size:12px' }, 'Sauvegardes quotidiennes chiffrées dans le sous-dossier « sauvegardes ».')),
    close => [
      h('button', { onclick: () => window.api.openDir() }, 'Ouvrir le dossier des données'),
      h('span', { class: 'spacer' }), h('button', { onclick: close }, 'Fermer'),
      h('button', { class: 'primary', onclick: async () => {
        msg.textContent = '';
        state.settings.annee = annee.value.trim();
        try {
          if (n1.value || cur.value) {
            if (n1.value.length < MIN_PW) throw new Error(`Le nouveau mot de passe doit contenir au moins ${MIN_PW} caractères.`);
            if (n1.value !== n2.value) throw new Error('Les deux nouveaux mots de passe sont différents.');
            await window.api.changePassword(cur.value, n1.value, state);
            password = n1.value;
          }
          commit(); close(); render();
        } catch (e) { msg.textContent = e.message; }
      } }, 'Enregistrer')]);
}

/* ---------- export ---------- */
function exportDialog(c) {
  const X = Exchange;
  const tSel = h('select', {}, [1, 2, 3].map(t => h('option', { value: t }, `Trimestre ${t}`))); tSel.value = tri();
  const defaults = ['nom', 'prenom', 'note', 'comm'];
  const boxes = X.EXPORT_FIELDS.map(([k, l]) => ({ k, el: h('input', { type: 'checkbox', checked: defaults.includes(k) }), l }));
  const header = h('input', { type: 'checkbox', checked: true });
  const sep = h('select', {}, [['\t', 'Tabulation (collage PRONOTE / Excel)'], [';', 'Point-virgule (CSV)']].map(([v, l]) => h('option', { value: v }, l)));
  const warn = h('div', { class: 'error' }), msg = h('div', { class: 'muted' });
  const build = () => {
    const fields = boxes.filter(b => b.el.checked).map(b => b.k);
    if (!fields.length) { warn.textContent = 'Cochez au moins un champ.'; return null; }
    const r = X.buildExport(c, { fields, t: +tSel.value, header: header.checked, delim: sep.value, maxLen: prefs.values.appreciationMax },
      (s, t) => { const se = seance(s, t); return { plus: se.plus, moins: se.moins, travail: count(s, 'travail', t), oubli: count(s, 'oubli', t) }; });
    warn.textContent = r.tooLong.length ? `⚠ Appréciation(s) de plus de ${prefs.values.appreciationMax} caractères (PRONOTE les refuserait ou les tronquerait) : ${r.tooLong.join(', ')}` : '';
    return r;
  };
  modal(`Exporter ${c.nom}`, h('div', {},
    h('p', { class: 'muted' }, 'Choisissez les champs, comme dans l’export texte de PRONOTE. Le tableau copié se colle directement dans un tableur.'),
    h('div', { class: 'row' }, tSel, sep, h('label', { style: 'min-width:0;font-weight:400' }, header, ' Ligne de titres')),
    h('fieldset', {}, h('legend', {}, 'Champs à exporter'), boxes.map(b => h('label', { style: 'display:inline-block;margin:3px 14px 3px 0;font-weight:400' }, b.el, ' ', b.l))),
    warn, msg, h('p', { class: 'muted', style: 'font-size:12px' }, 'Le fichier enregistré n’est pas chiffré (UTF-8).')),
    close => [
      h('button', { onclick: close }, 'Fermer'), h('span', { class: 'spacer' }),
      h('button', { onclick: async () => { const r = build(); if (r) { await copyText(r.text); msg.textContent = `✓ Copié (${c.eleves.length} lignes). Collez avec Ctrl+V.`; } } }, 'Copier dans le presse-papiers'),
      h('button', { class: 'primary', onclick: async () => {
        const r = build(); if (!r) return;
        const ext = sep.value === '\t' ? 'txt' : 'csv';
        const p = await window.api.exportFile(`${c.nom}-T${tSel.value}.${ext}`, '﻿' + r.text, [{ name: 'Fichier texte', extensions: [ext] }]);
        if (p) msg.textContent = '✓ Enregistré : ' + p;
      } }, 'Enregistrer un fichier…')]);
  document.querySelector('.modal:last-of-type').classList.add('wide');
}

/* ---------- archives ---------- */
const REASONS = { auto: 'automatique', manuel: 'manuelle', demarrage: 'à l’ouverture', fermeture: 'à la fermeture', restauration: 'avant restauration', mdp: 'avant changement de mot de passe' };

function askOldPassword(tryPw) {
  const inp = h('input', { type: 'password', autocomplete: 'off' }), err = h('div', { class: 'error' });
  modal('Mot de passe de l’archive', h('div', {}, h('p', { class: 'muted' }, 'Cette archive date d’un autre mot de passe. Entrez celui qui était utilisé à ce moment-là.'), inp, err),
    close => [h('button', { onclick: close }, 'Annuler'), h('button', { class: 'primary', onclick: async () => { const m = await tryPw(inp.value); if (m) err.textContent = m; else close(); } }, 'Restaurer')]);
  inp.addEventListener('keydown', e => { if (e.key === 'Enter') document.querySelector('.modal:last-of-type .primary').click(); });
}

async function showArchives() {
  if (document.querySelector('.modal.archives')) return;
  await flush();
  const list = h('div', { class: 'journal', style: 'max-height:50vh' });
  const msg = h('div', { class: 'error' });
  const refresh = async () => {
    const items = await window.api.listArchives();
    list.replaceChildren(...(items.length ? items.map(a => h('div', {},
      h('span', { class: 'd', style: 'min-width:130px' }, fmtDate(a.date)),
      h('span', { class: 'n' }, REASONS[a.reason] || a.reason || '—', h('span', { class: 'muted' }, ` · ${Math.max(1, Math.round(a.size / 1024))} Ko`)),
      h('button', { onclick: () => restore(a) }, 'Restaurer'),
      h('button', { title: 'Supprimer cette archive', onclick: async () => { if (confirm('Supprimer cette archive ?')) { await window.api.deleteArchive(a.name); refresh(); } } }, '🗑')))
      : [h('div', { class: 'muted' }, 'Aucune archive pour le moment.')]));
  };
  const apply = data => {
    state = data; state.ui = state.ui || { classe: null, trimestre: 1 };
    if (!cls()) state.ui.classe = state.classes[0]?.id || null;
    openStudent = null; dirty = false; document.querySelectorAll('.modal,.backdrop').forEach(x => x.remove()); render(); setSaved('Archive restaurée ✓');
  };
  const restore = async a => {
    if (!confirm(`Restaurer les données du ${fmtDate(a.date)} ?\n\nLes données actuelles seront remplacées (une archive de l’état actuel est créée juste avant, vous pourrez y revenir).`)) return;
    msg.textContent = '';
    try { apply(await window.api.restoreArchive(a.name)); }
    catch (e) {
      if (e.code !== 'NEED_PASSWORD' && e.code !== 'WRONG_PASSWORD') { msg.textContent = e.message; return; }
      askOldPassword(async pw => { try { apply(await window.api.restoreArchive(a.name, pw)); return null; } catch (e2) { return e2.message; } });
    }
  };
  const p = prefs.values;
  modal('Archives des données', h('div', {},
    h('p', { class: 'muted' }, p.backupMinutes > 0
      ? `Une archive chiffrée est créée toutes les ${p.backupMinutes} min si les données ont changé, ainsi qu’à l’ouverture et à la fermeture. Les modifications sont par ailleurs enregistrées en continu dans le fichier principal.`
      : 'Les archives automatiques périodiques sont désactivées (voir Préférences). Les modifications restent enregistrées en continu.'),
    list, msg),
    close => [
      h('button', { onclick: async () => { try { await window.api.archiveNow(); refresh(); } catch (e) { msg.textContent = e.message; } } }, 'Archiver maintenant'),
      h('button', { onclick: () => window.api.openDir() }, 'Ouvrir le dossier'),
      h('span', { class: 'spacer' }), h('button', { onclick: close }, 'Fermer')]);
  list.closest('.modal').classList.add('archives');
  refresh();
}

window.api.onBeforeClose(flush);
window.addEventListener('beforeunload', () => { if (dirty) flush(); });
showLogin();
