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
  return { id: uid(), nom: nom.trim(), prenom: prenom.trim(), infos, notes: { 1: null, 2: null, 3: null }, comms: { 1: '', 2: '', 3: '' }, events: [] };
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
      h('span', { class: 'spacer' }),
      h('div', { class: 'tri' }, [1, 2, 3].map(t => h('button', { class: t === tri() ? 'active' : '', onclick: () => { state.ui.trimestre = t; render(); } }, 'T' + t))),
      h('input', { type: 'search', placeholder: 'Rechercher un élève…', value: search, oninput: e => { search = e.target.value; renderTable(); } }),
      h('span', { id: 'saved' }, dirty ? 'Modifié…' : 'Enregistré ✓'),
      h('button', { onclick: showPrefs, title: 'Préférences (Ctrl+,)' }, '⚙ Préférences'),
      h('button', { onclick: showSettings }, '🗂 Données'),
      h('button', { onclick: lockApp }, '🔒 Verrouiller')),
    h('div', { class: 'main' }, c ? classView(c) : h('div', { class: 'empty' }, 'Aucune classe. Cliquez sur « ＋ Classe » pour commencer.')));
  if (c) renderTable();
  if (openStudent) showStudent();
}

function classView(c) {
  return h('div', {},
    h('div', { class: 'classbar' },
      h('h2', {}, c.nom, h('span', { class: 'muted', style: 'font-size:13px;font-weight:400' }, ` — ${c.eleves.length} élèves`)),
      h('button', { onclick: () => addStudentsDialog(c) }, '＋ Ajouter des élèves'),
      h('button', { onclick: () => exportClass(c) }, '⭳ Export CSV (bulletins)'),
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
        h('td', {}, h('input', { class: 'comm', value: s.comms[t], placeholder: 'Commentaire pour le bulletin…', onchange: e => { s.comms[t] = e.target.value; commit(); } })));
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

function parseStudents(text) {
  return text.split(/\r?\n/).map(l => l.trim()).filter(Boolean).map(l => {
    const parts = l.split(/[;\t]/).map(x => x.trim());
    if (parts.length >= 2) return { nom: parts[0], prenom: parts[1], infos: parts[2] || '' };
    const w = l.split(/\s+/);                       // « DUPONT Marie » : mots en capitales = nom
    let i = 0; while (i < w.length - 1 && w[i] === w[i].toUpperCase()) i++;
    return i === 0 ? { nom: w[0], prenom: w.slice(1).join(' '), infos: '' } : { nom: w.slice(0, i).join(' '), prenom: w.slice(i).join(' '), infos: '' };
  }).filter(x => x.nom);
}
function addStudentsDialog(c) {
  const ta = h('textarea', { rows: 10, placeholder: 'Un élève par ligne :\nDUPONT Marie\nMARTIN;Paul;PAI asthme' });
  modal(`Ajouter des élèves à ${c.nom}`,
    h('div', {}, h('p', { class: 'muted' }, 'Collez la liste (depuis Excel par exemple) : « NOM Prénom », ou colonnes NOM ; Prénom ; Infos.'), ta),
    close => [
      h('button', { onclick: async () => { const t = await window.api.importFile([{ name: 'Texte / CSV', extensions: ['csv', 'txt'] }]); if (t) ta.value += (ta.value ? '\n' : '') + t; } }, 'Importer un fichier CSV…'),
      h('span', { class: 'spacer' }), h('button', { onclick: close }, 'Annuler'),
      h('button', { class: 'primary', onclick: () => {
        const list = parseStudents(ta.value);
        list.forEach(x => c.eleves.push(newStudent(x.nom, x.prenom, x.infos)));
        sortStudents(c); commit(); close(); render();
      } }, 'Ajouter')]);
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
    field('Nom', 'nom'), field('Prénom', 'prenom'),
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
      h('textarea', { rows: 3, placeholder: `Commentaire du trimestre ${k}`, onchange: e => { s.comms[k] = e.target.value; commit(); renderTable(); } }, s.comms[k]))),
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
function exportClass(c) {
  const q = v => `"${String(v ?? '').replace(/"/g, '""').replace(/\r?\n/g, ' ')}"`;
  const head = ['n°', 'Nom', 'Prénom', 'Infos'];
  for (const t of [1, 2, 3]) head.push(`T${t} note`, `T${t} séance +`, `T${t} séance −`, `T${t} travail non fait`, `T${t} oublis`, `T${t} commentaire`);
  head.push('Moyenne');
  const lines = [head.map(q).join(';')];
  c.eleves.forEach((s, i) => {
    const row = [i + 1, s.nom, s.prenom, s.infos];
    for (const t of [1, 2, 3]) { const se = seance(s, t); row.push(s.notes[t] == null ? '' : fmt(s.notes[t]), fmt(se.plus), fmt(se.moins), count(s, 'travail', t), count(s, 'oubli', t), s.comms[t]); }
    const m = moyenne(s); row.push(m == null ? '' : fmt(m));
    lines.push(row.map(q).join(';'));
  });
  window.api.exportFile(`bulletins-${c.nom}.csv`, '﻿' + lines.join('\r\n'), [{ name: 'CSV (Excel)', extensions: ['csv'] }])
    .then(p => { if (p) alert('Fichier enregistré :\n' + p + '\n\nAttention : il n’est pas chiffré.'); });
}

window.addEventListener('beforeunload', () => { if (dirty) flush(); });
showLogin();
