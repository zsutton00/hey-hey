import {
  type ReactNode,
  useCallback,
  useEffect,
  useReducer,
  useRef,
  useState,
} from "react";
import {
  Alert,
  AlertTitle,
  Box,
  Button,
  CircularProgress,
  IconButton,
  Stack,
  Tooltip,
} from "@mui/material";
import AutoAwesomeOutlinedIcon from "@mui/icons-material/AutoAwesomeOutlined";
import { useTranslation } from "react-i18next";
import {
  useAgentSession,
  useOpenItemsTriageSession,
} from "@hey-hey/ui-common/data";
import type { OpenItemsTriageRunOptions } from "@hey-hey/ui-common/components";
import { PreviewModal } from "../PreviewModal";
import {
  OpenItemsTriagePage,
  type OpenItemsTriageReviewBinding,
} from "../../pages/AgentSession/OpenItemsTriagePage";
import {
  OpenItemsTriageModalHeader,
  TRIAGE_TITLE_ID,
} from "./OpenItemsTriageModalHeader";
import {
  OpenItemsTriageHelp,
  TRIAGE_HELP_DESCRIPTION_ID,
} from "./OpenItemsTriageHelp";
import { OpenItemsTriageCloseConfirmation } from "./OpenItemsTriageCloseConfirmation";
import {
  initialTriageReview,
  reduceTriageReview,
  type TriageActivity,
  type TriageStopResult,
} from "./openItemsTriageReview";

// The start screen is narrower than a review; the review keeps the dialog default.
const TRIAGE_START_DIALOG_WIDTH = 440;

function TriageModalState({
  onClose,
  children,
}: {
  onClose: () => void;
  children: ReactNode;
}) {
  return (
    <Stack spacing={2}>
      <OpenItemsTriageModalHeader onClose={onClose} />
      {children}
    </Stack>
  );
}

function TriageLoading() {
  const { t } = useTranslation();
  return (
    <Box
      data-testid="open-items-triage-loading"
      role="status"
      aria-label={t("triage.opening", "Opening triage…")}
      sx={{ display: "flex", justifyContent: "center", py: 4 }}
    >
      <CircularProgress size={24} />
    </Box>
  );
}

function TriageError({
  message,
  onRetry,
}: {
  message: string;
  onRetry: () => void;
}) {
  const { t } = useTranslation();
  return (
    <Alert
      severity="error"
      data-testid="open-items-triage-session-error"
      action={
        <Button
          data-testid="triage-launch-retry"
          color="inherit"
          size="small"
          onClick={onRetry}
        >
          {t("triage.tryAgain", "Try again")}
        </Button>
      }
    >
      <AlertTitle>
        {t("triage.reviewCouldNotStart", "Review could not start")}
      </AlertTitle>
      {message}
    </Alert>
  );
}

function OpenItemsTriageSessionContent({
  organizationId,
  projectId,
  agentSessionId,
  onClose,
  onSessionFailed,
  review,
}: {
  organizationId: string;
  projectId: string;
  agentSessionId: string;
  onClose: () => void;
  onSessionFailed: (message: string) => void;
  review: OpenItemsTriageReviewBinding;
}) {
  const { t } = useTranslation();
  const { agentSession, error } = useAgentSession(
    organizationId,
    projectId,
    agentSessionId,
  );
  const failure = error
    ? error instanceof Error
      ? error.message
      : t("triage.sessionError", "Unable to open triage.")
    : agentSession && !agentSession.conversationId
      ? t("triage.conversationError", "The triage conversation is unavailable.")
      : null;
  useEffect(() => {
    if (failure) onSessionFailed(failure);
  }, [failure, onSessionFailed]);
  if (!agentSession || failure)
    return (
      <TriageModalState onClose={onClose}>
        {review.closeGate ?? <TriageLoading />}
      </TriageModalState>
    );
  return (
    <OpenItemsTriagePage
      organizationId={organizationId}
      projectId={projectId}
      agentSession={agentSession}
      pageIdentity="observational"
      onClose={onClose}
      review={review}
    />
  );
}

/**
 * Owns one transient triage review for a single modal opening. Every close
 * path (× control, Escape, backdrop) goes through `handleRequestClose`.
 */
function OpenItemsTriageReview({
  organizationId,
  projectId,
  open,
  onClosed,
}: {
  organizationId: string;
  projectId: string;
  open: boolean;
  onClosed: () => void;
}) {
  const { t } = useTranslation();
  const session = useOpenItemsTriageSession();
  const [state, dispatch] = useReducer(reduceTriageReview, initialTriageReview);
  const stop = useRef<(() => Promise<TriageStopResult>) | null>(null);
  const { closed, gate, phase, requestMessageIds } = state;
  const sessionId = phase.kind === "session" ? phase.agentSessionId : null;
  const currentSessionId = useRef(sessionId);
  currentSessionId.current = closed ? null : sessionId;

  useEffect(() => {
    if (closed) onClosed();
  }, [closed, onClosed]);

  const { mutate } = session;
  const resolveSession = useCallback(async () => {
    try {
      const result = await mutate({ organizationId, projectId });
      dispatch({ type: "resolved", agentSessionId: result.agentSessionId });
    } catch (cause) {
      dispatch({
        type: "resolveFailed",
        message:
          cause instanceof Error
            ? cause.message
            : t("triage.sessionError", "Unable to open triage."),
      });
    }
  }, [mutate, organizationId, projectId, t]);
  const handleRun = useCallback(
    (options: OpenItemsTriageRunOptions) => {
      dispatch({ type: "run", options });
      return resolveSession();
    },
    [resolveSession],
  );
  const handleRerun = useCallback(() => {
    dispatch({ type: "rerun" });
    return resolveSession();
  }, [resolveSession]);
  const handleRequestClose = useCallback(
    () => dispatch({ type: "requestClose" }),
    [],
  );
  const handleKeepReviewing = useCallback(
    () => dispatch({ type: "keepReviewing" }),
    [],
  );
  const gateKind = gate.kind;
  const handleConfirmClose = useCallback(async () => {
    dispatch({ type: "confirmClose" });
    if (gateKind !== "confirmCancel" && gateKind !== "stopFailed") return;
    // Without a mounted page nothing was submitted, so there is nothing to stop.
    const result = stop.current ? await stop.current() : { ok: true as const };
    dispatch(
      result.ok
        ? { type: "stopAdmitted" }
        : { type: "stopFailed", message: result.error },
    );
  }, [gateKind]);
  const handleSessionFailed = useCallback(
    (message: string) => {
      if (sessionId && currentSessionId.current === sessionId)
        dispatch({ type: "sessionFailed", message });
    },
    [sessionId],
  );
  const handleFreshPassSubmitted = useCallback(
    (messageId: string) => {
      if (sessionId && currentSessionId.current === sessionId)
        dispatch({ type: "freshPassSubmitted", messageId });
    },
    [sessionId],
  );
  const handleFollowUpSubmitted = useCallback(
    (messageId: string) => {
      if (sessionId && currentSessionId.current === sessionId)
        dispatch({ type: "followUpSubmitted", messageId });
    },
    [sessionId],
  );
  const handleActivity = useCallback(
    (activity: TriageActivity, runActive: boolean) => {
      if (sessionId && currentSessionId.current === sessionId)
        dispatch({ type: "activity", activity, runActive });
    },
    [sessionId],
  );
  const handleRegisterStop = useCallback(
    (next: (() => Promise<TriageStopResult>) | null) => {
      stop.current = next;
    },
    [],
  );

  const closeGate =
    gate.kind === "none" ? undefined : (
      <OpenItemsTriageCloseConfirmation
        gate={gate}
        onKeep={handleKeepReviewing}
        onConfirm={() => void handleConfirmClose()}
      />
    );
  const bindReview = (
    options: OpenItemsTriageRunOptions,
  ): OpenItemsTriageReviewBinding => ({
    options,
    requestMessageIds,
    onFreshPassSubmitted: handleFreshPassSubmitted,
    onFollowUpSubmitted: handleFollowUpSubmitted,
    onActivity: handleActivity,
    onRunAgain: () => void handleRerun(),
    onLaunchFailed: handleSessionFailed,
    registerStop: handleRegisterStop,
    closeGate,
  });

  return (
    <PreviewModal
      open={open}
      onClose={handleRequestClose}
      layout="dialog"
      dialogWidth={
        phase.kind === "help" ? TRIAGE_START_DIALOG_WIDTH : undefined
      }
      labelledBy={TRIAGE_TITLE_ID}
      describedBy={
        phase.kind === "help" ? TRIAGE_HELP_DESCRIPTION_ID : undefined
      }
    >
      {phase.kind === "help" ? (
        <TriageModalState onClose={handleRequestClose}>
          <OpenItemsTriageHelp
            onRun={(mode, guidance) => void handleRun({ mode, guidance })}
          />
        </TriageModalState>
      ) : phase.kind === "resolving" ? (
        <TriageModalState onClose={handleRequestClose}>
          <TriageLoading />
        </TriageModalState>
      ) : phase.kind === "resolveError" ? (
        <TriageModalState onClose={handleRequestClose}>
          <TriageError
            message={phase.message}
            onRetry={() => void handleRerun()}
          />
        </TriageModalState>
      ) : (
        <OpenItemsTriageSessionContent
          key={phase.agentSessionId}
          organizationId={organizationId}
          projectId={projectId}
          agentSessionId={phase.agentSessionId}
          onClose={handleRequestClose}
          onSessionFailed={handleSessionFailed}
          review={bindReview(phase.options)}
        />
      )}
    </PreviewModal>
  );
}

export function OpenItemsTriageAction({
  organizationId,
  projectId,
}: {
  organizationId: string;
  projectId: string;
}) {
  const { t } = useTranslation();
  const [modalOpen, setModalOpen] = useState(false);
  // Each opening mounts a new review, so it always starts at help.
  const [opening, setOpening] = useState(0);
  const handleOpen = () => {
    setOpening((current) => current + 1);
    setModalOpen(true);
  };
  const handleClosed = useCallback(() => setModalOpen(false), []);
  return (
    <>
      <Tooltip title={t("triage.open", "Triage Open Items")}>
        <IconButton
          size="small"
          data-testid="open-items-triage-action"
          aria-label={t("triage.open", "Triage Open Items")}
          onClick={(event) => {
            event.stopPropagation();
            handleOpen();
          }}
          sx={{ color: "text.secondary", height: 28, width: 28 }}
        >
          <AutoAwesomeOutlinedIcon fontSize="small" />
        </IconButton>
      </Tooltip>
      {/* Portalled modal events still bubble through the React tree; keep
          them from reaching the section header. */}
      <Box
        component="span"
        sx={{ display: "contents" }}
        onClick={(event) => event.stopPropagation()}
      >
        <OpenItemsTriageReview
          key={opening}
          organizationId={organizationId}
          projectId={projectId}
          open={modalOpen}
          onClosed={handleClosed}
        />
      </Box>
    </>
  );
}
