# SuiviClasse

Application de suivi quotidien des élèves, remplaçant le classeur Excel « Suivi modèle » :

- une **classe par onglet**, liste d'élèves (n°, nom, prénom, infos PAI / handicap / situation) ;
- **notes trimestrielles** T1, T2, T3 (/20) et moyenne ;
- **commentaires trimestriels** pour les bulletins ;
- **implication en séance** (boutons +0,5 / +1 / −0,5 / −1), **travail non fait** et **oublis de matériel**, comptés **par trimestre**, avec couleurs d'alerte (seuils réglables) ;
- **fiche élève** avec journal daté de chaque événement (et possibilité de le supprimer) ;
- **export CSV** par classe (ouvrable dans Excel) pour préparer les bulletins ;
- **échanges avec PRONOTE et les tableurs** (voir ci-dessous).

## Échanges avec PRONOTE

Basés sur la documentation PRONOTE 2026 de l'éditeur (fiches « Exporter au format texte », « Comment importer les données d'un tableur dans une liste ? », « Comment exporter les notes dans un tableur ? », « Créer un devoir et saisir les notes », « Comment augmenter la taille maximale des appréciations ? »).

**Liste d'élèves PRONOTE** : le bouton « ⭳ Importer une liste PRONOTE » (utilisable dès le premier lancement, sans classe) accepte directement le tableau copié depuis PRONOTE (colonnes `Élève`, `Né(e) le`, `Classe`) : les classes sont créées et triées, les élèves répartis, la date de naissance conservée (elle distingue deux homonymes). Un aperçu indique ce qui sera créé ou mis à jour, et réimporter la même liste ne crée aucun doublon.

**Importer** (bouton « ⭳ Importer / ajouter des élèves… ») : dans PRONOTE, le bouton de copie en haut à droite d'une liste (liste d'élèves, tableau de notes, moyennes…) place les données en colonnes séparées par des tabulations ; collez-les dans la fenêtre d'import (ou ouvrez un fichier texte/CSV exporté, UTF‑8 ou Windows‑1252). Comme dans PRONOTE : séparateur détecté ou choisi, « ne pas importer les x premières lignes », association de chaque colonne à une rubrique (Nom, Prénom, Nom et prénom, Classe, Infos, Note T1‑T3, Appréciation T1‑T3 ; les titres de colonnes sont reconnus automatiquement).
- Les élèves sont reconnus par nom + prénom (accents, majuscules, tirets ignorés) ; ceux qui existent sont mis à jour, les autres créés si la case est cochée. Une colonne « Classe » répartit les élèves et crée les classes manquantes.
- Les notes acceptent la virgule décimale et les annotations PRONOTE : `A D N I R` / `Abs Disp N.Not Inap N.Rdu` (non comptées, la note n'est pas modifiée) et `Z W` / `Abs* N.Rdu*` (comptées 0).

**Exporter** (bouton « ⭱ Exporter (PRONOTE, tableur)… ») : choix du trimestre, des champs (nom, prénom, classe, infos, note, appréciation, séance +/−, travail, oublis), ligne de titres facultative, séparateur tabulation ou point‑virgule ; « Copier » place le tableau dans le presse‑papiers, « Enregistrer » crée un fichier texte UTF‑8.

À savoir : d'après la documentation, l'import de listes dans PRONOTE est réservé au mode administratif ; côté professeur, les appréciations se saisissent dans *Bulletins > Saisie des appréciations*. Je n'ai trouvé dans la documentation aucune fonction d'import des appréciations depuis un fichier pour les professeurs : l'export est donc prévu pour un copier‑coller ou une saisie assistée, à vérifier dans votre PRONOTE. La longueur maximale d'une appréciation (255 caractères par défaut dans PRONOTE, réglable par l'administration) est réglable dans les préférences ; les appréciations trop longues sont signalées en rouge et à l'export.

## Préférences

Bouton **⚙ Préférences** (ou `Ctrl+,`) : seuils d'alerte orange/rouge pour les oublis de matériel, le travail non fait et l'implication en séance, délai de verrouillage automatique. Les réglages sont enregistrés dans `preferences.json` (lisible, non chiffré) dans le dossier de données, donc ils suivent la clé USB.

Pour ajouter un réglage : ajouter une entrée au tableau `SCHEMA` de `src/prefs.js` (clé, libellé, bornes, valeur par défaut) ; il apparaît dans la fenêtre et est validé automatiquement. Il reste ensuite à l'utiliser dans `src/renderer/app.js` via `prefs.values.<clé>`.

## Données et sécurité

- Tout est stocké dans **un seul fichier chiffré** `suivi.enc`, dans le dossier `SuiviClasse-Donnees` placé **à côté de l'exécutable** (donc sur la clé USB). Le dossier peut être changé depuis l'écran de connexion (« Autre dossier… »).
- Chiffrement **AES‑256‑GCM**, clé dérivée du mot de passe par **scrypt** (N=32768). Un fichier modifié ou un mauvais mot de passe est détecté.
- **Mot de passe perdu = données irrécupérables.** Minimum 8 caractères.
- **Enregistrement continu** : chaque modification est écrite dans `suivi.enc` une demi-seconde plus tard, et à la fermeture de la fenêtre.
- **Archives** (bouton 🕘 Archives) : copies chiffrées horodatées dans `sauvegardes/`, créées toutes les 15 min (réglable, 0 = désactivé) si les données ont changé, ainsi qu'à l'ouverture, à la fermeture et avant une restauration ou un changement de mot de passe. On garde les 20 plus récentes puis une par jour pendant 30 jours (réglable dans les Préférences). Chaque archive peut être restaurée ; l'état actuel est lui-même archivé juste avant. Une archive antérieure à un changement de mot de passe redemande l'ancien mot de passe.
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
