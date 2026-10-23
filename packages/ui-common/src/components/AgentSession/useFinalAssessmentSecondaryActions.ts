import { useCallback, useMemo, useState } from "react";

export type FinalAssessmentActionId =
  | "sync_with_hey_hey"
  | "request_code_review";

export type FinalAssessmentActionState =
  | "idle"
  | "loading"
  | "success"
  | "error";

export interface FinalAssessmentSecondaryAction {
  id: FinalAssessmentActionId;
  label: string;
  description: string;
  loadingLabel: string;
  icon: "sync" | "code_review" | "schema";
  variant: "contained" | "outlined";
}

export interface FinalAssessmentActionStatus {
  state: FinalAssessmentActionState;
  notice: string | null;
  error: string | null;
}

export interface FinalAssessmentSecondaryActionsApi {
  actions: FinalAssessmentSecondaryAction[];
  getActionStatus: (id: FinalAssessmentActionId) => FinalAssessmentActionStatus;
  executeAction: (id: FinalAssessmentActionId) => void;
  isAnyActionInFlight: boolean;
}

const FINAL_ASSESSMENT_ACTIONS: FinalAssessmentSecondaryAction[] = [
  {
    id: "sync_with_hey_hey",
    label: "Sync with Hey Hey",
    description:
      "Update Hey Hey with implementation changes from this session.",
    loadingLabel: "Syncing with Hey Hey...",
    icon: "sync",
    variant: "contained",
  },
  {
    id: "request_code_review",
    label: "Request code review",
    description: "Send a focused follow-up prompt asking for a code review.",
    loadingLabel: "Requesting code review...",
    icon: "code_review",
    variant: "outlined",
  },
];

const IDLE_STATUS: FinalAssessmentActionStatus = {
  state: "idle",
  notice: null,
  error: null,
};

interface UseFinalAssessmentSecondaryActionsInput {
  onSync: () => Promise<void> | void;
  onRequestCodeReview: () => Promise<void> | void;
}

export const useFinalAssessmentSecondaryActions = ({
  onSync,
  onRequestCodeReview,
}: UseFinalAssessmentSecondaryActionsInput): FinalAssessmentSecondaryActionsApi => {
  const [statuses, setStatuses] = useState<
    Record<FinalAssessmentActionId, FinalAssessmentActionStatus>
  >({
    sync_with_hey_hey: IDLE_STATUS,
    request_code_review: IDLE_STATUS,
  });

  const executeAction = useCallback(
    (id: FinalAssessmentActionId) => {
      const handler = id === "sync_with_hey_hey" ? onSync : onRequestCodeReview;

      setStatuses((prev) => ({
        ...prev,
        [id]: { state: "loading" as const, notice: null, error: null },
      }));

      const result = handler();
      if (result && typeof result.then === "function") {
        result.then(
          () => {
            setStatuses((prev) => ({
              ...prev,
              [id]: {
                state: "success" as const,
                notice: "Action completed successfully.",
                error: null,
              },
            }));
          },
          (err: unknown) => {
            setStatuses((prev) => ({
              ...prev,
              [id]: {
                state: "error" as const,
                notice: null,
                error:
                  err instanceof Error
                    ? err.message
                    : "Action failed unexpectedly.",
              },
            }));
          }
        );
      } else {
        setStatuses((prev) => ({
          ...prev,
          [id]: {
            state: "success" as const,
            notice: "Action completed successfully.",
            error: null,
          },
        }));
      }
    },
    [onSync, onRequestCodeReview]
  );

  const getActionStatus = useCallback(
    (id: FinalAssessmentActionId): FinalAssessmentActionStatus =>
      statuses[id] ?? IDLE_STATUS,
    [statuses]
  );

  const isAnyActionInFlight = useMemo(
    () => Object.values(statuses).some((s) => s.state === "loading"),
    [statuses]
  );

  return {
    actions: FINAL_ASSESSMENT_ACTIONS,
    getActionStatus,
    executeAction,
    isAnyActionInFlight,
  };
};
