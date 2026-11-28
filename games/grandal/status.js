// Grandal : section « Statut » d'un personnage (HP, MP, SPD, EP, SS, SP), affichée sur la fiche, les vignettes de
// l'onglet Fiches et les cases « Aventuriers » du plateau.
// Données : doc.getMap('status'), une clé par valeur (`<id>|<clé>`) pour que deux personnes qui modifient deux valeurs
// différentes ne s'écrasent pas :
//   hp / hpMax        points de vie            (maximum 10 par défaut, valeur courante = maximum tant qu'elle n'est pas saisie ;
//                                               les HP peuvent descendre jusqu'à −maximum : seule valeur négative du statut)
//   mana / manaMax    points de mana (MP)      (clé « mana » conservée : les parties existantes restent valables)
//   spd / spdAdj      vitesse : valeur de base (6 par défaut) et écart temporaire (+/−) ; valeur effective = base + écart
//   ep / epMax        points d'énergie         (maximum 5 par défaut)
//   epExtra           EP supplémentaires au-delà du maximum, distincts des autres : consommés, ils disparaissent (0 par défaut)
//   ss<n> / ssMax<n>  emplacements de sorts du niveau n (1 à 10), maximum 0 par défaut
//   sp / spMax        points spéciaux          (maximum 3 par défaut)
// Pour les points « consommables » (EP, SS, SP) : valeur courante = points disponibles, les points consommés sont grisés.
import { h } from '../../src/dom.js'

export const SS_LEVELS = 10
export const SPD_DEFAULT = 6
export const SHIFT_STEP = 10 // Maj + clic sur un bouton − / + : de 10 en 10
export const stepOf = (e) => (e.shiftKey ? SHIFT_STEP : 1)
// Jauges : HP et MP (barre), EP et SP (pastilles) ; `key` = clé de la valeur courante, `max` = clé du maximum
export const RES = {
  hp: { key: 'hp', max: 'hpMax', def: 10, label: 'HP', title: 'Points de vie' },
  mp: { key: 'mana', max: 'manaMax', def: 10, label: 'MP', title: 'Points de mana' },
  ep: { key: 'ep', max: 'epMax', def: 5, label: 'EP', title: 'Points d’énergie', shape: 'diamond' },
  sp: { key: 'sp', max: 'spMax', def: 3, label: 'SP', title: 'Points spéciaux', shape: 'round' },
}
const SS = (n) => ({ key: `ss${n}`, max: `ssMax${n}`, def: 0, label: `SS ${n}`, title: `Emplacements de sorts de niveau ${n}`, shape: 'square' })

/** Données de statut du Y.Doc : lecture avec valeurs par défaut, écriture bornée, actions rapides */
export function setupStatus(doc) {
  const status = doc.getMap('status')
  const raw = (id, k) => { const v = status.get(`${id}|${k}`); return typeof v === 'number' ? v : undefined }
  const put = (id, k, n) => { if (Number.isFinite(n)) status.set(`${id}|${k}`, Math.max(0, Math.round(n))) }

  /** { cur, max } d'une ressource (res = entrée de RES ou SS(n)) */
  // (les HP sont les seuls à pouvoir être négatifs : de −max à max)
  const lowest = (res, max) => (res === RES.hp ? -max : 0)
  const read = (id, res) => {
    const max = raw(id, res.max) ?? res.def
    return { cur: Math.max(lowest(res, max), Math.min(raw(id, res.key) ?? max, max)), max }
  }
  /** Plafond relu au moment d'écrire : le maximum a pu changer entre-temps (autre joueur, autre champ) */
  const setCur = (id, res, n) => {
    if (!Number.isFinite(n)) return
    const { max } = read(id, res)
    status.set(`${id}|${res.key}`, Math.max(lowest(res, max), Math.min(Math.round(n), max)))
  }
  const setMax = (id, res, n) => put(id, res.max, n)
  const spd = (id) => {
    const base = raw(id, 'spd') ?? SPD_DEFAULT
    const adj = Math.round(Number(status.get(`${id}|spdAdj`)) || 0)
    return { base, adj, eff: base + adj }
  }
  const extra = (id) => raw(id, 'epExtra') ?? 0
  const setExtra = (id, n) => put(id, 'epExtra', n)
  const addExtra = (id) => setExtra(id, extra(id) + 1)
  // Consommer un EP : les EP supplémentaires partent d'abord (ils disparaissent), puis ceux du maximum (ils se grisent)
  const spendEp = (id) => { if (extra(id) > 0) setExtra(id, extra(id) - 1); else setCur(id, RES.ep, read(id, RES.ep).cur - 1) }
  // Rendre un EP : celui du maximum d'abord ; une fois le maximum atteint, le suivant est un EP supplémentaire
  const restoreEp = (id) => { const { cur, max } = read(id, RES.ep); if (cur < max) setCur(id, RES.ep, cur + 1); else addExtra(id) }
  const setSpdBase = (id, n) => put(id, 'spd', n)
  const setSpdAdj = (id, n) => { if (Number.isFinite(n)) status.set(`${id}|spdAdj`, Math.round(n)) } // l'écart peut être négatif
  /** Clic sur la pastille i : elle devient la dernière disponible (ou, si elle l'était déjà, elle est consommée) */
  const togglePip = (id, res, i) => { const { cur } = read(id, res); setCur(id, res, cur === i + 1 ? i : i + 1) }

  const ssAll = (id) => Array.from({ length: SS_LEVELS }, (_, i) => ({ n: i + 1, res: SS(i + 1), ...read(id, SS(i + 1)) }))
  const ssTotal = (id) => ssAll(id).reduce((t, s) => ({ cur: t.cur + s.cur, max: t.max + s.max }), { cur: 0, max: 0 })
  // Actions rapides des cases du plateau, où un seul nombre résume tous les niveaux :
  // consommer = un emplacement du plus bas niveau disponible ; rendre = un emplacement du plus haut niveau consommé
  const ssSpend = (id) => { const s = ssAll(id).find((x) => x.cur > 0); if (s) setCur(id, s.res, s.cur - 1) }
  const ssRestore = (id) => { const s = ssAll(id).reverse().find((x) => x.cur < x.max); if (s) setCur(id, s.res, s.cur + 1) }

  return { status, raw, putRaw: put, extra, setExtra, addExtra, spendEp, restoreEp, read, setCur, setMax, spd, setSpdBase, setSpdAdj, togglePip, ssAll, ssTotal, ssSpend, ssRestore }
}

// ---------- Éléments d'affichage ----------
/** Jauge (HP, MP) : barre + « courant / maximum » */
function gauge(res, cur, max, cls = '') {
  // HP sous zéro : une barre sombre rayée remplace la barre rouge et se remplit jusqu'à −max (la barre rouge reste vide au-dessus de 0)
  if (res === RES.hp && cur < 0) {
    const neg = max > 0 ? Math.round((Math.min(-cur, max) / max) * 100) : 100
    return h('div', { class: `st-gauge st-hp is-neg ${cls}`, title: `${res.title} : ${cur} / ${max} (peuvent descendre jusqu'à −${max})` },
      h('span', { class: 'st-neg-fill', style: `width:${neg}%` }),
      h('span', { class: 'st-gauge-text' }, `−${-cur} / ${max}`))
  }
  const pct = max > 0 ? Math.round((cur / max) * 100) : 0
  return h('div', { class: `st-gauge st-${res === RES.hp ? 'hp' : 'mp'} ${cls}`, title: `${res.title} : ${cur} / ${max}` },
    h('span', { class: 'st-gauge-fill', style: `width:${pct}%` }),
    h('span', { class: 'st-gauge-text' }, `${cur} / ${max}`))
}

/** Rangée de pastilles (losanges, carrés, ronds) ; `onPick(i)` la rend cliquable, sinon lecture seule */
function pips(res, cur, max, onPick, extra = 0, onExtra = null) {
  const items = Array.from({ length: max }, (_, i) => {
    const used = i >= cur
    const attrs = { class: `st-pip st-${res.shape}${used ? ' used' : ''}`, title: `${res.title} : ${cur} / ${max}${onPick ? ' — cliquer pour consommer / rendre' : ''}` }
    return onPick
      ? h('button', { ...attrs, type: 'button', 'aria-label': `${res.label} ${i + 1} sur ${max} (${used ? 'consommé' : 'disponible'})`, onclick: (e) => { e.stopPropagation(); onPick(i) } })
      : h('span', attrs)
  })
  // EP supplémentaires : losanges d'une autre teinte, qui disparaissent quand on les consomme (un clic)
  const extras = Array.from({ length: extra }, () => {
    const attrs = { class: 'st-pip st-diamond st-extra', title: `EP supplémentaire (au-delà du maximum)${onExtra ? ' — cliquer pour le consommer : il disparaît' : ''}` }
    return onExtra
      ? h('button', { ...attrs, type: 'button', 'aria-label': 'EP supplémentaire : consommer', onclick: (e) => { e.stopPropagation(); onExtra() } })
      : h('span', attrs)
  })
  return h('span', { class: 'st-pips' }, items.length || extras.length ? [...items, ...(extras.length ? [h('span', { class: 'st-extras' }, extras)] : [])] : h('span', { class: 'muted st-none' }, 'aucun'))
}

/**
 * Constructeur des affichages du statut.
 * st = setupStatus(doc) ; canEdit = le MJ ou le joueur propriétaire (les autres : lecture seule).
 */
export function statusViews(st) {
  const num = (value, onchange, attrs = {}) => h('input', { type: 'number', min: 0, class: 'num', value, onchange: (e) => onchange(Number(e.target.value)), ...attrs })
  // Valeur courante : les HP peuvent être négatifs (jusqu'à −maximum)
  const curInput = (id, res, v) => num(v.cur, (n) => st.setCur(id, res, n), { min: res === RES.hp ? -v.max : 0, 'aria-label': `${res.label} : valeur courante` })

  // Vitesse : base (grisée) + valeur effective, ajustable à la volée comme dans le tableau des caractéristiques
  function spdControl(id, canEdit, { withBase = true, base: baseOverride } = {}) {
    const s0 = st.spd(id)
    const base = baseOverride ?? s0.base
    const adj = s0.adj
    const eff = base + adj
    return h('span', { class: `st-spd${adj > 0 ? ' up' : adj < 0 ? ' down' : ''}`, title: adj ? `Base ${base} ${adj > 0 ? '+' : '−'} ${Math.abs(adj)}` : 'Vitesse effective = vitesse de base' },
      withBase && h('span', { class: 'st-spd-base', title: 'Vitesse de base' }, `Base ${base}`),
      canEdit
        ? h('span', { class: 'gs-eff-ctl' },
          h('button', { class: 'gs-step', title: `Diminuer la vitesse effective (Maj + clic : −${SHIFT_STEP})`, 'aria-label': 'SPD : diminuer la vitesse effective', onclick: (e) => { e.stopPropagation(); st.setSpdAdj(id, st.spd(id).adj - stepOf(e)) } }, '−'),
          // Place réservée au nombre : le champ s'élargit à l'intérieur, les boutons − / + ne bougent pas
          h('span', { class: 'gs-num-slot' }, h('input', { type: 'number', class: 'num', value: eff, 'aria-label': 'SPD : vitesse effective', onchange: (e) => st.setSpdAdj(id, (Number.isFinite(Number(e.target.value)) && e.target.value !== '' ? Math.round(Number(e.target.value)) : eff) - base) })),
          h('button', { class: 'gs-step', title: `Augmenter la vitesse effective (Maj + clic : +${SHIFT_STEP})`, 'aria-label': 'SPD : augmenter la vitesse effective', onclick: (e) => { e.stopPropagation(); st.setSpdAdj(id, st.spd(id).adj + stepOf(e)) } }, '+'),
          h('button', { class: `gs-step gs-reset${adj ? '' : ' ghost'}`, disabled: !adj, title: `Revenir à la vitesse de base (${base})`, 'aria-label': 'SPD : revenir à la vitesse de base', onclick: (e) => { e.stopPropagation(); st.setSpdAdj(id, 0) } }, '↺'))
        : h('b', { class: 'st-spd-eff' }, eff))
  }

  /**
   * Section « Statut » complète de la fiche. ed = fiche en modification (maximums et vitesse de base modifiables).
   * draft = { status, touch() } : brouillon de la fiche ; en modification, les maximums et la vitesse de base y sont écrits
   * (`status` : clé → nombre) au lieu d'aller dans le Y.Doc, et ne sont appliqués qu'au clic sur « Terminer ».
   */
  function sheet(id, { canEdit, ed, draft }) {
    const ov = ed && draft ? draft.status : null
    // Lecture avec le brouillon : un maximum modifié s'applique tout de suite à l'affichage
    const rd = (res) => {
      const max = ov && res.max in ov ? ov[res.max] : st.read(id, res).max
      const rawCur = st.raw(id, res.key)
      return { cur: Math.max(res === RES.hp ? -max : 0, Math.min(rawCur ?? max, max)), max }
    }
    const setMaxD = (res, n) => { if (ov) { if (Number.isFinite(n)) { ov[res.max] = Math.max(0, Math.round(n)); draft.touch() } } else st.setMax(id, res, n) }
    const hp = rd(RES.hp)
    const mp = rd(RES.mp)
    const bar = (res, v, cls) => h('div', { class: `st-block st-block-${cls}` },
      h('div', { class: 'st-head' }, h('h4', { title: res.title }, res.label),
        canEdit && h('span', { class: 'st-edit' },
          curInput(id, res, v), h('span', { class: 'muted' }, '/'),
          ed ? num(v.max, (n) => setMaxD(res, n), { 'aria-label': `${res.label} : maximum` }) : h('b', { title: 'Le maximum se modifie avec le bouton « Modifier » de la fiche' }, v.max))),
      gauge(res, v.cur, v.max, 'big'))
    const pool = (res, cls) => {
      const v = rd(res)
      const extra = res === RES.ep ? st.extra(id) : 0
      return h('div', { class: `st-block st-block-${cls}` },
        h('div', { class: 'st-head' }, h('h4', { title: res.title }, res.label),
          h('span', { class: 'st-count' }, `${v.cur} / ${v.max}${extra ? ` + ${extra}` : ''}`),
          res === RES.ep && canEdit && h('button', { class: 'small st-add', title: 'Ajouter un EP supplémentaire (au-delà du maximum)', onclick: () => st.addExtra(id) }, '+ EP'),
          ed && h('span', { class: 'st-edit' }, h('span', { class: 'muted' }, 'max'), num(v.max, (n) => setMaxD(res, n), { 'aria-label': `${res.label} : maximum` }))),
        pips(res, v.cur, v.max, canEdit && ((i) => st.togglePip(id, res, i)), extra, canEdit && (() => st.setExtra(id, st.extra(id) - 1))))
    }
    const spd = st.spd(id)
    const spdBase = ov && 'spd' in ov ? ov.spd : spd.base
    const setSpdBaseD = (n) => { if (ov) { if (Number.isFinite(n)) { ov.spd = Math.max(0, Math.round(n)); draft.touch() } } else st.setSpdBase(id, n) }
    return h('section', { class: 'gs-sec gs-status' }, h('h3', { class: 'gs-sec-title' }, 'Statut'),
      h('div', { class: 'st-grid' },
        bar(RES.hp, hp, 'hp'),
        bar(RES.mp, mp, 'mp'),
        h('div', { class: 'st-block st-block-spd' },
          h('div', { class: 'st-head' }, h('h4', { title: 'Vitesse' }, 'SPD'),
            ed && h('span', { class: 'st-edit' }, h('span', { class: 'muted' }, 'base'), num(spdBase, (n) => setSpdBaseD(n), { 'aria-label': 'SPD : vitesse de base' }))),
          spdControl(id, canEdit, { base: spdBase })),
        pool(RES.ep, 'ep'),
        pool(RES.sp, 'sp')),
      // Emplacements de sorts : une ligne par niveau, de 1 à 10
      h('div', { class: 'st-block st-block-ss' },
        h('div', { class: 'st-head' }, h('h4', { title: 'Emplacements de sorts' }, 'SS')),
        h('div', { class: 'st-ss-lines' }, st.ssAll(id).map(({ n, res }) => {
          const { cur, max } = rd(res)
          return h('div', { class: 'st-ss-line' },
            h('span', { class: 'st-ss-level' }, `Niv. ${n}`),
            pips(res, cur, max, canEdit && ((i) => st.togglePip(id, res, i))),
            h('span', { class: 'st-count' }, max ? `${cur} / ${max}` : ''),
            ed && h('span', { class: 'st-edit' }, h('span', { class: 'muted' }, 'max'), num(max, (v) => setMaxD(res, v), { 'aria-label': `SS niveau ${n} : maximum` })))
        }))))
  }

  /** Vignette de l'onglet Fiches : tout le statut sauf HP et MP (déjà là, avec leurs champs) */
  function card(id, canEdit) {
    const pool = (res, cls) => {
      const v = st.read(id, res)
      const extra = res === RES.ep ? st.extra(id) : 0
      return h('div', { class: `st-row st-row-${cls}` }, h('span', { class: 'st-row-label', title: res.title }, res.label),
        pips(res, v.cur, v.max, canEdit && ((i) => st.togglePip(id, res, i)), extra, canEdit && (() => st.setExtra(id, st.extra(id) - 1))),
        res === RES.ep && canEdit && h('button', { class: 'small st-add', title: 'Ajouter un EP supplémentaire (au-delà du maximum)', onclick: (e) => { e.stopPropagation(); st.addExtra(id) } }, '+ EP'))
    }
    const lines = st.ssAll(id).filter((s) => s.max > 0)
    return h('div', { class: 'st-card' },
      h('div', { class: 'st-row st-row-spd' }, h('span', { class: 'st-row-label', title: 'Vitesse' }, 'SPD'), spdControl(id, canEdit)),
      pool(RES.ep, 'ep'),
      pool(RES.sp, 'sp'),
      lines.length > 0 && h('div', { class: 'st-row st-row-ss' }, h('span', { class: 'st-row-label', title: 'Emplacements de sorts' }, 'SS'),
        h('div', { class: 'st-ss-lines' }, lines.map(({ n, res, cur, max }) =>
          h('div', { class: 'st-ss-line' }, h('span', { class: 'st-ss-level' }, `Niv. ${n}`), pips(res, cur, max, canEdit && ((i) => st.togglePip(id, res, i))))))))
  }

  /**
   * Case « Aventuriers » du plateau : une pastille + un nombre par ressource (place limitée).
   * Clic = −1 (consommer), clic droit ou Maj + clic = +1 (rendre) ; pour les SS, voir ssSpend / ssRestore.
   */
  function chips(id, canEdit) {
    const chip = (cls, shape, text, title, minus, plus) => {
      const attrs = { class: `st-chip st-chip-${cls}`, title: canEdit && minus ? `${title}\nClic : −1 · clic droit ou Maj + clic : +1` : title }
      const body = [shape && h('span', { class: `st-pip st-${shape}` }), h('span', { class: 'st-chip-text' }, text)]
      return canEdit && minus
        ? h('button', {
          ...attrs, type: 'button',
          onclick: (e) => { e.stopPropagation(); e.shiftKey ? plus() : minus() },
          oncontextmenu: (e) => { e.preventDefault(); e.stopPropagation(); plus() },
        }, ...body)
        : h('span', attrs, ...body)
    }
    const pool = (res, cls) => {
      const { cur, max } = st.read(id, res)
      const extra = res === RES.ep ? st.extra(id) : 0
      const text = extra ? `${cur}+${extra}` : `${cur}`
      const title = `${res.title} : ${cur} / ${max}${extra ? ` + ${extra} supplémentaire${extra > 1 ? 's' : ''}` : ''}`
      // EP : les supplémentaires partent d'abord (ils disparaissent)
      // EP : −1 consomme d'abord les supplémentaires ; +1 rend un EP du maximum puis, le maximum atteint, ajoute un EP supplémentaire
      return chip(cls, res.shape, text, title, res === RES.ep ? () => st.spendEp(id) : () => st.setCur(id, res, cur - 1), res === RES.ep ? () => st.restoreEp(id) : () => st.setCur(id, res, cur + 1))
    }
    const spd = st.spd(id)
    const ss = st.ssTotal(id)
    return h('div', { class: 'st-chips' },
      // Vitesse : lecture seule ici (elle se modifie dans l'onglet Fiches et sur la fiche)
      chip(`spd${spd.adj > 0 ? ' up' : spd.adj < 0 ? ' down' : ''}`, null, `SPD ${spd.eff}`, spd.adj ? `Vitesse : base ${spd.base}, effective ${spd.eff}\n(modifiable dans l'onglet Fiches ou sur la fiche)` : `Vitesse : ${spd.eff}\n(modifiable dans l'onglet Fiches ou sur la fiche)`, null, null),
      pool(RES.ep, 'ep'),
      chip('ss', 'square', `${ss.cur}`, `Emplacements de sorts : ${ss.cur} / ${ss.max} (tous niveaux)\nClic : consomme un emplacement du plus bas niveau · rend un emplacement du plus haut niveau consommé`, () => st.ssSpend(id), () => st.ssRestore(id)),
      pool(RES.sp, 'sp'))
  }

  return { sheet, card, chips, gauge }
}
