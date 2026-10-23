import { listEfforts, listModels, supportsFastMode } from "./capabilityCatalog";
import {
  CODING_SETUP_SURFACE_ID,
  readSurfaceSelection,
} from "./surfaceSelectionMemory";
import type { AgentProvider, ReasoningEffort } from "./runtime/index";

export interface PromptModelSelection {
  model: string | undefined;
  reasoningEffort: ReasoningEffort | undefined;
  fastMode: boolean | undefined;
}

const pickDefaultPromptEffort = (
  efforts: readonly ReasoningEffort[],
  preferred: ReasoningEffort | undefined,
): ReasoningEffort | undefined => {
  if (preferred && efforts.includes(preferred)) return preferred;
  if (efforts.includes("medium")) return "medium";
  return efforts[0];
};

/**
 * Seed the prompt-view model/effort from the persisted coding-session selection
 * so a pick made last session sticks. The remembered selection wins only when
 * it belongs to the active provider (the session record drives the provider);
 * otherwise fall back to the launch-time props, then the catalog default. We
 * always resolve a concrete model id so the ModelSelector's displayed value is
 * the value actually dispatched to the run — never a display-only fallback that
 * leaves the run with no model (which makes the server pick its own default).
 */
export const resolvePromptModelSelection = (
  provider: AgentProvider,
  modelProp: string | undefined,
  effortProp: ReasoningEffort | undefined,
  fastModeProp?: boolean,
): PromptModelSelection => {
  const stored = readSurfaceSelection(CODING_SETUP_SURFACE_ID);
  if (
    stored &&
    stored.provider === provider &&
    listModels(provider).some((row) => row.id === stored.model)
  ) {
    return {
      model: stored.model,
      reasoningEffort: stored.reasoningEffort ?? undefined,
      fastMode: supportsFastMode(provider, stored.model)
        ? (stored.fastMode ?? false)
        : undefined,
    };
  }
  const model = modelProp ?? listModels(provider)[0]?.id;
  const efforts = model ? listEfforts(provider, model) : [];
  return {
    model,
    reasoningEffort: pickDefaultPromptEffort(efforts, effortProp),
    fastMode:
      model && supportsFastMode(provider, model)
        ? (fastModeProp ?? false)
        : undefined,
  };
};
