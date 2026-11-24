// Parcours de l'application dans un navigateur simulant la tablette.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test, { after, before } from "node:test";
import { py, tmpdir } from "../helpers.mjs";
import { PW, createVault, launch, rendered, row, settle, shot, unlock } from "./helpers.mjs";

let env;
before(async () => { env = await launch(); });
after(async () => { await env.close(); });

const noErrors = (page) => assert.deepEqual(page.errors, [], "aucune erreur dans la console");

test("création du coffre : classe Test, colonnes et alertes comme sur le PC", async () => {
  const page = await env.page();
  await createVault(page);
  const heads = await page.$$eval("table.grid thead th", (t) => t.map((x) => x.textContent.trim().replace(/\s+/g, " ")));
  assert.deepEqual(heads, ["n°", "Nom", "Prénom", "Infos (PAI…)", "T1 /20", "T2 /20", "T3 /20", "📚Travail en séance (T1)", "🏠Travail à la maison (T1)", "🎒Oubli matériel (T1)", "🏷Mots-clés", "Commentaire bulletin", ""]);
  assert.equal(await page.locator("table.grid tbody tr").count(), 8);
  // Emma : A−, A ; Noah : non noté en séance
  assert.equal(await row(page, "DUBOIS").locator("td.ctr .total").nth(0).textContent(), "A−");
  assert.equal(await row(page, "HENRY").locator("td.ctr .total").nth(0).textContent(), "non noté");
  assert.match(await row(page, "CHARPENTIER").locator("td.ctr").nth(2).getAttribute("class"), /bad/);  // 3 oublis : rouge
  assert.equal(await page.locator("table.grid tfoot td", { hasText: "Moyenne de la classe" }).count(), 1);
  await shot(page, "tableau");
  noErrors(page);
  await page.context().close();
});

test("compteurs, notes par niveaux, annuler / rétablir", async () => {
  const page = await env.page();
  await createVault(page);
  const r = row(page, "HENRY");
  const oublis = r.locator("td.ctr").nth(2);
  assert.equal(await oublis.locator(".total").textContent(), "4");
  await oublis.locator(".cbtn").last().tap();
  await rendered(page);
  assert.equal(await oublis.locator(".total").textContent(), "5");
  // un clic sur « B » dans « Séance » : Noah n'avait aucune note -> B
  await r.locator("td.ctr").nth(0).locator("button", { hasText: /^B$/ }).tap();
  assert.equal(await r.locator("td.ctr").nth(0).locator(".total").textContent(), "B");
  await r.locator("td.ctr").nth(0).locator("button", { hasText: /^D$/ }).tap();
  assert.equal(await r.locator("td.ctr").nth(0).locator(".total").textContent(), "C");  // (4+2)/2 = 3
  // annuler (↶) deux fois : retour à « non noté » puis à 4 oublis
  await page.click('button[aria-label="Annuler"]');
  assert.equal(await r.locator("td.ctr").nth(0).locator(".total").textContent(), "B");
  await page.click('button[aria-label="Annuler"]');
  await page.click('button[aria-label="Annuler"]');
  assert.equal(await oublis.locator(".total").textContent(), "4");
  await page.click('button[aria-label="Rétablir"]');
  assert.equal(await oublis.locator(".total").textContent(), "5");
  // total saisi : 2 -> entrée « Ajustement manuel »
  await oublis.locator(".total").tap();
  await page.fill(".dialog input", "2");
  await page.click(".dialog footer .btn.primary");
  assert.equal(await oublis.locator(".total").textContent(), "2");
  const adj = await page.evaluate(() => app.state.classes[0].eleves.find((s) => s.nom === "HENRY").events.filter((e) => e.note === "Ajustement manuel").length);
  assert.equal(adj, 1);
  noErrors(page);
  await page.context().close();
});

test("notes de période : saisie directe, validation, moyenne de la classe", async () => {
  const page = await env.page();
  await createVault(page);
  const t2 = row(page, "BERNARD").locator("input.cell").nth(1);
  await t2.fill("12,5");
  await t2.press("Enter");
  await rendered(page);
  assert.equal(await page.evaluate(() => app.state.classes[0].eleves.find((s) => s.nom === "BERNARD").notes["2"]), 12.5);
  assert.equal(await page.locator("table.grid tfoot td").nth(5).textContent(), "12,5");
  await row(page, "BERNARD").locator("input.cell").nth(1).fill("25");
  await row(page, "BERNARD").locator("input.cell").nth(1).press("Enter");
  assert.match(await page.locator(".toast").first().textContent(), /entre 0 et 20/);
  assert.equal(await row(page, "BERNARD").locator("input.cell").nth(1).inputValue(), "12,5");
  noErrors(page);
  await page.context().close();
});

test("fiche élève : identité, commentaire, journal", async () => {
  const page = await env.page();
  await createVault(page);
  await row(page, "ANDRÉ").locator("td.nom").tap();
  await page.waitForSelector(".dialog.side");
  const comm = page.locator(".dialog.side textarea").nth(1);
  await comm.fill("Très bon trimestre.");
  await page.locator(".dialog.side h4", { hasText: "Journal" }).click();  // validation (blur)
  assert.equal(await page.evaluate(() => app.state.classes[0].eleves.find((s) => s.nom === "ANDRÉ").comms["1"]), "Très bon trimestre.");
  const before = await page.locator(".journal .entry").count();
  await page.locator(".gradeline", { hasText: "Travail en séance" }).locator("button", { hasText: /^E$/ }).click();
  assert.equal(await page.locator(".journal .entry").count(), before + 1);
  assert.match(await page.locator(".journal .entry .what").first().textContent(), /Travail en séance : E/);
  await page.locator(".journal .entry .del").first().click();
  assert.equal(await page.locator(".journal .entry").count(), before);
  await shot(page, "fiche");
  await page.click(".dialog.side footer .btn.primary");
  noErrors(page);
  await page.context().close();
});

test("persistance : après rechargement, le mot de passe rouvre les données chiffrées", async () => {
  const page = await env.page();
  await createVault(page);
  await row(page, "GARCIA").locator("td.ctr").nth(2).locator(".cbtn").last().tap();
  await settle(page);
  await page.reload();
  await page.waitForSelector(".login");
  await page.fill('input[aria-label="Mot de passe"]', "mauvais");
  await page.click('button:has-text("Déverrouiller")');
  await page.waitForFunction(() => document.querySelector(".error") && document.querySelector(".error").textContent.length > 0);
  assert.match(await page.locator(".error").textContent(), /incorrect/);
  await unlock(page);
  assert.equal(await row(page, "GARCIA").locator("td.ctr").nth(2).locator(".total").textContent(), "2");
  noErrors(page);
  await page.context().close();
});

test("compatibilité : le coffre de la tablette s'ouvre sur le PC et celui du PC s'ouvre sur la tablette", async () => {
  const page = await env.page();
  await createVault(page);
  await row(page, "FONTAINE").locator("td.ctr").nth(2).locator(".cbtn").last().tap();
  await settle(page);
  const text = await page.evaluate(() => app.vault.fileText());
  const dir = tmpdir();
  fs.writeFileSync(path.join(dir, "suivi.enc"), text);
  const pcData = py(`
import json, sys
from suiviclasse.vault import Vault
from suiviclasse import model as M
d = Vault(sys.argv[1] if len(sys.argv) > 1 else ${JSON.stringify(dir)}).unlock(${JSON.stringify(PW)})
f = next(s for s in d["classes"][0]["eleves"] if s["nom"] == "FONTAINE")
print(json.dumps({"oublis": M.total(f, "oubli", 1), "classes": [c["nom"] for c in d["classes"]], "salles": len(d["salles"])}))`);
  assert.deepEqual(pcData, { oublis: 2, classes: ["Test"], salles: 1 });
  // sens inverse : un coffre créé par Python (avec une classe « 6B ») ouvert dans le navigateur
  const dir2 = tmpdir();
  py(`
import json
from suiviclasse.vault import Vault
from suiviclasse import model as M
d = M.new_data(); c = M.new_class("6B"); s = M.new_student("MARTIN", "Léa"); c["eleves"].append(s); M.add_event(s, "qualSeance", 1, 5); M.ensure_numbers(c)
d["classes"].append(c); d["ui"]["classe"] = c["id"]
Vault(${JSON.stringify(dir2)}).create(${JSON.stringify(PW)}, d)`);
  const pcFile = fs.readFileSync(path.join(dir2, "suivi.enc"), "utf8");
  const page2 = await env.page();
  await page2.waitForSelector(".login");
  await page2.evaluate((t) => app.storage.put("suivi.enc", t), pcFile);
  await page2.reload();
  await unlock(page2);
  assert.equal(await page2.locator("h2").first().textContent(), "6B");
  assert.equal(await row(page2, "MARTIN").locator("td.ctr .total").first().textContent(), "A");
  noErrors(page); noErrors(page2);
  await page.context().close(); await page2.context().close();
});

test("colonne à niveaux personnalisée : 3 niveaux nommés, règle « 2 dernières notes »", async () => {
  const page = await env.page();
  await createVault(page);
  await page.click('button[aria-label="Menu"]');
  await page.click(".menu >> text=Colonnes…");
  await page.waitForSelector(".tabs");
  await page.click("text=+ Ajouter une colonne…");
  const dlg = page.locator(".dialog").last();
  await dlg.locator("input[type=text]").first().fill("Oral");
  await dlg.locator("select").first().selectOption("niveaux");
  await dlg.locator("select").nth(1).selectOption("3");
  const names = dlg.locator('input[maxlength="20"]');
  for (const [i, v] of ["Très bien", "Bien", "À revoir"].entries()) {  // la saisie est vérifiée : la machine de test peut être très chargée
    for (let k = 0; k < 3; k++) { await names.nth(i).fill(v); if ((await names.nth(i).inputValue()) === v) break; }
  }
  await dlg.locator("select").nth(2).selectOption("dernieres_periode");
  await dlg.locator('input[inputmode="numeric"]').last().fill("2");
  await dlg.locator("footer .btn.primary").click();
  await page.locator(".dialog").first().locator("footer .btn.primary", { hasText: "Enregistrer" }).click();
  await page.waitForSelector('th:has-text("Oral")');
  const r = row(page, "ANDRÉ");
  const cell = r.locator("td.ctr").nth(3);  // après Séance, Maison et Oublis (les colonnes ajoutées se placent avant le commentaire)
  await cell.locator("button", { hasText: "Noter ▾" }).tap();
  await page.locator(".menu >> text=Très bien").tap();
  await cell.locator("button", { hasText: "Noter ▾" }).tap();
  await page.locator(".menu >> text=À revoir").tap();
  await cell.locator("button", { hasText: "Noter ▾" }).tap();
  await page.locator(".menu >> text=À revoir").tap();
  // 2 dernières notes : À revoir, À revoir -> « À revoir »
  assert.equal((await cell.locator(".total").textContent()).trim(), "À revoir");
  await cell.locator(".total").tap();
  assert.match(await page.locator(".menu").textContent(), /Moyenne des 2 dernières notes du trimestre/);
  await page.keyboard.press("Escape");
  const col = await page.evaluate(() => app.state.settings.colonnes[0]);
  assert.deepEqual([col.type, col.niveaux, col.regle, col.x], ["niveaux", ["Très bien", "Bien", "À revoir"], "dernieres_periode", 2]);
  await shot(page, "colonne-niveaux");
  noErrors(page);
  await page.context().close();
});

test("import d'une liste PRONOTE collée : classes et élèves créés", async () => {
  const page = await env.page();
  await createVault(page);
  await page.click('button[aria-label="Menu"]');
  await page.click(".menu >> text=Importer des élèves…");
  await page.fill(".dialog textarea", "Élève\tNé(e) le\tClasse\nDUPONT Marie\t01/02/2014\t6B\nMARTIN Léa\t03/04/2013\t6B\nBERNARD Zoé\t\t5A");
  await page.waitForSelector(".previewtable table");
  assert.match(await page.locator(".dialog").last().textContent(), /3 élève\(s\) à créer.*2 classe\(s\) à créer/);
  await page.click(".dialog footer .btn.primary");
  await page.waitForSelector("h3:has-text('Import terminé')");
  await page.click(".dialog footer .btn.primary");
  assert.deepEqual(await page.$$eval(".chips .chip", (c) => c.map((x) => x.textContent)), ["Test", "5A", "6B"]);
  await page.click('.chip:has-text("6B")');
  assert.equal(await page.locator("table.grid tbody tr").count(), 2);
  noErrors(page);
  await page.context().close();
});

test("export : texte au format PRONOTE copié ou enregistré", async () => {
  const page = await env.page();
  await createVault(page);
  await page.click('button[aria-label="Menu"]');
  await page.click(".menu >> text=Exporter");
  const [download] = await Promise.all([page.waitForEvent("download"), page.click(".dialog >> text=Enregistrer / envoyer…")]);
  assert.equal(download.suggestedFilename(), "Test-T1.txt");
  const content = fs.readFileSync(await download.path(), "utf8");
  assert.ok(content.startsWith("﻿Nom\tPrénom\tNote du trimestre T1\tAppréciation du trimestre T1\r\nANDRÉ\tLéa\t14,5\tBon début"));
  noErrors(page);
  await page.context().close();
});

test("archives et données : archive manuelle, export du fichier suivi.enc", async () => {
  const page = await env.page();
  await createVault(page);
  await page.click('button[aria-label="Menu"]');
  await page.click(".menu >> text=Archives…");
  await page.click(".dialog >> text=Archiver maintenant");
  await page.waitForSelector(".list .item >> text=manuelle");
  assert.ok((await page.locator(".list .item").count()) >= 1);
  await page.keyboard.press("Escape");
  await page.click('button[aria-label="Menu"]');
  await page.click(".menu >> text=Données");
  const [download] = await Promise.all([page.waitForEvent("download"), page.click(".dialog >> text=Exporter")]);
  assert.equal(download.suggestedFilename(), "suivi.enc");
  const raw = JSON.parse(fs.readFileSync(await download.path(), "utf8"));
  assert.equal(raw.format, "suiviclasse");
  assert.equal(raw.kdf.alg, "scrypt");
  noErrors(page);
  await page.context().close();
});

test("plan de classe : glisser un élève sur une place libre, appui sur une pastille", async () => {
  const page = await env.page();
  await createVault(page);
  await page.click('.seg button:has-text("Plan de classe")');
  await page.waitForSelector(".seat");
  await shot(page, "plan");
  assert.equal(await page.locator(".seat.free").count(), 4);
  const from = page.locator('.seat:has(.nm:text("Jules Fontaine")) .nm');
  const fb = await from.boundingBox();
  const to = await page.locator(".seat.free").first().boundingBox();
  await page.mouse.move(fb.x + 20, fb.y + 10);
  await page.mouse.down();
  await page.mouse.move(fb.x + 60, fb.y + 40, { steps: 4 });
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
  await page.mouse.up();
  await page.waitForFunction(() => document.querySelectorAll(".seat.free").length === 4);
  const moved = await page.evaluate(() => { const c = app.state.classes[0]; const sid = c.eleves.find((s) => s.nom === "FONTAINE").id; return Object.entries(c.plans[0].places).find(([, v]) => v === sid)[0]; });
  const freeSeat = await page.evaluate(() => app.state.salles[0].places.length);
  assert.ok(moved && freeSeat === 12);
  // une pastille « oublis » : un appui ajoute 1
  const seat = page.locator('.seat:has(.nm:text("Noah Henry"))');
  await seat.locator('[data-chip="oubli"]').tap();
  assert.equal(await page.evaluate(() => app.state.classes[0].eleves.find((s) => s.nom === "HENRY").events.filter((e) => e.type === "oubli").length), 5);
  // pastille de note : menu des niveaux
  await page.locator('.seat:has(.nm:text("Noah Henry")) [data-chip="qualSeance"]').tap();
  await page.locator(".menu >> text=Travail en séance : A").tap();
  assert.equal(await page.evaluate(() => app.state.classes[0].eleves.find((s) => s.nom === "HENRY").events.filter((e) => e.type === "qualSeance").length), 1);
  noErrors(page);
  await page.context().close();
});

test("éditeur de salle : ajouter, pivoter et redimensionner un repère, retourner la salle", async () => {
  const page = await env.page();
  await createVault(page);
  await page.click('.seg button:has-text("Plan de classe")');
  await page.click("text=Salles…");
  await page.click(".dialog >> text=Modifier");
  await page.waitForSelector(".eitem");
  const n = await page.locator(".eitem.mk").count();
  await page.click("text=Ajouter un repère ▾");
  await page.click(".menu >> text=Porte");
  assert.equal(await page.locator(".eitem.mk").count(), n + 1);
  await page.click("text=Pivoter de 90°");
  assert.ok(await page.locator(".eitem.mk.v").count() >= 1);
  const box = await page.locator(".handle").nth(3).boundingBox();  // coin sud-est
  const before = await page.evaluate(() => 0);
  await page.mouse.move(box.x + 13, box.y + 13); await page.mouse.down(); await page.mouse.move(box.x + 80, box.y + 90, { steps: 5 }); await page.mouse.up();
  const frontBefore = await page.evaluate(() => 1);
  await page.click("text=Retourner la salle de 180°");
  await page.click(".dialog >> text=Enregistrer la salle");
  const m = await page.evaluate(() => app.state.salles[0].reperes.find((r) => r.texte === "Porte"));
  assert.equal(m.angle, 90);
  assert.ok(m.h > 130, "la porte pivotée a été agrandie vers le bas");
  const front = await page.evaluate(() => { const s = app.state.salles[0]; const mean = s.places.reduce((a, p) => a + p.y, 0) / s.places.length; return s.reperes.find((r) => r.texte === "Tableau").y > mean; });
  assert.equal(front, false, "la salle a été retournée : le tableau est maintenant en haut");
  await shot(page, "salle-editeur");
  noErrors(page);
  await page.context().close();
});

test("préférences : découpage en semestres et sauvegarde des réglages", async () => {
  const page = await env.page();
  await createVault(page);
  await page.click('button[aria-label="Menu"]');
  await page.click(".menu >> text=Préférences…");
  await page.locator(".settingrow", { hasText: "Découpage de l’année" }).locator("select").selectOption("semestres");
  await page.click(".tabs >> text=Alertes");
  await page.locator(".settingrow", { hasText: "Orange à partir de" }).first().locator("input").fill("1");
  await page.click(".dialog footer >> text=Enregistrer");
  await page.waitForSelector('[aria-label="Période"] button:has-text("S1")');
  assert.deepEqual(await page.$$eval('[aria-label="Période"] button', (b) => b.map((x) => x.textContent)), ["S1", "S2"]);
  assert.equal(await page.locator("th", { hasText: "S1" }).count() >= 1, true);
  const stored = JSON.parse(await page.evaluate(() => app.storage.get("preferences.json")));
  assert.equal(stored.periodes, "semestres");
  noErrors(page);
  await page.context().close();
});

test("verrouillage : les données sont enregistrées puis le mot de passe est redemandé", async () => {
  const page = await env.page();
  await createVault(page);
  await row(page, "LAMBERT").locator("td.ctr").nth(2).locator(".cbtn").last().tap();
  await page.click('button[aria-label="Menu"]');
  await page.click(".menu >> text=Verrouiller");
  await page.waitForSelector(".login");
  await unlock(page);
  assert.equal(await row(page, "LAMBERT").locator("td.ctr").nth(2).locator(".total").textContent(), "1");
  const archives = await page.evaluate(() => app.vault.listArchives().then((a) => a.map((x) => x.reason)));
  assert.ok(archives.includes("fermeture"));
  noErrors(page);
  await page.context().close();
});

test("mode séance : choisir un outil, toucher les élèves, progression, annuler, bilan", async () => {
  const page = await env.page();
  await createVault(page);
  await page.click('.seg button:has-text("Séance")');
  await page.waitForSelector(".scard");
  assert.equal(await page.locator(".scard").count(), 8);
  // sans outil, toucher un élève ouvre sa fiche
  await page.locator('.scard:has(.nm:text("Jules Fontaine"))').click();
  await page.waitForSelector(".dialog.side");
  await page.keyboard.press("Escape");
  // outil « Maison B » : Jules n'a aucune note de travail à la maison
  await page.click('.tool[data-tool="qualMaison:1"]');
  assert.match(await page.locator(".sprog").textContent(), /7 \/ 8 avec une entrée aujourd'hui · Maison B/);
  assert.equal(await page.locator(".scard.todo").count(), 1);
  const jules = page.locator('.scard:has(.nm:text("Jules Fontaine"))');
  await jules.click();
  assert.match(await page.locator(".sprog").textContent(), /8 \/ 8/);
  const stored = () => page.evaluate(() => { const s = app.state.classes[0].eleves.find((x) => x.nom === "FONTAINE"); return s.events.filter((e) => e.type === "qualMaison").map((e) => [e.v, e.t, e.date.slice(0, 10) === new Date().toISOString().slice(0, 10)]); });
  assert.deepEqual(await stored(), [[4, 1, true]]);
  assert.match(await jules.locator(".tbadge").first().textContent(), /B/);
  // annuler : retour à 7 / 8
  await page.click("text=↶ Annuler");
  assert.match(await page.locator(".sprog").textContent(), /7 \/ 8/);
  assert.deepEqual(await stored(), []);
  // un compteur : « oublis + » sur Noah
  await page.click('.tool[data-tool="oubli:1"]');
  await page.locator('.scard:has(.nm:text("Noah Henry"))').click();
  assert.equal(await page.evaluate(() => app.state.classes[0].eleves.find((s) => s.nom === "HENRY").events.filter((e) => e.type === "oubli").length), 5);
  // appui long : menu avec annulation de la dernière entrée du jour
  const noah = page.locator('.scard:has(.nm:text("Noah Henry"))');
  const bb = await noah.boundingBox();
  await page.mouse.move(bb.x + 40, bb.y + 40); await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up();
  await page.locator(".menu >> text=Annuler la dernière entrée du jour").click();
  assert.equal(await page.evaluate(() => app.state.classes[0].eleves.find((s) => s.nom === "HENRY").events.filter((e) => e.type === "oubli").length), 4);
  // l'outil se désélectionne en le touchant de nouveau
  await page.click('.tool[data-tool="oubli:1"]');
  assert.match(await page.locator(".sprog").textContent(), /Choisissez un outil/);
  // disposition de la salle
  await page.click('[aria-label="Disposition"] button:has-text("Plan")');
  assert.equal(await page.locator(".scard.compact").count(), 8);
  assert.equal(await page.locator(".scard.empty").count(), 4);
  await shot(page, "seance-plan");
  // bilan du jour
  await page.click("text=Bilan du jour");
  assert.match(await page.locator(".dialog").last().textContent(), /élève\(s\) avec des entrées aujourd'hui/);
  await page.keyboard.press("Escape");
  // le mode séance n'est pas enregistré dans les données (la version PC ne le connaît pas)
  assert.notEqual(await page.evaluate(() => app.state.ui.vue), "seance");
  await page.click('.seg button:has-text("Tableau")');
  await page.waitForSelector("table.grid");
  noErrors(page);
  await page.context().close();
});

test("orientation : bouton à côté du titre (Automatique → Paysage → Portrait), choix mémorisé", async () => {
  const page = await env.page();
  await createVault(page);
  const btn = page.locator(".brandbox .orientbtn");
  assert.equal(await btn.getAttribute("data-mode"), "auto");
  assert.equal(await page.evaluate(() => document.documentElement.dataset.orient), "paysage");
  // le bouton est en haut à gauche, avant le titre
  const [bb, tb] = await Promise.all([btn.boundingBox(), page.locator(".brand").boundingBox()]);
  assert.ok(bb.x < tb.x && bb.y < 80 && bb.width <= 48, "petit bouton avant le titre");
  await btn.click();
  await page.waitForSelector('.orientbtn[data-mode="paysage"]');
  assert.match(await page.locator(".toast").last().textContent(), /verrouillé en paysage/);
  await btn.click();
  await page.waitForSelector('.orientbtn[data-mode="portrait"]');
  assert.equal(await page.evaluate(() => localStorage.getItem("orientation")), "portrait");
  await btn.click();
  await page.waitForSelector('.orientbtn[data-mode="auto"]');
  assert.match(await page.locator(".toast").last().textContent(), /automatique/);
  await btn.click();  // paysage, puis rechargement : le choix est retrouvé
  await page.waitForSelector('.orientbtn[data-mode="paysage"]');
  await page.reload();
  await unlock(page);
  assert.equal(await page.locator(".brandbox .orientbtn").getAttribute("data-mode"), "paysage");
  noErrors(page);
  await page.context().close();
});

test("portrait : la mise en page suit la rotation, sans défilement horizontal de la page", async () => {
  const page = await env.page();
  await createVault(page);
  const overflow = () => page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  await page.setViewportSize({ width: 800, height: 1280 });
  await page.waitForFunction(() => document.documentElement.dataset.orient === "portrait");
  assert.ok((await overflow()) <= 0, "tableau en portrait");
  await shot(page, "portrait-tableau");
  await page.click('.seg button:has-text("Plan de classe")');
  await page.waitForSelector(".canvaswrap");
  assert.ok((await overflow()) <= 0, "plan en portrait");
  // la liste « Sans place » passe sous le plan
  const [c, s] = await Promise.all([page.locator(".canvaswrap").boundingBox(), page.locator(".sideplan").boundingBox()]);
  assert.ok(s.y >= c.y + c.height - 2 && s.width >= 700, "liste sous le plan");
  await shot(page, "portrait-plan");
  await page.click('.seg button:has-text("Séance")');
  await page.waitForSelector(".scard");
  assert.ok((await overflow()) <= 0, "séance en portrait");
  await shot(page, "portrait-seance");
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.waitForFunction(() => document.documentElement.dataset.orient === "paysage");
  assert.ok((await overflow()) <= 0, "retour en paysage");
  noErrors(page);
  await page.context().close();
});

test("tableau : nom et prénom restent affichés quand on défile vers la droite (réglable)", async () => {
  const page = await env.page({ viewport: { width: 900, height: 700 } });
  await createVault(page);
  const x = (sel) => page.locator(sel).first().evaluate((el) => Math.round(el.getBoundingClientRect().x));
  const scroll = (left) => page.locator(".tablewrap").evaluate((el, l) => { el.scrollLeft = l; return el.scrollLeft; }, left);
  const nom0 = await x("td.nom"), prenom0 = await x("td.name:not(.nom)");
  assert.ok((await scroll(400)) > 0, "le tableau défile horizontalement");
  assert.equal(await x("td.nom"), nom0);
  assert.equal(await x("td.name:not(.nom)"), prenom0);
  // une colonne qui n'est pas figée (T1) suit le défilement
  const note = await page.locator("table.grid tbody tr").first().locator("td").nth(4).evaluate((el) => Math.round(el.getBoundingClientRect().x));
  assert.ok(note < 400, "les autres colonnes défilent");
  // préférence « Aucune » : plus rien n'est figé
  await page.evaluate(() => app.setPrefs({ colonneFigee: "aucune" }));
  await page.evaluate(() => app.requestRender());
  await scroll(0); await scroll(400);
  assert.ok((await x("td.nom")) < nom0, "avec « Aucune », le nom défile aussi");
  // choix proposé dans les préférences
  await page.click('[aria-label="Menu"]');
  await page.click(".menu >> text=Préférences…");
  await page.locator(".settingrow", { hasText: "Colonnes figées" }).locator("select").waitFor();
  assert.equal(await page.locator(".settingrow", { hasText: "Colonnes figées" }).locator("select").inputValue(), "aucune");
  await shot(page, "colonnes-figees");
  await page.keyboard.press("Escape");
  noErrors(page);
  await page.context().close();
});

test("titres de colonnes : pictogrammes seuls ou titres inclinés à 60°", async () => {
  const page = await env.page();
  await createVault(page);
  const heads = () => page.locator("table.grid thead th");
  assert.equal(await page.locator("table.grid thead th.rot, table.grid thead th.iconly").count(), 0);
  // pictogrammes seuls : les colonnes qui en ont un perdent leur titre (visible au survol / lu par les lecteurs d'écran)
  await page.evaluate(() => app.setPrefs({ titresColonnes: "icones" }));
  await page.evaluate(() => app.requestRender());
  const iconly = page.locator("table.grid thead th.iconly");
  assert.ok((await iconly.count()) >= 3, "colonnes en pictogramme seul");
  assert.match(await iconly.first().getAttribute("title"), /\(T1\)/);
  assert.equal((await iconly.first().textContent()).trim().length <= 3, true);
  await shot(page, "titres-icones");
  // titres inclinés
  await page.evaluate(() => app.setPrefs({ titresColonnes: "inclines" }));
  await page.evaluate(() => app.requestRender());
  const rot = page.locator("table.grid thead th.rot");
  assert.ok((await rot.count()) >= 5, "colonnes à titre incliné");
  assert.equal(await page.locator("table.grid thead th.rot span", { hasText: /^NOM$/ }).count(), 1, "le nom est incliné aussi");
  assert.equal(await page.locator("table.grid thead th:not(.rot)").count(), 1, "toutes les colonnes titrées sont inclinées (seule « fiche », sans titre, reste)");
  const tr = await rot.first().locator("span").evaluate((el) => getComputedStyle(el).transform);
  // centré : la ligne médiane du titre passe par le milieu de la colonne (au bas de l'en-tête, à quelques pixels près)
  const mid = await rot.nth(2).evaluate((th) => { const c = th.getBoundingClientRect(), s = th.querySelector("span").getBoundingClientRect(); return [c.left + c.width / 2, s.left + s.width / 2, c.width]; });
  assert.ok(Math.abs(mid[1] - mid[0]) < mid[2] * 0.9, "titre centré sur la colonne : " + mid);
  assert.match(tr, /matrix\(0\.5/);  // rotation de −60° : cos = 0,5
  const box = await rot.first().boundingBox();
  assert.ok(box.height > 60 && box.height <= 200, "hauteur d'en-tête adaptée : " + box.height);
  await shot(page, "titres-inclines");
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth) <= 0, true);
  noErrors(page);
  await page.context().close();
});

test("saisie : Entrée valide la note ou le commentaire et passe à la ligne du dessous", async () => {
  const page = await env.page();
  await createVault(page);
  const noteInput = (nom) => row(page, nom).locator("td").nth(4).locator("input");  // colonne T1
  const active = () => page.evaluate(() => { const td = document.activeElement.closest("tr"); return td ? td.querySelector("td.nom").textContent : null; });
  await noteInput("ANDRÉ").click();
  await noteInput("ANDRÉ").fill("15,5");
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => app.state.classes[0].eleves.find((s) => s.nom === "ANDRÉ").notes["1"]), 15.5);
  assert.equal(await active(), "BERNARD", "le curseur passe à l'élève suivant");
  await page.keyboard.type("8");
  await page.keyboard.press("Enter");
  assert.equal(await page.evaluate(() => app.state.classes[0].eleves.find((s) => s.nom === "BERNARD").notes["1"]), 8);
  assert.equal(await active(), "CHARPENTIER");
  // valeur inchangée : on passe tout de même à la ligne suivante
  await page.keyboard.press("Enter");
  assert.equal(await active(), "DUBOIS");
  // note invalide : message, et on reste sur place
  await page.keyboard.type("45");
  await page.keyboard.press("Enter");
  assert.equal(await active(), "DUBOIS");
  assert.equal(await page.locator(".toast.bad").count() > 0, true);
  // commentaire : Entrée valide puis ouvre la fenêtre de l'élève suivant
  await row(page, "ANDRÉ").locator("td.comm").click();
  await page.waitForSelector(".dialog textarea");
  await page.fill(".dialog textarea", "Très bon trimestre");
  await page.keyboard.press("Enter");
  await page.waitForSelector('.dialog:has-text("BERNARD")');
  assert.equal(await page.evaluate(() => app.state.classes[0].eleves.find((s) => s.nom === "ANDRÉ").comms["1"]), "Très bon trimestre");
  assert.match(await page.locator(".dialog textarea").inputValue(), /Participe volontiers/);
  await page.keyboard.press("Escape");
  noErrors(page);
  await page.context().close();
});

test("notes particulières : a, n, d = Abs, N.Not, Disp, sans effet sur les moyennes", async () => {
  const page = await env.page();
  await createVault(page);
  const noteInput = (nom) => row(page, nom).locator("td").nth(4).locator("input");  // colonne T1
  const stored = (nom) => page.evaluate((n) => app.state.classes[0].eleves.find((s) => s.nom === n).notes["1"], nom);
  const foot = () => page.locator("table.grid tfoot td").nth(4).textContent();
  const before = (await foot()).trim();
  assert.equal(before, "13,71");
  // « a » -> Abs ; la moyenne de la classe ne compte plus que les autres notes (14,5 + 11 + 9,5 + 17 + 12 + 13 = 77 / 6)
  await noteInput("LAMBERT").click(); await noteInput("LAMBERT").fill("a"); await page.keyboard.press("Enter");
  assert.equal(await stored("LAMBERT"), "a");
  assert.equal(await noteInput("LAMBERT").inputValue(), "Abs");
  assert.equal((await foot()).trim(), "12,83");
  // « d » et « n » (majuscules et mots complets acceptés)
  await noteInput("DUBOIS").fill("D"); await page.keyboard.press("Enter");
  await noteInput("GARCIA").fill("non noté"); await page.keyboard.press("Enter");
  assert.deepEqual([await stored("DUBOIS"), await stored("GARCIA")], ["d", "n"]);
  assert.deepEqual([await noteInput("DUBOIS").inputValue(), await noteInput("GARCIA").inputValue()], ["Disp", "N.Not"]);
  assert.equal((await foot()).trim(), "11,75");  // (14,5 + 11 + 9,5 + 12) / 4
  // retour à un nombre, puis effacement
  await noteInput("LAMBERT").fill("16"); await page.keyboard.press("Enter");
  assert.equal(await stored("LAMBERT"), 16);
  await noteInput("LAMBERT").fill(""); await page.keyboard.press("Enter");
  assert.equal(await stored("LAMBERT"), null);
  // une valeur quelconque reste refusée
  await noteInput("HENRY").fill("zz"); await page.keyboard.press("Enter");
  assert.equal(await page.locator(".toast.bad").count() > 0, true);
  noErrors(page);
  await page.context().close();
});

test("assistant d'appréciation : mots-clés, phrases types, genre, rédaction à la suite", async () => {
  const page = await env.page();
  await createVault(page);
  const kws = (nom) => page.evaluate((n) => app.state.classes[0].eleves.find((s) => s.nom === n).events.filter((e) => e.type.startsWith("mot:")).map((e) => e.type), nom);
  // 1. mots-clés notés depuis la fiche de l'élève
  await row(page, "ANDRÉ").locator("td.nom").click();
  await page.waitForSelector(".dialog.side .kwbar");
  await page.locator(".dialog.side .kwadd").click();
  await page.locator(".menu >> text=Bavardages").click();
  await page.locator(".dialog.side .kwchip .kw").click();  // « une fois de plus »
  await page.locator(".dialog.side .kwadd").click();
  await page.locator(".menu >> text=Efforts").click();
  assert.deepEqual(await kws("ANDRÉ"), ["mot:bavardages", "mot:bavardages", "mot:efforts"]);
  assert.match(await page.locator(".dialog.side .kwchip").first().textContent(), /Bavardages ×2/);
  await page.locator(".dialog.side .kwminus").first().click();
  assert.deepEqual(await kws("ANDRÉ"), ["mot:bavardages", "mot:efforts"]);
  assert.match(await page.locator(".dialog.side .journal").textContent(), /Mot-clé : Bavardages/);
  await page.keyboard.press("Escape");
  // 2. mot-clé noté en séance (outil « Retards » puis un tap sur Noah)
  await page.click('.seg button:has-text("Séance")');
  await page.click('.tool[data-tool="mot:retards"]');
  await page.locator('.scard:has(.nm:text("Noah Henry"))').click();
  assert.deepEqual(await kws("HENRY"), ["mot:retards"]);
  await page.click('.seg button:has-text("Tableau")');
  await page.waitForSelector("table.grid");
  // 3. l'assistant
  await page.click("text=✍ Appréciations");
  await page.waitForSelector(".apprview .appstu");
  assert.equal(await page.locator(".appstu").count(), 8);
  assert.match(await page.locator(".appname").textContent(), /ANDRÉ Léa/);
  assert.match(await page.locator(".appfacts").textContent(), /T1 : 14,5/);
  assert.equal(await page.locator(".kwchip:not(.auto)").count(), 2);  // les pastilles « auto » sont à part
  const groups = await page.locator(".sgt").allTextContents();
  assert.match(groups[0], /Résultats — de 14 à 16/);
  assert.ok(groups.some((g) => /Bavardages/.test(g)) && groups.some((g) => /Efforts/.test(g)) && groups.some((g) => /Conclusion/.test(g)));
  // le genre est deviné (Léa) : accords au féminin
  assert.equal(await page.locator('[aria-label="Genre"] button[aria-pressed="true"]').textContent(), "♀ Fille");
  await page.locator(".phrase", { hasText: "pour rester concentrée" }).click();
  await page.locator(".phrase", { hasText: "Léa obtient de bons résultats" }).click();
  const full = "Bon début de trimestre, élève sérieuse. Elle doit limiter ses bavardages pour rester concentrée. Léa obtient de bons résultats, c'est encourageant.";
  assert.equal(await page.locator(".apptext").inputValue(), full);  // ajouté à l'appréciation déjà saisie
  // changer le genre change les accords proposés
  await page.locator('[aria-label="Genre"] button:has-text("Garçon")').click();
  assert.equal(await page.locator(".phrase", { hasText: "pour rester concentré." }).count(), 1);
  assert.equal(await page.evaluate(() => app.state.classes[0].eleves.find((s) => s.nom === "ANDRÉ").genre), "m");
  await page.locator('[aria-label="Genre"] button:has-text("Fille")').click();
  // enregistrer et passer à l'élève suivant
  await page.locator("footer .btn.primary", { hasText: "Enregistrer et suivant" }).click();
  assert.equal(await page.evaluate(() => app.state.classes[0].eleves.find((s) => s.nom === "ANDRÉ").comms["1"]), full);
  assert.match(await page.locator(".appname").textContent(), /BERNARD Zoé/);
  assert.match(await page.locator(".apptext").inputValue(), /Participe volontiers/);  // appréciation déjà saisie : reprise
  assert.match(await page.locator(".appfacts").textContent(), /Notes \(sur 20\)/);
  await shot(page, "assistant-appreciation");
  // 4. éditeur : ajouter un mot-clé et sa phrase
  await page.click("text=Phrases types et mots-clés…");
  await page.click("text=Ajouter un mot-clé");
  await page.fill('.dialog:has-text("Nouveau mot-clé") input[type=text]', "Oral");
  await page.locator('.dialog:has-text("Nouveau mot-clé") footer .btn.primary').click();
  await page.waitForSelector('.dialog:has-text("Nouveau mot-clé")', { state: "detached" });
  await page.locator(".bankphrases").fill("{prénom} s'exprime avec aisance.\n{Il} gagne en {assurance|assurance}.");
  await page.locator(".dialog:has(.bankview) footer .btn.primary").click();
  const bank = await page.evaluate(() => app.state.settings.appreciation.mots.find((m) => m.id === "oral"));
  assert.deepEqual(bank.phrases, ["{prénom} s'exprime avec aisance.", "{Il} gagne en {assurance|assurance}."]);
  // le nouveau mot-clé est proposé dans le menu « + Mot-clé »
  await page.locator(".apprview .kwadd").click();
  assert.equal(await page.locator(".menu >> text=Oral").count(), 1);
  await page.keyboard.press("Escape");
  noErrors(page);
  await page.context().close();
});

test("assistant d'appréciation : prédiction de mots (Tab), abréviations, réglages et vocabulaire modifiable", async () => {
  const page = await env.page();
  await createVault(page);
  await page.click("text=✍ Appréciations");
  await page.waitForSelector(".apptext");
  await page.locator(".apptext").fill("");
  await page.locator(".apptext").click();
  // abréviations : « tb » devient « très bien » dès l'espace ; « pn » devient le prénom de l'élève
  await page.keyboard.type("pn est tb ");
  assert.equal(await page.locator(".apptext").inputValue(), "Léa est très bien ");
  await page.keyboard.type("Tb. ");
  assert.equal(await page.locator(".apptext").inputValue(), "Léa est très bien Très bien. ");
  // prédiction : les premières lettres proposent des mots ; Tab valide la première proposition
  await page.keyboard.type("et bav");
  assert.match(await page.locator(".sugchip.first").textContent(), /bavardages/);
  await page.keyboard.press("Tab");
  assert.equal(await page.locator(".apptext").inputValue(), "Léa est très bien Très bien. et bavardages ");
  assert.equal(await page.locator(".sugchip").count(), 0);
  // une proposition se choisit aussi en la touchant ; les accents sont ignorés, les expressions complétées
  await page.keyboard.type("tres b");
  assert.deepEqual((await page.locator(".sugchip").allTextContents()).slice(0, 2), ["⇥ très bien", "très bon travail"]);
  await page.locator(".sugchip", { hasText: "très bon travail" }).click();
  assert.match(await page.locator(".apptext").inputValue(), /et bavardages très bon travail $/);
  // réglages : abréviations désactivées -> « tb » reste tel quel ; prédiction désactivée -> plus de proposition
  const focusEnd = async () => { await page.locator(".apptext").focus(); await page.keyboard.press("Control+End"); };
  await page.locator(".opt", { hasText: "Abréviations" }).locator("input").uncheck();
  await focusEnd();
  await page.keyboard.type("tb ");
  assert.match(await page.locator(".apptext").inputValue(), /très bon travail tb $/);
  await page.locator(".opt", { hasText: "Prédiction" }).locator("input").uncheck();
  await focusEnd();
  await page.keyboard.type("bav");
  assert.equal(await page.locator(".sugchip").count(), 0);
  const stored = JSON.parse(await page.evaluate(() => app.storage.get("preferences.json")));
  assert.deepEqual([stored.appPredictif, stored.appAbreviations], ["non", "non"]);
  await page.locator(".opt", { hasText: "Abréviations" }).locator("input").check();
  await page.locator(".opt", { hasText: "Prédiction" }).locator("input").check();
  // vocabulaire et abréviations modifiables dans l'éditeur
  await page.click("text=Phrases types et mots-clés…");
  await page.click('.bitem[data-rid="aide:vocabulaire"]');
  const vocab = page.locator(".bankphrases");
  await vocab.fill((await vocab.inputValue()) + "\nperspicace");
  await page.click('.bitem[data-rid="aide:abreviations"]');
  const abbr = page.locator(".bankphrases");
  assert.match(await abbr.inputValue(), /^tb = très bien/m);
  await abbr.fill((await abbr.inputValue()) + "\nzz = zèle {remarquable|remarquable}");
  await page.locator(".dialog:has(.bankview) footer .btn.primary").click();
  const bank = await page.evaluate(() => app.state.settings.appreciation);
  assert.ok(bank.vocabulaire.includes("perspicace"));
  assert.deepEqual(bank.abreviations.find((a) => a.abr === "zz"), { abr: "zz", texte: "zèle {remarquable|remarquable}" });
  await page.locator(".apptext").fill("");
  await page.locator(".apptext").click();
  await page.keyboard.type("persp");
  assert.match(await page.locator(".sugchip.first").textContent(), /perspicace/);
  await page.keyboard.type("ic zz ");
  assert.match(await page.locator(".apptext").inputValue(), /zèle remarquable $/);
  noErrors(page);
  await page.context().close();
});

test("mots-clés automatiques (d'après les compteurs) et relecture de la classe", async () => {
  const page = await env.page();
  await createVault(page);
  const kws = (nom) => page.evaluate((n) => app.state.classes[0].eleves.find((s) => s.nom === n).events.filter((e) => e.type.startsWith("mot:")).map((e) => e.type), nom);
  // 1. HENRY a 4 oublis de matériel (seuil orange : 2) : le mot-clé « Matériel » est proposé automatiquement
  await page.click("text=✍ Appréciations");
  await page.waitForSelector(".appstu");
  await page.locator(".appstu", { hasText: "HENRY" }).click();
  const auto = page.locator(".kwchip.auto");
  assert.match(await auto.first().textContent(), /Matériel \(auto\)/);
  assert.ok((await page.locator(".sgt", { hasText: "Matériel" }).textContent()).includes("détecté automatiquement"));
  assert.deepEqual(await kws("HENRY"), []);
  await auto.first().locator("button.kw").click();  // le toucher le note pour de bon
  assert.deepEqual(await kws("HENRY"), ["mot:materiel"]);
  assert.equal(await page.locator('.kwchip.auto[data-kw="materiel"]').count(), 0);
  assert.equal(await page.locator('.kwchip[data-kw="materiel"]').count(), 1);
  // la condition se règle dans l'éditeur : « seuil rouge » (3 oublis) ou aucune
  await page.click("text=Phrases types et mots-clés…");
  await page.locator('.bitem[data-rid="mots:materiel"]').click();
  assert.equal(await page.locator('[aria-label="Détection automatique"]').inputValue(), "oubli_orange");
  await page.locator('[aria-label="Détection automatique"]').selectOption("");
  await page.locator(".dialog:has(.bankview) footer .btn.primary").click();
  assert.equal(await page.evaluate(() => app.state.settings.appreciation.mots.find((m) => m.id === "materiel").auto), "");
  await page.locator("footer .btn", { hasText: "Fermer" }).click();
  // 2. relecture : quatre appréciations identiques, un texte trop long avec un prénom d'un autre élève
  await page.evaluate(() => {
    const e = app.state.classes[0].eleves, common = "Très bon travail ce trimestre, il faut continuer.";
    for (const s of e.slice(0, 3)) s.comms["1"] = common;
    e[3].comms["1"] = "Zoé aide Lucas. " + "x".repeat(260);
    e[4].comms["1"] = ""; e[5].comms["1"] = "Bien.";
    app.commit();
  });
  await page.click('[aria-label="Menu"]');
  await page.click(".menu >> text=Relecture des appréciations…");
  await page.waitForSelector(".revcard");
  assert.equal(await page.locator(".revcard").count(), 8);
  assert.match(await page.locator(".revsummary").textContent(), /8 élèves \(T1\) · \d+ à écrire · 1 trop longue · 3 avec une phrase répétée · 1 avec un prénom d'un autre élève/);
  const emma = page.locator('.revcard:has(strong:text("DUBOIS Emma"))');
  assert.match(await emma.textContent(), /Trop longue : 276 caractères pour 255 au plus/);
  assert.match(await emma.textContent(), /Prénom d'un autre élève dans le texte : Zoé, Lucas/);
  assert.match(await page.locator('.revcard:has(strong:text("ANDRÉ Léa"))').textContent(), /Phrase reprise dans plusieurs appréciations/);
  assert.match(await page.locator('.revcard:has(strong:text("FONTAINE Jules"))').textContent(), /À écrire|Bien\./);
  await page.locator(".revview input[type=checkbox]").check();
  const shown = await page.locator(".revcard").count();
  assert.ok(shown < 8 && shown >= 4, "filtre « à revoir » : " + shown);
  assert.equal(await page.locator('.revcard:has(strong:text("GARCIA Inès"))').count(), 0, "une appréciation sans alerte disparaît");
  // 3. Modifier ouvre l'assistant sur l'élève ; au retour la relecture est actualisée
  await page.locator('.revcard:has(strong:text("FONTAINE Jules")) button', { hasText: "Modifier" }).click();
  await page.waitForSelector(".appname");
  assert.match(await page.locator(".appname").textContent(), /FONTAINE Jules/);
  await page.locator(".apptext").fill("Jules a bien progressé ce trimestre grâce à ses efforts.");
  await page.locator("footer .btn", { hasText: "Fermer" }).last().click();
  assert.equal(await page.evaluate(() => app.state.classes[0].eleves.find((s) => s.nom === "FONTAINE").comms["1"]), "Jules a bien progressé ce trimestre grâce à ses efforts.");
  await page.waitForFunction(() => document.querySelector(".revsummary") && document.querySelector(".revview"));
  await shot(page, "relecture");
  noErrors(page);
  await page.context().close();
});

test("colonne « Mots-clés » du tableau : pastilles, ajout et retrait, suit l'assistant", async () => {
  const page = await env.page();
  await createVault(page);
  const kws = (nom) => page.evaluate((n) => app.state.classes[0].eleves.find((s) => s.nom === n).events.filter((e) => e.type.startsWith("mot:")).map((e) => e.type), nom);
  assert.equal(await page.locator("table.grid thead th", { hasText: "Mots-clés" }).count(), 1);
  const cell = (nom) => row(page, nom).locator("td.mots");
  assert.equal(await cell("ANDRÉ").locator(".mchip:not(.add)").count(), 0);
  await cell("ANDRÉ").locator(".mchip.add").click();
  await page.locator(".menu >> text=Bavardages").click();
  await cell("ANDRÉ").locator(".mchip.add").click();
  await page.locator(".menu >> text=Efforts").click();
  assert.deepEqual(await kws("ANDRÉ"), ["mot:bavardages", "mot:efforts"]);
  assert.equal(await cell("ANDRÉ").locator(".mchip:not(.add)").count(), 2);
  await cell("ANDRÉ").locator('.mchip[data-kw="bavardages"]').click();  // une fois de plus
  assert.match(await cell("ANDRÉ").locator('.mchip[data-kw="bavardages"]').textContent(), /×2/);
  await cell("ANDRÉ").locator(".mchip.add").click();
  await page.locator(".menu >> text=Retirer une fois : Bavardages").click();
  assert.deepEqual(await kws("ANDRÉ"), ["mot:bavardages", "mot:efforts"]);
  assert.equal(await cell("BERNARD").locator(".mchip:not(.add)").count(), 0, "les autres élèves ne sont pas touchés");
  // la colonne se masque dans les réglages des colonnes, comme les autres colonnes de base
  await page.evaluate(() => { app.state.settings.base = { ...(app.state.settings.base || {}), mots: { visible: false } }; app.commit(); });
  assert.equal(await page.locator("table.grid thead th", { hasText: "Mots-clés" }).count(), 0);
  noErrors(page);
  await page.context().close();
});

test("colonnes : glisser un titre pour changer l'ordre (enregistré avec les données, annulable)", async () => {
  const page = await env.page({ viewport: { width: 1500, height: 800 } });
  await createVault(page);
  const heads = () => page.$$eval("table.grid thead th", (t) => t.map((x) => x.textContent.trim().replace(/\s+/g, " ")));
  const drag = async (from, to, side) => {
    const a = await page.locator("table.grid thead th", { hasText: from }).first().boundingBox();
    const b = await page.locator("table.grid thead th", { hasText: to }).first().boundingBox();
    const y = a.y + a.height / 2;
    await page.mouse.move(a.x + a.width / 2, y);
    await page.mouse.down();
    await page.mouse.move(a.x + a.width / 2 + 20, y, { steps: 3 });
    await page.mouse.move(side === "before" ? b.x + 6 : b.x + b.width - 6, y, { steps: 8 });
    assert.equal(await page.locator(".colguide").count(), 1, "repère d'insertion affiché");
    await page.mouse.up();
  };
  const before = await heads();
  assert.deepEqual(before.slice(7, 10), ["📚Travail en séance (T1)", "🏠Travail à la maison (T1)", "🎒Oubli matériel (T1)"]);
  // « Oubli » glissé devant « Travail en séance »
  await drag("Oubli", "Travail en séance", "before");
  assert.deepEqual((await heads()).slice(7, 10), ["🎒Oubli matériel (T1)", "📚Travail en séance (T1)", "🏠Travail à la maison (T1)"]);
  assert.equal(await page.locator(".colguide").count(), 0);
  const ordre = await page.evaluate(() => app.state.settings.ordre);
  assert.ok(ordre.indexOf("oubli") < ordre.indexOf("qualSeance") && ordre.indexOf("oubli") > ordre.indexOf("notes"), "ordre enregistré : " + ordre);
  // le groupe des notes (T1, T2, T3) se déplace d'un bloc : T2 glissé après « Commentaire bulletin »
  await drag("T2", "Commentaire", "after");
  const h2 = await heads();
  assert.deepEqual(h2.slice(-5, -2), ["T1 /20", "T2 /20", "T3 /20"].slice(0, 0).concat(h2.slice(-5, -2)));
  assert.ok(h2.indexOf("T1 /20") > h2.indexOf("Commentaire bulletin") && h2.indexOf("T3 /20") === h2.indexOf("T1 /20") + 2, h2.join(" | "));
  // simple clic sur un titre : rien ne bouge
  const stable = await heads();
  await page.locator("table.grid thead th", { hasText: "Prénom" }).first().click();
  assert.deepEqual(await heads(), stable);
  // annuler ramène l'ordre précédent
  await page.keyboard.press("Escape");
  await page.evaluate(() => app.undoAction());
  assert.deepEqual((await heads()).slice(7, 10), ["🎒Oubli matériel (T1)", "📚Travail en séance (T1)", "🏠Travail à la maison (T1)"]);
  await page.evaluate(() => app.undoAction());
  assert.deepEqual(await heads(), before);
  noErrors(page);
  await page.context().close();
});

test("menu d'un titre de colonne : copier, maintenir au début, pictogramme, cacher et réafficher", async () => {
  const page = await env.page({ viewport: { width: 1500, height: 800 } });
  await createVault(page);
  await page.evaluate(() => {
    window.__clip = null;
    Object.defineProperty(navigator.clipboard, "writeText", { value: async (t) => { window.__clip = t; }, configurable: true });
  });
  const th = (txt) => page.locator("table.grid thead th", { hasText: txt }).first();
  const heads = () => page.$$eval("table.grid thead th", (t) => t.map((x) => x.textContent.trim().replace(/\s+/g, " ")));
  const menuOn = async (txt) => { await th(txt).click({ button: "right" }); await page.waitForSelector(".menu"); };
  const items = () => page.$$eval(".menu button", (b) => b.map((x) => x.textContent.trim()));
  // 1. copier : une valeur par ligne (T1), notes particulières comprises, puis avec les noms
  await page.evaluate(() => { app.state.classes[0].eleves.find((s) => s.nom === "CHARPENTIER").notes["1"] = "a"; app.commit(); });
  await menuOn("T1 /20");
  assert.ok((await items()).some((t) => /Copier la colonne \(une valeur par ligne\)/.test(t)));
  await page.locator(".menu >> text=Copier la colonne (une valeur par ligne)").click();
  await page.waitForFunction(() => window.__clip !== null);
  assert.equal(await page.evaluate(() => window.__clip), "14,5\r\n11\r\nAbs\r\n17\r\n12\r\n13\r\n\r\n19");  // comme une colonne de tableur : à coller dans PRONOTE
  await menuOn("T1 /20");
  await page.locator(".menu >> text=Copier la colonne avec les noms des élèves").click();
  await page.waitForFunction(() => window.__clip && window.__clip.startsWith("ANDRÉ Léa"));
  assert.equal((await page.evaluate(() => window.__clip)).split("\r\n")[0], "ANDRÉ Léa\t14,5");
  // 2. maintenir au début : la colonne vient après Prénom, devient fixe et s'enregistre
  await menuOn("Oubli");
  await page.locator(".menu >> text=Maintenir au début du tableau").click();
  let order = await heads();
  assert.deepEqual(order.slice(0, 5), ["n°", "Nom", "Prénom", "🎒Oubli matériel (T1)", "Infos (PAI…)"]);
  assert.equal(await page.locator("table.grid thead th.stick", { hasText: "Oubli" }).count(), 1);
  assert.deepEqual(await page.evaluate(() => app.state.settings.epingles), ["numero", "nom", "prenom", "oubli"]);
  await menuOn("Oubli");
  assert.ok((await items()).some((t) => /Ne plus maintenir au début/.test(t)));
  await page.locator(".menu >> text=Ne plus maintenir au début du tableau").click();
  assert.equal(await page.locator("table.grid thead th.stick", { hasText: "Oubli" }).count(), 0);
  assert.deepEqual(await page.evaluate(() => app.state.settings.epingles), ["numero", "nom", "prenom"]);
  // 3. pictogramme à la place du titre, pour cette colonne seulement
  await menuOn("Oubli");
  await page.locator(".menu >> text=Remplacer le titre par un pictogramme").click();
  await page.waitForSelector(".emojis button");
  await page.locator(".emojis button", { hasText: "⭐" }).first().click();
  assert.equal(await page.locator("table.grid thead th.iconly").count(), 1);
  assert.equal((await page.locator("table.grid thead th.iconly").first().textContent()).trim(), "⭐");
  assert.deepEqual(await page.evaluate(() => [app.state.settings.icones, app.state.settings.builtin.oubli.emoji]), [["oubli"], "⭐"]);
  await page.locator("table.grid thead th.iconly").click({ button: "right" });
  await page.locator(".menu >> text=Rétablir le titre").click();
  assert.equal(await page.locator("table.grid thead th.iconly").count(), 0);
  // 4. cacher (sauf le nom), puis réafficher depuis le menu d'une autre colonne
  await menuOn("Nom");
  assert.equal(await page.locator(".menu button", { hasText: "Cacher la colonne" }).isDisabled(), true);
  await page.keyboard.press("Escape");
  await menuOn("Oubli");
  await page.locator(".menu >> text=Cacher la colonne").click();
  assert.equal((await heads()).some((t) => /Oubli/.test(t)), false);
  await menuOn("Prénom");
  assert.ok((await items()).some((t) => /Réafficher : Oubli matériel/.test(t)));
  await page.locator(".menu >> text=Réafficher : Oubli matériel").click();
  assert.equal((await heads()).some((t) => /Oubli/.test(t)), true);
  // 5. tout s'annule : l'état initial est retrouvé
  for (let k = 0; k < 8; k++) await page.evaluate(() => app.undoAction());
  noErrors(page);
  await page.context().close();
});
