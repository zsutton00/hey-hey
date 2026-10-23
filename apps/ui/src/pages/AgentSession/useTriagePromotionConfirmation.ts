import { useCallback, useEffect, useRef, useState } from "react";
import type {
  OpenItemsTriagePromoteGroupSuggestion,
  PromoteGroupToGoalRequest,
} from "@hey-hey/ui-common/api";
import type { TriagePromotionIntent } from "@hey-hey/ui-common/data";

export function useTriagePromotionConfirmation() {
  const [suggestion, setSuggestion] =
    useState<OpenItemsTriagePromoteGroupSuggestion | null>(null);
  const [intent, setIntent] = useState<{
    current: PromoteGroupToGoalRequest | null;
  } | null>(null);
  const pending = useRef<{
    resolve: (value: "success" | "cancelled") => void;
    reject: (cause: unknown) => void;
  } | null>(null);
  const finish = useCallback((value: "success" | "cancelled") => {
    pending.current?.resolve(value);
    pending.current = null;
    setSuggestion(null);
  }, []);
  const fail = useCallback((cause: unknown) => {
    pending.current?.reject(cause);
    pending.current = null;
    setSuggestion(null);
  }, []);
  useEffect(
    () => () => {
      pending.current?.resolve("cancelled");
      pending.current = null;
    },
    [],
  );
  const promote = useCallback(
    (
      next: OpenItemsTriagePromoteGroupSuggestion,
      requestIntent: TriagePromotionIntent,
    ): Promise<"success" | "cancelled"> => {
      if (pending.current)
        return Promise.reject(
          new Error("A promotion confirmation is already open."),
        );
      setIntent(requestIntent);
      setSuggestion(next);
      return new Promise((resolve, reject) => {
        pending.current = { resolve, reject };
      });
    },
    [],
  );
  return { suggestion, intent, promote, finish, fail };
}
