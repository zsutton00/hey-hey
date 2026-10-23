import { useRef, useState, type MutableRefObject } from "react";
import { isAxiosError } from "axios";
import type { PromoteGroupToGoalRequest } from "@hey-hey/ui-common/api";
import { useOpenItems } from "../contexts/OpenItemsContext";

export function useOpenItemsPromotion(
  groupId: string,
  onSuccess: () => void,
  options?: {
    intent: MutableRefObject<PromoteGroupToGoalRequest | null>;
    onFailure: (error: unknown) => void;
  },
) {
  const { promoteGroupToGoal, refresh } = useOpenItems();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [needsRefresh, setNeedsRefresh] = useState(false);
  const localIntent = useRef<PromoteGroupToGoalRequest | null>(null);
  const intent = options?.intent ?? localIntent;
  const inFlight = useRef(false);
  const confirm = async (goalName: string, targetDate: string) => {
    if (inFlight.current || needsRefresh) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    // The date control supplies a calendar date; the API requires date-time.
    const canonicalTargetDate = targetDate
      ? `${targetDate}T00:00:00.000Z`
      : undefined;
    const previous = intent.current;
    // Preserve same-intent retry identity after a partial provider failure.
    const request: PromoteGroupToGoalRequest =
      previous &&
      previous.goalName === goalName.trim() &&
      previous.targetDate === canonicalTargetDate
        ? previous
        : {
            groupId,
            goalName: goalName.trim(),
            ...(canonicalTargetDate ? { targetDate: canonicalTargetDate } : {}),
            idempotencyKey: crypto.randomUUID(),
          };
    intent.current = request;
    try {
      await promoteGroupToGoal(request);
      onSuccess();
    } catch (failure) {
      const stale =
        isAxiosError(failure) &&
        [404, 409, 410, 412].includes(failure.response?.status ?? 0);
      // Status alone cannot prove that no Goal was created: ordered promotion
      // can fail in tracking or collection publication after that write.
      // Retain the confirmed identity so recovery never creates a second Goal.
      const failureMessage = stale
        ? "This group changed. Refresh Open Items, review the group, then confirm again."
        : "Promotion failed. Earlier Goal or tracking changes may remain. Refresh and retry the same confirmed action.";
      setError(failureMessage);
      setNeedsRefresh(true);
      options?.onFailure(new Error(failureMessage));
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  const refreshForReview = async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    try {
      if (await refresh()) {
        setNeedsRefresh(false);
        setError(null);
      } else setError("Could not refresh Open Items. Try refreshing again.");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  return { busy, error, needsRefresh, confirm, refreshForReview };
}
