// Grandal : jets de dés « valeur ou plus » — Starboard garde src/dice.js (« sous la valeur »).
// Règles : uniquement des d20 ; réussite si le dé est SUPÉRIEUR OU ÉGAL à la valeur demandée ;
// 20 = réussite critique (toujours), 1 = échec critique (toujours).
// Avantage / désavantage : deux d20, on garde le plus haut / le plus bas (le dé gardé décide aussi du critique).
import { OUTCOME_LABEL, MODE_LABEL, rollFree } from '../../src/dice.js'

export { OUTCOME_LABEL, MODE_LABEL }
export const SIDES = 20

function rollDie() {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return 1 + (buf[0] % SIDES)
}

/** Résultat d'un d20 contre une valeur demandée */
export function judge(value, target) {
  if (value === 20) return 'crit-success'
  if (value === 1) return 'crit-fail'
  return value >= target ? 'success' : 'fail'
}

/** Dé gardé parmi un ou deux : le plus haut en avantage, le plus bas en désavantage */
export function pick(values, target, mode) {
  const kept = values.length === 1 ? values[0] : mode === 'dis' ? Math.min(...values) : Math.max(...values)
  return { kept, outcome: judge(kept, target) }
}

/** Jet d'un d20 (deux en avantage / désavantage) contre une valeur demandée */
export function roll(target, mode = 'normal') {
  const values = mode === 'normal' ? [rollDie()] : [rollDie(), rollDie()]
  return { sides: SIDES, target, mode, values, rule: 'over', ...pick(values, target, mode) }
}

/** Jet de dégâts : `count` dés à `faces` faces, plus une valeur fixe (sans notion de réussite) */
export function rollDamage(count, faces, bonus = 0) {
  const values = Array.from({ length: count }, () => {
    const buf = new Uint32Array(1)
    crypto.getRandomValues(buf)
    return 1 + (buf[0] % faces)
  })
  return { count, faces, bonus, values, total: values.reduce((a, b) => a + b, 0) + bonus }
}

/** Jet libre d'un d20, sans valeur demandée */
export const rollFreeD20 = () => rollFree(SIDES)

// Vérification rapide : node games/grandal/dice.js
if (typeof process !== 'undefined' && process.argv?.[1]?.replace(/\\/g, '/').endsWith('grandal/dice.js')) {
  const eq = (x, y) => { if (x !== y) throw new Error(`${x} ≠ ${y}`) }
  eq(judge(11, 10), 'success') //    supérieur
  eq(judge(10, 10), 'success') //    égal = réussite
  eq(judge(9, 10), 'fail')
  eq(judge(20, 25), 'crit-success') // 20 réussit toujours, même au-dessus de 20
  eq(judge(1, 0), 'crit-fail') //    1 échoue toujours, même contre 0
  eq(pick([1, 15], 10, 'adv').outcome, 'success') // avantage : on garde 15
  eq(pick([20, 5], 10, 'dis').outcome, 'fail') //    désavantage : on garde 5
  eq(pick([20, 5], 10, 'adv').outcome, 'crit-success')
  eq(pick([1, 15], 10, 'dis').outcome, 'crit-fail')
  const dmg = rollDamage(3, 6, 2)
  eq(dmg.values.length, 3)
  eq(dmg.values.every((v) => v >= 1 && v <= 6), true)
  eq(dmg.total, dmg.values.reduce((a, b) => a + b, 0) + 2)
  console.log('grandal/dice.js : ok')
}
