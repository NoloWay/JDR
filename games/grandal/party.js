// Grandal : espace « Aventuriers » (6 vignettes) et onglet « Fiches ».
// - Vignettes : résumé du statut de 6 personnages (nom, joueur, PV, mana), de même taille, sans défilement.
// - Chaque vignette a un bouton qui ouvre l'onglet Fiches en mode choix : on y désigne le personnage affiché.
// Données partagées (dans le Y.Doc, synchronisées et exportées) :
//   doc.getMap('partySlots')  : '0' … '5' → id du personnage affiché dans la vignette
//   doc.getMap('status')      : '<id>|hp', '<id>|hpMax', '<id>|mana', '<id>|manaMax' → nombre
//     (une clé par valeur : deux joueurs qui changent l'un les PV, l'autre le mana ne s'écrasent pas)
// Le reste du statut (SPD, EP, SS, SP) : status.js.
// Les fiches elles-mêmes restent celles de src/sheets.js (doc.getMap('characters')), ouvertes avec sheets.open(id).
import { h, liveRender } from '../../src/dom.js'
import { CHARACTER_MIME } from '../../src/sheets.js'
import { setupStatus, statusViews, RES } from './status.js'

export const SLOTS = 6
const STATUS = [RES.hp, RES.mp] // HP (peuvent descendre jusqu'à −maximum) et MP : mêmes données que la fiche (status.js)

/** ctx : { doc, me() → { name, isGM }, sheets, setView(view), ownerOf(nom, joueur), profiles (presence.js) } */
export function setupParty(ctx) {
  const characters = ctx.doc.getMap('characters')
  const slots = ctx.doc.getMap('partySlots')
  const st = setupStatus(ctx.doc)
  const statusUi = statusViews(st)
  const status = st.status
  const portraits = ctx.doc.getMap('portraits')
  // Adresses des images (une par image, libérée quand l'image change)
  const urls = new Map()
  function portraitUrl(id) {
    const pt = portraits.get(id)
    const cached = urls.get(id)
    if (cached && (!pt || cached.data !== pt.data)) { URL.revokeObjectURL(cached.url); urls.delete(id) }
    if (!pt) return null
    if (!urls.has(id)) urls.set(id, { data: pt.data, url: URL.createObjectURL(new Blob([pt.data], { type: pt.type })) })
    return urls.get(id).url
  }
  const tilesEl = document.getElementById('party-tiles')
  const gridEl = document.getElementById('roster-grid')
  const pickEl = document.getElementById('roster-pick')
  let picking = null // vignette en cours de choix (0 … 5), ou null

  // Mêmes règles que les fiches : tout le monde voit toutes les fiches (lecture seule pour les non-propriétaires
  // et les observateurs) ; seuls le MJ et le joueur propriétaire (profil « Joueur » de la fiche) les modifient
  const ownerName = (c) => ctx.ownerOf(c.get('name'), c.get('player'))
  const isMine = (c) => !!ownerName(c) && ownerName(c).toLowerCase() === ctx.me().name.toLowerCase()
  const canSee = () => true
  const canEdit = (c) => ctx.me().isGM || isMine(c)

  const slotOf = (id) => [...slots.entries()].filter(([, v]) => v === id).map(([k]) => Number(k))

  // ---------- Vignettes ----------
  // Barre d'une vignette : − / + pour le MJ et le propriétaire (Maj : de 5 en 5) ; sous zéro, la barre des HP devient une barre sombre rayée
  function bar(id, s, edit) {
    const { cur, max } = st.read(id, s)
    const step = (d) => (e) => { e.stopPropagation(); st.setCur(id, s, cur + d * (e.shiftKey ? 5 : 1)) }
    const hp = s === RES.hp
    const fill = (n) => (max > 0 ? Math.round((Math.max(n, 0) / max) * 100) : 0)
    return h('div', { class: `tile-stat stat-${s.key}`, title: `${s.title} : ${cur} / ${max}${hp ? ` (jusqu'à −${max})` : ''}` },
      h('span', { class: 'tile-stat-label' }, s.label),
      hp && cur < 0
        ? h('span', { class: 'tile-bar is-neg' }, h('span', { class: 'tile-neg' }, h('b', { style: `width:${max > 0 ? Math.round((Math.min(-cur, max) / max) * 100) : 100}%` })))
        : h('span', { class: 'tile-bar' }, h('i', { style: `width:${fill(cur)}%` })),
      h('span', { class: 'tile-stat-value' },
        edit && h('button', { class: 'tile-pm', type: 'button', title: `${s.label} −1 (Maj : −5)`, 'aria-label': `${s.label} : −1`, onclick: step(-1) }, '−'),
        h('span', { class: 'tile-stat-num' }, `${cur < 0 ? '−' + -cur : cur}/${max}`),
        edit && h('button', { class: 'tile-pm', type: 'button', title: `${s.label} +1 (Maj : +5)`, 'aria-label': `${s.label} : +1`, onclick: step(1) }, '+')))
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

    // Vignette sans aventurier : un simple emplacement orné, sans texte ;
    // le MJ y voit en plus le bouton pour la remplir
    if (!c || !canSee(c)) {
      return h('article', { class: `tile vacant${isGM ? ' gm' : ''}`, 'aria-label': `Emplacement ${i + 1} libre` },
        h('span', { class: 'tile-ornament', 'aria-hidden': 'true' }, '❦'),
        choose('+ Aventurier', 'tile-fill'))
    }
    const canDrag = isGM || isMine(c)
    return h('article', {
      class: `tile${isMine(c) ? ' mine' : ''}`,
      title: canDrag ? 'Cliquer : ouvrir la fiche · Glisser sur la carte : placer son jeton' : 'Cliquer : ouvrir la fiche',
      onclick: () => ctx.sheets.open(id),
      draggable: canDrag,
      ondragstart: canDrag && ((e) => { e.dataTransfer.setData(CHARACTER_MIME, id); e.dataTransfer.effectAllowed = 'copy' }),
    },
    h('header', { class: 'tile-head' },
      h('span', { class: 'tile-name' }, c.get('name') || 'Sans nom'),
      choose('⇄', 'tile-choose')),
    STATUS.map((s) => bar(id, s, canEdit(c))),
    statusUi.chips(id, canEdit(c)))
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
      const { cur, max } = st.read(id, s)
      return h('label', { class: `roster-stat stat-${s.key}`, title: s.title },
        h('span', {}, s.label),
        edit
          // Plafond relu au moment d'écrire : le maximum a pu changer entre-temps (autre joueur, autre champ)
          ? [h('input', { type: 'number', min: s === RES.hp ? -max : 0, class: 'num', value: cur, 'aria-label': `${s.label} : valeur courante`, onchange: (e) => st.setCur(id, s, Number(e.target.value)) }),
            h('span', { class: 'muted' }, '/'),
            // Le maximum ne se modifie que depuis la fiche (bouton « Modifier »)
            h('b', { title: 'Le maximum se modifie dans la fiche (bouton « Modifier »)' }, max)]
          : h('b', {}, `${cur} / ${max}`))
    }))
  }

  function card(id, c) {
    const owner = ownerName(c)
    const inSlots = slotOf(id)
    const url = portraitUrl(id)
    return h('article', { class: `roster-card${picking != null && slots.get(String(picking)) === id ? ' current' : ''}` },
      h('header', { class: 'roster-card-head' },
        // Rangée du haut : emplacement de la vignette à gauche, bouton « Ouvrir » à droite
        h('div', { class: 'roster-card-top' },
          h('span', { class: 'roster-card-sub' }, inSlots.length > 0 ? h('span', { class: 'roster-chip' }, `Vignette ${inSlots.map((k) => k + 1).join(', ')}`) : h('span', { class: 'muted' }, 'Hors vignette')),
          h('button', { class: 'roster-open', title: 'Ouvrir la fiche du personnage', onclick: () => ctx.sheets.open(id) }, 'Ouvrir', h('span', { 'aria-hidden': 'true' }, '→'))),
        h('div', { class: 'roster-card-ident' },
          url && h('img', { class: 'roster-portrait', src: url, alt: `Portrait de ${c.get('name') || ''}` }),
          h('div', { class: 'roster-card-id' },
            h('h3', {}, c.get('name') || 'Sans nom'),
            owner && h('span', { class: 'muted' }, owner)))),
      statusEditor(id, c),
      statusUi.card(id, canEdit(c)),
      picking != null && ctx.me().isGM && h('div', { class: 'roster-actions' },
        h('button', { class: 'primary', onclick: () => assign(picking, id) }, `Afficher dans la vignette ${picking + 1}`)))
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

  // ---------- MJ : profils des joueurs (ajout / suppression) ----------
  // Le MJ (Withex) et l'Observateur sont fixes : seuls les profils « Joueur » se gèrent ici.
  // Champ et bouton créés une fois (la saisie n'est jamais effacée par un rafraîchissement) ;
  // seuls la liste des profils et le message d'erreur sont redessinés.
  const adminEl = document.getElementById('profiles-admin')
  const listEl = h('div', { class: 'profiles-list' })
  const errorEl = h('p', { class: 'profiles-error', hidden: true })
  const input = h('input', { placeholder: 'Nom du nouveau joueur', maxLength: 20, 'aria-label': 'Nom du nouveau joueur' })
  const showError = (text) => { errorEl.textContent = text; errorEl.hidden = !text }
  const add = () => {
    if (!ctx.me().isGM) return
    const error = ctx.profiles.add(input.value)
    showError(error)
    if (!error) input.value = ''
    input.focus()
  }
  input.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); add() } })
  input.addEventListener('input', () => showError(''))
  adminEl.append(
    h('h3', {}, 'Profils des joueurs'),
    listEl,
    h('div', { class: 'profiles-add' }, input, h('button', { onclick: add }, 'Ajouter')),
    errorEl,
    h('p', { class: 'muted' }, 'Le MJ (Withex) et l’Observateur ne peuvent être ni ajoutés ni supprimés.'))
  function renderAdmin() {
    listEl.replaceChildren(...ctx.profiles.players().map((name) =>
      h('span', { class: 'profile-chip' }, name,
        h('button', {
          class: 'icon', title: `Supprimer le profil ${name}`,
          onclick: () => {
            if (!ctx.me().isGM) return
            if (!confirm(`Supprimer le profil joueur « ${name} » ?\nSes fiches restent, sans joueur, tant que le profil n'est pas recréé. S'il est connecté, il devra choisir un autre profil.`)) return
            ctx.profiles.remove(name)
          },
        }, '×'))))
  }

  const renderAll = () => { renderTiles(); renderRoster(); renderAdmin() }
  characters.observeDeep(renderAll)
  slots.observe(renderAll)
  status.observe(renderAll)
  portraits.observe(renderAll)
  renderAll()

  return {
    rerender() {
      if (!ctx.me().isGM) { picking = null; showError('') } // choix des vignettes et profils : MJ seul
      renderAll()
    },
    /** Appelé quand on quitte l'onglet Fiches : le mode choix s'arrête */
    leaveRoster() { if (picking != null) cancelPick() },
  }
}
