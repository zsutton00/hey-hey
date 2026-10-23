import { useCallback } from "react";
import {
  EntityType,
  UnifiedEmbeddingsSearchOptionsQueryModeEnum,
  UnifiedSearchIntent,
  type UnifiedSearchCommonFilters,
  type UnifiedSearchRequest,
  type UnifiedSearchResult,
} from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import {
  DIAGRAM_ELEMENT_TASK_TYPE,
  DIAGRAM_TASK_TYPE,
  FEATURE_TASK_TYPE,
  WORKFLOW_STEP_TASK_TYPE,
  WORKFLOW_TASK_TYPE,
} from "../../constants/taskTypes";
import { normalizeEntityType } from "../../components/entityTypeUtils";
import type {
  EntitySearchScope,
  SearchEntity,
} from "../../components/SmarterTextAreaCard/types";

const DEFAULT_ENTITY_TYPES = [
  "task",
  "workflow",
  "initiative",
  "design_doc",
  "project",
  "service",
  "agent_session",
] as const;

const DEFAULT_LIMIT = 20;
const CONVERSATION_RELATED_STRATEGY = "conversationRelated" as const;
const EMBEDDINGS_REQUIRED_STRATEGY = "embeddingsRequired" as const;
const DEFAULT_SEARCH_SCOPE: EntitySearchScope = {
  kind: "entity-types",
  entityTypes: [...DEFAULT_ENTITY_TYPES],
};

const toMentionEntityType = (entityType: EntityType | undefined): string => {
  switch (entityType) {
    case EntityType.DesignDoc:
      return "design_doc";
    case EntityType.AgentSession:
      return "agent_session";
    default:
      return entityType ? entityType.toLowerCase() : "unknown";
  }
};

const extractTaskTypeDiscriminator = (
  result: UnifiedSearchResult
): string | undefined => {
  const metadata = result.embeddings?.metadata;
  if (
    metadata &&
    "taskType" in metadata &&
    typeof metadata.taskType === "string"
  ) {
    return metadata.taskType;
  }
  return undefined;
};

const resolveMentionType = (result: UnifiedSearchResult): string => {
  if (result.entityType === EntityType.Task) {
    switch (extractTaskTypeDiscriminator(result)) {
      case FEATURE_TASK_TYPE:
        return "feature";
      case "WORKFLOW":
      case WORKFLOW_TASK_TYPE:
      case DIAGRAM_TASK_TYPE:
        return "diagram";
      case "WORKFLOW_STEP":
      case WORKFLOW_STEP_TASK_TYPE:
      case DIAGRAM_ELEMENT_TASK_TYPE:
        return "diagram_element";
      default:
        break;
    }
  }
  return toMentionEntityType(result.entityType);
};

const normalizeEntityTypes = (entityTypes: string[]): EntityType[] =>
  entityTypes.flatMap((entityType) => {
    const normalized = normalizeEntityType(entityType);
    return normalized ? [normalized] : [];
  });

const normalizeTaskTypes = (taskTypes: string[]): string[] =>
  taskTypes.map((taskType) => taskType.trim()).filter(Boolean);

export const buildUnifiedSearchCommonFilters = (
  searchScope: EntitySearchScope
): UnifiedSearchCommonFilters | undefined => {
  switch (searchScope.kind) {
    case "entity-types": {
      const types = normalizeEntityTypes(searchScope.entityTypes);
      return types.length > 0 ? { types } : undefined;
    }
    case "work-item-types": {
      const taskTypes = normalizeTaskTypes(searchScope.taskTypes);
      return taskTypes.length > 0
        ? { types: [EntityType.Task], taskTypes }
        : undefined;
    }
  }
};

export const mapResultToSearchEntity = (
  result: UnifiedSearchResult
): SearchEntity | null => {
  if (!result.entityId || !result.entityType) {
    return null;
  }

  const taskType = extractTaskTypeDiscriminator(result);
  return {
    id: result.entityId,
    type: resolveMentionType(result),
    name: result.title || result.entityId,
    description: result.topologySummary || result.content,
    status: result.status,
    similarity: result.score,
    ...(taskType ? { metadata: { taskType } } : {}),
  };
};

export const useMentionEntitySearch = (
  organizationId: string | null,
  projectId: string | null,
  conversationId: string | null
) => {
  const searchEntities = useCallback(
    async (
      query: string,
      searchScope: EntitySearchScope = DEFAULT_SEARCH_SCOPE
    ): Promise<SearchEntity[]> => {
      if (!organizationId || !projectId || !query.trim()) {
        return [];
      }

      const common = buildUnifiedSearchCommonFilters(searchScope);
      const request: UnifiedSearchRequest = {
        intent: UnifiedSearchIntent.Hybrid,
        query,
        conversationId: conversationId ?? undefined,
        common,
        graph: {
          seedEntityIdsStrategy: conversationId
            ? CONVERSATION_RELATED_STRATEGY
            : undefined,
          size: DEFAULT_LIMIT,
        },
        embeddings: {
          maxResults: DEFAULT_LIMIT,
          queryMode: UnifiedEmbeddingsSearchOptionsQueryModeEnum.TitleFuzzy,
          hybridResultStrategy: EMBEDDINGS_REQUIRED_STRATEGY,
        },
      };

      try {
        const response = await unifiedApiClient.unifiedSearch({
          organizationId: organizationId,
          projectId: projectId,
          unifiedSearchRequest: request,
        });
        const results = response.data?.data?.results || [];
        const deduped = new Map<string, SearchEntity>();

        for (const result of results) {
          const mappedResult = mapResultToSearchEntity(result);
          if (!mappedResult) {
            continue;
          }
          deduped.set(mappedResult.id, mappedResult);
        }

        return Array.from(deduped.values());
      } catch (error: unknown) {
        console.error("Mention unified search failed:", error);
        return [];
      }
    },
    [conversationId, organizationId, projectId]
  );

  return { searchEntities };
};
