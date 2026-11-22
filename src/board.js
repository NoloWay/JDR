import { h, liveRender } from './dom.js'
import { BADGES, DOOR_ACCESS, DOOR_LEVELS, ownerOf, stricterLevel } from './rules.js'
import { CHARACTER_MIME } from './sheets.js'
import { CELL, DECKS, deckSize, doorAt, drawPlan, entriesBounds, isRoomType, labelOf, resolveEntries, roomsAround, seedItems, shapeAt } from './shipMap.js'
import { setupPlanEditor } from './planEditor.js'
import { setupMapTools } from './mapTools.js'

// Plateau : scènes (cartes), image de fond partagée, pions, caméra locale (pan + zoom).
//
// Données partagées (Y.Doc) :
//   scenes : id → { name, order, image (id | null), width, height, grid (= taille des jetons) }
//   images : id → { type, data: Uint8Array }   (image compressée en WebP, partagée en P2P)
//   board  : 'scene' → id de la scène affichée chez tout le monde (choisie par le MJ)
//   tokens : id → { x, y, color, label, scene }  (coordonnées « monde », en pixels de la carte)
//   mapPlan : id → élément dessiné sur une carte (mêmes éléments que le plan du Gaïa, deck = id de la carte)
//   mapLibrary : id → { name, w, h, items: [[id, élément]…] }  (modèles réutilisables, coordonnées depuis 0, 0)
//   scenes[id] d'une carte : gridType ('none' | 'square' | 'hex'), gridSize, gridX, gridY (décalage), gridSnap (jetons aimantés)
// La caméra reste locale : chacun cadre comme il veut.
// Les cartes (onglet Carte) sont indépendantes du vaisseau : leurs dessins vivent dans mapPlan et chaque carte
// a ses propres jetons (un personnage peut avoir un jeton sur le vaisseau et un sur chaque carte).

const DEFAULT_SCENE = 'main'
const SHIP_SCENE = 'ship' // préfixe des scènes de l'onglet Vaisseau (ship:1, ship:0, ship:-1)
const MAX_IMAGE = 4096 // côté max après compression
const ZOOM_MIN = 0.1
const ZOOM_MAX = 4
const COLORS = ['#38e8ff', '#ff3dd8', '#9dff4a', '#ffb02e', '#a78bff', '#ff5a5a']

/** Compresse une image (PNG, JPG, SVG…) en WebP ; renvoie { type, data, width, height }. */
async function compressImage(file) {
  const url = URL.createObjectURL(file)
  try {
    const img = new Image()
    img.src = url
    await img.decode()
    let { naturalWidth: w, naturalHeight: hgt } = img
    if (!w || !hgt) throw new Error('Image vide')
    const scale = Math.min(1, MAX_IMAGE / Math.max(w, hgt))
    w = Math.round(w * scale)
    hgt = Math.round(hgt * scale)
    const canvas = document.createElement('canvas')
    canvas.width = w
    canvas.height = hgt
    canvas.getContext('2d').drawImage(img, 0, 0, w, hgt)
    const blob = await new Promise((res) => canvas.toBlob(res, 'image/webp', 0.85))
    return { type: blob.type, data: new Uint8Array(await blob.arrayBuffer()), width: w, height: hgt }
  } finally {
    URL.revokeObjectURL(url)
  }
}

/**
 * ctx : { doc, me() -> { name, isGM } }
 */
export function setupBoard(ctx) {
  const { doc } = ctx
  const scenes = doc.getMap('scenes')
  const images = doc.getMap('images')
  const board = doc.getMap('board')
  const tokens = doc.getMap('tokens')
  const characters = doc.getMap('characters')
  const plan = doc.getMap('plan') // éléments du plan du Gaïa (formes, portes, caméras), voir shipMap.js
  const doorLevels = doc.getMap('doorLevels') // ancien stockage des niveaux de portes : repris à la première modification d'un étage
  const mapPlan = doc.getMap('mapPlan') // dessins des cartes de l'onglet Carte (deck = id de la carte)
  const mapLibrary = doc.getMap('mapLibrary') // modèles de la bibliothèque (éditeur de carte)

  const canvas = document.getElementById('board')
  const screen = canvas.getContext('2d')
  let g = screen // remplacé le temps d'un export PNG
  let target = null // export PNG : { cam, width, height } (sinon : l'écran)
  const dpr = () => (target ? 1 : devicePixelRatio)
  const bar = document.getElementById('scene-bar')

  // ---------- Plan du Gaïa : version d'origine (Excel) tant que l'étage n'a jamais été modifié ----------
  const deckMarker = (d) => `deck:${d}`
  /** Éléments d'un étage : [[id, élément]…], portes et vitres placées sur le mur de leur pièce */
  function deckEntries(d = deck) {
    if (!plan.has(deckMarker(d))) return resolveEntries(seedItems(d))
    return resolveEntries([...plan.entries()].filter(([, it]) => it.deck === d && it.kind !== 'deck'))
  }
  /** Copie l'étage d'origine dans le Y.Doc avant sa première modification (identifiants stables : sans doublons). */
  function ensureSeeded(d) {
    if (plan.has(deckMarker(d))) return
    doc.transact(() => {
      plan.set(deckMarker(d), { kind: 'deck', deck: d })
      for (const [id, it] of seedItems(d)) {
        plan.set(id, it.kind === 'door' && doorLevels.has(id) ? { ...it, level: doorLevels.get(id) } : it)
      }
    }, 'seed')
  }

  // ---------- Vue (onglet, local à chaque joueur) et scène courante ----------
  // « ship » : plan du Gaïa, un étage choisi localement (scène `ship:<étage>`) ; « map » : scènes du MJ.
  let mode = 'ship'
  let deck = (() => { try { return localStorage.getItem('starboard:deck') } catch { return null } })()
  if (!DECKS.includes(deck)) deck = '0'
  const mapScene = () => {
    const id = board.get('scene')
    return scenes.has(id) && !String(id).startsWith(SHIP_SCENE) ? id : DEFAULT_SCENE
  }
  const sceneId = () => (mode === 'ship' ? `${SHIP_SCENE}:${deck}` : mapScene())
  const scene = () => (mode === 'ship'
    ? { name: `Étage ${deck}`, grid: CELL, image: 'plan', ...deckSize(deck) } // image : permet le cadrage
    : scenes.get(sceneId()) ?? { name: 'Plateau', grid: 50, image: null })
  const tokenScene = (t) => t.scene ?? DEFAULT_SCENE
  /** « Espace » d'une scène : tous les étages du vaisseau n'en font qu'un, chaque carte est le sien. */
  const space = (sc) => (String(sc).startsWith(`${SHIP_SCENE}:`) ? SHIP_SCENE : sc)
  /** Calque d'un élément de carte (une porte ou une vitre suit celui de sa forme). */
  const layerOf = (it, byId) => (it.host ? byId.get(it.host)?.layer : it.layer) ?? 'decor'
  /**
   * Éléments dessinés d'une carte (portes placées sur le mur de leur forme), sans le calque « MJ seulement »
   * pour les joueurs ni les calques masqués dans l'éditeur.
   */
  function mapEntries(id = mapScene()) {
    const all = resolveEntries([...mapPlan.entries()].filter(([, it]) => it.deck === id))
    const byId = new Map(all)
    return all.filter(([, it]) => {
      const l = layerOf(it, byId)
      return (l !== 'gm' || ctx.me().isGM) && mapEditor.layerVisible(l)
    })
  }
  const entries = () => (mode === 'ship' ? deckEntries() : mapEntries())
  const tokenSize = () => Number(scene().grid) || 50

  // ---------- Caméra (locale, une par scène) ----------
  const cams = {}
  let flash = null // { id, until } : jeton mis en évidence après une recherche
  // Une seule caméra pour tous les étages du vaisseau : changer d'étage garde le cadrage (les étages se superposent)
  const cam = () => target?.cam ?? (cams[mode === 'ship' ? SHIP_SCENE : sceneId()] ??= { x: 0, y: 0, zoom: 1, fitted: false })
  const toWorld = (sx, sy) => ({ x: (sx - cam().x) / cam().zoom, y: (sy - cam().y) / cam().zoom })
  const view = () => canvas.getBoundingClientRect()

  // ---------- Grille des cartes (optionnelle) ----------
  const grid = () => {
    const sc = mode === 'map' ? scene() : {}
    return { type: sc.gridType ?? 'none', size: Number(sc.gridSize) || CELL, ox: Number(sc.gridX) || 0, oy: Number(sc.gridY) || 0, snap: !!sc.gridSnap }
  }
  /** Centre de la case (carrée ou hexagonale, pointe en haut) la plus proche d'un point. */
  function cellCenter({ x, y }) {
    const { type, size, ox, oy } = grid()
    if (type === 'square') return { x: ox + (Math.floor((x - ox) / size) + 0.5) * size, y: oy + (Math.floor((y - oy) / size) + 0.5) * size }
    const R = size / Math.sqrt(3) // rayon d'un hexagone de largeur size
    const row = Math.round((y - oy) / (1.5 * R))
    let best = null
    for (let r = row - 1; r <= row + 1; r++) {
      const shift = Math.abs(r % 2) === 1 ? size / 2 : 0
      const cx = ox + shift + Math.round((x - ox - shift) / size) * size
      const cy = oy + r * 1.5 * R
      if (!best || Math.hypot(x - cx, y - cy) < Math.hypot(x - best.x, y - best.y)) best = { x: cx, y: cy }
    }
    return best
  }
  /** Position d'un jeton : au centre de sa case si la grille aimante les jetons. */
  const snapToken = (p) => (mode === 'map' && grid().type !== 'none' && grid().snap ? cellCenter(p) : p)

  function drawGrid(c) {
    const { type, size, ox, oy } = grid()
    if (type === 'none' || size * c.zoom < 6) return
    const inv = g.getTransform().inverse()
    const a = inv.transformPoint(new DOMPoint(0, 0))
    const b = inv.transformPoint(new DOMPoint(g.canvas.width, g.canvas.height))
    g.save()
    g.strokeStyle = 'rgba(160, 220, 255, 0.22)'
    g.lineWidth = 1 / c.zoom
    g.beginPath()
    if (type === 'square') {
      for (let x = ox + Math.floor((a.x - ox) / size) * size; x <= b.x; x += size) { g.moveTo(x, a.y); g.lineTo(x, b.y) }
      for (let y = oy + Math.floor((a.y - oy) / size) * size; y <= b.y; y += size) { g.moveTo(a.x, y); g.lineTo(b.x, y) }
    } else {
      const R = size / Math.sqrt(3)
      for (let r = Math.floor((a.y - oy) / (1.5 * R)) - 1; oy + r * 1.5 * R <= b.y + R; r++) {
        const shift = Math.abs(r % 2) === 1 ? size / 2 : 0
        const cy = oy + r * 1.5 * R
        for (let cx = ox + shift + Math.floor((a.x - ox - shift) / size - 1) * size; cx <= b.x + size; cx += size) {
          for (let i = 0; i < 6; i++) { // hexagone pointe en haut
            const t = -Math.PI / 2 + (i * Math.PI) / 3
            const px = cx + R * Math.cos(t)
            const py = cy + R * Math.sin(t)
            if (i) g.lineTo(px, py); else g.moveTo(px, py)
          }
          g.closePath()
        }
      }
    }
    g.stroke()
    g.restore()
  }

  /** Emprise de tous les éléments de tous les étages (même cadre quel que soit l'étage affiché). */
  const shipBounds = () => entriesBounds(DECKS.flatMap((d) => deckEntries(d)))
  /** Emprise d'une carte : son image de fond et ses dessins. */
  function mapBounds() {
    const sc = scene()
    const parts = [sc.image && sc.width ? { x: 0, y: 0, width: sc.width, height: sc.height } : null, entriesBounds(mapEntries())].filter(Boolean)
    if (!parts.length) return null
    const x = Math.min(...parts.map((p) => p.x))
    const y = Math.min(...parts.map((p) => p.y))
    return { x, y, width: Math.max(...parts.map((p) => p.x + p.width)) - x, height: Math.max(...parts.map((p) => p.y + p.height)) - y }
  }

  /** Cadre la carte entière (ou l'origine s'il n'y a rien). */
  function fit() {
    const b = mode === 'ship' ? shipBounds() ?? { x: 0, y: 0, ...deckSize(deck) } : mapBounds()
    const s = b ? { image: 'plan', ...b } : { image: null }
    const { width, height } = view()
    const c = cam()
    if (!width || !height) return // pas encore affiché (onglet en arrière-plan) : on cadrera au redimensionnement
    if (s.image && s.width && s.height) {
      c.zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, Math.min(width / s.width, height / s.height) * 0.95))
      c.x = (width - s.width * c.zoom) / 2 - s.x * c.zoom
      c.y = (height - s.height * c.zoom) / 2 - s.y * c.zoom
    } else {
      c.zoom = 1
      c.x = 0
      c.y = 0
    }
    c.fitted = true
    draw()
  }

  // ---------- Images (décodées une fois, gardées en cache) ----------
  const bitmaps = new Map() // id → ImageBitmap | 'loading'
  function bitmap(id) {
    if (!id) return null
    const cached = bitmaps.get(id)
    if (cached && cached !== 'loading') return cached
    if (!cached && images.has(id)) {
      bitmaps.set(id, 'loading')
      const { type, data } = images.get(id)
      createImageBitmap(new Blob([data], { type }))
        .then((bmp) => { bitmaps.set(id, bmp); if (!cam().fitted) fit(); else draw() })
        .catch(() => bitmaps.delete(id))
    }
    return null
  }

  // ---------- Rendu ----------
  function resize() {
    const r = view()
    canvas.width = r.width * devicePixelRatio
    canvas.height = r.height * devicePixelRatio
    if (!cam().fitted) fit()
    draw()
  }

  function draw() {
    const { width, height } = target ?? view()
    const c = cam()
    const s = scene()
    const k = dpr()
    g.setTransform(k, 0, 0, k, 0, 0)
    g.clearRect(0, 0, width, height)
    if (target) { g.fillStyle = '#05070f'; g.fillRect(0, 0, width, height) } // fond de l'image exportée
    g.setTransform(k * c.zoom, 0, 0, k * c.zoom, k * c.x, k * c.y)

    const bmp = mode === 'ship' ? null : bitmap(s.image)
    if (mode === 'ship') drawPlan(g, deckEntries(), c.zoom, ctx.me().isGM)
    else {
      if (bmp) {
        g.imageSmoothingEnabled = c.zoom < 2 // plans en « pixel art » : net quand on zoome
        g.drawImage(bmp, 0, 0, s.width, s.height)
      }
      // Calques dans l'ordre : décor, annotations, MJ
      const ents = mapEntries()
      const byId = new Map(ents)
      for (const l of ['decor', 'notes', 'gm']) {
        const part = ents.filter(([, it]) => layerOf(it, byId) === l)
        if (part.length) drawPlan(g, part, c.zoom, ctx.me().isGM, true, bitmap)
      }
      drawGrid(c)
    }
    tools.drawUnder(g, c.zoom) // gabarits et dessins
    if (!target) {
      tools.drawFog(g, g.getTransform()) // brouillard (onglet Carte)
      // Carte vide (ni fond ni dessin) : invitation à importer une carte
      placeholder.hidden = !(mode === 'map' && !s.image && !mapEntries().length && !mapEditor.active)
    }

    // Pions de la scène (ceux des personnages cachés : invisibles aux joueurs, translucides pour le MJ)
    const r = tokenSize() * 0.4
    tokens.forEach((t, id) => {
      if (!visible(t)) return
      if (flash?.id === id && performance.now() < flash.until) { // jeton trouvé par la recherche : halo
        g.strokeStyle = '#4ff3ff'
        g.lineWidth = r * 0.18
        g.beginPath(); g.arc(t.x, t.y, r * 1.7, 0, Math.PI * 2); g.stroke()
      }
      const { label, color, hidden, isChar } = look(t)
      g.globalAlpha = hidden ? 0.45 : 1
      g.shadowColor = color
      g.shadowBlur = 14
      g.fillStyle = color
      g.beginPath()
      g.arc(t.x, t.y, r, 0, Math.PI * 2)
      g.fill()
      g.shadowBlur = 0
      if (isChar) { // anneau : distingue les personnages (et rend visibles les badges sombres)
        g.strokeStyle = 'rgba(234, 246, 255, 0.75)'
        g.lineWidth = r * 0.1
        g.stroke()
      }
      g.fillStyle = isLight(color) ? '#05070f' : '#eaf6ff'
      g.font = `600 ${Math.round(r * 0.6)}px system-ui`
      g.textAlign = 'center'
      g.textBaseline = 'middle'
      g.fillText(label, t.x, t.y)
      g.globalAlpha = 1
    })

    if (target) return // export : ni poignées, ni outils en cours
    ed().drawOverlay(g, c.zoom)
    tools.drawAbove(g, c.zoom)

    document.getElementById('zoom-label').textContent = `${Math.round(c.zoom * 100)} %`
  }

  // ---------- Souris : pions, déplacement de la vue, zoom ----------
  let drag = null // { kind: 'token', id, dx, dy } | { kind: 'pan', sx, sy, cx, cy }

  const pointer = (e) => {
    const r = view()
    return { sx: e.clientX - r.left, sy: e.clientY - r.top }
  }
  function hitToken(world) {
    let hit = null
    const r = tokenSize() * 0.4
    tokens.forEach((t, id) => {
      if (visible(t) && Math.hypot(t.x - world.x, t.y - world.y) <= r) hit = id
    })
    return hit
  }

  canvas.addEventListener('pointerdown', (e) => {
    const { sx, sy } = pointer(e)
    const world = toWorld(sx, sy)
    const editing = ed().active
    if (tools.active() && e.button === 0) { // règle, gabarit, crayon ou brouillard
      tools.pointerDown(world)
      drag = { kind: 'tool' }
      canvas.setPointerCapture(e.pointerId)
      return
    }
    if (editing && ed().pointerDown(world, e)) {
      drag = { kind: 'edit' }
      canvas.setPointerCapture(e.pointerId)
      return
    }
    const hit = e.button === 0 && !editing ? hitToken(world) : null
    if (hit) {
      const t = tokens.get(hit)
      drag = { kind: 'token', id: hit, dx: t.x - world.x, dy: t.y - world.y }
    } else if (e.button === 0 || e.button === 1) {
      e.preventDefault()
      drag = { kind: 'pan', sx, sy, cx: cam().x, cy: cam().y }
    } else return
    canvas.classList.add('dragging')
    canvas.setPointerCapture(e.pointerId)
  })

  canvas.addEventListener('pointermove', (e) => {
    const { sx, sy } = pointer(e)
    if (!drag) {
      // Nom de la pièce (ou de la zone) survolée en infobulle
      const w = toWorld(sx, sy)
      const room = shapeAt(g, entries(), w.x, w.y, (it) => isRoomType(it.type))
      canvas.title = room && !fogged(w) ? labelOf(room[1]) : ''
      ed().hover(w, e) // aperçu de la polyligne en cours
      return
    }
    if (drag.kind === 'tool') {
      tools.pointerMove(toWorld(sx, sy))
    } else if (drag.kind === 'edit') {
      ed().pointerMove(toWorld(sx, sy), e)
    } else if (drag.kind === 'pan') {
      cam().x = drag.cx + sx - drag.sx
      cam().y = drag.cy + sy - drag.sy
      draw()
    } else {
      const world = toWorld(sx, sy)
      const t = tokens.get(drag.id)
      if (t) tokens.set(drag.id, { ...t, x: world.x + drag.dx, y: world.y + drag.dy })
    }
  })

  function endDrag(e) {
    if (drag?.kind === 'token') { const t = tokens.get(drag.id); if (t) { const p = snapToken(t); if (p.x !== t.x || p.y !== t.y) tokens.set(drag.id, { ...t, ...p }) } }
    if (drag?.kind === 'edit') ed().pointerUp()
    if (drag?.kind === 'tool') tools.pointerUp()
    // Simple clic (sans déplacement) dans la vue Vaisseau, hors édition : ouvre la fiche de la porte cliquée
    if (drag?.kind === 'pan' && e?.type === 'pointerup' && mode === 'ship' && !editor.active) {
      const { sx, sy } = pointer(e)
      if (Math.hypot(sx - drag.sx, sy - drag.sy) < 4) {
        const w = toWorld(sx, sy)
        const door = doorAt(deckEntries(), w.x, w.y)
        if (door) openDoor(door[0], sx, sy)
        else closeDoor()
      }
    }
    drag = null
    canvas.classList.remove('dragging')
  }
  canvas.addEventListener('pointerup', endDrag)
  canvas.addEventListener('pointercancel', endDrag)
  canvas.addEventListener('lostpointercapture', endDrag) // filet de sécurité si le relâchement n'arrive pas
  canvas.addEventListener('auxclick', (e) => e.preventDefault())

  function zoomAt(sx, sy, factor) {
    const c = cam()
    const zoom = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, c.zoom * factor))
    const world = toWorld(sx, sy)
    c.zoom = zoom
    c.x = sx - world.x * zoom
    c.y = sy - world.y * zoom
    draw()
  }
  canvas.addEventListener('wheel', (e) => {
    e.preventDefault()
    const { sx, sy } = pointer(e)
    zoomAt(sx, sy, Math.exp(-e.deltaY * 0.0015))
  }, { passive: false })

  canvas.addEventListener('dblclick', (e) => {
    const { sx, sy } = pointer(e)
    if (ed().active) return ed().dblclick(toWorld(sx, sy))
    const hit = hitToken(toWorld(sx, sy))
    if (hit) tokens.delete(hit)
    else tools.dblclick(toWorld(sx, sy)) // gabarit ou trait de crayon
  })

  // ---------- Pions ----------


  /** Jeton lié à un personnage : nom et couleur de badge lus en direct sur la fiche. */
  function look(t) {
    const c = t.charId && characters.get(t.charId)
    if (!c) return { label: t.label, color: t.color, hidden: false, isChar: false }
    const initials = c.get('name').split(/\s+/).filter(Boolean).map((w) => w[0]).join('').slice(0, 2).toUpperCase()
    const mine = ownerOf(c.get('name'), c.get('player')).toLowerCase() === ctx.me().name.toLowerCase()
    return { label: initials, color: BADGES.find((b) => b.name === c.get('badge'))?.color ?? '#9aa4b5', hidden: !!c.get('hidden'), isChar: true, mine }
  }
  /** Point (monde) sous le brouillard pour un joueur (le MJ voit tout). */
  function fogged(w) {
    if (ctx.me().isGM || !tools.fogOn()) return false
    const c = cam()
    return !target && tools.fogAt(Math.round((w.x * c.zoom + c.x) * devicePixelRatio), Math.round((w.y * c.zoom + c.y) * devicePixelRatio))
  }
  // Un joueur voit toujours le jeton de son propre personnage, même caché par le MJ ou sous le brouillard
  const visible = (t) => tokenScene(t) === sceneId() && (ctx.me().isGM || look(t).mine || (!look(t).hidden && !fogged(t)))

  /**
   * MJ : place le jeton d'un personnage ; s'il en a déjà un dans le même espace (le vaisseau, ou cette carte),
   * il est déplacé ici. Le vaisseau et chaque carte ont leurs propres jetons.
   */
  function placeCharacter(charId, world) {
    const c = characters.get(charId)
    if (!c) return
    const existing = [...tokens.entries()].find(([, t]) => t.charId === charId && space(tokenScene(t)) === space(sceneId()))
    const pos = { ...snapToken(world), scene: sceneId() }
    if (existing) tokens.set(existing[0], { ...existing[1], ...pos })
    else tokens.set(crypto.randomUUID(), { ...pos, charId, label: look({ charId }).label, color: look({ charId }).color })
  }

  canvas.addEventListener('dragover', (e) => {
    if (ctx.me().isGM && e.dataTransfer.types.includes(CHARACTER_MIME)) { e.preventDefault(); e.dataTransfer.dropEffect = 'copy' }
  })
  canvas.addEventListener('drop', (e) => {
    const id = e.dataTransfer.getData(CHARACTER_MIME)
    if (!id || !ctx.me().isGM) return
    e.preventDefault()
    const { sx, sy } = pointer(e)
    placeCharacter(id, toWorld(sx, sy))
  })

  function addToken(label) {
    const { width, height } = view()
    const center = snapToken(toWorld(width / 2, height / 2))
    tokens.set(crypto.randomUUID(), {
      x: center.x, y: center.y,
      color: COLORS[tokens.size % COLORS.length],
      label: label.slice(0, 3),
      scene: sceneId(),
    })
  }

  // ---------- Portes du vaisseau : niveau d'accréditation (modifiable par tous) ----------
  let popup = null // { el, id }

  function closeDoor() {
    popup?.el.remove()
    popup = null
  }

  /** Modifie un élément du plan (l'étage est d'abord copié depuis l'Excel s'il n'a jamais été modifié). */
  function setItem(id, { arc, ...it }) { // arc : calculé à l'affichage, jamais stocké
    ensureSeeded(it.deck)
    plan.set(id, it)
  }

  function openDoor(id, sx, sy) {
    closeDoor()
    const el = h('div', { class: 'door-popup' })
    popup = { el, id }
    renderDoor()
    canvas.parentElement.append(el)
    // Placée à côté du clic, sans sortir du plateau
    const { width, height } = view()
    el.style.left = `${Math.min(sx + 14, width - el.offsetWidth - 8)}px`
    el.style.top = `${Math.min(Math.max(8, sy - 20), height - el.offsetHeight - 8)}px`
  }

  function renderDoor() {
    if (!popup) return
    const { el, id } = popup
    const entries = deckEntries()
    const door = entries.find(([k]) => k === id)?.[1]
    if (!door) return closeDoor()
    const def = door.defaultLevel ?? door.level
    const color = (name) => BADGES.find((b) => b.name === name)?.color
    el.innerHTML = ''
    // Joueurs : seulement le niveau par défaut ; le niveau réel (réglé par le MJ) leur reste caché
    if (!ctx.me().isGM) {
      el.append(
        h('header', {}, h('b', {}, door.access ? 'Trappe technique' : 'Porte'), h('button', { class: 'icon', title: 'Fermer', onclick: closeDoor }, '×')),
        h('p', { class: 'door-rooms' }, roomsAround(g, entries, door).join('  ↔  ') || 'Accès'),
        h('p', { class: 'field' }, 'Accréditation requise : ', h('b', { style: `color:${color(def)}` }, `Badge ${def}`)),
        h('div', { class: 'door-badges' }, h('span', { class: 'muted' }, 'Ouvrent :'),
          DOOR_ACCESS[def].map((b) => h('i', { title: `Badge ${b}`, style: `--badge:${color(b)}` }))),
      )
      return
    }
    el.append(
      h('header', {}, h('b', {}, door.access ? 'Trappe technique' : 'Porte'), h('button', { class: 'icon', title: 'Fermer', onclick: closeDoor }, '×')),
      h('p', { class: 'door-rooms' }, roomsAround(g, entries, door).join('  ↔  ') || 'Accès'),
      h('label', { class: 'field' }, 'Accréditation requise',
        h('select', {
          style: `--badge:${color(door.level)}`,
          onchange: (e) => setItem(id, { ...door, level: e.target.value }),
        }, DOOR_LEVELS.map((l) => h('option', { value: l, selected: l === door.level }, `Badge ${l}`)))),
      h('div', { class: 'door-badges' }, h('span', { class: 'muted' }, 'Ouvrent :'),
        DOOR_ACCESS[door.level].map((b) => h('i', { title: `Badge ${b}`, style: `--badge:${color(b)}` }))),
      h('p', { class: 'muted door-default' }, `Par défaut : badge ${def}`,
        door.level !== def && h('button', { class: 'small', onclick: () => setItem(id, { ...door, level: def }) }, 'Rétablir')),
    )
  }

  /** MJ : applique `fn(porte) → niveau` à toutes les portes de tous les étages. */
  function setAllDoors(fn) {
    DECKS.forEach(ensureSeeded)
    doc.transact(() => plan.forEach((it, id) => {
      if (it.kind === 'door') plan.set(id, { ...it, level: fn(it) })
    }))
  }

  // ---------- Éditeurs (MJ) : plan du Gaïa, et dessin générique des cartes ----------
  const editor = setupPlanEditor({
    doc, plan, g: screen,
    deck: () => deck,
    entries: () => deckEntries(),
    ensureSeeded,
    zoom: () => cam().zoom,
    draw: () => draw(),
    stage: canvas.parentElement,
  })
  const mapEditor = setupPlanEditor({
    doc, plan: mapPlan, g: screen, generic: true,
    library: mapLibrary,
    viewCenter: () => { const { width, height } = view(); return toWorld(width / 2, height / 2) },
    pickImage: () => pickFile('image/*').then(async (file) => {
      if (!file) return null
      try {
        const img = await compressImage(file)
        const id = crypto.randomUUID()
        images.set(id, { type: img.type, data: img.data })
        return { id, width: img.width, height: img.height }
      } catch (err) { alert(`Impossible de lire cette image (${err.message}).`); return null }
    }),
    releaseImage,
    deck: () => mapScene(),
    entries: () => mapEntries(),
    ensureSeeded: () => {},
    zoom: () => cam().zoom,
    draw: () => draw(),
    stage: canvas.parentElement,
  })
  const ed = () => (mode === 'ship' ? editor : mapEditor)
  mapLibrary.observe(() => mapEditor.libraryChanged())

  /** Supprime une image partagée que plus rien n'utilise (fond de carte, image posée, modèle). */
  function releaseImage(id) {
    if (!id) return
    const used = [...scenes.values()].some((x) => x.image === id) ||
      [...mapPlan.values()].some((x) => x.image === id) ||
      [...mapLibrary.values()].some((m) => m.items.some(([, x]) => x.image === id))
    if (!used) images.delete(id)
  }
  /** Ouvre le sélecteur de fichiers ; résout avec le fichier choisi (ou null). */
  function pickFile(accept) {
    return new Promise((resolve) => {
      const input = h('input', { type: 'file', accept })
      input.addEventListener('change', () => resolve(input.files[0] ?? null))
      input.click()
    })
  }

  // ---------- Export / import d'une carte seule, export en image ----------
  const download = (blob, name) => {
    const a = h('a', { href: URL.createObjectURL(blob), download: name })
    a.click()
    setTimeout(() => URL.revokeObjectURL(a.href), 1000)
  }
  const fileName = (name) => (name || 'carte').replace(/[\\/:*?"<>|]+/g, '_')

  /** Fichier d'une carte : fond, dessins, images, jetons, gabarits, traits et brouillard. */
  function exportMap() {
    const id = sceneId()
    const sc = scenes.get(id) ?? scene()
    const items = Object.fromEntries([...mapPlan.entries()].filter(([, it]) => it.deck === id))
    const used = new Set([sc.image, ...Object.values(items).map((it) => it.image)].filter(Boolean))
    const imgs = {}
    used.forEach((k) => { const v = images.get(k); if (v) imgs[k] = { type: v.type, base64: toBase64(v.data) } })
    const pick = (name) => Object.fromEntries([...doc.getMap(name).entries()].filter(([, x]) => (x.scene ?? DEFAULT_SCENE) === id))
    const data = { starboardMap: 1, scene: sc, images: imgs, items, tokens: pick('tokens'), templates: pick('templates'), drawings: pick('drawings'), fog: pick('fog') }
    download(new Blob([JSON.stringify(data)], { type: 'application/json' }), `${fileName(sc.name)}.carte.json`)
  }
  /** Ouvre un fichier de carte comme nouvelle carte (nouveaux identifiants), affichée chez tout le monde. */
  function importMap(data) {
    const id = crypto.randomUUID()
    const ids = new Map()
    const nid = (k) => { if (!ids.has(k)) ids.set(k, crypto.randomUUID()); return ids.get(k) }
    const order = Math.max(0, ...[...scenes.values()].map((x) => x.order ?? 0)) + 1
    doc.transact(() => {
      ensureDefaultScene()
      Object.entries(data.images ?? {}).forEach(([k, v]) => { if (!images.has(k)) images.set(k, { type: v.type, data: fromBase64(v.base64) }) })
      scenes.set(id, { ...data.scene, order })
      Object.entries(data.items ?? {}).forEach(([k, it]) => mapPlan.set(nid(k), { ...it, deck: id, ...(it.host ? { host: nid(it.host) } : {}) }))
      for (const name of ['tokens', 'templates', 'drawings', 'fog']) {
        const m = doc.getMap(name)
        Object.values(data[name] ?? {}).forEach((x) => m.set(crypto.randomUUID(), { ...x, scene: id }))
      }
      board.set('scene', id)
    })
    cams[id] = undefined
  }
  async function openMapFile(file) {
    try {
      const data = JSON.parse(await file.text())
      if (!data.starboardMap) return alert('Ce fichier n’est pas une carte Starboard (fichier « .carte.json »).')
      importMap(data)
    } catch { alert('Fichier de carte illisible.') }
  }
  /** Image PNG de la carte (fond, dessins, grille, jetons ; sans brouillard ni calques masqués), 4096 px au plus. */
  function exportPNG() {
    const b = mapBounds()
    if (!b) return alert('La carte est vide.')
    const pad = 20
    const scale = Math.min(2, 4096 / Math.max(b.width, b.height))
    const off = document.createElement('canvas')
    off.width = Math.ceil(b.width * scale + pad * 2)
    off.height = Math.ceil(b.height * scale + pad * 2)
    target = { cam: { x: pad - b.x * scale, y: pad - b.y * scale, zoom: scale }, width: off.width, height: off.height }
    g = off.getContext('2d')
    try { draw() } finally { g = screen; target = null }
    off.toBlob((blob) => download(blob, `${fileName(scene().name)}.png`), 'image/png')
    draw()
  }

  // Règle, gabarits, crayon, brouillard
  const tools = setupMapTools({
    doc, me: ctx.me, stage: canvas.parentElement,
    mode: () => mode, sceneId: () => sceneId(), scene: () => scene(), cam: () => cam(),
    draw: () => draw(), patchScene: (c) => patchScene(c), renderSceneBar: () => renderBar(),
    canvasSize: () => ({ width: canvas.width, height: canvas.height }),
  })

  // Carte vide : « Importer une carte » (MJ : choisir une image de fond ; joueurs : simple mention)
  const placeholder = h('button', {
    class: 'map-placeholder', hidden: true,
    onclick: () => {
      if (!ctx.me().isGM) return
      pickFile('image/*,.json').then((file) => {
        if (!file) return
        if (file.name.endsWith('.json')) openMapFile(file)
        else setBackground(file)
      })
    },
  })
  canvas.parentElement.append(placeholder)
  const renderPlaceholder = () => {
    placeholder.disabled = !ctx.me().isGM
    placeholder.textContent = ctx.me().isGM ? 'Importer une carte' : 'Aucune carte pour l’instant'
    placeholder.title = ctx.me().isGM ? 'Choisir une image de fond ou un fichier de carte (.carte.json), ou dessiner la carte avec « ✎ Modifier la carte »' : ''
  }
  renderPlaceholder()

  // ---------- Barre des scènes ----------
  const sortedScenes = () => [...scenes.entries()].sort(([, a], [, b]) => (a.order ?? 0) - (b.order ?? 0))

  function ensureDefaultScene() {
    if (!scenes.has(DEFAULT_SCENE)) scenes.set(DEFAULT_SCENE, { name: 'Plateau', order: 0, image: null, grid: 50 })
  }

  function patchScene(changes) {
    ensureDefaultScene()
    scenes.set(sceneId(), { ...scenes.get(sceneId()), ...changes })
  }

  const chooseImage = () => pickFile('image/*').then((file) => file && setBackground(file))
  /** Image de fond de la carte affichée (compressée en WebP, partagée). */
  async function setBackground(file) {
    try {
      const img = await compressImage(file)
      const id = crypto.randomUUID()
      const old = scene().image
      doc.transact(() => {
        images.set(id, { type: img.type, data: img.data })
        patchScene({ image: id, width: img.width, height: img.height })
      })
      if (old && old !== id) releaseImage(old)
      cam().fitted = false
      const kb = Math.round(img.data.byteLength / 1024)
      if (kb > 3000) alert(`Image lourde (${kb} Ko) : la synchronisation peut prendre quelques secondes.`)
    } catch (err) {
      alert(`Impossible de lire cette image (${err.message}).`)
    }
  }

  function newScene() {
    const name = prompt('Nom de la nouvelle carte ?', 'Nouvelle carte')?.trim()
    if (!name) return
    const id = crypto.randomUUID()
    const order = Math.max(0, ...[...scenes.values()].map((s) => s.order ?? 0)) + 1
    doc.transact(() => {
      ensureDefaultScene()
      scenes.set(id, { name, order, image: null, grid: 50 })
      board.set('scene', id)
    })
  }

  function deleteScene() {
    const id = sceneId()
    if (id === DEFAULT_SCENE) return alert('La carte principale ne peut pas être supprimée.')
    if (!confirm(`Supprimer la carte « ${scene().name} », ses dessins et ses jetons ?`)) return
    mapEditor.setActive(false)
    doc.transact(() => {
      const img = scenes.get(id)?.image
      scenes.delete(id)
      if (img && ![...scenes.values()].some((s) => s.image === img)) images.delete(img)
      tokens.forEach((t, tid) => { if (tokenScene(t) === id) tokens.delete(tid) })
      const freed = []
      mapPlan.forEach((it, pid) => { if (it.deck === id) { mapPlan.delete(pid); if (it.image) freed.push(it.image) } })
      freed.forEach(releaseImage)
      tools.forgetScene(id)
      board.set('scene', DEFAULT_SCENE)
    })
  }

  function renderBar() {
    bar.innerHTML = ''
    if (mode === 'ship') {
      // Vue Vaisseau : choix de l'étage (local), pas de gestion de scènes ni de fond
      bar.append(h('span', { class: 'scene-name' }, 'Gaïa'), h('div', { class: 'seg' }, DECKS.map((d) => h('button', {
        class: d === deck ? 'on' : '',
        onclick: () => {
          deck = d
          closeDoor()
          try { localStorage.setItem('starboard:deck', d) } catch { /* stockage indisponible */ }
          lastScene = sceneId()
          if (!cam().fitted) fit()
          editor.deckChanged()
          renderBar()
          draw()
        },
      }, `Étage ${d.replace('-', '−')}`))))
      // MJ : niveau minimal pour toutes les portes (chaque porte garde son niveau par défaut s'il est plus élevé),
      // et mode modification du plan
      if (ctx.me().isGM) {
        const level = h('select', { title: 'Niveau à appliquer' }, DOOR_LEVELS.map((l) => h('option', { value: l }, `Badge ${l}`)))
        bar.append(h('span', { class: 'sep' }), h('span', { class: 'muted' }, 'Portes'), level,
          h('button', {
            class: 'small',
            title: 'Toutes les portes passent à ce niveau, sauf celles dont le niveau par défaut est plus élevé',
            onclick: () => setAllDoors((d) => stricterLevel(level.value, d.defaultLevel ?? d.level)),
          }, 'Appliquer à toutes'),
          h('button', {
            class: 'small danger',
            title: 'Rendre à toutes les portes leur niveau par défaut',
            onclick: () => { if (confirm('Remettre toutes les portes à leur niveau par défaut ?')) setAllDoors((d) => d.defaultLevel ?? d.level) },
          }, 'Réinitialiser'),
          h('span', { class: 'sep' }),
          h('button', {
            class: editor.active ? 'small primary' : 'small',
            title: 'Dessiner et modifier le plan (pièces, portes, caméras)',
            onclick: () => { closeDoor(); editor.setActive(!editor.active); renderBar() },
          }, editor.active ? 'Terminer' : '✎ Modifier le plan'))
      }
      return
    }
    const s = scene()
    const isGM = ctx.me().isGM
    const list = sortedScenes().filter(([id]) => !String(id).startsWith(SHIP_SCENE))
    bar.append(...[
      isGM && list.length
        ? h('select', { title: 'Carte ouverte chez tout le monde', onchange: (e) => board.set('scene', e.target.value) },
          list.map(([id, sc]) => h('option', { value: id, selected: id === sceneId() }, sc.name)))
        : h('span', { class: 'scene-name' }, s.name),
      isGM && h('button', { class: 'small', onclick: newScene }, '+ Carte'),
      isGM && h('button', {
        class: 'small', title: 'Ouvrir un fichier de carte (.carte.json) comme nouvelle carte',
        onclick: () => pickFile('.json').then((file) => file && openMapFile(file)),
      }, 'Ouvrir…'),
      isGM && h('button', {
        class: settingsOpen ? 'small primary' : 'small', title: 'Nom, fond, jetons, échelle, grille, export',
        onclick: () => { settingsOpen = !settingsOpen; renderSettings(); renderBar() },
      }, '⚙ Réglages'),
      isGM && h('span', { class: 'sep' }),
      isGM && h('button', {
        class: tools.fogOpen ? 'small primary' : 'small', title: 'Brouillard de guerre : cacher la carte et en révéler des zones',
        onclick: () => { mapEditor.setActive(false); settingsOpen = false; renderSettings(); tools.toggleFog(); renderBar() },
      }, '☁ Brouillard'),
      isGM && h('button', {
        class: mapEditor.active ? 'small primary' : 'small',
        title: 'Dessiner sur la carte (zones, portes, textes, images…)',
        onclick: () => { if (tools.fogOpen) tools.toggleFog(); settingsOpen = false; renderSettings(); mapEditor.setActive(!mapEditor.active); renderBar() },
      }, mapEditor.active ? 'Terminer' : '✎ Modifier la carte'),
    ].filter(Boolean))
  }

  // Réglages de la carte (MJ) : panneau sous la barre
  let settingsOpen = false
  const settings = h('div', { class: 'plan-tools map-settings' })
  const drawSettings = liveRender(settings, buildSettings)
  function renderSettings() {
    if (!settingsOpen || mode !== 'map' || !ctx.me().isGM) { settingsOpen = false; settings.remove(); return }
    if (!settings.isConnected) canvas.parentElement.append(settings)
    drawSettings()
  }
  function buildSettings() {
    const s = scene()
    const gr = grid()
    const num = (key, value, attrs = {}) => h('input', {
      type: 'number', step: 'any', class: 'short', value, ...attrs,
      onchange: (e) => patchScene({ [key]: Number(e.target.value) || 0 }),
    })
    const row = (label, ...kids) => h('label', { class: 'field' }, h('span', {}, label), h('div', { class: 'tool-row' }, ...kids))
    settings.append(...[
      h('h4', {}, 'Réglages de la carte'),
      row('Nom', h('input', { value: s.name ?? '', onchange: (e) => { const n = e.target.value.trim(); if (n) patchScene({ name: n }) } })),
      row('Fond',
        h('button', { class: 'small', onclick: chooseImage }, s.image ? 'Changer' : 'Choisir une image'),
        s.image && h('button', {
          class: 'small', title: 'Retirer l’image de fond (les dessins et les jetons restent)',
          onclick: () => {
            if (!confirm('Retirer l’image de fond de cette carte ?')) return
            const old = s.image
            patchScene({ image: null })
            releaseImage(old)
          },
        }, 'Retirer')),
      row('Taille des jetons (px)', num('grid', tokenSize(), { min: 4, max: 400 })),
      row('Échelle : 1 case =', num('unitPerCell', s.unitPerCell ?? 1, { min: 0.01 }),
        h('input', { class: 'short', value: s.unitName ?? 'cases', placeholder: 'unité', onchange: (e) => patchScene({ unitName: e.target.value.trim() || 'cases' }) })),
      row('Grille',
        h('select', { onchange: (e) => patchScene({ gridType: e.target.value }) },
          [['none', 'Aucune'], ['square', 'Carrée'], ['hex', 'Hexagonale']].map(([k, l]) => h('option', { value: k, selected: k === gr.type }, l))),
        gr.type !== 'none' && num('gridSize', gr.size, { min: 8, title: 'Taille d’une case (px)' })),
      gr.type !== 'none' && row('Décalage X / Y', num('gridX', gr.ox), num('gridY', gr.oy)),
      gr.type !== 'none' && h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: gr.snap, onchange: (e) => patchScene({ gridSnap: e.target.checked }) }), ' Aimanter les jetons au centre des cases'),
      row('Fichier',
        h('button', { class: 'small', title: 'Enregistrer cette carte seule (fond, dessins, jetons…) pour la rouvrir ailleurs', onclick: exportMap }, 'Exporter la carte'),
        h('button', { class: 'small', title: 'Image PNG de la carte (sans brouillard)', onclick: exportPNG }, 'Image PNG')),
      sceneId() !== DEFAULT_SCENE && h('button', { class: 'small danger', onclick: () => { settingsOpen = false; renderSettings(); deleteScene() } }, 'Supprimer la carte'),
    ].filter(Boolean))
  }

  // ---------- Synchronisation ----------
  let lastScene = sceneId()
  let lastImage = scene().image
  function onSceneChange() {
    if (sceneId() !== lastScene) {
      lastScene = sceneId()
      lastImage = scene().image
      mapEditor.deckChanged()
      if (!cam().fitted) fit()
    } else if (scene().image !== lastImage) {
      // Nouvelle carte sur la scène affichée : on recadre
      lastImage = scene().image
      fit()
    }
    renderBar()
    renderSettings()
    draw()
  }
  scenes.observe(onSceneChange)
  board.observe(onSceneChange)
  images.observe(draw)
  tokens.observe(draw)
  characters.observeDeep(draw) // nom, badge ou visibilité d'un personnage
  plan.observe(() => { draw(); renderDoor(); editor.refresh() })
  mapPlan.observe(() => { draw(); mapEditor.refresh() })

  addEventListener('resize', resize)
  document.getElementById('btn-fit').addEventListener('click', fit)
  document.getElementById('btn-zoom-in').addEventListener('click', () => { const { width, height } = view(); zoomAt(width / 2, height / 2, 1.25) })
  document.getElementById('btn-zoom-out').addEventListener('click', () => { const { width, height } = view(); zoomAt(width / 2, height / 2, 0.8) })

  resize()
  renderBar()

  // ---------- Recherche d'un personnage par son nom ----------
  const norm = (str) => str.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
  /** Personnages visibles pour moi dont le nom contient la recherche (début du nom en premier). */
  function matchCharacters(query) {
    const q = norm(query)
    if (!q) return []
    return [...characters.entries()]
      .filter(([id, c]) => ctx.me().isGM || !c.get('hidden') || look({ charId: id }).mine)
      .filter(([, c]) => norm(c.get('name')).includes(q))
      .sort(([, a], [, b]) => norm(b.get('name')).startsWith(q) - norm(a.get('name')).startsWith(q))
  }
  /**
   * Cherche le jeton d'un personnage. Renvoie { error } ou { view, tokenId } ;
   * l'appelant change d'onglet (view) puis appelle focusToken(tokenId).
   */
  function findToken(query) {
    const [match] = matchCharacters(query)
    if (!match) return { error: 'Aucun personnage à ce nom' }
    const [charId, c] = match
    // Jeton de l'onglet affiché d'abord (vaisseau ou carte ouverte), sinon n'importe lequel
    const all = [...tokens.entries()].filter(([, t]) => t.charId === charId)
    const here = (t) => (mode === 'ship' ? space(tokenScene(t)) === SHIP_SCENE : tokenScene(t) === mapScene())
    const entry = all.find(([, t]) => here(t)) ?? all.find(([, t]) => space(tokenScene(t)) === SHIP_SCENE) ?? all[0]
    if (!entry) return { error: `${c.get('name')} : pas de jeton posé` }
    const scene = tokenScene(entry[1])
    if (scene.startsWith(`${SHIP_SCENE}:`)) return { view: 'ship', tokenId: entry[0], name: c.get('name') }
    if (scene !== mapScene()) return { error: `${c.get('name')} est sur une scène non affichée (« ${scenes.get(scene)?.name ?? scene} »)` }
    return { view: 'map', tokenId: entry[0], name: c.get('name') }
  }
  /** Centre et zoome la vue sur un jeton (change d'étage si besoin). */
  function focusToken(tokenId) {
    const t = tokens.get(tokenId)
    if (!t) return
    const scene = tokenScene(t)
    if (mode === 'ship' && scene.startsWith(`${SHIP_SCENE}:`)) {
      deck = scene.slice(SHIP_SCENE.length + 1)
      try { localStorage.setItem('starboard:deck', deck) } catch { /* stockage indisponible */ }
      closeDoor()
      lastScene = sceneId()
      editor.deckChanged()
      renderBar()
    }
    const { width, height } = view()
    const c = cam()
    c.zoom = Math.min(ZOOM_MAX, Math.max(c.zoom, 1.5))
    c.x = width / 2 - t.x * c.zoom
    c.y = height / 2 - t.y * c.zoom
    c.fitted = true
    flash = { id: tokenId, until: performance.now() + 1500 }
    draw()
    setTimeout(draw, 1550)
  }

  return {
    addToken,
    matchCharacters,
    findToken,
    focusToken,
    rerender() {
      if (!ctx.me().isGM) { editor.setActive(false); mapEditor.setActive(false) } // l'édition est réservée au MJ
      renderPlaceholder()
      tools.rerender()
      renderSettings()
      renderBar()
      renderDoor()
      draw()
    },
    /** Change d'onglet : 'ship' (Vaisseau) ou 'map' (Carte). */
    setMode(m) {
      mode = m === 'map' ? 'map' : 'ship'
      closeDoor()
      if (mode !== 'ship' && editor.active) editor.setActive(false)
      if (mode !== 'map' && mapEditor.active) mapEditor.setActive(false)
      tools.rerender()
      renderSettings()
      lastScene = sceneId()
      lastImage = scene().image
      if (!cam().fitted) fit()
      renderBar()
      draw()
    },
    /** Données à exporter (images encodées en base64 dans le JSON). */
    snapToken,
    exportData() {
      const imgs = {}
      images.forEach((v, id) => { imgs[id] = { type: v.type, base64: toBase64(v.data) } })
      return { scenes: scenes.toJSON(), images: imgs, board: board.toJSON() }
    },
    importData({ scenes: sc, images: imgs, board: b }) {
      doc.transact(() => {
        if (sc) { scenes.clear(); Object.entries(sc).forEach(([id, v]) => scenes.set(id, v)) }
        if (imgs) {
          images.clear()
          Object.entries(imgs).forEach(([id, v]) => images.set(id, { type: v.type, data: fromBase64(v.base64) }))
        }
        if (b) { board.clear(); Object.entries(b).forEach(([k, v]) => board.set(k, v)) }
      })
      bitmaps.clear()
      Object.values(cams).forEach((c) => { c.fitted = false })
      fit()
    },
  }
}

function toBase64(bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000))
  return btoa(s)
}
function fromBase64(b64) {
  return Uint8Array.from(atob(b64), (c) => c.charCodeAt(0))
}

/** Couleur claire ? (pour choisir un texte sombre ou clair sur le jeton) */
function isLight(hex) {
  const n = Number.parseInt(String(hex).replace('#', ''), 16)
  return 0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255) > 140
}
