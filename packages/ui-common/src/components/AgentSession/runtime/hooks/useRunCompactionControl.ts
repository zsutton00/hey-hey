import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  CompactionNoticeMarker,
  MessageResponseDto,
} from "../../../../api";

/** How long an accepted request may go without any compaction notice. */
export const COMPACTION_START_TIMEOUT_MS = 15_000;

export type RunCompactionState =
  | { status: "idle" }
  | { status: "authorizing" }
  | { status: "awaiting_start" }
  | { status: "queued" }
  | { status: "compacting" }
  | { status: "completed" }
  | { status: "failed"; message: string; retryable: boolean };

interface CompactionNotice {
  id: string;
  marker: CompactionNoticeMarker;
}

/** Every Run compaction notice in the conversation, in message order. */
export const collectCompactionNotices = (
  messages: readonly MessageResponseDto[],
): CompactionNotice[] => {
  const notices: CompactionNotice[] = [];
  const visit = (message: MessageResponseDto): void => {
    if (message.type === "SYSTEM" && message.data.compaction) {
      notices.push({ id: message.id, marker: message.data.compaction });
    }
    message.responses?.forEach(visit);
  };
  messages.forEach(visit);
  return notices;
};

const failureMessage = (code: string | undefined, text: string): string => {
  if (code === "NOT_SUPPORTED") {
    return "This agent's provider doesn't support compaction.";
  }
  if (code === "NO_ACTIVE_SESSION") {
    return "The agent has no active provider session to compact.";
  }
  return text;
};

const stateFor = (
  notice: CompactionNotice,
  text: string,
): RunCompactionState => {
  switch (notice.marker.phase) {
    case "queued":
      return { status: "queued" };
    case "started":
      return { status: "compacting" };
    case "completed":
      return { status: "completed" };
    case "failed":
      return {
        status: "failed",
        message: failureMessage(notice.marker.code, text),
        retryable: true,
      };
  }
};

const responseText = (
  messages: readonly MessageResponseDto[],
  id: string,
): string => {
  let text = "Compaction failed.";
  const visit = (message: MessageResponseDto): void => {
    if (message.id === id && message.type === "SYSTEM") {
      text = message.data.response ?? text;
    }
    message.responses?.forEach(visit);
  };
  messages.forEach(visit);
  return text;
};

/**
 * Tracks one user-requested compaction of the current Run. The request is
 * correlated with the Run's typed compaction notices that appear after the
 * click, so an earlier compaction's notices never settle a new request.
 */
export const useRunCompactionControl = ({
  messages,
  requestCompact,
}: {
  messages: readonly MessageResponseDto[];
  requestCompact: () => Promise<void>;
}) => {
  const [state, setState] = useState<RunCompactionState>({ status: "idle" });
  const seenAtClick = useRef<Set<string> | null>(null);
  const notices = useMemo(() => collectCompactionNotices(messages), [messages]);

  useEffect(() => {
    const seen = seenAtClick.current;
    if (seen === null) {
      return;
    }
    const fresh = notices.filter((notice) => !seen.has(notice.id));
    const latest = fresh.at(-1);
    if (!latest) {
      return;
    }
    const next = stateFor(latest, responseText(messages, latest.id));
    if (next.status === "completed" || next.status === "failed") {
      seenAtClick.current = null;
    }
    setState(next);
  }, [messages, notices]);

  useEffect(() => {
    if (state.status !== "awaiting_start") {
      return;
    }
    const timer = setTimeout(() => {
      seenAtClick.current = null;
      setState({
        status: "failed",
        message: "Compaction didn't start. The agent may be disconnected.",
        retryable: true,
      });
    }, COMPACTION_START_TIMEOUT_MS);
    return () => clearTimeout(timer);
  }, [state.status]);

  const compact = useCallback(async () => {
    seenAtClick.current = new Set(notices.map((notice) => notice.id));
    setState({ status: "authorizing" });
    try {
      await requestCompact();
    } catch (error) {
      seenAtClick.current = null;
      setState({
        status: "failed",
        message:
          error instanceof Error ? error.message : "Compaction was refused.",
        retryable: true,
      });
      return;
    }
    setState((current) =>
      current.status === "authorizing" ? { status: "awaiting_start" } : current,
    );
  }, [notices, requestCompact]);

  const isPending =
    state.status === "authorizing" ||
    state.status === "awaiting_start" ||
    state.status === "queued" ||
    state.status === "compacting";

  return { state, compact, isPending };
};
