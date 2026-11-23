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
export const ROSTER = [
  { name: 'Aranud', role: 'player' },
  { name: 'Baptracien', role: 'player' },
  { name: 'Juju2pom', role: 'player' },
  { name: 'Noloway', role: 'player' },
  { name: 'Rodag', role: 'player' },
  { name: 'Walter', role: 'player' },
  { name: 'Withex', role: 'gm' },
  { name: OBSERVER, role: 'observer' },
]
export const ROLE_LABEL = { gm: 'MJ', player: 'Joueur', observer: 'Observateur' }

const norm = (s) => (s || '').trim().toLowerCase()
export const profileOf = (name) => ROSTER.find((p) => norm(p.name) === norm(name))
export const roleOf = (name) => profileOf(name)?.role ?? 'observer'
/** Profil exclusif : un seul navigateur à la fois (tous sauf Observateur) */
export const isExclusive = (name) => roleOf(name) !== 'observer'

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
