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
//   skills:<catégorie>               [{ name, level }] compétences (SKILL_CATEGORIES), level = connaissance | expertise | maitrise ;
//                                    le bonus (+1 / +2 / +3) se déduit du niveau, jamais stocké
//   player                           joueur propriétaire (profil joueur, choisi par le MJ)
// Les listes et les caractéristiques sont des valeurs simples (remplacées en entier à chaque modification) :
// export / import directs ; une caractéristique par clé pour que deux personnes n'écrasent pas leurs modifications.
// Image : doc.getMap('portraits') (id du personnage → { type, data: Uint8Array }, WebP ≤ PORTRAIT_SIZE px).
// Droits : toutes les fiches sont visibles de tous ; le MJ et le joueur propriétaire modifient (les autres joueurs
// et les observateurs : lecture seule) ; création, suppression et choix du joueur : MJ seul.
import * as Y from 'yjs'
import { h, liveRender } from '../../src/dom.js'

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
const PORTRAIT_SIZE = 512

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
 *         onRoll(libellé, valeur demandée) → jet d'une caractéristique }
 * Renvoie { open(id), close(), create(), rerender() }
 */
export function setupGrandalSheets(ctx) {
  const characters = ctx.doc.getMap('characters')
  const portraits = ctx.doc.getMap('portraits')
  const sheetEl = document.getElementById('sheet')
  let openId = null
  let editing = false

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

  function close() {
    openId = null
    editing = false
    sheetEl.hidden = true
    sheetEl.innerHTML = ''
  }
  function open(id) {
    if (!characters.has(id)) return
    if (id !== openId) editing = false
    ctx.onOpen?.()
    openId = id
    sheetEl.hidden = false
    render()
  }
  function create() {
    if (!ctx.me().isGM) return
    const id = crypto.randomUUID()
    characters.set(id, newCharacter())
    open(id)
    editing = true
    render()
  }
  function remove(id, name) {
    if (!ctx.me().isGM) return
    if (!confirm(`Supprimer définitivement la fiche de ${name} (son image, son jeton et sa place dans les vignettes) ?\nPensez à exporter la partie avant si vous voulez pouvoir la récupérer.`)) return
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
    close()
  }

  const render = liveRender(sheetEl, build)

  function build() {
    const c = characters.get(openId)
    if (!c || !canSee(c)) return close()
    const isGM = ctx.me().isGM
    const mayEdit = canEdit(c)
    const ed = editing && mayEdit
    const get = (k, def = '') => c.get(k) ?? def
    const set = (k) => (e) => c.set(k, e.target.value)
    const owner = ownerName(c)

    // ---- Généralités ----
    const url = portraitUrl(openId)
    const portrait = h('div', { class: `gs-portrait${url ? '' : ' empty'}` },
      url ? h('img', { src: url, alt: `Portrait de ${get('name')}` }) : h('span', { class: 'gs-portrait-mark', 'aria-hidden': 'true' }, '❦'),
      ed && h('div', { class: 'gs-portrait-tools' },
        h('button', { class: 'small', onclick: pickPortrait }, url ? 'Changer' : 'Importer'),
        url && h('button', { class: 'small', onclick: () => portraits.delete(openId) }, 'Retirer')))

    const classes = get('classes', [])
    const setClasses = (list) => c.set('classes', list)
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
          ? field('Niveau', h('input', { type: 'number', min: 0, class: 'num', value: num(get('level'), 1), onchange: (e) => c.set('level', num(e.target.value, 1)) }))
          : h('span', { class: 'gs-lv' }, `LV ${num(get('level'), 1)}`),
        h('ul', { class: 'gs-classes' },
          classes.map((cl, i) => ed
            ? h('li', { class: 'gs-class-edit' },
              h('input', { value: cl.name ?? '', placeholder: 'Classe', 'aria-label': 'Classe', onchange: (e) => setClasses(classes.map((x, j) => (j === i ? { ...x, name: e.target.value } : x))) }),
              h('span', {}, 'LV'),
              h('input', { type: 'number', min: 0, class: 'num', value: num(cl.level, 1), 'aria-label': 'Niveau de classe', onchange: (e) => setClasses(classes.map((x, j) => (j === i ? { ...x, level: num(e.target.value, 1) } : x))) }),
              h('button', { class: 'icon', title: 'Retirer la classe', onclick: () => setClasses(classes.filter((_, j) => j !== i)) }, '×'))
            : h('li', {}, h('span', { class: 'gs-class-name' }, cl.name || 'Classe'), ' ', h('b', {}, `LV ${num(cl.level, 1)}`))),
          !ed && !classes.length && h('li', { class: 'muted' }, 'Aucune classe')),
        ed && h('button', { class: 'small', onclick: () => setClasses([...classes, { name: '', level: 1 }]) }, '+ Classe')))

    // ---- En-tête : actions ----
    const actions = h('div', { class: 'gs-actions' },
      !ed && owner && h('span', { class: 'tag' }, `Joueur · ${owner}`),
      mayEdit && h('button', { class: ed ? 'small primary' : 'small', onclick: () => { editing = !editing; render() } }, ed ? 'Terminer' : 'Modifier'),
      // Croix dessinée en CSS (deux traits) : le caractère « × » n'est jamais centré pile, selon la police
      h('button', { class: 'gs-close', title: 'Fermer la fiche', 'aria-label': 'Fermer la fiche', onclick: close }))

    // MJ : joueur propriétaire, suppression
    const gmTools = ed && isGM && h('div', { class: 'gs-gm' },
      field('Joueur', h('select', { onchange: set('player') },
        h('option', { value: '', selected: !owner }, '— Aucun —'),
        ctx.playerChoices().map((n) => h('option', { value: n, selected: n === owner }, n)))),
      h('button', { class: 'small danger', onclick: () => remove(openId, get('name')) }, 'Supprimer la fiche'))

    // ---- Effets passifs ----
    const effects = h('section', { class: 'gs-sec' }, h('h3', { class: 'gs-sec-title' }, 'Effets passifs'),
      h('div', { class: 'gs-effects' }, EFFECTS.map(({ key, label }) => {
        const k = `effects:${key}`
        const list = get(k, [])
        const setList = (l) => c.set(k, l)
        const shown = list.filter((fx) => (fx.name ?? '').trim() || (fx.desc ?? '').trim()) // consultation : sans les effets vides
        return h('div', { class: 'gs-effect-group' }, h('h4', {}, label),
          ed
            ? [...list.map((fx, i) => h('div', { class: 'gs-effect-edit' },
              h('input', { value: fx.name ?? '', placeholder: 'Nom de l’effet', 'aria-label': 'Nom de l’effet', onchange: (e) => setList(list.map((x, j) => (j === i ? { ...x, name: e.target.value } : x))) }),
              h('button', { class: 'icon', title: 'Retirer l’effet', onclick: () => setList(list.filter((_, j) => j !== i)) }, '×'),
              h('textarea', { rows: 2, value: fx.desc ?? '', placeholder: 'Description', 'aria-label': 'Description de l’effet', onchange: (e) => setList(list.map((x, j) => (j === i ? { ...x, desc: e.target.value } : x))) }))),
            h('button', { class: 'small', onclick: () => setList([...list, { name: '', desc: '' }]) }, '+ Effet')]
            : shown.length
              ? h('ul', {}, shown.map((fx) => h('li', {}, h('b', {}, fx.name || 'Effet'), fx.desc && h('p', {}, fx.desc))))
              : h('p', { class: 'muted' }, 'Aucun'))
      })))

    // ---- Caractéristiques : 9 lignes (3 puis 6), 3 colonnes (nom, valeur, modificateur calculé) ----
    // Caractéristique jamais saisie (ou champ vidé) : STAT_DEFAULT, soit un modificateur de +0
    const statBase = (key) => num(c.get(`stat:${key}`)?.value, STAT_DEFAULT)
    const statAdj = (key) => num(c.get(`stat:${key}`)?.adj, 0)
    const statValue = (key) => statBase(key) + statAdj(key) // valeur effective
    // Écriture d'un des deux champs sans écraser l'autre ; adj = 0 n'est pas stocké
    const writeStat = (key, base, adj) => c.set(`stat:${key}`, adj ? { value: base, adj } : { value: base })
    const setStat = (key) => (e) => writeStat(key, num(e.target.value, STAT_DEFAULT), statAdj(key))
    const setAdj = (key, adj) => writeStat(key, statBase(key), adj)
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
              h('button', { class: 'gs-step', title: 'Diminuer la valeur effective', 'aria-label': `${label} : diminuer la valeur effective`, onclick: () => setAdj(key, adj - 1) }, '−'),
              h('input', { type: 'number', class: 'num', value, 'aria-label': `${label} : valeur effective`, onchange: (e) => setAdj(key, num(e.target.value, value) - base) }),
              h('button', { class: 'gs-step', title: 'Augmenter la valeur effective', 'aria-label': `${label} : augmenter la valeur effective`, onclick: () => setAdj(key, adj + 1) }, '+'),
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
        const setList = (l) => c.set(k, l)
        const patch = (i, p) => setList(list.map((x, j) => (j === i ? { ...x, ...p } : x)))
        const shown = list.filter((sk) => (sk.name ?? '').trim())
        return h('div', { class: 'gs-skill-group' }, h('h4', {}, label),
          ed
            ? [...list.map((sk, i) => h('div', { class: 'gs-skill-edit' },
              h('input', { value: sk.name ?? '', placeholder: 'Nom', 'aria-label': `Nom de la compétence (${label})`, onchange: (e) => patch(i, { name: e.target.value }) }),
              h('select', { 'aria-label': 'Niveau d’apprentissage', onchange: (e) => patch(i, { level: e.target.value }) },
                SKILL_LEVELS.map((l) => h('option', { value: l.key, selected: l.key === skillLevel(sk.level).key }, l.label))),
              h('span', { class: 'gs-skill-bonus' }, `+${skillLevel(sk.level).bonus}`),
              h('button', { class: 'icon', title: 'Retirer la compétence', onclick: () => setList(list.filter((_, j) => j !== i)) }, '×'))),
            h('button', { class: 'small', onclick: () => setList([...list, { name: '', level: 'connaissance' }]) }, '+ Compétence')]
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

    sheetEl.append(...[
      h('header', { class: 'gs-head' }, portrait, identity, actions),
      gmTools,
      h('div', { class: 'gs-body' }, statsTable, effects),
      skills,
      !mayEdit && h('p', { class: 'readonly-note' }, owner ? `Lecture seule : fiche de ${owner}` : 'Lecture seule'),
    ].filter(Boolean))

    async function pickPortrait() {
      const input = h('input', { type: 'file', accept: 'image/*' })
      input.addEventListener('change', async () => {
        const file = input.files[0]
        if (!file) return
        try {
          portraits.set(openId, await shrink(file))
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

  return {
    open(id) { if (id !== openId) open(id) },
    close() { if (openId) close() },
    create,
    /** À appeler quand le profil, le rôle ou la liste des profils change */
    rerender() { if (openId) render() },
  }
}
