import { h, liveRender } from './dom.js'
import { BADGES, ownerOf, presetOf } from './rules.js'

// Dossier du personnel : registre de tout l'équipage (PJ et PNJ), comme un panneau du Gaïa.
// Visible par le MJ et les joueurs dont le préréglage a `personnel: true` (rules.js).
// Les joueurs y voient aussi les fiches cachées, sauf celles que le MJ en a retirées (inPersonnel: false).
// Rien n'est réellement secret : les fiches sont dans le Y.Doc de chacun.

// Services et ordre des postes repris de la feuille « Registre du personnel » de l'Excel de tous les personnages.
// Le poste d'une fiche est reconnu par motif (accents et féminin tolérés) ; un poste inconnu est rangé
// d'après son badge, après les postes connus de ce service.
const SERVICES = [
  ['command', 'Personnel de commandement'],
  ['security', 'Personnel de sécurité'],
  ['medical', 'Personnel médical'],
  ['tech', 'Personnel technique'],
  ['science', 'Personnel scientifique'],
  ['misc', 'Personnel divers'],
  ['special', 'Personnel spécial'],
]
const POSTS = [ // [motif sur le poste sans accents, service], dans l'ordre du registre
  [/^commandant(?! en second)/, 'command'], [/^commandant en second/, 'command'], [/officiere? de navigation/, 'command'],
  [/officiere? de securite/, 'command'], [/officiere? de pont/, 'command'], [/officiere? de communication/, 'command'],
  [/officiere? de liaison/, 'security'], [/operat(eur|rice) de defense/, 'security'], [/pilote/, 'security'], [/agente? de securite/, 'security'],
  [/medecin/, 'medical'], [/chirurgien/, 'medical'], [/psycholog/, 'medical'], [/infirmi/, 'medical'], [/secouris/, 'medical'],
  [/ingenieure? en aero/, 'tech'], [/ingenieure? en electro/, 'tech'], [/technicien(ne)? general/, 'tech'], [/manutention/, 'tech'],
  [/astrophysic/, 'science'], [/biolog/, 'science'], [/geolog/, 'science'], [/climatolog/, 'science'], [/ethnolog/, 'science'], [/assistante? de labo/, 'science'],
  [/responsable sanitaire/, 'misc'], [/cuisin/, 'misc'], [/jardin/, 'misc'], [/photograph/, 'misc'], [/technicien(ne)? de surface/, 'misc'], [/blanchiss/, 'misc'],
  [/consultant/, 'special'], [/diplomat/, 'special'],
]
const BADGE_SERVICE = { Rouge: 'command', Gris: 'command', Noir: 'command', Bleu: 'security', Violet: 'medical', Orange: 'special', Jaune: 'tech', Rose: 'science', Vert: 'misc' }
const plain = (t) => (t ?? '').toLowerCase().normalize('NFD').replace(/\p{Diacritic}/gu, '')
const postIndex = (c) => POSTS.findIndex(([re]) => re.test(plain(c.post)))
export function serviceOf(c) {
  const i = postIndex(c)
  return i >= 0 ? POSTS[i][1] : BADGE_SERVICE[c.badge] ?? 'misc'
}
const serviceRank = (c) => SERVICES.findIndex(([k]) => k === serviceOf(c))
/** Rang d'un poste dans le registre (poste inconnu : après les postes connus). */
const postRank = (c) => { const i = postIndex(c); return i < 0 ? POSTS.length : i }

/** ctx : { doc, me() -> { name, isGM }, openSheet(id), onOpen() } */
export function setupPersonnel(ctx) {
  const characters = ctx.doc.getMap('characters')
  const panel = document.getElementById('personnel-panel')
  const item = document.getElementById('personnel-item')
  let isOpen = false
  let filter = ''
  let badgeFilter = null // badge choisi dans les pastilles du haut (null = tous)
  let sort = 'badge'

  const allowed = () => ctx.me().isGM || !!presetOf(ctx.me().name)?.personnel
  const badgeOf = (c) => BADGES.find((b) => b.name === c.badge)
  const rank = (c) => { const i = BADGES.findIndex((b) => b.name === c.badge); return i < 0 ? BADGES.length : i }
  const byName = (a, b) => a.name.localeCompare(b.name, 'fr')
  const SORTS = {
    badge: ['Accréditation', (a, b) => rank(a) - rank(b) || byName(a, b)],
    name: ['Nom', byName],
    // Comme le registre du personnel de l'Excel : par service, puis dans l'ordre des postes
    post: ['Poste', (a, b) => serviceRank(a) - serviceRank(b) || postRank(a) - postRank(b) || rank(a) - rank(b) || byName(a, b)],
  }

  function crew() {
    const isGM = ctx.me().isGM
    return [...characters.entries()]
      .map(([id, c]) => ({ id, ...c.toJSON() }))
      .filter((c) => isGM || c.inPersonnel !== false) // fiches cachées comprises, sauf si le MJ les a retirées du dossier
      .map((c) => ({ ...c, owner: ownerOf(c.name, c.player) }))
  }

  function build() {
    let tbody, empty
    const list = crew()
    const shown = [...list].sort(SORTS[sort][1])
    const text = (c) => [c.name, c.post, c.country, c.badge, c.owner, SERVICES[serviceRank(c)]?.[1]].join(' ').toLowerCase()
    // Filtre appliqué directement aux lignes (un re-rendu attendrait la fin de la saisie)
    const applyFilter = () => {
      const q = filter.trim().toLowerCase()
      let n = 0
      let group = null
      let inGroup = 0
      const closeGroup = () => { if (group) group.hidden = !inGroup }
      for (const tr of tbody.children) {
        if (tr.classList.contains('group')) { closeGroup(); group = tr; inGroup = 0; continue }
        const ok = !(tr.hidden = (!!q && !tr.dataset.text.includes(q)) || (!!badgeFilter && tr.dataset.badge !== badgeFilter))
        n += ok
        inGroup += ok
      }
      closeGroup()
      empty.hidden = n > 0
    }
    const pj = list.filter((c) => c.owner).length

    // Effectif par accréditation (pastilles)
    const counts = BADGES.map((b) => [b, list.filter((c) => c.badge === b.name).length]).filter(([, n]) => n)

    panel.append(
      h('header', { class: 'dossier-head', style: '--badge: var(--accent-2)' },
        h('div', { class: 'dossier-id' },
          h('h2', { class: 'dossier-name' }, 'Dossier du personnel'),
          h('div', { class: 'dossier-meta' }, `Gaïa  ·  ${list.length} membres d'équipage  ·  ${pj} PJ, ${list.length - pj} PNJ`)),
        h('div', { class: 'dossier-actions' },
          h('button', { class: 'icon', title: 'Fermer', onclick: close }, '×'))),
      h('div', { class: 'personnel-counts' }, counts.map(([b, n]) => h('button', {
        class: `badge-chip${badgeFilter === b.name ? ' on' : ''}`, style: `--badge: ${b.color}`,
        title: badgeFilter === b.name ? 'Afficher tout le monde' : `N'afficher que les badges ${b.name}`,
        onclick: () => { badgeFilter = badgeFilter === b.name ? null : b.name; draw() },
      }, h('i'), `${b.name} · ${n}`))),
      h('div', { class: 'personnel-tools' },
        h('input', {
          type: 'search', placeholder: 'Rechercher (nom, poste, origine, badge…)', value: filter,
          oninput: (e) => { filter = e.target.value; applyFilter() },
        }),
        h('label', {}, 'Trier par ',
          h('select', { onchange: (e) => { sort = e.target.value; draw() } },
            Object.entries(SORTS).map(([k, [l]]) => h('option', { value: k, selected: k === sort }, l))))),
      h('table', { class: 'inv personnel' },
        h('thead', {}, h('tr', {}, ['Nom', 'Poste', 'Accréditation', 'Âge', 'Origine', 'Statut'].map((t) => h('th', {}, t)))),
        tbody = h('tbody', {}, shown.flatMap((c, i) => [
          // Tri par service : une ligne d'en-tête par service
          sort === 'post' && serviceOf(c) !== (i && serviceOf(shown[i - 1])) &&
            h('tr', { class: 'group' }, h('td', { colSpan: 6 }, SERVICES[serviceRank(c)][1])),
          h('tr', {
          'data-text': text(c),
          'data-badge': c.badge ?? '',
          // Fiche cachée : ligne du dossier seulement, la fiche complète reste réservée au MJ
          ...(ctx.me().isGM || !c.hidden ? { class: 'open', title: 'Ouvrir la fiche', onclick: () => ctx.openSheet(c.id) } : {}),
        },
          h('td', { class: 'p-name' }, c.name, ctx.me().isGM && c.inPersonnel === false && h('span', { class: 'tag', title: 'Absent du dossier des joueurs' }, 'hors dossier')),
          h('td', {}, c.post || '—'),
          h('td', {}, c.badge ? h('span', { class: 'badge-chip', style: `--badge: ${badgeOf(c)?.color ?? '#9aa4b5'}` }, h('i'), c.badge) : '—'),
          h('td', {}, c.age ? (/^\d+$/.test(c.age) ? `${c.age} ans` : c.age) : '—'),
          h('td', {}, c.country || '—'),
          h('td', { class: c.owner ? 'p-pj' : 'muted' }, c.owner ? `PJ · ${c.owner}` : 'PNJ'))]))),
      empty = h('p', { class: 'muted' }, 'Aucun membre ne correspond.'),
    )
    applyFilter()
  }

  const draw = liveRender(panel, build)

  function open() {
    if (isOpen) return close()
    ctx.onOpen?.()
    isOpen = true
    panel.hidden = false
    item.classList.add('active')
    draw()
  }
  function close() {
    isOpen = false
    panel.hidden = true
    panel.innerHTML = ''
    item.classList.remove('active')
  }
  function rerender() {
    item.hidden = !allowed()
    if (!allowed()) return isOpen && close()
    document.getElementById('personnel-summary').textContent = `${crew().length} membres`
    if (isOpen) draw()
  }

  item.addEventListener('click', open)
  characters.observeDeep(rerender)
  rerender()
  return { close() { if (isOpen) close() }, rerender }
}
