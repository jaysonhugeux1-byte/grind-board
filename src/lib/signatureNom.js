// Reconnaître un joueur sans savoir lire son nom.
//
// ---------------------------------------------------------------------------
// LE DÉFAUT QUE CE FICHIER RÉPARE
// ---------------------------------------------------------------------------
//
// Le pont entre l'écran et l'historique supposait de LIRE le pseudonyme affiché.
// Or le lecteur ne sait nommer un signe qu'après l'avoir appris, et
// l'apprentissage automatique n'enseigne que des CHIFFRES — il les tire du
// tapis de Hero, que l'historique donne exactement. Les LETTRES, rien ne les
// enseigne : l'historique n'en contient pas, ses pseudonymes étant anonymisés.
//
// Autrement dit, le pont attendait une information que rien ne pouvait
// produire. Tant qu'aucune lettre n'était apprise, tous les pseudonymes se
// lisaient « ???????? », et plus rien ne distinguait un joueur d'un autre.
//
// ---------------------------------------------------------------------------
// CE QU'ON FAIT À LA PLACE
// ---------------------------------------------------------------------------
//
// ON N'A PAS BESOIN DE LIRE UN NOM POUR RECONNAÎTRE QUELQU'UN. Deux captures
// du même pseudonyme produisent la même suite de formes ; deux pseudonymes
// différents n'en produisent pas. La suite de formes suffit donc à dire « c'est
// le même joueur », qui est exactement ce que le suivi demande.
//
// Le nom lisible devient un CONFORT : quand les lettres finissent par être
// apprises, il s'affiche ; en attendant, le joueur porte une étiquette stable et
// ses statistiques s'accumulent correctement.

/**
 * Grossissement volontaire.
 *
 * L'empreinte d'un signe est une grille 10×14 de niveaux de gris. La comparer
 * telle quelle rendrait la signature sensible au moindre pixel d'anticrénelage :
 * le même pseudonyme photographié deux fois de suite donnerait deux signatures
 * différentes, et chaque main créerait un nouveau joueur.
 *
 * On moyenne donc par blocs de 2×2 — une grille 5×7 — et on ne garde que trois
 * niveaux. C'est assez grossier pour absorber le bruit, assez fin pour que deux
 * pseudonymes distincts ne se confondent pas.
 */
export const BLOC = 2;
export const NIVEAUX = 3;
const GRILLE_L = 10;
const GRILLE_H = 14;

const ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUV";

/** Le descripteur grossier d'un signe, en caractères imprimables. */
export function descripteurSigne(empreinte) {
  if (!empreinte || empreinte.length !== GRILLE_L * GRILLE_H) return null;
  const largeurBlocs = Math.ceil(GRILLE_L / BLOC);
  const hauteurBlocs = Math.ceil(GRILLE_H / BLOC);
  let sortie = "";

  for (let by = 0; by < hauteurBlocs; by++) {
    for (let bx = 0; bx < largeurBlocs; bx++) {
      let somme = 0;
      let compte = 0;
      for (let y = by * BLOC; y < Math.min((by + 1) * BLOC, GRILLE_H); y++) {
        for (let x = bx * BLOC; x < Math.min((bx + 1) * BLOC, GRILLE_L); x++) {
          somme += empreinte[y * GRILLE_L + x];
          compte++;
        }
      }
      const moyenne = compte ? somme / compte : 0;
      // Trois niveaux : vide, intermédiaire, plein.
      const niveau = Math.min(NIVEAUX - 1, Math.max(0, Math.floor(moyenne * NIVEAUX)));
      sortie += ALPHABET[niveau];
    }
  }
  return sortie;
}

/**
 * La signature d'un pseudonyme : la suite des formes qui le composent.
 *
 * @param signes  ce que la lecture a découpé — [{ empreinte, ratio }]
 * @returns       une chaîne stable, ou null si rien n'est exploitable
 */
export function signatureNom(signes) {
  if (!Array.isArray(signes) || !signes.length) return null;
  const parties = [];
  for (const s of signes) {
    const d = descripteurSigne(s?.empreinte);
    // UN SEUL SIGNE ILLISIBLE SUFFIT À TOUT ANNULER. Une signature amputée
    // ressemblerait à celle d'un pseudonyme plus court, et deux joueurs
    // finiraient par se confondre — précisément ce qu'on veut empêcher.
    if (!d) return null;
    parties.push(d);
  }

  // ELLE NE SERT QUE DE CLE, ON N'A DONC PAS BESOIN DE LA GARDER EN ENTIER.
  //
  // La suite des descripteurs fait pres de trois cents caracteres. Multipliee
  // par cinq sieges et vingt mille releves, elle portait le magasin d'identites
  // a TRENTE-SEPT MEGAOCTETS — contre cinq a dix acceptes par le stockage du
  // navigateur. Les ecritures echouaient donc, en silence.
  //
  // Rien ne relit jamais la geometrie : elle sert a dire « c'est le meme
  // joueur », et une empreinte de soixante-quatre bits le dit aussi bien. Deux
  // formes differentes qui la partageraient est un evenement de l'ordre de un
  // sur dix-huit milliards de milliards.
  return empreinte64(parties.join("-"));
}

/** Deux hachages independants, pour que la collision reste hors de portee. */
function empreinte64(texte) {
  let a = 2166136261 >>> 0;
  let b = 3581357891 >>> 0;
  for (let i = 0; i < texte.length; i++) {
    const c = texte.charCodeAt(i);
    a = Math.imul(a ^ c, 16777619) >>> 0;
    b = Math.imul(b ^ c, 2246822519) >>> 0;
    b = ((b << 13) | (b >>> 19)) >>> 0;
  }
  return (a >>> 0).toString(16).padStart(8, "0") + (b >>> 0).toString(16).padStart(8, "0");
}

/**
 * Une étiquette courte et stable, à afficher tant que le nom n'est pas lisible.
 *
 * ELLE NE PRÉTEND PAS ÊTRE UN NOM. « Joueur 7a3f » se lit comme ce qu'elle est :
 * un repère. Afficher un pseudonyme à moitié déchiffré — « R?z?lv » — laisserait
 * croire à une lecture, et deux joueurs mal lus se ressembleraient.
 */
export function hachage(signature) {
  if (!signature) return null;
  let h = 2166136261 >>> 0;
  for (let i = 0; i < signature.length; i++) {
    h ^= signature.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(16).padStart(8, "0");
}

export function etiquetteDeSignature(signature) {
  const h = hachage(signature);
  // Quatre caracteres suffisent a distinguer les joueurs d'une soiree et se
  // lisent d'un coup d'oeil. Le hachage complet reste disponible pour departager
  // deux joueurs dont les noms se liraient pareil.
  return h ? `Joueur ${h.slice(0, 4)}` : null;
}

/**
 * Le nom à retenir pour un siège observé.
 *
 * Le nom lu s'il est réellement lisible, l'étiquette de forme sinon. Un nom
 * partiellement déchiffré est traité comme illisible : « R?z?lv » n'identifie
 * personne, et deux pseudonymes différents peuvent y ressembler.
 */
export function nomOuEtiquette(nomLu, signature) {
  const propre = typeof nomLu === "string" ? nomLu.trim() : "";
  if (propre && !propre.includes("?")) return propre;
  return etiquetteDeSignature(signature);
}
