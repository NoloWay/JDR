// Registre des jeux de rôle proposés par la page d'accueil (surcouche multi-jeux, voir src/launcher.js).
//
// Starboard est le jeu « racine » : il vit à la racine du site (index.html + src/main.js) et toute URL
// avec un #salle l'ouvre directement, comme avant la surcouche. Ses liens de salle ne changent donc jamais.
//
// Ajouter un jeu :
//   1. créer games/<id>/index.html (+ son propre code) : une page indépendante, buildée automatiquement
//      (vite.config.js découvre les dossiers games/*/index.html) ;
//   2. l'ajouter ci-dessous avec `href: './games/<id>/'` ;
//   3. isoler ses données de celles de Starboard : ouvrir la salle avec connect(roomId, { game: '<id>' })
//      (src/net.js : sauvegarde « <id>:<salle> », appId Trystero « Noloway-<id> ») et préfixer ses clés
//      localStorage par « <id>: ». Sinon un même #code mélangerait les parties des deux jeux.
//      L'`id` sert aussi à l'accueil pour lister les parties enregistrées de chaque jeu.

export const SITE_NAME = 'Plateaux JDR'

export const GAMES = [
  {
    id: 'starboard',
    name: 'Starboard',
    genre: 'Science-fiction spatiale',
    description: "L'équipage du vaisseau scientifique Gaïa : plan du vaisseau, cartes, fiches, dés et musique partagés.",
    root: true, // jeu servi par la page racine (#salle)
    // Identité visuelle du jeu, sur sa vignette seulement (l'accueil reste neutre). Tout est facultatif.
    theme: {
      background: 'radial-gradient(circle at 75% 25%, rgba(255, 61, 216, 0.28), transparent 45%), radial-gradient(circle at 20% 80%, rgba(56, 232, 255, 0.22), transparent 50%), #05070f',
      color: '#38e8ff',
      font: "'Segoe UI', system-ui, sans-serif",
      spacing: '0.35em',
      textCase: 'uppercase',
      shadow: '0 0 12px rgba(56, 232, 255, 0.8)',
    },
  },
  // { id: 'exemple', name: 'Exemple', genre: '…', description: '…', href: './games/exemple/',
  //   theme: { background: '#3b2f2f', color: '#f3e3c3', font: 'Georgia, serif' } },
]
