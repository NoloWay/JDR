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
// Jets de Grandal : d20 seulement, réussite à la valeur demandée ou plus, 20 / 1 critiques (games/grandal/dice.js)
import { roll, rollFreeD20, rollDamage, OUTCOME_LABEL, MODE_LABEL } from './dice.js'
import { setupGrandalSheets, replaceCharacters, toBase64, fromBase64 } from './sheet.js'
import { setupBoard } from '../../src/board.js'
import { setupMusic } from '../../src/music.js'
import { BADGES } from '../../src/rules.js'
import { OBSERVER, ROLE_LABEL, getRoster, profileOf, roleOf, ownerOfSheet, setupProfiles, setupPresence } from './presence.js'
import { setupParty } from './party.js'
import { autoSizeNumbers } from './autosize.js'

// Champs numériques à largeur dynamique : toute la page, plus la fiche, qui reste suivie une fois détachée dans sa fenêtre
autoSizeNumbers(document.body)
autoSizeNumbers(document.getElementById('sheet'))

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
// noHidden : aucune fiche (ni jeton) cachée aux joueurs, même si un ancien champ « hidden » traîne dans une fiche
const board = setupBoard({ doc, me, allPC: true, ownerOf: ownerOfSheet, noHidden: true })
board.setMode('map')

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
// Jet libre (d20 seul, sans valeur demandée)
$('btn-d20').addEventListener('click', () => pushLog({ text: `d20 → ${rollFreeD20()}` }))
// Jet contre une valeur demandée (bouton 🎲 d'une caractéristique sur la fiche) : mode Normal / Avantage /
// Désavantage et case « Jet secret » de la barre du haut ; rule 'over' = règle de Grandal (la valeur ou plus)
function rollCheck(label, target) {
  const r = roll(target, rollMode)
  pushLog({ text: label, roll: { sides: r.sides, target, mode: r.mode, values: r.values, kept: r.kept, outcome: r.outcome, rule: r.rule } })
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

// Jet de dégâts d'une arme (bouton de l'inventaire) : N dés à F faces + valeur fixe ; case « Jet secret » respectée
function rollWeapon(label, count, faces, bonus) {
  const r = rollDamage(count, faces, bonus)
  pushLog({ text: label, dmg: { count: r.count, faces: r.faces, bonus: r.bonus, values: r.values, total: r.total, raised: r.raised } })
}
function renderLog() {
  const ul = $('log-list')
  ul.innerHTML = ''
  log.toArray().filter(canSeeEntry).slice(-100).reverse().forEach((entry) => {
    const li = el('li', 'entry')
    li.style.setProperty('--who', colorOf(entry.who))
    if (entry.secret) { li.classList.add('secret'); li.title = 'Jet secret : visible par son auteur et le MJ' }
    const r = entry.roll
    const dmg = entry.dmg
    const [subject, action] = (r || dmg) && entry.text.includes(' · ') ? entry.text.split(' · ', 2) : [null, entry.text]

    const head = el('div', 'entry-head')
    head.append(el('b', 'who', roleOf(entry.who) === 'gm' ? `${entry.who} (MJ)` : entry.who))
    if (subject && subject !== characterOf(entry.who)?.get('name')) head.append(el('span', 'subject', subject))
    if (entry.secret) head.append(el('span', 'tag', 'secret'))
    head.append(el('time', '', entry.t ? hhmm(entry.t) : ''))
    li.append(head)

    const body = el('div', 'entry-body')
    if (dmg) {
      // Jet de dégâts : total en grand, détail des dés dessous
      const fixed = dmg.bonus ? ` ${dmg.bonus > 0 ? '+' : '−'} ${Math.abs(dmg.bonus)}` : ''
      body.append(el('span', 'action', action), el('span', 'roll-value', String(dmg.total)))
      // raised : le résultat était inférieur à 1, il est remonté à 1 (règle de Grandal)
      li.append(body, el('div', 'roll-detail', `🎲 ${dmg.count}d${dmg.faces} [${dmg.values.join(' + ')}]${fixed}${dmg.raised ? ' → minimum 1' : ''}`))
    } else if (r) {
      li.classList.add(`outcome-${r.outcome}`)
      body.append(el('span', 'action', action), el('span', 'roll-result', OUTCOME_LABEL[r.outcome]))
      const mode = MODE_LABEL[r.mode] ? ` · ${MODE_LABEL[r.mode]}` : ''
      const dice = r.values.length > 1 ? `${r.values.join(' et ')} → ${r.kept}` : `${r.values[0]}`
      // Règle de Grandal : il faut atteindre au moins la valeur demandée (anciens jets sans « rule » : ancienne règle)
      const goal = r.rule === 'over' ? `${r.target} ou plus` : `${r.target} ou moins`
      li.append(body, el('div', 'roll-detail', `🎲 ${dice} pour ${goal} (d${r.sides}${mode})`))
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
// Fiche propre à Grandal (games/grandal/sheet.js) : « Joueur » = un profil joueur existant, choisi par le MJ ;
// modification : MJ et propriétaire ; création (« + Fiche », bouton gm-only) et suppression : MJ seul
const sheets = setupGrandalSheets({ doc, me, ownerOf: ownerOfSheet, playerChoices: () => profiles.players(), onRoll: rollCheck, onRollWeapon: rollWeapon })
$('btn-new-sheet').addEventListener('click', () => sheets.create())

// ---------- Onglets Carte / Fiches (choix local, mémorisé) et vignettes des aventuriers ----------
let party = null
let currentView = 'map'
function setView(v) {
  // « Paramètres » : MJ seul (un autre profil retombe sur la Carte)
  const allowed = v === 'settings' && role() !== 'gm' ? 'map' : v
  const view = allowed === 'roster' || allowed === 'settings' ? allowed : 'map'
  currentView = view
  // Une fiche ouverte recouvre les deux onglets : changer d'onglet la referme pour montrer l'onglet choisi
  // (sauf si elle est détachée dans sa propre fenêtre)
  sheets.closeDocked()
  if (view !== 'roster') party?.leaveRoster()
  $('roster').hidden = view !== 'roster'
  $('settings').hidden = view !== 'settings'
  if (allowed === v) store.set('view', view)
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
  if (currentView === 'settings' && role() !== 'gm') setView('map') // on n'est plus MJ : l'onglet Paramètres se ferme
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
    // Images des personnages, encodées en base64
    portraits: Object.fromEntries([...doc.getMap('portraits').entries()].map(([id, p]) => [id, { type: p.type, base64: toBase64(p.data) }])),
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
  const parts = ['scenes', 'tokens', 'log', 'characters', 'portraits', ...COLLECTIONS].filter((k) => data[k] && Object.keys(data[k]).length)
  const names = { scenes: 'cartes et décors', tokens: 'pions', log: 'chronique', characters: 'fiches', portraits: 'images des personnages', musicTracks: 'pistes de musique', musicPlaylists: 'playlists', mapPlan: 'dessins des cartes', templates: 'gabarits', drawings: 'traits de crayon', fog: 'brouillard de guerre', mapLibrary: 'modèles de carte', partySlots: 'vignettes des aventuriers', status: 'statut des personnages (HP, MP, SPD, EP, SS, SP)', playerProfiles: 'profils des joueurs' }
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
  if (parts.includes('portraits')) {
    const portraits = doc.getMap('portraits')
    doc.transact(() => {
      portraits.clear()
      for (const [id, p] of Object.entries(data.portraits)) if (p?.base64) portraits.set(id, { type: p.type, data: fromBase64(p.base64) })
    })
  }
  for (const k of COLLECTIONS.filter((p) => parts.includes(p))) {
    const map = doc.getMap(k)
    doc.transact(() => { map.clear(); Object.entries(data[k]).forEach(([id, v]) => map.set(id, v)) })
  }
})

// ---------- Démarrage ----------
renderLog()
