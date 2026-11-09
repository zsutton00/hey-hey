import { useCallback, useRef, useState } from "react";
import {
  LocalRunProviderSessionTranscriptError,
  createDirectoryBindingApi,
  resolveLocalDirectoryRuntimeBaseUrl,
} from "../../components/AgentSession/runtime/directoryBindingApi";

/** Why a session's text cannot be shown; the UI owns the wording. */
export type ProviderSessionTranscriptUnavailableReason =
  | "PROVIDER_NOT_SUPPORTED"
  | "SESSION_NOT_IN_RUN"
  | "SESSION_FILE_NOT_FOUND"
  | "SESSION_FILE_UNREADABLE"
  | "NOT_ON_THIS_COMPUTER"
  | "READ_FAILED";

export type ProviderSessionTranscriptState =
  | { status: "idle" }
  | { status: "loading" }
  | { status: "available"; text: string; truncated: boolean }
  | {
      status: "unavailable";
      reason: ProviderSessionTranscriptUnavailableReason;
    };

export interface ProviderSessionTranscriptTarget {
  /** The Run (agent session) that owns the provider session. */
  runId: string;
  providerId: "claude" | "codex" | "opencode";
  providerSessionId: string;
}

const failureReason = (
  error: unknown,
): ProviderSessionTranscriptUnavailableReason => {
  if (error instanceof LocalRunProviderSessionTranscriptError) {
    return error.code === "RUN_NOT_FOUND"
      ? "NOT_ON_THIS_COMPUTER"
      : "READ_FAILED";
  }
  // The CLI could not be reached from this browser: it is not on this computer.
  return error instanceof TypeError ? "NOT_ON_THIS_COMPUTER" : "READ_FAILED";
};

/**
 * Reads one provider session's raw text from the CLI on this computer. The
 * text lives only in this hook's state: no query cache, storage or logging,
 * and every `read` fetches it again.
 */
export const useProviderSessionTranscript = () => {
  const [state, setState] = useState<ProviderSessionTranscriptState>({
    status: "idle",
  });
  const attemptRef = useRef(0);

  const read = useCallback(async (target: ProviderSessionTranscriptTarget) => {
    const attempt = ++attemptRef.current;
    const isCurrent = () => attempt === attemptRef.current;
    setState({ status: "loading" });
    try {
      const api = createDirectoryBindingApi(
        resolveLocalDirectoryRuntimeBaseUrl(),
      );
      const { machineId } = await api.listRepos();
      const result = await api.readRunProviderSessionTranscript(target.runId, {
        machineId,
        providerId: target.providerId,
        providerSessionId: target.providerSessionId,
      });
      if (!isCurrent()) return;
      setState(
        result.state === "available"
          ? {
              status: "available",
              text: result.text ?? "",
              truncated: result.truncated ?? false,
            }
          : { status: "unavailable", reason: result.reason ?? "READ_FAILED" },
      );
    } catch (error) {
      if (isCurrent()) {
        setState({ status: "unavailable", reason: failureReason(error) });
      }
    }
  }, []);

  const reset = useCallback(() => {
    attemptRef.current += 1;
    setState({ status: "idle" });
  }, []);

  return { state, read, reset };
};
