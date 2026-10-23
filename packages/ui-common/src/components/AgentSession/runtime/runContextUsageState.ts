import type {
  CliReadErrorCode,
  CliReadProviderSessionUsageCost,
  CliReadRunContextUsageResult,
} from "../../../api";

export interface RunContextUsageState {
  readonly status: "idle" | "loading" | "success" | "unavailable";
  readonly data: CliReadRunContextUsageResult | null;
  readonly contextReceivedAt: number | null;
  readonly lastSuccessfulCost: Extract<
    CliReadProviderSessionUsageCost,
    { state: "available" }
  > | null;
  readonly costReceivedAt: number | null;
  readonly error: string | null;
  readonly errorCode: CliReadErrorCode | null;
}

export const idleRunContextUsageState: RunContextUsageState = {
  status: "idle",
  data: null,
  contextReceivedAt: null,
  lastSuccessfulCost: null,
  costReceivedAt: null,
  error: null,
  errorCode: null,
};

export type RunContextUsageOutcome =
  | { data: CliReadRunContextUsageResult }
  | { error: string; errorCode: CliReadErrorCode | null };

export function receiveRunContextUsage(
  previous: RunContextUsageState,
  outcome: RunContextUsageOutcome,
  receivedAt: number
): RunContextUsageState {
  if ("error" in outcome) {
    return { ...previous, status: "unavailable", ...outcome };
  }
  const { data } = outcome;
  return {
    status: "success",
    data,
    contextReceivedAt: receivedAt,
    lastSuccessfulCost:
      data.cost.state === "available" ? data.cost : previous.lastSuccessfulCost,
    costReceivedAt:
      data.cost.state === "available" ? receivedAt : previous.costReceivedAt,
    error: null,
    errorCode: null,
  };
}
