import { WorkflowName } from "../../api";
import {
  LocalPromptType,
  RunEntityReferenceEntityTypeEnum,
  type LocalSetSplittingService,
  type LocalSetSplittingSplitMode,
  type RunCreatePayload,
  type RunEntityReference,
  type RunCreatePayloadDebug,
  type RunCreatePayloadFreeForm,
  type RunCreatePayloadQuick,
  type RunCreatePayloadResearch,
  type RunCreatePayloadSetSplitting,
  type RunCreatePayloadStartupSession,
} from "../../api";
import type { SessionMethod, SessionMethodSelection } from "./types";

/**
 * The single source of truth for every per-SessionMethod fact: UI metadata
 * (label / description / grouping / icon), wizard step labels, AND the wire
 * dispatch arm. Consumers (resolveStartRunPrompt, the workflow-name resolver,
 * the node-prompt fallback, the picker UI, the follow-up router) read this
 * one table — adding or renaming a SessionMethod is a TS error in one place,
 * not five.
 */

export type SessionMethodGroup = "work" | "debug" | "split";
export type SessionMethodTone = "primary" | "secondary" | "info";

/**
 * Symbolic icon identifier the registry stores instead of the MUI component
 * itself. Resolved to a React node by the picker UI so the coordination layer
 * stays DOM-free.
 */
export type SessionMethodIconKey =
  | "ListAlt"
  | "Chat"
  | "Bolt"
  | "BugReport"
  | "Science"
  | "AccountTree"
  | "CallSplit";

export interface SessionMethodStep {
  name: string;
  gloss?: string;
}

/**
 * What a start-run needs to know about the launch: the focal work item's id
 * and the UI-only session method selection. The work item's type is
 * deliberately absent — the Run carries it as the TASK entity reference and
 * the registry-authoritative type is read downstream, so a project-defined
 * type never has to be mapped onto a closed enum here.
 */
export interface StartRunLaunchContext {
  taskId: string;
  sessionMethod?: SessionMethodSelection;
}

/**
 * The context a handler-arm `buildPayload` closure consumes to author its
 * RunCreatePayload variant. Mirrors the args resolveStartRunPrompt already
 * takes today; lives on the registry row so per-method payload shape is one
 * place, not a switch.
 */
export interface BuildPayloadCtx {
  launch: StartRunLaunchContext;
  userMessage: string;
  launchPlanId?: string | null;
  launchStepId?: string | null;
  launchStageId?: string | null;
}

export const buildTaskEntity = ({
  taskId,
}: StartRunLaunchContext): RunEntityReference => {
  const entityId = taskId.trim();
  if (!entityId) {
    throw new Error("A task-scoped Run requires a task id.");
  }
  return {
    entityType: RunEntityReferenceEntityTypeEnum.Task,
    entityId,
  };
};

/**
 * The dispatch arm a SessionMethod's start-run takes. The two arms map 1:1
 * onto the platform DTO's mutually-exclusive `workflowName` vs
 * `handlerPromptType`+`payload` fields.
 *
 *  - `workflow`: materialize-only. The CLI binds the Run; a Temporal workflow
 *    (e.g. FeatureSync for Plan) drives every turn from SYSTEM triggers.
 *  - `handler`: turn-firing. The envelope's handlerPromptType plus the
 *    in-payload promptType+body are emitted from the same closure here, so
 *    they cannot drift.
 */
type MethodDispatch =
  | { kind: "workflow"; workflowName: WorkflowName }
  | {
      kind: "handler";
      handlerPromptType: LocalPromptType;
      buildPayload: (ctx: BuildPayloadCtx) => RunCreatePayload;
    };

export interface MethodConfig {
  group: SessionMethodGroup;
  tone: SessionMethodTone;
  iconKey: SessionMethodIconKey;
  label: string;
  description: string;
  steps?: readonly SessionMethodStep[];
  compatibleWorkItemTypeKeys: readonly string[];
  dispatch: MethodDispatch;
}

const STANDARD_AND_BUG_WORK_ITEM_TYPES = ["STANDARD", "BUG"] as const;

// The split arms share a single payload shape and only differ on `splitMode`,
// so both rows below funnel through this builder.
const buildSetSplittingPayload = (
  ctx: BuildPayloadCtx,
  splitMode: LocalSetSplittingSplitMode,
): RunCreatePayloadSetSplitting => {
  // sessionMethod is optional on the launch context; fall back to an empty
  // array so the build stays total instead of throwing when an upstream
  // forgets to thread it.
  const services: LocalSetSplittingService[] =
    ctx.launch.sessionMethod?.services.map(
      ({ id, name }): LocalSetSplittingService => ({ id, name }),
    ) ?? [];
  return {
    entity: buildTaskEntity(ctx.launch),
    promptType: "set_splitting",
    splitMode,
    services,
    userMessage: ctx.userMessage,
  };
};

export const SESSION_METHOD_REGISTRY: Readonly<
  Record<SessionMethod, MethodConfig>
> = {
  plan: {
    group: "work",
    tone: "primary",
    iconKey: "ListAlt",
    label: "With Plan + Project Assistant",
    description:
      "Intensive process to sync and plan tasks that are new to the project.",
    steps: [
      { name: "Project Assistant" },
      { name: "Feature Sync" },
      { name: "Plan", gloss: "Creates a detailed step-by-step plan" },
      { name: "Implement", gloss: "Executes the plan" },
    ],
    compatibleWorkItemTypeKeys: STANDARD_AND_BUG_WORK_ITEM_TYPES,
    // Plan binds to FeatureSync; the workflow drives every turn after the
    // start-run materializes the task-scoped Run.
    dispatch: { kind: "workflow", workflowName: WorkflowName.FeatureSync },
  },
  open: {
    group: "work",
    tone: "primary",
    iconKey: "Chat",
    label: "With Project Assistant",
    description: "Runs your prompts with project context.",
    steps: [
      { name: "Project Assistant" },
      { name: "Freeform", gloss: "Responds to your prompt" },
    ],
    compatibleWorkItemTypeKeys: STANDARD_AND_BUG_WORK_ITEM_TYPES,
    dispatch: {
      kind: "handler",
      handlerPromptType: LocalPromptType.FreeForm,
      buildPayload: (ctx): RunCreatePayloadFreeForm => ({
        entity: buildTaskEntity(ctx.launch),
        promptType: "free_form",
        userMessage: ctx.userMessage,
      }),
    },
  },
  quick: {
    group: "work",
    tone: "primary",
    iconKey: "Bolt",
    label: "Task Only",
    description:
      "Best for quick questions or requests, or when you are certain the task and project are in sync.",
    steps: [{ name: "Freeform", gloss: "Responds to your prompt" }],
    compatibleWorkItemTypeKeys: STANDARD_AND_BUG_WORK_ITEM_TYPES,
    dispatch: {
      kind: "handler",
      handlerPromptType: LocalPromptType.Quick,
      buildPayload: (ctx): RunCreatePayloadQuick => ({
        entity: buildTaskEntity(ctx.launch),
        promptType: "quick",
        userMessage: ctx.userMessage,
      }),
    },
  },
  debug: {
    group: "debug",
    tone: "secondary",
    iconKey: "BugReport",
    label: "Debug",
    description:
      "Investigate a specific bug or runtime failure. The agent focuses on reproducing and diagnosing the issue.",
    compatibleWorkItemTypeKeys: STANDARD_AND_BUG_WORK_ITEM_TYPES,
    dispatch: {
      kind: "handler",
      handlerPromptType: LocalPromptType.Debug,
      buildPayload: (ctx): RunCreatePayloadDebug => ({
        entity: buildTaskEntity(ctx.launch),
        promptType: "debug",
        userMessage: ctx.userMessage,
      }),
    },
  },
  research: {
    group: "debug",
    tone: "secondary",
    iconKey: "Science",
    label: "Research",
    description:
      "Read-only investigation of the task and its surrounding graph. The agent produces a structured frame and analysis without making changes.",
    compatibleWorkItemTypeKeys: STANDARD_AND_BUG_WORK_ITEM_TYPES,
    dispatch: {
      kind: "handler",
      handlerPromptType: LocalPromptType.Research,
      buildPayload: (ctx): RunCreatePayloadResearch => ({
        entity: buildTaskEntity(ctx.launch),
        promptType: "research",
        userMessage: ctx.userMessage,
      }),
    },
  },
  split_by_service: {
    group: "split",
    tone: "info",
    iconKey: "AccountTree",
    label: "Split by Service",
    description:
      "Decompose work across services. The agent generates a focused task proposal for each selected service.",
    compatibleWorkItemTypeKeys: STANDARD_AND_BUG_WORK_ITEM_TYPES,
    dispatch: {
      kind: "handler",
      handlerPromptType: LocalPromptType.SetSplitting,
      buildPayload: (ctx) => buildSetSplittingPayload(ctx, "service"),
    },
  },
  split_by_function: {
    group: "split",
    tone: "info",
    iconKey: "CallSplit",
    label: "Split by Function",
    description:
      "Decompose by functional area. The agent generates focused task proposals grouped by feature or capability.",
    compatibleWorkItemTypeKeys: STANDARD_AND_BUG_WORK_ITEM_TYPES,
    dispatch: {
      kind: "handler",
      handlerPromptType: LocalPromptType.SetSplitting,
      buildPayload: (ctx) => buildSetSplittingPayload(ctx, "feature"),
    },
  },
};

export const getMethodConfig = (method: SessionMethod): MethodConfig =>
  SESSION_METHOD_REGISTRY[method];

export const listSessionMethods = (): readonly SessionMethod[] =>
  Object.keys(SESSION_METHOD_REGISTRY) as SessionMethod[];

export const listCompatibleSessionMethods = (
  workItemTypeKey: string,
): readonly SessionMethod[] =>
  listSessionMethods().filter((method) =>
    SESSION_METHOD_REGISTRY[method].compatibleWorkItemTypeKeys.includes(
      workItemTypeKey,
    ),
  );

/**
 * Payload for the legacy no-`sessionMethod` case — predates the per-method
 * registry and is still hit by callers that launch a session without picking a
 * method explicitly. Emits the historical startup_session shape with optional
 * launch ids.
 */
export const buildDefaultStartupSessionPayload = (
  ctx: BuildPayloadCtx,
): RunCreatePayloadStartupSession & {
  promptType: "startup_session";
} => ({
  entity: buildTaskEntity(ctx.launch),
  promptType: "startup_session",
  ...(ctx.userMessage ? { userMessage: ctx.userMessage } : {}),
  ...(ctx.launchPlanId ? { launchPlanId: ctx.launchPlanId } : {}),
  ...(ctx.launchStepId ? { launchStepId: ctx.launchStepId } : {}),
  ...(ctx.launchStageId ? { launchStageId: ctx.launchStageId } : {}),
});

export const DEFAULT_HANDLER_PROMPT_TYPE: LocalPromptType =
  LocalPromptType.StartupSession;

/**
 * Per-group ordered listing for the wizard's picker, derived from the
 * registry. UI-only session methods such as `validation` are intentionally
 * excluded from this catalog because they do not have a SessionMethod
 * dispatch arm.
 */
export interface SessionMethodGroupListing {
  group: SessionMethodGroup;
  tone: SessionMethodTone;
  methods: readonly SessionMethod[];
}

const groupOrder: readonly SessionMethodGroup[] = ["work", "debug", "split"];
const toneByGroup: Record<SessionMethodGroup, SessionMethodTone> = {
  work: "primary",
  debug: "secondary",
  split: "info",
};

// Preserve the insertion order of the registry table so each group lists its
// methods in the same order they're declared above.
const methodOrder = Object.keys(SESSION_METHOD_REGISTRY) as SessionMethod[];

export const SESSION_METHOD_GROUP_LISTINGS: readonly SessionMethodGroupListing[] =
  groupOrder.map((group) => ({
    group,
    tone: toneByGroup[group],
    methods: methodOrder.filter(
      (method) => SESSION_METHOD_REGISTRY[method].group === group,
    ),
  }));
