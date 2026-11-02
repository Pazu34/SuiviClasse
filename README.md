# SuiviClasse

Application de suivi quotidien des élèves, qui remplace un classeur Excel de suivi de classes. Écrite en **Python** (interface Tkinter, fournie avec Python), open source (GPL‑3.0).

- une **classe par onglet**, liste d'élèves (n°, nom, prénom, date de naissance, infos PAI / handicap / situation) ;
- **notes de période** T1, T2, T3 (/20, ou S1 et S2, barème réglable) ;
- **commentaires trimestriels** pour les bulletins (avec contrôle de la longueur maximale) ;
- **implication en séance** (boutons +0,5 / +1 / −0,5 / −1), **travail non fait** et **oublis de matériel**, comptés **par trimestre**, avec couleurs d'alerte (seuils réglables) ;
- **fiche élève** avec journal daté de chaque événement ;
- **échanges avec PRONOTE et les tableurs** (voir plus bas) ;
- **données chiffrées par mot de passe**, **archives automatiques** pour revenir en arrière, **version portable** pour clé USB.

## Le tableau

- **Colonnes redimensionnables** : glissez le bord droit d'un titre de colonne ; **double-clic** sur ce bord pour revenir à la largeur par défaut. Les largeurs sont mémorisées (par densité de tableau) dans `preferences.json` ; **Préférences → Rétablir les largeurs de colonnes** les remet toutes à zéro.
- **Retour à la ligne automatique** : les titres trop longs, les noms, les infos et les appréciations passent à la ligne dans leur colonne et la hauteur de la ligne s'adapte.
- **Ordre des classes** : glissez un bouton de classe (ligne « Classes : ») vers un autre endroit de la rangée pour la déplacer ; un simple clic la sélectionne. Un import ou l'ajout de la classe Test place les nouvelles classes à la fin sans toucher à votre ordre.
- **Tout se modifie en cliquant sur la valeur** : n°, nom, prénom, infos (Maj+Entrée pour un retour à la ligne), notes, totaux de séance + et −, travail non fait, oublis, commentaire. Entrée ou un clic ailleurs valide, Échap annule. Les boutons d'incrément restent disponibles pour les corrections rapides.
- **n°** : le n° de chaque élève est libre. Si un n° est déjà pris dans la classe, une fenêtre le signale et demande s'il faut garder le doublon ; les n° en double sont surlignés en rouge. L'ordre du tableau reste alphabétique.
- Quand on saisit directement un total (séance, travail, oublis), le programme ajoute ou retire des entrées du journal pour que le total corresponde (entrées « Ajustement manuel »).
- Le pictogramme **📝** en bout de ligne ouvre la fiche de l'élève (identité, infos, notes, commentaires des 3 trimestres, journal daté). Sans pictogrammes (Préférences), il devient un bouton « Fiche ».
- **Annuler / Rétablir** (boutons à icône en haut à gauche) (ou `Ctrl+Z` / `Ctrl+Y` hors d'un champ de saisie) : jusqu'à 100 modifications du tableau, des fiches, des imports et des suppressions de classe. L'historique est conservé tant que le programme est ouvert ; les **archives** couvrent le reste.
- Les colonnes à compteur ont un pictogramme (👍 👎 📝 🎒) ; il se désactive dans Préférences → Affichage → Pictogrammes.

## Colonnes personnalisables

**Préférences → Colonnes** (les préférences sont rangées en onglets : Affichage, Colonnes, Alertes, Sauvegardes, Sécurité et bulletins) :

- **Barème des notes** : « Notes sur 20 » par défaut, modifiable (10, 5…). En changeant le barème, le programme propose de convertir les notes déjà saisies (14/20 → 7/10).
- **Colonnes intégrées** (séance +, séance −, travail non fait, oublis) : on peut changer leur titre, leur pictogramme et leurs **boutons d'incrément** (par exemple « −1 ; +2 »), ou les masquer.
- **Ajouter une colonne** : titre, pictogramme (une sélection classée par thème, ou n'importe quel emoji saisi ou collé) et un type :
  - *Compteur* : un total avec des boutons d'incrément de votre choix (« +0,5 ; +2 », « −2 −1 +1 +2 »…), éventuellement des alertes orange/rouge ;
  - *Note* : sur 10, sur 5, sur ce que vous voulez ;
  - *Texte* : une remarque libre par période ;
  - *Menu déroulant* : une valeur parmi des choix que vous saisissez (un par ligne) à la création ou avec « Modifier… » ;
  - *Case à cocher*.
- **Suggestions prêtes à l'emploi** (à cocher pour les activer) : Travail maison, Retards, Absences, Bavardages, Leçon non apprise, Devoir en retard, Participation orale, Comportement, Bonus, Punitions, Évaluation orale /10, Attitude en classe et Niveau de maîtrise (menus déroulants), Carnet signé, Matériel complet, Observation.
- Le **type d'une colonne personnalisée peut être changé** avec « Modifier… » : les valeurs déjà saisies sont conservées et reprises quand elles sont compatibles (note ↔ texte ↔ menu ↔ case ; un compteur garde son journal), ainsi que les réglages de l'ancien type (choix du menu, boutons…).
- **Colonnes de base** (n°, nom, prénom, infos, notes, commentaire bulletin, fiche) : elles sont cachées de la liste par défaut ; décochez **« Cacher les colonnes de base »** pour changer leur titre ou leur pictogramme, les masquer (sauf le nom) ou les déplacer. **Monter / Descendre** règle l'ordre de *toutes* les colonnes, y compris les colonnes intégrées.
- Les colonnes ajoutées se placent avant le commentaire. Les valeurs saisies dans chaque colonne sont conservées même si la colonne est masquée ou supprimée (recréer une suggestion retrouve ses valeurs).
- Les colonnes personnalisées apparaissent aussi dans la **fiche élève** (boutons du journal, valeurs), dans l'**export** et l'**historique annuler/rétablir** ; la configuration est enregistrée dans les données chiffrées, avec le reste.
- Le total d'un compteur est la somme de ses incréments au journal ; en cliquant sur le total, vous le saisissez directement (le programme ajoute une entrée « Ajustement manuel »).

## Plan de classe

Bouton **Plan de classe** (à côté de « Tableau », sur la ligne de la classe) : la salle vue d'en haut, une place (chaise + bureau) par rectangle. Chaque place montre le nom de l'élève et une **pastille par colonne à compteur** (👍 👎 📝 🎒 et vos colonnes ajoutées), avec la même valeur et les mêmes couleurs d'alerte que le tableau, pour la période (T1/T2/T3) choisie.

- **Pastilles** : un clic ajoute l'incrément principal (le premier incrément positif de la colonne) ; un **clic droit** propose tous les incréments (+0,5, +1, −1…) ou la saisie directe du total.
- **Élèves** : cliquez sur un nom pour ouvrir la fiche ; **glissez** un nom vers une autre place pour le déplacer (ou échanger deux élèves) ; glissez-le vers la liste « Sans place » pour le retirer ; glissez un élève de cette liste vers une place libre. Clic droit sur une place libre : « Placer un élève ici ».
- **Noms affichés** : *Prénom Nom*, *Prénom*, *Nom*, *Prénom + initiale du nom* ou *Initiales* (liste du plan, ou Préférences → Affichage). Un **zoom** (50 à 200 %) adapte la taille ; la recherche grise les places des autres élèves.
- **Salles** (bouton « Salles… ») : un plan générique de la salle, réutilisable pour toutes les classes. L'éditeur permet d'ajouter des places une à une ou en **rangées, binômes ou îlots**, de poser des **repères** (Tableau, Bureau du professeur, Porte, Fenêtre ou texte libre), de **glisser** les éléments (sélection par cadre ou Maj+clic, flèches pour ajuster, Suppr pour retirer), d'**aligner** ou répartir régulièrement, et de régler la taille des places.
- **Répartitions** : une classe peut avoir plusieurs répartitions nommées (« Plan T1 », « Plan T2 »…), chacune dans une salle ; boutons *Nouvelle*, *Dupliquer*, *Renommer*, *Supprimer*. **Répartir les élèves…** les place automatiquement (ordre alphabétique rangée par rangée, ou au hasard, en gardant ou non ceux déjà placés) ; **Vider la répartition** les retire tous.
- Salles et répartitions sont enregistrées avec le reste des **données chiffrées**, archivées et annulables (Annuler / Rétablir). Un nouveau coffre contient une salle d'exemple et une répartition pour la classe Test.

## Trimestres ou semestres

**Préférences → Affichage → Découpage de l'année** : *Trimestres (T1 à T3)* par défaut, ou *Semestres (S1 et S2)*. En semestres, les boutons, les titres du tableau, la fiche élève, l'import et l'export parlent de S1 et S2, et la colonne de la 3ᵉ note disparaît. Les données gardent leur numéro de période (période 1 = T1 ou S1, période 2 = T2 ou S2) : choisissez le découpage en début d'année. Les données de la 3ᵉ période ne sont pas supprimées, elles réapparaissent si vous revenez aux trimestres. Les titres d'import « S1 », « Semestre 2 », « 1er semestre »… sont reconnus comme « T1 », « Trimestre 2 », etc.

## Classe « Test »

À la création d'un nouveau coffre, le programme contient une classe **Test** (8 élèves fictifs avec notes, commentaires, infos, oublis et séances) pour essayer toutes les fonctions sans toucher à vos vraies données. Elle se supprime comme n'importe quelle classe (bouton **Supprimer la classe** ; une archive des données est créée juste avant, donc **🕘 Archives** permet de revenir en arrière). Pour la retrouver plus tard : **🗂 Données → Ajouter la classe Test**.

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

Bouton **Préférences** (ou `Ctrl+,`) : thème (**clair**, **sombre** ou automatique selon Windows), densité du tableau (**resserré** par défaut, pour un portable ; **normal** pour un grand écran), seuils d'alerte orange/rouge, archives automatiques, longueur des appréciations, verrouillage automatique. Les réglages sont enregistrés dans `preferences.json` (lisible, non chiffré) dans le dossier de données.

Pour ajouter un réglage : ajouter une entrée au tableau `SCHEMA` de `suiviclasse/prefs.py` (clé, libellé, bornes, valeur par défaut) ; il apparaît dans la fenêtre et est validé automatiquement. Il reste à l'utiliser via `app.values["<clé>"]`.

## Organisation du code

| Fichier | Rôle |
|---|---|
| `suiviclasse/vault.py` | coffre chiffré (scrypt + AES‑GCM), archives |
| `suiviclasse/prefs.py` | préférences (schéma → validation → fenêtre) |
| `suiviclasse/exchange.py` | import/export PRONOTE et tableurs (fonctions pures) |
| `suiviclasse/model.py` | structure des données et calculs (compteurs, totaux) |
| `suiviclasse/paths.py` | emplacement du dossier de données |
| `suiviclasse/ui/app.py` | fenêtre principale, enregistrement, archives, verrouillage |
| `suiviclasse/ui/theme.py` | apparence : palettes clair/sombre, style des widgets |
| `suiviclasse/ui/table.py` | tableau d'une classe |
| `suiviclasse/plan.py` | plan de classe : salles, répartitions, remplissage automatique (fonctions pures) |
| `suiviclasse/ui/plan_view.py`, `salle_editor.py` | vue « Plan de classe », éditeur de salles |
| `suiviclasse/ui/dialogs.py` | fiche élève, import, export, archives, préférences |

Les fichiers de données sont compatibles avec la première version de SuiviClasse (Electron) : un `suivi.enc` existant s'ouvre tel quel.

## Tests

```bash
python -m unittest discover -s tests -t .
```
