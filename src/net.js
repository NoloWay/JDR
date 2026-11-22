import * as Y from 'yjs'
import { joinRoom } from 'trystero/torrent'
import { IndexeddbPersistence } from 'y-indexeddb'

// Identifiant d'application : change-le pour isoler ton jeu des autres utilisateurs de Trystero.
// En développement (npm run dev), un identifiant à part : la version locale ne peut jamais rejoindre
// une salle du site en ligne, même avec le même #code.
const APP_ID = import.meta.env.DEV ? 'Noloway-dev' : 'Noloway'

/**
 * Ouvre (ou rejoint) une salle.
 * - Yjs garde l'état partagé (fusion automatique des modifications).
 * - Trystero relaie les mises à jour entre navigateurs en WebRTC (aucun serveur à héberger).
 * - IndexedDB sauvegarde l'état localement : on retrouve la partie en revenant sur la même salle.
 *
 * `game` (surcouche multi-jeux, voir src/games.js) isole les parties de chaque jeu : sauvegarde
 * IndexedDB « <game>:<salle> » et appId Trystero propre au jeu. Starboard ne le précise pas et garde
 * exactement ses noms d'origine (« starboard:<salle> », APP_ID) : ses parties existantes ne bougent pas.
 */
export function connect(roomId, { onPeers, game = 'starboard' } = {}) {
  const doc = new Y.Doc()
  const persistence = new IndexeddbPersistence(`${game}:${roomId}`, doc)
  const appId = game === 'starboard' ? APP_ID : `${APP_ID}-${game}`

  // Si le réseau échoue (WebRTC indisponible…), l'outil reste utilisable en local au lieu de planter.
  let room
  try {
    room = joinRoom({ appId }, roomId)
  } catch (err) {
    console.error('Connexion P2P impossible, mode hors ligne :', err)
    onPeers?.(-1)
    return { doc, room: null, persistence }
  }
  const [sendUpdate, onUpdate] = room.makeAction('ydoc')
  const [sendState, onState] = room.makeAction('ystate')

  // Les modifications locales partent vers tous les pairs.
  doc.on('update', (update, origin) => {
    if (origin !== 'remote') sendUpdate(update)
  })

  // ---------- Resynchronisation régulière ----------
  // Une modification n'est envoyée qu'une fois : si elle se perd (micro-coupure), Yjs met de côté toutes les suivantes
  // du même auteur en attendant celle qui manque (doc.store.pendingStructs), et le joueur ne reçoit plus rien jusqu'au
  // rechargement. Et deux joueurs sans connexion directe entre eux ne s'échangent rien.
  // Remède : chacun envoie régulièrement son « état de version » (Y.encodeStateVector, quelques octets) ; chaque pair
  // répond avec ce qui lui manque. Un joueur rattrape donc ses manques auprès de n'importe quel pair qui les a.
  const [sendVector, onVector] = room.makeAction('yvector')
  let lastAsk = 0
  const askSync = () => {
    if (!Object.keys(room.getPeers()).length) return
    lastAsk = Date.now()
    sendVector(Y.encodeStateVector(doc))
  }
  onVector((vector, peerId) => sendState(Y.encodeStateAsUpdate(doc, new Uint8Array(vector)), peerId))

  const applyRemote = (update) => {
    Y.applyUpdate(doc, new Uint8Array(update), 'remote')
    // Modification en attente d'une précédente qui n'est jamais arrivée : on la redemande tout de suite
    if (doc.store.pendingStructs && Date.now() - lastAsk > 3000) askSync()
  }
  onUpdate(applyRemote)
  onState(applyRemote)

  setInterval(askSync, 25000 + Math.random() * 10000) // décalé d'un joueur à l'autre
  // Retour sur l'onglet, connexion Internet revenue : rattrapage immédiat
  document.addEventListener('visibilitychange', () => { if (!document.hidden) askSync() })
  addEventListener('online', askSync)

  // Quand quelqu'un arrive, on lui envoie l'état complet.
  room.onPeerJoin((peerId) => {
    sendState(Y.encodeStateAsUpdate(doc), peerId)
    onPeers?.(Object.keys(room.getPeers()).length)
  })
  room.onPeerLeave(() => onPeers?.(Object.keys(room.getPeers()).length))

  return { doc, room, persistence }
}
