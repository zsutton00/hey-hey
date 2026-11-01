import { OpenItemsTriageSessionContent } from "./OpenItemsTriageSessionContent";
import { TriageError } from "./TriageError";
import { TriageLoading } from "./TriageLoading";
import { TriageModalState } from "./TriageModalState";
import { useCallback, useEffect, useReducer, useRef } from "react";
import { IconButton } from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import { useTranslation } from "react-i18next";
import { useOpenItemsTriageSession } from "@hey-hey/ui-common/data";
import type { OpenItemsTriageRunOptions } from "@hey-hey/ui-common/components";
import { PreviewModal } from "../PreviewModal";
import { type OpenItemsTriageReviewBinding } from "./OpenItemsTriageContent";
import { TRIAGE_TITLE_ID } from "./OpenItemsTriageModalHeader";
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

/**
 * Owns one transient triage review for a single modal opening. Every close
 * path (× control, Escape, backdrop) goes through `handleRequestClose`.
 */
export function OpenItemsTriageReview({
  organizationId,
  projectId,
  open,
  onClosed,
  ownerKey,
}: {
  organizationId: string;
  projectId: string;
  open: boolean;
  onClosed: () => void;
  ownerKey: string;
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
      ownerKey={ownerKey}
      workTitle="Open Items triage"
      closeControl={
        <IconButton
          aria-label={t("triage.close", "Close triage")}
          data-testid="open-items-triage-close"
          onClick={handleRequestClose}
        >
          <CloseIcon fontSize="small" />
        </IconButton>
      }
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
