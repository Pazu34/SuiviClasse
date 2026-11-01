# SuiviClasse

Application de suivi quotidien des élèves, qui remplace un classeur Excel de suivi de classes. Écrite en **Python** (interface Tkinter, fournie avec Python), open source (GPL‑3.0).

- une **classe par onglet**, liste d'élèves (n°, nom, prénom, date de naissance, infos PAI / handicap / situation) ;
- **notes trimestrielles** T1, T2, T3 (/20) et moyenne ;
- **commentaires trimestriels** pour les bulletins (avec contrôle de la longueur maximale) ;
- **implication en séance** (boutons +0,5 / +1 / −0,5 / −1), **travail non fait** et **oublis de matériel**, comptés **par trimestre**, avec couleurs d'alerte (seuils réglables) ;
- **fiche élève** avec journal daté de chaque événement ;
- **échanges avec PRONOTE et les tableurs** (voir plus bas) ;
- **données chiffrées par mot de passe**, **archives automatiques** pour revenir en arrière, **version portable** pour clé USB.

## Lancer le programme

Prérequis : [Python](https://www.python.org/downloads/) 3.9 ou plus (sous Windows, cocher « Add python.exe to PATH » et laisser « tcl/tk » coché à l'installation).

```powershell
git clone https://github.com/Pazu34/SuiviClasse.git
cd SuiviClasse
py -m pip install -r requirements.txt
py suiviclasse
```

(`py -m suiviclasse` fonctionne aussi, ainsi qu'un double‑clic sur `lancer.pyw` sous Windows.) Au premier lancement, choisissez un mot de passe.

## Version portable (clé USB, Windows)

- **Sans rien installer** : sur GitHub, onglet *Actions* → « Build Windows portable » → télécharger l'artefact `SuiviClasse-portable` (contient `SuiviClasse.exe`).
- **Ou le fabriquer soi‑même** : `py -m pip install -r requirements-dev.txt` puis `build_windows.bat` → `dist\SuiviClasse.exe`.

Copiez `SuiviClasse.exe` sur la clé : le dossier `SuiviClasse-Donnees` se crée à côté de lui, et toutes les données y restent.

## Données et sécurité

- Tout est stocké dans **un seul fichier chiffré** `suivi.enc`, dans le dossier `SuiviClasse-Donnees` situé à côté du programme (donc sur la clé USB). Le dossier peut être changé depuis l'écran de connexion (« Autre dossier… »).
- Chiffrement **AES‑256‑GCM**, clé dérivée du mot de passe par **scrypt** (N=32768). Un fichier modifié ou un mauvais mot de passe est détecté.
- **Mot de passe perdu = données irrécupérables.** Minimum 8 caractères.
- **Enregistrement continu** : chaque modification est écrite dans `suivi.enc` une demi‑seconde plus tard, et à la fermeture.
- **Archives** (bouton 🕘 Archives) : copies chiffrées horodatées dans `sauvegardes/`, créées toutes les 15 min (réglable, 0 = désactivé) si les données ont changé, ainsi qu'à l'ouverture, à la fermeture et avant une restauration ou un changement de mot de passe. On garde les 20 plus récentes puis une par jour pendant 30 jours (réglable). Chaque archive peut être restaurée ; l'état actuel est lui‑même archivé juste avant. Une archive antérieure à un changement de mot de passe redemande l'ancien mot de passe.
- Verrouillage automatique après inactivité (15 min par défaut, réglable).
- Les archives sont sur la même clé que les données : copiez de temps en temps le dossier `SuiviClasse-Donnees` ailleurs (il est chiffré, la copie est sûre). Les exports CSV/texte, eux, **ne sont pas chiffrés**.

## Échanges avec PRONOTE

Basés sur la documentation PRONOTE 2026 de l'éditeur (fiches « Exporter au format texte », « Comment importer les données d'un tableur dans une liste ? », « Comment exporter les notes dans un tableur ? », « Créer un devoir et saisir les notes », « Comment augmenter la taille maximale des appréciations ? »).

**Liste d'élèves PRONOTE** : le bouton « ⭳ Importer une liste PRONOTE » (utilisable dès le premier lancement, sans classe) accepte directement le tableau copié depuis PRONOTE (colonnes `Élève`, `Né(e) le`, `Classe`) : les classes sont créées et triées, les élèves répartis, la date de naissance conservée (elle distingue deux homonymes). Un aperçu indique ce qui sera créé ou mis à jour, et réimporter la même liste ne crée aucun doublon.

**Importer** (bouton « ⭳ Importer / ajouter des élèves… ») : dans PRONOTE, le bouton de copie en haut à droite d'une liste (ou du tableau de notes) place les données dans le presse‑papiers avec des tabulations ; collez‑les dans la fenêtre d'import (ou ouvrez un fichier texte/CSV, UTF‑8 ou Windows‑1252). Comme dans PRONOTE : séparateur détecté ou choisi, « ne pas importer les x premières lignes », association de chaque colonne à une rubrique (Nom, Prénom, Nom et prénom, Classe, Date de naissance, Infos, Note T1‑T3, Appréciation T1‑T3 ; les titres sont reconnus automatiquement).
- Les élèves sont reconnus par nom + prénom (accents, majuscules, tirets ignorés) ; les existants sont mis à jour, les autres créés si la case est cochée.
- Les notes acceptent la virgule décimale et les annotations PRONOTE : `A D N I R` / `Abs Disp N.Not Inap N.Rdu` (non comptées : la note n'est pas modifiée) et `Z W` / `Abs* N.Rdu*` (comptées 0).

**Exporter** (bouton « ⭱ Exporter (PRONOTE, tableur)… ») : choix du trimestre, des champs (nom, prénom, classe, infos, note, appréciation, séance +/−, travail, oublis), ligne de titres facultative, séparateur tabulation ou point‑virgule ; « Copier » place le tableau dans le presse‑papiers, « Enregistrer » crée un fichier texte UTF‑8.

À savoir : d'après la documentation, l'import de listes dans PRONOTE est réservé au mode administratif ; côté professeur, les appréciations se saisissent dans *Bulletins > Saisie des appréciations*. Aucune fonction d'import des appréciations depuis un fichier n'est documentée pour les professeurs : l'export est donc prévu pour un copier‑coller ou une saisie assistée, à vérifier dans votre PRONOTE. La longueur maximale d'une appréciation (255 caractères par défaut dans PRONOTE, réglable par l'administration) est réglable dans les préférences ; les appréciations trop longues sont signalées en rouge et à l'export.

## Préférences

Bouton **⚙ Préférences** (ou `Ctrl+,`) : densité du tableau (**resserré** par défaut, pour un portable ; **normal** pour un grand écran), seuils d'alerte orange/rouge, archives automatiques, longueur des appréciations, verrouillage automatique. Les réglages sont enregistrés dans `preferences.json` (lisible, non chiffré) dans le dossier de données.

Pour ajouter un réglage : ajouter une entrée au tableau `SCHEMA` de `suiviclasse/prefs.py` (clé, libellé, bornes, valeur par défaut) ; il apparaît dans la fenêtre et est validé automatiquement. Il reste à l'utiliser via `app.values["<clé>"]`.

## Organisation du code

| Fichier | Rôle |
|---|---|
| `suiviclasse/vault.py` | coffre chiffré (scrypt + AES‑GCM), archives |
| `suiviclasse/prefs.py` | préférences (schéma → validation → fenêtre) |
| `suiviclasse/exchange.py` | import/export PRONOTE et tableurs (fonctions pures) |
| `suiviclasse/model.py` | structure des données et calculs (compteurs, moyennes) |
| `suiviclasse/paths.py` | emplacement du dossier de données |
| `suiviclasse/ui/app.py` | fenêtre principale, enregistrement, archives, verrouillage |
| `suiviclasse/ui/table.py` | tableau d'une classe |
| `suiviclasse/ui/dialogs.py` | fiche élève, import, export, archives, préférences |

Les fichiers de données sont compatibles avec la première version de SuiviClasse (Electron) : un `suivi.enc` existant s'ouvre tel quel.

## Tests

```bash
python -m unittest discover -s tests -t .
```
