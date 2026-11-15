import type { RecordedEditUnavailableCause } from "@hey-hey/ui-common/data";

export function recordedEditUnavailableReason(
  cause: RecordedEditUnavailableCause,
): string {
  switch (cause.kind) {
    case "machine-unreachable":
      return "changes.reason.offline";
    case "denied":
      return "changes.reason.denied";
    case "session-unavailable":
      return "changes.reason.sessionUnavailable";
    case "unexpected":
      return "changes.reason.generic";
    case "read-error":
      switch (cause.code) {
        case "NO_RECIPIENT":
        case "TIMEOUT":
        case "MACHINE_NOT_BOUND":
          return "changes.reason.offline";
        case "FILE_TOO_LARGE":
        case "RESULT_TOO_LARGE":
          return "changes.reason.tooLarge";
        case "READ_FAILED":
          return "changes.reason.versionsGone";
        case "INVALID_FILE_MEMBERSHIP":
          return "changes.reason.notInRecord";
        default:
          return "changes.reason.generic";
      }
  }
}
