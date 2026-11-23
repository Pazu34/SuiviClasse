// Échanges de tableaux avec PRONOTE (et tout tableur) : analyse de texte collé ou de fichiers texte, association de colonnes,
// lecture des notes avec les annotations PRONOTE, export. Port de suiviclasse/exchange.py (fonctions pures).
import { fmtNum, norm } from "./util.js";

export { norm, fmtNum };

export function detectDelimiter(text) {
  const t = text.replace(/^\ufeff+/, "");
  const first = t.trim() ? t.split(/\r\n|[\n\r\v\f\x1c-\x1e\x85\u2028\u2029]/)[0] : "";
  for (const d of ["\t", ";", ","]) if (first.includes(d)) return d;
  return "\t";
}

/** Analyse CSV/TSV avec guillemets (les retours à la ligne dans une cellule sont gérés). */
export function parseTable(text, delim = null) {
  text = text.replace(/^\ufeff+/, "");
  delim = delim || detectDelimiter(text);
  const rows = [];
  let row = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++; } else quoted = false;
      } else cell += c;
    } else if (c === '"' && cell === "") quoted = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\r" || c === "\n") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); rows.push(row); row = []; cell = "";
    } else cell += c;
  }
  if (cell !== "" || row.length) { row.push(cell); rows.push(row); }
  return rows.map((r) => r.map((c) => c.trim())).filter((r) => r.some((c) => c.trim()));
}

export function roleList(prefix = "T", n = 3) {
  const base = [["ignore", "Champ ignoré"], ["nom", "Nom"], ["prenom", "Prénom"], ["nomprenom", "Nom et prénom"],
    ["classe", "Classe"], ["naissance", "Date de naissance"], ["infos", "Infos (PAI…)"]];
  const idx = Array.from({ length: n }, (_, i) => i + 1);
  return [...base, ...idx.map((i) => [`note${i}`, `Note ${prefix}${i}`]), ...idx.map((i) => [`comm${i}`, `Appréciation ${prefix}${i}`])];
}

export function guessRole(header, defaultT = 1) {
  const h = norm(header);
  const m = /\b(?:t|s|trimestre\s*|semestre\s*)([123])\b/.exec(h) || /\b([123])\s*(?:er|e|eme|d)?\s*(?:trimestre|semestre)\b/.exec(h);
  const t = m ? m[1] : String(defaultT || 1);
  if (/^(?:nom et prenom|eleve|nom prenom|nom complet)$/.test(h)) return "nomprenom";
  if (/^nom( de famille| usuel)?$/.test(h)) return "nom";
  if (h.includes("prenom")) return "prenom";
  if (h.startsWith("classe")) return "classe";
  if (/^(?:ne\(e\) le|ne le)/.test(h) || h.includes("naissance")) return "naissance";
  if (/appreciation|commentaire|observation/.test(h)) return "comm" + t;
  if (/moyenne|^note|^moy/.test(h)) return "note" + t;
  if (/pai|handicap|^info|amenagement|particular/.test(h)) return "infos";
  return "ignore";
}

export function looksLikeHeader(row) {
  return row.length > 0 && row.every((c) => !/^\d+([.,]\d+)?$/.test(c)) && row.some((c) => guessRole(c) !== "ignore");
}

/** « DUPONT Jean-Pierre » : mots en majuscules = nom ; sinon le premier mot est le nom. */
export function splitFullName(s) {
  const w = s.trim().split(/\s+/).filter(Boolean);
  if (w.length < 2) return [w[0] || "", ""];
  let i = 0;
  while (i < w.length - 1 && w[i] === w[i].toUpperCase() && /[A-ZÀ-Ý]/.test(w[i])) i++;
  if (i === 0) return [w[0], w.slice(1).join(" ")];
  return [w.slice(0, i).join(" "), w.slice(i).join(" ")];
}

// Notes particulières (comme dans PRONOTE : A = Absent « Abs », D = Dispensé « Disp », N = Non noté « N.Not ») : enregistrées sous la forme
// « a », « d » ou « n » à la place d'un nombre ; elles ne comptent dans aucune moyenne.
export const NOTE_CODES = { a: "Abs", n: "N.Not", d: "Disp" };
const CODE_OF = { a: "a", abs: "a", absent: "a", absente: "a", n: "n", nnot: "n", nn: "n", nonnote: "n", nonnotee: "n", d: "d", disp: "d", dispense: "d", dispensee: "d" };

/** 'a' / 'Abs' / 'absent', 'n' / 'N.Not' / 'non noté', 'd' / 'Disp' / 'dispensé' (casse, accents, points ignorés) -> 'a', 'n' ou 'd' ; sinon null. */
export function noteCode(text) {
  const k = norm(String(text)).replace(/[\s.\-_]/g, "");
  return Object.prototype.hasOwnProperty.call(CODE_OF, k) ? CODE_OF[k] : null;
}

export const isNumber = (v) => typeof v === "number" && Number.isFinite(v);

/** Texte affiché d'une note : '' si absente, « Abs » / « N.Not » / « Disp » pour une note particulière, sinon le nombre. */
export function noteText(v) {
  if (v === null || v === undefined) return "";
  return typeof v === "string" ? (NOTE_CODES[v] || "") : fmtNum(v);
}

/** Note d'un tableur PRONOTE : virgule décimale, « /20 » toléré, annotations PRONOTE. Retourne [valeur, genre]. */
export function parseNote(raw) {
  const s = String(raw === null || raw === undefined ? "" : raw).trim();
  if (s === "") return [null, "empty"];
  const t = s.replace(/\s/g, "").replace(/\/\s*\d+([.,]\d+)?$/, "").replace(",", ".");
  if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(t)) return [parseFloat(t), "note"];
  if (/^(?:z|w|abs\*|n\.?\s*rdu\*)$/i.test(s)) return [0.0, "zero"];
  if (/^(?:a|d|n|i|r|abs|disp|n\.?\s*not|inap|n\.?\s*rdu)$/i.test(s)) return [null, "annotation"];
  return [null, "invalid"];
}

const key = (nom, prenom) => norm(nom) + "|" + norm(prenom);

/** Applique un tableau à des classes (modifiées en place) et retourne un compte rendu. */
export function applyTable(classes, rows, roles, skip, classId, createStudents, newStudent, newClass) {
  const rep = { classes: {}, created: 0, updated: 0, unchanged: 0, createdClasses: 0, unmatched: [], invalid: [] };
  const get = (row, role) => { const i = roles.indexOf(role); return i >= 0 && i < row.length ? row[i] : ""; };
  const current = classes.find((c) => c.id === classId) || null;
  for (const row of rows.slice(skip)) {
    let nom = get(row, "nom"), prenom = get(row, "prenom");
    if (!nom && roles.includes("nomprenom")) [nom, prenom] = splitFullName(get(row, "nomprenom"));
    if (!nom) continue;
    let cls = current;
    const cname = get(row, "classe");
    if (cname) {
      cls = classes.find((c) => norm(c.nom) === norm(cname)) || null;
      if (cls === null && createStudents) { cls = newClass(cname); classes.push(cls); rep.createdClasses++; }
    }
    if (cls === null) { rep.unmatched.push(`${nom} ${prenom}`.trim()); continue; }
    const naiss = get(row, "naissance");
    // deux homonymes se distinguent par leur date de naissance (si elle est connue des deux côtés)
    let s = cls.eleves.find((e) => key(e.nom, e.prenom) === key(nom, prenom) && !(naiss && e.naissance && e.naissance !== naiss)) || null;
    let isNew = false;
    if (s === null) {
      if (!createStudents) { rep.unmatched.push(`${nom} ${prenom}`.trim()); continue; }
      s = newStudent(nom, prenom, "");
      cls.eleves.push(s);
      isNew = true;
      rep.created++;
    }
    let changed = false;
    if (naiss && naiss !== s.naissance) { s.naissance = naiss; changed = !isNew; }
    const infos = get(row, "infos");
    if (infos && infos !== s.infos) { s.infos = infos; changed = true; }
    for (const t of ["1", "2", "3"]) {
      if (roles.includes("note" + t)) {
        const raw = get(row, "note" + t);
        const [value, kind] = parseNote(raw);
        if (kind === "invalid") rep.invalid.push(`${s.nom} ${s.prenom} : « ${raw} »`);
        else if (kind !== "empty" && s.notes[t] !== value && value !== null) { s.notes[t] = value; changed = true; }
      }
      if (roles.includes("comm" + t)) {
        const c = get(row, "comm" + t);
        if (c && c !== s.comms[t]) { s.comms[t] = c; changed = true; }
      }
    }
    rep.classes[cls.nom] = (rep.classes[cls.nom] || 0) + 1;
    if (!isNew) rep[changed ? "updated" : "unchanged"]++;
  }
  return rep;
}

export const EXPORT_FIELDS = [
  ["numero", "N°"], ["nom", "Nom"], ["prenom", "Prénom"], ["classe", "Classe"], ["infos", "Infos (PAI…)"],
  ["note", "Note du trimestre"], ["comm", "Appréciation du trimestre"],
  ["seancePlus", "Séance +"], ["seanceMoins", "Séance −"], ["travail", "Travail non fait"], ["oubli", "Oublis de matériel"],
];
const PER_PERIOD = new Set(["note", "comm", "seancePlus", "seanceMoins", "travail", "oubli"]);

/** Construit le texte d'export. stats(eleve, t) -> [séance +, séance −, travail, oublis]. Retourne [texte, appréciations trop longues]. */
export function buildExport(cls, fields, t, header, delim, maxLen, stats, prefix = "T", word = "trimestre", extras = []) {
  const labels = Object.fromEntries(EXPORT_FIELDS), getters = {};
  for (const [k, label, fn] of extras) { labels[k] = label; getters[k] = fn; }
  const q = (v) => {
    const s = String(v === null || v === undefined ? "" : v).replace(/\r?\n/g, " ");
    return s.includes(delim) || s.includes('"') ? '"' + s.replaceAll('"', '""') + '"' : s;
  };
  const lines = [], tooLong = [];
  if (header) lines.push(fields.map((f) => q(labels[f].replaceAll("trimestre", word) + (PER_PERIOD.has(f) || f in getters ? ` ${prefix}${t}` : ""))).join(delim));
  for (const s of cls.eleves) {
    const [plus, moins, travail, oubli] = stats(s, Number(t));
    const note = s.notes[String(t)], comm = s.comms[String(t)];
    const v = { numero: s.numero || "", nom: s.nom, prenom: s.prenom, classe: cls.nom, infos: s.infos, note: noteText(note),
      comm, seancePlus: fmtNum(plus), seanceMoins: fmtNum(moins), travail, oubli };
    for (const [k, fn] of Object.entries(getters)) v[k] = fn(s, Number(t));
    if (maxLen && fields.includes("comm") && Array.from(comm).length > maxLen) tooLong.push(`${s.nom} ${s.prenom} (${Array.from(comm).length})`);
    lines.push(fields.map((f) => q(v[f])).join(delim));
  }
  return [lines.join("\r\n"), tooLong];
}

/** Décode un fichier texte exporté de PRONOTE ou d'Excel : UTF-8 (avec ou sans BOM) ou Windows-1252. */
export function decodeTextFile(bytes) {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\ufeff/, ""); }
  catch (e) { return new TextDecoder("windows-1252").decode(bytes); }
}
