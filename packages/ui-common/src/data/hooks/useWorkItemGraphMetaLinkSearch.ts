import { useEffect, useState } from "react";
import {
  AgentEdgeEndpointEntityType,
  EntityType,
  UnifiedEmbeddingsSearchOptionsQueryModeEnum,
  UnifiedSearchIntent,
  type UnifiedSearchRequest,
  type UnifiedSearchResult,
  type WorkItemChangeSetIdentity,
  type WorkItemTypeGraphSearchableMetaLinkTarget,
} from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";

const DEFAULT_RESULT_LIMIT = 20;
const EMBEDDINGS_REQUIRED_STRATEGY = "embeddingsRequired" as const;

type ExistingWorkItemIdentity = Extract<
  WorkItemChangeSetIdentity,
  { refType: "existing" }
>;

export interface WorkItemGraphMetaLinkTarget {
  identity: ExistingWorkItemIdentity;
  entityType: typeof EntityType.Task;
  workItemTypeKey: string;
  title: string;
}

export type WorkItemGraphMetaLinkSearchIdleReason =
  | "missing-context"
  | "empty-query"
  | "no-searchable-targets";

interface WorkItemGraphMetaLinkSearchStateBase {
  results: WorkItemGraphMetaLinkTarget[];
  isLoading: boolean;
  isSelectable: boolean;
  error: Error | null;
}

export type WorkItemGraphMetaLinkSearchState =
  | (WorkItemGraphMetaLinkSearchStateBase & {
      status: "idle";
      reason: WorkItemGraphMetaLinkSearchIdleReason;
      isLoading: false;
      isSelectable: false;
      error: null;
    })
  | (WorkItemGraphMetaLinkSearchStateBase & {
      status: "loading";
      isLoading: true;
      isSelectable: false;
      error: null;
    })
  | (WorkItemGraphMetaLinkSearchStateBase & {
      status: "success";
      isLoading: false;
      isSelectable: true;
      error: null;
    })
  | (WorkItemGraphMetaLinkSearchStateBase & {
      status: "empty";
      isLoading: false;
      isSelectable: false;
      error: null;
    })
  | (WorkItemGraphMetaLinkSearchStateBase & {
      status: "error";
      isLoading: false;
      isSelectable: false;
      error: Error;
    });

export interface UseWorkItemGraphMetaLinkSearchInput {
  organizationId: string | null;
  projectId: string | null;
  sourceChild: WorkItemChangeSetIdentity | null;
  searchTarget: WorkItemTypeGraphSearchableMetaLinkTarget | null;
  query: string;
  limit?: number;
}

function idleState(
  reason: WorkItemGraphMetaLinkSearchIdleReason
): WorkItemGraphMetaLinkSearchState {
  return {
    status: "idle",
    reason,
    results: [],
    isLoading: false,
    isSelectable: false,
    error: null,
  };
}

const LOADING_STATE: WorkItemGraphMetaLinkSearchState = {
  status: "loading",
  results: [],
  isLoading: true,
  isSelectable: false,
  error: null,
};

function normalizeTypeKeys(typeKeys: readonly string[] | undefined): string[] {
  return Array.from(
    new Set(
      (typeKeys ?? [])
        .map((typeKey) => typeKey.trim())
        .filter((typeKey) => typeKey.length > 0)
    )
  );
}

function extractWorkItemTypeKey(result: UnifiedSearchResult): string | null {
  const metadata = result.embeddings?.metadata;
  if (!metadata || !("taskType" in metadata)) return null;
  return typeof metadata.taskType === "string" && metadata.taskType.trim()
    ? metadata.taskType.trim()
    : null;
}

function mapAllowedResults(
  results: readonly UnifiedSearchResult[],
  allowedWorkItemTypeKeys: ReadonlySet<string>,
  sourceChildId: string | null
): WorkItemGraphMetaLinkTarget[] {
  const deduplicated = new Map<string, WorkItemGraphMetaLinkTarget>();

  for (const result of results) {
    const entityId = result.entityId?.trim();
    const title = result.title?.trim();
    const workItemTypeKey = extractWorkItemTypeKey(result);

    if (
      result.entityType !== EntityType.Task ||
      !entityId ||
      entityId === sourceChildId ||
      !title ||
      !workItemTypeKey ||
      (allowedWorkItemTypeKeys.size > 0 &&
        !allowedWorkItemTypeKeys.has(workItemTypeKey))
    ) {
      continue;
    }

    if (!deduplicated.has(entityId)) {
      deduplicated.set(entityId, {
        identity: { refType: "existing", id: entityId },
        entityType: EntityType.Task,
        workItemTypeKey,
        title,
      });
    }
  }

  return Array.from(deduplicated.values());
}

function toError(error: unknown): Error {
  return error instanceof Error
    ? error
    : new Error("Meta-link target search failed.");
}

function buildRequest(
  query: string,
  targetWorkItemTypeKeys: string[],
  limit: number
): UnifiedSearchRequest {
  return {
    intent: UnifiedSearchIntent.Hybrid,
    query,
    common: {
      types: [EntityType.Task],
      ...(targetWorkItemTypeKeys.length > 0
        ? { taskTypes: targetWorkItemTypeKeys }
        : {}),
    },
    graph: { size: limit },
    embeddings: {
      maxResults: limit,
      queryMode: UnifiedEmbeddingsSearchOptionsQueryModeEnum.TitleFuzzy,
      hybridResultStrategy: EMBEDDINGS_REQUIRED_STRATEGY,
    },
  };
}

export function useWorkItemGraphMetaLinkSearch({
  organizationId,
  projectId,
  sourceChild,
  searchTarget,
  query,
  limit = DEFAULT_RESULT_LIMIT,
}: UseWorkItemGraphMetaLinkSearchInput): WorkItemGraphMetaLinkSearchState {
  const trimmedOrganizationId = organizationId?.trim() ?? "";
  const trimmedProjectId = projectId?.trim() ?? "";
  const trimmedQuery = query.trim();
  const targetTypesKey = normalizeTypeKeys(
    searchTarget?.targetWorkItemTypeKeys
  ).join("\u0000");
  const relationshipEdgeType = searchTarget?.edgeType ?? null;
  const targetEntityTypesKey =
    searchTarget?.targetEntityTypes.join("\u0000") ?? "";
  const includesTaskTargets =
    searchTarget?.targetEntityTypes.includes(
      AgentEdgeEndpointEntityType.Task
    ) ?? false;
  const hasSourceChild = sourceChild !== null;
  const hasSearchTarget = searchTarget !== null;
  const sourceChildId =
    sourceChild?.refType === "existing" ? sourceChild.id : null;
  const sourceChildKey = sourceChild
    ? sourceChild.refType === "existing"
      ? `existing:${sourceChild.id}`
      : `temporary:${sourceChild.tempId}`
    : null;
  const boundedLimit =
    Number.isFinite(limit) && limit > 0
      ? Math.min(Math.floor(limit), DEFAULT_RESULT_LIMIT)
      : DEFAULT_RESULT_LIMIT;
  const [state, setState] = useState<WorkItemGraphMetaLinkSearchState>(() =>
    idleState("missing-context")
  );

  useEffect(() => {
    if (
      !trimmedOrganizationId ||
      !trimmedProjectId ||
      !hasSourceChild ||
      !hasSearchTarget
    ) {
      setState(idleState("missing-context"));
      return;
    }
    if (!trimmedQuery) {
      setState(idleState("empty-query"));
      return;
    }
    if (!includesTaskTargets) {
      setState(idleState("no-searchable-targets"));
      return;
    }

    let isCurrentRequest = true;
    const targetWorkItemTypeKeys = targetTypesKey
      ? targetTypesKey.split("\u0000")
      : [];
    const allowedWorkItemTypeKeys = new Set(targetWorkItemTypeKeys);
    setState(LOADING_STATE);

    unifiedApiClient
      .unifiedSearch({
        organizationId: trimmedOrganizationId,
        projectId: trimmedProjectId,
        unifiedSearchRequest: buildRequest(
          trimmedQuery,
          targetWorkItemTypeKeys,
          boundedLimit
        ),
      })
      .then((response) => {
        if (!isCurrentRequest) return;
        const results = mapAllowedResults(
          response.data?.data?.results ?? [],
          allowedWorkItemTypeKeys,
          sourceChildId
        );
        setState(
          results.length > 0
            ? {
                status: "success",
                results,
                isLoading: false,
                isSelectable: true,
                error: null,
              }
            : {
                status: "empty",
                results: [],
                isLoading: false,
                isSelectable: false,
                error: null,
              }
        );
      })
      .catch((error: unknown) => {
        if (!isCurrentRequest) return;
        setState({
          status: "error",
          results: [],
          isLoading: false,
          isSelectable: false,
          error: toError(error),
        });
      });

    return () => {
      isCurrentRequest = false;
    };
  }, [
    boundedLimit,
    hasSearchTarget,
    hasSourceChild,
    includesTaskTargets,
    relationshipEdgeType,
    sourceChildId,
    sourceChildKey,
    targetEntityTypesKey,
    targetTypesKey,
    trimmedOrganizationId,
    trimmedProjectId,
    trimmedQuery,
  ]);

  return state;
}
