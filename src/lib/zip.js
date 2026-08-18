// Lecture d'archives ZIP dans le navigateur, sans bibliothèque.
//
// Betclic livre ses historiques en archive : un fichier texte par jour. Plutôt
// que d'embarquer une dépendance de plus, on lit le répertoire central de
// l'archive et on décompresse avec DecompressionStream, disponible nativement
// dans Chromium — donc dans Electron comme dans le navigateur.

const SIG_EOCD = 0x06054b50;
const SIG_CENTRAL = 0x02014b50;
const SIG_LOCAL = 0x04034b50;

// Le répertoire central se trouve à la fin, précédé d'un commentaire de taille
// variable : on remonte depuis la fin jusqu'à retrouver sa signature.
function trouverEocd(vue) {
  const min = Math.max(0, vue.byteLength - 65557);
  for (let i = vue.byteLength - 22; i >= min; i--) {
    if (vue.getUint32(i, true) === SIG_EOCD) return i;
  }
  return -1;
}

async function inflate(donnees, methode) {
  if (methode === 0) return donnees; // stocké tel quel
  if (methode !== 8) {
    throw new Error(`Méthode de compression ${methode} non gérée dans cette archive.`);
  }
  const flux = new Blob([donnees]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(flux).arrayBuffer());
}

/**
 * Extrait les fichiers d'une archive ZIP.
 *
 * @param buffer   contenu de l'archive
 * @param filtre   ne garder que les noms passant ce test (extension, dossier…)
 * @returns        [{ nom, texte }] dans l'ordre de l'archive
 */
export async function lireZip(buffer, filtre = () => true) {
  const vue = new DataView(buffer);
  const octets = new Uint8Array(buffer);

  const eocd = trouverEocd(vue);
  if (eocd < 0) throw new Error("Ce fichier n'est pas une archive ZIP valide.");

  const nbEntrees = vue.getUint16(eocd + 10, true);
  const debutCentral = vue.getUint32(eocd + 16, true);
  if (debutCentral === 0xffffffff) {
    throw new Error("Archive ZIP64 non gérée. Décompresse-la et envoie les fichiers .txt.");
  }

  const decodeur = new TextDecoder("utf-8");
  const fichiers = [];
  let p = debutCentral;

  for (let i = 0; i < nbEntrees && p + 46 <= vue.byteLength; i++) {
    if (vue.getUint32(p, true) !== SIG_CENTRAL) break;

    const methode = vue.getUint16(p + 10, true);
    const tailleCompressee = vue.getUint32(p + 20, true);
    const longueurNom = vue.getUint16(p + 28, true);
    const longueurExtra = vue.getUint16(p + 30, true);
    const longueurCommentaire = vue.getUint16(p + 32, true);
    const offsetLocal = vue.getUint32(p + 42, true);
    const nom = decodeur.decode(octets.subarray(p + 46, p + 46 + longueurNom));
    p += 46 + longueurNom + longueurExtra + longueurCommentaire;

    // Les dossiers apparaissent comme des entrées vides terminées par un /.
    if (nom.endsWith("/") || !filtre(nom)) continue;

    if (vue.getUint32(offsetLocal, true) !== SIG_LOCAL) continue;
    // L'en-tête local répète les longueurs de nom et d'extra, qui peuvent
    // différer de celles du répertoire central : ce sont elles qui font foi ici.
    const nomLocal = vue.getUint16(offsetLocal + 26, true);
    const extraLocal = vue.getUint16(offsetLocal + 28, true);
    const debut = offsetLocal + 30 + nomLocal + extraLocal;

    const brut = octets.subarray(debut, debut + tailleCompressee);
    fichiers.push({ nom, texte: decodeur.decode(await inflate(brut, methode)) });
  }

  return fichiers;
}
