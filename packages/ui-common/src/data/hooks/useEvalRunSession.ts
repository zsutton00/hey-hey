import { useCallback, useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  ConversationStartRunRequestDtoProviderEnum,
  ConversationStartRunRequestDtoReasoningEffortEnum,
  EvalRunStatus,
  type EvalModelSetting,
} from "../../api";
import { agentSessionsClient } from "../../clients/serviceClients";
import { useAgentSessionInteractionAccessResolver } from "../../components/AgentSession/operations/useAgentSessionInteractionAccess";
import { submitStopRunViaPlatform } from "../../components/AgentSession/runtime/hooks/submitStopRunViaPlatform";
import { bindGraphConversationAgentSessionMachine } from "../../components/InteractionComponent/bindGraphConversationAgentSessionMachine";
import { getErrorMessage } from "../../utils/errorUtils";
import { reconcileAcceptedAgentLaunch } from "../agentLaunchReconciliation";
import {
  buildRunEvalStartPayload,
  evalAttemptsQueryOptions,
  evalRunQueryOptions,
  type EvalRunReport,
} from "../collections/evalRuns";

const START_MESSAGE = "Run eval";

const PROVIDERS: readonly string[] = Object.values(
  ConversationStartRunRequestDtoProviderEnum,
);
const EFFORTS: readonly string[] = Object.values(
  ConversationStartRunRequestDtoReasoningEffortEnum,
);

const isProvider = (
  value: string,
): value is ConversationStartRunRequestDtoProviderEnum =>
  PROVIDERS.includes(value);
const isEffort = (
  value: string,
): value is ConversationStartRunRequestDtoReasoningEffortEnum =>
  EFFORTS.includes(value);

/**
 * The runner is procedural; the only model the run itself calls is the
 * judge, so the coordinator session starts with the recorded judge setup.
 */
const startModel = (judge: EvalModelSetting) => {
  if (!isProvider(judge.provider)) {
    throw new Error(
      `The run's judge provider "${judge.provider}" can't start a session.`,
    );
  }
  const effort = judge.reasoningEffort;
  return {
    provider: judge.provider,
    model: judge.model,
    ...(effort && isEffort(effort) ? { reasoningEffort: effort } : {}),
  };
};

export interface StartEvalRunInput {
  organizationId: string;
  projectId: string;
  runId: string;
  machineId: string | null;
}

export type EvalRunStartResult = { ok: true } | { ok: false; error: string };

export interface UseEvalRunSessionReturn {
  /** Resolves ok once the CLI accepted the start. */
  start: (input: StartEvalRunInput) => Promise<EvalRunStartResult>;
  /** Resolves true once the platform accepted the stop. */
  stop: (run: EvalRunReport) => Promise<boolean>;
  isStarting: boolean;
  isStopping: boolean;
  error: string | null;
  clearError: () => void;
}

/**
 * Starts and stops a recorded eval run's prepared coordinator session through
 * the app's agent-start flow. Start re-reads the run and its attempts from the
 * server and builds the payload only from them, so it always matches what
 * launch recorded. A failed or refused start leaves the run QUEUED; calling
 * start again retries it with the same recorded input.
 */
export function useEvalRunSession(): UseEvalRunSessionReturn {
  const queryClient = useQueryClient();
  const accessResolver = useAgentSessionInteractionAccessResolver();
  const operationIds = useRef(new Map<string, string>());
  const inFlight = useRef(false);
  const [isStarting, setIsStarting] = useState(false);
  const [isStopping, setIsStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const start = useCallback(
    async ({
      organizationId,
      projectId,
      runId,
      machineId,
    }: StartEvalRunInput): Promise<EvalRunStartResult> => {
      if (inFlight.current) {
        return { ok: false, error: "This run is already starting." };
      }
      inFlight.current = true;
      setIsStarting(true);
      setError(null);
      try {
        const access = accessResolver.getAccess(machineId);
        if (!access.isDeviceEnabled || !machineId) {
          throw new Error(
            access.unavailable?.message ?? "Select a machine to run on.",
          );
        }
        const [run, attempts] = await Promise.all([
          queryClient.fetchQuery({
            ...evalRunQueryOptions(organizationId, runId),
            staleTime: 0,
          }),
          queryClient.fetchQuery({
            ...evalAttemptsQueryOptions(organizationId, runId),
            staleTime: 0,
          }),
        ]);
        if (!run) throw new Error("This run could not be found.");
        if (run.payload.status !== EvalRunStatus.Queued) {
          throw new Error("This run has already started.");
        }
        const { coordinatorAgentSessionId, coordinatorConversationId } =
          run.payload;
        if (!coordinatorAgentSessionId || !coordinatorConversationId) {
          throw new Error("This run has no prepared eval session.");
        }
        const payload = buildRunEvalStartPayload(run, attempts, START_MESSAGE);
        await bindGraphConversationAgentSessionMachine({
          organizationId,
          projectId,
          agentSessionId: coordinatorAgentSessionId,
          machineId,
        });
        const operationId =
          operationIds.current.get(run.id) ?? crypto.randomUUID();
        operationIds.current.set(run.id, operationId);
        const result = await access.interactions.startSession({
          operationId,
          organizationId,
          projectId,
          agentSessionId: coordinatorAgentSessionId,
          conversationId: coordinatorConversationId,
          intent: {
            attachments: [],
            handlerPromptType: payload.promptType,
            payload,
            ...startModel(run.payload.judgeSetup),
            contextMetadata: {
              capturedAt: run.createdAt,
              userComments: [],
              fileReferences: { resolved: [], unresolved: [] },
              organizationId,
              projectId,
              agentSessionId: coordinatorAgentSessionId,
            },
          },
        });
        if (result.state !== "accepted" && result.state !== "succeeded") {
          throw new Error(
            result.state === "cancelled"
              ? "Starting the run was cancelled."
              : result.message,
          );
        }
        operationIds.current.delete(run.id);
        reconcileAcceptedAgentLaunch(queryClient, {
          organizationId,
          projectId,
          agentSessionId: coordinatorAgentSessionId,
          conversationId: coordinatorConversationId,
        });
        return { ok: true };
      } catch (caught) {
        const message = getErrorMessage(
          caught,
          "The run could not be started.",
        );
        setError(message);
        return { ok: false, error: message };
      } finally {
        inFlight.current = false;
        setIsStarting(false);
      }
    },
    [accessResolver, queryClient],
  );

  const stop = useCallback(async (run: EvalRunReport): Promise<boolean> => {
    setIsStopping(true);
    setError(null);
    const sessionId = run.payload.coordinatorAgentSessionId;
    // The runner marks every unfinished attempt STOPPED/USER when its
    // session stops.
    const result = await submitStopRunViaPlatform({
      apiClient: agentSessionsClient,
      runId: sessionId ?? run.id,
      organizationId: run.organizationId,
      projectId: run.projectId ?? null,
      agentSessionId: sessionId,
      conversationId: run.payload.coordinatorConversationId,
    });
    setIsStopping(false);
    if (!result.ok) setError(result.error);
    return result.ok;
  }, []);

  const clearError = useCallback(() => setError(null), []);

  return useMemo(
    () => ({ start, stop, isStarting, isStopping, error, clearError }),
    [start, stop, isStarting, isStopping, error, clearError],
  );
}
