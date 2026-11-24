// Aides d'interface sans dépendance : création d'éléments, fenêtres (centrées, latérales), menus, confirmations, messages.

/** h("div", {class: "x", onclick: fn, style: {...}}, enfants…) : enfants = nœuds, textes, tableaux, null. */
export function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (k.startsWith("aria-") && typeof v === "boolean") { el.setAttribute(k, String(v)); continue; }  // aria-pressed="true" / "false"
    if (v === null || v === undefined || v === false) continue;
    if (k === "class") el.className = v;
    else if (k === "style" && typeof v === "object") { for (const [n, x] of Object.entries(v)) { if (n.startsWith("--")) el.style.setProperty(n, x); else el.style[n] = x; } }  // « --nom » : propriété CSS personnalisée
    else if (k === "dataset") Object.assign(el.dataset, v);
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k in el && k !== "list" && k !== "type" && typeof v !== "object") { try { el[k] = v; } catch (e) { el.setAttribute(k, v); } }
    else el.setAttribute(k, v === true ? "" : v);
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];
export function clear(el) { while (el.firstChild) el.removeChild(el.firstChild); return el; }
export const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));

// ---------------------------------------------------------------- messages
export function toast(message, kind = "") {
  const box = document.getElementById("toasts");
  const t = h("div", { class: "toast " + kind }, message);
  box.append(t);
  setTimeout(() => t.remove(), kind === "bad" ? 4500 : 2200);
}

// ---------------------------------------------------------------- fenêtres
const stack = [];  // fenêtres et menus ouverts (le bouton « retour » d'Android ferme la dernière)

export function overlayCount() { return stack.length; }

/** Ferme la fenêtre ou le menu du dessus. Retourne true s'il y en avait un. */
export function closeTop() {
  const top = stack[stack.length - 1];
  if (!top) return false;
  top.close();
  return true;
}

export function closeAll() { while (closeTop()); }

// Échap (clavier externe, stylet) ferme la fenêtre ou le menu du dessus
if (typeof document !== "undefined") document.addEventListener("keydown", (e) => { if (e.key === "Escape" && closeTop()) e.preventDefault(); });

/**
 * modal({title, body, actions, size, side, onClose}) -> {close, el, body}
 * actions : [{label, kind: "primary"|"danger"|"", onClick: (ctl) => void|false, close: true, left: false}]
 * Un onClick qui retourne false laisse la fenêtre ouverte.
 */
export function modal({ title = "", body = null, actions = [], size = "", side = false, bottom = false, onClose = null, closable = true } = {}) {
  const host = document.getElementById("overlays");
  const bodyEl = h("div", { class: "body" }, body);
  const ctl = { el: null, body: bodyEl, closed: false };
  const left = actions.filter((a) => a.left), right = actions.filter((a) => !a.left);
  const mkBtn = (a) => {
    const b = h("button", { class: "btn " + (a.kind || ""), type: "button" }, a.label);
    b.addEventListener("click", async () => {
      const r = a.onClick ? await a.onClick(ctl) : undefined;
      if (r !== false && a.close !== false) ctl.close();
    });
    return b;
  };
  const dialog = h("div", { class: `dialog ${size} ${side ? "side" : ""}`, role: "dialog", "aria-modal": "true" },
    title || closable ? h("header", {}, h("h3", {}, title),
      closable ? h("button", { class: "btn ghost icon", type: "button", "aria-label": "Fermer", onclick: () => ctl.close() }, "✕") : null) : null,
    bodyEl,
    actions.length ? h("footer", {}, left.length ? h("div", { class: "left" }, left.map(mkBtn)) : null, right.map(mkBtn)) : null);
  const scrim = h("div", { class: `scrim ${side ? "side" : ""} ${bottom ? "bottom" : ""}` }, dialog);
  scrim.addEventListener("pointerdown", (e) => { if (e.target === scrim && closable) { ctl.close(); } });
  ctl.el = dialog;
  ctl.close = () => {
    if (ctl.closed) return;
    ctl.closed = true;
    const i = stack.indexOf(ctl);
    if (i >= 0) stack.splice(i, 1);
    scrim.remove();
    if (onClose) onClose();
  };
  stack.push(ctl);
  host.append(scrim);
  const first = bodyEl.querySelector("input:not([type=checkbox]):not([type=file]), textarea");
  // le champ prend le focus, sauf si une autre fenêtre s'est ouverte entre-temps par-dessus : le focus ne lui est pas volé
  if (first && !side) setTimeout(() => { if (stack[stack.length - 1] === ctl && !ctl.closed) first.focus(); }, 60);
  return ctl;
}

export function confirmDialog(message, { okLabel = "OK", cancelLabel = "Annuler", danger = false, title = "" } = {}) {
  return new Promise((resolve) => {
    let answered = false;
    const done = (v) => { if (!answered) { answered = true; resolve(v); } };
    modal({ title, body: h("p", { style: { whiteSpace: "pre-line" } }, message), onClose: () => done(false), actions: [
      { label: cancelLabel, onClick: () => done(false) },
      { label: okLabel, kind: danger ? "danger" : "primary", onClick: () => done(true) }] });
  });
}

export function alertDialog(message, title = "") {
  return new Promise((resolve) => {
    modal({ title, body: h("p", { style: { whiteSpace: "pre-line" } }, message), onClose: () => resolve(), actions: [{ label: "OK", kind: "primary" }] });
  });
}

/** Saisie d'un texte (ou d'un nombre) dans une fenêtre ; retourne la valeur validée ou null si annulé. */
export function promptDialog({ title, label = "", value = "", multiline = false, numeric = false, hint = "", okLabel = "OK", validate = null, maxLength = null, counter = null, enterSubmits = null }) {
  return new Promise((resolve) => {
    let answered = false;
    const done = (v) => { if (!answered) { answered = true; resolve(v); } };
    const input = multiline ? h("textarea", { rows: 6, value, maxLength: maxLength || undefined }) : h("input", { type: "text", value, inputMode: numeric ? "decimal" : "text", enterKeyHint: "done" });
    const err = h("div", { class: "error" });
    const count = counter ? h("div", { class: "hint" }) : null;
    const updateCount = () => { if (count) { const n = Array.from(input.value).length; count.textContent = `${n} / ${counter}`; count.style.color = n > counter ? "var(--bad-text)" : ""; } };
    input.addEventListener("input", updateCount);
    updateCount();
    const ctl = modal({ title, body: [label ? h("label", { class: "field" }, label) : null, input, count, hint ? h("div", { class: "hint" }, hint) : null, err],
      onClose: () => done(null), actions: [
        { label: "Annuler", onClick: () => done(null) },
        { label: okLabel, kind: "primary", onClick: () => {
          const v = input.value;
          const problem = validate ? validate(v) : null;
          if (problem) { err.textContent = problem; return false; }
          done(v);
        } }] });
    // enterSubmits (fonction) : Entrée valide aussi un texte sur plusieurs lignes (Maj+Entrée = retour à la ligne) et prévient l'appelant
    if (multiline && enterSubmits) input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); enterSubmits(); ctl.el.querySelector("footer .btn.primary").click(); } });
    if (!multiline) input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); ctl.el.querySelector("footer .btn.primary").click(); } });
    setTimeout(() => { input.focus(); input.select && input.select(); }, 80);
  });
}

// ---------------------------------------------------------------- menus (fenêtre flottante ancrée à un élément ou à un point)
/** menu(anchor | {x, y}, items) ; items : {label, onClick, disabled, danger, separator, header}. */
export function menu(anchor, items, { align = "left" } = {}) {
  closeMenus();
  const host = document.getElementById("overlays");
  const m = h("div", { class: "menu", role: "menu" });
  const ctl = { closed: false, isMenu: true };
  ctl.close = () => { if (ctl.closed) return; ctl.closed = true; const i = stack.indexOf(ctl); if (i >= 0) stack.splice(i, 1); m.remove(); catcher.remove(); };
  for (const it of items) {
    if (it.separator) m.append(h("hr"));
    else if (it.header) m.append(h("div", { class: "label" }, it.header));
    else m.append(h("button", { class: it.danger ? "danger" : "", type: "button", disabled: !!it.disabled, role: "menuitem", onclick: () => { ctl.close(); if (it.onClick) it.onClick(); } },
      it.icon ? h("span", {}, it.icon) : null, h("span", {}, it.label)));
  }
  const catcher = h("div", { style: { position: "fixed", inset: 0, pointerEvents: "auto", zIndex: 59 } });
  catcher.addEventListener("pointerdown", () => ctl.close());
  host.append(catcher, m);
  const r = anchor instanceof Element ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y, width: 0, height: 0 };
  const mw = m.offsetWidth, mh = m.offsetHeight, W = window.innerWidth, H = window.innerHeight;
  let x = align === "right" ? r.right - mw : r.left;
  let y = r.bottom + 4;
  if (y + mh > H - 8) y = Math.max(8, r.top - mh - 4);
  x = Math.max(8, Math.min(x, W - mw - 8));
  m.style.left = x + "px"; m.style.top = Math.max(8, y) + "px";
  stack.push(ctl);
  return ctl;
}

export function closeMenus() { for (const c of [...stack]) if (c.isMenu) c.close(); }

// ---------------------------------------------------------------- formulaires
/** Champ étiqueté : retourne {el, input}. */
export function field(label, input, hint = "") {
  return { input, el: h("div", {}, h("label", { class: "field" }, label), input, hint ? h("div", { class: "hint" }, hint) : null) };
}

export function select(options, value, attrs = {}) {
  const s = h("select", attrs, options.map(([k, l]) => h("option", { value: k, selected: k === value }, l)));
  s.value = value;
  return s;
}

export function debounce(fn, ms) {
  let t = null;
  return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); };
}
