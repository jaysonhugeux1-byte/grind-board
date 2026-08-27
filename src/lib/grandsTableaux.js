// Trois opérations qui ne débordent pas la pile.
//
// LE PIÈGE. `a.push(...b)` et `Math.max(...b)` passent CHAQUE élément de `b`
// comme un argument d'appel séparé. Le moteur en accepte quelques dizaines de
// milliers, pas plus : au-delà il lève « Maximum call stack size exceeded ».
// L'import d'un historique de 135 000 mains mourait ainsi, avec un message qui
// ne désigne ni le fichier ni l'écran fautif — et la limite exacte dépend de la
// place déjà occupée sur la pile, donc le même fichier peut passer une fois et
// échouer la suivante.
//
// Ces trois fonctions font le même travail sans jamais épandre. Elles servent
// partout où la taille du tableau vient d'un fichier de l'utilisateur : on ne
// décide pas de combien de mains il importe.

// Ajoute tous les éléments de `source` à la fin de `dest`. Rend `dest`.
export function ajouterTout(dest, source) {
  for (let i = 0; i < source.length; i++) dest.push(source[i]);
  return dest;
}

// Le plus petit élément, ou `defaut` si le tableau est vide — et non `Infinity`,
// qui traverserait l'écran jusqu'à une date affichée en 1970 ou en l'an 275760.
export function minimum(valeurs, defaut = null) {
  let m = null;
  for (let i = 0; i < valeurs.length; i++) {
    const v = valeurs[i];
    if (!Number.isFinite(v)) continue;
    if (m === null || v < m) m = v;
  }
  return m === null ? defaut : m;
}

export function maximum(valeurs, defaut = null) {
  let m = null;
  for (let i = 0; i < valeurs.length; i++) {
    const v = valeurs[i];
    if (!Number.isFinite(v)) continue;
    if (m === null || v > m) m = v;
  }
  return m === null ? defaut : m;
}
