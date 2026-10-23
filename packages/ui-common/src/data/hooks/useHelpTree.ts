import { useEffect, useState } from "react";
import type { AxiosResponse } from "axios";

import type { GetHelpTree200Response, HelpTreeResponse } from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";

export interface UseHelpTreeReturn {
  tree: HelpTreeResponse | null;
  isLoading: boolean;
  error: Error | null;
}

export function useHelpTree(): UseHelpTreeReturn {
  const [tree, setTree] = useState<HelpTreeResponse | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    setIsLoading(true);
    setError(null);

    unifiedApiClient
      .getHelpTree()
      .then((response: AxiosResponse<GetHelpTree200Response>) => {
        setTree(response.data.data ?? null);
      })
      .catch((err: Error) => setError(err))
      .finally(() => setIsLoading(false));
  }, []);

  return { tree, isLoading, error };
}
