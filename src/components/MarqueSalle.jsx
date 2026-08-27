// La pastille qui représente une salle : son logo, ou son initiale à défaut.
//
// UN SEUL ENDROIT POUR LES DEUX ÉCRANS. La marque apparaît au choix de la
// salle et en haut de la barre latérale ; en dupliquant le rendu, l'un des
// deux aurait fini par garder l'initiale le jour où l'autre reçoit un logo.
//
// LE REPLI N'EST PAS DÉCORATIF. Toutes les salles n'ont pas de fichier de
// logo — CoinPoker n'a pas pu être récupéré, et « Multiroom » n'est pas une
// marque. Elles s'affichent avec leur initiale dans leurs couleurs, et rien
// dans l'écran ne trahit qu'il manque une image.
export default function MarqueSalle({ salle, className = "", ...reste }) {
  if (!salle) return null;
  return (
    <span
      className={`marque-salle ${className}`.trim()}
      style={{ background: salle.fond, borderColor: salle.bord, color: salle.texte }}
      {...reste}
    >
      {salle.logo ? (
        // `alt` vide : le nom de la salle est toujours écrit juste à côté.
        // Le répéter ici le ferait lire deux fois par un lecteur d'écran.
        <img className="marque-salle-img" src={salle.logo} alt="" />
      ) : (
        salle.initiale
      )}
    </span>
  );
}
