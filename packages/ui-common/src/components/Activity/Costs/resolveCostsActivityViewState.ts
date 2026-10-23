import type { CliReadError } from "../../../api";
import type { ProjectSessionCostsCollectionResult } from "../../../data/hooks/useProjectSessionCosts";

export type CostsActivityViewState =
  | { kind: "initial-loading" }
  | { kind: "timeout"; message: string }
  | { kind: "unavailable"; message: string }
  | { kind: "source-error"; error: CliReadError }
  | { kind: "request-error"; error: Error }
  | {
      kind: "empty";
      costReadAt: string;
    }
  | {
      kind: "ready";
      result: ProjectSessionCostsCollectionResult;
      isLoadingMore: boolean;
    };

export interface ResolveCostsActivityViewStateInput {
  result: ProjectSessionCostsCollectionResult | null;
  typedError: CliReadError | null;
  requestError: Error | null;
  isInitialLoading: boolean;
  isLoadingMore: boolean;
}

export const resolveCostsActivityViewState = ({
  result,
  typedError,
  requestError,
  isInitialLoading,
  isLoadingMore,
}: ResolveCostsActivityViewStateInput): CostsActivityViewState => {
  if (isInitialLoading && !result) {
    return { kind: "initial-loading" };
  }
  if (typedError?.code === "TIMEOUT") {
    return { kind: "timeout", message: typedError.message };
  }
  if (
    typedError?.code === "MACHINE_NOT_BOUND" ||
    typedError?.code === "NO_RECIPIENT"
  ) {
    return { kind: "unavailable", message: typedError.message };
  }
  if (typedError) {
    return { kind: "source-error", error: typedError };
  }
  if (requestError) {
    return { kind: "request-error", error: requestError };
  }
  if (!result) {
    return {
      kind: "unavailable",
      message: "Cost data is unavailable from the connected CLI.",
    };
  }
  if (
    result.items.length === 0 &&
    result.sourceAvailability === "unavailable"
  ) {
    return {
      kind: "unavailable",
      message: "Cost data is unavailable from the connected CLI.",
    };
  }
  if (result.items.length === 0) {
    return {
      kind: "empty",
      costReadAt: result.costReadAt,
    };
  }
  return {
    kind: "ready",
    result,
    isLoadingMore,
  };
};
