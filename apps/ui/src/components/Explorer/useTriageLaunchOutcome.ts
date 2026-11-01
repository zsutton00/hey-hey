import { useCallback, useEffect, useRef, useState } from "react";
import { useMessage } from "@hey-hey/ui-common/data";
import { useTranslation } from "react-i18next";

export const TRIAGE_LAUNCH_CONFIRMATION_MS = 60_000;

/** A saved request alone is not confirmation that execution was admitted. */
export function useTriageLaunchOutcome({
  organizationId,
  projectId,
  requestMessageId,
  running,
  hasResult,
  runtimeError,
  sessionErrored,
  onFailure,
}: {
  organizationId: string;
  projectId: string;
  requestMessageId: string | null;
  running: boolean;
  hasResult: boolean;
  runtimeError: string | null;
  sessionErrored: boolean;
  onFailure?: (message: string) => void;
}) {
  const { t } = useTranslation();
  const [submitted, setSubmitted] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const failed = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);
  const { data: message } = useMessage(
    organizationId,
    projectId,
    requestMessageId ?? undefined,
    { enabled: !!onFailure && !!requestMessageId },
  );
  const status = message?.executionStatus;
  const queued =
    status === "queued" &&
    (message?.executionQueueConfirmed === true ||
      message?.executionAdmissionDisposition === "QUEUED");
  const started = status === "started" || running || hasResult;
  const fail = useCallback(
    (text: string) => {
      if (!mounted.current || failed.current || !onFailure) return;
      failed.current = true;
      onFailure(text);
    },
    [onFailure],
  );
  useEffect(() => {
    // Follow-up send errors stay with the existing review and its results.
    if (hasResult) return;
    if (runtimeError) fail(runtimeError);
    else if (sessionErrored || status === "failed" || status === "cancelled")
      fail(
        t(
          "triage.launchFailed",
          "Triage could not start or finish. Try again to start a fresh review.",
        ),
      );
  }, [hasResult, runtimeError, sessionErrored, status, fail, t]);
  useEffect(() => {
    if (started || queued) setConfirmed(true);
  }, [started, queued]);
  useEffect(() => {
    if (!submitted || confirmed || started || queued || !onFailure) return;
    const timer = setTimeout(
      () =>
        fail(
          t(
            "triage.launchUnconfirmed",
            "Triage could not be confirmed as started. Try again to start a fresh review. The earlier request has not been cancelled.",
          ),
        ),
      TRIAGE_LAUNCH_CONFIRMATION_MS,
    );
    return () => clearTimeout(timer);
  }, [submitted, confirmed, started, queued, onFailure, fail, t]);
  const begin = useCallback(() => setSubmitted(true), []);
  return {
    begin,
    fail,
    queued,
    isCurrent: () => mounted.current && !failed.current,
  };
}
