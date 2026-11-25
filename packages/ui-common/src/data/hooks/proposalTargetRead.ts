import { isAxiosError } from "axios";
import { extractErrorCode } from "../../utils/errorUtils";
import { log } from "../../utils/logger";

/** Why one proposal target's current content could not be read. */
export interface ProposalTargetFailure {
  /** The server holds no readable item: it is archived or does not exist. */
  notFound: boolean;
  message: string;
  retry: () => void;
}

/** Where one target's read stands. Targets are read and fail independently. */
export type ProposalTargetRead<TItem> =
  | { state: "loading" }
  | { state: "ready"; item: TItem }
  | { state: "unavailable"; failure: ProposalTargetFailure };

/** Records the cause of a failed target read and describes it for its card. */
export function failedProposalTargetRead(
  targetEntityType: "TASK" | "DESIGN_DOC",
  targetEntityId: string,
  error: unknown,
  retry: () => void,
): ProposalTargetRead<never> {
  const errorCode = extractErrorCode(error);
  const status = isAxiosError(error) ? error.response?.status : undefined;
  const message = error instanceof Error ? error.message : String(error);

  log.error("data_hooks", "Proposal target could not be read", {
    code: "PROPOSAL_TARGET_UNAVAILABLE",
    targetEntityType,
    targetEntityId,
    errorCode,
    status,
    error: message,
  });

  return {
    state: "unavailable",
    failure: {
      notFound: errorCode === "NOT_FOUND" || status === 404,
      message,
      retry,
    },
  };
}
