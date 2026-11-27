// Grandal : tous les champs numériques s'élargissent et se rétrécissent avec la longueur du nombre qu'ils contiennent.
// En JavaScript (et non en CSS `field-sizing`) pour que cela marche aussi sous Firefox.
const MIN_CHARS = 2 // largeur minimale : celle d'un nombre à 2 chiffres (champ vide compris)
const SPIN = 24 // px réservés aux flèches haut / bas (avec une petite marge)
const HEADROOM = 1 // un caractère d'avance : le chiffre en cours de frappe a toujours sa place, même si les flèches prennent plus que prévu

/** `incoming` = caractères sur le point d'être insérés */
export function fitNumber(input, incoming = 0) {
  const chars = Math.max(MIN_CHARS, String(input.value).length + incoming)
  // content-box : la largeur ne compte que le contenu, les marges intérieures et la bordure de chaque champ s'ajoutent d'elles-mêmes
  input.style.setProperty('box-sizing', 'content-box')
  // !important : passe devant les largeurs fixes des feuilles de style
  input.style.setProperty('width', `calc(${chars + HEADROOM}ch + ${SPIN}px)`, 'important')
  input.style.setProperty('flex', '0 0 auto')
}

/** Dimensionne les champs numériques de `root`, ceux ajoutés ensuite, et suit la saisie */
export function autoSizeNumbers(root) {
  const isNumber = (node) => node.matches?.('input[type="number"]')
  const fitAll = (node) => {
    if (node.nodeType !== 1) return
    if (isNumber(node)) fitNumber(node)
    node.querySelectorAll('input[type="number"]').forEach((input) => fitNumber(input))
  }
  fitAll(root)
  new MutationObserver((mutations) => { for (const m of mutations) m.addedNodes.forEach(fitAll) }).observe(root, { childList: true, subtree: true })
  // AVANT l'insertion : le champ est élargi d'avance. Sinon le navigateur fait défiler le texte dans le champ encore trop étroit, et ne
  // revient pas en arrière quand le champ s'élargit ensuite : le début du nombre reste masqué pendant toute la saisie.
  root.addEventListener('beforeinput', (e) => {
    if (!isNumber(e.target) || !e.inputType?.startsWith('insert')) return
    const text = e.data ?? e.dataTransfer?.getData('text/plain') ?? ''
    fitNumber(e.target, text.length || 1)
  }, true)
  // Après : largeur exacte (le rétrécissement ne provoque pas de défilement)
  const follow = (e) => { if (isNumber(e.target)) fitNumber(e.target) }
  for (const type of ['input', 'change', 'focusout']) root.addEventListener(type, follow, true)
}
