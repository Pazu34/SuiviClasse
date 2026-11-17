// Plan de classe : salles (plans génériques de places) et répartitions des élèves d'une classe dans une salle.
// Port de suiviclasse/plan.py (mêmes données, mêmes règles) ; voir ce fichier pour la description du format.
import { cmp, cps, isUpper, norm, pyRound, title, uid } from "./util.js";

export const PLACE_W = 168, PLACE_H = 92;
export const GRID = 10;
export const DISPLAY_MODES = [["prenom_nom", "Prénom Nom"], ["prenom", "Prénom"], ["nom", "Nom"],
  ["prenom_i", "Prénom + initiale du nom"], ["initiales", "Initiales"]];
export const MARKERS = ["Tableau", "Bureau du professeur", "Porte", "Fenêtre"];
export const MIN_MARKER = 20;
export const CORNERS = ["nw", "ne", "sw", "se"];

const strip = (s) => (s || "").trim();
const cap = (nom) => (isUpper(nom) ? title(nom) : nom);  // « DUPONT » s'affiche « Dupont »

// ---------------------------------------------------------------- noms affichés
export function displayName(student, mode = "prenom_nom") {
  const prenom = strip(student.prenom), nom = strip(student.nom), c = cap(nom);
  if (mode === "prenom") return prenom || c;
  if (mode === "nom") return c || prenom;
  if (mode === "initiales") return (cps(prenom, 0, 1) + cps(nom, 0, 1)).toUpperCase() || "?";
  if (mode === "prenom_i") return (nom ? `${prenom} ${cps(nom, 0, 1).toUpperCase()}.` : prenom).trim();
  return `${prenom} ${c}`.trim();
}

function fold(text) {
  return Array.from(text).map((ch) => {
    const f = ch.normalize("NFD").replace(/\p{Mn}/gu, "").toLowerCase();
    return "-_'’".includes(f) ? " " : (f || ch);
  });
}

function commonPrefix(a, b) {
  const fa = fold(a), fb = fold(b);
  let n = 0;
  while (n < Math.min(fa.length, fb.length) && fa[n] === fb[n]) n++;
  return n;
}

/** {id: nom affiché} pour une classe ; les modes abrégés s'allongent pour distinguer deux élèves (« Rayan Bena. » / « Rayan Bend. »). */
export function displayNames(students, mode = "prenom_nom") {
  if (!["prenom", "prenom_i", "initiales"].includes(mode)) return Object.fromEntries(students.map((s) => [s.id, displayName(s, mode)]));
  const key = (s) => {
    const prenom = fold(strip(s.prenom)), nom = fold(strip(s.nom));
    return mode === "initiales" ? JSON.stringify([prenom.slice(0, 1), nom.slice(0, 1)]) : JSON.stringify(prenom);
  };
  const groups = new Map();
  for (const s of students) { const k = key(s); if (!groups.has(k)) groups.set(k, []); groups.get(k).push(s); }
  const out = {};
  for (const group of groups.values()) {
    for (const s of group) {
      const prenom = strip(s.prenom), nom = strip(s.nom);
      const others = group.filter((o) => o !== s).map((o) => strip(o.nom));
      if ((mode === "prenom" && !others.length) || !nom) { out[s.id] = displayName(s, mode); continue; }
      const k = 1 + Math.max(0, ...others.map((o) => commonPrefix(nom, o)));
      const c = cap(nom), head = cps(c, 0, k);
      const part = cps(head, 0, 1).toUpperCase() + cps(head, 1);
      if (mode === "initiales") out[s.id] = prenom ? cps(prenom, 0, 1).toUpperCase() + part : part;
      else out[s.id] = `${prenom} ${part}${k < Array.from(nom).length ? "." : ""}`.trim();
    }
  }
  return out;
}

export const listName = (s) => `${s.nom.toUpperCase()} ${s.prenom}`.trim();

// ---------------------------------------------------------------- salles
export const newSalle = (nom = "Nouvelle salle") => ({ id: uid(), nom, place: { w: PLACE_W, h: PLACE_H }, places: [], reperes: [] });

export function addPlace(salle, x, y) {
  const p = { id: uid(), x: Math.trunc(x), y: Math.trunc(y) };
  salle.places.push(p);
  return p;
}

export const markerSize = (texte) => (texte === "Tableau" ? [360, 34] : texte.includes("Bureau") ? [260, 34] : [130, 34]);

export function addMarker(salle, texte, x, y, w = null, h = null, angle = 0) {
  const [dw, dh] = markerSize(texte);
  const m = { id: uid(), texte, x: Math.trunc(x), y: Math.trunc(y), w: Math.trunc(w || dw), h: Math.trunc(h || dh), angle };
  salle.reperes.push(m);
  return m;
}

export function nextMarkerSpot(salle) {
  const bottom = salle.places.length ? Math.max(...salle.places.map((p) => p.y + salle.place.h)) : 40;
  const band = salle.reperes.filter((m) => m.y >= bottom);
  return [band.length ? Math.max(...band.map((m) => m.x + m.w + 20)) : 40, bottom + 30];
}

export function addRows(salle, rows, cols, { x0 = 40, y0 = 40, gapX = 14, gapY = 22, pairGap = 0, group = 1 } = {}) {
  const { w, h } = salle.place, out = [];
  for (let r = 0; r < rows; r++) {
    let x = x0;
    for (let c = 0; c < cols; c++) {
      if (c && group > 1 && c % group === 0) x += pairGap;
      out.push(addPlace(salle, x, y0 + r * (h + gapY)));
      x += w + gapX;
    }
  }
  return out;
}

export function addIslands(salle, rows, cols, { perRow = 2, perCol = 2, x0 = 40, y0 = 40, gapX = 6, gapY = 6, islandGap = 40 } = {}) {
  const { w, h } = salle.place, out = [];
  const iw = perRow * w + (perRow - 1) * gapX, ih = perCol * h + (perCol - 1) * gapY;
  for (let ir = 0; ir < rows; ir++) for (let ic = 0; ic < cols; ic++) {
    const ox = x0 + ic * (iw + islandGap), oy = y0 + ir * (ih + islandGap);
    for (let j = 0; j < perCol; j++) for (let i = 0; i < perRow; i++) out.push(addPlace(salle, ox + i * (w + gapX), oy + j * (h + gapY)));
  }
  return out;
}

export const snap = (v, grid = GRID) => Math.trunc(pyRound(v / grid) * grid);

export function bounds(salle, margin = 40) {
  const { w, h } = salle.place;
  const xs = [...salle.places.map((p) => p.x + w), ...salle.reperes.map((m) => m.x + m.w)];
  const ys = [...salle.places.map((p) => p.y + h), ...salle.reperes.map((m) => m.y + m.h)];
  return [(xs.length ? Math.max(...xs) : 400) + margin, (ys.length ? Math.max(...ys) : 300) + margin];
}

export function frontIsBottom(salle) {
  if (!salle.places.length) return false;
  const mean = salle.places.reduce((a, p) => a + p.y, 0) / salle.places.length;
  return salle.reperes.some((m) => norm(m.texte) === "tableau" && m.y > mean);
}

export function readingOrder(salle) {
  const h = salle.place.h;
  const row = (p) => pyRound(p.y / (h * 0.6));
  const fromFront = frontIsBottom(salle);
  return [...salle.places].sort((a, b) => cmp([fromFront ? -row(a) : row(a), a.x], [fromFront ? -row(b) : row(b), b.x])).map((p) => p.id);
}

export const find = (salles, id) => salles.find((s) => s.id === id) || null;

export function demoSalle() {
  const s = newSalle("Salle d'exemple");
  addRows(s, 3, 4);
  const width = 4 * s.place.w + 3 * 14;
  const [x, y] = nextMarkerSpot(s);
  addMarker(s, "Tableau", x + Math.floor((width - 360) / 2) - 120, y);
  addMarker(s, "Bureau du professeur", x + width - markerSize("Bureau du professeur")[0], y);
  return s;
}

// ---------------------------------------------------------------- répartitions
export const newPlan = (nom, salleId) => ({ id: uid(), nom, salle: salleId, places: {} });
export function plans(cls) { if (!cls.plans) cls.plans = []; return cls.plans; }

export function activePlan(cls) {
  const lst = cls.plans || [];
  return lst.find((p) => p.id === cls.plan_actif) || lst[0] || null;
}

export const placeOf = (plan, sid) => Object.keys(plan.places).find((p) => plan.places[p] === sid) ?? null;

export function unassign(plan, sid) {
  for (const p of Object.keys(plan.places)) if (plan.places[p] === sid) delete plan.places[p];
}

/** Place l'élève ; s'il y a déjà quelqu'un, les deux échangent leur place. */
export function assign(plan, placeId, sid) {
  const origin = placeOf(plan, sid), occupant = plan.places[placeId];
  if (occupant === sid) return;
  unassign(plan, sid);
  if (occupant !== undefined && occupant !== null && origin !== null) plan.places[origin] = occupant;
  plan.places[placeId] = sid;
}

export function clean(plan, salle, cls) {
  if (!salle) return;
  const ids = new Set(salle.places.map((p) => p.id)), students = new Set(cls.eleves.map((s) => s.id)), seen = new Set();
  for (const [placeId, sid] of Object.entries(plan.places)) {
    if (!ids.has(placeId) || !students.has(sid) || seen.has(sid)) delete plan.places[placeId];
    else seen.add(sid);
  }
}

export function withoutPlace(plan, cls) {
  const placed = new Set(Object.values(plan.places));
  return cls.eleves.filter((s) => !placed.has(s.id)).sort((a, b) => cmp([norm(a.nom), norm(a.prenom)], [norm(b.nom), norm(b.prenom)]));
}

export function autoFill(plan, salle, cls, mode = "alpha", keep = true) {
  if (!keep) for (const k of Object.keys(plan.places)) delete plan.places[k];
  clean(plan, salle, cls);
  const free = readingOrder(salle).filter((p) => !(p in plan.places));
  const students = withoutPlace(plan, cls);
  if (mode === "hasard") for (let i = students.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [students[i], students[j]] = [students[j], students[i]]; }
  free.slice(0, students.length).forEach((placeId, i) => { plan.places[placeId] = students[i].id; });
  return Math.max(0, students.length - free.length);
}

// ---------------------------------------------------------------- pastilles
export const primaryIncrement = (incs) => incs.find((v) => v > 0) ?? (incs.length ? incs[0] : 1);

export function initialText(text) {
  const m = /[\p{L}\p{N}_]/u.exec(norm(text));
  return m ? m[0].toUpperCase() : "?";
}

// ---------------------------------------------------------------- éditeur de salle
export function nextFreeSpot(salle, maxWidth = 1100) {
  const { w, h } = salle.place, stepX = w + 14, stepY = h + 22;
  let y = 80;
  for (let k = 0; k < 60; k++) {
    for (let x = 40; x + w <= maxWidth; x += stepX) {
      if (!salle.places.some((p) => Math.abs(p.x - x) < w && Math.abs(p.y - y) < h)) return [x, y];
    }
    y += stepY;
  }
  return [40, y];
}

export function align(items, how) {
  if (items.length < 2) return;
  if (how === "left") { const x = Math.min(...items.map((i) => i.x)); items.forEach((i) => { i.x = x; }); }
  else if (how === "top") { const y = Math.min(...items.map((i) => i.y)); items.forEach((i) => { i.y = y; }); }
  else if ((how === "hspace" || how === "vspace") && items.length > 2) {
    const key = how === "hspace" ? "x" : "y";
    const ordered = [...items].sort((a, b) => a[key] - b[key]);
    const lo = ordered[0][key], hi = ordered[ordered.length - 1][key];
    ordered.forEach((i, n) => { i[key] = snap(lo + (hi - lo) * n / (ordered.length - 1)); });
  }
}

export function copySalle(salle, nom) {
  return { id: uid(), nom, place: { ...salle.place }, places: salle.places.map((p) => ({ ...p, id: uid() })),
    reperes: salle.reperes.map((m) => ({ ...m, id: uid() })) };
}

export function resizeMarker(m, corner, px, py) {
  px = snap(px); py = snap(py);
  let x0 = m.x, y0 = m.y, x1 = m.x + m.w, y1 = m.y + m.h;
  if (corner.includes("w")) x0 = Math.min(px, x1 - MIN_MARKER); else x1 = Math.max(px, x0 + MIN_MARKER);
  if (corner.startsWith("n")) y0 = Math.min(py, y1 - MIN_MARKER); else y1 = Math.max(py, y0 + MIN_MARKER);
  const nx = Math.max(0, x0), ny = Math.max(0, y0);
  m.x = nx; m.y = ny; m.w = x1 - nx; m.h = y1 - ny;
}

export function rotateMarker(m) {
  const cx = m.x + m.w / 2, cy = m.y + m.h / 2;
  [m.w, m.h] = [m.h, m.w];
  m.x = Math.max(0, snap(cx - m.w / 2)); m.y = Math.max(0, snap(cy - m.h / 2));
  m.angle = (m.angle || 0) === 0 ? 90 : 0;
}

export function rotateRoom(salle) {
  const { w, h } = salle.place;
  const items = [...salle.places.map((p) => [p, w, h]), ...salle.reperes.map((m) => [m, m.w, m.h])];
  if (!items.length) return;
  const loX = Math.min(...items.map(([i]) => i.x)), hiX = Math.max(...items.map(([i, iw]) => i.x + iw));
  const loY = Math.min(...items.map(([i]) => i.y)), hiY = Math.max(...items.map(([i, , ih]) => i.y + ih));
  for (const [i, iw, ih] of items) { i.x = loX + hiX - (i.x + iw); i.y = loY + hiY - (i.y + ih); }
}

export function addDemoPlan(data, cls) {
  if (!data.salles) data.salles = [];
  let salle = data.salles.find((s) => s.nom === "Salle d'exemple");
  if (!salle) { salle = demoSalle(); data.salles.push(salle); }
  const p = newPlan("Plan d'exemple", salle.id);
  autoFill(p, salle, cls, "alpha");
  if (!cls.plans) cls.plans = [];
  cls.plans.push(p);
  cls.plan_actif = p.id;
  return p;
}
