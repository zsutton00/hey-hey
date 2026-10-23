import { useMemo } from "react";
import { type MaterializedDesignDocSection } from "../../api";
import { useDesignDoc } from "../../data/hooks/useDesignDoc";
import { useDesignDocs } from "../../data/hooks/useDesignDocs";
import { getErrorMessage } from "../../utils/errorUtils";

export interface PlanFromDesignDocSeed {
  title: string;
  summary?: string | null;
  sections: Pick<
    MaterializedDesignDocSection,
    "key" | "materializedMarkdown"
  >[];
}

export interface UsePlanFromDesignDocSeedReturn {
  seed: PlanFromDesignDocSeed | null;
  /**
   * The id of the DESIGN_DOC the plan derives from, resolved from the plan's
   * relationships. Drives the "Edit design doc" affordance on the pre-start
   * placeholder; undefined when the plan has no design-doc relationship.
   */
  designDocId: string | undefined;
  isLoading: boolean;
  error: unknown;
  retry: () => Promise<void>;
}

export interface UsePlanFromDesignDocSeedOptions {
  enabled?: boolean;
}

/**
 * Resolves the seed design doc a plan-from-design-doc run shapes into stages.
 *
 * No conversation or plan field carries the seed once the in-workflow
 * DESIGN_DOC_REVIEW node is gone, so the pre-start placeholder sources it
 * client-side: the plan's relationships name the DESIGN_DOC it derives from,
 * and the design doc's materialized sections are passed through to the shared
 * read surface. Loading/error are surfaced so the placeholder can show progress
 * while the doc loads rather than flashing an empty body.
 */
export function usePlanFromDesignDocSeed(
  organizationId: string | undefined,
  projectId: string | undefined,
  planId: string | undefined,
  options: UsePlanFromDesignDocSeedOptions = {}
): UsePlanFromDesignDocSeedReturn {
  const { enabled = true } = options;
  const documents = useDesignDocs(organizationId, {
    projectId,
    taskId: planId,
    enabled,
  });
  const canonicalDocument = useMemo(
    () =>
      [...documents.designDocs].sort(
        (a, b) =>
          b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)
      )[0],
    [documents.designDocs]
  );

  const loadLinked =
    enabled && documents.isFetched && !documents.error && !canonicalDocument;
  // The document query accepts migrated links without requiring a legacy Plan
  // row. The legacy /plans/:id/relationships endpoint rejects work-item Plans.
  const linkedDocuments = useDesignDocs(organizationId, {
    projectId,
    planId,
    enabled: loadLinked,
  });

  const designDocId = useMemo(
    () =>
      canonicalDocument?.id ??
      (loadLinked
        ? [...linkedDocuments.designDocs].sort(
            (a, b) =>
              b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id)
          )[0]?.id
        : undefined),
    [canonicalDocument, linkedDocuments.designDocs, loadLinked]
  );

  const {
    data: designDoc,
    isLoading: designDocLoading,
    error: designDocError,
    isFetched: designDocFetched,
    isFetching: designDocFetching,
    refetch: refetchDesignDoc,
  } = useDesignDoc(organizationId, designDocId, {
    enabled: enabled && !!designDocId,
  });

  const seed = useMemo<PlanFromDesignDocSeed | null>(() => {
    if (!designDoc) {
      return null;
    }
    return {
      title: designDoc.name,
      summary: designDoc.summary,
      sections: (designDoc.sections ?? [])
        .slice()
        .sort((a, b) => a.order - b.order),
    };
  }, [designDoc]);

  // Loading while the relationship resolves, then while the design doc it
  // points at is fetched. A plan with no DESIGN_DOC relationship resolves to
  // seed=null without hanging in a perpetual loading state.
  const isLoading =
    enabled &&
    ((!documents.error && !documents.isFetched) ||
      documents.isLoading ||
      (loadLinked &&
        ((!linkedDocuments.error && !linkedDocuments.isFetched) ||
          linkedDocuments.isLoading ||
          linkedDocuments.isFetching)) ||
      (!!designDocId &&
        !designDoc &&
        ((!designDocError && !designDocFetched) ||
          designDocLoading ||
          designDocFetching)));

  const error = documents.error
    ? new Error(
        `Unable to find this Plan’s design doc: ${getErrorMessage(
          documents.error,
          "Document lookup failed."
        )}`
      )
    : loadLinked && linkedDocuments.error
    ? new Error(
        `Unable to find this Plan’s linked design doc: ${getErrorMessage(
          linkedDocuments.error,
          "Linked document lookup failed."
        )}`
      )
    : designDocId && designDocError
    ? new Error(
        `Unable to load this Plan’s design doc: ${getErrorMessage(
          designDocError,
          "Document request failed."
        )}`
      )
    : null;

  const retry = async () => {
    try {
      if (documents.error || (!designDocId && !loadLinked))
        await documents.refetch();
      else if (loadLinked && (linkedDocuments.error || !designDocId))
        await linkedDocuments.refetch();
      else await refetchDesignDoc();
    } catch {
      // The query retains the request error; the next render displays it.
    }
  };

  return {
    seed,
    designDocId,
    isLoading,
    error,
    retry,
  };
}
