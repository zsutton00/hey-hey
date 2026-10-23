import type { RunAttachmentReference } from "../../api";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  AgentSessionStatus,
  MessageType,
  type UserMessageAgentInput,
  type AgentSessionConfig,
  type AgentSkillSelection,
  type ConversationStartRunRequestDtoAllOfInitialMessage,
  type RunContextMetadata,
  type WorkflowName,
} from "../../api";
import {
  RunCreatePayloadWorkflowKickoffPromptTypeEnum,
  type LocalPromptType,
  type RunCreatePayload,
  type RunCreatePayloadWorkflowKickoff,
} from "../../api";
import type {
  AgentProvider,
  PendingTaskContext,
  ReasoningEffort,
} from "./runtime/types";
import type {
  StartRunDispatchResult,
  StartRunInput,
  StartRunWorktree,
} from "./useLaunchRunOrchestration";
import { resolveHasSentInitialPrompt } from "./runtime/coding/agent-session-helpers";
import {
  buildFollowupAgentInput,
  buildDirectTriggerInput,
} from "./runtime/hooks/directTriggerInput";
import {
  submitStopRunViaPlatform,
  type PlatformStopRunPoster,
  type SubmitStopRunResult,
} from "./runtime/hooks/submitStopRunViaPlatform";
import { useAgentSessionInteractionAccess } from "./operations/useAgentSessionInteractionAccess";

/**
 * Result of the centralized {@link UseAgentRunLifecycleResult.sendUserMessage}
 * decision — the single home for "no live run → start-run kickoff; live run →
 * follow-up POST". Mirrors the ok/err shape of the start-run dispatch so callers
 * surface either outcome the same way.
 */
export type SendUserMessageResult =
  | {
      ok: true;
      /**
       * The accepted request's message id: the USER row for a follow-up, or the
       * SYSTEM start-run trigger row when the send launched the run. Lets
       * surfaces correlate replies to the request that produced them.
       */
      messageId: string;
    }
  | { ok: false; error: string; code?: string };

const logError = (
  _action: string,
  _error: unknown,
  _data?: Record<string, unknown>,
) => {};

export interface RunLauncher {
  /**
   * Dispatches a platform start-run trigger. Resolves with the API's
   * fire-and-acknowledge envelope. The CLI materializes the Run on its host
   * once it processes the signed envelope; the UI observes platform current-state
   * events keyed by `runId` (=== the agent session id) rather than
   * fetching a `CodingRun` back.
   */
  startRun: (input: StartRunInput) => Promise<StartRunDispatchResult>;
}

export interface UseAgentRunLifecycleInput {
  /**
   * Platform API client that exposes `stopAgentSessionRun` (for `stopRun`) and
   * `postMessage` (for the live-run arm of `sendUserMessage`). The lifecycle
   * hook hands stop requests to the platform — the platform signs a
   * `trigger.control` envelope and routes it to the conversation owner's CLI —
   * and posts follow-up USER messages on the platform messages rail. Required
   * because every lifecycle consumer exposes operations that depend on this
   * platform boundary.
   */
  apiClient: PlatformStopRunPoster;
  enabled: boolean;
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  agentSessionStatus: AgentSessionStatus;
  agentSessionConversationId: string | null;
  context: PendingTaskContext;
  contextMetadata: RunContextMetadata;
  /**
   * Service set the run executes against. Coding launches carry the full
   * multi-service selection; non-coding chat surfaces omit this entirely
   * because they don't operate on a checked-out repo.
   */
  serviceIds?: string[];
  /**
   * Which service the CLI launches the session against — the primary repo
   * the run boots in. Required when `serviceIds.length > 1`. Omitted by
   * non-coding surfaces alongside `serviceIds`.
   */
  launchServiceId?: string;
  provider?: AgentProvider;
  launch: RunLauncher;
  /**
   * The resolved start-run arm — discriminated by `kind`:
   *   - `kind: "handler"` carries `promptType` + `payload` for a turn-firing
   *     launch (the CLI dispatches turn one against `promptType`).
   *   - `kind: "workflow"` carries `workflowName` + a `workflow_kickoff`
   *     `payload` whose `userMessage` is the launch kickoff text the API
   *     authors into the USER opening row.
   * Optional because the launch surface may render the lifecycle before the
   * arm has resolved (e.g. while `startupInput` is still loading); in that
   * window any `dispatchStartRun*` call returns an error rather than firing a
   * malformed envelope. Once present, the discriminated union prevents
   * constructing the wrong shape at compile time.
   */
  arm?: StartRunArm;
  /** Surface-owned complete typed payload for each conversational turn. */
  buildHandlerTurn?: (text: string) => RunCreatePayload & UserMessageAgentInput;
  model?: string;
  config?: AgentSessionConfig | null;
  reasoningEffort?: ReasoningEffort;
  fastMode?: boolean;
  /**
   * When true, the lifecycle does NOT auto-fire the start-run at mount. Instead
   * the launch surface drives the dispatch from the user's prompt submission via
   * {@link UseAgentRunLifecycleResult.dispatchStartRunWithMessage}, so the kickoff text the
   * user typed rides the start-run request as a single write. Used by the coding
   * methods that carry a user-authored kickoff (free-form / set-splitting /
   * startup-session). Flows whose first turn carries no user text (daily session,
   * refiners) leave this unset and keep the mount-time dispatch.
   */
  deferInitialDispatch?: boolean;
  /**
   * Target CLI machine id. When the user has multiple active CLIs, the platform
   * routes the start-run to this specific machine. Omit for single-machine
   * setups — the platform auto-selects the only (or most-recently paired) active
   * machine.
   */
  machineId?: string;
  /**
   * CLI worktree materialization request restored from AgentSession.config at
   * launch time.
   */
  worktree?: StartRunWorktree;
}

/**
 * Discriminated union over the two start-run arms — wire-equivalent to the
 * `StartRunInput` union on {@link useLaunchRunOrchestration}. Lifted into a
 * named type so the resolver, the lifecycle, and the launch orchestration all
 * share one shape rather than each carrying flat optional siblings.
 */
export type StartRunArm =
  | {
      kind: "handler";
      promptType: LocalPromptType;
      payload: RunCreatePayload;
      attachments?: import("../../api").RunAttachmentReference[];
    }
  | {
      kind: "workflow";
      workflowName: WorkflowName;
      payload?: RunCreatePayloadWorkflowKickoff;
    };

export interface UseAgentRunLifecycleResult {
  // Derived run identity. Equal to the agent session id once the conversation
  // is bound, `null` before then. The CLI keys its run on the same id.
  runId: string | null;
  hasSentInitialPrompt: boolean;
  error: string | null;
  // Structured error code from a failed start-run dispatch (e.g.
  // `NO_CLI_CONNECTION`), or null. Lets consumers render actionable states
  // distinctly from generic failures by keying off the code, not the message.
  errorCode: string | null;
  retryInit: () => void;
  // Consumers call this once the initial prompt has been dispatched
  // successfully so the hook surfaces `hasSentInitialPrompt=true` optimistically
  // before the persisted session status round-trips.
  markInitialPromptSent: () => void;
  // Fires the platform start-run for a deferred launch, carrying the optional
  // structured `initialMessage` seed (a USER kickoff for coding launches, a
  // SYSTEM greeting for refiner surfaces) on the request. Used by surfaces that
  // pass `deferInitialDispatch` so the seed rides the start-run as one write
  // instead of a separate follow-up post. Idempotent against the mount-time
  // guard, so it never double-dispatches alongside a stray auto-fire.
  dispatchStartRunWithMessage: (
    initialMessage: ConversationStartRunRequestDtoAllOfInitialMessage,
    userMessage: string,
    skillSelection?: AgentSkillSelection,
    attachments?: RunAttachmentReference[],
  ) => Promise<StartRunDispatchResult>;

  dispatchStartRun: () => Promise<StartRunDispatchResult>;
  /**
   * The single send decision every refiner surface shares. Sends the user's text
   * the honest way for the conversation's current state: when no run has been
   * launched yet (the runless-greeting case), it fires one start-run carrying the
   * text as a USER `initialMessage`, which materializes the run and dispatches the
   * first turn; when a run is already live, it posts the text as an ordinary
   * follow-up on the platform messages rail. Centralizing it here keeps the
   * decision out of each refiner and lets new surfaces adopt it for free.
   */
  sendUserMessage: (
    text: string,
    skillSelection?: AgentSkillSelection,
    attachments?: RunAttachmentReference[],
  ) => Promise<SendUserMessageResult>;
  // Stops the active run through the platform-mediated signed stop and resolves
  // with its admission outcome. No-op (`{ ok: true }`) when there's no run.
  stopRun: () => Promise<SubmitStopRunResult>;
  // True while a stop request is in flight.
  stoppingRun: boolean;
  // True once the mount-time start-run dispatch has settled (resolved or
  // failed). Non-deferred launches that post a follow-up first message (the
  // refiners) gate that POST on this so the user's message never races ahead of
  // the start-run that seeds the run. Stays false for deferred launches — they
  // carry their first write on the start-run itself, so there's no follow-up to
  // gate.
  startRunSettled: boolean;
}

export const useAgentRunLifecycle = ({
  apiClient,
  enabled,
  organizationId,
  projectId,
  agentSessionId,
  agentSessionStatus,
  agentSessionConversationId,
  context,
  contextMetadata,
  serviceIds,
  launchServiceId,
  provider,
  launch,
  arm,
  model,
  config,
  reasoningEffort,
  fastMode,
  deferInitialDispatch,
  buildHandlerTurn,
  machineId,
  worktree,
}: UseAgentRunLifecycleInput): UseAgentRunLifecycleResult => {
  const interactionAccess = useAgentSessionInteractionAccess(machineId);
  const [error, setError] = useState<string | null>(null);
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [initialPromptSent, setInitialPromptSent] = useState(false);
  const [initRetryCount, setInitRetryCount] = useState(0);
  const [stoppingRun, setStoppingRun] = useState(false);
  // True once the mount-time start-run dispatch has settled (resolved or
  // failed). Surfaces that post a follow-up first message gate that POST on this
  // so the user's message never races ahead of the start-run.
  const [startRunSettled, setStartRunSettled] = useState(false);

  // The run lives on the CLI host keyed by the agent session id; once the
  // conversation is bound there is always a run to talk to.
  const runId = agentSessionConversationId ? agentSessionId : null;

  // Records the `${agentSessionId}:${conversationId}` we have already
  // dispatched a start-run for. The init effect's only state guard
  // (`agentSessionStatus`) lags behind the dispatch — it stays `NotStarted`
  // until the server round-trips — so without this ref both StrictMode's
  // double-mount and any dependency-driven re-render (e.g. conversationId
  // resolving while status is still NotStarted) would fire a second,
  // duplicate POST. Set synchronously before the await; reset when the
  // conversation unbinds or an explicit retry is requested.
  const startRunDispatchedRef = useRef<string | null>(null);

  const hasSentInitialPrompt =
    initialPromptSent || resolveHasSentInitialPrompt({ agentSessionStatus });

  // Dispatches the platform start-run for this session, optionally seeding a
  // structured `initialMessage` first row (a USER kickoff so the run begins as a
  // USER turn, or a SYSTEM greeting ahead of the user's first message) so the
  // launch is a single write. Owns the idempotency ref (so a stray auto-fire
  // cannot double-dispatch) and the error/errorCode surfacing. Shared by the
  // mount-time auto-fire and the deferred submit-time path.
  const dispatchStartRun = useCallback(
    async (
      initialMessage?: ConversationStartRunRequestDtoAllOfInitialMessage,
      userMessage?: string,
      skillSelection?: AgentSkillSelection,
      attachments: RunAttachmentReference[] = [],
    ): Promise<StartRunDispatchResult> => {
      if (!agentSessionConversationId) {
        const error =
          "Cannot start coding run before the conversation is bound.";
        logError("dispatchStartRun: missing conversationId", error, {
          agentSessionId,
        });
        return { ok: false, error, code: null };
      }

      if (!arm) {
        const error =
          "Cannot start coding run: launch arm has not resolved yet.";
        logError("dispatchStartRun: missing arm", error, { agentSessionId });
        return { ok: false, error, code: null };
      }

      if (arm.kind === "workflow" && attachments.length)
        return {
          ok: false,
          error: "File attachments are unavailable for workflow methods.",
          code: null,
        };
      startRunDispatchedRef.current = `${agentSessionId}:${agentSessionConversationId}`;
      setError(null);
      setErrorCode(null);

      // Producers own focal identity. This hook only replaces the kickoff text
      // supplied by the launch surface. A workflow arm without an entity stays
      // explicitly unscoped when its materialization payload is created.
      let effectiveArm: StartRunArm = arm;
      if (userMessage !== undefined) {
        if (arm.kind === "workflow") {
          effectiveArm = {
            ...arm,
            payload: {
              ...(arm.payload ?? {
                promptType:
                  RunCreatePayloadWorkflowKickoffPromptTypeEnum.WorkflowKickoff,
              }),
              userMessage,
            },
          };
        } else {
          if (!("userMessage" in arm.payload)) {
            const error = `Cannot attach a user message to ${arm.payload.promptType}.`;
            logError(
              "dispatchStartRun: payload does not accept userMessage",
              error,
              {
                agentSessionId,
                promptType: arm.payload.promptType,
              },
            );
            return { ok: false, error, code: null };
          }
          effectiveArm = {
            ...arm,
            payload: buildHandlerTurn
              ? buildHandlerTurn(userMessage)
              : { ...arm.payload, userMessage },
          };
        }
      }

      const dispatch = await launch.startRun({
        ...effectiveArm,
        ...(effectiveArm.kind === "handler" ? { attachments } : {}),
        ...(serviceIds && serviceIds.length > 0 ? { serviceIds } : {}),
        ...(launchServiceId ? { launchServiceId } : {}),
        provider,
        context,
        contextMetadata,
        conversationId: agentSessionConversationId,
        ...(model ? { model } : {}),
        ...(config !== undefined ? { config } : {}),
        ...(reasoningEffort ? { reasoningEffort } : {}),
        ...(fastMode !== undefined ? { fastMode } : {}),
        ...(initialMessage ? { initialMessage } : {}),
        ...(skillSelection ? { skillSelection } : {}),
        ...(machineId ? { machineId } : {}),
        ...(worktree ? { worktree } : {}),
      });

      if (!dispatch.ok) {
        logError("dispatchStartRun: startRun dispatch FAILED", dispatch.error);
        setError(dispatch.error);
        setErrorCode(dispatch.code ?? null);
        return dispatch;
      }

      if (!dispatch.dispatched) {
        const error =
          "The start-run was accepted but no connected CLI acknowledged it. Make sure a CLI is running and paired, then try again.";
        logError("dispatchStartRun: start-run unacknowledged", error, {
          agentSessionId,
        });
        setError(error);
        return { ok: false, error, code: null };
      }

      return dispatch;
    },
    [
      agentSessionId,
      agentSessionConversationId,
      launch,
      serviceIds,
      launchServiceId,
      provider,
      context,
      contextMetadata,
      arm,
      buildHandlerTurn,
      model,
      config,
      reasoningEffort,
      fastMode,
      machineId,
      worktree,
    ],
  );

  // The centralized run-exists send decision. Branches on whether this session's
  // run has already been launched — `initialPromptSent` (flipped below when this
  // surface fires the kickoff start-run) or a resumed/in-progress session whose
  // status already reflects a sent prompt. `runId` is NOT the signal: it is
  // derived from conversation-binding alone, so a runless conversation (greeting
  // seeded, no run) already has a non-null `runId`. No run yet → start-run with a
  // USER `initialMessage` kickoff; live run → ordinary follow-up POST.
  const sendUserMessage = useCallback(
    async (
      text: string,
      skillSelection?: AgentSkillSelection,
      attachments: RunAttachmentReference[] = [],
    ): Promise<SendUserMessageResult> => {
      if (!agentSessionConversationId) {
        const error = "Cannot send a message before the conversation is bound.";
        logError("sendUserMessage: missing conversationId", error, {
          agentSessionId,
        });
        return { ok: false, error };
      }

      const runAlreadyLaunched =
        initialPromptSent ||
        resolveHasSentInitialPrompt({ agentSessionStatus });

      if (runAlreadyLaunched) {
        // Follow-up posts ride on a handler-arm `promptType` — the workflow
        // arm has no per-turn promptType (the workflow node selects the
        // handler on the API side). The discriminator narrows `arm.promptType`
        // for us without optional-prop gymnastics.
        if (!arm || arm.kind !== "handler") {
          const error =
            "Cannot post a follow-up without a handler-arm promptType.";
          logError("sendUserMessage: missing handler arm", error, {
            agentSessionId,
          });
          return { ok: false, error };
        }
        if (!interactionAccess.isDeviceEnabled) {
          const error = interactionAccess.unavailable.message;
          logError("sendUserMessage: missing machineId", error, {
            agentSessionId,
          });
          return { ok: false, error };
        }
        try {
          const result = await interactionAccess.interactions.submitMessage(
            buildDirectTriggerInput({
              organizationId,
              projectId,
              agentSessionId,
              conversationId: agentSessionConversationId,
              data: {
                attachments,
                agentInput: buildHandlerTurn
                  ? buildHandlerTurn(text)
                  : buildFollowupAgentInput(
                      arm.promptType,
                      text,
                      undefined,
                      skillSelection,
                    ),
                references: { resolved: [], unresolved: [] },
              },
            }),
          );
          if (result.state !== "succeeded" && result.state !== "accepted") {
            throw new Error(
              result.state === "cancelled"
                ? "The operation was cancelled."
                : result.message,
            );
          }
          return { ok: true, messageId: result.messageId };
        } catch (error) {
          const message =
            error instanceof Error ? error.message : "Failed to send message.";
          logError("sendUserMessage: follow-up POST threw", error, {
            agentSessionId,
          });
          return { ok: false, error: message };
        }
      }

      if (attachments.length > 0)
        return { ok: false, error: "Start this Run before attaching files." };

      // No run yet → the user's first reply materializes the run: one start-run
      // that carries a USER `initialMessage` (so the API authors a real USER row)
      // and the text in `payload.userMessage` (so the handler receives it).
      const dispatch = await dispatchStartRun(
        { role: MessageType.User },
        text,
        skillSelection,
      );
      if (dispatch.ok) {
        setInitialPromptSent(true);
        return { ok: true, messageId: dispatch.triggerMessageId };
      }
      return {
        ok: false,
        error: dispatch.error,
        ...(dispatch.code ? { code: dispatch.code } : {}),
      };
    },
    [
      agentSessionId,
      agentSessionConversationId,
      initialPromptSent,
      agentSessionStatus,
      arm,
      buildHandlerTurn,
      organizationId,
      projectId,
      dispatchStartRun,
      machineId,
      interactionAccess,
    ],
  );

  // --- Run initialization ---
  // Fresh sessions dispatch a start-run trigger so the CLI materializes the
  // run on its host. Resumed / in-progress sessions already have one, so they
  // skip the dispatch and simply observe the run through platform current-state
  // events. Surfaces
  // that carry a user-authored kickoff set `deferInitialDispatch` and drive the
  // dispatch from their submit handler instead, so the kickoff rides start-run.
  useEffect(() => {
    if (!enabled) {
      return;
    }

    if (agentSessionConversationId === null) {
      setInitialPromptSent(false);
      setError(null);
      setErrorCode(null);
      setStartRunSettled(false);
      startRunDispatchedRef.current = null;
      return;
    }

    if (resolveHasSentInitialPrompt({ agentSessionStatus })) {
      // Resumed / in-progress session: the start-run already happened, so
      // there's nothing to wait for — unblock follow-up message posts.
      setStartRunSettled(true);
      return;
    }

    // A deferred launch start-runs later, from the submit handler, so it carries
    // the user's kickoff text. Workflow launches are NOT deferred — they
    // mount-fire the materialize-only start-run so the Run binds before the
    // workflow's SYSTEM triggers arrive.
    if (deferInitialDispatch) {
      return;
    }

    // Idempotency guard: collapse StrictMode double-mounts and dep-driven
    // re-runs during the NotStarted window into a single dispatch.
    const dispatchKey = `${agentSessionId}:${agentSessionConversationId}`;
    if (startRunDispatchedRef.current === dispatchKey) {
      return;
    }

    // Non-deferred launches fire the mount-time start-run with no seeded first
    // row; coding launches drive their USER kickoff from the deferred submit
    // path instead. Flip startRunSettled once the dispatch resolves so any
    // follow-up post can't race ahead of the start-run.
    setStartRunSettled(false);
    void dispatchStartRun().finally(() => {
      setStartRunSettled(true);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    enabled,
    agentSessionId,
    agentSessionStatus,
    agentSessionConversationId,
    initRetryCount,
    deferInitialDispatch,
    buildHandlerTurn,
  ]);

  const retryInit = useCallback(() => {
    startRunDispatchedRef.current = null;
    setInitRetryCount((c) => c + 1);
  }, []);

  const markInitialPromptSent = useCallback(() => {
    setInitialPromptSent(true);
  }, []);

  const stopRun = useCallback(async (): Promise<SubmitStopRunResult> => {
    if (!runId) return { ok: true };
    setStoppingRun(true);
    try {
      const result = await submitStopRunViaPlatform({
        apiClient,
        runId,
        organizationId,
        agentSessionId,
        conversationId: agentSessionConversationId,
        projectId,
      });
      if (!result.ok) {
        logError("stopRun failed", new Error(result.error), { runId });
      }
      return result;
    } finally {
      setStoppingRun(false);
    }
  }, [
    apiClient,
    runId,
    organizationId,
    projectId,
    agentSessionId,
    agentSessionConversationId,
  ]);

  return {
    runId,
    hasSentInitialPrompt,
    error,
    errorCode,
    retryInit,
    markInitialPromptSent,
    // Same impl behind two narrower public signatures: the no-arg variant for
    // bootstrap dispatches that carry no kickoff (refiner mount-fire, runless
    // greeting), and the with-message variant whose required `userMessage`
    // forces a launch caller to thread the kickoff text from its source
    // rather than relying on stale closed-over state.
    dispatchStartRun,
    dispatchStartRunWithMessage: dispatchStartRun,
    sendUserMessage,
    stopRun,
    stoppingRun,
    startRunSettled,
  };
};
