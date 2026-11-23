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

// Polices des vignettes (auto-hébergées, téléchargées seulement quand une vignette les affiche)
import '@fontsource/cinzel/700.css'

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
  {
    id: 'grandal',
    name: 'Grandal',
    genre: 'Médiéval fantastique',
    description: 'Les aventuriers de Grandal : cartes et décors du MJ, fiches, dés, chronique et musique partagés.',
    href: './games/grandal/',
    // Même esthétique que le jeu (games/grandal/grandal.css) : or sur bois sombre, capitales gravées
    theme: {
      background: 'radial-gradient(ellipse at 50% 30%, rgba(217, 164, 65, 0.28), transparent 60%), repeating-linear-gradient(90deg, rgba(0, 0, 0, 0.18) 0 2px, transparent 2px 64px), linear-gradient(180deg, #3a2a19, #15100b)',
      color: '#e2b456',
      font: "'Cinzel', 'Trajan Pro', Georgia, serif",
      spacing: '0.22em',
      textCase: 'uppercase',
      shadow: '0 2px 0 #000, 0 0 14px rgba(217, 164, 65, 0.45)',
    },
  },
]
