import React from "react";
import { Link } from "react-router-dom";
import { Lock, Scale } from "lucide-react";
import { useSubscription } from "../contexts/SubscriptionContext";
import { PageHeader } from "./ui";

// Garde d'une option payante.
//
// POURQUOI PAS UNE REDIRECTION. Rediriger vers la page d'abonnement ferait
// disparaître l'écran demandé sans dire ce qu'il contient : on se retrouve
// devant un tarif sans savoir ce qu'on achète. On garde donc la page, on
// explique ce que l'option débloque, et le bouton mène au paiement.
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
          <h3>Option non activée</h3>
        </div>

        <p className="carte-option-quoi">{quoi}</p>

        <ul className="carte-option-liste">
          <li><Scale size={13} /> Turn et river résolus exactement, exploitabilité affichée</li>
          <li><Scale size={13} /> Le déroulé de la main saisi, le pot et les ranges déduits</li>
          <li><Scale size={13} /> Équilibre push/fold et meilleure réponse par adversaire</li>
        </ul>

        {aUneBase ? (
          <Link className="btn-lancer" to="/subscribe">Activer le solveur</Link>
        ) : (
          <>
            <p className="card-sub">
              {/* Le dire avant le paiement, pas après : une option achetée sans
                  abonnement n'ouvrirait aucune page. */}
              Le solveur s'ajoute à un abonnement — cash game ou spin. Prends d'abord l'un des deux.
            </p>
            <Link className="btn-lancer" to="/subscribe">Voir les formules</Link>
          </>
        )}
      </div>
    </div>
  );
}
