// Assistant d'appréciation de bulletin : mots-clés de l'élève, note, phrases types à valider d'un clic, accords selon le genre,
// pour rédiger à la suite les appréciations de toute une classe. Et l'éditeur des mots-clés et phrases types.
// Même fonctionnement que suiviclasse/ui/appreciation_dialog.py sur le PC.
import * as A from "../core/appreciation.js";
import * as C from "../core/columns.js";
import { noteText } from "../core/exchange.js";
import { fmtNum } from "../core/util.js";
import { confirmDialog, h, menu, modal, promptDialog, select } from "./dom.js";
import { statsText } from "./student.js";

const TONE_CLASS = { "+": "pos", "-": "neg", "=": "neu" };
const collapse = (s) => s.split(/\s+/).filter(Boolean).join(" ");
const chipLabel = (m) => `${m.emoji ? m.emoji + " " : ""}${m.titre}`;

/** Pastilles des mots-clés notés pour un élève pendant la période affichée : toucher = une fois de plus, « − » = en retirer une,
 *  « + Mot-clé » = en ajouter un. Utilisée dans la fiche élève et dans l'assistant. onChange est appelée après chaque modification. */
export function keywordBar(app, s, onChange = null, { auto = false } = {}) {
  const root = h("div", { class: "kwbar" });
  const t = app.t;
  const changed = () => { app.commit(); render(); if (onChange) onChange(); };
  function render() {
    const b = A.bank(app.state.settings), byId = new Map(b.mots.map((m) => [m.id, m]));
    const known = A.keywords(s, t);
    root.replaceChildren();
    for (const [k, n] of known) {
      const m = byId.get(k) || { titre: k, emoji: "", ton: "=" };
      root.append(h("span", { class: "kwchip " + TONE_CLASS[m.ton], dataset: { kw: k } },
        h("button", { class: "kw", type: "button", "aria-label": `${m.titre} : une fois de plus`, onclick: () => { A.addKeyword(s, k, t); changed(); } }, chipLabel(m) + (n > 1 ? ` ×${n}` : "")),
        h("button", { class: "kwminus", type: "button", "aria-label": `Retirer une fois ${m.titre}`, onclick: () => { A.removeKeyword(s, k, t); changed(); } }, "−")));
    }
    if (auto) {  // mots-clés détectés d'après les compteurs et les notes : toucher = les noter pour de bon
      const noted = new Set(known.map(([k]) => k));
      for (const k of A.autoKeywords(app.state.settings, app.values, s, t)) {
        if (noted.has(k)) continue;
        const m = byId.get(k);
        root.append(h("span", { class: "kwchip auto " + TONE_CLASS[m.ton], dataset: { kw: k, auto: "1" } },
          h("button", { class: "kw", type: "button", title: "Détecté d'après les compteurs et les notes de l'élève. Toucher pour le noter.", onclick: () => { A.addKeyword(s, k, t); changed(); } }, `${chipLabel(m)} (auto)`)));
      }
    }
    if (!root.children.length) root.append(h("span", { class: "muted kwnone" }, "Aucun mot-clé noté"));
    root.append(h("button", { class: "btn small kwadd", type: "button", onclick: (e) => menu(e.currentTarget, b.mots.map((m) => ({ label: chipLabel(m), onClick: () => { A.addKeyword(s, m.id, t); changed(); } }))) }, "＋ Mot-clé"));
  }
  render();
  root.refresh = render;
  return root;
}

/** Cellule de la colonne « Mots-clés » du tableau : pastilles compactes (toucher = une fois de plus) et « ＋ » (ajouter, retirer une fois).
 *  Le tableau se reconstruit après chaque modification (commit). */
export function keywordCell(app, s) {
  const t = app.t, b = A.bank(app.state.settings), byId = new Map(b.mots.map((m) => [m.id, m]));
  const known = A.keywords(s, t);
  const chips = known.map(([k, n]) => {
    const m = byId.get(k) || { titre: k, emoji: "", ton: "=" };
    return h("button", { class: "mchip " + TONE_CLASS[m.ton], type: "button", dataset: { kw: k }, title: `${m.titre} ×${n} — toucher : une fois de plus`, "aria-label": `${m.titre} : une fois de plus`,
      onclick: () => { A.addKeyword(s, k, t); app.commit(); } }, (m.emoji || m.titre.slice(0, 3)) + (n > 1 ? `×${n}` : ""));
  });
  const titles = Object.fromEntries(b.mots.map((m) => [m.id, m.titre]));
  const add = h("button", { class: "mchip add", type: "button", "aria-label": "Mots-clés", onclick: (e) => menu(e.currentTarget, [
    ...b.mots.map((m) => ({ label: chipLabel(m), onClick: () => { A.addKeyword(s, m.id, t); app.commit(); } })),
    ...(known.length ? [{ separator: true }, ...known.map(([k, n]) => ({ label: `Retirer une fois : ${titles[k] || k} (×${n})`, icon: "−", onClick: () => { A.removeKeyword(s, k, t); app.commit(); } }))] : [])]) }, "＋");
  return h("div", { class: "mots" }, chips, add);
}

// ---------------------------------------------------------------- l'assistant
export function openAppreciations(app, cls, start = null, { onClose = null } = {}) {
  const t = app.t, settings = app.state.settings, scale = C.scale(settings), word = app.per.word;
  const students = [...cls.eleves];
  if (!students.length) return null;
  let index = Math.max(0, students.indexOf(start));
  let used = new Set();
  let ctl = null;

  const list = h("div", { class: "applist", role: "listbox", "aria-label": "Élèves" });
  const nameEl = h("h3", { class: "appname" });
  const genreSeg = h("div", { class: "seg", role: "group", "aria-label": "Genre" });
  const genreHint = h("span", { class: "muted apphint" });
  const facts = h("div", { class: "appfacts muted" });
  const infos = h("div", { class: "appinfos" });
  const kwHolder = h("div", {});
  const phraseBox = h("div", { class: "appsugg" });
  const text = h("textarea", { rows: 5, "aria-label": "Appréciation", class: "apptext" });
  const strip = h("div", { class: "sugstrip", "aria-live": "polite" });
  let sugg = [], aids = { abbrevs: [], pool: [] };
  const loadAids = () => { const b = A.bank(settings); aids = { abbrevs: b.abreviations, pool: A.completionPool(b) }; };
  loadAids();
  const counter = h("span", { class: "hint" });
  const progress = h("span", { class: "muted" });

  const cur = () => students[index];
  const label = (s) => `${s.nom} ${s.prenom}`.trim();

  function updateCounter() {
    const n = Array.from(collapse(text.value)).length, mx = app.values.appreciationMax;
    counter.textContent = `${n} / ${mx} caractères`;
    counter.style.color = n > mx ? "var(--bad-text)" : "";
  }

  function renderList() {
    list.replaceChildren(...students.map((s, i) => h("button", { class: "appstu" + (i === index ? " on" : ""), type: "button", role: "option", "aria-selected": i === index, dataset: { sid: s.id },
      onclick: () => { save(); show(i); } }, h("span", {}, label(s)), h("span", { class: "ok" }, s.comms[String(t)] ? "✓" : ""))));
    const on = list.querySelector(".on");
    if (on && on.scrollIntoView) on.scrollIntoView({ block: "nearest", inline: "nearest" });
  }

  function renderGenre() {
    const s = cur(), saved = s.genre === "f" || s.genre === "m", g = A.genreOf(s);
    genreSeg.replaceChildren(...[["m", "♂ Garçon"], ["f", "♀ Fille"]].map(([v, l]) =>
      h("button", { type: "button", "aria-pressed": g === v, onclick: () => { s.genre = v; app.commit(); renderGenre(); renderSuggestions(); } }, l)));
    genreHint.textContent = saved ? "" : A.guessGenre(s.prenom) ? "genre deviné d'après le prénom — à vérifier" : "genre inconnu : accords au masculin, à choisir";
  }

  function renderSuggestions() {
    const s = cur(), genre = A.genreOf(s);
    const groups = A.suggestions(settings, s, t, scale, app.values);
    phraseBox.replaceChildren();
    if (!groups.length) phraseBox.append(h("div", { class: "muted" }, "Aucune suggestion : l'élève n'a pas de note pour cette période et aucun mot-clé noté. Ajoutez des mots-clés ci-dessus."));
    const names = { resultats: "Résultats", evolution: "Évolution", conclusion: "Conclusion" };
    for (const g of groups) {
      const title = g.kind === "mot" ? `${g.emoji ? g.emoji + " " : ""}${g.titre}${g.count > 1 ? ` ×${g.count}` : ""}${g.auto ? "  (détecté automatiquement)" : ""}` : `${names[g.kind]} — ${g.titre.toLowerCase()}`;
      const box = h("div", { class: "sgrp" }, h("div", { class: "sgt" }, title));
      if (!g.phrases.length) box.append(h("div", { class: "muted" }, "(aucune phrase : à ajouter dans « Phrases types et mots-clés… »)"));
      for (const raw of g.phrases) {
        const txt = A.render(raw, s.prenom, genre, word);
        const b = h("button", { class: "phrase " + (g.kind === "mot" ? TONE_CLASS[g.ton] : "std") + (used.has(txt) ? " used" : ""), type: "button",
          onclick: () => { add(txt); b.classList.add("used"); } }, txt);
        box.append(b);
      }
      phraseBox.append(box);
    }
  }

  function add(txt) {
    const c = text.value;
    text.value = c + (c && !/\s$/.test(c) ? " " : "") + txt;
    used.add(txt);
    updateCounter();
    text.scrollTop = text.scrollHeight;
  }

  function show(i) {
    index = i;
    const s = cur(), k = String(t);
    used = new Set();
    nameEl.textContent = label(s);
    progress.textContent = `Élève ${i + 1} / ${students.length}`;
    const notes = app.per.keys.map((p) => `${app.per.prefix}${p} : ${noteText(s.notes[p]) || "–"}`).join(" · ");
    const [ev, delta] = A.evolution(s, t, scale);
    const trend = ev === null ? "" : ev === "hausse" ? `  ↗ +${fmtNum(delta)}` : ev === "baisse" ? `  ↘ ${fmtNum(delta)}` : "  → stable";
    const summary = statsText(app, s, t);
    facts.replaceChildren(`Notes (sur ${fmtNum(scale)}) : ${notes}${trend}`, summary ? h("div", {}, summary) : null);
    const inf = s.infos.split(/\r?\n/).map((x) => x.trim()).filter(Boolean).join(" · ");
    infos.textContent = inf ? `⚠ ${inf}` : "";
    kwHolder.replaceChildren(keywordBar(app, s, renderSuggestions, { auto: true }));
    text.value = s.comms[k] || "";
    updateStrip();
    renderGenre();
    renderList();
    renderSuggestions();
    updateCounter();
  }

  function save() {
    const s = cur(), k = String(t), v = collapse(text.value);
    if (v !== (s.comms[k] || "")) { s.comms[k] = v; app.commit(); }
    const row = list.querySelector(`[data-sid="${s.id}"] .ok`);
    if (row) row.textContent = v ? "✓" : "";
  }

  // ----- aide à la saisie : abréviations (« tb » → « très bien ») et prédiction de mots (Tab valide la première proposition)
  const SEP = /^[\s.,;:!?)]$/;
  function updateStrip() {
    sugg = [];
    strip.replaceChildren();
    if (app.values.appPredictif !== "oui") return;
    sugg = A.complete(text.value.slice(0, text.selectionStart), aids.pool, 4);
    sugg.forEach(([, entry], i) => strip.append(h("button", { class: "sugchip" + (i === 0 ? " first" : ""), type: "button", onpointerdown: (e) => e.preventDefault(), onclick: () => accept(i) }, (i === 0 ? "⇥ " : "") + entry)));
  }
  function accept(i) {
    const [n, entry] = sugg[i], pos = text.selectionStart, before = text.value.slice(0, pos - n);
    text.value = before + entry + " " + text.value.slice(pos);
    const np = before.length + entry.length + 1;
    text.setSelectionRange(np, np);
    text.focus();
    updateCounter();
    updateStrip();
  }
  text.addEventListener("input", (e) => {
    const sep = e.data ? SEP.test(e.data) : e.inputType === "insertLineBreak";
    if (app.values.appAbreviations === "oui" && sep && text.selectionStart === text.selectionEnd) {
      const pos = text.selectionStart, before = text.value.slice(0, pos - 1), s = cur();
      const r = A.expandAbbreviation(before, aids.abbrevs, s.prenom, A.genreOf(s), word);
      if (r) {
        const head = before.slice(0, before.length - r[0]) + r[1];
        text.value = head + text.value.slice(pos - 1);
        text.setSelectionRange(head.length + 1, head.length + 1);
      }
    }
    updateCounter();
    updateStrip();
  });
  for (const ev of ["keyup", "click"]) text.addEventListener(ev, updateStrip);
  text.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) { e.preventDefault(); save(); if (index + 1 < students.length) show(index + 1); }
    else if (e.key === "Tab" && !e.shiftKey && sugg.length) { e.preventDefault(); accept(0); }
  });
  const option = (key, label) => h("label", { class: "check small opt" }, h("input", { type: "checkbox", checked: app.values[key] === "oui",
    onchange: async (e) => { await app.setPrefs({ [key]: e.target.checked ? "oui" : "non" }); updateStrip(); } }), label);

  const main = h("div", { class: "appmain" },
    h("div", { class: "apphead" }, nameEl, genreSeg, genreHint, h("span", { class: "grow" }), progress),
    facts, infos,
    h("h4", {}, "Mots-clés notés pendant la période (toucher = une fois de plus)"), kwHolder,
    h("h4", {}, "Phrases proposées (toucher pour ajouter à l'appréciation)"), phraseBox,
    h("div", { class: "approw" }, h("h4", { style: { margin: 0 } }, "Appréciation"), h("span", { class: "grow" }), option("appPredictif", "Prédiction (Tab)"),
      option("appAbreviations", "Abréviations"), counter,
      h("button", { class: "btn small", type: "button", onclick: () => { text.value = ""; used = new Set(); renderSuggestions(); updateCounter(); updateStrip(); } }, "Effacer")),
    text, strip);

  ctl = modal({ title: `Appréciations — ${cls.nom} · ${app.per.prefix}${t}`, size: "xl", onClose, body: h("div", { class: "apprview" }, list, main), actions: [
    { label: "Phrases types et mots-clés…", left: true, close: false, onClick: () => openBank(app, () => { loadAids(); show(index); }) },
    { label: "Relecture de la classe…", left: true, close: false, onClick: () => { save(); openReview(app, cls); } },
    { label: "◀ Précédent", close: false, onClick: () => { save(); if (index > 0) show(index - 1); } },
    { label: "Enregistrer", close: false, onClick: () => save() },
    { label: "Enregistrer et suivant ▶", kind: "primary", close: false, onClick: () => { save(); if (index + 1 < students.length) show(index + 1); } },
    { label: "Fermer", onClick: () => save() }] });
  ctl.el.querySelector(".body").classList.add("nopad");
  show(index);
  return ctl;
}

// ---------------------------------------------------------------- l'éditeur de mots-clés et de phrases types
const SECTIONS = [["mots", "Mots-clés"], ["resultats", "Résultats selon la note"], ["evolution", "Évolution depuis la période précédente"], ["conclusions", "Conclusion selon la note"]];
const SUBTITLES = { mots: "Phrases proposées quand ce mot-clé a été noté pour l'élève :", resultats: "Phrases proposées pour une note dans cette tranche (ramenée sur 20) :",
  evolution: "Phrases proposées selon l'évolution de la note :", conclusions: "Phrases de conclusion proposées pour une note dans cette tranche :" };

export function openBank(app, onClose = null) {
  let bank = A.bank(app.state.settings);
  let cur = null;  // [clé de section, identifiant de rubrique]
  const tree = h("div", { class: "banktree", role: "listbox" });
  const title = h("input", { type: "text", maxLength: 40, "aria-label": "Titre" });
  const emoji = h("input", { type: "text", maxLength: 8, style: { width: "80px" }, "aria-label": "Pictogramme" });
  const tone = select([["+", "positif"], ["-", "négatif"], ["=", "neutre"]], "=");
  const phrases = h("textarea", { rows: 12, "aria-label": "Phrases", class: "bankphrases" });
  const subtitle = h("div", { class: "hint" });
  const autoSel = select([["", "(aucune)"], ...A.AUTO_CHOICES], "", { "aria-label": "Détection automatique" });
  const head = h("div", {}, h("div", { class: "row wrap" }, h("span", {}, "Titre"), title, h("span", {}, "Pictogramme"), emoji, h("span", {}, "Teinte"), tone),
    h("div", { class: "row wrap", style: { marginTop: "6px" } }, h("span", {}, "Détection automatique"), autoSel));

  const rubrique = () => (cur && cur[0] !== "aide" ? bank[cur[0]].find((r) => r.id === cur[1]) : null);
  function store() {
    if (cur && cur[0] === "aide") {  // aide à la saisie : une entrée par ligne (« abréviation = texte » pour les abréviations)
      const lines = phrases.value.split(/\r?\n/);
      if (cur[1] === "vocabulaire") bank.vocabulaire = lines.map(collapse).filter(Boolean);
      else bank.abreviations = lines.map((l) => { const i = l.indexOf("="); return i < 0 ? null : { abr: l.slice(0, i).trim(), texte: collapse(l.slice(i + 1)) }; }).filter((a) => a && a.abr && a.texte);
      return;
    }
    const r = rubrique();
    if (!r) return;
    r.phrases = phrases.value.split(/\r?\n/).map(collapse).filter(Boolean);
    if (cur[0] === "mots") { r.titre = collapse(title.value).slice(0, 40) || r.titre; r.emoji = emoji.value.trim(); r.ton = tone.value; r.auto = autoSel.value; }
  }
  function renderTree() {
    tree.replaceChildren();
    for (const [key, name] of SECTIONS) {
      tree.append(h("div", { class: "bsec" }, name));
      for (const r of bank[key]) tree.append(h("button", { class: "bitem" + (cur && cur[0] === key && cur[1] === r.id ? " on" : ""), type: "button", dataset: { rid: `${key}:${r.id}` },
        onclick: () => { store(); select_(key, r.id); } }, chipLabel(r)));
    }
    tree.append(h("div", { class: "bsec" }, "Aide à la saisie"));
    for (const [id, name] of [["vocabulaire", "Mots proposés pendant la frappe"], ["abreviations", "Abréviations"]]) {
      tree.append(h("button", { class: "bitem" + (cur && cur[0] === "aide" && cur[1] === id ? " on" : ""), type: "button", dataset: { rid: `aide:${id}` }, onclick: () => { store(); select_("aide", id); } }, name));
    }
  }
  function select_(key, id) {
    cur = [key, id];
    if (key === "aide") {
      for (const el of [title, emoji, tone, autoSel]) el.disabled = true;
      title.value = ""; emoji.value = ""; autoSel.value = "";
      phrases.value = id === "vocabulaire" ? bank.vocabulaire.join("\n") : bank.abreviations.map((a) => `${a.abr} = ${a.texte}`).join("\n");
      subtitle.textContent = id === "vocabulaire"
        ? "Mots et expressions proposés quand on tape leurs premières lettres dans l'appréciation (un par ligne). Les titres des mots-clés sont proposés aussi. Tab valide la première proposition."
        : "Abréviations remplacées dès qu'on tape une espace ou une ponctuation, une par ligne, sous la forme « tb = très bien ». Le texte peut contenir {prénom}, {il}, {sérieux|sérieuse}…";
      renderTree();
      return;
    }
    const r = rubrique(), kw = key === "mots";
    title.value = r.titre; emoji.value = r.emoji || ""; tone.value = r.ton || "="; autoSel.value = kw ? r.auto || "" : "";
    for (const el of [title, emoji, tone, autoSel]) el.disabled = !kw;
    phrases.value = r.phrases.join("\n");
    subtitle.textContent = SUBTITLES[key];
    renderTree();
  }

  const body = h("div", { class: "bankview" }, tree,
    h("div", { class: "bankedit" }, head, subtitle, phrases,
      h("div", { class: "hint" }, "Une phrase par ligne. Accords : {prénom}, {il} / {Il} (il, elle), {masculin|féminin} (ex. {sérieux|sérieuse}, {concentré|concentrée}), {e} (rien ou « e »), {période} (trimestre ou semestre). Les phrases d'une rubrique « résultats » ou « conclusion » sont proposées selon la note de l'élève, celles d'« évolution » selon l'écart avec la période précédente.")));
  const ctl = modal({ title: "Phrases types et mots-clés", size: "wide", body, actions: [
    { label: "Ajouter un mot-clé", left: true, close: false, onClick: async () => {
      store();
      const titre = await promptDialog({ title: "Nouveau mot-clé", label: "Titre du mot-clé (ex. Oral)", validate: (v) => (collapse(v) ? null : "Donnez un titre au mot-clé.") });
      if (titre === null) return;
      const id = A.newKeywordId(titre, bank);
      bank.mots.push({ id, titre: collapse(titre).slice(0, 40), emoji: "", ton: "=", auto: "", phrases: [] });
      select_("mots", id);
    } },
    { label: "Supprimer ce mot-clé", left: true, close: false, onClick: async () => {
      const r = rubrique();
      if (!r || cur[0] !== "mots") return;
      if (await confirmDialog(`Supprimer « ${r.titre} » et ses phrases ?\n(Les mots-clés déjà notés pour des élèves restent dans leur journal.)`, { okLabel: "Supprimer", danger: true })) {
        bank.mots = bank.mots.filter((m) => m.id !== r.id);
        const first = bank.mots[0] || bank.resultats[0], key = bank.mots[0] ? "mots" : "resultats";
        select_(key, first.id);
      }
    } },
    { label: "Rétablir les phrases par défaut", left: true, close: false, onClick: async () => {
      if (await confirmDialog("Remplacer tous les mots-clés et toutes les phrases par ceux du programme ?", { okLabel: "Rétablir", danger: true })) { bank = A.defaultBank(); select_("mots", bank.mots[0].id); }
    } },
    { label: "Annuler" },
    { label: "Enregistrer", kind: "primary", onClick: () => { store(); app.state.settings.appreciation = A.sanitizeBank(bank); app.commit(); if (onClose) onClose(); } }] });
  ctl.el.querySelector(".body").classList.add("nopad");
  if (bank.mots.length) select_("mots", bank.mots[0].id); else select_("resultats", bank.resultats[0].id);
  return ctl;
}

// ---------------------------------------------------------------- relecture de la classe
/** Toutes les appréciations de la classe sur une page, avec les alertes : vide, trop longue, phrase reprise dans plusieurs
 *  appréciations, prénom d'un autre élève. « Modifier » ouvre l'assistant sur l'élève ; au retour la relecture est actualisée. */
export function openReview(app, cls) {
  const t = app.t, max = app.values.appreciationMax;
  let only = false;
  const summary = h("div", { class: "revsummary" });
  const list = h("div", { class: "revlist" });
  const onlyBox = h("label", { class: "check small opt" }, h("input", { type: "checkbox", onchange: (e) => { only = e.target.checked; render(); } }), "Seulement les appréciations à revoir");

  function render() {
    const [rows, sm] = A.review(cls, t, max);
    const bits = [`${sm.total} élèves (${app.per.prefix}${t})`];
    if (sm.vides) bits.push(`${sm.vides} à écrire`);
    if (sm.trop_longs) bits.push(`${sm.trop_longs} ${sm.trop_longs === 1 ? "trop longue" : "trop longues"}`);
    if (sm.repetees) bits.push(`${sm.repetees} avec une phrase répétée`);
    if (sm.prenoms) bits.push(`${sm.prenoms} avec un prénom d'un autre élève`);
    summary.textContent = bits.length > 1 ? bits.join(" · ") : bits[0] + " · rien à signaler";
    list.replaceChildren();
    let shown = 0;
    for (const r of rows) {
      const alerts = [];
      if (r.vide) alerts.push(["À écrire.", "warn"]);
      if (r.trop_long) alerts.push([`Trop longue : ${r.longueur} caractères pour ${max} au plus.`, "bad"]);
      for (const s of r.repetees) alerts.push([`Phrase reprise dans plusieurs appréciations : « ${s} »`, "warn"]);
      if (r.autres_prenoms.length) alerts.push([`Prénom d'un autre élève dans le texte : ${r.autres_prenoms.join(", ")}`, "bad"]);
      if (only && !alerts.length) continue;
      shown++;
      const note = noteText(r.note);
      list.append(h("div", { class: "revcard", dataset: { sid: r.id } },
        h("div", { class: "revhead" }, h("strong", {}, `${r.nom} ${r.prenom}`.trim()), note ? h("span", { class: "muted" }, note) : null, h("span", { class: "grow" }),
          h("span", { class: "revlen" + (r.trop_long ? " over" : "") }, `${r.longueur} / ${max}`),
          h("button", { class: "btn small", type: "button", onclick: () => openAppreciations(app, cls, cls.eleves.find((s) => s.id === r.id), { onClose: render }) }, "Modifier…")),
        h("div", { class: "revtext" + (r.texte ? "" : " muted") }, r.texte || "(pas encore écrite)"),
        alerts.map(([msg, level]) => h("div", { class: "revalert " + level }, "⚠ " + msg))));
    }
    if (!shown) list.append(h("div", { class: "muted", style: { padding: "16px 4px" } }, rows.length ? "Rien à revoir." : "Cette classe n'a pas d'élèves."));
  }

  const body = h("div", { class: "revview" }, h("div", { class: "revtop" }, summary, onlyBox), list);
  const ctl = modal({ title: `Relecture des appréciations — ${cls.nom}`, size: "wide", body, actions: [{ label: "Fermer", kind: "primary" }] });
  ctl.el.querySelector(".body").classList.add("nopad");
  render();
  return ctl;
}
