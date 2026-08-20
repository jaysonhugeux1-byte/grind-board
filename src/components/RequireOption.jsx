import React from "react";
import { Link } from "react-router-dom";
import { Lock, Scale } from "lucide-react";
import { useSubscription } from "../contexts/SubscriptionContext";
import { PageHeader } from "./ui";

// Garde d'un écran réservé à une formule.
//
// POURQUOI PAS UNE REDIRECTION. Rediriger vers la page d'abonnement ferait
// disparaître l'écran demandé sans dire ce qu'il contient : on se retrouve
// devant un tarif sans savoir ce qu'on achète. On garde donc la page, on
// explique ce qu'elle contient, et le bouton mène au paiement.
//
// LA GARDE EST DE CONFORT, PAS DE SÉCURITÉ. Elle vit dans le navigateur et
// quelqu'un de déterminé la contournera : ce qu'elle protège n'est pas une
// donnée mais un écran, et le calcul se fait entièrement sur la machine du
// joueur. Ce qui compte réellement — les accès, les paiements — est vérifié
// côté serveur, où rien de tout cela n'est modifiable.

export default function RequireOption({ option, titre, sousTitre, quoi, children }) {
  const { aAcces, aUneBase, loading } = useSubscription();

  if (loading) return null;
  if (aAcces(option)) return children;

  return (
    <div className="page">
      <PageHeader title={titre} subtitle={sousTitre} />

      <div className="carte-option">
        <div className="carte-option-tete">
          <Lock size={18} />
          <h3>Réservé à la formule Expert</h3>
        </div>

        <p className="carte-option-quoi">{quoi}</p>

        <ul className="carte-option-liste">
          <li><Scale size={13} /> Turn et river résolus exactement, exploitabilité affichée</li>
          <li><Scale size={13} /> Le déroulé de la main saisi, le pot et les ranges déduits</li>
          <li><Scale size={13} /> Équilibre push/fold et meilleure réponse par adversaire</li>
        </ul>

        {/* LE SOLVEUR NE S'ACHÈTE PLUS SÉPARÉMENT : il vient avec Expert, et
            avec rien d'autre. Le dire ici évite de chercher une option qui
            n'existe plus. */}
        <p className="card-sub">
          {aUneBase
            ? "Le solveur ne s'achète pas séparément : il vient avec la formule Expert, qui "
              + "comprend aussi le cash game et le spin. Passer d'un abonnement en cours à "
              + "Expert ajoute la durée achetée au temps qu'il te reste."
            : "Le solveur vient avec la formule Expert, qui comprend les deux formats. "
              + "Aucune autre formule n'y donne accès."}
        </p>
        <Link className="btn-lancer" to="/subscribe">Voir la formule Expert</Link>
      </div>
    </div>
  );
}
