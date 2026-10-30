'use strict';
// Préférences de l'application : fichier JSON lisible (non chiffré, rien de sensible)
// dans le dossier de données. Pour ajouter un réglage, il suffit d'ajouter une entrée
// à SCHEMA : valeur par défaut, validation et fenêtre « Préférences » en découlent.
const fs = require('fs');
const path = require('path');

const FILE = 'preferences.json';

const SCHEMA = [
  { key: 'oubliOrange', group: 'Alertes — oublis de matériel', label: 'Orange à partir de', type: 'int', min: 1, max: 99, default: 2, unit: 'oublis par trimestre' },
  { key: 'oubliRouge', group: 'Alertes — oublis de matériel', label: 'Rouge à partir de', type: 'int', min: 1, max: 99, default: 3, unit: 'oublis par trimestre' },
  { key: 'travailOrange', group: 'Alertes — travail non fait', label: 'Orange à partir de', type: 'int', min: 1, max: 99, default: 2, unit: 'fois par trimestre' },
  { key: 'travailRouge', group: 'Alertes — travail non fait', label: 'Rouge à partir de', type: 'int', min: 1, max: 99, default: 3, unit: 'fois par trimestre' },
  { key: 'seancePlusVert', group: 'Alertes — implication en séance', label: 'Séance + : vert à partir de', type: 'number', min: 0.5, max: 99, default: 3, unit: 'points' },
  { key: 'seanceMoinsRouge', group: 'Alertes — implication en séance', label: 'Séance − : rouge à partir de', type: 'number', min: 0.5, max: 99, default: 2, unit: 'points (valeur absolue)' },
  { key: 'autoLockMinutes', group: 'Sécurité', label: 'Verrouillage automatique après', type: 'int', min: 0, max: 240, default: 15, unit: 'minutes d’inactivité (0 = jamais)' },
];

const defaults = () => Object.fromEntries(SCHEMA.map(f => [f.key, f.default]));

// Ramène n'importe quel objet à des valeurs valides (clés inconnues ignorées, manquantes = défaut).
function sanitize(input) {
  const src = input && typeof input === 'object' ? input : {};
  const out = {};
  for (const f of SCHEMA) {
    let v = Number(src[f.key]);
    if (src[f.key] === '' || src[f.key] == null || !Number.isFinite(v)) v = f.default;
    if (f.type === 'int') v = Math.round(v);
    out[f.key] = Math.min(f.max, Math.max(f.min, v));
  }
  // l'orange ne peut pas être au-dessus du rouge
  out.oubliOrange = Math.min(out.oubliOrange, out.oubliRouge);
  out.travailOrange = Math.min(out.travailOrange, out.travailRouge);
  return out;
}

class Prefs {
  constructor(dir) { this.file = path.join(dir, FILE); this.values = this.load(); }
  load() {
    try { return sanitize(JSON.parse(fs.readFileSync(this.file, 'utf8'))); }
    catch { return defaults(); }
  }
  set(values) {
    this.values = sanitize({ ...this.values, ...values });
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify(this.values, null, 2));
    return this.values;
  }
  reset() { return this.set(defaults()); }
  describe() { return { values: this.values, schema: SCHEMA, file: this.file }; }
}

module.exports = { Prefs, SCHEMA, defaults, sanitize, FILE };
