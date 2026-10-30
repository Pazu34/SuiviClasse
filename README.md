# SuiviClasse

Application de suivi quotidien des élèves, remplaçant le classeur Excel « Suivi modèle » :

- une **classe par onglet**, liste d'élèves (n°, nom, prénom, infos PAI / handicap / situation) ;
- **notes trimestrielles** T1, T2, T3 (/20) et moyenne ;
- **commentaires trimestriels** pour les bulletins ;
- **implication en séance** (boutons +0,5 / +1 / −0,5 / −1), **travail non fait** et **oublis de matériel**, comptés **par trimestre**, avec couleurs d'alerte (seuils réglables) ;
- **fiche élève** avec journal daté de chaque événement (et possibilité de le supprimer) ;
- **export CSV** par classe (ouvrable dans Excel) pour préparer les bulletins ;
- ajout d'élèves par copier‑coller depuis Excel ou import CSV.

## Préférences

Bouton **⚙ Préférences** (ou `Ctrl+,`) : seuils d'alerte orange/rouge pour les oublis de matériel, le travail non fait et l'implication en séance, délai de verrouillage automatique. Les réglages sont enregistrés dans `preferences.json` (lisible, non chiffré) dans le dossier de données, donc ils suivent la clé USB.

Pour ajouter un réglage : ajouter une entrée au tableau `SCHEMA` de `src/prefs.js` (clé, libellé, bornes, valeur par défaut) ; il apparaît dans la fenêtre et est validé automatiquement. Il reste ensuite à l'utiliser dans `src/renderer/app.js` via `prefs.values.<clé>`.

## Données et sécurité

- Tout est stocké dans **un seul fichier chiffré** `suivi.enc`, dans le dossier `SuiviClasse-Donnees` placé **à côté de l'exécutable** (donc sur la clé USB). Le dossier peut être changé depuis l'écran de connexion (« Autre dossier… »).
- Chiffrement **AES‑256‑GCM**, clé dérivée du mot de passe par **scrypt** (N=32768). Un fichier modifié ou un mauvais mot de passe est détecté.
- **Mot de passe perdu = données irrécupérables.** Minimum 8 caractères.
- Une sauvegarde chiffrée par jour est conservée dans `sauvegardes/` (15 dernières).
- Enregistrement automatique à chaque modification ; verrouillage automatique (15 min par défaut, réglable).
- Le cache de l'application reste dans le dossier de données (rien sur le PC hôte). L'export CSV, lui, **n'est pas chiffré**.

## Utilisation (Windows, clé USB)

1. Récupérer `SuiviClasse-portable.exe` (voir « Construire »).
2. Le copier sur la clé USB, le lancer. Au premier lancement : choisir un mot de passe.

## Construire

Le `.exe` portable se fabrique sous Windows (ou via GitHub Actions) :

- **GitHub** : l'onglet *Actions* → « Build Windows portable » → télécharger l'artefact `SuiviClasse-portable`.
- **Localement** : `npm install` puis `npm run dist` → `dist/SuiviClasse-portable.exe`.

## Développement

```bash
npm install
npm start      # lance l'application
npm test       # tests du coffre chiffré et des préférences
```
