// Grandal : jets de dés « valeur ou plus » — Starboard garde src/dice.js (« sous la valeur »).
// Règles de Grandal, pour TOUS les jets, en toutes circonstances :
//  1. Minimum 1 : un résultat final inférieur à 1 est remonté à 1 (atLeastOne).
//  2. Seuls les jets avec une condition de réussite (valeur à atteindre) peuvent donner une réussite ou un échec critique ;
//     les jets sans condition (dégâts, dé libre) n'en donnent jamais.
//  3. Réussite critique = le dé tombe sur son nombre de faces, échec critique = le dé tombe sur 1. Le critère se juge sur le dé,
//     AVANT l'ajout d'une valeur fixe : un 1 est un échec critique quel que soit le résultat final, un dé au maximum une réussite
//     critique quel que soit le résultat final et la valeur à atteindre (judge).
// Jets à condition : uniquement des d20, réussite si le dé est SUPÉRIEUR OU ÉGAL à la valeur demandée ; avantage / désavantage :
// deux d20, on garde le plus haut / le plus bas (le dé gardé décide aussi du critique).
import { OUTCOME_LABEL, MODE_LABEL, rollFree } from '../../src/dice.js'

export { OUTCOME_LABEL, MODE_LABEL }
export const SIDES = 20

function rollDie(faces = SIDES) {
  const buf = new Uint32Array(1)
  crypto.getRandomValues(buf)
  return 1 + (buf[0] % faces)
}

/** Règle 1 : un résultat final inférieur à 1 est remonté à 1 */
export const atLeastOne = (n) => Math.max(1, n)

/**
 * Résultat d'un dé (`faces` faces, d20 par défaut) contre une valeur demandée.
 * Les critiques se jugent sur le dé seul, avant toute valeur fixe : faces = réussite critique, 1 = échec critique.
 */
export function judge(value, target, faces = SIDES) {
  if (value === faces) return 'crit-success'
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

/**
 * Jet de dégâts : `count` dés à `faces` faces, plus une valeur fixe. Pas de condition de réussite, donc jamais de critique ;
 * le total est au moins 1 (`raised` = il a été remonté à 1).
 */
export function rollDamage(count, faces, bonus = 0) {
  const values = Array.from({ length: count }, () => rollDie(faces))
  const raw = values.reduce((a, b) => a + b, 0) + bonus
  return { count, faces, bonus, values, total: atLeastOne(raw), raised: raw < 1 }
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
  eq(judge(6, 99, 6), 'crit-success') // d6 au maximum : réussite critique, même contre 99
  eq(judge(1, 0, 6), 'crit-fail')
  eq(judge(5, 5, 6), 'success')
  eq(atLeastOne(-4), 1)
  eq(atLeastOne(0), 1)
  eq(atLeastOne(7), 7)
  for (let i = 0; i < 200; i++) { const r = rollDamage(1, 2, -9); eq(r.total, 1); eq(r.raised, true) } // 1d2 − 9 : toujours remonté à 1
  const dmg = rollDamage(3, 6, 2)
  eq(dmg.values.length, 3)
  eq(dmg.values.every((v) => v >= 1 && v <= 6), true)
  eq(dmg.total, dmg.values.reduce((a, b) => a + b, 0) + 2)
  console.log('grandal/dice.js : ok')
}
