// Point d'entrée du site : surcouche de choix du jeu de rôle.
// - URL avec un #salle (tous les liens existants) : Starboard démarre directement, comme avant.
// - URL sans #salle : page d'accueil pour choisir le jeu, créer une partie ou en rejoindre une.
// Starboard lui-même n'est pas modifié : on charge src/main.js tel quel une fois le choix fait.
import './launcher.css'
import { GAMES, SITE_NAME } from './games.js'

const root = document.documentElement
const roomOf = (text) => text.trim().replace(/^[^#]*#/, '').trim()

let started = false
function startStarboard(room) {
  if (started) return
  started = true
  removeEventListener('hashchange', onHashChange)
  if (room) location.hash = room // sinon main.js tire une nouvelle salle, comme avant
  document.getElementById('launcher')?.remove()
  root.classList.remove('launcher')
  document.title = 'Starboard'
  import('./main.js').then(() => {
    // Starboard lit sa salle une seule fois au chargement. Si l'adresse change ensuite de salle (bouton Retour
    // vers l'accueil, autre lien #salle collé dans la barre d'adresse), on recharge pour afficher la bonne vue.
    const current = location.hash.slice(1)
    addEventListener('hashchange', () => {
      if (location.hash.slice(1) !== current) location.reload()
    })
  })
}

// Un lien de salle collé dans la barre d'adresse pendant que l'accueil est affiché
function onHashChange() {
  if (location.hash.slice(1)) startStarboard()
}

if (location.hash.slice(1)) startStarboard()
else showLauncher()

function el(tag, props = {}, ...children) {
  const node = Object.assign(document.createElement(tag), props)
  node.append(...children.filter((c) => c != null))
  return node
}

function showLauncher() {
  root.classList.add('launcher')
  document.title = SITE_NAME
  addEventListener('hashchange', onHashChange)

  const grid = el('div', { className: 'launcher-grid' }, ...GAMES.map(gameCard), el('article', { className: 'launcher-card launcher-soon' },
    el('p', { className: 'launcher-muted', textContent: "D'autres jeux de rôle viendront s'ajouter ici." })))

  document.body.prepend(el('div', { id: 'launcher' },
    el('header', { className: 'launcher-head' },
      el('div', { className: 'brand', textContent: SITE_NAME.toUpperCase() }),
      el('p', { className: 'launcher-muted', textContent: 'Choisis le jeu de rôle de la partie.' })),
    grid))
}

function gameCard(game) {
  const open = (room) => {
    if (game.root) return startStarboard(room)
    location.href = room ? `${game.href}#${room}` : game.href
  }

  const code = el('input', { placeholder: 'Code ou lien de salle', title: "Le code après # dans l'URL de la partie" })
  const join = el('form', { className: 'launcher-join' }, code, el('button', { type: 'submit', textContent: 'Rejoindre' }))
  join.addEventListener('submit', (e) => {
    e.preventDefault()
    const room = roomOf(code.value)
    if (room) open(room)
    else code.focus()
  })

  const create = el('button', { className: 'primary', type: 'button', textContent: 'Nouvelle partie' })
  create.addEventListener('click', () => open())

  const recent = el('div', { className: 'launcher-recent', hidden: true })
  // Même nom que le réglage `game` de connect() (src/net.js) : sauvegardes « <id>:<salle> »
  listSavedRooms(`${game.id}:`).then((rooms) => {
    if (!rooms.length) return
    recent.hidden = false
    recent.append(el('span', { className: 'launcher-muted', textContent: 'Parties sur ce navigateur :' }),
      ...rooms.map((room) => {
        const b = el('button', { className: 'small', type: 'button', textContent: room })
        b.addEventListener('click', () => open(room))
        return b
      }))
  })

  return el('article', { className: 'launcher-card' },
    el('h2', { textContent: game.name }),
    el('div', { className: 'launcher-genre', textContent: game.genre }),
    el('p', { textContent: game.description }),
    el('div', { className: 'launcher-actions' }, create, join),
    recent)
}

// Salles déjà sauvegardées localement (bases IndexedDB « <préfixe><salle> » créées par y-indexeddb)
async function listSavedRooms(prefix) {
  try {
    const dbs = await indexedDB.databases()
    return dbs.map((d) => d.name || '').filter((n) => n.startsWith(prefix)).map((n) => n.slice(prefix.length)).filter(Boolean).sort().slice(0, 12)
  } catch {
    return [] // navigateur sans indexedDB.databases() : on n'affiche simplement rien
  }
}
