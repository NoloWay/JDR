// Registre des jeux de rôle proposés par la page d'accueil (surcouche multi-jeux, voir src/launcher.js).
//
// Starboard est le jeu « racine » : il vit à la racine du site (index.html + src/main.js) et toute URL
// avec un #salle l'ouvre directement, comme avant la surcouche. Ses liens de salle ne changent donc jamais.
//
// Ajouter un jeu :
//   1. créer games/<id>/index.html (+ son propre code) : une page indépendante, buildée automatiquement
//      (vite.config.js découvre les dossiers games/*/index.html) ;
//   2. l'ajouter ci-dessous avec `href: './games/<id>/'` ;
//   3. isoler ses données de celles de Starboard : autre préfixe IndexedDB et autre appId Trystero
//      (src/net.js utilise 'starboard:' et 'Noloway' en dur), sinon un même #code mélangerait les parties.

export const SITE_NAME = 'Plateaux JDR'

export const GAMES = [
  {
    id: 'starboard',
    name: 'Starboard',
    genre: 'Science-fiction spatiale',
    description: "L'équipage du vaisseau scientifique Gaïa : plan du vaisseau, cartes, fiches, dés et musique partagés.",
    root: true, // jeu servi par la page racine (#salle)
  },
  // { id: 'exemple', name: 'Exemple', genre: '…', description: '…', href: './games/exemple/' },
]
