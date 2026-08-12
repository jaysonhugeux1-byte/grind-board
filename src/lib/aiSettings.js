// Stockage local (sur cet appareil uniquement) de la clé API Anthropic et du
// modèle choisi pour l'analyse de mains par IA. Rien n'est envoyé ailleurs
// qu'à l'API Anthropic directement depuis l'application.
const KEY_STORAGE = "gl_anthropic_api_key";
const MODEL_STORAGE = "gl_ai_model";

export const AI_MODELS = [
  { value: "claude-opus-5", label: "Claude Opus 5 — le plus fin (recommandé)" },
  { value: "claude-sonnet-5", label: "Claude Sonnet 5 — bon rapport qualité/prix" },
  { value: "claude-haiku-4-5", label: "Claude Haiku 4.5 — rapide et économique" },
];

export function getApiKey() {
  return localStorage.getItem(KEY_STORAGE) || "";
}

export function setApiKey(key) {
  if (key) localStorage.setItem(KEY_STORAGE, key.trim());
  else localStorage.removeItem(KEY_STORAGE);
}

export function getAiModel() {
  return localStorage.getItem(MODEL_STORAGE) || "claude-opus-5";
}

export function setAiModel(model) {
  localStorage.setItem(MODEL_STORAGE, model);
}
