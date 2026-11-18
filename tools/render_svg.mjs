// Rend un SVG en PNG transparent avec Chromium (Playwright, installé dans mobile/). Usage : node render_svg.mjs entrée.svg sortie.png taille
import { createRequire } from "node:module";
import fs from "node:fs";
const { chromium } = createRequire(new URL("../mobile/package.json", import.meta.url).pathname)("playwright");
const [,, svgPath, out, size] = process.argv;
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: +size, height: +size } });
const svg = fs.readFileSync(svgPath, "utf8");
await p.setContent(`<body style="margin:0;background:transparent">${svg.replace("<svg ", `<svg width="${size}" height="${size}" `)}</body>`);
await p.screenshot({ path: out, omitBackground: true }); await b.close();
