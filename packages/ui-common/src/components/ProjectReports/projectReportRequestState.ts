import type {
  ActivityCorrelationSource,
  CreateProjectReportRequestDto,
  ProjectReportAttempt,
  ProjectReportKind,
  ProjectReportLaunchConfig,
  ProjectReportPreset,
  ProjectReportPreviewRequestDto,
  ProjectReportPreviewRow,
  ProjectReportRequestDto,
  ProjectReportScope,
  ProjectReportSubject,
} from "../../api";
import { ProjectReportStatus } from "../../api";
import { supportsFastMode } from "../AgentSession/capabilityCatalog";
import type { SurfaceSelection } from "../AgentSession/surfaceSelectionMemory";

// ---------------------------------------------------------------------------
// Presets
// ---------------------------------------------------------------------------

export interface ProjectReportPresetOption {
  key: string;
  outline: string;
  label: string;
}

const KIND_QUESTIONS: Record<ProjectReportKind, string> = {
  PROJECT_REPORT:
    "Give an update on every recorded action in this period. Group related changes and explain what they mean for the project.",
  RELEASE_NOTES: "Describe what shipped in product terms.",
};

/**
 * Guides seed only the outline. They are carried as
 * provenance on submission and never act as a separate report discriminator.
 */
export const PROJECT_REPORT_PRESETS: readonly ProjectReportPresetOption[] = [
  {
    key: "activity-update",
    label: "Activity update",
    outline:
      "Summary\nChanges grouped by area\nWhat the changes mean for the project\nCoverage and limitations",
  },
  {
    key: "weekly-recap",
    label: "Weekly recap",
    outline:
      "Highlights\nProgress by feature\nBlocked or stalled work\nRecommended next steps\nCoverage and limitations",
  },
  {
    key: "goal-progress",
    label: "Goal progress",
    outline:
      "Goals in scope\nProgress evidence per goal\nRisks to goals\nCoverage and limitations",
  },
];

export const RELEASE_NOTES_PRESETS: readonly ProjectReportPresetOption[] = [
  {
    key: "release-notes",
    label: "Release notes",
    outline:
      "Highlights\nDelivered capabilities\nFixes\nCoverage and limitations",
  },
  {
    key: "product-area",
    label: "By product area",
    outline: "Summary\nChanges by product area\nCoverage and limitations",
  },
  {
    key: "internal-changelog",
    label: "Internal changelog",
    outline:
      "Summary\nProduct changes\nTechnical changes\nCoverage and limitations",
  },
];

export const reportGuides = (kind: ProjectReportKind) =>
  kind === "RELEASE_NOTES" ? RELEASE_NOTES_PRESETS : PROJECT_REPORT_PRESETS;

// ---------------------------------------------------------------------------
// Period and scope
// ---------------------------------------------------------------------------

export type ProjectReportPeriod =
  | { kind: "last24Hours" }
  | { kind: "last7Days" }
  | { kind: "custom"; start: string; end: string };

export type ProjectReportPeriodKind = ProjectReportPeriod["kind"];

export const PROJECT_REPORT_PERIOD_LABELS: Record<
  ProjectReportPeriodKind,
  string
> = {
  last24Hours: "Last 24 hours",
  last7Days: "Last 7 days",
  custom: "Custom range",
};

export type ProjectReportPeopleFilter = "everyone" | "me";

export type ProjectReportActivityFilter = "all" | ActivityCorrelationSource;

export interface ProjectReportScopeSelection {
  period: ProjectReportPeriod;
  people: ProjectReportPeopleFilter;
  activity: ProjectReportActivityFilter;
}

export interface ProjectReportScopeContext {
  projectId: string;
  currentUserId: string;
  timeZone: string;
}

const HOUR_MS = 60 * 60 * 1000;

export type ResolvedScopeResult =
  { ok: true; scope: ProjectReportScope } | { ok: false; reason: string };

/**
 * Resolves relative periods to fixed start-inclusive/end-exclusive bounds.
 * Resolution happens once per scope change; refresh never re-resolves.
 */
export const resolveProjectReportScope = (
  selection: ProjectReportScopeSelection,
  context: ProjectReportScopeContext,
  now: Date,
): ResolvedScopeResult => {
  const bounds = resolvePeriodBounds(selection.period, now);
  if (!bounds.ok) {
    return bounds;
  }
  return {
    ok: true,
    scope: {
      projectId: context.projectId,
      windowStart: bounds.start,
      windowEnd: bounds.end,
      timeZone: context.timeZone,
      ...(selection.people === "me" ? { userId: context.currentUserId } : {}),
      ...(selection.activity === "all"
        ? {}
        : { sources: [selection.activity] }),
    },
  };
};

const resolvePeriodBounds = (
  period: ProjectReportPeriod,
  now: Date,
): { ok: true; start: string; end: string } | { ok: false; reason: string } => {
  switch (period.kind) {
    case "last24Hours":
      return {
        ok: true,
        start: new Date(now.getTime() - 24 * HOUR_MS).toISOString(),
        end: now.toISOString(),
      };
    case "last7Days":
      return {
        ok: true,
        start: new Date(now.getTime() - 7 * 24 * HOUR_MS).toISOString(),
        end: now.toISOString(),
      };
    case "custom": {
      const start = Date.parse(period.start);
      const end = Date.parse(period.end);
      if (Number.isNaN(start) || Number.isNaN(end)) {
        return { ok: false, reason: "Enter both a start and an end." };
      }
      if (end <= start) {
        return { ok: false, reason: "The end must be after the start." };
      }
      return {
        ok: true,
        start: new Date(start).toISOString(),
        end: new Date(end).toISOString(),
      };
    }
  }
};

// ---------------------------------------------------------------------------
// Draft state
// ---------------------------------------------------------------------------

/** An excluded subject together with the server-authored title shown to users. */
export interface ProjectReportExclusion {
  subject: ProjectReportSubject;
  title: string;
}

export type ProjectReportPreviewView = "all" | "excluded";

export const PROJECT_REPORT_PAGE_SIZES = [10, 25, 50] as const;
export type ProjectReportPageSize = (typeof PROJECT_REPORT_PAGE_SIZES)[number];

export type ProjectReportSubmission =
  | { status: "idle" }
  | { status: "submitting" }
  | { status: "failed"; message: string }
  | { status: "submitted"; requestId: string };

/**
 * Step 1 holds the question and the agent that writes the report; step 2
 * holds the range and entities. Both edit the same request state.
 */
export type ProjectReportRequestStep = "questions" | "scope";

/**
 * The provider, model, effort, and Fast mode that write the report. Fast mode
 * is explicit in editable state; unsupported launches omit it.
 */
export interface ProjectReportAgentSelection extends Omit<
  SurfaceSelection,
  "fastMode"
> {
  fastMode: boolean;
}

export interface ProjectReportRequestState {
  step: ProjectReportRequestStep;
  /** RELEASE_NOTES reads merged history from the selected machine repositories. */
  kind: ProjectReportKind;
  serviceIds: string[];
  repositoryMachineId: string | null;
  availableServiceIds: string[];
  /** Null until the selected machine's CLI has said what it can launch. */
  agent: ProjectReportAgentSelection | null;
  question: string;
  outline: string;
  preset: ProjectReportPreset;
  selection: ProjectReportScopeSelection;
  scope: ResolvedScopeResult;
  exclusions: ProjectReportExclusion[];
  /** Number of exclusions cleared by the most recent scope change. */
  scopeResetExclusionCount: number;
  search: string;
  view: ProjectReportPreviewView;
  pageSize: ProjectReportPageSize;
  offset: number;
  /**
   * Reused across retries of an unchanged draft so a resubmission after a
   * transport failure cannot start a second report. Cleared by any edit to
   * submitted content.
   */
  idempotencyKey: string | null;
  submission: ProjectReportSubmission;
}

/**
 * The surface supplies the initial agent selection, or null while it waits for
 * the CLI's catalog; this module never defaults it.
 */
export const createProjectReportRequestState = (
  context: ProjectReportScopeContext,
  now: Date,
  agent: ProjectReportAgentSelection | null,
): ProjectReportRequestState => {
  const preset = PROJECT_REPORT_PRESETS[0];
  const selection: ProjectReportScopeSelection = {
    period: { kind: "last24Hours" },
    people: "everyone",
    activity: "all",
  };
  return {
    step: "questions",
    kind: "PROJECT_REPORT",
    serviceIds: [],
    repositoryMachineId: null,
    availableServiceIds: [],
    agent,
    question: KIND_QUESTIONS.PROJECT_REPORT,
    outline: preset.outline,
    preset: toPresetProvenance(preset, KIND_QUESTIONS.PROJECT_REPORT),
    selection,
    scope: resolveProjectReportScope(selection, context, now),
    exclusions: [],
    scopeResetExclusionCount: 0,
    search: "",
    view: "all",
    pageSize: PROJECT_REPORT_PAGE_SIZES[0],
    offset: 0,
    idempotencyKey: null,
    submission: { status: "idle" },
  };
};

const toPresetProvenance = (
  preset: ProjectReportPresetOption,
  question: string,
): ProjectReportPreset => ({
  key: preset.key,
  prompt: question,
  outline: preset.outline,
});

export type ProjectReportRequestAction =
  | { type: "next" }
  | { type: "back" }
  | { type: "setAgent"; agent: ProjectReportAgentSelection }
  | { type: "editAgent"; patch: Partial<ProjectReportAgentSelection> }
  | { type: "setKind"; kind: ProjectReportKind }
  | {
      type: "reconcileRepositories";
      machineId: string | null;
      availableServiceIds: string[];
    }
  | { type: "selectRepositories"; serviceIds: string[] }
  | { type: "applyPreset"; preset: ProjectReportPresetOption }
  | { type: "editQuestion"; question: string }
  | { type: "editOutline"; outline: string }
  | {
      type: "changeScope";
      selection: ProjectReportScopeSelection;
      context: ProjectReportScopeContext;
      now: Date;
    }
  | { type: "dismissScopeResetNotice" }
  | { type: "setSearch"; search: string }
  | { type: "setView"; view: ProjectReportPreviewView }
  | { type: "setPageSize"; pageSize: ProjectReportPageSize }
  | { type: "setOffset"; offset: number }
  | { type: "toggleSubject"; row: ProjectReportPreviewRow }
  | { type: "restoreSubject"; subject: ProjectReportSubject }
  | { type: "excludeRows"; rows: ProjectReportPreviewRow[] }
  | { type: "clearExclusions" }
  | { type: "submitStarted"; idempotencyKey: string }
  | { type: "submitFailed"; message: string }
  | { type: "submitSucceeded"; requestId: string };

export const isSameSubject = (
  a: ProjectReportSubject,
  b: ProjectReportSubject,
): boolean => a.entityType === b.entityType && a.entityId === b.entityId;

const isExcluded = (
  exclusions: ProjectReportExclusion[],
  subject: ProjectReportSubject,
): boolean => exclusions.some((entry) => isSameSubject(entry.subject, subject));

/** Edits to submitted content invalidate the previous idempotency identity. */
const withContentEdit = (
  state: ProjectReportRequestState,
  patch: Partial<ProjectReportRequestState>,
): ProjectReportRequestState => {
  if (state.submission.status === "submitting") return state;
  if (state.submission.status === "submitted") return state;
  return {
    ...state,
    ...patch,
    idempotencyKey: null,
    submission: { status: "idle" },
  };
};

export const projectReportRequestReducer = (
  state: ProjectReportRequestState,
  action: ProjectReportRequestAction,
): ProjectReportRequestState => {
  switch (action.type) {
    case "next":
      // Machine readiness lives outside this state; callers gate on selectNextBlocker.
      if (state.step === "scope" || !state.question.trim()) return state;
      return { ...state, step: "scope" };
    case "back":
      if (state.step === "questions") return state;
      if (state.submission.status === "submitting") return state;
      if (state.submission.status === "submitted") return state;
      return { ...state, step: "questions" };
    case "setAgent":
      // Seeds the agent once; it is not an edit of submitted content.
      return state.agent ? state : { ...state, agent: action.agent };
    case "editAgent": {
      // Edits only refine a selection the CLI's catalog already supplied.
      if (!state.agent) return state;
      const current = state.agent;
      const agent = { ...current, ...action.patch };
      const unchanged = (
        Object.keys(agent) as (keyof ProjectReportAgentSelection)[]
      ).every((key) => agent[key] === current[key]);
      if (unchanged) return state;
      // The agent is submitted content, so a change needs a new idempotency key.
      return withContentEdit(state, { agent });
    }
    case "setKind":
      if (state.kind === action.kind) return state;
      return withContentEdit(state, {
        kind: action.kind,
        question: KIND_QUESTIONS[action.kind],
      });
    case "selectRepositories":
      return withContentEdit(state, { serviceIds: action.serviceIds });
    case "reconcileRepositories": {
      const changedMachine = state.repositoryMachineId !== action.machineId;
      const serviceIds = changedMachine
        ? action.availableServiceIds
        : state.serviceIds.filter((id) =>
            action.availableServiceIds.includes(id),
          );
      if (
        !changedMachine &&
        serviceIds.length === state.serviceIds.length &&
        action.availableServiceIds.length ===
          state.availableServiceIds.length &&
        action.availableServiceIds.every((id) =>
          state.availableServiceIds.includes(id),
        )
      )
        return state;
      return withContentEdit(state, {
        repositoryMachineId: action.machineId,
        availableServiceIds: action.availableServiceIds,
        serviceIds,
      });
    }
    case "applyPreset":
      return withContentEdit(state, {
        outline: action.preset.outline,
        preset: toPresetProvenance(action.preset, state.question),
      });
    case "editQuestion":
      // Question edits never touch the structured selection or exclusions.
      return withContentEdit(state, { question: action.question });
    case "editOutline":
      return withContentEdit(state, { outline: action.outline });
    case "changeScope":
      return withContentEdit(state, {
        selection: action.selection,
        scope: resolveProjectReportScope(
          action.selection,
          action.context,
          action.now,
        ),
        exclusions: [],
        scopeResetExclusionCount: state.exclusions.length,
        offset: 0,
        view: "all",
      });
    case "dismissScopeResetNotice":
      return { ...state, scopeResetExclusionCount: 0 };
    case "setSearch":
      // Search narrows only the preview; it never changes report scope.
      return { ...state, search: action.search, offset: 0 };
    case "setView":
      return { ...state, view: action.view, offset: 0 };
    case "setPageSize":
      return { ...state, pageSize: action.pageSize, offset: 0 };
    case "setOffset":
      return { ...state, offset: Math.max(0, action.offset) };
    case "toggleSubject": {
      const { subject, title } = action.row;
      const exclusions = isExcluded(state.exclusions, subject)
        ? state.exclusions.filter(
            (entry) => !isSameSubject(entry.subject, subject),
          )
        : [...state.exclusions, { subject, title }];
      return withContentEdit(state, { exclusions });
    }
    case "restoreSubject": {
      const exclusions = state.exclusions.filter(
        (entry) => !isSameSubject(entry.subject, action.subject),
      );
      const lastPageOffset = Math.max(
        0,
        Math.floor((exclusions.length - 1) / state.pageSize) * state.pageSize,
      );
      return withContentEdit(state, {
        exclusions,
        offset:
          state.view === "excluded"
            ? Math.min(state.offset, lastPageOffset)
            : state.offset,
      });
    }
    case "excludeRows": {
      const additions = action.rows
        .filter((row) => !isExcluded(state.exclusions, row.subject))
        .map((row) => ({ subject: row.subject, title: row.title }));
      if (additions.length === 0) return state;
      return withContentEdit(state, {
        exclusions: [...state.exclusions, ...additions],
      });
    }
    case "clearExclusions":
      if (state.exclusions.length === 0) return state;
      return withContentEdit(state, {
        exclusions: [],
        view: "all",
        offset: 0,
      });
    case "submitStarted":
      if (state.submission.status === "submitting") return state;
      if (state.submission.status === "submitted") return state;
      return {
        ...state,
        idempotencyKey: action.idempotencyKey,
        submission: { status: "submitting" },
      };
    case "submitFailed":
      // Keep the idempotency key so an unchanged retry is deduplicated.
      return {
        ...state,
        submission: { status: "failed", message: action.message },
      };
    case "submitSucceeded":
      return {
        ...state,
        submission: { status: "submitted", requestId: action.requestId },
      };
  }
};

// ---------------------------------------------------------------------------
// Derived views
// ---------------------------------------------------------------------------

export const buildPreviewRequest = (
  state: ProjectReportRequestState,
): ProjectReportPreviewRequestDto | null => {
  if (!state.scope.ok) return null;
  // The Excluded view pages local exclusions; the server read then only
  // supplies authoritative counts, so it stays on the first unfiltered page.
  const isAllView = state.view === "all";
  const search = isAllView ? state.search.trim() : "";
  return {
    scope: state.scope.scope,
    exclusions: state.exclusions.map((entry) => entry.subject),
    ...(search ? { search } : {}),
    limit: state.pageSize,
    offset: isAllView ? state.offset : 0,
  };
};

export const previewRequestKey = (
  request: ProjectReportPreviewRequestDto,
): string => JSON.stringify(request);

/** Excluded view is served from the locally held typed exclusions. */
export const selectExcludedPage = (
  state: ProjectReportRequestState,
): { rows: ProjectReportExclusion[]; total: number } => {
  const search = state.search.trim().toLowerCase();
  const matching = search
    ? state.exclusions.filter((entry) =>
        entry.title.toLowerCase().includes(search),
      )
    : state.exclusions;
  return {
    rows: matching.slice(state.offset, state.offset + state.pageSize),
    total: matching.length,
  };
};

export interface PreviewCounts {
  matchingSubjectCount: number;
  includedSubjectCount: number;
  excludedSubjectCount: number;
}

export type SubmitBlocker =
  | { kind: "scopeInvalid"; reason: string }
  | { kind: "emptyQuestion" }
  | { kind: "previewUnavailable" }
  | { kind: "emptyPopulation" }
  | { kind: "allExcluded" }
  | { kind: "noMachine" }
  | { kind: "noRepositories" }
  | { kind: "noAgent" }
  | { kind: "noEffort" }
  | { kind: "inFlight" };

export const describeSubmitBlocker = (blocker: SubmitBlocker): string => {
  switch (blocker.kind) {
    case "scopeInvalid":
      return blocker.reason;
    case "emptyQuestion":
      return "Describe what you would like to understand.";
    case "previewUnavailable":
      return "Wait for the current scope to load before creating the report.";
    case "emptyPopulation":
      return "No entities match this scope, so there is nothing to report on.";
    case "allExcluded":
      return "Every matching entity is excluded. Include at least one to create a report.";
    case "noMachine":
      return "Choose a ready CLI machine to generate the report.";
    case "noRepositories":
      return "Select at least one available repository.";
    case "noAgent":
      return "Wait for the selected machine's model choices to load.";
    case "noEffort":
      return "Choose a reasoning effort for the selected model.";
    case "inFlight":
      return "The report request is being submitted.";
  }
};

export const selectSubmitBlocker = (
  state: ProjectReportRequestState,
  input: {
    /** Server counts for the current preview request, or null when not current. */
    counts: PreviewCounts | null;
    machineId: string | null;
    hasEffort: boolean;
  },
): SubmitBlocker | null => {
  if (state.submission.status === "submitting") return { kind: "inFlight" };
  if (!state.scope.ok)
    return { kind: "scopeInvalid", reason: state.scope.reason };
  if (!state.question.trim()) return { kind: "emptyQuestion" };
  if (!input.counts) return { kind: "previewUnavailable" };
  if (input.counts.matchingSubjectCount === 0)
    return { kind: "emptyPopulation" };
  if (input.counts.includedSubjectCount === 0) return { kind: "allExcluded" };
  if (!input.machineId) return { kind: "noMachine" };
  if (
    state.kind === "RELEASE_NOTES" &&
    (state.repositoryMachineId !== input.machineId ||
      !state.serviceIds.length ||
      state.serviceIds.some((id) => !state.availableServiceIds.includes(id)))
  )
    return { kind: "noRepositories" };
  if (!state.agent) return { kind: "noAgent" };
  if (!input.hasEffort) return { kind: "noEffort" };
  return null;
};

export type NextStepBlocker = Extract<
  SubmitBlocker,
  {
    kind:
      "emptyQuestion" | "noMachine" | "noAgent" | "noEffort" | "noRepositories";
  }
>;

/** Step 1 needs a question and a complete agent choice. */
export const selectNextBlocker = (
  state: ProjectReportRequestState,
  machineId: string | null,
): NextStepBlocker | null => {
  if (!state.question.trim()) return { kind: "emptyQuestion" };
  if (!machineId) return { kind: "noMachine" };
  if (
    state.kind === "RELEASE_NOTES" &&
    (state.repositoryMachineId !== machineId ||
      !state.serviceIds.length ||
      state.serviceIds.some((id) => !state.availableServiceIds.includes(id)))
  )
    return { kind: "noRepositories" };
  if (!state.agent) return { kind: "noAgent" };
  if (state.agent.reasoningEffort === null) return { kind: "noEffort" };
  return null;
};

export const buildLaunchConfig = (
  agent: ProjectReportAgentSelection,
  machineId: string,
): ProjectReportLaunchConfig | null =>
  agent.reasoningEffort === null
    ? null
    : {
        machineId,
        provider: agent.provider,
        model: agent.model,
        effort: agent.reasoningEffort,
        ...(supportsFastMode(agent.provider, agent.model)
          ? { fastMode: agent.fastMode }
          : {}),
      };

export const buildCreateRequest = (
  state: ProjectReportRequestState,
  launch: ProjectReportLaunchConfig,
  idempotencyKey: string,
): CreateProjectReportRequestDto | null => {
  if (!state.scope.ok) return null;
  if (
    state.kind === "RELEASE_NOTES" &&
    selectNextBlocker(state, launch.machineId)
  )
    return null;
  const outline = state.outline.trim();
  // Preset provenance carries the member's edited outline, if any.
  const preset: ProjectReportPreset | null = outline
    ? { ...state.preset, prompt: state.question, outline }
    : null;
  return {
    kind: state.kind,
    ...(state.kind === "RELEASE_NOTES" ? { serviceIds: state.serviceIds } : {}),
    question: state.question,
    ...(preset ? { preset } : {}),
    scope: state.scope.scope,
    exclusions: state.exclusions.map((entry) => entry.subject),
    launch,
    idempotencyKey,
  };
};

// ---------------------------------------------------------------------------
// Persisted request status
// ---------------------------------------------------------------------------

export const isTerminalProjectReportStatus = (
  status: ProjectReportStatus,
): boolean =>
  status === ProjectReportStatus.Completed ||
  status === ProjectReportStatus.Failed;

export const selectLatestAttempt = (
  request: ProjectReportRequestDto,
): ProjectReportAttempt | null =>
  request.attempts.reduce<ProjectReportAttempt | null>(
    (latest, attempt) =>
      latest === null || attempt.attemptNumber > latest.attemptNumber
        ? attempt
        : latest,
    null,
  );

export type ProjectReportLaunchStatusView =
  | { kind: "queued" }
  | { kind: "running" }
  | { kind: "completed"; reportId: string }
  | { kind: "completedWithoutReport" }
  | {
      kind: "failed";
      message: string | null;
      retryable: boolean;
      attemptId: string | null;
    };

export const selectLaunchStatusView = (
  request: ProjectReportRequestDto,
): ProjectReportLaunchStatusView => {
  const attempt = selectLatestAttempt(request);
  switch (request.status) {
    case ProjectReportStatus.Queued:
      return { kind: "queued" };
    case ProjectReportStatus.Running:
      return { kind: "running" };
    case ProjectReportStatus.Completed:
      return attempt?.reportId
        ? { kind: "completed", reportId: attempt.reportId }
        : { kind: "completedWithoutReport" };
    case ProjectReportStatus.Failed:
      // Retry needs the failed attempt identity; without it, retry is unavailable.
      return attempt
        ? {
            kind: "failed",
            message: attempt.failure?.message ?? null,
            retryable: attempt.failure?.retryable ?? false,
            attemptId: attempt.id,
          }
        : { kind: "failed", message: null, retryable: false, attemptId: null };
  }
};
