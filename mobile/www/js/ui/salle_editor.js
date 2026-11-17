// Plans de salle : liste des salles et éditeur graphique (places, repères, générateurs, alignement), pensé pour le doigt et le stylet.
import * as P from "../core/plan.js";
import { clone } from "../core/util.js";
import { confirmDialog, h, menu, modal, promptDialog, select } from "./dom.js";

const EDIT_ZOOM = 0.7;
const KINDS = [["Rangées de places individuelles", "Rangées", "Places par rangée"], ["Rangées de binômes (2 places par table)", "Rangées", "Binômes par rangée"],
  ["Îlots de 4 places (2 × 2)", "Îlots en hauteur", "Îlots en largeur"], ["Îlots de 6 places (3 × 2)", "Îlots en hauteur", "Îlots en largeur"]];

// ---------------------------------------------------------------- liste des salles
export function openSalles(app) {
  const list = h("div", { class: "list" });
  const salles = () => app.state.salles || (app.state.salles = []);
  const done = () => { app.commit(); draw(); };

  function newSalle() {
    promptDialog({ title: "Nouvelle salle", label: "Nom de la salle (ex. Salle 12)", value: "Nouvelle salle", validate: (v) => (v.trim() ? null : "Donnez un nom à la salle.") }).then((name) => {
      if (!name) return;
      openSalleEditor(app, P.newSalle(name.trim()), (salle) => { salles().push(salle); done(); }, true);
    });
  }

  function draw() {
    list.replaceChildren();
    if (!salles().length) list.append(h("div", { class: "item muted" }, "Aucune salle pour le moment."));
    salles().forEach((s, i) => list.append(h("div", { class: "item" }, h("div", { class: "t" }, s.nom, h("small", {}, `${s.places.length} places · ${s.reperes.length} repère(s)`)),
      h("button", { class: "btn small", type: "button", onclick: () => openSalleEditor(app, clone(s), (neu) => { Object.keys(s).forEach((k) => delete s[k]); Object.assign(s, neu); done(); }) }, "Modifier"),
      h("button", { class: "btn small icon", type: "button", "aria-label": "Autres actions", onclick: (e) => menu(e.currentTarget, [
        { label: "Dupliquer", icon: "⧉", onClick: () => { salles().push(P.copySalle(s, s.nom + " (copie)")); done(); } },
        { label: "Renommer…", icon: "✏", onClick: async () => { const n = await promptDialog({ title: "Renommer la salle", label: "Nouveau nom", value: s.nom, validate: (v) => (v.trim() ? null : "Donnez un nom.") }); if (n) { s.nom = n.trim(); done(); } } },
        { label: "Supprimer…", icon: "🗑", danger: true, onClick: async () => {
          const used = app.state.classes.flatMap((c) => (c.plans || []).filter((p) => p.salle === s.id).map(() => c.nom));
          const extra = used.length ? `\n\nElle sert à ${used.length} répartition(s) (${[...new Set(used)].sort().join(", ")}) : elles devront choisir une autre salle.` : "";
          if (await confirmDialog(`Supprimer la salle « ${s.nom} » ?${extra}`, { okLabel: "Supprimer", danger: true, title: "Supprimer la salle" })) { salles().splice(i, 1); done(); }
        } }]) }, "⋯"))));
  }
  draw();
  modal({ title: "Plans de salle", body: [h("p", { class: "hint" }, "Une salle est un plan générique (les places, le tableau, le bureau…). Elle sert ensuite à répartir les élèves de n'importe quelle classe."), list],
    actions: [{ label: "Nouvelle salle…", left: true, close: false, onClick: newSalle }, { label: "Fermer", kind: "primary" }] });
}

// ---------------------------------------------------------------- générateur de places
function generatorDialog(salle, redraw) {
  const kind = select(KINDS.map((k, i) => [String(i), k[0]]), "0");
  const n1 = h("input", { type: "number", min: 1, max: 12, value: 4, inputMode: "numeric", style: { width: "90px" } });
  const n2 = h("input", { type: "number", min: 1, max: 12, value: 6, inputMode: "numeric", style: { width: "90px" } });
  const l1 = h("label", { class: "field" }), l2 = h("label", { class: "field" });
  const replace = h("input", { type: "checkbox", checked: !salle.places.length });
  const err = h("div", { class: "error" });
  const labels = () => { const [, a, b] = KINDS[Number(kind.value)]; l1.textContent = a; l2.textContent = b; };
  kind.addEventListener("change", labels); labels();
  modal({ title: "Ajouter des places", body: [kind, l1, n1, l2, n2, h("label", { class: "check", style: { marginTop: "10px" } }, replace, "Remplacer les places existantes (sinon, les ajouter en dessous)"), err],
    actions: [{ label: "Annuler" }, { label: "Ajouter", kind: "primary", close: false, onClick: (ctl) => {
      const a = parseInt(n1.value, 10), b = parseInt(n2.value, 10);
      if (!(a >= 1 && a <= 12 && b >= 1 && b <= 12)) { err.textContent = "Entrez des nombres entre 1 et 12."; return; }
      if (replace.checked) salle.places.length = 0;
      const y0 = !salle.places.length ? 80 : Math.max(...salle.places.map((p) => p.y)) + salle.place.h + 40;
      const k = Number(kind.value);
      if (k === 0) P.addRows(salle, a, b, { y0 });
      else if (k === 1) P.addRows(salle, a, 2 * b, { y0, group: 2, pairGap: 40 });
      else if (k === 2) P.addIslands(salle, a, b, { perRow: 2, perCol: 2, y0 });
      else P.addIslands(salle, a, b, { perRow: 3, perCol: 2, y0 });
      ctl.close();
      redraw();
    } }] });
}

// ---------------------------------------------------------------- éditeur
export function openSalleEditor(app, salle, onSave, first = false) {
  let zoom = EDIT_ZOOM, selecting = false;
  const sel = new Set();
  const itemsOf = () => [...salle.places, ...salle.reperes];
  const byId = (id) => itemsOf().find((i) => i.id === id);
  const markers = () => salle.reperes.filter((m) => sel.has(m.id));

  const nom = h("input", { type: "text", value: salle.nom, style: { width: "220px" }, "aria-label": "Nom de la salle" });
  const inW = h("input", { type: "number", min: 60, max: 400, step: 10, value: salle.place.w, inputMode: "numeric", style: { width: "84px" } });
  const inH = h("input", { type: "number", min: 60, max: 400, step: 10, value: salle.place.h, inputMode: "numeric", style: { width: "84px" } });
  const info = h("span", { class: "muted" });
  const err = h("div", { class: "error", style: { margin: "0 12px" } });
  const canvas = h("div", { class: "canvas" });
  const box = h("div", { style: { position: "relative" } }, canvas);
  const wrap = h("div", { class: "canvaswrap" }, box);
  let els = {};

  const resizePlaces = () => {
    const w = parseInt(inW.value, 10), hh = parseInt(inH.value, 10);
    if (!(w >= 60 && w <= 400 && hh >= 60 && hh <= 400)) { inW.value = salle.place.w; inH.value = salle.place.h; return; }
    salle.place.w = w; salle.place.h = hh; draw();
  };
  inW.addEventListener("change", resizePlaces); inH.addEventListener("change", resizePlaces);

  // ----- dessin
  function draw() {
    canvas.replaceChildren(); els = {};
    const { w, h: ph } = salle.place;
    for (const m of salle.reperes) {
      const el = h("div", { class: "eitem mk" + ((m.angle || 0) === 90 ? " v" : "") + (sel.has(m.id) ? " sel" : ""), dataset: { id: m.id },
        style: { left: m.x + "px", top: m.y + "px", width: m.w + "px", height: m.h + "px" } }, h("span", {}, m.texte));
      canvas.append(el); els[m.id] = el;
    }
    P.readingOrder(salle).forEach((pid, n) => {
      const p = byId(pid);
      const el = h("div", { class: "eitem" + (sel.has(pid) ? " sel" : ""), dataset: { id: pid }, style: { left: p.x + "px", top: p.y + "px", width: w + "px", height: ph + "px", fontSize: "18px" } }, String(n + 1));
      canvas.append(el); els[pid] = el;
    });
    drawHandles();
    const [bw, bh] = P.bounds(salle);
    const cw = Math.max(bw, 900), chh = Math.max(bh, 520);
    Object.assign(canvas.style, { width: cw + "px", height: chh + "px", transform: `scale(${zoom})` });
    box.style.width = cw * zoom + "px"; box.style.height = chh * zoom + "px";
    info.textContent = `${salle.places.length} place(s) · ${sel.size} sélectionné(s)`;
    updateButtons();
  }

  function drawHandles() {
    canvas.querySelectorAll(".handle").forEach((x) => x.remove());
    const ms = markers();
    if (ms.length !== 1 || sel.size !== 1) return;
    const m = ms[0];
    for (const corner of P.CORNERS) {
      const hx = m.x + (corner.includes("e") ? m.w : 0), hy = m.y + (corner.startsWith("s") ? m.h : 0);
      canvas.append(h("div", { class: "handle", dataset: { corner, id: m.id }, style: { left: hx + "px", top: hy + "px" } }));
    }
  }

  const moveEl = (it) => { const el = els[it.id]; if (el) { el.style.left = it.x + "px"; el.style.top = it.y + "px"; if (it.w) { el.style.width = it.w + "px"; el.style.height = it.h + "px"; } } };
  const toPlan = (e) => { const r = canvas.getBoundingClientRect(); return [(e.clientX - r.left) / zoom, (e.clientY - r.top) / zoom]; };

  // ----- souris, doigt, stylet
  canvas.addEventListener("pointerdown", (e) => {
    const handle = e.target.closest(".handle"), item = e.target.closest(".eitem");
    err.textContent = "";
    if (handle) { e.preventDefault(); startResize(e, byId(handle.dataset.id), handle.dataset.corner); return; }
    if (item) {
      e.preventDefault();
      const id = item.dataset.id;
      if (selecting) { sel.has(id) ? sel.delete(id) : sel.add(id); } else if (!sel.has(id)) { sel.clear(); sel.add(id); }
      draw();
      startMove(e);
      return;
    }
    if (selecting) { e.preventDefault(); startMarquee(e); }
    else if (sel.size) { sel.clear(); draw(); }
  });
  canvas.addEventListener("dblclick", (e) => { const item = e.target.closest(".eitem.mk"); if (item) editText(byId(item.dataset.id)); });

  function track(onMove, onUp) {
    const move = (e) => onMove(e);
    const up = (e) => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", up); document.removeEventListener("pointercancel", up); onUp(e); };
    document.addEventListener("pointermove", move); document.addEventListener("pointerup", up); document.addEventListener("pointercancel", up);
  }

  function startMove(e0) {
    const orig = new Map([...sel].map((id) => { const it = byId(id); return [id, [it.x, it.y]]; }));
    const x0 = e0.clientX, y0 = e0.clientY;
    let moved = false;
    track((e) => {
      const dx = (e.clientX - x0) / zoom, dy = (e.clientY - y0) / zoom;
      if (!moved && Math.hypot(dx, dy) * zoom < 4) return;
      moved = true;
      for (const [id, [ox, oy]] of orig) { const it = byId(id); it.x = Math.max(0, P.snap(ox + dx)); it.y = Math.max(0, P.snap(oy + dy)); moveEl(it); }
      drawHandles();
    }, () => { if (moved) draw(); });
  }

  function startResize(e0, m, corner) {
    track((e) => { const [px, py] = toPlan(e); P.resizeMarker(m, corner, px, py); moveEl(m); drawHandles(); }, () => draw());
  }

  function startMarquee(e0) {
    if (!selecting) return;
    sel.clear();
    const [sx, sy] = toPlan(e0);
    const rect = h("div", { class: "marquee" });
    canvas.append(rect);
    track((e) => {
      const [cx, cy] = toPlan(e);
      Object.assign(rect.style, { left: Math.min(sx, cx) + "px", top: Math.min(sy, cy) + "px", width: Math.abs(cx - sx) + "px", height: Math.abs(cy - sy) + "px" });
    }, (e) => {
      const [cx, cy] = toPlan(e);
      const xa = Math.min(sx, cx), xb = Math.max(sx, cx), ya = Math.min(sy, cy), yb = Math.max(sy, cy);
      for (const it of itemsOf()) {
        const iw = it.w || salle.place.w, ih = it.h || salle.place.h;
        if (it.x < xb && it.x + iw > xa && it.y < yb && it.y + ih > ya) sel.add(it.id);
      }
      draw();
    });
  }

  // ----- actions
  async function editText(m) {
    if (!m) return;
    const text = await promptDialog({ title: "Repère", label: "Texte du repère", value: m.texte, validate: (v) => (v.trim() ? null : "Le texte ne peut pas être vide.") });
    if (text) { m.texte = text.trim(); draw(); }
  }

  const addPlace = () => { const p = P.addPlace(salle, ...P.nextFreeSpot(salle)); sel.clear(); sel.add(p.id); draw(); };
  const addMarker = async (name) => {
    if (name === null) {
      name = await promptDialog({ title: "Repère", label: "Texte du repère", validate: (v) => (v.trim() ? null : "Le texte ne peut pas être vide.") });
      if (!name) return;
      name = name.trim();
    }
    const m = P.addMarker(salle, name, 0, 0);
    [m.x, m.y] = P.nextMarkerSpot(salle);  // en bas du plan, comme le tableau et le bureau
    sel.clear(); sel.add(m.id); draw();
  };
  const del = () => { if (!sel.size) return; salle.places = salle.places.filter((p) => !sel.has(p.id)); salle.reperes = salle.reperes.filter((m) => !sel.has(m.id)); sel.clear(); draw(); };
  const nudge = (dx, dy) => { for (const id of sel) { const it = byId(id); it.x = Math.max(0, it.x + dx * P.GRID); it.y = Math.max(0, it.y + dy * P.GRID); } draw(); };
  const align = (how) => {
    const chosen = [...sel].map(byId).filter(Boolean);
    if (chosen.length < 2) { err.textContent = "Sélectionnez au moins deux éléments (mode « Sélectionner » : touchez-les ou tracez un cadre)."; return; }
    P.align(chosen, how); draw();
  };
  const rotate = () => { const ms = markers(); if (!ms.length) { err.textContent = "Sélectionnez d'abord un repère (porte, tableau…) à pivoter."; return; } ms.forEach(P.rotateMarker); draw(); };
  const setZoom = (z) => { zoom = Math.min(1.5, Math.max(0.3, Math.round(z * 10) / 10)); draw(); };

  const btns = {};
  const mk = (key, label, fn, cls = "") => (btns[key] = h("button", { class: "btn small " + cls, type: "button", onclick: fn }, label));
  const updateButtons = () => {
    if (!btns.mode) return;
    btns.mode.setAttribute("aria-pressed", String(selecting));
    btns.mode.textContent = selecting ? "✔ Mode sélection" : "Mode sélection";
    wrap.style.touchAction = selecting ? "none" : "";
    const oneMarker = markers().length === 1 && sel.size === 1;
    btns.text.disabled = !oneMarker; btns.rot.disabled = !markers().length; btns.del.disabled = !sel.size;
    for (const k of ["l", "u", "d", "r"]) btns[k].disabled = !sel.size;
  };

  const toolbar = h("div", { style: { padding: "8px 12px", display: "flex", flexDirection: "column", gap: "6px", borderBottom: "1px solid var(--border)", flex: "none" } },
    h("div", { class: "row wrap" }, nom, h("span", { class: "muted" }, "Place :"), inW, h("span", {}, "×"), inH, h("span", { class: "muted" }, "px"), h("div", { class: "grow" }), info,
      mk("zout", "−", () => setZoom(zoom - 0.1), "icon"), h("span", {}, "Zoom"), mk("zin", "+", () => setZoom(zoom + 0.1), "icon")),
    h("div", { class: "row wrap" },
      mk("add", "Ajouter une place", addPlace),
      mk("gen", "Rangées / îlots…", () => generatorDialog(salle, draw)),
      mk("mark", "Ajouter un repère ▾", (e) => menu(e.currentTarget, [...P.MARKERS.map((n) => ({ label: n, onClick: () => addMarker(n) })), { separator: true }, { label: "Texte libre…", onClick: () => addMarker(null) }])),
      mk("align", "Aligner ▾", (e) => menu(e.currentTarget, [["Aligner à gauche", "left"], ["Aligner en haut", "top"], ["Répartir horizontalement", "hspace"], ["Répartir verticalement", "vspace"]].map(([l, how]) => ({ label: l, onClick: () => align(how) })))),
      mk("mode", "Mode sélection", () => { selecting = !selecting; draw(); }),
      mk("del", "Supprimer la sélection", del, "danger")),
    h("div", { class: "row wrap" }, h("span", { class: "muted" }, "Repères :"),
      mk("rot", "Pivoter de 90°", rotate), mk("text", "Texte…", () => editText(markers()[0])),
      mk("flip", "Retourner la salle de 180°", () => { P.rotateRoom(salle); draw(); }),
      h("span", { class: "muted", style: { marginLeft: "10px" } }, "Déplacer :"),
      mk("l", "←", () => nudge(-1, 0), "icon"), mk("u", "↑", () => nudge(0, -1), "icon"), mk("d", "↓", () => nudge(0, 1), "icon"), mk("r", "→", () => nudge(1, 0), "icon"),
      h("span", { class: "muted", style: { fontSize: ".85em" } }, "Glissez les éléments au doigt ; tirez sur un coin pour redimensionner un repère.")));

  const body = h("div", { style: { display: "flex", flexDirection: "column", height: "100%", minHeight: 0 } }, toolbar, err, wrap);
  const ctl = modal({ title: "Éditeur de salle", size: "xl", body, actions: [
    { label: "Annuler" },
    { label: "Enregistrer la salle", kind: "primary", close: false, onClick: () => {
      const name = nom.value.split(/\s+/).filter(Boolean).join(" ");
      if (!name) { err.textContent = "Donnez un nom à la salle."; return; }
      salle.nom = name;
      ctl.close();
      onSave(salle);
    } }] });
  ctl.body.classList.add("nopad");
  draw();
  if (first) setTimeout(() => generatorDialog(salle, draw), 250);  // une nouvelle salle commence par ses places
  return ctl;
}
