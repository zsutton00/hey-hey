import {
  ConversationStartRunRequestDtoProviderEnum,
  type ConversationStartRunRequestDtoReasoningEffortEnum,
} from "../../api";
import {
  listEfforts,
  listModels,
  listProviders,
  supportsFastMode,
} from "./capabilityCatalog";

const STORAGE_KEY_PREFIX = "hey-hey:agent-selection:";

const storageKey = (surfaceId: string): string =>
  `${STORAGE_KEY_PREFIX}${surfaceId}`;

/**
 * Stable per-surface id for the Discuss launch's provider/model/effort
 * selection. Shared so DiscussModal (which writes the choice) and
 * EntityConversationChat (which reads it back to seed the start-run envelope)
 * key the same localStorage slot — the persisted selection only round-trips if
 * both surfaces agree on this literal.
 */
export const DISCUSS_SURFACE_ID = "discuss";

/**
 * Stable per-surface id for the agent-search toolbar's provider/model/effort
 * selection. AdvancedSearch's toolbar writes the user pick here and forwards
 * the selection to EntitySearchChat; any future reader on this surface keys
 * the same localStorage slot.
 */
export const AGENT_SEARCH_SURFACE_ID = "agent-search";

/**
 * Stable per-surface id for the plan-approval provider/model/effort selection.
 * StartupPlanStructuredField writes the user's approval-turn selection here so
 * plan approval starts from the last chosen triple.
 */
export const PLAN_APPROVAL_SURFACE_ID = "plan-approval";

/**
 * Stable per-surface id for the coding-session provider/model/effort selection.
 * AgentSetupView's step 3 (prompt entry) writes here via useAgentSetup so the
 * model pick sticks across sessions.
 */
export const CODING_SETUP_SURFACE_ID = "coding-setup";

/**
 * Stable per-surface id for the plan-stage Task Monitor setup runtime
 * selection. Fresh monitor drafts read this provider/model/effort triple and
 * the setup review writes each coordinated selector change back to it.
 */
export const TASK_MONITOR_SETUP_SURFACE_ID = "task-monitor-setup";

/**
 * Stable per-surface id for code-review followup actions. FollowupActionModal
 * writes the review sub-agent choice here so Review remembers its own triple.
 */
export const CODE_REVIEW_SURFACE_ID = "code-review";

/**
 * Stable per-surface id for commit followup actions. FollowupActionModal writes
 * the commit sub-agent choice here so Commit remembers its own triple.
 */
export const COMMIT_SURFACE_ID = "commit";

/** Stable memory id for generic entity-conversation route setup. */
export const ENTITY_CONVERSATION_SURFACE_ID = "entity-conversation";

/** Stable memory id for Scratchpad entity-conversation setup. */
export const SCRATCHPAD_CONVERSATION_SURFACE_ID = "scratchpad-conversation";

/** Stable memory id for the runtime chosen on Goal PM new-conversation cards. */
export const GOAL_PM_NEW_CONVERSATION_SURFACE_ID = "goal-pm-new-conversation";

/** Stable memory id for project-report request launches. */
export const PROJECT_REPORT_SURFACE_ID = "project-report";

/** Stable memory id for the runtime chosen when starting Agent fix on a proposal. */
export const PROPOSAL_AGENT_FIX_SURFACE_ID = "proposal-agent-fix";

/** Stable memory id shared by fresh Service Import onboarding setup. */
export const SERVICE_IMPORT_SURFACE_ID = "service-import";

/** Stable memory id for the runtime chosen on the Open Items triage start screen. */
export const OPEN_ITEMS_TRIAGE_SURFACE_ID = "open-items-triage";

/**
 * Returns the stable memory id for the primary conversation on one GoalPage.
 * Each goal remembers its own runtime choice so changing one goal never
 * changes the setup shown for another goal.
 */
export const getGoalConversationSurfaceId = (goalId: string): string =>
  `goal-conversation:${goalId}`;

export interface SurfaceSelection {
  provider: ConversationStartRunRequestDtoProviderEnum;
  model: string;
  reasoningEffort: ConversationStartRunRequestDtoReasoningEffortEnum | null;
  fastMode?: boolean;
}

/**
 * A selection as a surface saved it, before any catalog has been consulted: its
 * model and effort may no longer be offered.
 */
export interface StoredSurfaceSelection {
  provider: ConversationStartRunRequestDtoProviderEnum;
  model: string;
  reasoningEffort: string | null;
  fastMode?: boolean;
}

const isKnownProvider = (
  value: string,
): value is ConversationStartRunRequestDtoProviderEnum =>
  Object.values<string>(ConversationStartRunRequestDtoProviderEnum).includes(
    value,
  );

const selectDefaultReasoningEffort = (
  efforts: readonly ConversationStartRunRequestDtoReasoningEffortEnum[],
): ConversationStartRunRequestDtoReasoningEffortEnum | null =>
  efforts.includes("medium") ? "medium" : (efforts[0] ?? null);

const buildProviderDefaultSurfaceSelection = (
  provider: ConversationStartRunRequestDtoProviderEnum,
): SurfaceSelection | null => {
  const model = listModels(provider)[0]?.id;
  if (!model) {
    return null;
  }
  return {
    provider,
    model,
    reasoningEffort: selectDefaultReasoningEffort(listEfforts(provider, model)),
  };
};

/**
 * Catalog-derived default selection used when a surface has no remembered
 * choice yet: the first provider that has models, its first model, and that
 * model's first effort level (or null when the model exposes none). Null until
 * the addressed CLI's catalog has loaded, so nothing is preselected before the
 * CLI has said what it can launch. The catalog is the single source for this
 * knowledge — surfaces seed from here rather than carrying their own literals.
 */
export const buildDefaultSurfaceSelection = (
  preferredProvider?: ConversationStartRunRequestDtoProviderEnum,
): SurfaceSelection | null => {
  const preferred = preferredProvider
    ? buildProviderDefaultSurfaceSelection(preferredProvider)
    : null;
  if (preferred) {
    return preferred;
  }
  for (const provider of listProviders()) {
    const selection = buildProviderDefaultSurfaceSelection(provider);
    if (selection) {
      return selection;
    }
  }
  return null;
};

const getLocalStorage = (): Storage | null => {
  try {
    if (typeof localStorage === "undefined") {
      return null;
    }
    return localStorage;
  } catch {
    return null;
  }
};

export const reconcileSurfaceSelection = (
  value: StoredSurfaceSelection,
): SurfaceSelection | null => {
  if (!listProviders().includes(value.provider)) {
    return null;
  }

  const models = listModels(value.provider);
  const model = models.some((row) => row.id === value.model)
    ? value.model
    : models[0]?.id;
  if (!model) {
    return null;
  }

  const efforts = listEfforts(value.provider, model);
  const rememberedEffort =
    value.reasoningEffort === null
      ? undefined
      : efforts.find((effort) => effort === value.reasoningEffort);
  const reasoningEffort =
    rememberedEffort ?? selectDefaultReasoningEffort(efforts);

  return {
    provider: value.provider,
    model,
    reasoningEffort,
    ...(typeof value.fastMode === "boolean"
      ? {
          fastMode: supportsFastMode(value.provider, model) && value.fastMode,
        }
      : {}),
  };
};

const parseStoredSelection = (
  value: unknown,
): StoredSurfaceSelection | null => {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  const candidate = value as Record<string, unknown>;
  const provider = candidate.provider;
  const model = candidate.model;
  const reasoningEffort = candidate.reasoningEffort;
  const fastMode = candidate.fastMode;

  if (typeof provider !== "string" || typeof model !== "string") {
    return null;
  }

  if (!isKnownProvider(provider)) {
    return null;
  }

  if (
    reasoningEffort !== null &&
    reasoningEffort !== undefined &&
    typeof reasoningEffort !== "string"
  ) {
    return null;
  }
  if (fastMode !== undefined && typeof fastMode !== "boolean") {
    return null;
  }
  return {
    provider,
    model,
    reasoningEffort: reasoningEffort ?? null,
    ...(typeof fastMode === "boolean" ? { fastMode } : {}),
  };
};

/**
 * The surface's saved selection exactly as stored, for a surface that resolves
 * it against the catalog by its own rules. Most surfaces want
 * {@link readSurfaceSelection}.
 */
export const readStoredSurfaceSelection = (
  surfaceId: string,
): StoredSurfaceSelection | null => {
  const storage = getLocalStorage();
  if (!storage) {
    return null;
  }
  let raw: string | null;
  try {
    raw = storage.getItem(storageKey(surfaceId));
  } catch {
    return null;
  }
  if (raw === null) {
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  return parseStoredSelection(parsed);
};

/** The surface's saved selection reconciled to the active catalog. */
export const readSurfaceSelection = (
  surfaceId: string,
): SurfaceSelection | null => {
  const stored = readStoredSurfaceSelection(surfaceId);
  return stored ? reconcileSurfaceSelection(stored) : null;
};

export const writeSurfaceSelection = (
  surfaceId: string,
  value: SurfaceSelection,
): void => {
  const storage = getLocalStorage();
  if (!storage) {
    return;
  }
  try {
    storage.setItem(storageKey(surfaceId), JSON.stringify(value));
  } catch {
    // localStorage unavailable or quota exceeded
  }
};
