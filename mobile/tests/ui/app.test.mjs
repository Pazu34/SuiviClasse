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
  await page.waitForFunction(() => app.values.periodes === "semestres");
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
