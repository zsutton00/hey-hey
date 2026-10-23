import { useEffect, useState } from "react";
import type { AxiosResponse } from "axios";

import type { HelpSearchResult, SearchHelp200Response } from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";

const HELP_SEARCH_DEBOUNCE_MS = 250;

export interface UseHelpSearchReturn {
  results: HelpSearchResult[];
  isLoading: boolean;
  error: Error | null;
}

export function useHelpSearch(query: string): UseHelpSearchReturn {
  const [results, setResults] = useState<HelpSearchResult[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    const trimmedQuery = query.trim();

    if (!trimmedQuery) {
      setResults([]);
      setIsLoading(false);
      setError(null);
      return;
    }

    let isCurrentRequest = true;
    setIsLoading(true);
    setError(null);

    const timeoutId = window.setTimeout(() => {
      unifiedApiClient
        .searchHelp({ q: trimmedQuery })
        .then((response: AxiosResponse<SearchHelp200Response>) => {
          if (!isCurrentRequest) return;
          setResults(response.data.data?.results ?? []);
        })
        .catch((err: Error) => {
          if (!isCurrentRequest) return;
          setError(err);
          setResults([]);
        })
        .finally(() => {
          if (!isCurrentRequest) return;
          setIsLoading(false);
        });
    }, HELP_SEARCH_DEBOUNCE_MS);

    return () => {
      isCurrentRequest = false;
      window.clearTimeout(timeoutId);
    };
  }, [query]);

  return { results, isLoading, error };
}
