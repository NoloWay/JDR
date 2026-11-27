// Grandal : tous les champs numériques s'élargissent et se rétrécissent avec la longueur du nombre qu'ils contiennent.
// En JavaScript (et non en CSS `field-sizing`) pour que cela marche aussi sous Firefox.
const MIN_CHARS = 2 // largeur minimale : celle d'un nombre à 2 chiffres (champ vide compris)
const SPIN = 22 // px réservés aux flèches haut / bas

export function fitNumber(input) {
  const chars = Math.max(MIN_CHARS, String(input.value).length)
  // content-box : la largeur ne compte que le contenu, les marges intérieures et la bordure de chaque champ s'ajoutent d'elles-mêmes
  input.style.setProperty('box-sizing', 'content-box')
  // !important : passe devant les largeurs fixes des feuilles de style
  input.style.setProperty('width', `calc(${chars}ch + ${SPIN}px)`, 'important')
  input.style.setProperty('flex', '0 0 auto')
}

/** Dimensionne les champs numériques de `root`, ceux ajoutés ensuite, et suit la saisie */
export function autoSizeNumbers(root) {
  const isNumber = (node) => node.matches?.('input[type="number"]')
  const fitAll = (node) => {
    if (node.nodeType !== 1) return
    if (isNumber(node)) fitNumber(node)
    node.querySelectorAll('input[type="number"]').forEach(fitNumber)
  }
  fitAll(root)
  new MutationObserver((mutations) => { for (const m of mutations) m.addedNodes.forEach(fitAll) }).observe(root, { childList: true, subtree: true })
  const follow = (e) => { if (isNumber(e.target)) fitNumber(e.target) }
  for (const type of ['input', 'change', 'focusout']) root.addEventListener(type, follow, true)
}
