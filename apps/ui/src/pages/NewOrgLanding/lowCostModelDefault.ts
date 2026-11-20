import {
  listModels,
  listProviders,
  reconcileSurfaceSelection,
  type SurfaceSelection,
} from "@hey-hey/ui-common/components";

/**
 * Ordered low-cost model preferences per provider (Haiku 5.5; Luna then Terra
 * 6), matched by exact versioned id against the machine's reported catalog. Never a model row of its own.
 */
const LOW_COST_MODEL_PREFERENCES: Readonly<Record<string, readonly string[]>> =
  {
    claude: ["claude-haiku-5-5"],
    codex: ["gpt-6-luna", "gpt-6-terra"],
  };

/**
 * The low-cost starting choice for the first provider that has models, or null
 * when that provider offers none of its preferred models (the picker then keeps
 * its own default). Reads the active catalog, so call it only once it is ready.
 */
export const buildLowCostSurfaceSelection = (): SurfaceSelection | null => {
  const provider = listProviders().find(
    (candidate) => listModels(candidate).length > 0,
  );
  if (!provider) {
    return null;
  }

  const models = listModels(provider);
  for (const preference of LOW_COST_MODEL_PREFERENCES[provider] ?? []) {
    const match = models.find((model) => model.id === preference);
    if (match) {
      return reconcileSurfaceSelection({
        provider,
        model: match.id,
        reasoningEffort: null,
      });
    }
  }

  return null;
};
