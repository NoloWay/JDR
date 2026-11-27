// Grandal : fiche de personnage (squelette), propre à Grandal — Starboard garde src/sheets.js.
//
// Données : doc.getMap('characters') (id → Y.Map, même collection que le plateau, qui y lit name et player)
//   name, gender, race, age          généralités (texte)
//   level                            niveau général (nombre, « LV 1 »)
//   classes                          [{ name, level }] niveaux de classes (« Guerrier LV 1 »)
//   effects:race | effects:classes | effects:equipment | effects:unique | effects:temporary   effets passifs, [{ name, desc }]
//   stat:<clé>                       { value, adj } pour chaque caractéristique (STATS) : value = valeur de base (inchangée par les
//                                    effets), adj = écart temporaire (+/−, 0 si absent) ; valeur effective = value + adj ;
//                                    modificateur calculé sur la valeur effective (modifier), jamais stocké (un ancien champ mod est ignoré)
//   gran                             nombre de Gran (la monnaie), entier ≥ 0
//   inventory:weapons                [{ name, desc, dice, bonus, bonusStat }] armes (INVENTORY_CATEGORIES) ; dice = « 2d6 » (nombre de dés + faces),
//                                    valeur ajoutée = bonus (écrite) ou, si bonusStat est une clé de STATS, le modificateur de cette caractéristique
//                                    (suit le tableau en direct) ; absent = liste par défaut [DEFAULT_WEAPON] (Mains nues), jamais écrite avant une modification
//   inventory:equipment | inventory:items   [{ name, desc }] équipement et objets
//   unarmed                          ancien réglage de la ligne « Mains nues » (dice, desc), repris tant que la liste d'armes n'est pas écrite
//   skills:<catégorie>               [{ name, level }] compétences (SKILL_CATEGORIES), level = connaissance | expertise | maitrise ;
//                                    le bonus (+1 / +2 / +3) se déduit du niveau, jamais stocké
//   player                           joueur propriétaire (profil joueur, choisi par le MJ)
// Les listes et les caractéristiques sont des valeurs simples (remplacées en entier à chaque modification) :
// export / import directs ; une caractéristique par clé pour que deux personnes n'écrasent pas leurs modifications.
// Image : doc.getMap('portraits') (id du personnage → { type, data: Uint8Array }, WebP ≤ PORTRAIT_SIZE px).
// Statut (HP, MP, SPD, EP, SS, SP) : status.js, données dans doc.getMap('status').
// Droits : toutes les fiches sont visibles de tous ; le MJ et le joueur propriétaire modifient (les autres joueurs
// et les observateurs : lecture seule) ; création, suppression et choix du joueur : MJ seul.
import * as Y from 'yjs'
import { h, liveRender } from '../../src/dom.js'
import { setupStatus, statusViews } from './status.js'

export const STATS = [
  { key: 'vitalite', label: 'Vitalité' },
  { key: 'sagesse', label: 'Sagesse' },
  { key: 'agilite', label: 'Agilité' },
  { key: 'force', label: 'Force' },
  { key: 'dexterite', label: 'Dextérité' },
  { key: 'intelligence', label: 'Intelligence' },
  { key: 'foi', label: 'Foi' },
  { key: 'precision', label: 'Précision' },
  { key: 'charisme', label: 'Charisme' },
]
export const STATS_FIRST_GROUP = 3 // les 3 premières lignes, légèrement écartées des 6 autres
export const STAT_DEFAULT = 10 // valeur d'une caractéristique non saisie (modificateur +0)
export const EFFECTS = [
  { key: 'temporary', label: 'Temporaires' },
  { key: 'race', label: 'Race' },
  { key: 'classes', label: 'Classes' },
  { key: 'equipment', label: 'Équipement' },
  { key: 'unique', label: 'Uniques' },
]
// Compétences : catégories dans l'ordre, niveaux d'apprentissage et bonus associé (jamais stocké : déduit du niveau)
export const SKILL_CATEGORIES = [
  { key: 'generales', label: 'Générales' },
  { key: 'domaines', label: 'Domaines' },
  { key: 'langages', label: 'Langages' },
  { key: 'armes', label: 'Armes' },
  { key: 'armures', label: 'Armures' },
  { key: 'instruments', label: 'Instruments' },
  { key: 'recettes', label: 'Recettes' },
]
export const SKILL_LEVELS = [
  { key: 'connaissance', label: 'Connaissance', bonus: 1 },
  { key: 'expertise', label: 'Expertise', bonus: 2 },
  { key: 'maitrise', label: 'Maîtrise', bonus: 3 },
]
const skillLevel = (key) => SKILL_LEVELS.find((l) => l.key === key) ?? SKILL_LEVELS[0]
// Inventaire : catégories d'objets (pour l'instant les armes seulement ; chacune a son en-tête)
export const INVENTORY_CATEGORIES = [
  { key: 'weapons', label: 'Armes', kind: 'weapon', add: '+ Arme' },
  { key: 'equipment', label: 'Équipement', kind: 'simple', one: 'équipement', add: '+ Équipement', empty: 'Aucun' },
  { key: 'items', label: 'Objets', kind: 'simple', one: 'objet', add: '+ Objet', empty: 'Aucun' },
]
export const UNARMED_DICE = '2d4'
// « Mains nues » : ligne présente par défaut tant que les armes d'une fiche n'ont jamais été modifiées ; ensuite, une ligne comme les autres
export const DEFAULT_WEAPON = { name: 'Mains nues', desc: '', dice: UNARMED_DICE, bonus: 0, bonusStat: 'force' }
/** « 2d6 », « D8 », « 3 d 10 » → « 2d6 », « 1d8 », « 3d10 » ; null si ce n'est pas un jet de dés valide (au moins 1 dé, 2 faces) */
export function parseDice(text) {
  const m = /^\s*(\d*)\s*d\s*(\d+)\s*$/i.exec(String(text))
  if (!m) return null
  const count = m[1] === '' ? 1 : Number(m[1])
  const faces = Number(m[2])
  return count >= 1 && count <= 99 && faces >= 2 && faces <= 1000 ? `${count}d${faces}` : null
}
/** Jet d'une arme pour l'affichage : « 2d6 + 3 », « 1d8 − 1 », « 1d8 », « +2 » (vide si rien n'est défini) */
export function weaponRoll(it) {
  const dice = it.dice ? parseDice(it.dice) : null
  const bonus = Math.round(Number(it.bonus)) || 0
  if (dice && bonus) return `${dice} ${bonus > 0 ? '+' : '−'} ${Math.abs(bonus)}`
  return dice || (bonus ? `${bonus > 0 ? '+' : '−'}${Math.abs(bonus)}` : '')
}
const PORTRAIT_SIZE = 512
const patchAt = (list, i, patch) => list.map((x, j) => (j === i ? { ...x, ...patch } : x))

// Silhouette de d20 (icosaèdre vu de face : contour hexagonal, triangle central, arêtes), au trait,
// dans la couleur du texte : discrète et assortie à la fiche, contrairement à l'émoji 🎲
const D20_ICON = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" aria-hidden="true">' +
  '<path d="M12 2.5 20.5 7.25v9.5L12 21.5l-8.5-4.75v-9.5z"/>' +
  '<path d="M12 8 6.75 16h10.5z"/>' +
  '<path d="M12 2.5V8M3.5 7.25 12 8l8.5-.75M3.5 16.75 6.75 16M20.5 16.75 17.25 16M12 21.5 6.75 16M12 21.5 17.25 16"/></svg>'
function d20Button(attrs) {
  const b = h('button', { class: 'gs-roll-btn', ...attrs })
  b.innerHTML = D20_ICON
  return b
}

/** Modificateur d'une caractéristique : (valeur − 10) / 2, arrondi à l'inférieur (8 → −1, 9 → −1, 10 → +0, 13 → +1) */
export const modifier = (value) => Math.floor((value - 10) / 2)
const signed = (n) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : '+0')
const num = (v, def = 0) => (Number.isFinite(Number(v)) && v !== '' && v != null ? Math.round(Number(v)) : def)

/** Nouvelle fiche vide (Y.Map prête à être placée dans doc.getMap('characters')) */
export function newCharacter(data = {}) {
  const m = new Y.Map()
  for (const [k, v] of Object.entries({ name: 'Nouvel aventurier', level: 1, ...data })) m.set(k, v)
  return m
}

/** Remplace toutes les fiches (import d'une partie Grandal) */
export function replaceCharacters(doc, data) {
  const characters = doc.getMap('characters')
  doc.transact(() => {
    characters.clear()
    for (const [id, c] of Object.entries(data ?? {})) characters.set(id, newCharacter(c))
  })
}

// Image en base64 pour l'export JSON
export const toBase64 = (u8) => { let s = ''; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode(...u8.subarray(i, i + 0x8000)); return btoa(s) }
export const fromBase64 = (b64) => Uint8Array.from(atob(b64), (ch) => ch.charCodeAt(0))

/** Réduit une image à PORTRAIT_SIZE px de côté au plus, en WebP */
async function shrink(file) {
  const bmp = await createImageBitmap(file)
  const k = Math.min(1, PORTRAIT_SIZE / Math.max(bmp.width, bmp.height))
  const canvas = Object.assign(document.createElement('canvas'), { width: Math.round(bmp.width * k), height: Math.round(bmp.height * k) })
  canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise((res) => canvas.toBlob(res, 'image/webp', 0.85))
  return { type: blob.type || 'image/png', data: new Uint8Array(await blob.arrayBuffer()) }
}

/**
 * ctx : { doc, me() → { name, isGM }, ownerOf(nom, joueur) → profil ou '', playerChoices() → profils joueurs, onOpen(),
 *         onRoll(libellé, valeur demandée) → jet d'une caractéristique,
 *         onRollWeapon(libellé, nombre de dés, faces, valeur fixe) → jet de dégâts d'une arme }
 * Renvoie { open(id), close(), create(), rerender() }
 */
export function setupGrandalSheets(ctx) {
  const characters = ctx.doc.getMap('characters')
  const portraits = ctx.doc.getMap('portraits')
  const sheetEl = document.getElementById('sheet')
  const st = setupStatus(ctx.doc)
  const statusUi = statusViews(st)
  let openId = null
  // Brouillon : en mode « Modifier », rien n'est écrit dans le Y.Doc avant « Terminer ».
  //   values   : clés du Y.Map de la fiche (nom, genre, race, âge, level, classes, effects:*, skills:*, player)
  //   statBase : valeurs de base des caractéristiques (clé → nombre) ; l'écart « effective » reste modifiable à la volée
  //   portrait : undefined = inchangé, null = retiré, { type, data } = nouvelle image
  //   status   : maximums et vitesse de base du statut (clé → nombre)
  //   removedSections : id des sous-sections d'inventaire supprimées (appliqué par « Terminer »)
  // null = fiche en consultation. L'inventaire, les Gran, l'écart des caractéristiques et le statut courant s'écrivent à la volée.
  let draft = null
  let pendingDiscard = null // action à lancer si on abandonne des modifications non validées (fenêtre de confirmation)
  let confirmingSection = null // id de la sous-section d'inventaire dont on confirme la suppression
  const editingLines = new Set() // lignes d'inventaire dont les champs sont ouverts (« catégorie#index »)
  const lineSnaps = new Map() // état d'une ligne à l'ouverture de ses champs (JSON), ou NEW_LINE pour une ligne qui vient d'être ajoutée
  const NEW_LINE = Symbol('nouvelle ligne')
  let confirmingLine = null // ligne dont on confirme la suppression (« catégorie#index »)
  let confirmingDelete = false // étape de confirmation de la suppression (dans la fiche, pas de boîte du navigateur)

  const ownerName = (c) => ctx.ownerOf(c.get('name'), c.get('player'))
  const isMine = (c) => !!ownerName(c) && ownerName(c).toLowerCase() === ctx.me().name.toLowerCase()
  // Toutes les fiches sont visibles de tous (joueurs non propriétaires et observateurs : lecture seule).
  // Un ancien champ « hidden » (fiches créées avant ce choix) est ignoré.
  const canSee = () => true
  const canEdit = (c) => ctx.me().isGM || isMine(c)

  // Adresses des images (créées une fois par image, libérées quand l'image change)
  const urls = new Map() // id → { data, url }
  function portraitUrl(id) {
    const p = portraits.get(id)
    const cached = urls.get(id)
    if (cached && (!p || cached.data !== p.data)) { URL.revokeObjectURL(cached.url); urls.delete(id) }
    if (!p) return null
    if (!urls.has(id)) urls.set(id, { data: p.data, url: URL.createObjectURL(new Blob([p.data], { type: p.type })) })
    return urls.get(id).url
  }

  // ---- Fiche détachée : la fiche peut vivre dans une fenêtre séparée (déplaçable sur un autre écran) ----
  // C'est le même élément (#sheet) qui change de document : tout (rendu, données, boutons) continue de fonctionner tel quel.
  const homeParent = sheetEl.parentElement
  const homeNext = sheetEl.nextSibling
  let popup = null
  const detached = () => !!popup && !popup.closed
  /** Remet l'élément de la fiche sur le plateau et ferme la fenêtre détachée (sans fermer la fiche) */
  function dock() {
    const w = popup
    popup = null
    homeParent.insertBefore(sheetEl, homeNext)
    if (w && !w.closed) w.close()
  }
  function detach() {
    if (detached()) { popup.focus(); return }
    const w = window.open('', 'grandal-fiche', 'popup=yes,width=1000,height=860,left=60,top=40')
    if (!w) { alert('Le navigateur a bloqué la fenêtre. Autorise les fenêtres surgissantes pour ce site, puis réessaie.'); return }
    w.document.open()
    w.document.write('<!doctype html><html lang="fr" class="sheet-detached"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Fiche — Grandal</title></head><body></body></html>')
    w.document.close()
    // Mêmes feuilles de style que la page (liens et styles en ligne)
    for (const node of document.querySelectorAll('link[rel="stylesheet"], style')) {
      if (node.tagName === 'LINK') w.document.head.append(Object.assign(w.document.createElement('link'), { rel: 'stylesheet', href: node.href }))
      else w.document.head.append(w.document.importNode(node, true))
    }
    w.document.body.append(sheetEl)
    popup = w
    w.addEventListener('pointerup', released, true)
    w.addEventListener('keyup', released, true)
    w.addEventListener('pointercancel', released, true)
    w.addEventListener('pagehide', () => { if (popup === w) { dock(); sheetEl.hidden = !openId; if (openId) render() } }) // fenêtre fermée par l'utilisateur : la fiche revient sur le plateau
    render()
    w.focus()
  }
  setInterval(() => { if (popup && popup.closed) { dock(); sheetEl.hidden = !openId; if (openId) render() } }, 1000) // filet de sécurité
  addEventListener('beforeunload', (e) => { if (dirty()) { e.preventDefault(); e.returnValue = '' } }) // fermeture de la page avec des modifications non validées
  addEventListener('pagehide', () => { if (detached()) popup.close() }) // la page principale se ferme : la fenêtre aussi

  const dirty = () => !!draft && (Object.keys(draft.values).length > 0 || Object.keys(draft.statBase).length > 0 || draft.portrait !== undefined || Object.keys(draft.status).length > 0 || draft.removedSections.length > 0)
  // Image du brouillon (adresse libérée quand le brouillon se termine)
  let draftUrl = null
  const draftPortraitUrl = (p) => {
    if (!draftUrl || draftUrl.data !== p.data) { if (draftUrl) URL.revokeObjectURL(draftUrl.url); draftUrl = { data: p.data, url: URL.createObjectURL(new Blob([p.data], { type: p.type })) } }
    return draftUrl.url
  }
  function endDraft() {
    draft = null
    pendingDiscard = null
    confirmingSection = null
    if (draftUrl) { URL.revokeObjectURL(draftUrl.url); draftUrl = null }
  }
  /** Lance `then` tout de suite, ou après confirmation si des modifications ne sont pas validées */
  function askLeave(then) {
    if (dirty()) { pendingDiscard = then; render(); return }
    then()
  }
  function closeNow() {
    if (popup) dock()
    openId = null
    endDraft()
    confirmingDelete = false
    confirmingSection = null
    editingLines.clear()
    lineSnaps.clear()
    confirmingLine = null
    sheetEl.hidden = true
    sheetEl.innerHTML = ''
  }
  function open(id) {
    if (!characters.has(id)) return
    if (id !== openId && dirty()) { pendingDiscard = () => open(id); render(); return } // une autre fiche : on abandonne d'abord les modifications
    if (id !== openId) { endDraft(); confirmingDelete = false; confirmingSection = null; editingLines.clear(); lineSnaps.clear(); confirmingLine = null }
    ctx.onOpen?.()
    openId = id
    sheetEl.hidden = false
    render()
    if (detached()) popup.focus() // la fiche détachée affiche la dernière fiche ouverte
  }
  function startEdit() { draft = { values: {}, statBase: {}, portrait: undefined, status: {}, removedSections: [] }; confirmingDelete = false; render() }
  function cancelEdit() { endDraft(); confirmingDelete = false; render() }
  /** « Terminer » : applique tout le brouillon d'un coup */
  function commit() {
    const c = characters.get(openId)
    if (!c || !draft) return
    const d = draft
    ctx.doc.transact(() => {
      for (const [k, v] of Object.entries(d.values)) c.set(k, v)
      for (const [k, n] of Object.entries(d.statBase)) {
        const adj = num(c.get(`stat:${k}`)?.adj, 0)
        c.set(`stat:${k}`, adj ? { value: n, adj } : { value: n })
      }
      if (d.portrait === null) portraits.delete(openId)
      else if (d.portrait) portraits.set(openId, d.portrait)
      for (const [k, n] of Object.entries(d.status)) st.putRaw(openId, k, n)
      if (d.removedSections.length) {
        // Liste relue au moment de valider : les sous-sections ajoutées ou renommées entre-temps sont conservées
        c.set('inventory:sections', (c.get('inventory:sections') ?? []).filter((x) => !d.removedSections.includes(x.id)))
        for (const id of d.removedSections) c.delete(`inventory:custom:${id}`)
      }
    })
    endDraft()
    confirmingDelete = false
    render()
  }
  function create() {
    if (!ctx.me().isGM) return
    const id = crypto.randomUUID()
    characters.set(id, newCharacter())
    open(id)
    startEdit()
  }
  function remove(id, name) {
    if (!ctx.me().isGM) return
    const tokens = ctx.doc.getMap('tokens')
    const slots = ctx.doc.getMap('partySlots')
    const status = ctx.doc.getMap('status')
    ctx.doc.transact(() => {
      for (const [tid, t] of [...tokens.entries()]) if (t.charId === id) tokens.delete(tid)
      for (const [k, v] of [...slots.entries()]) if (v === id) slots.delete(k)
      for (const k of [...status.keys()]) if (k.startsWith(`${id}|`)) status.delete(k)
      portraits.delete(id)
      characters.delete(id)
    })
    closeNow()
  }

  // Un clic ne doit pas perdre son bouton : taper dans un champ puis cliquer (« Supprimer la fiche », « Terminer »…) fait perdre le
  // focus au champ, donc enregistrer sa valeur et redessiner la fiche entre l'appui et le relâchement, ce qui annulait le clic.
  // Le rendu attend donc que le bouton de la souris soit relâché.
  let pressing = false
  // Même chose pour la touche Tab (la valeur est enregistrée avant que le focus arrive sur l'élément suivant) et pour une liste
  // déroulante qu'on vient d'ouvrir : la redessiner la refermerait. Dès qu'un choix y est fait, le rendu reprend.
  const chosenSelects = new WeakSet()
  const usingSelect = () => {
    const a = sheetEl.ownerDocument.activeElement
    return !!a && a.tagName === 'SELECT' && sheetEl.contains(a) && !chosenSelects.has(a)
  }
  const render = liveRender(sheetEl, build, { busy: () => pressing || usingSelect() })
  sheetEl.addEventListener('change', (e) => {
    if (e.target.tagName !== 'SELECT') return
    chosenSelects.add(e.target)
    // Le choix redessine la fiche : le focus revient sur la liste (sinon les flèches du clavier ne la parcourent plus)
    const selects = () => [...sheetEl.querySelectorAll('select')]
    const rank = selects().indexOf(e.target)
    setTimeout(() => { if (!e.target.isConnected) selects()[rank]?.focus({ preventScroll: true }) })
  }, true)
  sheetEl.addEventListener('pointerdown', () => { pressing = true }, true)
  sheetEl.addEventListener('keydown', (e) => { if (e.key === 'Tab') pressing = true }, true)
  /** Rendu en attente après Tab : le focus est replacé sur l'élément de même rang (un bouton redessiné le perdrait) */
  const renderKeepingFocus = () => {
    const all = () => [...sheetEl.querySelectorAll('input, select, textarea, button')]
    const rank = all().indexOf(sheetEl.ownerDocument.activeElement)
    render()
    if (rank >= 0 && !render.isPending()) all()[rank]?.focus({ preventScroll: true })
  }
  const released = (e) => {
    if (!pressing) return
    const byTab = e?.type === 'keyup'
    // « pressing » reste vrai jusqu'à ce tour-ci : un autre rendu différé ne peut pas passer avant et faire perdre le focus
    setTimeout(() => {
      pressing = false
      if (render.isPending()) (byTab ? renderKeepingFocus : render)() // après le clic
    })
  }
  addEventListener('keyup', released, true)
  addEventListener('pointerup', released, true)
  addEventListener('pointercancel', released, true)

  function build() {
    const c = characters.get(openId)
    if (!c || !canSee(c)) return closeNow()
    const isGM = ctx.me().isGM
    const mayEdit = canEdit(c)
    if (draft && !mayEdit) endDraft() // plus de droit de modification (profil changé) : le brouillon est abandonné
    const ed = !!draft && mayEdit
    // get : lecture avec le brouillon (champs validés par « Terminer ») ; live : lecture directe (données modifiables à la volée)
    const get = (k, def = '') => (draft && k in draft.values ? draft.values[k] : c.get(k)) ?? def
    const live = (k, def = '') => c.get(k) ?? def
    // setD : écrit dans le brouillon en mode « Modifier » ; sinon (ne devrait pas arriver) directement
    const setD = (k, v) => { if (draft) { draft.values[k] = v; render() } else c.set(k, v) }
    const set = (k) => (e) => setD(k, e.target.value)
    const owner = ownerName(c)
    const ownerShown = ed ? ctx.ownerOf(get('name'), get('player')) : owner

    // ---- Généralités ----
    const dp = draft ? draft.portrait : undefined
    const url = dp === undefined ? portraitUrl(openId) : dp === null ? null : draftPortraitUrl(dp)
    const portrait = h('div', { class: `gs-portrait${url ? '' : ' empty'}` },
      url ? h('img', { src: url, alt: `Portrait de ${get('name')}` }) : h('span', { class: 'gs-portrait-mark', 'aria-hidden': 'true' }, '❦'),
      ed && h('div', { class: 'gs-portrait-tools' },
        h('button', { class: 'small', onclick: pickPortrait }, url ? 'Changer' : 'Importer'),
        url && h('button', { class: 'small', onclick: () => { draft.portrait = null; render() } }, 'Retirer')))

    const classes = get('classes', [])
    // change(fn) : fn reçoit la liste ACTUELLE (l'affichage peut avoir un temps de retard pendant la saisie, voir liveRender)
    const changeClasses = (fn) => setD('classes', fn(get('classes', [])))
    const identity = h('div', { class: 'gs-identity' },
      ed
        ? h('input', { class: 'gs-name-input', value: get('name'), placeholder: 'Nom complet', 'aria-label': 'Nom complet', onchange: set('name') })
        : h('h2', { class: 'gs-name' }, get('name') || 'Sans nom'),
      ed
        ? h('div', { class: 'gs-fields' },
          field('Genre', h('input', { value: get('gender'), onchange: set('gender') })),
          field('Race', h('input', { value: get('race'), onchange: set('race') })),
          field('Âge', h('input', { value: get('age'), onchange: set('age') })))
        : h('div', { class: 'gs-meta' }, [get('gender'), get('race'), get('age') && (/^\d+$/.test(String(get('age')).trim()) ? `${get('age')} ans` : get('age'))].filter(Boolean).join('  ·  ') || 'Genre, race et âge à renseigner'),
      h('div', { class: 'gs-levels' },
        ed
          ? field('Niveau', h('input', { type: 'number', min: 0, class: 'num', value: num(get('level'), 1), onchange: (e) => setD('level', num(e.target.value, 1)) }))
          : h('span', { class: 'gs-lv' }, `LV ${num(get('level'), 1)}`),
        h('ul', { class: 'gs-classes' },
          classes.map((cl, i) => ed
            ? h('li', { class: 'gs-class-edit' },
              h('input', { value: cl.name ?? '', placeholder: 'Classe', 'aria-label': 'Classe', onchange: (e) => changeClasses((l) => l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x))) }),
              h('span', {}, 'LV'),
              h('input', { type: 'number', min: 0, class: 'num', value: num(cl.level, 1), 'aria-label': 'Niveau de classe', onchange: (e) => changeClasses((l) => l.map((x, j) => (j === i ? { ...x, level: num(e.target.value, 1) } : x))) }),
              h('button', { class: 'icon', title: 'Retirer la classe', onclick: () => changeClasses((l) => l.filter((_, j) => j !== i)) }, '×'))
            : h('li', {}, h('span', { class: 'gs-class-name' }, cl.name || 'Classe'), ' ', h('b', {}, `LV ${num(cl.level, 1)}`))),
          !ed && !classes.length && h('li', { class: 'muted' }, 'Aucune classe')),
        ed && h('button', { class: 'small', onclick: () => changeClasses((l) => [...l, { name: '', level: 1 }]) }, '+ Classe')))

    // ---- En-tête : actions ----
    const actions = h('div', { class: 'gs-actions' },
      !ed && owner && h('span', { class: 'tag' }, `Joueur · ${owner}`),
      mayEdit && !ed && h('button', { class: 'small', onclick: startEdit }, 'Modifier'),
      // Modification : rien n'est appliqué avant « Terminer » ; « Annuler les modifications » revient à l'état d'avant
      ed && dirty() && h('span', { class: 'tag gs-dirty', title: 'Ces modifications ne sont pas encore appliquées' }, 'Non validé'),
      ed && h('button', { class: 'gs-finish', title: 'Valider et appliquer toutes les modifications', onclick: commit }, 'Terminer'),
      ed && h('button', { class: 'gs-cancel', title: 'Abandonner les modifications et revenir à la fiche telle qu’elle était', onclick: cancelEdit }, 'Annuler les modifications'),
      // Détacher : la fiche s'ouvre dans sa propre fenêtre, à glisser où l'on veut (y compris sur un autre écran)
      detached()
        ? h('button', { class: 'small gs-detach', title: 'Replacer la fiche sur le plateau', onclick: () => { dock(); sheetEl.hidden = false; render() } }, 'Rattacher')
        : h('button', { class: 'small gs-detach', title: 'Détacher la fiche dans une fenêtre séparée, déplaçable sur un autre écran', onclick: detach }, 'Détacher'),
      // Croix dessinée en CSS (deux traits) : le caractère « × » n'est jamais centré pile, selon la police
      h('button', { class: 'gs-close', title: 'Fermer la fiche', 'aria-label': 'Fermer la fiche', onclick: () => askLeave(closeNow) }))

    // MJ : joueur propriétaire, suppression
    const gmTools = ed && isGM && h('div', { class: 'gs-gm' },
      field('Joueur', h('select', { onchange: set('player') },
        h('option', { value: '', selected: !ownerShown }, '— Aucun —'),
        ctx.playerChoices().map((n) => h('option', { value: n, selected: n === ownerShown }, n)))),
      confirmingDelete
        // Deuxième étape : rien n'est supprimé avant « Oui, supprimer »
        ? h('div', { class: 'gs-confirm', role: 'alertdialog', 'aria-label': 'Confirmer la suppression de la fiche' },
          h('p', {}, h('b', {}, `Supprimer définitivement la fiche de ${get('name') || 'Sans nom'} ?`),
            ' Son image, son jeton, sa place dans les vignettes et son statut seront perdus. Pensez à exporter la partie avant si vous voulez pouvoir la récupérer.'),
          h('div', { class: 'gs-confirm-actions' },
            h('button', { class: 'small', onclick: () => { confirmingDelete = false; render() } }, 'Annuler'),
            h('button', { class: 'small danger', onclick: () => remove(openId, get('name')) }, 'Oui, supprimer')))
        : h('button', { class: 'small danger', onclick: () => { confirmingDelete = true; render() } }, 'Supprimer la fiche'))

    // ---- Effets passifs ----
    const effects = h('section', { class: 'gs-sec' }, h('h3', { class: 'gs-sec-title' }, 'Effets passifs'),
      h('div', { class: 'gs-effects' }, EFFECTS.map(({ key, label }) => {
        const k = `effects:${key}`
        const list = get(k, [])
        const change = (fn) => setD(k, fn(get(k, [])))
        const shown = list.filter((fx) => (fx.name ?? '').trim() || (fx.desc ?? '').trim()) // consultation : sans les effets vides
        return h('div', { class: 'gs-effect-group' }, h('h4', {}, label),
          ed
            ? [...list.map((fx, i) => h('div', { class: 'gs-effect-edit' },
              h('input', { value: fx.name ?? '', placeholder: 'Nom de l’effet', 'aria-label': 'Nom de l’effet', onchange: (e) => change((l) => patchAt(l, i, { name: e.target.value })) }),
              h('button', { class: 'icon', title: 'Retirer l’effet', onclick: () => change((l) => l.filter((_, j) => j !== i)) }, '×'),
              h('textarea', { rows: 2, value: fx.desc ?? '', placeholder: 'Description', 'aria-label': 'Description de l’effet', onchange: (e) => change((l) => patchAt(l, i, { desc: e.target.value })) }))),
            h('button', { class: 'small', onclick: () => change((l) => [...l, { name: '', desc: '' }]) }, '+ Effet')]
            : shown.length
              ? h('ul', {}, shown.map((fx) => h('li', {}, h('b', {}, fx.name || 'Effet'), fx.desc && h('p', {}, fx.desc))))
              : h('p', { class: 'muted' }, 'Aucun'))
      })))

    // ---- Caractéristiques : 9 lignes (3 puis 6), 3 colonnes (nom, valeur, modificateur calculé) ----
    // Caractéristique jamais saisie (ou champ vidé) : STAT_DEFAULT, soit un modificateur de +0
    const committedBase = (key) => num(c.get(`stat:${key}`)?.value, STAT_DEFAULT)
    const statBase = (key) => (draft && key in draft.statBase ? draft.statBase[key] : committedBase(key)) // (valeur de base : brouillon en modification)
    const statAdj = (key) => num(c.get(`stat:${key}`)?.adj, 0)
    const statValue = (key) => statBase(key) + statAdj(key) // valeur effective
    // Écriture d'un des deux champs sans écraser l'autre ; adj = 0 n'est pas stocké
    // L'écart « effective » s'écrit à la volée (avec la base déjà validée) ; la base, elle, passe par le brouillon
    const setStat = (key) => (e) => { if (draft) { draft.statBase[key] = num(e.target.value, STAT_DEFAULT); render() } }
    const setAdj = (key, adj) => c.set(`stat:${key}`, adj ? { value: committedBase(key), adj } : { value: committedBase(key) })
    // Jet d'une caractéristique : d20, réussite à sa valeur ou plus (games/grandal/dice.js).
    // Bouton visible pour tous, cliquable par le MJ et le joueur propriétaire seulement (inactif pour les autres)
    const showRoll = !!ctx.onRoll
    const canRoll = mayEdit && showRoll
    const row = ({ key, label }, i) => {
      const base = statBase(key)
      const adj = statAdj(key)
      const value = base + adj
      const mod = modifier(value)
      return h('tr', { class: i === STATS_FIRST_GROUP - 1 ? 'gs-group-end' : null },
        h('th', { scope: 'row' }, label),
        h('td', { class: 'gs-value gs-base' }, ed ? h('input', { type: 'number', class: 'num', value: base, 'aria-label': `${label} : valeur de base`, onchange: setStat(key) }) : base),
        // Valeur effective = base + écart ; modifiable à la volée (− / + ou saisie directe) par le MJ et le propriétaire, sans toucher à la base
        h('td', { class: `gs-value gs-eff${adj > 0 ? ' up' : adj < 0 ? ' down' : ''}`, title: adj ? `Base ${base} ${adj > 0 ? '+' : '−'} ${Math.abs(adj)}` : 'Valeur effective = valeur de base' },
          mayEdit
            ? h('div', { class: 'gs-eff-ctl' },
              h('button', { class: 'gs-step', title: 'Diminuer la valeur effective', 'aria-label': `${label} : diminuer la valeur effective`, onclick: () => setAdj(key, statAdj(key) - 1) }, '−'),
              h('input', { type: 'number', class: 'num', value, 'aria-label': `${label} : valeur effective`, onchange: (e) => setAdj(key, num(e.target.value, value) - base) }),
              h('button', { class: 'gs-step', title: 'Augmenter la valeur effective', 'aria-label': `${label} : augmenter la valeur effective`, onclick: () => setAdj(key, statAdj(key) + 1) }, '+'),
              adj !== 0 && h('button', { class: 'gs-step gs-reset', title: `Revenir à la valeur de base (${base})`, 'aria-label': `${label} : revenir à la valeur de base`, onclick: () => setAdj(key, 0) }, '↺'))
            : value),
        h('td', { class: `gs-mod${mod > 0 ? ' pos' : mod < 0 ? ' neg' : ''}`, title: 'Modificateur = (valeur − 10) ÷ 2, arrondi à l’inférieur' }, signed(mod)),
        showRoll && h('td', { class: 'gs-roll' }, d20Button({
          disabled: !canRoll,
          title: canRoll
            ? `Jet de ${label} : 1d20, réussite à ${value} ou plus (20 : réussite critique, 1 : échec critique)`
            : 'Seuls le MJ et le joueur de cette fiche peuvent lancer ce jet',
          'aria-label': `Lancer un d20 en ${label} (valeur ${value})`,
          onclick: () => { if (canEdit(c)) ctx.onRoll(`${get('name') || 'Sans nom'} · ${label}`, statValue(key)) },
        })))
    }
    const statsTable = h('section', { class: 'gs-sec' }, h('h3', { class: 'gs-sec-title' }, 'Caractéristiques'),
      h('table', { class: 'gs-stats' },
        h('thead', {}, h('tr', {}, h('th', { scope: 'col' }, 'Caractéristique'), h('th', { scope: 'col', title: 'Valeur de base' }, 'Base'), h('th', { scope: 'col', title: 'Valeur effective : sert au modificateur et aux jets' }, 'Effective'), h('th', { scope: 'col' }, 'Mod.'), showRoll && h('th', { scope: 'col' }))),
        h('tbody', {}, STATS.flatMap((s, i) => (i === STATS_FIRST_GROUP - 1
        ? [row(s, i), h('tr', { class: 'gs-gap', 'aria-hidden': 'true' }, h('td', { colSpan: showRoll ? 5 : 4 }))]
        : [row(s, i)])))))

    // ---- Compétences : une liste par catégorie, chaque entrée = nom · niveau d'apprentissage · bonus ----
    const skills = h('section', { class: 'gs-sec gs-skills-sec' }, h('h3', { class: 'gs-sec-title' }, 'Compétences'),
      h('div', { class: 'gs-skills' }, SKILL_CATEGORIES.map(({ key, label }) => {
        const k = `skills:${key}`
        const list = get(k, [])
        const change = (fn) => setD(k, fn(get(k, [])))
        const patch = (i, p) => change((l) => patchAt(l, i, p))
        const shown = list.filter((sk) => (sk.name ?? '').trim())
        return h('div', { class: 'gs-skill-group' }, h('h4', {}, label),
          ed
            ? [...list.map((sk, i) => h('div', { class: 'gs-skill-edit' },
              h('input', { value: sk.name ?? '', placeholder: 'Nom', 'aria-label': `Nom de la compétence (${label})`, onchange: (e) => patch(i, { name: e.target.value }) }),
              h('select', { 'aria-label': 'Niveau d’apprentissage', onchange: (e) => patch(i, { level: e.target.value }) },
                SKILL_LEVELS.map((l) => h('option', { value: l.key, selected: l.key === skillLevel(sk.level).key }, l.label))),
              h('span', { class: 'gs-skill-bonus' }, `+${skillLevel(sk.level).bonus}`),
              h('button', { class: 'icon', title: 'Retirer la compétence', onclick: () => change((l) => l.filter((_, j) => j !== i)) }, '×'))),
            h('button', { class: 'small', onclick: () => change((l) => [...l, { name: '', level: 'connaissance' }]) }, '+ Compétence')]
            : shown.length
              ? h('ul', {}, shown.map((sk) => {
                const l = skillLevel(sk.level)
                return h('li', { class: 'gs-skill' },
                  h('span', { class: 'gs-skill-name' }, sk.name),
                  h('span', { class: `gs-skill-level lv-${l.key}` }, l.label),
                  h('b', { class: `gs-skill-bonus lv-${l.key}` }, `+${l.bonus}`))
              }))
              : h('p', { class: 'muted' }, 'Aucune'))
      })))

    if (detached()) popup.document.title = `${get('name') || 'Fiche'} — Grandal`
    // ---- Inventaire : le MJ et le joueur propriétaire modifient chaque ligne à la volée, sans passer par « Modifier » ----
    // Chaque ligne s'affiche en lecture ; son bouton ✎ ouvre ses champs (✓ les referme, × supprime la ligne).
    // Les Gran et les armes sont à côté du tableau des caractéristiques ; le reste de l'inventaire est dessous.
    const lineOpen = (catKey, i) => editingLines.has(`${catKey}#${i}`)
    const lineKey = (catKey, i) => `${catKey}#${i}`
    const openLine = (catKey, i, item) => { lineSnaps.set(lineKey(catKey, i), JSON.stringify(item)); editingLines.add(lineKey(catKey, i)); render() }
    const closeLine = (catKey, i) => { editingLines.delete(lineKey(catKey, i)); lineSnaps.delete(lineKey(catKey, i)); if (confirmingLine === lineKey(catKey, i)) confirmingLine = null }
    const clearLines = (catKey) => { for (const k of [...editingLines]) if (k.startsWith(`${catKey}#`)) { editingLines.delete(k); lineSnaps.delete(k) }; confirmingLine = null }
    // Valeur fixe d'une arme : écrite à la main, ou modificateur d'une caractéristique (suit le tableau en direct)
    const resolveBonus = (it) => (it.bonusStat && STATS.some((s) => s.key === it.bonusStat) ? modifier(statValue(it.bonusStat)) : Math.round(Number(it.bonus)) || 0)
    const withBonus = (it) => ({ ...it, bonus: resolveBonus(it) })
    const statLabel = (key) => STATS.find((s) => s.key === key)?.label ?? key
    // Bouton de jet d'une arme : mêmes règles que ceux des caractéristiques (MJ et propriétaire seulement) ; il faut des dés définis
    // `now()` relit la ligne au moment du clic (valeurs tout juste saisies comprises)
    const weaponButton = (raw, now = () => raw) => {
      const it = withBonus(raw)
      const parsed = it.dice ? parseDice(it.dice) : null
      const ok = mayEdit && !!parsed
      return d20Button({
        disabled: !ok,
        title: !parsed ? 'Aucun jet défini pour cette arme (dés à renseigner)'
          : ok ? `Jet de ${it.name || 'l’arme'} : ${weaponRoll(it)}` : 'Seuls le MJ et le joueur de cette fiche peuvent lancer ce jet',
        'aria-label': `Lancer le jet de ${it.name || 'l’arme'} (${weaponRoll(it) || 'aucun jet'})`,
        onclick: () => {
          const line = now() ?? raw
          const p = line.dice ? parseDice(line.dice) : null
          if (!p || !canEdit(c)) return
          const [count, faces] = p.split('d').map(Number)
          ctx.onRollWeapon(`${get('name') || 'Sans nom'} · ${line.name || 'Arme'}`, count, faces, resolveBonus(line))
        },
      })
    }
    const diceInput = (current, onValid) => h('input', {
      class: 'gs-dice-input', value: current ?? '', placeholder: '2d6', maxLength: 9, 'aria-label': 'Dés à jeter : nombre de dés et de faces (ex. 2d6)',
      title: 'Nombre de dés et de faces : 2d6, 1d8, d20…',
      onchange: (e) => {
        const d = e.target.value.trim() === '' ? '' : parseDice(e.target.value)
        if (d === null) { e.target.value = current ?? ''; return } // format invalide : on garde l'ancienne valeur
        onValid(d)
      },
    })
    // Ligne fermée : ✎ ouvre ses champs. Ligne ouverte : ✓ valide (referme), ↺ annule les changements faits depuis l'ouverture,
    // × supprime (après confirmation)
    const pencil = (cat, i, it) => mayEdit && h('button', { class: 'gs-line-btn gs-pencil', title: 'Modifier cette ligne', 'aria-label': 'Modifier cette ligne', onclick: () => openLine(cat.key, i, it) }, '✎')
    const lineButtons = (cat, i, list, change) => {
      const snap = lineSnaps.get(lineKey(cat.key, i))
      const isNew = snap === NEW_LINE
      const changed = isNew || (snap !== undefined && JSON.stringify(list[i]) !== snap)
      return h('span', { class: 'gs-line-btns' },
        h('button', { class: 'gs-line-btn', title: 'Valider cette ligne et fermer ses champs', 'aria-label': 'Valider cette ligne', onclick: () => { closeLine(cat.key, i); render() } }, '✓'),
        h('button', {
          class: 'gs-line-btn gs-line-undo', disabled: !changed, 'aria-label': 'Annuler les changements de cette ligne',
          title: isNew ? 'Annuler : la ligne qui vient d’être ajoutée est retirée' : changed ? 'Annuler les changements faits sur cette ligne' : 'Aucun changement à annuler',
          onclick: () => {
            closeLine(cat.key, i)
            if (isNew) { clearLines(cat.key); change((l) => l.filter((_, j) => j !== i)) } else change((l) => l.map((x, j) => (j === i ? JSON.parse(snap) : x)))
          },
        }, '↺'),
        h('button', { class: 'gs-line-btn gs-line-del', title: 'Supprimer cette ligne', 'aria-label': 'Supprimer cette ligne', onclick: () => { confirmingLine = lineKey(cat.key, i); render() } }, '×'))
    }
    // Confirmation de suppression d'une ligne (dans la ligne, sans boîte du navigateur)
    const lineConfirm = (cat, i, list, change) => confirmingLine === lineKey(cat.key, i) && h('div', { class: 'gs-line-confirm', role: 'alertdialog', 'aria-label': 'Confirmer la suppression de la ligne' },
      h('span', {}, `Supprimer ${(list[i]?.name ?? '').trim() ? `« ${list[i].name} »` : 'cette ligne'} ?`),
      h('button', { class: 'small', onclick: () => { confirmingLine = null; render() } }, 'Annuler'),
      h('button', { class: 'small danger', onclick: () => { clearLines(cat.key); change((l) => l.filter((_, j) => j !== i)) } }, 'Oui, supprimer'))
    const addLine = (cat, change, blank) => h('button', {
      class: 'small',
      onclick: () => change((l) => {
        editingLines.add(lineKey(cat.key, l.length))
        lineSnaps.set(lineKey(cat.key, l.length), NEW_LINE)
        return [...l, blank]
      }),
    }, cat.add)

    // Armes : ligne par défaut « Mains nues » (2d4 + modificateur de Force) tant que la liste n'a jamais été modifiée ; ensuite c'est une ligne
    // comme les autres, modifiable et supprimable
    const legacyUnarmed = live('unarmed', {})
    const weaponsNow = () => c.get('inventory:weapons') ?? [{ ...DEFAULT_WEAPON, dice: (legacyUnarmed.dice && parseDice(legacyUnarmed.dice)) || DEFAULT_WEAPON.dice, desc: legacyUnarmed.desc ?? '' }]
    // Pendant qu'on remplit une ligne, la fiche n'est pas encore redessinée : « ↺ » et le jet de la ligne sont mis à jour sur place
    const refreshOpenLine = (e, dice) => {
      const li = e.currentTarget
      const undo = li.querySelector('.gs-line-undo')
      if (undo) { undo.disabled = false; undo.title = 'Annuler les changements faits sur cette ligne' }
      if (dice) for (const b of li.querySelectorAll('.gs-roll-btn')) b.disabled = !parseDice(dice() ?? '')
    }
    const weaponRow = (cat, it, i, list, change) => {
      if (!lineOpen(cat.key, i)) {
        const r = withBonus(it)
        return h('li', {}, h('div', { class: 'gs-weapon-head' }, h('b', {}, it.name || 'Arme'),
          h('span', { class: 'gs-weapon-right' }, weaponRoll(r) && h('span', { class: 'gs-weapon-dmg', title: it.bonusStat ? `Jet : dés + modificateur de ${statLabel(it.bonusStat)}` : 'Jet : dés + valeur fixe' }, weaponRoll(r)), ctx.onRollWeapon && weaponButton(it), pencil(cat, i, it))),
        it.desc && h('p', {}, it.desc))
      }
      const patch = (p) => change((l) => patchAt(l, i, p))
      const now = () => weaponsNow()[i]
      return h('li', { class: 'gs-line-open', onchange: (e) => refreshOpenLine(e, () => now()?.dice) }, h('div', { class: 'gs-effect-edit' },
        h('input', { value: it.name ?? '', placeholder: 'Nom de l’arme', 'aria-label': 'Nom de l’arme', onchange: (e) => patch({ name: e.target.value }) }),
        lineButtons(cat, i, list, change),
        lineConfirm(cat, i, list, change),
        // Jet de dégâts : dés (nombre et faces, ex. 2d6) + valeur fixe (écrite, ou modificateur d'une caractéristique)
        h('div', { class: 'gs-weapon-roll' },
          diceInput(it.dice, (d) => patch({ dice: d })),
          h('span', { class: 'muted', 'aria-hidden': 'true' }, '+'),
          h('select', {
            class: 'gs-bonus-source', 'aria-label': 'Valeur ajoutée au résultat : valeur écrite ou modificateur', title: 'Valeur ajoutée au résultat des dés',
            onchange: (e) => patch({ bonusStat: e.target.value }),
          },
          h('option', { value: '', selected: !it.bonusStat }, 'Valeur écrite'),
          STATS.map((s) => h('option', { value: s.key, selected: s.key === it.bonusStat }, `Mod. ${s.label}`))),
          it.bonusStat
            ? h('span', { class: 'gs-bonus-auto', title: `Modificateur de ${statLabel(it.bonusStat)} : se met à jour tout seul` }, signed(resolveBonus(it)))
            : h('input', {
              type: 'number', class: 'num gs-bonus-input', value: num(it.bonus, 0), 'aria-label': 'Valeur fixe ajoutée au résultat', title: 'Valeur fixe ajoutée au résultat des dés (peut être négative)',
              onchange: (e) => patch({ bonus: num(e.target.value, 0) }),
            }),
          ctx.onRollWeapon && weaponButton(it, now)),
        h('textarea', { rows: 2, value: it.desc ?? '', placeholder: 'Description (particularités…)', 'aria-label': 'Description de l’arme', onchange: (e) => patch({ desc: e.target.value }) })))
    }
    const weaponsGroup = (cat, list, change) => h('div', { class: 'gs-inv-group gs-inv-weapons' }, h('div', { class: 'gs-inv-head' }, h('h4', {}, cat.label)),
      list.length ? h('ul', {}, list.map((it, i) => weaponRow(cat, it, i, list, change))) : h('p', { class: 'muted' }, 'Aucune'),
      mayEdit && addLine(cat, change, { name: '', desc: '', dice: '', bonus: 0, bonusStat: '' }))

    // Équipement, objets et sous-sections ajoutées : une ligne = un nom + une description
    const sections = live('inventory:sections', []) // [{ id, name }] sous-sections ajoutées, affichées dans la catégorie Objets
    const changeSections = (fn) => c.set('inventory:sections', fn(c.get('inventory:sections') ?? []))
    const simpleRow = (cat, it, i, list, change) => {
      if (!lineOpen(cat.key, i)) {
        return h('li', {}, h('div', { class: 'gs-weapon-head' }, h('b', {}, it.name || cat.label), pencil(cat, i, it)), it.desc && h('p', {}, it.desc))
      }
      const patch = (p) => change((l) => patchAt(l, i, p))
      return h('li', { class: 'gs-line-open', onchange: (e) => refreshOpenLine(e) }, h('div', { class: 'gs-effect-edit' },
        h('input', { value: it.name ?? '', placeholder: 'Nom', 'aria-label': `Nom (${cat.label})`, onchange: (e) => patch({ name: e.target.value }) }),
        lineButtons(cat, i, list, change),
        lineConfirm(cat, i, list, change),
        h('textarea', { rows: 2, value: it.desc ?? '', placeholder: 'Description', 'aria-label': `Description (${cat.label})`, onchange: (e) => patch({ desc: e.target.value }) })))
    }
    // En-tête d'une sous-section ajoutée : nom modifiable à la volée ; « Supprimer » seulement en mode « Modifier » (avec
    // confirmation), appliqué au clic sur « Terminer ». Armes, Équipement et Objets ne se suppriment pas.
    const subHead = (cat, list, custom) => h('div', { class: 'gs-inv-head' },
      mayEdit
        ? h('input', {
          class: 'gs-section-name', value: custom.name, maxLength: 40, 'aria-label': 'Nom de la sous-section',
          onchange: (e) => changeSections((l) => l.map((x) => (x.id === custom.id ? { ...x, name: e.target.value.trim() || x.name } : x))),
        })
        : h('h5', {}, custom.name),
      ed && (confirmingSection === custom.id
        ? h('span', { class: 'gs-inv-confirm' },
          h('span', {}, `Supprimer « ${custom.name} »${list.length > 1 ? ` et ses ${list.length} lignes` : list.length ? ' et sa ligne' : ''} ?`),
          h('button', { class: 'small', onclick: () => { confirmingSection = null; render() } }, 'Annuler'),
          h('button', { class: 'small danger', onclick: () => { confirmingSection = null; clearLines(cat.key); draft.removedSections.push(custom.id); render() } }, 'Oui, supprimer'))
        : h('button', { class: 'small danger', title: 'Supprimer cette sous-section (appliqué avec « Terminer »)', onclick: () => { confirmingSection = custom.id; render() } }, 'Supprimer')))
    const groupLines = (cat, list, change) => [
      list.length ? h('ul', {}, list.map((it, i) => simpleRow(cat, it, i, list, change))) : h('p', { class: 'muted' }, cat.empty),
      mayEdit && addLine(cat, change, { name: '', desc: '' }),
    ].filter(Boolean)
    const addSection = () => {
      const input = sheetEl.querySelector('.gs-add-section input')
      const name = (input?.value ?? '').trim()
      if (!name) { input?.focus(); return }
      changeSections((l) => [...l, { id: crypto.randomUUID().slice(0, 8), name }])
    }
    const listOf = (key) => ({ list: live(`inventory:${key}`, []), change: (fn) => c.set(`inventory:${key}`, fn(live(`inventory:${key}`, []))) })
    // Les sous-sections ajoutées s'affichent dans la catégorie Objets, sous ses propres lignes
    const subSections = () => sections.filter((sec) => !(ed && draft.removedSections.includes(sec.id))).map((sec) => {
      const cat = { key: `custom:${sec.id}`, label: sec.name, kind: 'simple', add: '+ Ligne', empty: 'Aucune ligne' }
      const { list, change } = listOf(cat.key)
      return h('div', { class: 'gs-inv-sub' }, subHead(cat, list, sec), groupLines(cat, list, change))
    })
    const simpleGroup = (cat) => {
      const { list, change } = listOf(cat.key)
      return h('div', { class: 'gs-inv-group' }, h('div', { class: 'gs-inv-head' }, h('h4', {}, cat.label)), groupLines(cat, list, change),
        cat.key === 'items' && subSections(),
        // Nouvelle sous-section (MJ et joueur propriétaire)
        cat.key === 'items' && mayEdit && h('div', { class: 'gs-add-section' },
          h('input', { placeholder: 'Nom d’une nouvelle sous-section', maxLength: 40, 'aria-label': 'Nom de la nouvelle sous-section', onkeydown: (e) => { if (e.key === 'Enter') { e.preventDefault(); addSection() } } }),
          h('button', { class: 'small', title: 'Ajouter une sous-section dans la catégorie Objets', onclick: addSection }, '+ Sous-section')))
    }

    const gran = num(live('gran'), 0)
    // À côté des caractéristiques : les Gran et les armes
    const inventory = h('section', { class: 'gs-sec gs-inventory' },
      h('div', { class: 'gs-gran', title: 'Gran : la monnaie' },
        h('span', { class: 'gran-logo', 'aria-hidden': 'true' }, 'G'),
        h('span', { class: 'gs-gran-label' }, 'Gran'),
        mayEdit
          // Largeur suivant le nombre, comme tous les champs numériques (autosize.js)
          ? h('input', {
            type: 'number', min: 0, class: 'num gs-gran-input', value: gran, 'aria-label': 'Nombre de Gran',
            onchange: (e) => c.set('gran', Math.max(0, num(e.target.value, 0))),
          })
          : h('b', { class: 'gs-gran-value' }, gran)),
      weaponsGroup(INVENTORY_CATEGORIES[0], weaponsNow(), (fn) => c.set('inventory:weapons', fn(weaponsNow()))))
    // Dessous : Équipement et Objets (qui contient les sous-sections ajoutées)
    const inventoryRest = h('section', { class: 'gs-sec gs-inventory-rest' }, h('h3', { class: 'gs-sec-title' }, 'Inventaire'),
      h('div', { class: 'gs-inv-groups' }, INVENTORY_CATEGORIES.filter((cat) => cat.kind !== 'weapon').map(simpleGroup)))

    // Fenêtre de confirmation : quitter la fiche avec des modifications non validées (ancrée en haut, couvre la partie visible)
    const modal = pendingDiscard && h('div', { class: 'gs-modal-anchor' },
      h('div', { class: 'gs-modal', style: `height:${sheetEl.clientHeight}px` },
        h('div', { class: 'gs-modal-card', role: 'alertdialog', 'aria-label': 'Modifications non validées' },
          h('h3', {}, 'Modifications non validées'),
          h('p', {}, 'Des modifications n’ont pas été validées avec « Terminer ». Si vous quittez maintenant, elles seront perdues.'),
          h('div', { class: 'gs-modal-actions' },
            h('button', { onclick: () => { pendingDiscard = null; render() } }, 'Revenir à la fiche'),
            h('button', { class: 'danger', onclick: () => { const t = pendingDiscard; endDraft(); t?.() } }, 'Quitter sans enregistrer')))))

    sheetEl.append(...[
      modal,
      h('header', { class: 'gs-head' }, portrait, identity, actions),
      gmTools,
      statusUi.sheet(openId, { canEdit: mayEdit, ed, draft: draft && { status: draft.status, touch: render } }),
      // Caractéristiques à côté des Gran et des armes ; le reste de l'inventaire dessous ; puis les effets sur toute la largeur
      h('div', { class: 'gs-body' }, statsTable, inventory),
      inventoryRest,
      h('div', { class: 'gs-effects-sec' }, effects),
      skills,
      !mayEdit && h('p', { class: 'readonly-note' }, owner ? `Lecture seule : fiche de ${owner}` : 'Lecture seule'),
    ].filter(Boolean))

    async function pickPortrait() {
      const input = h('input', { type: 'file', accept: 'image/*' })
      input.addEventListener('change', async () => {
        const file = input.files[0]
        if (!file) return
        try {
          if (draft) { draft.portrait = await shrink(file); render() }
        } catch {
          alert('Image illisible.')
        }
      })
      input.click()
    }
  }

  function field(label, control) {
    return h('label', { class: 'gs-field' }, h('span', {}, label), control)
  }

  characters.observeDeep(() => { if (openId) render() })
  portraits.observe(() => { if (openId) render() })
  st.status.observe(() => { if (openId) render() })

  return {
    open(id) { if (id !== openId) open(id) },
    /** Vignette Aventuriers : ouvre la fiche, ou la ferme si c'est déjà celle qui est ouverte */
    toggle(id) { if (id === openId) askLeave(closeNow); else open(id) },
    close() { if (openId) askLeave(closeNow) },
    /** Ferme la fiche sauf si elle est détachée (changer d'onglet ne la ferme pas) */
    closeDocked() { if (openId && !detached()) askLeave(closeNow) },
    create,
    /** À appeler quand le profil, le rôle ou la liste des profils change */
    rerender() { if (openId) render() },
  }
}
