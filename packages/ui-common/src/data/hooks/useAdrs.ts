import { useMemo } from "react";
import type {
  CollectionHookOptions,
  DataCollectionHookReturn,
} from "../core/types";
import type { DesignDocResponseDto } from "../../api";
import {
  designDocToAdrContent,
  extractAdrMetadata,
  type AdrMetadata,
} from "../../utils/adrDesignDocConversion";
import type { AdrContent } from "../../types/adr";
import { useDesignDocs } from "./useDesignDocs";

export interface UseAdrsOptions extends CollectionHookOptions<DesignDocResponseDto> {
  status?: string;
  projectId?: string;
  tags?: string | string[];
  page?: number;
  limit?: number;
}

interface AdrData extends AdrMetadata {
  content: AdrContent;
}

export interface UseAdrsReturn extends Omit<
  DataCollectionHookReturn<DesignDocResponseDto>,
  "data"
> {
  adrs: AdrData[];
  data: AdrData[];
  designDocs: DesignDocResponseDto[];
}

/**
 * Hook to fetch a list of ADRs (DesignDocs with template="ADR")
 * Converts each DesignDoc sections format to flat AdrContent format
 */
export function useAdrs(
  organizationId: string | undefined,
  options: UseAdrsOptions = {},
): UseAdrsReturn {
  const query = useDesignDocs(organizationId, options);
  const designDocs = useMemo(
    () => query.designDocs.filter((doc) => doc.template === "ADR"),
    [query.designDocs],
  );

  // Convert each DesignDoc to ADR data structure
  const adrs = useMemo<AdrData[]>(() => {
    return designDocs.map((designDoc) => {
      const content = designDocToAdrContent(designDoc);
      const metadata = extractAdrMetadata(designDoc);

      return {
        ...metadata,
        content,
      };
    });
  }, [designDocs]);

  return {
    adrs,
    data: adrs,
    designDocs,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isFetched: query.isFetched,
    isReady: query.isFetched && !query.error,
    error: query.error,
    isStale: query.isStale,
    refetch: query.refetch as () => Promise<DesignDocResponseDto[] | null>,
    markStale: query.markStale,
  };
}
