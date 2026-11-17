// Aides pour les tests d'interface : navigateur Chromium simulant la tablette (Galaxy Tab S6, 1280 × 800 px CSS, tactile).
import { createRequire } from "node:module";
import { serve } from "./server.mjs";

const { chromium } = createRequire(import.meta.url)("playwright");
export const PW = "motdepasse1";
export const SHOTS = process.env.SHOTS || "";

export async function launch() {
  const server = await serve();
  const browser = await chromium.launch();
  return {
    server, browser,
    async page(opts = {}) {
      const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 }, hasTouch: true, locale: "fr-FR", timezoneId: "Europe/Paris", acceptDownloads: true, ...opts });
      ctx.setDefaultTimeout(8000);
      await ctx.addInitScript(() => { window.__syncRender = true; });
      const page = await ctx.newPage();
      const errors = [];
      page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
      page.on("console", (m) => { if (m.type() === "error") errors.push("console: " + m.text()); });
      page.errors = errors;
      await page.goto(server.url);
      return page;
    },
    async close() { await browser.close(); server.close(); },
  };
}

/** Crée un coffre (mot de passe PW) et attend le tableau. */
export async function createVault(page, pw = PW) {
  await page.waitForSelector(".login");
  await page.fill('input[aria-label="Mot de passe"]', pw);
  await page.fill('input[aria-label="Confirmer le mot de passe"]', pw);
  await page.click('button:has-text("Créer le coffre")');
  await page.waitForSelector("table.grid", { timeout: 30000 });
}

export async function unlock(page, pw = PW) {
  await page.waitForSelector(".login");
  await page.fill('input[aria-label="Mot de passe"]', pw);
  await page.click('button:has-text("Déverrouiller")');
  await page.waitForSelector("table.grid", { timeout: 30000 });
}

export const row = (page, nom) => page.locator("table.grid tbody tr", { has: page.locator(`td.nom:text-is("${nom}")`) });
export const settle = (page) => page.waitForFunction(() => window.app && !window.app.dirty && window.app.status.includes("Enregistré"), null, { timeout: 15000 });
export const shot = async (page, name) => { if (SHOTS) await page.screenshot({ path: `${SHOTS}/${name}.png` }); };

/** Attend que l'interface ait fini de se reconstruire après une modification. */
export const rendered = (page) => page.evaluate(() => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => setTimeout(r, 30)))));
