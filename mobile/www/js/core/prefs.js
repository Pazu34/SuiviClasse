// Préférences : mêmes réglages, mêmes valeurs par défaut et même validation que suiviclasse/prefs.py.
// Le fichier « preferences.json » du PC peut être importé tel quel (les réglages propres au PC sont conservés mais ignorés).
import { pyFloat, pyRound } from "./util.js";

export const FILE = "preferences.json";

export const SCHEMA = [
  { key: "periodes", group: "Affichage", label: "Découpage de l’année", type: "choice", default: "trimestres",
    options: [["trimestres", "Trimestres (T1 à T3)"], ["semestres", "Semestres (S1 et S2)"]] },
  { key: "theme", group: "Affichage", label: "Thème", type: "choice", default: "clair",
    options: [["clair", "Clair"], ["sombre", "Sombre"], ["auto", "Automatique (suit la tablette)"]] },
  { key: "pictogrammes", group: "Affichage", label: "Pictogrammes dans les titres", type: "choice", default: "oui",
    options: [["oui", "Oui"], ["non", "Non"]] },
  { key: "titresColonnes", group: "Affichage", label: "Titres des colonnes du tableau", type: "choice", default: "texte",
    options: [["texte", "Titres (avec pictogrammes si activés)"], ["icones", "Pictogrammes seuls"], ["inclines", "Titres inclinés à 60° (carnet papier)"]] },
  { key: "planAffichage", group: "Affichage", label: "Noms dans le plan de classe", type: "choice", default: "prenom_nom",
    options: [["prenom_nom", "Prénom Nom"], ["prenom", "Prénom"], ["nom", "Nom"], ["prenom_i", "Prénom + initiale du nom"], ["initiales", "Initiales"]] },
  { key: "affichage", group: "Affichage", label: "Densité du tableau", type: "choice", default: "compact",
    options: [["compact", "Resserré"], ["normal", "Confortable"]] },
  { key: "colonneFigee", group: "Affichage", label: "Colonnes figées au départ (clic droit sur un titre pour en épingler d’autres)", type: "choice", default: "prenom",
    options: [["aucune", "Aucune"], ["nom", "Jusqu'au nom"], ["prenom", "Jusqu'au prénom (n°, nom, prénom)"], ["infos", "Jusqu'aux infos (PAI…)"]] },
  { key: "oubliOrange", group: "Alertes — oublis de matériel", label: "Orange à partir de", type: "int", min: 1, max: 99, default: 2, unit: "par période" },
  { key: "oubliRouge", group: "Alertes — oublis de matériel", label: "Rouge à partir de", type: "int", min: 1, max: 99, default: 3, unit: "par période" },
  { key: "travailOrange", group: "Alertes — travail non fait", label: "Orange à partir de", type: "int", min: 1, max: 99, default: 2, unit: "par période" },
  { key: "travailRouge", group: "Alertes — travail non fait", label: "Rouge à partir de", type: "int", min: 1, max: 99, default: 3, unit: "par période" },
  { key: "seancePlusVert", group: "Alertes — implication en séance", label: "Séance + : vert à partir de", type: "number", min: 0.5, max: 99, default: 3, unit: "pts" },
  { key: "seanceMoinsRouge", group: "Alertes — implication en séance", label: "Séance − : rouge à partir de", type: "number", min: 0.5, max: 99, default: 2, unit: "pts (valeur absolue)" },
  { key: "backupMinutes", group: "Sauvegardes automatiques", label: "Créer une archive toutes les", type: "int", min: 0, max: 1440, default: 15, unit: "min (0 = désactivé)" },
  { key: "backupKeepRecent", group: "Sauvegardes automatiques", label: "Archives récentes conservées", type: "int", min: 1, max: 500, default: 20, unit: "archives" },
  { key: "backupKeepDays", group: "Sauvegardes automatiques", label: "Puis 1 archive par jour pendant", type: "int", min: 0, max: 3650, default: 30, unit: "jours" },
  { key: "appPredictif", group: "Bulletins", label: "Appréciations : proposer des mots pendant la frappe (Tab pour valider)", type: "choice", default: "oui",
    options: [["oui", "Oui"], ["non", "Non"]] },
  { key: "appAbreviations", group: "Bulletins", label: "Appréciations : remplacer les abréviations (tb → très bien)", type: "choice", default: "oui",
    options: [["oui", "Oui"], ["non", "Non"]] },
  { key: "appreciationMax", group: "Bulletins", label: "Appréciation : longueur max.", type: "int", min: 50, max: 5000, default: 255, unit: "caractères (PRONOTE : 255)" },
  { key: "autoLockMinutes", group: "Sécurité", label: "Verrouiller après", type: "int", min: 0, max: 240, default: 15, unit: "min d’inactivité (0 = jamais)" },
];

const TAB_OF_GROUP = { "Affichage": "Affichage", "Sauvegardes automatiques": "Sauvegardes", "Sécurité": "Sécurité et bulletins", "Bulletins": "Sécurité et bulletins" };
for (const f of SCHEMA) f.tab = TAB_OF_GROUP[f.group] || "Alertes";
export const TABS = [...new Set(SCHEMA.map((f) => f.tab))];

export const defaults = () => Object.fromEntries(SCHEMA.map((f) => [f.key, f.default]));

/** Ramène n'importe quel objet à des valeurs valides (clés inconnues ignorées, manquantes = défaut). */
export function sanitize(src) {
  src = src && typeof src === "object" && !Array.isArray(src) ? src : {};
  const out = {};
  for (const f of SCHEMA) {
    if (f.type === "choice") {
      const v = src[f.key];
      out[f.key] = f.options.some(([k]) => k === v) ? v : f.default;
      continue;
    }
    let v = pyFloat(String(src[f.key]).replace(",", "."));
    if (!Number.isFinite(v)) v = f.default;
    if (f.type === "int") v = pyRound(v);
    out[f.key] = Math.min(f.max, Math.max(f.min, v));
  }
  out.oubliOrange = Math.min(out.oubliOrange, out.oubliRouge);  // l'orange ne peut pas être au-dessus du rouge
  out.travailOrange = Math.min(out.travailOrange, out.travailRouge);
  return out;
}
