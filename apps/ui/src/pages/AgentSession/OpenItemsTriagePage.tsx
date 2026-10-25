import { useModalShell } from "@hey-hey/ui-common/components/Modals";
import {
  type ReactNode,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import { Alert, Button, IconButton, Stack, Typography } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useTranslation } from "react-i18next";
import {
  EntityType,
  type AgentSessionDto,
  type OpenItemsTriageItem,
  type OpenItemsTriageRequestKind,
} from "@hey-hey/ui-common/api";
import {
  OpenItemsTriageResults,
  MachinePicker,
  AgentBridgeRecoveryNotice,
  resolveAgentBridgeRecoveryState,
  getAgentSessionCurrentStatePresentation,
  useOpenItemsTriageRuntime,
  type OpenItemsTriageRunOptions,
} from "@hey-hey/ui-common/components";
import {
  useOpenItems,
  useAgentSessionCurrentState,
  useTriageApplication,
  useTriageApplicationPorts,
} from "@hey-hey/ui-common/data";
import {
  CanonicalPageBoundary,
  createCanonicalPageDescriptor,
  useAuth,
} from "@hey-hey/ui-common/context";
import { OpenItemsPromotionDialog } from "../../components/Explorer/OpenItemsPromotionDialog";
import { buildAgentSessionPresentation } from "./agentSessionPresentation";
import { useTriagePromotionConfirmation } from "./useTriagePromotionConfirmation";
import { useTriageLaunchOutcome } from "./useTriageLaunchOutcome";

const href = (projectId: string, item: OpenItemsTriageItem) => {
  const routes: Partial<Record<EntityType, string>> = {
    TASK: "tasks",
    DESIGN_DOC: "design-docs",
    AGENT_SESSION: "agent-sessions",
    CONVERSATION: "conversations",
    PROPOSAL: "proposals",
    INITIATIVE: "initiatives",
    SERVICE: "services",
    ARTIFACT: "artifacts",
  };
  return `/projects/${projectId}/${routes[item.entityType] ?? "tasks"}/${
    item.entityId
  }`;
};

type TriageStopResult = { ok: true } | { ok: false; error: string };

/**
 * Binds the page to a transient modal review owned by its caller. The page
 * submits one fresh pass on its new session once ready, reports submitted
 * request ids and activity, and renders only replies correlated to this
 * review. Run Again goes back to the caller, which creates a new session.
 */
export interface OpenItemsTriageReviewBinding {
  /** The mode and guidance the review started with; every request repeats them. */
  options: OpenItemsTriageRunOptions;
  requestMessageIds: readonly string[];
  onFreshPassSubmitted: (messageId: string) => void;
  onFollowUpSubmitted: (messageId: string) => void;
  /** `runActive`: a request is pending or authoritative state is active. */
  onActivity: (activity: "running" | "results", runActive: boolean) => void;
  onRunAgain: () => void;
  onLaunchFailed: (message: string) => void;
  /** Registers the signed stop for a confirmed close during progress. */
  registerStop: (stop: (() => Promise<TriageStopResult>) | null) => void;
  /** Shown under the header in place of the review body while closing. */
  closeGate?: ReactNode;
}

export function OpenItemsTriagePage({
  organizationId,
  projectId,
  agentSession,
  preview = false,
  pageIdentity = preview ? "observational" : "canonical",
  onClose,
  review,
}: {
  organizationId: string;
  projectId: string;
  agentSession: AgentSessionDto;
  preview?: boolean;
  /**
   * Whether the page claims canonical page identity (adding the session to
   * Open Items). Independent of `preview` so an interactive modal can stay
   * observational.
   */
  pageIdentity?: "canonical" | "observational";
  /** When set (modal use), the header shows a close control. */
  onClose?: () => void;
  review: OpenItemsTriageReviewBinding;
}) {
  const inModalShell = useModalShell();
  const { t } = useTranslation();
  const { user } = useAuth();
  const canonical = useOpenItems({
    organizationId,
    projectId,
    userId: user?.id ?? "",
  });
  const confirmation = useTriagePromotionConfirmation();
  const ports = useTriageApplicationPorts(
    canonical.adapter,
    confirmation.promote,
  );
  const application = useTriageApplication(
    ports,
    `${organizationId}:${projectId}:${user?.id}:${agentSession.id}:${
      preview ? "preview" : "canonical"
    }`,
  );
  const runtime = useOpenItemsTriageRuntime(
    organizationId,
    projectId,
    agentSession,
    review.options,
  );
  const state = useAgentSessionCurrentState(
    organizationId,
    projectId,
    agentSession.id,
    { canonicalCurrentState: agentSession.currentState },
  );
  const running =
    !!state.currentState &&
    getAgentSessionCurrentStatePresentation(state.currentState).isActive;
  const requestMessageIds = review.requestMessageIds;
  const latestRequest = requestMessageIds?.at(-1) ?? null;
  const [hasResult, setHasResult] = useState(false);
  const launch = useTriageLaunchOutcome({
    organizationId,
    projectId,
    requestMessageId: requestMessageIds?.[0] ?? null,
    running,
    hasResult,
    runtimeError: runtime.error,
    sessionErrored: agentSession.status === "ERRORED",
    onFailure: review.onLaunchFailed,
  });
  // Until the run is seen active for the latest request, a review with no
  // correlated reply is still waiting on it rather than finished.
  const [activeSeenFor, setActiveSeenFor] = useState<string | null>(null);
  useEffect(() => {
    if (running && latestRequest) setActiveSeenFor(latestRequest);
  }, [running, latestRequest]);
  // A launch that failed, or a run the platform marked ERRORED, will never
  // reply; it ends progress and shows a retryable error instead.
  const failed = !!runtime.error || agentSession.status === "ERRORED";
  const awaitingReply =
    !!latestRequest && !hasResult && !failed && activeSeenFor !== latestRequest;
  const runActive = runtime.pending || running || launch.queued;
  const pending = runActive || awaitingReply;
  const onActivity = review.onActivity;
  useEffect(() => {
    onActivity?.(pending ? "running" : "results", runActive);
  }, [onActivity, pending, runActive]);
  const recovery = resolveAgentBridgeRecoveryState({
    type: "inventory",
    isLoading: !runtime.machines.isReady,
    machines: runtime.machines.machines,
    selectedMachineId: runtime.machines.selectedMachine?.machineId ?? null,
  });
  const { ready, send, stopRun } = runtime;
  const onFreshPassSubmitted = review.onFreshPassSubmitted;
  const onFollowUpSubmitted = review.onFollowUpSubmitted;
  const inFlight = useRef<Promise<unknown> | null>(null);
  const { begin, fail, isCurrent } = launch;
  const currentLaunch = useRef(isCurrent);
  currentLaunch.current = isCurrent;
  const submit = useCallback(
    async (kind: OpenItemsTriageRequestKind, text: string) => {
      if (kind === "freshPass") begin();
      const request = send(kind, text);
      inFlight.current = request;
      try {
        const accepted = await request;
        if (!currentLaunch.current()) return;
        if (!accepted) {
          if (kind === "freshPass")
            fail(
              t(
                "triage.launchFailed",
                "Triage could not start or finish. Try again to start a fresh review.",
              ),
            );
          return;
        }
        if (kind === "freshPass") onFreshPassSubmitted?.(accepted.messageId);
        else onFollowUpSubmitted?.(accepted.messageId);
      } catch (cause) {
        if (kind === "freshPass")
          fail(
            cause instanceof Error
              ? cause.message
              : t("triage.sessionError", "Unable to open triage."),
          );
        throw cause;
      } finally {
        if (inFlight.current === request) inFlight.current = null;
      }
    },
    [send, onFreshPassSubmitted, onFollowUpSubmitted, begin, fail, t],
  );
  // A review submits exactly one fresh pass on its new session once the
  // runtime is ready; opening alone never reaches this page.
  const started = useRef(false);
  useEffect(() => {
    if (preview || !ready || started.current) return;
    started.current = true;
    void submit("freshPass", "").catch(() => {});
  }, [preview, ready, submit]);
  const registerStop = review.registerStop;
  useEffect(() => {
    if (!registerStop) return;
    registerStop(async () => {
      // Let a launching send land first so the stop cannot race ahead of it.
      await inFlight.current?.catch(() => {});
      return stopRun();
    });
    return () => registerStop(null);
  }, [registerStop, stopRun]);
  const closeGate = review.closeGate;
  if (!agentSession.conversationId)
    return (
      <Alert severity="error">
        {t(
          "triage.conversationError",
          "The triage conversation is unavailable.",
        )}
      </Alert>
    );
  return (
    <CanonicalPageBoundary
      composition={
        pageIdentity === "observational"
          ? { kind: "observational" }
          : {
              kind: "canonical",
              descriptor: createCanonicalPageDescriptor(
                "agent_session",
                agentSession.id,
                null,
                buildAgentSessionPresentation(agentSession),
              ),
            }
      }
    >
      <Stack spacing={2} data-testid="open-items-triage-page">
        <Stack
          direction="row"
          justifyContent="space-between"
          alignItems="center"
          spacing={1.5}
          sx={
            onClose
              ? {
                  pr: inModalShell ? 13 : 0,
                  minHeight: 48,
                  pb: 1.25,
                  borderBottom: 1,
                  borderColor: "divider",
                }
              : undefined
          }
        >
          <Typography variant="h5" id="open-items-triage-title">
            {t("triage.title", "Open Items triage")}
          </Typography>
          <Stack direction="row" alignItems="center" spacing={0.5}>
            <Button
              data-testid="triage-run-again"
              disabled={preview || pending || !!closeGate}
              onClick={review.onRunAgain}
            >
              {t("triage.runAgain", "Run Again")}
            </Button>
            {onClose && !inModalShell && (
              <IconButton
                aria-label={t("triage.close", "Close triage")}
                data-testid="open-items-triage-close"
                onClick={onClose}
                size="small"
                sx={{ color: "text.secondary" }}
              >
                <CloseIcon fontSize="small" />
              </IconButton>
            )}
          </Stack>
        </Stack>
        {closeGate}
        <Stack
          spacing={2}
          sx={closeGate ? { display: "none" } : undefined}
          data-testid="open-items-triage-body"
        >
          {runtime.error && <Alert severity="error">{runtime.error}</Alert>}
          {agentSession.status === "ERRORED" && !runtime.error && (
            <Alert severity="error" data-testid="triage-run-error">
              {t(
                "triage.runError",
                "Triage could not finish. Run Again to retry.",
              )}
            </Alert>
          )}
          {!canonical.collection && (
            <Alert severity={canonical.error ? "error" : "info"}>
              {canonical.error?.message ??
                t(
                  "triage.waitingCollection",
                  "Open Items must finish loading before suggestions can be applied.",
                )}
            </Alert>
          )}
          {!preview &&
            !runtime.ready &&
            (runtime.machines.mode === "many" ? (
              <MachinePicker
                machines={runtime.machines.machines}
                selectedMachineId={
                  runtime.machines.selectedMachine?.machineId ?? null
                }
                onSelect={runtime.machines.setSelectedMachineId}
                disabled={pending}
                mobileMode="editor"
              />
            ) : (
              <AgentBridgeRecoveryNotice
                state={recovery}
                presentation="inline"
                testId="triage-machine-recovery"
              />
            ))}
          <OpenItemsTriageResults
            organizationId={organizationId}
            projectId={projectId}
            conversationId={agentSession.conversationId}
            application={canonical.collection ? application : undefined}
            itemHref={(item) => href(projectId, item)}
            pending={pending}
            disabled={preview || !runtime.ready}
            onSend={(text) => submit("followUp", text)}
            requestMessageIds={requestMessageIds}
            onResultPresenceChange={setHasResult}
            currentState={state.currentState}
          />
          {confirmation.suggestion && confirmation.intent && (
            <OpenItemsPromotionDialog
              groupId={confirmation.suggestion.groupId}
              onClose={() => confirmation.finish("cancelled")}
              triage={{
                initialName: confirmation.suggestion.goalName,
                initialDate: confirmation.suggestion.targetDate,
                intent: confirmation.intent,
                onSuccess: () => confirmation.finish("success"),
                onFailure: confirmation.fail,
              }}
            />
          )}
        </Stack>
      </Stack>
    </CanonicalPageBoundary>
  );
}
