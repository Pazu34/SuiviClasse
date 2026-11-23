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
  assert.deepEqual(heads, ["n°", "Nom", "Prénom", "Infos (PAI…)", "T1 /20", "T2 /20", "T3 /20", "📚Travail en séance (T1)", "🏠Travail à la maison (T1)", "🎒Oubli matériel (T1)", "Commentaire bulletin", ""]);
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
  await names.nth(0).fill("Très bien"); await names.nth(1).fill("Bien"); await names.nth(2).fill("À revoir");
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
  await page.locator(".settingrow", { hasText: "Colonnes figées dans le tableau" }).locator("select").waitFor();
  assert.equal(await page.locator(".settingrow", { hasText: "Colonnes figées dans le tableau" }).locator("select").inputValue(), "aucune");
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
  assert.ok(box.height > 60 && box.height <= 160, "hauteur d'en-tête adaptée : " + box.height);
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
