import { connect } from './net.js'
import { roll, rollFree, OUTCOME_LABEL, MODE_LABEL } from './dice.js'
import { setupSheets, replaceCharacters } from './sheets.js'
import { setupShip, writeShip } from './shipPanel.js'
import { setupPersonnel } from './personnel.js'
import { setupBoard } from './board.js'
import { setupMusic } from './music.js'
import { PLAYERS, OBSERVER, presetOf, BADGES } from './rules.js'

// ---------- Salle & identité ----------
if (!location.hash.slice(1)) {
  location.hash = Math.random().toString(36).slice(2, 8)
}
const roomId = location.hash.slice(1)

const $ = (id) => document.getElementById(id)
const store = {
  get: (k) => { try { return localStorage.getItem(k) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* stockage indisponible */ } },
}

// Un ancien nom libre (hors liste) redevient « Observateur »
let playerName = presetOf(store.get('starboard:name'))?.name || OBSERVER
// Le rôle est propre à chaque salle (on peut être MJ d'une partie et joueur d'une autre) ;
// sans choix enregistré, il vient du préréglage du joueur (Walter = MJ)
const roleKey = `starboard:role:${roomId}`
let role = store.get(roleKey) || (presetOf(playerName)?.gm ? 'gm' : 'player')
const me = () => ({ name: playerName, isGM: role === 'gm' })

$('room-label').textContent = `Salle : ${roomId}`
function renderNames() {
  const opts = PLAYERS.map((p) => [p.name, p.gm ? `${p.name} · MJ` : p.character ? `${p.name} · ${p.character.split(' ')[0]}` : p.name])
  $('name-select').replaceChildren(...opts.map(([v, t]) => new Option(t, v, false, v === playerName)))
}
renderNames()
$('role-select').value = role

// ---------- État partagé ----------
const { doc } = connect(roomId, {
  // n = autres navigateurs connectés ; on compte aussi soi-même
  onPeers: (n) => ($('peer-count').textContent = n < 0 ? 'Hors ligne' : `Joueurs connectés : ${n + 1}`),
})
const tokens = doc.getMap('tokens') // id -> { x, y, color, label, scene } (géré par board.js)
const log = doc.getArray('log') //     [{ who, text, t, secret?, roll? }]

// ---------- Plateau (scènes, caméra, pions) ----------
const board = setupBoard({ doc, me })

// Onglets Vaisseau / Carte (choix local, mémorisé)
function setView(v) {
  board.setMode(v)
  store.set('starboard:view', v)
  $('view-tabs').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.view === v))
}
$('view-tabs').addEventListener('click', (e) => { if (e.target.dataset.view) setView(e.target.dataset.view) })
setView(store.get('starboard:view') === 'map' ? 'map' : 'ship')

// Recherche d'un personnage : Entrée centre la vue (bon onglet, bon étage) sur son jeton
const searchMsg = (text) => {
  $('token-search-msg').textContent = text
  clearTimeout(searchMsg.timer)
  searchMsg.timer = setTimeout(() => ($('token-search-msg').textContent = ''), 4000)
}
$('token-search').addEventListener('input', (e) => {
  $('token-names').replaceChildren(...board.matchCharacters(e.target.value).slice(0, 8).map(([, c]) => new Option(c.get('name'))))
})
$('token-search').addEventListener('keydown', (e) => {
  if (e.key !== 'Enter') return
  const res = board.findToken(e.target.value)
  if (res.error) return searchMsg(res.error)
  if (store.get('starboard:view') !== res.view) setView(res.view)
  board.focusToken(res.tokenId)
  searchMsg('')
})

const music = setupMusic({ doc, me })

$('btn-add').addEventListener('click', () => {
  const label = prompt('Nom du pion (2-3 lettres) ?', playerName.slice(0, 2).toUpperCase())
  if (label) board.addToken(label)
})

// ---------- Jets ----------
let rollMode = 'normal'
$('roll-mode').addEventListener('click', (e) => {
  const mode = e.target.dataset?.mode
  if (!mode) return
  rollMode = mode
  $('roll-mode').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.mode === mode))
})

const isSecret = () => $('secret-roll').checked

function pushLog(entry) {
  log.push([{ who: playerName, t: Date.now(), secret: isSecret(), ...entry }])
}

// Jet libre (sans cible)
function rollPlain(sides) {
  pushLog({ text: `d${sides} → ${rollFree(sides)}` })
}
$('btn-d6').addEventListener('click', () => rollPlain(6))
$('btn-d20').addEventListener('click', () => rollPlain(20))
$('btn-d100').addEventListener('click', () => rollPlain(100))

// Jet contre une valeur (caractéristique ou stat du vaisseau en d20, compétence en d100)
function rollCheck(label, target, sides) {
  const r = roll(sides, target, rollMode)
  pushLog({
    text: label,
    roll: { sides, target, mode: r.mode, values: r.values, kept: r.kept, outcome: r.outcome },
  })
}

// ---------- Journal ----------
const canSeeEntry = (entry) => !entry.secret || role === 'gm' || entry.who === playerName

// Couleur d'un auteur : badge de son personnage, cyan pour le MJ (couleur absente des badges), gris sinon
const GM_COLOR = '#38e8ff'
const READABLE = { Noir: '#e6e9ef' } // badge trop sombre pour du texte sur fond nuit
function colorOf(who) {
  const p = presetOf(who)
  if (p?.gm) return GM_COLOR
  const c = p?.character && [...doc.getMap('characters').values()].find((c) => c.get('name') === p.character)
  const badge = c?.get('badge')
  return READABLE[badge] ?? BADGES.find((b) => b.name === badge)?.color ?? '#6c85b3'
}
const el = (tag, cls, text) => Object.assign(document.createElement(tag), { className: cls, textContent: text ?? '' })
const hhmm = (t) => new Date(t).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })

function renderLog() {
  const ul = $('log-list')
  ul.innerHTML = ''
  log.toArray().filter(canSeeEntry).slice(-100).reverse().forEach((entry) => {
    const li = el('li', 'entry')
    li.style.setProperty('--who', colorOf(entry.who))
    if (entry.secret) { li.classList.add('secret'); li.title = 'Jet secret : visible par son auteur et le MJ' }
    const r = entry.roll
    // « Personnage · Compétence » : le sujet passe dans l'en-tête, l'action devient le titre
    const [subject, action] = r && entry.text.includes(' · ') ? entry.text.split(' · ', 2) : [null, entry.text]

    const head = el('div', 'entry-head')
    head.append(el('b', 'who', presetOf(entry.who)?.gm ? `${entry.who} (MJ)` : entry.who))
    if (subject && subject !== presetOf(entry.who)?.character) head.append(el('span', 'subject', subject))
    if (entry.secret) head.append(el('span', 'tag', 'secret'))
    head.append(el('time', '', entry.t ? hhmm(entry.t) : ''))
    li.append(head)

    const body = el('div', 'entry-body')
    if (r) {
      li.classList.add(`outcome-${r.outcome}`)
      body.append(el('span', 'action', action), el('span', 'roll-result', OUTCOME_LABEL[r.outcome]))
      const mode = MODE_LABEL[r.mode] ? ` · ${MODE_LABEL[r.mode]}` : ''
      const dice = r.values.length > 1 ? `${r.values.join(' et ')} → ${r.kept}` : `${r.values[0]}`
      li.append(body, el('div', 'roll-detail', `🎲 ${dice} pour ${r.target} ou moins (d${r.sides}${mode})`))
    } else {
      // Jet libre « d20 → 14 »
      const free = /^d(\d+) → (\d+)$/.exec(entry.text)
      if (free) body.append(el('span', 'action', `Dé libre d${free[1]}`), el('span', 'roll-value', free[2]))
      else body.append(el('span', 'action', entry.text))
      li.append(body)
    }
    ul.append(li)
  })
}
log.observe(renderLog)
doc.getMap('characters').observeDeep(renderLog) // couleur des badges

// ---------- Fiches & vaisseau (un seul panneau ouvert à la fois) ----------
const sheets = setupSheets({ doc, me, onRoll: rollCheck, onOpen: () => { ship.close(); personnel.close() } })
const ship = setupShip({ doc, me, onRoll: rollCheck, onOpen: () => { sheets.close(); personnel.close() } })
const personnel = setupPersonnel({ doc, me, openSheet: (id) => sheets.open(id), onOpen: () => { sheets.close(); ship.close() } })

// ---------- Identité : nom & rôle ----------
$('name-select').addEventListener('change', (e) => {
  playerName = e.target.value
  store.set('starboard:name', playerName)
  setRole(presetOf(playerName).gm ? 'gm' : 'player')
})

$('role-select').addEventListener('change', (e) => setRole(e.target.value))
function setRole(r) {
  role = r
  $('role-select').value = r
  store.set(roleKey, role)
  document.body.classList.toggle('is-gm', role === 'gm')
  renderLog()
  sheets.rerender()
  ship.rerender()
  personnel.rerender()
  board.rerender()
  music.rerender()
}
document.body.classList.toggle('is-gm', role === 'gm')

// ---------- Export / import JSON ----------
$('btn-export').addEventListener('click', () => {
  const data = {
    version: 3,
    ...board.exportData(), // scenes, images (base64), board
    tokens: tokens.toJSON(),
    log: log.toJSON(),
    characters: doc.getMap('characters').toJSON(),
    musicTracks: doc.getMap('musicTracks').toJSON(),
    musicPlaylists: doc.getMap('musicPlaylists').toJSON(),
    doorLevels: doc.getMap('doorLevels').toJSON(),
    plan: doc.getMap('plan').toJSON(),
    mapPlan: doc.getMap('mapPlan').toJSON(),
    templates: doc.getMap('templates').toJSON(),
    drawings: doc.getMap('drawings').toJSON(),
    fog: doc.getMap('fog').toJSON(),
    mapLibrary: doc.getMap('mapLibrary').toJSON(),
    ship: doc.getMap('ship').toJSON(),
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `starboard-${roomId}.json`
  a.click()
  URL.revokeObjectURL(a.href)
})

// Seules les parties présentes dans le fichier sont remplacées
// (un fichier qui ne contient que des fiches ne touche pas aux pions ni au journal).
$('file-import').addEventListener('change', async (e) => {
  const file = e.target.files[0]
  e.target.value = ''
  if (!file) return
  if (role !== 'gm') return // l'import écrase la partie de tout le monde : réservé au MJ
  let data
  try {
    data = JSON.parse(await file.text())
  } catch {
    alert('Fichier JSON illisible.')
    return
  }
  const parts = ['scenes', 'tokens', 'log', 'characters', 'ship', 'musicTracks', 'musicPlaylists', 'doorLevels', 'plan', 'mapPlan', 'templates', 'drawings', 'fog', 'mapLibrary'].filter((k) => data[k] && Object.keys(data[k]).length)
  const names = { scenes: 'cartes (fonds et réglages)', tokens: 'pions', log: 'journal', characters: 'fiches', ship: 'vaisseau', musicTracks: 'pistes de musique', musicPlaylists: 'playlists', doorLevels: 'accréditations des portes (ancien format)', plan: 'plan du vaisseau', mapPlan: 'dessins des cartes', templates: 'gabarits', drawings: 'traits de crayon', fog: 'brouillard de guerre', mapLibrary: 'modèles de carte' }
  if (!parts.length) return alert('Aucune donnée Starboard dans ce fichier.')
  if (!confirm(`Remplacer pour tout le monde : ${parts.map((k) => names[k]).join(', ')} ?`)) return
  if (parts.includes('scenes')) board.importData(data)
  doc.transact(() => {
    if (parts.includes('tokens')) {
      tokens.clear()
      Object.entries(data.tokens).forEach(([id, t]) => tokens.set(id, t))
    }
    if (parts.includes('log')) {
      log.delete(0, log.length)
      log.push(data.log)
    }
  })
  if (parts.includes('characters')) replaceCharacters(doc, data.characters)
  if (parts.includes('ship')) writeShip(doc, data.ship)
  // Collections simples (id → valeur) : remplacées telles quelles
  for (const k of ['musicTracks', 'musicPlaylists', 'doorLevels', 'plan', 'mapPlan', 'templates', 'drawings', 'fog', 'mapLibrary'].filter((p) => parts.includes(p))) {
    const map = doc.getMap(k)
    doc.transact(() => { map.clear(); Object.entries(data[k]).forEach(([id, v]) => map.set(id, v)) })
  }
})

// ---------- Démarrage ----------
renderLog()
