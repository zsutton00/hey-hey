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
import { useDesignDoc } from "./useDesignDoc";

export type UseAdrOptions = CollectionHookOptions<DesignDocResponseDto>;

interface AdrData extends AdrMetadata {
  content: AdrContent;
}

export interface UseAdrReturn extends Omit<
  DataCollectionHookReturn<DesignDocResponseDto>,
  "data" | "refetch"
> {
  adr: AdrData | null;
  data: AdrData | null;
  designDoc: DesignDocResponseDto | null;
  refetch: () => Promise<DesignDocResponseDto | null>;
}

/**
 * Hook to fetch a single ADR (which is a DesignDoc with template="ADR")
 * Converts the DesignDoc sections format to flat AdrContent format
 */
export function useAdr(
  organizationId: string | undefined,
  adrId: string | undefined,
  options: UseAdrOptions = {},
): UseAdrReturn {
  const query = useDesignDoc(organizationId, adrId, options);
  const designDoc = query.data;

  // Convert DesignDoc to ADR data structure
  const adr = useMemo<AdrData | null>(() => {
    if (!designDoc) {
      return null;
    }

    // Convert sections to flat content structure
    const content = designDocToAdrContent(designDoc);
    const metadata = extractAdrMetadata(designDoc);

    return {
      ...metadata,
      content,
    };
  }, [designDoc]);

  return {
    adr,
    data: adr,
    designDoc,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isFetched: query.isFetched,
    isReady: query.isFetched && !query.error,
    error: query.error,
    isStale: query.isStale,
    refetch: query.refetch as () => Promise<DesignDocResponseDto | null>,
    markStale: query.markStale,
  };
}
