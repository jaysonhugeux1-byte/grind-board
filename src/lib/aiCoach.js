// Analyse d'une main par IA (Claude) : envoie l'historique brut directement
// depuis l'application à l'API Anthropic avec la clé fournie par l'utilisateur
// (voir src/lib/aiSettings.js — rien ne transite par un serveur intermédiaire).
import Anthropic from "@anthropic-ai/sdk";

const SYSTEM_PROMPT = `Tu es un coach de poker professionnel spécialisé en cash game No Limit Hold'em, calibre PokerIntel / GTO Wizard.
On te donne l'historique brut d'une main jouée par "Hero" sur CoinPoker.

Ta tâche : identifier la ou les décisions de Hero qui s'écartent le plus d'un jeu solide (GTO ou exploitant raisonnable), et les expliquer clairement.

Consignes :
- Concentre-toi uniquement sur les décisions de HERO (pas celles des adversaires, sauf pour expliquer le contexte).
- Si Hero a globalement bien joué la main, dis-le franchement et explique brièvement pourquoi — n'invente pas une erreur qui n'existe pas.
- Pour chaque erreur identifiée : la rue concernée, ce qu'il aurait dû faire à la place, et pourquoi (fold equity, value manquée, range trop large/étroite, mauvais sizing, lecture de board, etc.).
- Sois concis et concret, va droit aux décisions qui comptent. Pas de préambule, pas de résumé de la main (l'utilisateur l'a déjà sous les yeux).
- Réponds en français, avec le jargon poker habituel (3-bet, c-bet, range, etc.) si utile.
- Termine par une ligne "Verdict :" suivie de l'une de ces mentions : Aucune erreur / Erreur mineure / Erreur significative / Erreur majeure.`;

function normalizeError(err) {
  if (err?.name === "AbortError") return err;
  if (err?.status === 401) return new Error("Clé API invalide ou expirée. Vérifie-la dans Paramètres.");
  if (err?.status === 429) return new Error("Limite de requêtes atteinte auprès d'Anthropic — réessaie dans un instant.");
  if (err?.status === 400 && /credit|billing/i.test(err?.message || "")) {
    return new Error("Crédit insuffisant sur ton compte Anthropic.");
  }
  return new Error(err?.message || "Erreur lors de l'appel à l'IA.");
}

// onDelta(fullTextSoFar) est appelé à chaque fragment reçu pour un affichage
// en flux ; la fonction renvoie le texte complet une fois la réponse terminée.
export async function analyzeHand({ raw, apiKey, model, onDelta, signal }) {
  if (!apiKey) {
    throw new Error("Aucune clé API Anthropic configurée. Ajoute-la dans Paramètres pour utiliser l'analyse IA.");
  }
  if (!raw) {
    throw new Error("Texte brut de la main indisponible.");
  }

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  let full = "";

  try {
    const stream = client.messages.stream(
      {
        model: model || "claude-opus-5",
        max_tokens: 4096,
        system: SYSTEM_PROMPT,
        messages: [
          { role: "user", content: `Voici l'historique brut de la main (format CoinPoker) :\n\n${raw}` },
        ],
      },
      { signal }
    );

    stream.on("text", (delta) => {
      full += delta;
      onDelta?.(full);
    });

    const finalMessage = await stream.finalMessage();
    if (finalMessage.stop_reason === "refusal") {
      throw new Error("Le modèle a refusé d'analyser cette main.");
    }
  } catch (err) {
    throw normalizeError(err);
  }

  return full;
}
