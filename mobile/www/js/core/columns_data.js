// Fichier généré par mobile/tools/gen_columns_data.py d'après suiviclasse/columns.py : ne pas modifier à la main.
export const EMOJIS = [
 [
  "Travail",
  [
   "📝",
   "📚",
   "📖",
   "📓",
   "📒",
   "✏",
   "🖊",
   "📏",
   "🧮",
   "💻",
   "🔬",
   "🎨",
   "🎵",
   "⚽",
   "🗺",
   "🌍"
  ]
 ],
 [
  "Évaluation",
  [
   "⭐",
   "🌟",
   "🏅",
   "🏆",
   "🎯",
   "✅",
   "❌",
   "💯",
   "❗",
   "❓",
   "📊",
   "📈"
  ]
 ],
 [
  "Comportement",
  [
   "🙂",
   "😐",
   "🙁",
   "😠",
   "😴",
   "🤝",
   "🗣",
   "🤫",
   "👂",
   "👁",
   "💬",
   "👍",
   "👎",
   "👏",
   "🔥"
  ]
 ],
 [
  "Vie scolaire",
  [
   "⏰",
   "🕒",
   "📅",
   "🔔",
   "📌",
   "📎",
   "✍",
   "📕",
   "📗",
   "📘",
   "🏠",
   "🎒",
   "🍎",
   "💧",
   "📱",
   "🔇",
   "🧹",
   "🚫",
   "⚠",
   "🩺",
   "❤",
   "💡",
   "🧠",
   "🚀"
  ]
 ]
];

export const PRESETS = [
 {
  "id": "p_travail_maison",
  "titre": "Travail maison",
  "emoji": "🏠",
  "type": "compteur",
  "increments": [
   -1,
   0.5,
   2
  ],
  "description": "Points de travail à la maison (+0,5 ou +2)"
 },
 {
  "id": "p_retards",
  "titre": "Retards",
  "emoji": "⏰",
  "type": "compteur",
  "increments": [
   -1,
   1
  ],
  "orange": 2,
  "rouge": 3,
  "description": "Nombre de retards en début de cours"
 },
 {
  "id": "p_absences",
  "titre": "Absences",
  "emoji": "🚫",
  "type": "compteur",
  "increments": [
   -1,
   1
  ],
  "description": "Absences au cours"
 },
 {
  "id": "p_bavardages",
  "titre": "Bavardages",
  "emoji": "💬",
  "type": "compteur",
  "increments": [
   -1,
   1
  ],
  "orange": 3,
  "rouge": 5,
  "description": "Remarques pour bavardage"
 },
 {
  "id": "p_lecon",
  "titre": "Leçon non apprise",
  "emoji": "📖",
  "type": "compteur",
  "increments": [
   -1,
   1
  ],
  "orange": 2,
  "rouge": 3,
  "description": "Leçons non sues"
 },
 {
  "id": "p_devoir_retard",
  "titre": "Devoir en retard",
  "emoji": "📅",
  "type": "compteur",
  "increments": [
   -1,
   1
  ],
  "orange": 2,
  "rouge": 3,
  "description": "Travail rendu après la date"
 },
 {
  "id": "p_participation",
  "titre": "Participation orale",
  "emoji": "🗣",
  "type": "compteur",
  "increments": [
   -1,
   0.5,
   1
  ],
  "description": "Points de participation à l'oral"
 },
 {
  "id": "p_comportement",
  "titre": "Comportement",
  "emoji": "🙂",
  "type": "compteur",
  "increments": [
   -2,
   -1,
   1,
   2
  ],
  "description": "Bonus et malus de comportement"
 },
 {
  "id": "p_bonus",
  "titre": "Bonus",
  "emoji": "⭐",
  "type": "compteur",
  "increments": [
   -1,
   1
  ],
  "description": "Points bonus"
 },
 {
  "id": "p_punition",
  "titre": "Punitions",
  "emoji": "📕",
  "type": "compteur",
  "increments": [
   -1,
   1
  ],
  "orange": 1,
  "rouge": 3,
  "description": "Punitions et retenues"
 },
 {
  "id": "p_attitude",
  "titre": "Attitude en classe",
  "emoji": "🙂",
  "type": "liste",
  "choix": [
   "Excellente",
   "Bonne",
   "Passable",
   "À améliorer"
  ],
  "description": "Menu : appréciation de l'attitude"
 },
 {
  "id": "p_maitrise",
  "titre": "Niveau de maîtrise",
  "emoji": "🎯",
  "type": "liste",
  "choix": [
   "Non acquis",
   "En cours d'acquisition",
   "Acquis",
   "Dépassé"
  ],
  "description": "Menu : compétence non acquise à dépassée"
 },
 {
  "id": "p_oral",
  "titre": "Évaluation orale",
  "emoji": "🎤",
  "type": "note",
  "echelle": 10,
  "description": "Note d'oral sur 10"
 },
 {
  "id": "p_carnet",
  "titre": "Carnet signé",
  "emoji": "✍",
  "type": "coche",
  "description": "Carnet de liaison signé"
 },
 {
  "id": "p_materiel_ok",
  "titre": "Matériel complet",
  "emoji": "🎒",
  "type": "coche",
  "description": "Matériel complet pour la période"
 },
 {
  "id": "p_observation",
  "titre": "Observation",
  "emoji": "👁",
  "type": "texte",
  "description": "Remarque libre par période"
 }
];
