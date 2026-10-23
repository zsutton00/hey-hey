import { useState } from "react";
import type { ProviderSessionChoice } from "../../RunContextUsageCapsules";

export function useRunContextUsageSelection(
  scope: string,
  sessions: readonly ProviderSessionChoice[]
) {
  const [selection, setSelection] = useState<{
    scope: string;
    id: string;
  } | null>(null);
  const providerSessionId =
    selection?.scope === scope &&
    sessions.some((session) => session.id === selection.id)
      ? selection.id
      : sessions.at(-1)?.id;
  return {
    providerSessionId,
    selectSession: (id: string) => setSelection({ scope, id }),
  };
}
