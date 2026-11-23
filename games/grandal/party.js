// Grandal : espace « Aventuriers » (6 vignettes) et onglet « Fiches ».
// - Vignettes : résumé du statut de 6 personnages (nom, joueur, PV, mana), de même taille, sans défilement.
// - Chaque vignette a un bouton qui ouvre l'onglet Fiches en mode choix : on y désigne le personnage affiché.
// Données partagées (dans le Y.Doc, synchronisées et exportées) :
//   doc.getMap('partySlots')  : '0' … '5' → id du personnage affiché dans la vignette
//   doc.getMap('status')      : '<id>|hp', '<id>|hpMax', '<id>|mana', '<id>|manaMax' → nombre
//     (une clé par valeur : deux joueurs qui changent l'un les PV, l'autre le mana ne s'écrasent pas)
// Les fiches elles-mêmes restent celles de src/sheets.js (doc.getMap('characters')), ouvertes avec sheets.open(id).
import { h, liveRender } from '../../src/dom.js'
import { ownerOf } from '../../src/rules.js'
import { CHARACTER_MIME } from '../../src/sheets.js'

export const SLOTS = 6
const STATUS = [
  { key: 'hp', label: 'PV', title: 'Points de vie', max: 'hpMax', def: 10 },
  { key: 'mana', label: 'Mana', title: 'Mana', max: 'manaMax', def: 10 },
]

/** ctx : { doc, me() → { name, isGM }, sheets, setView(view) } */
export function setupParty(ctx) {
  const characters = ctx.doc.getMap('characters')
  const slots = ctx.doc.getMap('partySlots')
  const status = ctx.doc.getMap('status')
  const tilesEl = document.getElementById('party-tiles')
  const gridEl = document.getElementById('roster-grid')
  const pickEl = document.getElementById('roster-pick')
  let picking = null // vignette en cours de choix (0 … 5), ou null

  // Mêmes règles que src/sheets.js : un joueur voit les fiches visibles et la sienne ; modifie la sienne ou un PNJ
  const ownerName = (c) => ownerOf(c.get('name'), c.get('player'))
  const isMine = (c) => ownerName(c).toLowerCase() === ctx.me().name.toLowerCase()
  const canSee = (c) => ctx.me().isGM || !c.get('hidden') || isMine(c)
  const canEdit = (c) => ctx.me().isGM || !ownerName(c) || isMine(c)

  const value = (id, key, def) => { const v = status.get(`${id}|${key}`); return typeof v === 'number' ? v : def }
  const setValue = (id, key, n) => { if (Number.isFinite(n)) status.set(`${id}|${key}`, Math.max(0, Math.round(n))) }
  const slotOf = (id) => [...slots.entries()].filter(([, v]) => v === id).map(([k]) => Number(k))

  // ---------- Vignettes ----------
  function bar(id, s) {
    const max = value(id, s.max, s.def)
    const cur = Math.min(value(id, s.key, max), max)
    const pct = max > 0 ? Math.round((cur / max) * 100) : 0
    return h('div', { class: `tile-stat stat-${s.key}`, title: `${s.title} : ${cur} / ${max}` },
      h('span', { class: 'tile-stat-label' }, s.label),
      h('span', { class: 'tile-bar' }, h('i', { style: `width:${pct}%` })),
      h('span', { class: 'tile-stat-value' }, `${cur}/${max}`))
  }

  function tile(i) {
    const id = slots.get(String(i))
    const c = id && characters.get(id)
    const isGM = ctx.me().isGM
    // Choix du personnage d'une vignette : réservé au MJ
    const choose = (label, cls) => isGM && h('button', {
      class: `small ${cls}`,
      title: "Choisir l'aventurier de cette vignette (onglet Fiches)",
      onclick: (e) => { e.stopPropagation(); pick(i) },
    }, label)

    // Vignette sans aventurier (ou fiche cachée à ce joueur) : un simple emplacement orné, sans texte ;
    // le MJ y voit en plus le bouton pour la remplir
    if (!c || !canSee(c)) {
      return h('article', { class: `tile vacant${isGM ? ' gm' : ''}`, 'aria-label': `Emplacement ${i + 1} libre` },
        h('span', { class: 'tile-ornament', 'aria-hidden': 'true' }, '❦'),
        choose('+ Aventurier', 'tile-fill'))
    }
    const canDrag = isGM || isMine(c)
    return h('article', {
      class: `tile${c.get('hidden') ? ' is-hidden' : ''}${isMine(c) ? ' mine' : ''}`,
      title: canDrag ? 'Cliquer : ouvrir la fiche · Glisser sur la carte : placer son jeton' : 'Cliquer : ouvrir la fiche',
      onclick: () => ctx.sheets.open(id),
      draggable: canDrag,
      ondragstart: canDrag && ((e) => { e.dataTransfer.setData(CHARACTER_MIME, id); e.dataTransfer.effectAllowed = 'copy' }),
    },
    h('header', { class: 'tile-head' },
      h('span', { class: 'tile-name' }, c.get('name') || 'Sans nom'),
      choose('⇄', 'tile-choose')),
    STATUS.map((s) => bar(id, s)))
  }

  function renderTiles() {
    tilesEl.replaceChildren(...Array.from({ length: SLOTS }, (_, i) => tile(i)))
  }

  // ---------- Onglet Fiches ----------
  function pick(i) {
    if (!ctx.me().isGM) return
    picking = i
    ctx.setView('roster')
    renderRoster()
  }
  function cancelPick() {
    picking = null
    renderRoster()
  }
  function assign(i, id) {
    if (!ctx.me().isGM) return
    ctx.doc.transact(() => {
      for (const k of slotOf(id)) slots.delete(String(k)) // un personnage n'occupe qu'une vignette
      if (id) slots.set(String(i), id)
      else slots.delete(String(i))
    })
    picking = null
    ctx.setView('map')
  }

  function statusEditor(id, c) {
    const edit = canEdit(c)
    return h('div', { class: 'roster-status' }, STATUS.map((s) => {
      const max = value(id, s.max, s.def)
      const cur = Math.min(value(id, s.key, max), max)
      return h('label', { class: `roster-stat stat-${s.key}`, title: s.title },
        h('span', {}, s.label),
        edit
          // Plafond relu au moment d'écrire : le maximum a pu changer entre-temps (autre joueur, autre champ)
          ? [h('input', { type: 'number', min: 0, class: 'num', value: cur, onchange: (e) => setValue(id, s.key, Math.min(Number(e.target.value), value(id, s.max, s.def))) }),
            h('span', { class: 'muted' }, '/'),
            h('input', { type: 'number', min: 0, class: 'num', value: max, onchange: (e) => setValue(id, s.max, Number(e.target.value)) })]
          : h('b', {}, `${cur} / ${max}`))
    }))
  }

  function card(id, c) {
    const owner = ownerName(c)
    const inSlots = slotOf(id)
    return h('article', { class: `roster-card${c.get('hidden') ? ' is-hidden' : ''}${picking != null && slots.get(String(picking)) === id ? ' current' : ''}` },
      h('header', {},
        h('h3', {}, c.get('name') || 'Sans nom'),
        owner && h('span', { class: 'muted' }, owner),
        inSlots.length > 0 && h('span', { class: 'roster-chip' }, `Vignette ${inSlots.map((k) => k + 1).join(', ')}`),
        c.get('hidden') && h('span', { class: 'roster-chip hidden-chip' }, 'Cachée')),
      statusEditor(id, c),
      h('div', { class: 'roster-actions' },
        picking != null && ctx.me().isGM && h('button', { class: 'primary', onclick: () => assign(picking, id) }, `Afficher dans la vignette ${picking + 1}`),
        h('button', { onclick: () => ctx.sheets.open(id) }, 'Ouvrir la fiche')))
  }

  const renderRoster = liveRender(gridEl, () => {
    // Bandeau du mode choix
    pickEl.hidden = picking == null
    pickEl.replaceChildren(...(picking == null ? [] : [
      h('span', {}, `Vignette ${picking + 1} : choisis l'aventurier à y afficher.`),
      slots.has(String(picking)) && h('button', { onclick: () => assign(picking, null) }, 'Vider la vignette'),
      h('button', { onclick: () => { cancelPick(); ctx.setView('map') } }, 'Annuler'),
    ].filter(Boolean)))

    const entries = [...characters.entries()].filter(([, c]) => canSee(c))
      .sort(([, a], [, b]) => (a.get('name') || '').localeCompare(b.get('name') || ''))
    if (!entries.length) gridEl.append(h('p', { class: 'muted roster-empty' }, 'Aucune fiche pour l’instant : « + Fiche » pour créer un aventurier.'))
    for (const [id, c] of entries) gridEl.append(card(id, c))
  })

  const renderAll = () => { renderTiles(); renderRoster() }
  characters.observeDeep(renderAll)
  slots.observe(renderAll)
  status.observe(renderAll)
  renderAll()

  return {
    rerender() {
      if (!ctx.me().isGM) picking = null // le choix des vignettes est réservé au MJ
      renderAll()
    },
    /** Appelé quand on quitte l'onglet Fiches : le mode choix s'arrête */
    leaveRoster() { if (picking != null) cancelPick() },
  }
}
