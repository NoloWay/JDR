// Grandal : joueurs, rôles fixes et présence (un seul connecté par profil, sauf Observateur).
//
// Les rôles ne se choisissent pas : ils découlent du profil (ROSTER). La présence n'est PAS stockée dans le
// Y.Doc (elle serait sauvegardée et resynchronisée indéfiniment) : chaque navigateur annonce son profil aux
// autres par un message Trystero éphémère (action « presence »). Les pairs sont relevés toutes les 2 s avec
// room.getPeers() — on ne peut pas utiliser room.onPeerJoin / onPeerLeave, déjà pris par src/net.js
// (Trystero n'accepte qu'un seul écouteur).
// Conflit (deux navigateurs sur le même profil) : le plus ancien à l'avoir pris le garde (date de prise, puis
// identifiant de session : tout le monde tranche pareil), l'autre repasse Observateur.

export const OBSERVER = 'Observateur'
export const GM = 'Withex'
// Profils fixes (ni ajoutés ni supprimés par le MJ) et profils joueurs de départ
const FIXED = [{ name: GM, role: 'gm' }, { name: OBSERVER, role: 'observer' }]
const DEFAULT_PLAYERS = ['Aranud', 'Baptracien', 'Juju2pom', 'Noloway', 'Rodag', 'Walter']
export const ROLE_LABEL = { gm: 'MJ', player: 'Joueur', observer: 'Observateur' }

const norm = (s) => (s || '').trim().toLowerCase()
const byName = (a, b) => a.localeCompare(b, 'fr', { sensitivity: 'base' })

// Liste courante des profils (joueurs, puis MJ et Observateur), tenue à jour par setupProfiles()
let roster = [...DEFAULT_PLAYERS.map((name) => ({ name, role: 'player' })), ...FIXED]
export const getRoster = () => roster
export const profileOf = (name) => roster.find((p) => norm(p.name) === norm(name))
export const roleOf = (name) => profileOf(name)?.role ?? 'observer' // profil inconnu ou supprimé : Observateur
/** Profil exclusif : un seul navigateur à la fois (tous sauf Observateur) */
export const isExclusive = (name) => roleOf(name) !== 'observer'
/** Propriétaire d'une fiche (Grandal) : son champ « Joueur », s'il désigne un profil joueur existant */
export const ownerOfSheet = (_charName, player) => {
  const p = profileOf(player)
  return p?.role === 'player' ? p.name : ''
}

/**
 * Profils joueurs, ajoutés / supprimés par le MJ et partagés : doc.getMap('playerProfiles').
 * On n'y écrit que les écarts avec la liste de départ (nom → true = ajouté, nom de départ → false = supprimé),
 * jamais la liste complète : rien n'est recopié au chargement, donc une suppression ne peut pas « ressusciter ».
 * Le MJ (Withex) et l'Observateur sont fixes.
 */
export function setupProfiles(doc, onChange) {
  const map = doc.getMap('playerProfiles')
  const isDefault = (name) => DEFAULT_PLAYERS.find((d) => norm(d) === norm(name))

  function players() {
    const list = new Map()
    for (const d of DEFAULT_PLAYERS) if (map.get(d) !== false) list.set(norm(d), d)
    for (const [k, v] of map.entries()) if (v === true && !isDefault(k)) list.set(norm(k), k)
    return [...list.values()].sort(byName)
  }
  function update() {
    roster = [...players().map((name) => ({ name, role: 'player' })), ...FIXED]
    onChange?.()
  }
  map.observe(update)
  update()

  return {
    players,
    /** Ajoute un profil joueur ; renvoie un message d'erreur, ou '' si c'est fait */
    add(raw) {
      const name = String(raw || '').trim().replace(/\s+/g, ' ')
      if (!name) return 'Indique un nom.'
      if (name.length > 20) return 'Nom trop long (20 caractères au plus).'
      if (FIXED.some((p) => norm(p.name) === norm(name))) return `« ${name} » est un profil réservé.`
      if (players().some((p) => norm(p) === norm(name))) return `Le profil « ${name} » existe déjà.`
      const d = isDefault(name)
      doc.transact(() => {
        if (d) map.delete(d) // profil de départ supprimé puis rétabli
        else map.set(name, true)
      })
      return ''
    },
    /** Supprime un profil joueur (jamais le MJ ni l'Observateur) */
    remove(name) {
      if (profileOf(name)?.role !== 'player') return
      const d = isDefault(name)
      doc.transact(() => {
        if (d) map.set(d, false)
        for (const k of [...map.keys()]) if (norm(k) === norm(name) && k !== d) map.delete(k)
      })
    },
  }
}

/**
 * ctx : { room (Trystero, ou null hors ligne), getName(), onChange(), onLost(name) }
 * Renvoie { claim(name), takenBy(name) → bool }
 */
export function setupPresence(ctx) {
  const sid = Math.random().toString(36).slice(2, 10)
  let since = Date.now()
  const others = new Map() // peerId → { name, since, sid }
  if (!ctx.room) return { claim() { since = Date.now() }, takenBy: () => false }

  const [send, receive] = ctx.room.makeAction('presence')
  const message = () => ({ name: ctx.getName(), since, sid })

  // Le plus ancien sur le profil le garde ; à égalité, le plus petit identifiant de session
  const beats = (a, b) => a.since < b.since || (a.since === b.since && a.sid < b.sid)

  function checkConflict() {
    const name = ctx.getName()
    if (!isExclusive(name)) return
    const rival = [...others.values()].find((o) => norm(o.name) === norm(name) && beats(o, { since, sid }))
    if (rival) ctx.onLost(name)
  }

  receive((data, peerId) => {
    if (!data || typeof data.name !== 'string') return
    others.set(peerId, { name: data.name, since: Number(data.since) || 0, sid: String(data.sid || '') })
    checkConflict()
    ctx.onChange()
  })

  // Pairs arrivés / partis : on se présente aux nouveaux, on oublie les absents
  let known = new Set()
  function poll() {
    const now = new Set(Object.keys(ctx.room.getPeers()))
    for (const id of now) if (!known.has(id)) send(message(), id)
    let changed = false
    for (const id of others.keys()) if (!now.has(id)) { others.delete(id); changed = true }
    known = now
    if (changed) ctx.onChange()
  }
  setInterval(poll, 2000)
  // Filet de sécurité : annonce régulière à tous (message perdu, pair arrivé entre deux relevés)
  setInterval(() => send(message()), 15000)
  poll()

  return {
    /** À appeler quand on prend un profil : la date de prise sert à trancher les conflits */
    claim() {
      since = Date.now()
      send(message())
    },
    /** Le profil est-il déjà pris par un autre navigateur ? (toujours libre pour Observateur) */
    takenBy(name) {
      return isExclusive(name) && [...others.values()].some((o) => norm(o.name) === norm(name))
    },
  }
}
