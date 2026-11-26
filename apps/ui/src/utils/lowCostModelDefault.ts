import {
  listModels,
  listProviders,
  reconcileSurfaceSelection,
  type SurfaceSelection,
} from "@hey-hey/ui-common/components";

type Provider = SurfaceSelection["provider"];

/**
 * Each provider's small model, matched by exact versioned id against the
 * machine's reported catalog, which carries no tier or power ranking. Update by
 * hand when a new generation ships. Never a model row of its own.
 */
const SMALL_MODEL_IDS: Partial<Record<Provider, string>> = {
  claude: "claude-haiku-5-5",
  codex: "gpt-6-luna",
};

/** `/welcome` alone tries these when the provider's small model is not offered. */
const WELCOME_FALLBACK_MODEL_IDS: Partial<Record<Provider, string>> = {
  codex: "gpt-6-terra",
};

/**
 * The `/welcome` low-cost starting choice for the first provider that has
 * models, or null when that provider offers none of its preferred models (the
 * picker then keeps its own default). Reads the active catalog, so call it only
 * once it is ready.
 */
export const buildLowCostSurfaceSelection = (): SurfaceSelection | null => {
  const provider = listProviders().find(
    (candidate) => listModels(candidate).length > 0,
  );
  if (!provider) {
    return null;
  }

  const offered = listModels(provider).map((model) => model.id);
  const match = [
    SMALL_MODEL_IDS[provider],
    WELCOME_FALLBACK_MODEL_IDS[provider],
  ].find((id) => id !== undefined && offered.includes(id));

  return match
    ? reconcileSurfaceSelection({
        provider,
        model: match,
        reasoningEffort: null,
      })
    : null;
};

/**
 * Open Items triage's starting choice for `provider`: its small model at extra
 * high. When the provider has no small model, or does not offer it, this is the
 * picker's normal model and effort. Null when the provider has no models. Reads
 * the active catalog, so call it only once it is ready.
 */
export const buildTriageProviderSelection = (
  provider: Provider,
): SurfaceSelection | null => {
  const smallModel = listModels(provider).find(
    (model) => model.id === SMALL_MODEL_IDS[provider],
  );

  // An empty model and a null effort ask for the picker's normal ones.
  return reconcileSurfaceSelection({
    provider,
    model: smallModel?.id ?? "",
    reasoningEffort: smallModel ? "xhigh" : null,
    fastMode: false,
  });
};
