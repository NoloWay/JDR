// Grandal : plateau médiéval fantastique (premier jet).
// Reprend les modules de Starboard (src/) sans les modifier : plateau en mode « Carte » seul (cartes et
// décors du MJ, interchangeables à volonté), fiches, dés, journal, musique. Pas de vaisseau, de dossier du
// personnel ni de dossiers du MJ : une seule catégorie « Aventuriers ».
// Données isolées de Starboard : connect(…, { game: 'grandal' }) et clés localStorage « grandal: ».
import '@fontsource/cinzel/600.css'
import '@fontsource/cinzel/700.css'
import '@fontsource/eb-garamond/400.css'
import '@fontsource/eb-garamond/500.css'
import '@fontsource/eb-garamond/600.css'
import '../../src/style.css'
import './grandal.css'
import { connect } from '../../src/net.js'
import { roll, rollFree, OUTCOME_LABEL, MODE_LABEL } from '../../src/dice.js'
import { setupSheets, replaceCharacters } from '../../src/sheets.js'
import { setupBoard } from '../../src/board.js'
import { setupMusic } from '../../src/music.js'
import { BADGES } from '../../src/rules.js'
import { OBSERVER, ROLE_LABEL, getRoster, profileOf, roleOf, ownerOfSheet, setupProfiles, setupPresence } from './presence.js'
import { setupParty } from './party.js'

const GAME = 'grandal'

// ---------- Salle & identité ----------
if (!location.hash.slice(1)) {
  location.hash = Math.random().toString(36).slice(2, 8)
}
const roomId = location.hash.slice(1)
// La salle n'est lue qu'au chargement : un autre #salle (bouton Retour, lien collé) recharge la page
addEventListener('hashchange', () => { if (location.hash.slice(1) !== roomId) location.reload() })

const $ = (id) => document.getElementById(id)
const store = {
  get: (k) => { try { return localStorage.getItem(`${GAME}:${k}`) } catch { return null } },
  set: (k, v) => { try { localStorage.setItem(`${GAME}:${k}`, v) } catch { /* stockage indisponible */ } },
}
// Profil : celui de Grandal, sinon celui déjà choisi dans Starboard s'il existe dans Grandal.
// Le rôle n'est pas modifiable : il découle du profil (presence.js : Withex = MJ, Observateur, les autres joueurs).
// À l'arrivée : si le dernier profil a servi récemment (PROFILE_MEMORY), on le reprend directement (une simple
// actualisation ne redemande rien) ; sinon, fenêtre de choix obligatoire (plus bas), où il est mis en avant.
// « Récemment » = depuis la dernière activité : la date est rafraîchie tant que la page reste ouverte.
const PROFILE_MEMORY = 12 * 60 * 60 * 1000 // 12 h
const savedName = store.get('name') ?? (() => { try { return localStorage.getItem('starboard:name') } catch { return null } })()
const lastSeen = Number(store.get('nameAt')) || 0
// Le dernier profil n'est évalué qu'une fois la liste des profils chargée (sauvegarde locale), voir start()
let lastProfile = null
let playerName = OBSERVER
const touchProfile = () => store.set('nameAt', String(Date.now()))
// Activité : rafraîchie toutes les 5 min, sauf pendant que la fenêtre de choix est ouverte (aucun profil en cours)
setInterval(() => { if (!$('profile-picker') || $('profile-picker').hidden) touchProfile() }, 5 * 60 * 1000)
const role = () => roleOf(playerName)
const me = () => ({ name: playerName, isGM: role() === 'gm', isObserver: role() === 'observer' })

$('room-label').textContent = `Salle : ${roomId}`

// ---------- État partagé ----------
const { doc, room, persistence } = connect(roomId, {
  game: GAME,
  onPeers: (n) => ($('peer-count').textContent = n < 0 ? 'Hors ligne' : `Joueurs connectés : ${n + 1}`),
})
const tokens = doc.getMap('tokens')
const log = doc.getArray('log')

// Profils joueurs (ajoutés / supprimés par le MJ, partagés dans le Y.Doc). onProfilesChange est défini plus bas.
let ready = false
const profiles = setupProfiles(doc, () => { if (ready) onProfilesChange() })

// ---------- Plateau : uniquement les cartes / décors (mode « Carte » du plateau de Starboard) ----------
// allPC : toutes les fiches sont des PJ (jetons en étoile) ; ownerOf : le propriétaire est le profil « Joueur » de la fiche
const board = setupBoard({ doc, me, allPC: true, ownerOf: ownerOfSheet })
board.setMode('map')

const searchMsg = (text) => {
  $('token-search-msg').textContent = text
  clearTimeout(searchMsg.timer)
  searchMsg.timer = setTimeout(() => ($('token-search-msg').textContent = ''), 4000)
}
function searchToken(text) {
  const res = board.findToken(text)
  if (res.error) return searchMsg(res.error)
  board.focusToken(res.tokenId)
  searchMsg('')
}
$('token-search').addEventListener('input', (e) => {
  if (!e.inputType || e.inputType === 'insertReplacementText') return searchToken(e.target.value)
  $('token-names').replaceChildren(...board.matchCharacters(e.target.value).slice(0, 8).map(([, c]) => new Option(c.get('name'))))
})
$('token-search').addEventListener('keydown', (e) => { if (e.key === 'Enter') searchToken(e.target.value) })

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
function rollPlain(sides) {
  pushLog({ text: `d${sides} → ${rollFree(sides)}` })
}
$('btn-d6').addEventListener('click', () => rollPlain(6))
$('btn-d20').addEventListener('click', () => rollPlain(20))
$('btn-d100').addEventListener('click', () => rollPlain(100))
function rollCheck(label, target, sides) {
  const r = roll(sides, target, rollMode)
  pushLog({ text: label, roll: { sides, target, mode: r.mode, values: r.values, kept: r.kept, outcome: r.outcome } })
}

// ---------- Chronique (journal) ----------
const canSeeEntry = (entry) => !entry.secret || role() === 'gm' || entry.who === playerName

// Couleur d'un auteur : or pour le MJ, badge de son aventurier sinon, parchemin éteint par défaut
const GM_COLOR = '#d9a441'
const READABLE = { Noir: '#e8dcc0' }
function characterOf(who) {
  return [...doc.getMap('characters').values()].find((c) => ownerOfSheet(c.get('name'), c.get('player')) === who)
}
function colorOf(who) {
  if (roleOf(who) === 'gm') return GM_COLOR
  const badge = characterOf(who)?.get('badge')
  return READABLE[badge] ?? BADGES.find((b) => b.name === badge)?.color ?? '#a8936f'
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
    const [subject, action] = r && entry.text.includes(' · ') ? entry.text.split(' · ', 2) : [null, entry.text]

    const head = el('div', 'entry-head')
    head.append(el('b', 'who', roleOf(entry.who) === 'gm' ? `${entry.who} (MJ)` : entry.who))
    if (subject && subject !== characterOf(entry.who)?.get('name')) head.append(el('span', 'subject', subject))
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
      const free = /^d(\d+) → (\d+)$/.exec(entry.text)
      if (free) body.append(el('span', 'action', `Dé libre d${free[1]}`), el('span', 'roll-value', free[2]))
      else body.append(el('span', 'action', entry.text))
      li.append(body)
    }
    ul.append(li)
  })
}
log.observe(renderLog)
doc.getMap('characters').observeDeep(renderLog)

// ---------- Fiches des aventuriers ----------
// Pas de PJ / PNJ (allPC) ; « Joueur » = un profil joueur existant, choisi par le MJ (playerChoices) ;
// modification : MJ et propriétaire ; suppression (déjà réservée au MJ par sheets.js) et création : MJ seul
const sheets = setupSheets({ doc, me, onRoll: rollCheck, onOpen: () => {}, allPC: true, ownerOf: ownerOfSheet, playerChoices: () => profiles.players() })
// « + Fiche » : bouton masqué aux non-MJ (classe gm-only) ; on bloque aussi le clic, avant le gestionnaire de sheets.js
$('btn-new-sheet').addEventListener('click', (e) => { if (!me().isGM) e.stopImmediatePropagation() }, { capture: true })

// ---------- Onglets Carte / Fiches (choix local, mémorisé) et vignettes des aventuriers ----------
let party = null
function setView(v) {
  const view = v === 'roster' ? 'roster' : 'map'
  if (view !== 'roster') party?.leaveRoster()
  $('roster').hidden = view !== 'roster'
  store.set('view', view)
  $('view-tabs').querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.view === view))
}
$('view-tabs').addEventListener('click', (e) => { if (e.target.dataset.view) setView(e.target.dataset.view) })
party = setupParty({ doc, me, sheets, setView, ownerOf: ownerOfSheet, profiles })
setView(store.get('view'))

// ---------- Identité : profil (rôle fixe) et présence ----------
// Message bref en haut de l'écran (profil refusé, profil perdu)
function notify(text) {
  let box = $('toast')
  if (!box) document.body.append(box = Object.assign(document.createElement('div'), { id: 'toast', className: 'toast' }))
  box.textContent = text
  box.hidden = false
  clearTimeout(notify.timer)
  notify.timer = setTimeout(() => (box.hidden = true), 7000)
}

const presence = setupPresence({
  room,
  getName: () => playerName,
  onChange: () => { renderNames(); renderPicker() },
  // Un autre navigateur avait pris ce profil avant nous : on repasse Observateur et on redemande un profil
  onLost: (name) => {
    setName(OBSERVER, { remember: false })
    openPicker(`« ${name} » est déjà connecté sur un autre navigateur. Choisis un autre profil.`)
  },
})

// ---------- Choix du profil obligatoire à l'arrivée ----------
// Fenêtre bloquante (le reste de la page est inerte) : impossible de jouer avant d'avoir choisi.
// Les profils déjà connectés ailleurs sont grisés et se mettent à jour en direct.
let pickerMessage = ''
function openPicker(message = '') {
  pickerMessage = message
  let box = $('profile-picker')
  if (!box) {
    box = Object.assign(document.createElement('div'), { id: 'profile-picker', className: 'profile-picker' })
    box.setAttribute('role', 'dialog')
    box.setAttribute('aria-modal', 'true')
    box.setAttribute('aria-labelledby', 'profile-picker-title')
    document.body.append(box)
  }
  box.hidden = false
  for (const el of document.querySelectorAll('body > header, body > main')) el.inert = true
  renderPicker()
  // Focus sur le dernier profil s'il est libre (Entrée suffit pour le reprendre), sinon sur le premier libre
  ;(box.querySelector('.picker-profile.last:not(:disabled)') ?? box.querySelector('button:not(:disabled)'))?.focus()
}
function closePicker() {
  $('profile-picker').hidden = true
  for (const el of document.querySelectorAll('body > header, body > main')) el.inert = false
}
function renderPicker() {
  const box = $('profile-picker')
  if (!box || box.hidden) return
  const focused = document.activeElement?.dataset?.profile
  const panel = Object.assign(document.createElement('div'), { className: 'picker-panel' })
  panel.append(
    Object.assign(document.createElement('h1'), { id: 'profile-picker-title', textContent: 'Qui es-tu ?' }),
    Object.assign(document.createElement('p'), { className: 'picker-hint', textContent: 'Choisis ton profil pour rejoindre la partie.' }),
  )
  if (pickerMessage) panel.append(Object.assign(document.createElement('p'), { className: 'picker-warning', textContent: pickerMessage }))
  const grid = Object.assign(document.createElement('div'), { className: 'picker-grid' })
  for (const p of getRoster()) {
    const taken = presence.takenBy(p.name)
    const b = Object.assign(document.createElement('button'), {
      type: 'button',
      className: `picker-profile${p.name === lastProfile ? ' last' : ''}${p.name === OBSERVER ? ' observer' : ''}`,
      disabled: taken,
      title: taken ? 'Déjà connecté sur un autre navigateur' : p.name === lastProfile ? 'Ton dernier profil' : '',
    })
    b.dataset.profile = p.name
    b.append(Object.assign(document.createElement('span'), { className: 'picker-name', textContent: p.name }))
    if (taken) b.append(Object.assign(document.createElement('span'), { className: 'picker-note', textContent: 'connecté' }))
    else if (p.name === lastProfile) b.append(Object.assign(document.createElement('span'), { className: 'picker-note', textContent: 'dernier profil' }))
    b.addEventListener('click', () => {
      if (presence.takenBy(p.name)) return renderPicker()
      setName(p.name)
      closePicker()
    })
    grid.append(b)
  }
  panel.append(grid)
  box.replaceChildren(panel)
  if (focused) box.querySelector(`[data-profile="${focused}"]:not(:disabled)`)?.focus()
}

function renderNames() {
  $('name-select').replaceChildren(...getRoster().map((p) => {
    const taken = p.name !== playerName && presence.takenBy(p.name)
    const opt = new Option(`${p.name}${taken ? ' · connecté' : ''}`, p.name, false, p.name === playerName)
    opt.disabled = taken
    return opt
  }))
}

function applyRole() {
  document.body.classList.toggle('is-gm', role() === 'gm')
  document.body.classList.toggle('is-observer', role() === 'observer')
  $('role-label').textContent = ROLE_LABEL[role()]
  $('role-label').dataset.role = role()
}

// remember = false : profil imposé (perdu dans un conflit), pas retenu comme « dernier profil »
function setName(name, { remember = true } = {}) {
  playerName = name
  if (remember) {
    store.set('name', playerName)
    touchProfile()
  }
  presence.claim()
  renderNames()
  applyRole()
  renderLog()
  sheets.rerender()
  party.rerender()
  board.rerender()
  music.rerender()
}

$('name-select').addEventListener('change', (e) => {
  const name = e.target.value
  if (presence.takenBy(name)) {
    renderNames()
    return notify(`« ${name} » est déjà connecté sur un autre navigateur.`)
  }
  setName(name)
})
// Liste des profils modifiée par le MJ (ici ou chez un autre joueur) : on redessine tout ce qui en dépend.
// Si notre propre profil vient d'être supprimé, on repasse Observateur et on redemande un profil.
function onProfilesChange() {
  if (playerName !== OBSERVER && !profileOf(playerName)) {
    const lost = playerName
    setName(OBSERVER, { remember: false })
    openPicker(`Le profil « ${lost} » a été supprimé par le MJ. Choisis un autre profil.`)
    return
  }
  renderNames()
  renderPicker()
  applyRole()
  renderLog()
  sheets.rerender()
  party.rerender()
  board.rerender()
}

renderNames()
applyRole()
// Démarrage, une fois la sauvegarde locale relue (la liste des profils ajoutés par le MJ s'y trouve) :
// dernier profil récent → repris d'office (s'il est déjà pris ailleurs, la présence le signalera dans quelques
// secondes et la fenêtre de choix s'ouvrira avec un avertissement) ; sinon → choix obligatoire.
for (const el of document.querySelectorAll('body > header, body > main')) el.inert = true // le temps de relire
let started = false
function start() {
  if (started) return
  started = true
  ready = true
  for (const el of document.querySelectorAll('body > header, body > main')) el.inert = false
  lastProfile = profileOf(savedName)?.name ?? null
  if (lastProfile && store.get('name') && Date.now() - lastSeen < PROFILE_MEMORY) {
    setName(lastProfile)
  } else {
    renderNames()
    openPicker()
  }
}
persistence.whenSynced.then(start, start)
setTimeout(start, 1500) // sauvegarde locale indisponible ou lente : on n'attend pas plus

// ---------- Export / import JSON ----------
// Mêmes collections que Starboard, sans celles du vaisseau ni des dossiers
const COLLECTIONS = ['musicTracks', 'musicPlaylists', 'mapPlan', 'templates', 'drawings', 'fog', 'mapLibrary', 'partySlots', 'status', 'playerProfiles']
$('btn-export').addEventListener('click', () => {
  const data = {
    game: GAME,
    version: 1,
    ...board.exportData(), // scenes, images (base64), board
    tokens: tokens.toJSON(),
    log: log.toJSON(),
    characters: doc.getMap('characters').toJSON(),
    ...Object.fromEntries(COLLECTIONS.map((k) => [k, doc.getMap(k).toJSON()])),
  }
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const a = document.createElement('a')
  a.href = URL.createObjectURL(blob)
  a.download = `grandal-${roomId}.json`
  a.click()
  URL.revokeObjectURL(a.href)
})

$('file-import').addEventListener('change', async (e) => {
  const file = e.target.files[0]
  e.target.value = ''
  if (!file) return
  if (role() !== 'gm') return
  let data
  try {
    data = JSON.parse(await file.text())
  } catch {
    alert('Fichier JSON illisible.')
    return
  }
  const parts = ['scenes', 'tokens', 'log', 'characters', ...COLLECTIONS].filter((k) => data[k] && Object.keys(data[k]).length)
  const names = { scenes: 'cartes et décors', tokens: 'pions', log: 'chronique', characters: 'fiches', musicTracks: 'pistes de musique', musicPlaylists: 'playlists', mapPlan: 'dessins des cartes', templates: 'gabarits', drawings: 'traits de crayon', fog: 'brouillard de guerre', mapLibrary: 'modèles de carte', partySlots: 'vignettes des aventuriers', status: 'PV et mana', playerProfiles: 'profils des joueurs' }
  if (!parts.length) return alert('Aucune donnée de partie dans ce fichier.')
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
  for (const k of COLLECTIONS.filter((p) => parts.includes(p))) {
    const map = doc.getMap(k)
    doc.transact(() => { map.clear(); Object.entries(data[k]).forEach(([id, v]) => map.set(id, v)) })
  }
})

// ---------- Démarrage ----------
renderLog()
