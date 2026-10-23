import type { CliReadErrorCode } from "../../api";

interface RemoteReadIdentity {
  readonly readIdentity: string;
  readonly retryGeneration: number;
}

export type FeedbackFailureIdentity =
  RemoteReadIdentity | { readonly reason: string };

export interface RemoteFailureRecord {
  readonly reason: string;
  readonly retryable: boolean;
  readonly failureIdentity: FeedbackFailureIdentity;
  readonly errorCode: CliReadErrorCode | null;
}

type UnavailableOutcomeBase = RemoteFailureRecord & {
  readonly status: "unavailable";
  readonly retry: () => void;
  readonly isRetrying: boolean;
};

export type UnavailableOutcome =
  | (UnavailableOutcomeBase & { readonly presentationScope: "action" })
  | (UnavailableOutcomeBase & { readonly presentationScope: "composer" })
  | (UnavailableOutcomeBase & { readonly presentationScope: "session" });

export const getFailureIdentityKey = (
  identity: FeedbackFailureIdentity,
): string =>
  "readIdentity" in identity
    ? `${identity.readIdentity}:${String(identity.retryGeneration)}`
    : identity.reason;

/**
 * The read API exposes a typed error discriminator rather than a retry flag.
 * Only outcomes that can plausibly change after another read are retryable;
 * malformed or scope-invalid requests remain terminal in the presentation.
 */
export const isRetryableCliReadError = (
  errorCode: CliReadErrorCode | null,
): boolean => {
  switch (errorCode) {
    case "MACHINE_NOT_BOUND":
    case "NO_RECIPIENT":
    case "READ_FAILED":
    case "TIMEOUT":
      return true;
    case "CORRELATION_MISMATCH":
    case "INVALID_FILE_MEMBERSHIP":
    case "INVALID_PROJECT_CONTEXT":
    case "INVALID_REPOSITORY_PATH":
    case "INVALID_REQUEST":
    case "INVALID_RUN_CONTEXT":
    case "MALFORMED_ACK":
    case "REPOSITORY_NOT_FOUND":
    case "RESULT_TOO_LARGE":
    case "RUN_ID_MISMATCH":
    case "RUN_NOT_FOUND":
    case "SERVICE_NOT_FOUND":
      return false;
    case "INVALID_CURSOR":
      return false;
    case null:
      return false;
  }

  return false;
};
