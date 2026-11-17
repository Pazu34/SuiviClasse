// Mode séance : l'écran de la classe en cours de cours. On choisit un OUTIL (un niveau A à E, ou un compteur : « oubli +1 »…), puis on touche
// les élèves : chaque touche ajoute une entrée datée du jour au journal de l'élève — exactement les mêmes données que le tableau, la fiche
// et la version PC. Les cartes montrent qui a déjà été noté aujourd'hui et qui reste à noter.
import * as C from "../core/columns.js";
import * as M from "../core/model.js";
import * as P from "../core/plan.js";
import { fmtNum } from "../core/util.js";
import { COUNTER_KINDS, buildColumns, chipTexts } from "./columns_build.js";
import { h, menu, modal } from "./dom.js";
import { openStudentSheet } from "./student.js";

const LONG_PRESS_MS = 520, MOVE_PX = 9;
const sameDay = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();

/** Entrées d'un élève du jour (heure locale) pour un type d'entrée du journal et la période affichée. */
export function todayEvents(s, event, t, now = new Date()) {
  return s.events.filter((e) => e.type === event && e.t === t && sameDay(M.eventDate(e), now));
}

const layoutPref = () => { try { return localStorage.getItem("seanceLayout") || "liste"; } catch (e) { return "liste"; } };
const saveLayout = (v) => { try { localStorage.setItem("seanceLayout", v); } catch (e) { /* facultatif */ } };

/** Outils proposés : un groupe par colonne affichée (niveaux, puis compteurs), un bouton par niveau ou par incrément. */
export function seanceTools(app) {
  const settings = app.state.settings, groups = [];
  for (const g of C.gradeColumns(settings)) {
    const n = g.niveaux.length;
    const title = C.GRADE_KEYS.includes(g.key) ? C.builtin(settings, g.key, true).titre : g.titre;
    groups.push({ key: g.key, event: g.event, title, emoji: g.emoji, grade: true, names: g.niveaux,
      items: g.niveaux.map((name, i) => ({ id: `${g.key}:${i}`, label: name, value: n - i })) });
  }
  const counters = C.BUILTIN_ORDER.filter((k) => !C.GRADE_KEYS.includes(k)).map((k) => C.builtin(settings, k, true)).filter((c) => c.visible)
    .map((c) => ({ key: c.key, event: C.BUILTIN_EVENT[c.key], title: c.titre, emoji: c.emoji, incs: c.increments, symbolic: c.key === "travail" || c.key === "oubli" }));
  for (const c of C.customs(settings)) if (c.visible && c.type === "compteur") counters.push({ key: c.id, event: c.id, title: c.titre, emoji: c.emoji, incs: c.increments, symbolic: false });
  for (const c of counters) groups.push({ key: c.key, event: c.event, title: c.title, emoji: c.emoji, grade: false,
    items: c.incs.map((v, i) => ({ id: `${c.key}:${i}`, label: C.incrementLabel(v, c.symbolic), value: v })) });
  return groups;
}

export function renderSeance(app, cls, shell) {
  const t = app.t, state = app.state;
  const groups = seanceTools(app);
  const items = groups.flatMap((g) => g.items.map((it) => ({ ...it, group: g })));
  let tool = app.seanceTool && items.find((it) => it.id === app.seanceTool) ? app.seanceTool : null;
  const toolItem = tool ? items.find((it) => it.id === tool) : null;
  app.seanceTool = tool;
  const now = new Date();
  const cols = buildColumns(app).filter((c) => COUNTER_KINDS.includes(c.kind) || c.kind === "grade");
  const names = P.displayNames(cls.eleves, app.values.planAffichage);
  const flash = app.seanceFlash && Date.now() - app.seanceFlash.at < 900 ? app.seanceFlash.id : null;
  const q = app.search ? app.search.toLowerCase() : "";

  // ----- avancement du jour pour l'outil choisi
  const doneIds = toolItem ? new Set(cls.eleves.filter((s) => todayEvents(s, toolItem.group.event, t, now).length).map((s) => s.id)) : new Set();

  function apply(s) {
    M.addEvent(s, toolItem.group.event, t, toolItem.value);
    app.seanceFlash = { id: s.id, at: Date.now() };
    if (navigator.vibrate) navigator.vibrate(12);
    app.commit();
  }

  function cardMenu(anchor, s) {
    const items2 = [{ label: "Ouvrir la fiche", icon: "📋", onClick: () => openStudentSheet(app, cls, s) }];
    if (toolItem) {
      const mine = todayEvents(s, toolItem.group.event, t, now);
      if (mine.length) {
        const last = mine[mine.length - 1];
        const label = toolItem.group.grade ? M.gradeLetter(last.v, toolItem.group.names) : C.incrementLabel(last.v);
        items2.push({ label: `Annuler la dernière entrée du jour (${toolItem.group.title} ${label})`, icon: "↶", onClick: () => { s.events = s.events.filter((x) => x.id !== last.id); app.commit(); } });
      }
    }
    menu(anchor, items2);
  }

  function badges(s) {
    if (!toolItem) return null;
    const mine = todayEvents(s, toolItem.group.event, t, now);
    if (!mine.length) return null;
    return h("div", { class: "today", "aria-label": "Aujourd'hui" }, mine.map((e) => h("span", { class: "tbadge" }, toolItem.group.grade ? M.gradeLetter(e.v, toolItem.group.names) : C.incrementLabel(e.v))));
  }

  function card(s, extraStyle = null, compact = false) {
    const todo = toolItem && toolItem.group.grade && !doneIds.has(s.id);
    const done = toolItem && doneIds.has(s.id);
    const dim = q && !`${s.nom} ${s.prenom}`.toLowerCase().includes(q);
    const el = h("div", { class: "scard" + (compact ? " compact" : "") + (todo ? " todo" : "") + (done ? " done" : "") + (flash === s.id ? " flash" : "") + (dim ? " dim" : ""),
      style: extraStyle, role: "button", dataset: { sid: s.id }, "aria-label": names[s.id] },
      h("div", { class: "nm" }, names[s.id]),
      !compact && s.numero !== null && s.numero !== undefined ? h("div", { class: "no" }, "n° " + s.numero) : null,
      h("div", { class: "chips3" }, chipTexts(app, cols, s, t).map((c) => h("span", { class: "pchip " + c.level }, c.text))),
      badges(s),
      h("button", { class: "info", type: "button", "aria-label": "Ouvrir la fiche", onpointerdown: (e) => e.stopPropagation(), onclick: (e) => { e.stopPropagation(); openStudentSheet(app, cls, s); } }, "ⓘ"));
    // toucher = appliquer l'outil (ou ouvrir la fiche s'il n'y en a pas) ; appui long = menu
    let timer = null, start = null, longDone = false;
    el.addEventListener("pointerdown", (e) => {
      start = [e.clientX, e.clientY]; longDone = false;
      timer = setTimeout(() => { longDone = true; cardMenu(el, s); }, LONG_PRESS_MS);
    });
    const cancel = () => clearTimeout(timer);
    el.addEventListener("pointermove", (e) => { if (start && Math.hypot(e.clientX - start[0], e.clientY - start[1]) > MOVE_PX) cancel(); });
    el.addEventListener("pointercancel", cancel);
    el.addEventListener("pointerup", cancel);
    el.addEventListener("click", () => {
      if (longDone) { longDone = false; return; }
      if (toolItem) apply(s); else openStudentSheet(app, cls, s);
    });
    return el;
  }

  // ----- palette d'outils
  const palette = h("div", { class: "palette" }, groups.map((g) => h("div", { class: "tgroup" }, h("span", { class: "tt" }, `${g.emoji ? g.emoji + " " : ""}${g.title}`),
    g.items.map((it) => h("button", { class: "tool", type: "button", "aria-pressed": tool === it.id, dataset: { tool: it.id }, onclick: () => { app.seanceTool = tool === it.id ? null : it.id; app.requestRender(); } }, it.label)))));
  const progress = h("div", { class: "sprogress", "aria-live": "polite" }, toolItem
    ? [h("strong", {}, `${doneIds.size} / ${cls.eleves.length}`), ` avec une entrée aujourd'hui · ${toolItem.group.title} `, h("strong", {}, toolItem.label)]
    : "Choisissez un outil, puis touchez les élèves. Sans outil, toucher un élève ouvre sa fiche.");
  const layout = layoutPref();
  const salle = (() => { const plan = P.activePlan(cls); return plan ? P.find(state.salles || [], plan.salle) : null; })();
  const plan = P.activePlan(cls);
  const canPlan = !!(salle && plan);
  const useLayout = layout === "plan" && canPlan ? "plan" : "liste";
  const controls = h("div", { class: "scontrols" },
    h("div", { class: "seg", role: "group", "aria-label": "Disposition" }, [["liste", "Liste"], ["plan", "Plan"]].map(([v, l]) =>
      h("button", { type: "button", disabled: v === "plan" && !canPlan, "aria-pressed": useLayout === v, onclick: () => { saveLayout(v); app.requestRender(); } }, l))),
    h("button", { class: "btn", type: "button", onclick: () => bilan(app, cls, groups, t) }, "Bilan du jour"),
    h("button", { class: "btn", type: "button", disabled: !app.undo.length, onclick: () => app.undoAction() }, "↶ Annuler"));

  // ----- élèves : liste de cartes ou disposition de la salle
  let body;
  if (useLayout === "plan") {
    const placed = new Set(Object.values(plan.places));
    const [bw, bh] = P.bounds(salle, 20);
    const z = Math.max(0.5, Math.min((window.innerWidth - 24) / bw, (window.innerHeight - 260) / bh, 1.8));
    const students = Object.fromEntries(cls.eleves.map((s) => [s.id, s]));
    const canvas = h("div", { class: "canvas", style: { width: bw + "px", height: bh + "px", transform: `scale(${z})` } });
    for (const m of salle.reperes) canvas.append(h("div", { class: "marker" + ((m.angle || 0) === 90 ? " v" : ""), style: { left: m.x + "px", top: m.y + "px", width: m.w + "px", height: m.h + "px" } }, m.texte));
    for (const place of salle.places) {
      const s = students[plan.places[place.id]];
      const style = { position: "absolute", left: place.x + "px", top: place.y + "px", width: salle.place.w + "px", height: salle.place.h + "px" };
      if (s) canvas.append(card(s, style, true));
      else canvas.append(h("div", { class: "scard empty", style }, ""));
    }
    const rest = cls.eleves.filter((s) => !placed.has(s.id));
    body = h("div", {}, h("div", { style: { width: bw * z + "px", height: bh * z + "px", position: "relative", margin: "0 auto" } }, canvas),
      rest.length ? [h("h4", { class: "muted", style: { margin: "14px 4px 6px" } }, "Sans place"), h("div", { class: "sgrid" }, rest.map((s) => card(s)))] : null);
  } else {
    body = h("div", { class: "sgrid" }, cls.eleves.map((s) => card(s)));
  }
  if (!cls.eleves.length) body = h("div", { class: "empty" }, "Aucun élève dans cette classe.");

  return h("div", { class: "seanceview", style: { display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0 } },
    h("div", { class: "sbar" }, palette, controls), h("div", { class: "sprog" }, progress), h("div", { class: "seancewrap" }, body));
}

// ---------------------------------------------------------------- bilan du jour
function bilan(app, cls, groups, t) {
  const now = new Date();
  const rows = [];
  for (const s of cls.eleves) {
    const parts = [];
    for (const g of groups) {
      const mine = todayEvents(s, g.event, t, now);
      if (mine.length) parts.push(`${g.title} : ${mine.map((e) => (g.grade ? M.gradeLetter(e.v, g.names) : C.incrementLabel(e.v))).join(" ")}`);
    }
    if (parts.length) rows.push([s, parts]);
  }
  const total = rows.reduce((a, [, p]) => a + p.length, 0);
  modal({ title: `Bilan du ${now.toLocaleDateString("fr-FR", { weekday: "long", day: "numeric", month: "long" })}`, body: [
    h("p", { class: "hint" }, rows.length ? `${rows.length} élève(s) avec des entrées aujourd'hui (${total} série(s)). Les entrées sont dans le journal de chaque élève : le tableau, la fiche et la version PC les affichent.` : "Aucune entrée aujourd'hui pour cette classe."),
    h("div", { class: "list" }, rows.map(([s, parts]) => h("div", { class: "item" }, h("div", { class: "t" }, `${s.nom} ${s.prenom}`.trim(), h("small", { style: { whiteSpace: "normal" } }, parts.join(" · "))),
      h("button", { class: "btn small", type: "button", onclick: () => openStudentSheet(app, cls, s) }, "Fiche"))))],
  actions: [{ label: "Fermer", kind: "primary" }] });
}
