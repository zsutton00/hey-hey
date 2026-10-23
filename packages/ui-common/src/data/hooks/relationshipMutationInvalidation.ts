import { useMemo } from "react";
import {
  useQueryClient,
  type InvalidateQueryFilters,
  type QueryKey as TanStackQueryKey,
} from "@tanstack/react-query";
import {
  invalidateInitiativeChange,
  invalidateProjectWorkItemQueries,
} from "../query/dataLayerInvalidation";
import { invalidateWithFollowUpRead } from "../query/invalidateWithFollowUpRead";
import type { EntityOperation } from "../relationships";
import {
  getLoadedConfig,
  invalidateForEntity,
  type InvalidationContext,
} from "../relationships";
import { createInitiativeInvalidator } from "../collections/initiatives";
import { createWorkItemInvalidator } from "../collections/workItemLists";
import { createDesignDocInvalidator } from "../collections/designDocs";
import { createServiceInvalidator } from "../collections/services";
import { logger } from "../../utils/logger";

type RelationshipSourceEntity = object & {
  id?: string | null;
  organizationId?: string | null;
  projectId?: string | null;
  originatingProjectId?: string | null;
};

interface RelationshipMutationInvalidationInput<
  TSourceEntity extends RelationshipSourceEntity = RelationshipSourceEntity,
> {
  entityType: string;
  operation: EntityOperation;
  sourceEntity?: TSourceEntity;
  organizationId?: string;
  projectId?: string;
}

export interface RelationshipMutationInvalidationDispatches {
  /** Invalidates a TanStack key prefix (services are on TanStack Query). */
  invalidateQueryKey: (queryKey: TanStackQueryKey) => void;
  /** Invalidates TanStack queries matching a filter (work items). */
  invalidateQueries: (filters: InvalidateQueryFilters) => void;
  /** Central initiative invalidation also runs without relationship config. */
  invalidateInitiativeChange: (
    organizationId: string,
    projectId: string | undefined,
    initiativeId: string | undefined,
  ) => void;
  /**
   * Central work-item invalidation for a Task change; when present, the Task
   * relationship context skips the list scopes it already covers.
   */
  invalidateWorkItemChange?: (
    organizationId: string,
    projectId: string | undefined,
    taskId: string | undefined,
  ) => void;
}

export type RelationshipMutationInvalidator = <
  TSourceEntity extends RelationshipSourceEntity,
>(
  input: RelationshipMutationInvalidationInput<TSourceEntity>,
) => void;

const stringValue = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const sourceToRecord = <TSourceEntity extends object>(
  sourceEntity: TSourceEntity | undefined,
): Record<string, unknown> | undefined => {
  if (!sourceEntity) {
    return undefined;
  }

  const record: Record<string, unknown> = {};
  for (const key of Object.keys(sourceEntity) as Array<
    keyof TSourceEntity & string
  >) {
    record[key] = sourceEntity[key];
  }
  return record;
};

const resolveOrganizationId = (
  sourceEntity: Record<string, unknown> | undefined,
  fallbackOrganizationId: string | undefined,
): string | undefined =>
  stringValue(sourceEntity?.organizationId) ??
  stringValue(fallbackOrganizationId);

const resolveProjectId = (
  sourceEntity: Record<string, unknown> | undefined,
  fallbackProjectId: string | undefined,
): string | undefined =>
  stringValue(sourceEntity?.projectId) ??
  stringValue(sourceEntity?.originatingProjectId) ??
  stringValue(fallbackProjectId);

function createInvalidationContext(
  dispatches: RelationshipMutationInvalidationDispatches,
  organizationId: string,
  projectId: string | undefined,
  listsInvalidated: boolean,
  initiativesInvalidated: boolean,
  initiativeId: string | undefined,
): InvalidationContext {
  return {
    Initiative: createInitiativeInvalidator(
      organizationId,
      projectId,
      dispatches.invalidateQueries,
      initiativesInvalidated ? { projectId, initiativeId } : undefined,
    ),
    Task: createWorkItemInvalidator(
      organizationId,
      projectId,
      dispatches.invalidateQueries,
      { listsInvalidated },
    ),
    DesignDoc: createDesignDocInvalidator(
      organizationId,
      projectId,
      dispatches.invalidateQueries,
    ),
    Service: createServiceInvalidator(
      organizationId,
      dispatches.invalidateQueryKey,
    ),
  };
}

export function createRelationshipMutationInvalidator(
  dispatches: RelationshipMutationInvalidationDispatches,
): RelationshipMutationInvalidator {
  return (input) => {
    const sourceEntity = sourceToRecord(input.sourceEntity);
    const organizationId = resolveOrganizationId(
      sourceEntity,
      input.organizationId,
    );
    const projectId = resolveProjectId(sourceEntity, input.projectId);
    // A Task change invalidates its project's work-item reads, references and
    // feature content centrally, with or without relationship config; the
    // config only adds cascades.
    const isTaskChange =
      input.entityType === "Task" && !!dispatches.invalidateWorkItemChange;
    if (isTaskChange && organizationId) {
      dispatches.invalidateWorkItemChange?.(
        organizationId,
        projectId,
        stringValue(sourceEntity?.id),
      );
    }

    const isInitiativeChange = input.entityType === "Initiative";
    if (isInitiativeChange && organizationId) {
      dispatches.invalidateInitiativeChange(
        organizationId,
        projectId,
        stringValue(sourceEntity?.id),
      );
    }

    if (getLoadedConfig() === null) {
      logger.warn(
        "data_hooks",
        "[relationshipMutationInvalidation] Skipping: relationship config not loaded",
        { entityType: input.entityType, operation: input.operation },
      );
      return;
    }

    if (!organizationId) {
      logger.warn(
        "data_hooks",
        "[relationshipMutationInvalidation] Skipping: missing organizationId",
        { entityType: input.entityType, operation: input.operation },
      );
      return;
    }

    const context = createInvalidationContext(
      dispatches,
      organizationId,
      projectId,
      isTaskChange,
      isInitiativeChange,
      stringValue(sourceEntity?.id),
    );

    try {
      invalidateForEntity(
        input.entityType,
        input.operation,
        sourceEntity,
        context,
      );
    } catch (error) {
      logger.warn(
        "data_hooks",
        "[relationshipMutationInvalidation] invalidateForEntity threw; skipping",
        {
          entityType: input.entityType,
          operation: input.operation,
          error: error instanceof Error ? error.message : String(error),
        },
      );
    }
  };
}

export function useRelationshipMutationInvalidation(): RelationshipMutationInvalidator {
  const queryClient = useQueryClient();

  return useMemo(
    () =>
      createRelationshipMutationInvalidator({
        invalidateInitiativeChange: (
          organizationId,
          projectId,
          initiativeId,
        ) => {
          void invalidateInitiativeChange(
            queryClient,
            organizationId,
            projectId,
            initiativeId,
          );
        },
        invalidateQueryKey: (queryKey) => {
          void queryClient.invalidateQueries({ queryKey });
        },
        invalidateQueries: (filters) => {
          void invalidateWithFollowUpRead(queryClient, filters);
        },
        invalidateWorkItemChange: (organizationId, projectId, taskId) => {
          void invalidateProjectWorkItemQueries(
            queryClient,
            organizationId,
            projectId,
            taskId,
          );
        },
      }),
    [queryClient],
  );
}
