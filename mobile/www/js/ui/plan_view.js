// Vue « Plan de classe » : la salle vue d'en haut, une place (chaise + bureau) par rectangle, avec pastilles de compteurs.
// Au doigt : glisser un élève sur une place pour le placer ou l'échanger, toucher une pastille pour noter, appui long pour le menu d'une place.
import * as C from "../core/columns.js";
import * as M from "../core/model.js";
import * as P from "../core/plan.js";
import { fmtNum, norm } from "../core/util.js";
import { COUNTER_KINDS, buildColumns, counterState, directLevels, gradeMeanOf, gradeState } from "./columns_build.js";
import { confirmDialog, h, menu, modal, promptDialog, alertDialog, select } from "./dom.js";
import { openStudentSheet } from "./student.js";

const LONG_PRESS_MS = 520, MOVE_PX = 9;
let ctx = null;
function measure(text, font) {
  if (!ctx) ctx = document.createElement("canvas").getContext("2d");
  ctx.font = font;
  return Math.ceil(ctx.measureText(text).width);
}

/** Dessine un repère (rectangle en pointillés + texte, vertical si son angle est de 90°) ; commun à l'éditeur de salle et au plan. */
export function markerEl(m, extra = {}) {
  const vertical = (m.angle || 0) === 90;
  return h("div", { class: "marker" + (vertical ? " v" : ""), style: { left: m.x + "px", top: m.y + "px", width: m.w + "px", height: m.h + "px", ...extra } }, m.texte);
}

export function renderPlan(app, cls, shell) {
  const state = app.state, t = app.t;
  const plans = cls.plans || [];
  const plan = P.activePlan(cls);
  const salles = state.salles || (state.salles = []);
  const salle = plan ? P.find(salles, plan.salle) : null;
  if (plan) P.clean(plan, salle, cls);
  const mode = app.values.planAffichage;
  const zoomPct = state.ui.zoomPlan || 100, z = zoomPct / 100;
  const students = Object.fromEntries(cls.eleves.map((s) => [s.id, s]));
  const q = norm(app.search);
  const commit = () => app.commit();

  // ----- barre d'outils
  const planSel = select(plans.map((p) => [p.id, p.nom]), plan ? plan.id : "", { "aria-label": "Répartition", disabled: !plans.length });
  planSel.addEventListener("change", () => { cls.plan_actif = planSel.value; commit(); });
  const salleSel = select(salles.map((s) => [s.id, s.nom]), salle ? salle.id : "", { "aria-label": "Salle", disabled: !salles.length || !plan });
  if (!salle && salles.length) salleSel.insertBefore(h("option", { value: "", selected: true }, "— choisir —"), salleSel.firstChild), salleSel.value = "";
  salleSel.addEventListener("change", async () => {
    const neu = salles.find((s) => s.id === salleSel.value);
    if (!plan || !neu || neu.id === plan.salle) return;
    const ids = new Set(neu.places.map((p) => p.id)), lost = Object.keys(plan.places).filter((p) => !ids.has(p));
    if (lost.length && !(await confirmDialog(`${lost.length} élève(s) n'auront plus de place dans la nouvelle salle (leurs places n'y existent pas).\n\nChanger quand même de salle ?`, { title: "Changer de salle" }))) { app.requestRender(); return; }
    plan.salle = neu.id;
    commit();
  });
  const modeSel = select(P.DISPLAY_MODES, mode, { "aria-label": "Noms affichés" });
  modeSel.addEventListener("change", () => app.setPrefs({ planAffichage: modeSel.value }).then(() => app.requestRender()));

  const newPlan = async (copyFrom = null) => {
    const name = await promptDialog({ title: "Nouvelle répartition", label: "Nom de la répartition (ex. Plan T2)", value: copyFrom ? `${copyFrom.nom} (copie)` : `Plan ${plans.length + 1}`, validate: (v) => (v.trim() ? null : "Donnez un nom.") });
    if (!name) return;
    const p = P.newPlan(name.trim(), (plan && plan.salle) || (salles[0] && salles[0].id) || null);
    if (copyFrom) { p.salle = copyFrom.salle; p.places = { ...copyFrom.places }; }
    P.plans(cls).push(p);
    cls.plan_actif = p.id;
    commit();
  };
  const planMenu = (anchor) => menu(anchor, [
    { label: "Dupliquer la répartition", icon: "⧉", disabled: !plan, onClick: () => newPlan(plan) },
    { label: "Renommer…", icon: "✏", disabled: !plan, onClick: async () => { const n = await promptDialog({ title: "Renommer la répartition", label: "Nouveau nom", value: plan.nom, validate: (v) => (v.trim() ? null : "Donnez un nom.") }); if (n) { plan.nom = n.trim(); commit(); } } },
    { label: "Supprimer…", icon: "🗑", danger: true, disabled: !plan, onClick: async () => {
      if (await confirmDialog(`Supprimer la répartition « ${plan.nom} » ?\n\n(Annuler la suppression reste possible avec le bouton ↶.)`, { okLabel: "Supprimer", danger: true, title: "Supprimer la répartition" })) {
        cls.plans = cls.plans.filter((p) => p !== plan);
        cls.plan_actif = cls.plans.length ? cls.plans[0].id : null;
        commit();
      }
    } }]);

  const setZoom = (pct) => { pct = Math.min(200, Math.max(50, Math.round(pct / 10) * 10)); if (pct !== zoomPct) { state.ui.zoomPlan = pct; app.markUi(); app.requestRender(); } };
  let wrap = null;
  const fit = () => {
    if (!salle || !wrap) return;
    const [bw, bh] = P.bounds(salle);
    setZoom(Math.min((wrap.clientWidth - 4) / bw, (wrap.clientHeight - 4) / bh) * 100);
  };

  const tools = h("div", { class: "plantools" },
    h("span", { class: "muted" }, "Répartition"), planSel,
    h("button", { class: "btn small", type: "button", onclick: () => newPlan() }, "Nouvelle"),
    h("button", { class: "btn small icon", type: "button", "aria-label": "Autres actions", onclick: (e) => planMenu(e.currentTarget) }, "⋯"),
    h("span", { class: "muted", style: { marginLeft: "10px" } }, "Salle"), salleSel,
    h("button", { class: "btn small", type: "button", onclick: async () => (await import("./salle_editor.js")).openSalles(app) }, "Salles…"),
    h("div", { class: "grow" }),
    modeSel,
    h("div", { class: "row", style: { gap: "2px" } },
      h("button", { class: "btn small icon", type: "button", "aria-label": "Réduire", onclick: () => setZoom(zoomPct - 10) }, "−"),
      h("span", { style: { minWidth: "46px", textAlign: "center" } }, zoomPct + " %"),
      h("button", { class: "btn small icon", type: "button", "aria-label": "Agrandir", onclick: () => setZoom(zoomPct + 10) }, "+"),
      h("button", { class: "btn small", type: "button", onclick: fit }, "Ajuster")),
    h("button", { class: "btn small", type: "button", disabled: !plan || !salle, onclick: () => fillDialog(app, cls, plan, salle) }, "Répartir…"),
    h("button", { class: "btn small", type: "button", disabled: !plan || !Object.keys(plan.places).length, onclick: async () => {
      if (await confirmDialog("Retirer tous les élèves de leur place ?", { title: "Vider la répartition", okLabel: "Vider" })) { for (const k of Object.keys(plan.places)) delete plan.places[k]; commit(); }
    } }, "Vider"));

  const root = h("div", { class: "planview", style: { display: "flex", flexDirection: "column", flex: "1 1 auto", minHeight: 0 } }, tools);

  // ----- messages quand il manque une salle ou une répartition
  if (!salle || !plan) {
    const msg = !salles.length ? "Aucune salle n'est définie.\nTouchez « Salles… » pour dessiner le plan de votre salle, puis créez une répartition."
      : !plan ? "Cette classe n'a pas encore de répartition.\nTouchez « Nouvelle » pour en créer une." : "Choisissez une salle pour cette répartition (liste « Salle »).";
    root.append(h("div", { class: "empty", style: { whiteSpace: "pre-line" } }, msg));
    return root;
  }

  // ----- places
  const cols = buildColumns(app).filter((c) => COUNTER_KINDS.includes(c.kind) || c.kind === "grade");
  const icons = app.values.pictogrammes === "oui";
  const names = P.displayNames(cls.eleves, mode);
  const { w: sw, h: sh } = salle.place;
  const [bw, bh] = P.bounds(salle);
  const canvas = h("div", { class: "canvas", style: { width: bw + "px", height: bh + "px", transform: `scale(${z})` } });
  const box = h("div", { style: { width: bw * z + "px", height: bh * z + "px", position: "relative" } }, canvas);
  const seatEls = {};
  for (const m of salle.reperes) canvas.append(markerEl(m));

  const chipFont = "13px system-ui, sans-serif";
  const chipLabels = (s) => cols.map((col) => {
    if (col.kind === "grade") {
      const [text, level, n] = gradeState(app, col, s, t);
      let label = n ? text : "–";
      if (n && !directLevels(col.levels)) label = `${M.gradeRank(gradeMeanOf(col, s, t), col.levels.length)}/${col.levels.length}`;  // noms longs : le rang
      const title = C.GRADE_KEYS.includes(col.key) ? C.builtin(app.state.settings, col.key, true).titre : col.title;
      return { col, level, text: `${icons && col.icon ? col.icon : P.initialText(title)}${label}` };
    }
    const [value, level] = counterState(app, col, s, t);
    return { col, level, text: `${icons && col.icon ? col.icon : P.initialText(col.title)}${fmtNum(value)}` };
  });

  const counterMenuItems = (s, col) => {
    if (col.kind === "grade") {
      const names2 = col.levels, g = C.gradeCfg(col.cfg);
      const [text, , n] = gradeState(app, col, s, t);
      const items = names2.map((name, i) => ({ label: `${col.title} : ${name}`, onClick: () => { M.addEvent(s, col.event, t, names2.length - i); commit(); } }));
      items.push({ separator: true }, { header: `Note finale : ${text}${n ? ` (${n} note${n > 1 ? "s" : ""})` : ""}` }, { header: C.ruleLabel(g.regle, g.x, app.per.word) });
      const period = M.gradeEvents(s, col.event, t);
      if (period.length) items.push({ label: `Annuler la dernière note (${M.gradeLetter(period[period.length - 1].v, names2)})`, icon: "↶", onClick: () => { M.removeLast(s, col.event, t); commit(); } });
      return items;
    }
    const items = col.increments.map((v) => ({ label: `${col.title} ${C.incrementLabel(v)}`, onClick: () => { M.addEvent(s, col.event, t, v); commit(); } }));
    items.push({ label: `${col.title} : saisir le total…`, onClick: async () => {
      const [value] = counterState(app, col, s, t);
      const nv = await promptDialog({ title: col.title, label: `Total de « ${col.title} » pour ${s.prenom} ${s.nom}`, numeric: true, value: fmtNum(value),
        validate: (x) => (x.trim() !== "" && Number.isFinite(Number(x.trim().replace(",", "."))) ? null : "Entrez un nombre (par exemple 2,5).") });
      if (nv === null) return;
      const target = Number(nv.trim().replace(",", "."));
      if (col.kind === "seance") M.setSeanceTotal(s, t, col.key === "seancePlus" ? "plus" : "moins", Math.abs(target)); else M.setTotal(s, col.event, t, target);
      commit();
    } });
    return items;
  };

  const buildChips = (s, dim) => {
    const labels = chipLabels(s);
    const cw = Math.max(30, ...labels.map((l) => measure(l.text, chipFont))) + 16;
    const perRow = Math.max(1, Math.floor((sw - 10) / (cw + 4))), rows = Math.max(1, Math.floor((sh - 34) / 32));
    const cap = perRow * rows;
    const shown = labels.length <= cap ? labels : labels.slice(0, cap - 1);
    const els = shown.map((l) => h("button", { class: "pchip " + l.level, type: "button", style: { width: cw + "px", fontSize: "13px" }, "aria-label": l.col.title, dataset: { chip: l.col.key },
      onpointerdown: (e) => e.stopPropagation(),
      onclick: (e) => {
        e.stopPropagation();
        if (l.col.kind === "grade") menu(e.currentTarget, counterMenuItems(s, l.col));
        else { M.addEvent(s, l.col.event, t, P.primaryIncrement(l.col.increments)); commit(); }
      } }, l.text));
    if (labels.length > cap) els.push(h("button", { class: "pchip", type: "button", style: { width: cw + "px" }, "aria-label": "Autres colonnes", onpointerdown: (e) => e.stopPropagation(),
      onclick: (e) => { e.stopPropagation(); menu(e.currentTarget, labels.slice(cap - 1).flatMap((l) => [{ header: `${l.col.icon || ""} ${l.col.title}`.trim() }, ...counterMenuItems(s, l.col)])); } }, "⋯"));
    return h("div", { class: "chips2" }, els);
  };

  const freeMenu = (anchor, pid) => {
    const free = P.withoutPlace(plan, cls);
    menu(anchor, free.length ? [{ header: "Placer un élève ici" }, ...free.map((st) => ({ label: P.listName(st), onClick: () => { P.assign(plan, pid, st.id); commit(); } }))] : [{ header: "Tous les élèves ont une place" }]);
  };
  const seatMenu = (anchor, pid, s) => menu(anchor, [
    { label: "Ouvrir la fiche", icon: "📋", onClick: () => openStudentSheet(app, cls, s) },
    { label: "Retirer de sa place", icon: "⤴", onClick: () => { P.unassign(plan, s.id); commit(); } },
    { separator: true }, ...cols.map((col) => ({ label: `${col.icon || ""} ${col.title}`.trim(), disabled: false, onClick: () => menu(anchor, counterMenuItems(s, col)) }))]);

  for (const place of salle.places) {
    const sid = plan.places[place.id], s = sid ? students[sid] : null;
    const style = { left: place.x + "px", top: place.y + "px", width: sw + "px", height: sh + "px" };
    let seat;
    if (!s) {
      seat = h("div", { class: "seat free", style, dataset: { pid: place.id }, role: "button", "aria-label": "Place libre" }, "libre");
      seat.addEventListener("click", () => freeMenu(seat, place.id));
    } else {
      const dim = !!q && !norm(`${s.nom} ${s.prenom}`).includes(q);
      seat = h("div", { class: "seat" + (dim ? " dim" : ""), style, dataset: { pid: place.id, sid: s.id } },
        h("div", { class: "nm", title: names[s.id] }, names[s.id]), buildChips(s, dim));
      startDragOn(seat, s, place.id);
    }
    canvas.append(seat);
    seatEls[place.id] = seat;
  }

  // ----- liste des élèves sans place
  const freeList = P.withoutPlace(plan, cls);
  const side = h("div", { class: "sideplan" }, h("h4", {}, `Sans place (${freeList.length})`),
    freeList.map((s) => { const el = h("div", { class: "pupil", dataset: { sid: s.id } }, P.listName(s)); startDragOn(el, s, null); return el; }),
    h("p", { class: "hint" }, "Glissez un élève sur une place libre. Glissez un nom de la salle ici pour le retirer de sa place."));

  // ----- glisser-déposer (doigt, stylet ou souris) ; appui long = menu
  function startDragOn(el, s, origin) {
    el.addEventListener("pointerdown", (e) => {
      if (e.button !== undefined && e.button > 0) return;
      const start = { x: e.clientX, y: e.clientY }, pid = e.pointerId;
      let active = false, ghost = null, hover = null, longTimer = null, cancelled = false;
      const clearHover = () => { if (hover) hover.classList.remove("over"); hover = null; };
      const target = (x, y) => {
        if (ghost) ghost.style.display = "none";
        const node = document.elementFromPoint(x, y);
        if (ghost) ghost.style.display = "";
        return node;
      };
      if (origin !== null) longTimer = setTimeout(() => { cancelled = true; cleanup(); seatMenu(el, origin, s); }, LONG_PRESS_MS);
      const move = (ev) => {
        if (ev.pointerId !== pid || cancelled) return;
        if (!active && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) > MOVE_PX) {
          active = true;
          clearTimeout(longTimer);
          ghost = h("div", { class: "dragghost" }, names[s.id] || P.listName(s));
          document.body.append(ghost);
          el.style.opacity = ".4";
        }
        if (!active) return;
        ghost.style.left = ev.clientX + 14 + "px"; ghost.style.top = ev.clientY - 20 + "px";
        const node = target(ev.clientX, ev.clientY);
        const over = node && (node.closest(".seat") || node.closest(".sideplan"));
        if (over !== hover) { clearHover(); hover = over; if (hover) hover.classList.add("over"); }
      };
      const cleanup = () => {
        clearTimeout(longTimer);
        document.removeEventListener("pointermove", move);
        document.removeEventListener("pointerup", up);
        document.removeEventListener("pointercancel", up);
        clearHover();
        if (ghost) ghost.remove();
        el.style.opacity = "";
      };
      const up = (ev) => {
        if (ev.pointerId !== pid || cancelled) return;
        const node = active ? target(ev.clientX, ev.clientY) : null;
        cleanup();
        if (!active) { if (ev.type === "pointerup") openStudentSheet(app, cls, s); return; }
        const dest = node && node.closest(".seat");
        if (dest && dest.dataset.pid && dest.dataset.pid !== origin) { P.assign(plan, dest.dataset.pid, s.id); commit(); }
        else if (node && node.closest(".sideplan") && origin !== null) { P.unassign(plan, s.id); commit(); }
      };
      document.addEventListener("pointermove", move);
      document.addEventListener("pointerup", up);
      document.addEventListener("pointercancel", up);
    });
  }

  wrap = h("div", { class: "canvaswrap" }, box);
  root.append(h("div", { class: "planbody" }, wrap, side));
  return root;
}

// ---------------------------------------------------------------- répartir les élèves
function fillDialog(app, cls, plan, salle) {
  let mode = "alpha";
  const keep = h("input", { type: "checkbox", checked: true });
  const radios = [["alpha", "Dans l'ordre alphabétique (rangée par rangée, du tableau vers le fond de la classe)"], ["hasard", "Au hasard"]].map(([v, l]) =>
    h("label", { class: "check" }, h("input", { type: "radio", name: "fillmode", checked: v === "alpha", onchange: () => { mode = v; } }), l));
  modal({ title: "Répartir les élèves", body: [radios, h("label", { class: "check", style: { marginTop: "10px" } }, keep, "Garder les élèves déjà placés (ne répartir que les autres)")],
    actions: [{ label: "Annuler" }, { label: "Répartir", kind: "primary", onClick: async () => {
      const left = P.autoFill(plan, salle, cls, mode, keep.checked);
      app.commit();
      if (left) await alertDialog(`${left} élève(s) n'ont pas de place : la salle n'a pas assez de places.`, "Répartir les élèves");
    } }] });
}
