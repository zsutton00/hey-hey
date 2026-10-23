import { useCallback, useEffect, useState } from "react";
import type { PrivateBetaSelfServiceAdmissionMode } from "@hey-hey/ui-common/api";
import { unifiedApiClient } from "@hey-hey/ui-common/clients";

type AdmissionState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; mode: PrivateBetaSelfServiceAdmissionMode };

export const usePublicAdmissionMode = () => {
  const [state, setState] = useState<AdmissionState>({ status: "loading" });
  const load = useCallback(async () => {
    setState({ status: "loading" });
    try {
      const response =
        await unifiedApiClient.getPublicPrivateBetaAdmissionMode();
      setState({ status: "ready", mode: response.data.data.mode });
    } catch {
      setState({ status: "error" });
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);
  return { ...state, retry: load };
};
