import { h, liveRender } from './dom.js'
import { BADGES, ownerOf } from './rules.js'

// Dossiers du MJ : listes libres de personnages pour son organisation (un personnage peut être dans plusieurs).
// Réservés au MJ (rien n'est réellement secret : tout est dans le Y.Doc de chacun).
//   folders       : id → { name }
//   folderMembers : `${dossier}|${personnage}` → true  (une clé par appartenance : deux cochages simultanés fusionnent)

export const memberKey = (folderId, charId) => `${folderId}|${charId}`

/** Coche / décoche l'appartenance d'un personnage à un dossier. */
export function setMember(doc, folderId, charId, on) {
  const members = doc.getMap('folderMembers')
  if (on) members.set(memberKey(folderId, charId), true)
  else members.delete(memberKey(folderId, charId))
}

/** Dossiers triés par nom : [[id, { name }]…] */
export const folderList = (doc) =>
  [...doc.getMap('folders').entries()].sort(([, a], [, b]) => a.name.localeCompare(b.name, 'fr'))

/** ctx : { doc, me() -> { name, isGM }, openSheet(id), onOpen() } */
export function setupFolders(ctx) {
  const folders = ctx.doc.getMap('folders')
  const members = ctx.doc.getMap('folderMembers')
  const characters = ctx.doc.getMap('characters')
  const section = document.getElementById('folders-section')
  const list = document.getElementById('folder-list')
  const panel = document.getElementById('folder-panel')
  let openId = null
  let filter = ''
  let showAll = false // afficher tous les personnages (pour en ajouter) ou seulement les membres

  const crew = () => [...characters.entries()].map(([id, c]) => ({ id, ...c.toJSON() }))
  const isMember = (fid, cid) => members.has(memberKey(fid, cid))
  const count = (fid) => crew().filter((c) => isMember(fid, c.id)).length
  const badgeOf = (c) => BADGES.find((b) => b.name === c.badge)

  function create() {
    const name = prompt('Nom du nouveau dossier ?', 'Nouveau dossier')?.trim()
    if (!name) return
    const id = crypto.randomUUID()
    folders.set(id, { name })
    showAll = true // dossier vide : on montre tout le monde pour cocher
    open(id)
  }
  function rename() {
    const name = prompt('Nouveau nom du dossier ?', folders.get(openId).name)?.trim()
    if (name) folders.set(openId, { ...folders.get(openId), name })
  }
  function remove() {
    const f = folders.get(openId)
    if (!confirm(`Supprimer le dossier « ${f.name} » ?\n\nLes personnages et leurs fiches ne sont pas touchés.`)) return
    const id = openId
    close()
    ctx.doc.transact(() => {
      for (const k of [...members.keys()]) if (k.startsWith(`${id}|`)) members.delete(k)
      folders.delete(id)
    })
  }

  function build() {
    const f = folders.get(openId)
    const all = crew().sort((a, b) => a.name.localeCompare(b.name, 'fr'))
    const inside = all.filter((c) => isMember(openId, c.id))
    const shown = showAll ? all : inside
    let tbody, empty
    const applyFilter = () => {
      const q = filter.trim().toLowerCase()
      let n = 0
      for (const tr of tbody.children) n += !(tr.hidden = !!q && !tr.dataset.text.includes(q))
      empty.hidden = n > 0
    }
    panel.append(
      h('header', { class: 'dossier-head', style: '--badge: var(--accent-2)' },
        h('div', { class: 'dossier-id' },
          h('h2', { class: 'dossier-name' }, f.name),
          h('div', { class: 'dossier-meta' }, `Dossier du MJ  ·  ${inside.length} personnage(s)`)),
        h('div', { class: 'dossier-actions' },
          h('button', { class: 'small', onclick: rename }, 'Renommer'),
          h('button', { class: 'small danger', onclick: remove }, 'Supprimer'),
          h('button', { class: 'icon', title: 'Fermer', onclick: close }, '×'))),
      h('div', { class: 'personnel-tools' },
        h('input', {
          type: 'search', placeholder: 'Rechercher (nom, poste, badge…)', value: filter,
          oninput: (e) => { filter = e.target.value; applyFilter() },
        }),
        h('label', { class: 'check', title: 'Montrer tous les personnages pour cocher ceux du dossier' },
          h('input', { type: 'checkbox', checked: showAll, onchange: (e) => { showAll = e.target.checked; draw() } }),
          'Tous les personnages')),
      h('table', { class: 'inv personnel' },
        h('thead', {}, h('tr', {}, ['', 'Nom', 'Poste', 'Accréditation', 'Statut'].map((t) => h('th', {}, t)))),
        tbody = h('tbody', {}, shown.map((c) => {
          const owner = ownerOf(c.name, c.player)
          return h('tr', { 'data-text': [c.name, c.post, c.badge, owner].join(' ').toLowerCase() },
            h('td', {}, h('input', {
              type: 'checkbox', checked: isMember(openId, c.id), title: 'Dans ce dossier',
              onchange: (e) => setMember(ctx.doc, openId, c.id, e.target.checked),
            })),
            h('td', { class: 'p-name open', title: 'Ouvrir la fiche', onclick: () => ctx.openSheet(c.id) }, c.name,
              c.hidden && h('span', { class: 'tag' }, 'cachée')),
            h('td', {}, c.post || '—'),
            h('td', {}, c.badge ? h('span', { class: 'badge-chip', style: `--badge: ${badgeOf(c)?.color ?? '#9aa4b5'}` }, h('i'), c.badge) : '—'),
            h('td', { class: owner ? 'p-pj' : 'muted' }, owner ? `PJ · ${owner}` : 'PNJ'))
        }))),
      empty = h('p', { class: 'muted' }, showAll ? 'Aucun personnage ne correspond.' : 'Dossier vide : cochez « Tous les personnages » pour en ajouter.'),
    )
    applyFilter()
  }
  const draw = liveRender(panel, build)

  function open(id) {
    if (openId === id) return close()
    ctx.onOpen?.()
    if (openId !== id) filter = ''
    openId = id
    panel.hidden = false
    draw()
    renderList()
  }
  function close() {
    openId = null
    showAll = false
    panel.hidden = true
    panel.innerHTML = ''
    renderList()
  }

  function renderList() {
    list.innerHTML = ''
    for (const [id, f] of folderList(ctx.doc)) {
      list.append(h('li', { class: `crew-item ship-item${id === openId ? ' active' : ''}`, onclick: () => open(id) },
        h('span', { class: 'badge-dot', style: '--badge: var(--accent-2)' }),
        h('span', { class: 'crew-name' }, f.name),
        h('span', { class: 'crew-post' }, `${count(id)} personnage(s)`)))
    }
  }

  function rerender() {
    section.hidden = !ctx.me().isGM
    if (!ctx.me().isGM) { if (openId) close(); return }
    if (openId && !folders.has(openId)) return close() // supprimé par un autre MJ
    renderList()
    if (openId) draw()
  }

  document.getElementById('btn-new-folder').addEventListener('click', create)
  folders.observe(rerender)
  members.observe(rerender)
  characters.observeDeep(rerender)
  rerender()
  return { close() { if (openId) close() }, rerender }
}
