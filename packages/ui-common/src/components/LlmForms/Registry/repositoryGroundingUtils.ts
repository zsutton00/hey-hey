import type {
  ConversationStartRunRequestDtoProviderEnum,
  ConversationStartRunRequestDtoReasoningEffortEnum,
  RepositoryGroundingDeterministicBounds,
} from "../../../api";

export const REPOSITORY_GROUNDING_FIELD_TYPE = "repository_grounding" as const;

export type RepositoryGroundingEntryMode = "existing" | "new";
export type RepositoryGroundingScope = "focused" | "comprehensive";

export type RepositoryGroundingPhase =
  | "prerequisites"
  | "analysis-choice"
  | "ready"
  | "queued"
  | "running"
  | "disconnected"
  | "retryable-error"
  | "failed"
  | "finished-later"
  | "completed";

export const RepositoryGroundingNextAction = {
  StartAnalysis: "START_ANALYSIS",
  RetryAnalysis: "RETRY_ANALYSIS",
  FinishLater: "FINISH_LATER",
  ContinueConversation: "CONTINUE_CONVERSATION",
} as const;

export type RepositoryGroundingNextAction =
  (typeof RepositoryGroundingNextAction)[keyof typeof RepositoryGroundingNextAction];

/**
 * Controlled form state for the repository-grounding field.
 *
 * `phase`, progress, and result metadata are read-only projections of the
 * persisted workflow state. They are deliberately not sent by
 * `buildRepositoryGroundingSubmission`.
 */
export interface RepositoryGroundingValue {
  entryMode: RepositoryGroundingEntryMode;
  serviceId: string | null;
  brief: string;
  machineId: string | null;
  scope: RepositoryGroundingScope | null;
  focus: string;
  provider: ConversationStartRunRequestDtoProviderEnum | null;
  model: string | null;
  reasoningEffort: ConversationStartRunRequestDtoReasoningEffortEnum | null;
  fastMode: boolean | null;
  bounds: RepositoryGroundingDeterministicBounds | null;
  phase: RepositoryGroundingPhase;
  progress: number | null;
  statusMessage: string | null;
  errorMessage: string | null;
  resultSummary: string | null;
  nextAction?: RepositoryGroundingNextAction;
}

/**
 * The only shape emitted for an onboarding admission action. This is a
 * presentation projection, not a replacement for an OpenAPI request type.
 */
export interface RepositoryGroundingSubmission {
  entryMode: RepositoryGroundingEntryMode;
  serviceId: string;
  brief: string;
  machineId: string;
  scope: RepositoryGroundingScope;
  provider: ConversationStartRunRequestDtoProviderEnum;
  model: string;
  reasoningEffort: ConversationStartRunRequestDtoReasoningEffortEnum;
  fastMode?: boolean;
  bounds: RepositoryGroundingDeterministicBounds;
  nextAction: RepositoryGroundingNextAction;
  focus?: string;
}

export interface RepositoryGroundingPayloadProjection {
  initialValue: Partial<RepositoryGroundingValue>;
  phase: RepositoryGroundingPhase | null;
  progress: number | null;
  statusMessage: string | null;
  errorMessage: string | null;
  resultSummary: string | null;
  bounds: RepositoryGroundingDeterministicBounds | null;
}

export interface RepositoryGroundingValidation {
  valid: boolean;
  errors: readonly string[];
}

interface RepositoryGroundingInitialValueContext {
  uiElement: { payload?: unknown };
  baseValue: unknown;
}

const PROVIDER_LABELS: Record<string, string> = {
  claude: "Claude Code",
  codex: "Codex",
  opencode: "Opencode",
};

export const getRepositoryGroundingProviderLabel = (
  provider: string | null
): string => (provider ? PROVIDER_LABELS[provider] ?? provider : "Not chosen");

const PHASES: readonly RepositoryGroundingPhase[] = [
  "prerequisites",
  "analysis-choice",
  "ready",
  "queued",
  "running",
  "disconnected",
  "retryable-error",
  "failed",
  "finished-later",
  "completed",
];

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const readString = (value: unknown): string | null =>
  typeof value === "string" && value.trim().length > 0 ? value.trim() : null;

const readEditableString = (value: unknown): string | null =>
  typeof value === "string" ? value : null;

const readNullableString = (value: unknown): string | null =>
  value === null ? null : readString(value);

const readFirstString = (
  record: Record<string, unknown>,
  keys: readonly string[]
): string | null => {
  for (const key of keys) {
    const value = readString(record[key]);
    if (value) return value;
  }
  return null;
};

const readRecordOrInitial = (
  record: Record<string, unknown>,
  key: keyof RepositoryGroundingValue,
  initial: Partial<RepositoryGroundingValue>
): unknown => (record[key] === undefined ? initial[key] : record[key]);

const isProvider = (
  value: unknown
): value is ConversationStartRunRequestDtoProviderEnum =>
  value === "claude" || value === "codex" || value === "opencode";

const readProvider = (
  value: unknown
): ConversationStartRunRequestDtoProviderEnum | null =>
  isProvider(value) ? value : null;

const readReasoningEffort = (
  value: unknown
): ConversationStartRunRequestDtoReasoningEffortEnum | null =>
  value === "low" ||
  value === "medium" ||
  value === "high" ||
  value === "xhigh" ||
  value === "max"
    ? value
    : null;

const readBoolean = (value: unknown): boolean | null =>
  typeof value === "boolean" ? value : null;

const readScope = (value: unknown): RepositoryGroundingScope | null => {
  if (value === "focused" || value === "comprehensive") return value;
  if (!isRecord(value)) return null;
  return value.scope === "focused" || value.scope === "comprehensive"
    ? value.scope
    : null;
};

const readEntryMode = (value: unknown): RepositoryGroundingEntryMode =>
  value === "new" || value === "new_service" || value === "new_project"
    ? "new"
    : "existing";

const normalizePhase = (value: unknown): RepositoryGroundingPhase | null => {
  if (typeof value !== "string") return null;
  if (PHASES.includes(value as RepositoryGroundingPhase)) {
    return value as RepositoryGroundingPhase;
  }

  const aliases: Record<string, RepositoryGroundingPhase> = {
    analysis: "analysis-choice",
    analysis_choice: "analysis-choice",
    "in-progress": "running",
    in_progress: "running",
    processing: "running",
    waiting_for_connection: "disconnected",
    disconnected_retryable: "disconnected",
    retryable_failure: "retryable-error",
    retryable_error: "retryable-error",
    finish_later: "finished-later",
    finished_later: "finished-later",
  };
  return aliases[value] ?? null;
};

const readProgress = (value: unknown): number | null => {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.min(100, Math.max(0, value));
};

const BOUND_KEYS = [
  "maxFiles",
  "maxTotalBytes",
  "maxFileBytes",
  "maxDepth",
  "maxGeneratedFiles",
  "maxIgnoredFiles",
  "maxUnsupportedFiles",
  "maxBinaryFiles",
] as const;

const readBound = (
  record: Record<string, unknown>,
  key: (typeof BOUND_KEYS)[number],
  minimum: number
): number | null => {
  const value = record[key];
  return typeof value === "number" &&
    Number.isInteger(value) &&
    value >= minimum
    ? value
    : null;
};

const readBounds = (
  value: unknown
): RepositoryGroundingDeterministicBounds | null => {
  if (!isRecord(value)) return null;

  const bounds = {
    maxFiles: readBound(value, "maxFiles", 1),
    maxTotalBytes: readBound(value, "maxTotalBytes", 1),
    maxFileBytes: readBound(value, "maxFileBytes", 1),
    maxDepth: readBound(value, "maxDepth", 0),
    maxGeneratedFiles: readBound(value, "maxGeneratedFiles", 0),
    maxIgnoredFiles: readBound(value, "maxIgnoredFiles", 0),
    maxUnsupportedFiles: readBound(value, "maxUnsupportedFiles", 0),
    maxBinaryFiles: readBound(value, "maxBinaryFiles", 0),
  };

  return BOUND_KEYS.every((key) => bounds[key] !== null)
    ? (bounds as RepositoryGroundingDeterministicBounds)
    : null;
};

const readInitialValueFromRecord = (
  candidate: Record<string, unknown>
): Partial<RepositoryGroundingValue> => {
  const initial: Partial<RepositoryGroundingValue> = {};
  const entryMode = candidate.entryMode;
  if (entryMode !== undefined) initial.entryMode = readEntryMode(entryMode);

  const serviceId = readNullableString(candidate.serviceId);
  if (serviceId !== null || candidate.serviceId === null) {
    initial.serviceId = serviceId;
  }

  const brief = readString(candidate.brief ?? candidate.confirmedServiceBrief);
  if (brief !== null) initial.brief = brief;

  const machineId = readNullableString(candidate.machineId);
  if (machineId !== null || candidate.machineId === null) {
    initial.machineId = machineId;
  }

  const scope = readScope(candidate.scope);
  if (scope) {
    initial.scope = scope;
    if (scope === "focused" && isRecord(candidate.scope)) {
      const scopedFocus = readString(candidate.scope.focus);
      if (scopedFocus !== null && candidate.focus === undefined) {
        initial.focus = scopedFocus;
      }
    }
  }

  const focus = readString(candidate.focus);
  if (focus !== null) initial.focus = focus;

  const provider = readProvider(candidate.provider);
  if (provider) initial.provider = provider;

  const model = readString(
    candidate.model ??
      candidate.frontierModel ??
      candidate.resolvedFrontierModel
  );
  if (model !== null) initial.model = model;

  const reasoningEffort = readReasoningEffort(candidate.reasoningEffort);
  if (reasoningEffort !== null) initial.reasoningEffort = reasoningEffort;

  const fastMode = readBoolean(candidate.fastMode);
  if (fastMode !== null) initial.fastMode = fastMode;

  const bounds = readBounds(candidate.bounds);
  if (bounds !== null) initial.bounds = bounds;

  return initial;
};

const readInitialValue = (
  value: Record<string, unknown>
): Partial<RepositoryGroundingValue> => {
  const candidates: Record<string, unknown>[] = [value];
  const analysis = isRecord(value.analysis) ? value.analysis : undefined;
  const state = isRecord(value.state) ? value.state : undefined;
  const savedChoices = isRecord(value.savedChoices)
    ? value.savedChoices
    : undefined;
  const stateSavedChoices =
    state && isRecord(state.savedChoices) ? state.savedChoices : undefined;
  const initialValue = isRecord(value.initialValue)
    ? value.initialValue
    : undefined;
  const analysisConfiguration = isRecord(value.analysisConfiguration)
    ? value.analysisConfiguration
    : undefined;

  for (const candidate of [
    analysis,
    state,
    savedChoices,
    stateSavedChoices,
    initialValue,
    analysisConfiguration,
  ]) {
    if (candidate) candidates.push(candidate);
  }

  return candidates.reduce<Partial<RepositoryGroundingValue>>(
    (initial, candidate) => ({
      ...initial,
      ...readInitialValueFromRecord(candidate),
    }),
    {}
  );
};

export const readRepositoryGroundingPayload = (
  payload: unknown
): RepositoryGroundingPayloadProjection => {
  if (!isRecord(payload)) {
    return {
      initialValue: {},
      phase: null,
      progress: null,
      statusMessage: null,
      errorMessage: null,
      resultSummary: null,
      bounds: null,
    };
  }

  const state = isRecord(payload.state)
    ? payload.state
    : isRecord(payload.analysis)
    ? payload.analysis
    : payload;
  const analysisConfiguration = isRecord(payload.analysisConfiguration)
    ? payload.analysisConfiguration
    : undefined;
  const bounds =
    readBounds(payload.bounds) ??
    readBounds(state.bounds) ??
    readBounds(analysisConfiguration?.bounds);

  return {
    initialValue: readInitialValue(payload),
    phase: normalizePhase(state.phase ?? state.status),
    progress: readProgress(state.progress ?? state.progressPercent),
    statusMessage: readFirstString(state, ["statusMessage", "message"]),
    errorMessage: readFirstString(state, ["errorMessage", "error"]),
    resultSummary: readFirstString(state, ["resultSummary", "summary"]),
    bounds,
  };
};

const readNextAction = (
  value: unknown
): RepositoryGroundingNextAction | undefined =>
  value === RepositoryGroundingNextAction.StartAnalysis ||
  value === RepositoryGroundingNextAction.RetryAnalysis ||
  value === RepositoryGroundingNextAction.FinishLater ||
  value === RepositoryGroundingNextAction.ContinueConversation
    ? value
    : undefined;

export const normalizeRepositoryGroundingValue = (
  value: unknown,
  payload: RepositoryGroundingPayloadProjection = readRepositoryGroundingPayload(
    undefined
  )
): RepositoryGroundingValue => {
  const record = isRecord(value) ? value : {};
  const initial = payload.initialValue;
  const rawPhase = normalizePhase(record.phase ?? record.status);
  const serviceId =
    readNullableString(readRecordOrInitial(record, "serviceId", initial)) ??
    null;
  const machineId =
    readNullableString(readRecordOrInitial(record, "machineId", initial)) ??
    null;

  return {
    entryMode: readEntryMode(readRecordOrInitial(record, "entryMode", initial)),
    serviceId,
    brief:
      readEditableString(readRecordOrInitial(record, "brief", initial)) ?? "",
    machineId,
    scope: readScope(readRecordOrInitial(record, "scope", initial)),
    focus:
      readEditableString(readRecordOrInitial(record, "focus", initial)) ?? "",
    provider: readProvider(readRecordOrInitial(record, "provider", initial)),
    model: readString(readRecordOrInitial(record, "model", initial)) ?? null,
    reasoningEffort: readReasoningEffort(
      readRecordOrInitial(record, "reasoningEffort", initial)
    ),
    fastMode: readBoolean(readRecordOrInitial(record, "fastMode", initial)),
    bounds:
      readBounds(readRecordOrInitial(record, "bounds", initial)) ??
      payload.bounds ??
      null,
    phase: payload.phase ?? rawPhase ?? (serviceId ? "ready" : "prerequisites"),
    progress: readProgress(payload.progress ?? record.progress),
    statusMessage:
      readString(payload.statusMessage ?? record.statusMessage) ?? null,
    errorMessage:
      readString(payload.errorMessage ?? record.errorMessage) ?? null,
    resultSummary:
      readString(payload.resultSummary ?? record.resultSummary) ?? null,
    nextAction: readNextAction(record.nextAction),
  };
};

export const createRepositoryGroundingValue = (
  initial?: Partial<RepositoryGroundingValue>
): RepositoryGroundingValue =>
  normalizeRepositoryGroundingValue(initial ?? {}, {
    initialValue: {},
    phase: null,
    progress: null,
    statusMessage: null,
    errorMessage: null,
    resultSummary: null,
    bounds: null,
  });

export const prepareRepositoryGroundingInitialValue = ({
  uiElement,
  baseValue,
}: RepositoryGroundingInitialValueContext): RepositoryGroundingValue =>
  normalizeRepositoryGroundingValue(
    baseValue === undefined ? undefined : baseValue,
    readRepositoryGroundingPayload(uiElement.payload)
  );

export const getRepositoryGroundingValidation = ({
  value,
  hasReadyMachine,
  bindingReady,
  isRuntimeSelectionValid = ({ model }) => model.length > 0,
}: {
  value: RepositoryGroundingValue;
  hasReadyMachine: boolean;
  bindingReady: boolean;
  isRuntimeSelectionValid?: (selection: {
    provider: ConversationStartRunRequestDtoProviderEnum;
    model: string;
    reasoningEffort: ConversationStartRunRequestDtoReasoningEffortEnum;
    fastMode: boolean | null;
  }) => boolean;
}): RepositoryGroundingValidation => {
  const errors: string[] = [];
  if (!value.serviceId) errors.push("Select or create one Service.");
  if (!value.brief.trim()) errors.push("Confirm a brief for the Service.");
  if (!value.machineId || !hasReadyMachine) {
    errors.push("Select a ready CLI machine.");
  }
  if (!bindingReady) {
    errors.push("Link the Service to the selected machine's directory.");
  }
  if (!value.scope) errors.push("Choose a focused or comprehensive analysis.");
  if (value.scope === "focused" && !value.focus.trim()) {
    errors.push("Add a focus for focused analysis.");
  }
  if (!value.bounds) {
    errors.push("Wait for the API to provide deterministic analysis bounds.");
  }

  if (!value.provider) {
    errors.push("Choose an available analysis provider.");
  } else {
    if (
      !value.model ||
      !value.reasoningEffort ||
      !isRuntimeSelectionValid({
        provider: value.provider,
        model: value.model,
        reasoningEffort: value.reasoningEffort,
        fastMode: value.fastMode,
      })
    ) {
      errors.push(
        "Choose a complete runtime configuration supported by the runtime catalog."
      );
    }
  }

  return { valid: errors.length === 0, errors };
};

export const buildRepositoryGroundingSubmission = ({
  value,
  action,
}: {
  value: RepositoryGroundingValue;
  action: RepositoryGroundingNextAction;
}): RepositoryGroundingSubmission | null => {
  const scope = value.scope;
  const serviceId = value.serviceId;
  const machineId = value.machineId;
  const brief = value.brief.trim();
  const focus = value.focus.trim();
  const bounds = value.bounds;
  const provider = value.provider;
  const model = value.model;
  const reasoningEffort = value.reasoningEffort;

  if (
    !scope ||
    !serviceId ||
    !machineId ||
    !brief ||
    !provider ||
    !model ||
    !reasoningEffort
  )
    return null;
  if (scope === "focused" && !focus) return null;
  if (!bounds) return null;

  return {
    entryMode: value.entryMode,
    serviceId,
    brief,
    machineId,
    scope,
    provider,
    model,
    reasoningEffort,
    ...(value.fastMode !== null ? { fastMode: value.fastMode } : {}),
    bounds,
    nextAction: action,
    ...(scope === "focused" ? { focus } : {}),
  };
};

export const getRepositoryGroundingPhaseLabel = (
  phase: RepositoryGroundingPhase
): string => {
  switch (phase) {
    case "queued":
      return "Analysis queued";
    case "running":
      return "Analysis in progress";
    case "disconnected":
      return "Waiting for the CLI connection";
    case "retryable-error":
      return "Analysis needs a retry";
    case "failed":
      return "Analysis could not be completed";
    case "finished-later":
      return "Analysis saved for later";
    case "completed":
      return "Analysis complete";
    case "analysis-choice":
      return "Choose analysis settings";
    case "ready":
      return "Ready to start analysis";
    case "prerequisites":
      return "Repository prerequisites";
  }
};
