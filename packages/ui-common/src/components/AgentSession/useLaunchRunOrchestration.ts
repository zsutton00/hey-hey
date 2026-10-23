import { useQueryClient } from "@tanstack/react-query";
import { reconcileAcceptedAgentLaunch } from "../../data/agentLaunchReconciliation";
import { useCallback } from "react";
import {
  LocalPromptType,
  type RunCreatePayloadWorkflowKickoff,
} from "../../api";
import {
  ConversationStartRunRequestDtoProviderEnum,
  ConversationStartRunRequestDtoReasoningEffortEnum,
  type ConversationStartRunRequestDtoAllOfInitialMessage,
  type AgentSkillSelection,
  type AgentSessionConfig,
  type RunContextMetadata,
  type RunCreatePayload,
  type RunAttachmentReference,
  type WorkflowName,
} from "../../api/index";
import type { BoundStartSessionInput } from "./operations/AgentOperationCoordinator";
import { log, logError } from "./runtime/coding/agent-session-helpers";
import {
  type AgentProvider,
  type PendingTaskContext,
  type ReasoningEffort,
  type StartupPlanSubmission,
} from "./runtime";
import {
  buildDirectTriggerInput,
  buildFollowupAgentInput,
  type BuildUserMessageDataInput,
} from "./runtime/hooks/directTriggerInput";
import {
  submitNodeDecisionViaPlatform,
  type SubmitNodeDecisionResult,
} from "./runtime/hooks/submitNodeDecisionViaPlatform";
import type { WorkflowAnswerPoster } from "../../data/hooks/submitControllerAuthorizedWorkflowAnswer";
import { useAgentSessionInteractionAccessResolver } from "./operations/useAgentSessionInteractionAccess";

type LaunchPlatformClient = WorkflowAnswerPoster;

export interface StartRunWorktree {
  enabled: true;
  branch: string;
}

/**
 * Resolves the platform conversationId associated with a runId. CodingSession
 * already has the agentSession.conversationId statically in scope, so it
 * passes a string. Callers that only know the run can pass a function that
 * looks the conversationId up from the active run state.
 */
type ConversationIdSource =
  string | ((runId: string) => string | null | undefined);

interface UseLaunchRunOrchestrationInput {
  organizationId: string | null;
  /**
   * Platform plumbing required for `submitNodeDecision` to author a
   * real USER message instead of pushing the decision through the local-agent
   * rail. Optional at the type level so chat surfaces can keep their current
   * invocation, but platform message submission will return
   * `{ ok: false, error }` at runtime when missing.
   */
  apiClient?: LaunchPlatformClient;
  projectId?: string;
  agentSessionId?: string;
  conversationId?: ConversationIdSource;
  /**
   * The active conversation's workflow, threaded onto the `workflowName` arm of
   * `data.agentInput` for `submitNodeDecision`. Required for node decisions
   * (QUESTIONS-gate field actions); surfaces that never submit a node decision
   * may omit it.
   */
  workflowName?: WorkflowName;
  machineId?: string;
}

/**
 * Fields shared by both start-run arms. Per-arm shape lives on the
 * {@link StartRunInput} union below — the discriminator splits the arms so
 * the type carries the contract: workflow arm has `workflowName`, handler arm
 * has `promptType`, and neither can be constructed without its payload.
 */
interface StartRunInputCommon {
  /**
   * Full set of platform service ids this run executes against. Threaded
   * through so the CLI can resolve every repository the agent needs without an
   * extra lookup. Coding runs always carry it (single- or multi-service); the
   * non-coding chat surfaces (task / feature refiners, entity conversations)
   * leave it out entirely because they operate on entity text, not a repo.
   */
  serviceIds?: string[];
  /**
   * The service the CLI launches the session against. Must be a member of
   * `serviceIds` when both are set. Required when `serviceIds.length > 1`;
   * implicit for the single-service case (the API can default to the only
   * member). Surfaces that omit `serviceIds` omit this too.
   */
  launchServiceId?: string;
  context: PendingTaskContext;
  contextMetadata: RunContextMetadata;
  provider?: AgentProvider;
  conversationId: string;
  model?: string;
  config?: AgentSessionConfig | null;
  reasoningEffort?: ReasoningEffort;
  fastMode?: boolean;
  /**
   * Structured first row the API seeds ahead of the run's opening turn. A USER
   * `initialMessage` carries the launch text the user typed when kicking off the
   * run: the API authors a visible USER bubble with this text (so the kickoff
   * renders ahead of the agent's reply), then merges the same text into the
   * SYSTEM start-run payload's `userMessage`, which the CLI's resolve-prompt
   * auto-prepends above the system prompt on the run's first turn so the agent
   * responds to it directly. A SYSTEM `initialMessage` seeds an opening greeting
   * ahead of the user's first message (the refiner surfaces). Either way the run
   * is still booted exclusively by the SYSTEM `start_run` trigger. Only the seeded
   * row rides here; the dispatch arm (`startupInput`, `splitMode`, …) already
   * travels on `payload`.
   */
  initialMessage?: ConversationStartRunRequestDtoAllOfInitialMessage;
  /**
   * Target CLI machine id. When the user has multiple connected CLIs, the
   * platform routes the start-run to the CLI identified by this id. Omit for
   * single-machine setups — the platform selects the only (or most-recently
   * paired) active machine automatically.
   */
  machineId?: string;
  /**
   * CLI worktree materialization request. Present only when the launch wizard
   * persisted a selected branch in AgentSession.config.
   */
  worktree?: StartRunWorktree;
  /** Pathless provider-owned Skill identity for the opening user message. */
  skillSelection?: AgentSkillSelection;
}

/**
 * Discriminated union over the two start-run arms. Constructing the wrong
 * combination — workflow arm with a `promptType`, handler arm without its
 * `payload`, either arm with both `workflowName` and `promptType` — is a
 * compile-time error. Both arms require `payload`: the turn-firing arm's
 * payload drives the CLI's first turn; the workflow arm's
 * `workflow_kickoff` payload carries the kickoff text the API authors into
 * the USER opening row.
 */
export type StartRunInput =
  | (StartRunInputCommon & {
      kind: "workflow";
      workflowName: WorkflowName;
      /**
       * Optional `workflow_kickoff` payload carrying launch text and, for a
       * scoped launch, the canonical entity. Omitted for bind-only workflow
       * launches whose first turn is driven by a SYSTEM greeting or workflow
       * trigger.
       */
      payload?: RunCreatePayloadWorkflowKickoff;
      promptType?: never;
    })
  | (StartRunInputCommon & {
      kind: "handler";
      promptType: string;
      payload: RunCreatePayload;
      attachments?: RunAttachmentReference[];
      workflowName?: never;
    });

export type StartRunDispatchResult =
  | { ok: true; dispatched: boolean; triggerMessageId: string }
  | { ok: false; error: string; code: string | null };

export interface UseLaunchRunOrchestrationResult {
  /**
   * Fires the platform start-run trigger. The HTTP response is fire-and-ack
   * (`{ dispatched, triggerMessageId }`) — the actual Run is materialized
   * asynchronously on the CLI host once it processes the signed envelope. The
   * UI observes platform current-state events keyed by the agent session id rather
   * than expecting a `CodingRun` back from this call.
   */
  startRun: (input: StartRunInput) => Promise<StartRunDispatchResult>;
  submitStartupPlanReview: (
    runId: string,
    submission: StartupPlanSubmission,
    promptText: string,
    userMessageData: Record<string, unknown>,
    localPromptType: LocalPromptType,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
  submitNodeDecision: (
    runId: string,
    action: string,
    userMessageData: Record<string, unknown>,
    comment?: string,
  ) => Promise<{ ok: true } | { ok: false; error: string }>;
}

const resolveConversationId = (
  source: ConversationIdSource | undefined,
  runId: string,
): string | null => {
  if (typeof source === "string") return source.length > 0 ? source : null;
  if (typeof source === "function") {
    const resolved = source(runId);
    return resolved && resolved.length > 0 ? resolved : null;
  }
  return null;
};

export const useLaunchRunOrchestration = ({
  organizationId,
  apiClient,
  projectId,
  agentSessionId,
  conversationId,
  workflowName,
  machineId,
}: UseLaunchRunOrchestrationInput): UseLaunchRunOrchestrationResult => {
  const queryClient = useQueryClient();
  const interactionAccessResolver = useAgentSessionInteractionAccessResolver();

  const startRun = useCallback(
    async (input: StartRunInput): Promise<StartRunDispatchResult> => {
      if (!projectId) {
        const error = "Missing project context required to start coding run.";
        logError("startRun: missing projectId", error, {
          conversationId: input.conversationId,
        });
        return { ok: false, error, code: null };
      }
      if (!input.conversationId) {
        const error =
          "Missing conversation context required to start coding run.";
        logError("startRun: missing conversationId", error, {});
        return { ok: false, error, code: null };
      }
      if (!organizationId) {
        const error =
          "Missing organization context required to start coding run.";
        logError("startRun: missing organizationId", error, {});
        return { ok: false, error, code: null };
      }
      if (!agentSessionId) {
        const error = "Missing agentSessionId required to start coding run.";
        logError("startRun: missing agentSessionId", error, {});
        return { ok: false, error, code: null };
      }
      const interactionAccess = interactionAccessResolver.getAccess(
        input.machineId,
      );
      if (!interactionAccess.isDeviceEnabled)
        return {
          ok: false,
          error: interactionAccess.unavailable.message,
          code: "MACHINE_NOT_READY",
        };

      // model and provider remain optional on the input today because
      // non-coding chat surfaces have historically omitted them; they're still
      // required on the wire, so we runtime-check them here. The arm-specific
      // fields (workflowName / promptType / payload) used to live next to
      // these as flat optional siblings; they now ride on the discriminated
      // union so a malformed input cannot be constructed in the first place.
      const missing: string[] = [];
      if (!input.model) missing.push("model");
      if (!input.provider) missing.push("provider");
      if (missing.length > 0) {
        const error = `Cannot start coding run: required fields missing: ${missing.join(
          ", ",
        )}.`;
        logError("startRun: required fields missing", error, { missing });
        return { ok: false, error, code: null };
      }

      // Narrow the arm by `kind`. The wire envelope folds `workflowName` and
      // `handlerPromptType`/`payload` into the same DTO; the discriminator on
      // the input lets the compiler verify each branch carries the right
      // fields without conditional spreads or non-null assertions.
      const armFields =
        input.kind === "workflow"
          ? {
              workflowName: input.workflowName,
              ...(input.payload ? { payload: input.payload } : {}),
            }
          : {
              handlerPromptType: input.promptType,
              attachments: input.attachments ?? [],
              payload: input.payload,
            };

      const intent: BoundStartSessionInput["intent"] = {
        ...armFields,
        model: input.model as string,
        ...(input.config !== undefined ? { config: input.config } : {}),
        reasoningEffort:
          (input.reasoningEffort as ConversationStartRunRequestDtoReasoningEffortEnum) ??
          ConversationStartRunRequestDtoReasoningEffortEnum.Medium,
        provider: input.provider as ConversationStartRunRequestDtoProviderEnum,
        ...(input.fastMode !== undefined ? { fastMode: input.fastMode } : {}),
        ...(input.skillSelection
          ? { skillSelection: input.skillSelection }
          : {}),
        contextMetadata: {
          ...input.contextMetadata,
          agentSessionId,
        },
        ...(input.serviceIds && input.serviceIds.length > 0
          ? { serviceIds: input.serviceIds }
          : {}),
        ...(input.launchServiceId
          ? { launchServiceId: input.launchServiceId }
          : {}),
        ...(input.initialMessage
          ? { initialMessage: input.initialMessage }
          : {}),
        ...(input.worktree ? { worktree: input.worktree } : {}),
      };

      const result = await interactionAccess.interactions.startSession({
        organizationId,
        projectId,
        agentSessionId,
        conversationId: input.conversationId,
        intent,
      });
      if (result.state === "succeeded" || result.state === "accepted") {
        reconcileAcceptedAgentLaunch(queryClient, {
          organizationId,
          projectId,
          agentSessionId,
          conversationId: input.conversationId,
        });
      }
      return result.state === "succeeded" || result.state === "accepted"
        ? {
            ok: true,
            dispatched: true,
            triggerMessageId: result.triggerMessageId,
          }
        : {
            ok: false,
            error:
              result.state === "cancelled"
                ? "The operation was cancelled."
                : result.message,
            code: result.state === "cancelled" ? "CANCELLED" : result.code,
          };
    },
    [
      projectId,
      organizationId,
      agentSessionId,
      interactionAccessResolver,
      queryClient,
    ],
  );

  const submitStartupPlanReview = useCallback(
    async (
      runId: string,
      _submission: StartupPlanSubmission,
      promptText: string,
      userMessageData: Record<string, unknown>,
      localPromptType: LocalPromptType,
    ) => {
      if (!projectId) {
        const error =
          "Platform messaging context is not wired into useLaunchRunOrchestration; cannot submit startup plan review.";
        logError("submitStartupPlanReview: missing platform context", error, {
          runId,
        });
        return { ok: false as const, error };
      }
      if (!agentSessionId) {
        const error =
          "Missing agent session required to submit startup plan review.";
        logError("submitStartupPlanReview: missing agentSessionId", error, {
          runId,
        });
        return { ok: false as const, error };
      }
      const resolvedConversationId = resolveConversationId(
        conversationId,
        runId,
      );
      if (!resolvedConversationId) {
        const error =
          "No conversation is available for this run; cannot submit startup plan review.";
        logError("submitStartupPlanReview: missing conversationId", error, {
          runId,
        });
        return { ok: false as const, error };
      }
      if (!organizationId) {
        const error =
          "Missing organization context required to submit startup plan review.";
        logError("submitStartupPlanReview: missing organizationId", error, {
          runId,
        });
        return { ok: false as const, error };
      }
      const interactionAccess = interactionAccessResolver.getAccess(machineId);
      if (!interactionAccess.isDeviceEnabled)
        return {
          ok: false as const,
          error: interactionAccess.unavailable.message,
        };

      try {
        const data: BuildUserMessageDataInput = {
          agentInput: buildFollowupAgentInput(localPromptType, promptText),
          references: { resolved: [], unresolved: [] },
          attachUserMessageData: true,
          userMessageData,
        };
        const result = await interactionAccess.interactions.submitMessage(
          buildDirectTriggerInput({
            organizationId,
            projectId,
            agentSessionId,
            conversationId: resolvedConversationId,
            data,
          }),
        );
        if (result.state !== "succeeded" && result.state !== "accepted") {
          throw new Error(
            result.state === "cancelled"
              ? "The operation was cancelled."
              : result.message,
          );
        }

        return { ok: true as const };
      } catch (error) {
        return {
          ok: false as const,
          error:
            error instanceof Error
              ? error.message
              : "Failed to submit startup plan review prompt.",
        };
      }
    },
    [
      organizationId,
      projectId,
      conversationId,
      agentSessionId,
      machineId,
      interactionAccessResolver,
    ],
  );

  const submitNodeDecision = useCallback(
    async (
      runId: string,
      action: string,
      userMessageData: Record<string, unknown>,
      comment?: string,
    ): Promise<SubmitNodeDecisionResult> => {
      log("submitNodeDecision: enter", {
        runId,
        action,
        hasComment: comment != null && comment.length > 0,
      });

      if (!apiClient || !projectId) {
        const error =
          "Platform messaging context is not wired into useLaunchRunOrchestration; cannot submit node decision.";
        logError("submitNodeDecision: missing platform context", error, {
          runId,
          action,
        });
        return { ok: false, error };
      }

      const resolvedConversationId = resolveConversationId(
        conversationId,
        runId,
      );
      if (!resolvedConversationId) {
        const error =
          "No conversation is available for this run; cannot submit node decision.";
        logError("submitNodeDecision: missing conversationId", error, {
          runId,
          action,
        });
        return { ok: false, error };
      }

      if (!workflowName) {
        const error =
          "No workflow is available for this run; cannot submit node decision.";
        logError("submitNodeDecision: missing workflowName", error, {
          runId,
          action,
        });
        return { ok: false, error };
      }

      const nodeId =
        typeof userMessageData.workflowAnswerNodeId === "string"
          ? userMessageData.workflowAnswerNodeId
          : null;
      if (!nodeId) {
        const error =
          "The workflow answer cannot be submitted until its source step is available.";
        logError("submitNodeDecision: missing nodeId", error, {
          runId,
          action,
        });
        return { ok: false, error };
      }

      const parentMessageId =
        typeof userMessageData.workflowAnswerParentMessageId === "string"
          ? userMessageData.workflowAnswerParentMessageId
          : null;
      if (!parentMessageId) {
        const error =
          "The workflow answer cannot be submitted until its source message is available.";
        logError("submitNodeDecision: missing parentMessageId", error, {
          runId,
          action,
        });
        return { ok: false, error };
      }

      const result = await submitNodeDecisionViaPlatform({
        apiClient,
        runId,
        organizationId,
        agentSessionId: agentSessionId ?? null,
        conversationId: resolvedConversationId,
        projectId,
        workflowName,
        nodeId,
        parentMessageId,
        action,
        userMessageData,
        ...(comment !== undefined ? { comment } : {}),
      });

      if (result.ok) {
        log("submitNodeDecision: success", { runId, action });
      } else {
        logError("submitNodeDecision: failed", result.error, { runId, action });
      }
      return result;
    },
    [
      apiClient,
      projectId,
      agentSessionId,
      conversationId,
      organizationId,
      workflowName,
    ],
  );

  return {
    startRun,
    submitStartupPlanReview,
    submitNodeDecision,
  };
};
