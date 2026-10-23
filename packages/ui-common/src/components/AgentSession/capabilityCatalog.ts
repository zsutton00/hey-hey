import {
  ConversationStartRunRequestDtoProviderEnum,
  ConversationStartRunRequestDtoReasoningEffortEnum,
} from "../../api";

export interface OpencodeModelRef {
  providerID: string;
  modelID: string;
}

// The OpenCode row that carries no model reference: choosing it lets OpenCode
// use its own default model. Every other OpenCode row names its model.
export const OPENCODE_DEFAULT_MODEL_ID = "opencode-default";

export const MODEL_SERVICE_TIERS = ["priority"] as const;
export type ModelServiceTier = (typeof MODEL_SERVICE_TIERS)[number];

export interface CapabilityCatalogModel {
  id: string;
  label: string;
  efforts: readonly string[];
  serviceTiers?: readonly ModelServiceTier[];
  // OpenCode rows only: the {providerID, modelID} pair the OpenCode HTTP API
  // requires on its `model` field. Omitted on the catalog's default row so the
  // runner falls back to OpenCode's own default model selection.
  opencodeModelRef?: OpencodeModelRef;
}

export interface CapabilityCatalogRow {
  provider: ConversationStartRunRequestDtoProviderEnum;
  models: readonly CapabilityCatalogModel[];
  // Present only when an installed provider reported zero models: explains the
  // empty list to the user. Never present alongside models.
  notice?: string;
}

export interface RuntimeCapabilityCatalogPayload {
  providers: readonly CapabilityCatalogRow[];
}

export type CapabilityCatalogLoadState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "ready"; catalog: readonly CapabilityCatalogRow[] }
  | { status: "error"; error: string };

// What the CLI on each machine reported, keyed by machine id. Surfaces address
// one machine each; the synchronous helpers below read the catalog of the
// machine most recently activated by a mounted surface.
const machineStates = new Map<string, CapabilityCatalogLoadState>();
let activeMachineId: string | null = null;
// A catalog built in-process (the CLI builds its own from what each provider
// reports; tests install a fixture). When present it answers for every machine.
let installedCatalog: readonly CapabilityCatalogRow[] | null = null;
let installedState: CapabilityCatalogLoadState | null = null;
const IDLE_STATE: CapabilityCatalogLoadState = { status: "idle" };
const listeners = new Set<() => void>();

const emitCatalogState = () => {
  for (const listener of listeners) {
    listener();
  }
};

export const subscribeCapabilityCatalog = (
  listener: () => void,
): (() => void) => {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
};

/** The load state of one machine's catalog; idle until a read has started. */
export const getCapabilityCatalogLoadState = (
  machineId: string | null,
): CapabilityCatalogLoadState => {
  if (installedState) {
    return installedState;
  }
  return (machineId ? machineStates.get(machineId) : undefined) ?? IDLE_STATE;
};

export const setMachineCapabilityCatalogState = (
  machineId: string,
  state: CapabilityCatalogLoadState,
): void => {
  machineStates.set(machineId, state);
  emitCatalogState();
};

/**
 * Makes `machineId`'s catalog the one the synchronous helpers answer from.
 * Idempotent and silent, so surfaces may call it while rendering.
 */
export const activateCapabilityCatalogMachine = (
  machineId: string | null,
): void => {
  activeMachineId = machineId;
};

/** Throws when rows would not be accepted as a catalog; returns them validated. */
export const validateCapabilityCatalogRows = (
  providers: readonly CapabilityCatalogRow[],
): readonly CapabilityCatalogRow[] =>
  parseRuntimeCapabilityCatalog({ providers }).providers;

/**
 * Installs a catalog built in-process (the CLI builds it from what each
 * provider reports). Validates it with the same rules as a catalog read from a
 * CLI.
 */
export const installCapabilityCatalog = (
  providers: readonly CapabilityCatalogRow[],
): void => {
  installedCatalog = validateCapabilityCatalogRows(providers);
  installedState = { status: "ready", catalog: installedCatalog };
  emitCatalogState();
};

export const setCapabilityCatalogForTests = installCapabilityCatalog;

export const resetCapabilityCatalogForTests = (): void => {
  installedCatalog = null;
  installedState = null;
  activeMachineId = null;
  machineStates.clear();
  emitCatalogState();
};

const getCatalog = (): readonly CapabilityCatalogRow[] => {
  if (installedCatalog) {
    return installedCatalog;
  }
  const state = activeMachineId
    ? machineStates.get(activeMachineId)
    : undefined;
  return state?.status === "ready" ? state.catalog : [];
};

/** The notice the CLI attached to each installed provider that reported zero models. */
export const listCatalogNotices = (): readonly {
  provider: ConversationStartRunRequestDtoProviderEnum;
  notice: string;
}[] =>
  getCatalog().flatMap((row) =>
    row.notice ? [{ provider: row.provider, notice: row.notice }] : [],
  );

const REASONING_EFFORT_IDS: readonly string[] = Object.values(
  ConversationStartRunRequestDtoReasoningEffortEnum,
);

const isLocalReasoningEffort = (
  value: unknown,
): value is ConversationStartRunRequestDtoReasoningEffortEnum =>
  typeof value === "string" && REASONING_EFFORT_IDS.includes(value);

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readNonEmptyString = (value: unknown, field: string): string => {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`Catalog ${field} must be a non-empty string.`);
  }
  return value;
};

const parseProvider = (
  value: unknown,
): ConversationStartRunRequestDtoProviderEnum => {
  if (
    value === ConversationStartRunRequestDtoProviderEnum.Claude ||
    value === ConversationStartRunRequestDtoProviderEnum.Codex ||
    value === ConversationStartRunRequestDtoProviderEnum.Opencode
  ) {
    return value;
  }
  throw new Error("Catalog provider was not recognized.");
};

const parseEfforts = (value: unknown): readonly string[] => {
  if (!Array.isArray(value)) {
    throw new Error("Catalog model efforts must be an array of strings.");
  }
  const unknown = value.find((entry) => !isLocalReasoningEffort(entry));
  if (unknown !== undefined) {
    throw new Error(
      `Catalog model effort ${JSON.stringify(unknown)} is not a launchable reasoning effort.`,
    );
  }
  return value;
};

const parseServiceTiers = (
  value: unknown,
  provider: ConversationStartRunRequestDtoProviderEnum,
): readonly ModelServiceTier[] | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (
    (provider !== ConversationStartRunRequestDtoProviderEnum.Codex &&
      provider !== ConversationStartRunRequestDtoProviderEnum.Claude) ||
    !Array.isArray(value) ||
    value.some((entry) => entry !== "priority") ||
    new Set(value).size !== value.length
  ) {
    throw new Error("Catalog serviceTiers contained unsupported metadata.");
  }
  return value;
};

const parseOpencodeModelRef = (
  value: unknown,
  provider: ConversationStartRunRequestDtoProviderEnum,
): OpencodeModelRef | undefined => {
  if (value === undefined) {
    return undefined;
  }
  if (
    provider !== ConversationStartRunRequestDtoProviderEnum.Opencode ||
    !isRecord(value)
  ) {
    throw new Error("Catalog opencodeModelRef was invalid for its provider.");
  }
  return {
    providerID: readNonEmptyString(value["providerID"], "opencode providerID"),
    modelID: readNonEmptyString(value["modelID"], "opencode modelID"),
  };
};

const parseModel = (
  value: unknown,
  provider: ConversationStartRunRequestDtoProviderEnum,
): CapabilityCatalogModel => {
  if (!isRecord(value)) {
    throw new Error("Catalog model rows must be objects.");
  }
  const serviceTiers = parseServiceTiers(value["serviceTiers"], provider);
  const opencodeModelRef = parseOpencodeModelRef(
    value["opencodeModelRef"],
    provider,
  );
  return {
    id: readNonEmptyString(value["id"], "model id"),
    label: readNonEmptyString(value["label"], "model label"),
    efforts: parseEfforts(value["efforts"]),
    ...(serviceTiers ? { serviceTiers } : {}),
    ...(opencodeModelRef ? { opencodeModelRef } : {}),
  };
};

/** Validates a catalog payload read from a CLI; throws naming what is wrong. */
export const parseRuntimeCapabilityCatalog = (
  value: unknown,
): RuntimeCapabilityCatalogPayload => {
  if (!isRecord(value) || !Array.isArray(value["providers"])) {
    throw new Error("Catalog payload must contain a providers array.");
  }
  const seenProviders = new Set<ConversationStartRunRequestDtoProviderEnum>();
  const providers = value["providers"].map((entry): CapabilityCatalogRow => {
    if (!isRecord(entry) || !Array.isArray(entry["models"])) {
      throw new Error("Catalog provider rows must contain a models array.");
    }
    const provider = parseProvider(entry["provider"]);
    const notice =
      entry["notice"] === undefined
        ? undefined
        : readNonEmptyString(entry["notice"], "provider notice");
    if ((entry["models"].length === 0) !== (notice !== undefined)) {
      throw new Error(
        "Catalog provider rows must contain at least one model, or a notice explaining why they contain none.",
      );
    }
    if (seenProviders.has(provider)) {
      throw new Error("Catalog provider rows must be unique.");
    }
    seenProviders.add(provider);
    const models = entry["models"].map((model) => {
      try {
        return parseModel(model, provider);
      } catch (error) {
        const id = isRecord(model) ? JSON.stringify(model["id"]) : "unknown";
        throw new Error(
          `Catalog ${provider} model ${id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    });
    if (new Set(models.map((model) => model.id)).size !== models.length) {
      throw new Error("Catalog model ids must be unique within a provider.");
    }
    return { provider, models, ...(notice ? { notice } : {}) };
  });
  return { providers };
};

export const listProviders =
  (): readonly ConversationStartRunRequestDtoProviderEnum[] =>
    getCatalog().map((row) => row.provider);

export const listModels = (
  provider: ConversationStartRunRequestDtoProviderEnum,
): readonly CapabilityCatalogModel[] => {
  const row = getCatalog().find((entry) => entry.provider === provider);
  return row ? row.models : [];
};

export const listEfforts = (
  provider: ConversationStartRunRequestDtoProviderEnum,
  model: string,
): readonly ConversationStartRunRequestDtoReasoningEffortEnum[] => {
  const row = getCatalog().find((entry) => entry.provider === provider);
  if (!row) {
    return [];
  }
  const entry = row.models.find((candidate) => candidate.id === model);
  return entry ? entry.efforts.filter(isLocalReasoningEffort) : [];
};

export const getOpencodeModelRef = (model: string): OpencodeModelRef | null => {
  const row = getCatalog().find(
    (entry) =>
      entry.provider === ConversationStartRunRequestDtoProviderEnum.Opencode,
  );
  if (!row) {
    return null;
  }
  const entry = row.models.find((candidate) => candidate.id === model);
  return entry?.opencodeModelRef ?? null;
};

export const supportsFastMode = (
  provider: ConversationStartRunRequestDtoProviderEnum,
  model: string,
): boolean =>
  listModels(provider)
    .find((candidate) => candidate.id === model)
    ?.serviceTiers?.includes("priority") === true;
