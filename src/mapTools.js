import { h } from './dom.js'
import { CELL } from './shipMap.js'

// Outils de jeu du plateau : règle, gabarits de zone, crayon (tous les joueurs, onglets Vaisseau et Carte),
// et brouillard de guerre (MJ, onglet Carte).
//
// Données partagées (Y.Doc) :
//   templates : id → { scene, kind ('circle' | 'cone' | 'line'), x, y, x2, y2, color, owner }  (gabarits)
//   drawings  : id → { scene, pts: [[x, y]…], color, width, owner }                           (crayon)
//   pings     : id → { scene, x, y, color, owner }  (repère d'alerte, effacé par son auteur après quelques secondes)
//   fog       : id → { scene, t, mode ('reveal' | 'hide'), kind ('rect' | 'brush' | 'all'), x, y, w, h | pts, r }
//               opérations appliquées dans l'ordre de t sur une carte d'abord entièrement couverte
//   scenes[id] : fog (brouillard actif), unitPerCell, unitName (échelle de la règle)
// La règle reste locale (seul celui qui mesure la voit).
// Rien n'est réellement secret : les zones cachées par le brouillard sont dans le Y.Doc de chacun.

const FOG = '#04060d'
const CONE = Math.PI / 3 // ouverture d'un cône (60°)
const MEASURE_TOOLS = [
  ['ruler', '📏', 'Règle : glisser pour mesurer une distance (visible par vous seul)'],
  ['circle', '◯', 'Gabarit circulaire : glisser du centre vers le bord (visible par tous)'],
  ['cone', '◸', 'Gabarit en cône : glisser depuis la pointe (visible par tous)'],
  ['line', '━', 'Gabarit en ligne, une case de large : glisser du départ à l’arrivée (visible par tous)'],
  ['pencil', '✏', 'Crayon : dessiner à main levée (visible par tous)'],
  ['ping', '📍', 'Signaler : cliquer pour faire clignoter un point chez tout le monde'],
]
const PING_MS = 3000
const FOG_TOOLS = [
  ['reveal-rect', '▭ Révéler', 'Révéler un rectangle'],
  ['reveal-brush', '● Révéler', 'Révéler au pinceau'],
  ['hide-rect', '▭ Recouvrir', 'Recouvrir un rectangle'],
  ['hide-brush', '● Recouvrir', 'Recouvrir au pinceau'],
]

const store = {
  get: (k, d) => { try { return localStorage.getItem(k) ?? d } catch { return d } },
  set: (k, v) => { try { localStorage.setItem(k, v) } catch { /* stockage indisponible */ } },
}
const fmt = (v) => v.toLocaleString('fr-FR', { maximumFractionDigits: 1 })
const distToSeg = (x, y, [x1, y1], [x2, y2]) => {
  const dx = x2 - x1
  const dy = y2 - y1
  const l = dx * dx + dy * dy
  const t = l ? Math.max(0, Math.min(1, ((x - x1) * dx + (y - y1) * dy) / l)) : 0
  return Math.hypot(x - x1 - t * dx, y - y1 - t * dy)
}

/** ctx : { doc, me(), stage, mode(), sceneId(), scene(), cam(), draw(), patchScene(changes) } */
export function setupMapTools(ctx) {
  const templates = ctx.doc.getMap('templates')
  const drawings = ctx.doc.getMap('drawings')
  const fog = ctx.doc.getMap('fog')
  const pings = ctx.doc.getMap('pings')
  const pingSeen = new Map() // id → instant de réception (horloge locale : les horloges des joueurs diffèrent)

  let tool = null // outil de mesure / dessin actif
  let fogTool = null // outil de brouillard actif (MJ), panneau ouvert
  let color = store.get('starboard:toolColor', '#ffd84a')
  let brush = Number(store.get('starboard:fogBrush', 80))
  let drag = null // { from, to, pts } : geste en cours

  const isGM = () => ctx.me().isGM
  const here = (x) => x.scene === ctx.sceneId()
  const mine = (x) => x.owner === ctx.me().name

  // ---------- Échelle ----------
  const unit = () => (ctx.mode() === 'map'
    ? { per: Number(ctx.scene().unitPerCell) || 1, name: ctx.scene().unitName || 'cases' }
    : { per: 1, name: 'cases' })
  // Une « case » = celle de la grille de la carte si elle en a une
  const cell = () => (ctx.mode() === 'map' && (ctx.scene().gridType ?? 'none') !== 'none' ? Number(ctx.scene().gridSize) || CELL : CELL)
  const measure = (len) => `${fmt((len / cell()) * unit().per)} ${unit().name}`

  // ---------- Brouillard ----------
  const fogOn = () => ctx.mode() === 'map' && !!ctx.scene().fog
  const off = document.createElement('canvas')
  const og = off.getContext('2d', { willReadFrequently: true })

  /** Calcule le calque de brouillard (repère écran, même transformation que le plateau). */
  function renderFog(transform) {
    const { width, height } = ctx.canvasSize()
    if (off.width !== width) off.width = width
    if (off.height !== height) off.height = height
    og.setTransform(1, 0, 0, 1, 0, 0)
    og.globalCompositeOperation = 'source-over'
    og.fillStyle = FOG
    og.fillRect(0, 0, width, height)
    og.setTransform(transform)
    // ponytail: toutes les opérations rejouées à chaque image ; fusionner en image si une carte en accumule des milliers
    const ops = [...fog.values()].filter(here).sort((a, b) => a.t - b.t)
    for (const op of ops) {
      og.globalCompositeOperation = op.mode === 'reveal' ? 'destination-out' : 'source-over'
      og.fillStyle = og.strokeStyle = FOG
      if (op.kind === 'all') {
        og.save(); og.setTransform(1, 0, 0, 1, 0, 0); og.fillRect(0, 0, width, height); og.restore()
      } else if (op.kind === 'rect') og.fillRect(op.x, op.y, op.w, op.h)
      else if (op.kind === 'brush') strokePts(og, op.pts, op.r * 2)
    }
    og.globalCompositeOperation = 'source-over'
  }
  /** Point écran (pixels de l'appareil) recouvert par le brouillard ? */
  const fogAt = (dx, dy) => fogOn() && dx >= 0 && dy >= 0 && dx < off.width && dy < off.height && og.getImageData(dx, dy, 1, 1).data[3] > 128

  function strokePts(g, pts, width) {
    g.lineWidth = width
    g.lineCap = 'round'
    g.lineJoin = 'round'
    g.beginPath()
    pts.forEach(([x, y], i) => (i ? g.lineTo(x, y) : g.moveTo(x, y)))
    if (pts.length === 1) g.lineTo(pts[0][0] + 0.01, pts[0][1])
    g.stroke()
  }

  // ---------- Dessin ----------
  function drawTemplate(g, t, zoom) {
    const len = Math.hypot(t.x2 - t.x, t.y2 - t.y)
    const a = Math.atan2(t.y2 - t.y, t.x2 - t.x)
    g.save()
    g.fillStyle = `${t.color}40`
    g.strokeStyle = t.color
    g.lineWidth = 2 / zoom
    g.beginPath()
    if (t.kind === 'circle') g.arc(t.x, t.y, len, 0, Math.PI * 2)
    else if (t.kind === 'cone') { g.moveTo(t.x, t.y); g.arc(t.x, t.y, len, a - CONE / 2, a + CONE / 2); g.closePath() }
    else {
      const w = CELL / 2
      const nx = -Math.sin(a) * w
      const ny = Math.cos(a) * w
      g.moveTo(t.x + nx, t.y + ny); g.lineTo(t.x2 + nx, t.y2 + ny); g.lineTo(t.x2 - nx, t.y2 - ny); g.lineTo(t.x - nx, t.y - ny); g.closePath()
    }
    g.fill()
    g.stroke()
    label(g, t.kind === 'circle' ? `r = ${measure(len)}` : measure(len), t.kind === 'circle' ? t.x : (t.x + t.x2) / 2, t.kind === 'circle' ? t.y : (t.y + t.y2) / 2, zoom)
    g.restore()
  }
  function label(g, text, x, y, zoom) {
    g.save()
    g.font = `600 ${13 / zoom}px "Segoe UI", system-ui`
    g.textAlign = 'center'
    g.textBaseline = 'middle'
    const w = g.measureText(text).width + 10 / zoom
    g.fillStyle = 'rgba(5, 7, 15, 0.85)'
    g.fillRect(x - w / 2, y - 10 / zoom, w, 20 / zoom)
    g.fillStyle = '#eaf6ff'
    g.fillText(text, x, y)
    g.restore()
  }

  /** Sous les jetons : gabarits et dessins de la scène. */
  function drawUnder(g, zoom) {
    for (const d of drawings.values()) {
      if (!here(d)) continue
      g.strokeStyle = d.color
      strokePts(g, d.pts, d.width)
    }
    for (const t of templates.values()) if (here(t)) drawTemplate(g, t, zoom)
  }

  /** Brouillard (après les dessins, avant les jetons) : opaque pour les joueurs, voilé pour le MJ. */
  function drawFog(g, transform) {
    if (!fogOn()) return
    renderFog(transform)
    g.save()
    g.setTransform(1, 0, 0, 1, 0, 0)
    g.globalAlpha = isGM() ? 0.5 : 1
    g.drawImage(off, 0, 0)
    g.restore()
  }

  /** Au-dessus de tout : geste en cours (règle, aperçu de gabarit, trait, rectangle de brouillard). */
  function drawPings(g, zoom) {
    const now = performance.now()
    let live = false
    for (const [id, p] of pings.entries()) {
      if (!here(p)) continue
      if (!pingSeen.has(id)) pingSeen.set(id, now)
      const age = (now - pingSeen.get(id)) / PING_MS
      if (age > 1) continue
      live = true
      g.save()
      g.strokeStyle = g.fillStyle = p.color
      for (let i = 0; i < 3; i++) { // trois ondes qui s'élargissent
        const k = (age * 2 + i / 3) % 1
        g.globalAlpha = (1 - k) * (1 - age * 0.5)
        g.lineWidth = 3 / zoom
        g.beginPath(); g.arc(p.x, p.y, (8 + k * 50) / zoom, 0, Math.PI * 2); g.stroke()
      }
      g.globalAlpha = 1
      g.beginPath(); g.arc(p.x, p.y, 5 / zoom, 0, Math.PI * 2); g.fill()
      g.restore()
    }
    if (live) requestAnimationFrame(() => ctx.draw())
  }

  function drawAbove(g, zoom) {
    drawPings(g, zoom)
    if (!drag) return
    const { from, to } = drag
    g.save()
    if (fogTool) {
      g.strokeStyle = fogTool.startsWith('reveal') ? '#9dff4a' : '#ff5a5a'
      g.lineWidth = 2 / zoom
      g.setLineDash([6 / zoom, 4 / zoom])
      if (fogTool.endsWith('rect')) g.strokeRect(from.x, from.y, to.x - from.x, to.y - from.y)
      else { g.globalAlpha = 0.5; strokePts(g, drag.pts, brush * 2) }
    } else if (tool === 'ruler') {
      g.strokeStyle = '#ffd84a'
      g.lineWidth = 3 / zoom
      g.setLineDash([8 / zoom, 5 / zoom])
      g.beginPath(); g.moveTo(from.x, from.y); g.lineTo(to.x, to.y); g.stroke()
      g.setLineDash([])
      g.fillStyle = '#ffd84a'
      for (const p of [from, to]) { g.beginPath(); g.arc(p.x, p.y, 4 / zoom, 0, Math.PI * 2); g.fill() }
      label(g, measure(Math.hypot(to.x - from.x, to.y - from.y)), to.x, to.y - 18 / zoom, zoom)
    } else if (tool === 'pencil') {
      g.strokeStyle = color
      strokePts(g, drag.pts, 3 / zoom)
    } else {
      drawTemplate(g, { kind: tool, x: from.x, y: from.y, x2: to.x, y2: to.y, color }, zoom)
    }
    g.restore()
  }

  // ---------- Souris (le plateau appelle ces fonctions quand active() est vrai) ----------
  const active = () => !!(fogTool || tool)
  function pointerDown(w) {
    if (tool === 'ping') {
      const id = crypto.randomUUID()
      pings.set(id, { scene: ctx.sceneId(), x: w.x, y: w.y, color, owner: ctx.me().name })
      setTimeout(() => pings.delete(id), PING_MS + 500)
      return
    }
    drag = { from: w, to: w, pts: [[w.x, w.y]] }
    ctx.draw()
  }
  function pointerMove(w) {
    if (!drag) return
    drag.to = w
    const last = drag.pts.at(-1)
    if (Math.hypot(w.x - last[0], w.y - last[1]) > 3 / ctx.cam().zoom) drag.pts.push([Math.round(w.x), Math.round(w.y)])
    ctx.draw()
  }
  function pointerUp() {
    if (!drag) return
    const { from, to, pts } = drag
    drag = null
    const scene = ctx.sceneId()
    const big = Math.hypot(to.x - from.x, to.y - from.y) > 4 / ctx.cam().zoom
    if (fogTool) {
      const mode = fogTool.startsWith('reveal') ? 'reveal' : 'hide'
      const op = fogTool.endsWith('rect')
        ? big && { kind: 'rect', x: Math.min(from.x, to.x), y: Math.min(from.y, to.y), w: Math.abs(to.x - from.x), h: Math.abs(to.y - from.y) }
        : { kind: 'brush', pts, r: brush }
      if (op) fog.set(crypto.randomUUID(), { scene, t: Date.now(), mode, ...op })
    } else if (tool === 'pencil') {
      drawings.set(crypto.randomUUID(), { scene, pts, color, width: Math.max(1, 3 / ctx.cam().zoom), owner: ctx.me().name })
    } else if (tool !== 'ruler' && big) {
      templates.set(crypto.randomUUID(), { scene, kind: tool, x: from.x, y: from.y, x2: to.x, y2: to.y, color, owner: ctx.me().name })
    }
    ctx.draw()
  }

  /** Double-clic : efface le gabarit ou le trait sous le pointeur (le sien, ou n'importe lequel pour le MJ). */
  function dblclick(w) {
    const can = (x) => here(x) && (isGM() || mine(x))
    const tol = 8 / ctx.cam().zoom
    for (const [id, d] of drawings.entries()) {
      if (can(d) && d.pts.some((p, i) => distToSeg(w.x, w.y, p, d.pts[i + 1] ?? p) <= tol + d.width / 2)) { drawings.delete(id); return true }
    }
    for (const [id, t] of templates.entries()) {
      if (!can(t)) continue
      const len = Math.hypot(t.x2 - t.x, t.y2 - t.y)
      const d = Math.hypot(w.x - t.x, w.y - t.y)
      const a = Math.abs(((Math.atan2(w.y - t.y, w.x - t.x) - Math.atan2(t.y2 - t.y, t.x2 - t.x) + Math.PI * 3) % (Math.PI * 2)) - Math.PI)
      const inside = t.kind === 'circle' ? d <= len
        : t.kind === 'cone' ? d <= len && a <= CONE / 2
          : distToSeg(w.x, w.y, [t.x, t.y], [t.x2, t.y2]) <= CELL / 2
      if (inside) { templates.delete(id); return true }
    }
    return false
  }

  /** Efface ses gabarits et dessins de la scène (le MJ : tous). */
  function clearMine() {
    const scene = ctx.sceneId()
    const can = (x) => x.scene === scene && (isGM() || mine(x))
    ctx.doc.transact(() => {
      for (const [id, x] of [...templates.entries()]) if (can(x)) templates.delete(id)
      for (const [id, x] of [...drawings.entries()]) if (can(x)) drawings.delete(id)
    })
  }

  // ---------- Barres d'outils ----------
  const bar = h('div', { class: 'tools-bar' })
  ctx.stage.append(bar)
  function renderBar() {
    bar.innerHTML = ''
    bar.append(
      ...MEASURE_TOOLS.map(([k, icon, title]) => h('button', {
        class: `small${tool === k ? ' primary' : ''}`, title,
        onclick: () => { tool = tool === k ? null : k; fogTool = null; renderBar(); renderFogPanel() },
      }, icon)),
      h('input', {
        type: 'color', value: color, title: 'Couleur des gabarits et du crayon',
        onchange: (e) => { color = e.target.value; store.set('starboard:toolColor', color) },
      }),
      h('button', {
        class: 'small', title: isGM() ? 'Effacer tous les gabarits et dessins de cette scène' : 'Effacer vos gabarits et dessins de cette scène (double-clic : en effacer un)',
        onclick: () => { if (!isGM() || confirm('Effacer tous les gabarits et dessins de cette scène ?')) clearMine() },
      }, 'Effacer'),
    )
  }

  // Brouillard (MJ) : panneau ouvert depuis la barre de la carte
  const panel = h('div', { class: 'plan-tools fog-panel' })
  function renderFogPanel() {
    panel.remove()
    if (!fogTool || !isGM() || ctx.mode() !== 'map') { fogTool = null; return }
    panel.innerHTML = ''
    const all = (mode) => ctx.doc.transact(() => {
      for (const [id, op] of [...fog.entries()]) if (here(op)) fog.delete(id)
      if (mode === 'reveal') fog.set(crypto.randomUUID(), { scene: ctx.sceneId(), t: Date.now(), mode, kind: 'all' })
    })
    panel.append(
      h('h4', {}, 'Brouillard de guerre'),
      h('label', { class: 'check' },
        h('input', { type: 'checkbox', checked: !!ctx.scene().fog, onchange: (e) => ctx.patchScene({ fog: e.target.checked }) }),
        ' Actif sur cette carte'),
      h('div', { class: 'tool-row' }, FOG_TOOLS.map(([k, l, title]) => h('button', {
        class: `small${fogTool === k ? ' primary' : ''}`, title,
        onclick: () => { fogTool = k; renderFogPanel() },
      }, l))),
      h('label', { class: 'field' }, h('span', {}, `Pinceau (${brush} px)`), h('input', {
        type: 'range', min: 10, max: 400, step: 10, value: brush,
        onchange: (e) => { brush = Number(e.target.value); store.set('starboard:fogBrush', brush); renderFogPanel() },
      })),
      h('div', { class: 'tool-row' },
        h('button', { class: 'small', onclick: () => all('reveal') }, 'Tout révéler'),
        h('button', { class: 'small danger', onclick: () => { if (confirm('Recouvrir toute la carte ?')) all('hide') } }, 'Tout recouvrir')),
      h('p', { class: 'hint' }, 'Les joueurs ne voient ni la carte ni les jetons sous le brouillard (sauf le leur). Vous le voyez en transparence.'),
      h('button', { class: 'small', onclick: () => { fogTool = null; renderFogPanel(); ctx.renderSceneBar() } }, 'Fermer'),
    )
    ctx.stage.append(panel)
  }

  templates.observe(() => ctx.draw())
  drawings.observe(() => ctx.draw())
  fog.observe(() => ctx.draw())
  pings.observe(() => ctx.draw())
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && (tool || drag)) { tool = null; drag = null; renderBar(); ctx.draw() }
  })
  renderBar()

  return {
    active, pointerDown, pointerMove, pointerUp, dblclick,
    drawUnder, drawFog, drawAbove, fogAt, fogOn,
    get fogOpen() { return !!fogTool },
    toggleFog() { fogTool = fogTool ? null : 'reveal-rect'; tool = null; renderBar(); renderFogPanel() },
    rerender() { renderBar(); renderFogPanel() },
    /** Suppression d'une scène : ses gabarits, dessins et brouillard. */
    forgetScene(id) {
      for (const m of [templates, drawings, fog]) for (const [k, x] of [...m.entries()]) if (x.scene === id) m.delete(k)
    },
  }
}
