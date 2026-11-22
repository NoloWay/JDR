import { defineConfig } from 'vite'
import { existsSync, readdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const here = (path) => fileURLToPath(new URL(path, import.meta.url))

// Surcouche multi-jeux : la page racine (index.html = accueil + Starboard) et une page par jeu ajouté
// dans games/<id>/index.html, découverte automatiquement.
const games = existsSync(here('./games'))
  ? readdirSync(here('./games')).filter((id) => existsSync(here(`./games/${id}/index.html`)))
  : []

// base: './' => le site fonctionne depuis n'importe quel sous-dossier (GitHub Pages inclus)
export default defineConfig({
  base: './',
  // Ouvre le site dans le navigateur par défaut (Brave) au lancement de `npm run dev`
  server: { open: true },
  build: {
    rollupOptions: {
      input: {
        main: here('./index.html'),
        ...Object.fromEntries(games.map((id) => [id, here(`./games/${id}/index.html`)])),
      },
    },
  },
})
