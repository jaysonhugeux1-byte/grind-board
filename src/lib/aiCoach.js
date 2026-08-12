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

const PLAN_SYSTEM_PROMPT = `Tu es un coach de poker professionnel spécialisé en cash game No Limit Hold'em, calibre PokerIntel / GTO Wizard.
On te donne les statistiques agrégées de "Hero" sur une période de jeu, une liste de leaks déjà détectés automatiquement par comparaison à des repères standards micro/petites limites 6-max, et pour chacun 1-2 mains réelles qui illustrent concrètement le comportement en cause.

Ta tâche : produire un plan d'amélioration priorisé, pas juste un résumé des chiffres.

Consignes :
- Pour chaque leak : explique en une ou deux phrases pourquoi ce chiffre s'écarte de la norme et ce que ça coûte concrètement à la table (fold equity manqué, value ratée, range trop exploitable, etc.), puis donne UNE piste d'action concrète et actionnable — pas un conseil vague du type "sois plus agressif".
- Quand des mains d'exemple sont fournies pour un leak, réfère-toi à au moins une d'entre elles brièvement (rue, action précise) pour ancrer l'explication dans du concret plutôt que dans l'abstrait.
- Priorise les leaks par impact estimé sur le winrate (du plus coûteux au moins grave), pas dans l'ordre où ils sont donnés.
- Si un leak apparaît aussi de façon marquée à une position précise, mentionne-le.
- Si aucun leak n'est détecté, dis-le franchement et mets en avant ce qui fonctionne déjà bien plutôt que d'inventer un problème.
- Sois concret et direct, pas de blabla générique ni de rappel des chiffres bruts (l'utilisateur les a déjà sous les yeux).
- Réponds en français, avec le jargon poker habituel si utile.
- Termine par une section "Prochaine étape :" avec UNE seule chose sur laquelle se concentrer en priorité.`;

function fmtPct(v) {
  return v == null ? "—" : `${v.toFixed(1)}%`;
}

function formatHandExample(h) {
  if (!h.raw) return null;
  return `--- Main #${h.id} (${h.position || "position inconnue"}, ${h.notation || "?"}, résultat net ${h.net >= 0 ? "+" : ""}${h.net.toFixed(2)}) ---\n${h.raw}`;
}

function buildImprovementPrompt({ totalHands, agg, leaks, positionLeaks }) {
  const parts = [];

  parts.push(`Volume analysé : ${totalHands} mains.`);
  parts.push(
    `Stats globales — VPIP ${fmtPct(agg.vpipPct)}, PFR ${fmtPct(agg.pfrPct)}, écart VPIP-PFR ${agg.vpipPfrGap != null ? agg.vpipPfrGap.toFixed(1) : "—"} pts, ` +
      `3-Bet ${fmtPct(agg.threeBetPct)} (${agg.threeBetOpp} occasions), Fold to 3-Bet ${fmtPct(agg.foldTo3BetPct)} (${agg.foldTo3BetOpp} occasions), ` +
      `C-Bet flop ${fmtPct(agg.cbetPct)} (${agg.cbetOpp} occasions), Fold to C-Bet ${fmtPct(agg.foldToCbetPct)} (${agg.foldToCbetOpp} occasions), ` +
      `WTSD ${fmtPct(agg.wtsdPct)} (${agg.sawFlop} flops vus), W$SD ${fmtPct(agg.wsdPct)} (${agg.wtsd} abattages).`
  );

  if (!leaks.length) {
    parts.push("Aucun leak détecté par les repères automatiques sur cet échantillon global.");
  } else {
    parts.push(`\nLeaks détectés (${leaks.length}) :`);
    for (const leak of leaks) {
      parts.push(`\n## ${leak.label} : ${leak.value.toFixed(1)}% (${leak.direction === "haut" ? "trop haut" : "trop bas"})`);
      parts.push(leak.message);
      const examples = (leak.examples || []).map(formatHandExample).filter(Boolean);
      if (examples.length) {
        parts.push(`Mains d'exemple :\n${examples.join("\n\n")}`);
      } else {
        parts.push("(pas de main d'exemple isolable pour ce leak — c'est une fréquence globale)");
      }
    }
  }

  if (positionLeaks && positionLeaks.length) {
    parts.push(`\nLeaks spécifiques par position :`);
    for (const { position, leaks: posLeaks } of positionLeaks) {
      const line = posLeaks.map((l) => `${l.label} ${l.value.toFixed(1)}% (${l.direction})`).join(", ");
      parts.push(`${position} : ${line}`);
    }
  }

  return parts.join("\n");
}

// Comme analyzeHand, mais sur l'ensemble des stats de Hero plutôt qu'une seule
// main : construit un plan d'amélioration priorisé à partir des leaks déjà
// détectés par lib/stats.js et de mains réelles qui les illustrent.
export async function generateImprovementPlan({ totalHands, agg, leaks, positionLeaks, apiKey, model, onDelta, signal }) {
  if (!apiKey) {
    throw new Error("Aucune clé API Anthropic configurée. Ajoute-la dans Paramètres pour utiliser l'analyse IA.");
  }
  if (!totalHands) {
    throw new Error("Aucune main sur cette période.");
  }

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
  const userContent = buildImprovementPrompt({ totalHands, agg, leaks, positionLeaks });
  let full = "";

  try {
    const stream = client.messages.stream(
      {
        model: model || "claude-opus-5",
        max_tokens: 6000,
        system: PLAN_SYSTEM_PROMPT,
        messages: [{ role: "user", content: userContent }],
      },
      { signal }
    );

    stream.on("text", (delta) => {
      full += delta;
      onDelta?.(full);
    });

    const finalMessage = await stream.finalMessage();
    if (finalMessage.stop_reason === "refusal") {
      throw new Error("Le modèle a refusé de générer ce plan.");
    }
  } catch (err) {
    throw normalizeError(err);
  }

  return full;
}

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
