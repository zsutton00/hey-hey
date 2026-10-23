import { useCallback } from "react";
import { useQueryClient, type QueryKey } from "@tanstack/react-query";
import {
  type CreateInitiativeDto,
  type InitiativeResponseDto,
  type UpdateInitiativeDto,
  InitiativeCreatorType,
  Priority,
  WorkStatus,
} from "../../api";
import { platformClient } from "../../clients/serviceClients";
import { applySectionInputsToMaterialized } from "../../utils/workItemSections";
import { initiativeKeys } from "../collections/initiatives";
import type { MutationCallbacks } from "../core/types";
import {
  cancelEntityReads,
  changeCachedEntity,
  replaceListEntity,
} from "../query/optimisticEntityCache";
import { useRelationshipMutationInvalidation } from "./relationshipMutationInvalidation";

function applyInitiativeUpdate(
  current: InitiativeResponseDto,
  updates: UpdateInitiativeDto,
  updatedAt: string,
): InitiativeResponseDto {
  const { sections, ...rest } = updates;
  return {
    ...current,
    ...rest,
    sections: applySectionInputsToMaterialized(current.sections, sections),
    assigneeId: updates.assigneeId ?? current.assigneeId,
    updatedAt,
  };
}

export function useInitiativeUpdate(
  organizationId: string,
  projectId?: string,
) {
  const client = useQueryClient();
  const invalidateRelationships = useRelationshipMutationInvalidation();
  return useCallback(
    async (
      id: string,
      updates: UpdateInitiativeDto,
      callbacks?: MutationCallbacks<InitiativeResponseDto>,
    ) => {
      await cancelEntityReads<InitiativeResponseDto>(
        client,
        {
          lists: initiativeKeys.lists(organizationId),
          details: initiativeKeys.details(organizationId),
        },
        id,
        initiativeKeys.detail(organizationId, id),
      );
      const rollback = changeCachedEntity<InitiativeResponseDto>(
        client,
        {
          lists: initiativeKeys.lists(organizationId),
          details: initiativeKeys.details(organizationId),
        },
        id,
        (current) =>
          applyInitiativeUpdate(current, updates, new Date().toISOString()),
      );
      try {
        const response = await platformClient.updateInitiative({
          organizationId,
          initiativeId: id,
          updateInitiativeDto: updates,
        });
        const updated = response.data?.data;
        if (!updated)
          throw new Error("No data returned from update initiative");
        changeCachedEntity<InitiativeResponseDto>(
          client,
          {
            lists: initiativeKeys.lists(organizationId),
            details: initiativeKeys.details(organizationId),
          },
          id,
          () => updated,
        );
        client.setQueryData(initiativeKeys.detail(organizationId, id), updated);
        invalidateRelationships({
          entityType: "Initiative",
          operation: "update",
          sourceEntity: updated,
          organizationId,
          projectId,
        });
        callbacks?.onSuccess?.(updated);
        return updated;
      } catch (error) {
        rollback();
        callbacks?.onError?.(
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      } finally {
        callbacks?.onSettled?.();
      }
    },
    [client, organizationId, projectId, invalidateRelationships],
  );
}

function optimisticInitiative(
  input: CreateInitiativeDto,
  organizationId: string,
  projectId: string,
  id: string,
  now: string,
): InitiativeResponseDto {
  const { sections, ...rest } = input;
  return {
    ...rest,
    id,
    organizationId,
    originatingProjectId: projectId,
    sections: applySectionInputsToMaterialized(undefined, sections),
    status: input.status ?? WorkStatus.Backlog,
    priority: input.priority ?? Priority.Medium,
    creatorType: input.creatorType ?? InitiativeCreatorType.User,
    createdAt: now,
    updatedAt: now,
  };
}

export function useInitiativeCreate(
  organizationId: string,
  projectId: string,
  queryKey: QueryKey,
) {
  const client = useQueryClient();
  const invalidateRelationships = useRelationshipMutationInvalidation();
  return useCallback(
    async (
      input: CreateInitiativeDto,
      callbacks?: MutationCallbacks<InitiativeResponseDto>,
    ) => {
      const id = `temp-${crypto.randomUUID()}`;
      await client.cancelQueries({ queryKey, exact: true });
      client.setQueryData<InitiativeResponseDto[]>(queryKey, (items) => [
        ...(items ?? []),
        optimisticInitiative(
          input,
          organizationId,
          projectId,
          id,
          new Date().toISOString(),
        ),
      ]);
      try {
        const response = await platformClient.createInitiative({
          organizationId,
          createInitiativeDto: input,
        });
        const created = response.data?.data;
        if (!created)
          throw new Error("No data returned from create initiative");
        replaceListEntity(client, queryKey, id, created);
        client.setQueryData(
          initiativeKeys.detail(organizationId, created.id),
          created,
        );
        invalidateRelationships({
          entityType: "Initiative",
          operation: "create",
          sourceEntity: created,
          organizationId,
          projectId,
        });
        callbacks?.onSuccess?.(created);
        return created;
      } catch (error) {
        replaceListEntity(client, queryKey, id, null);
        callbacks?.onError?.(
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      } finally {
        callbacks?.onSettled?.();
      }
    },
    [client, queryKey, organizationId, projectId, invalidateRelationships],
  );
}

export function useInitiativeRemove(
  organizationId: string,
  projectId: string,
  queryKey: QueryKey,
) {
  const client = useQueryClient();
  const invalidateRelationships = useRelationshipMutationInvalidation();
  return useCallback(
    async (id: string, callbacks?: MutationCallbacks<void>) => {
      const item =
        client
          .getQueryData<InitiativeResponseDto[]>(queryKey)
          ?.find((item) => item.id === id) ??
        client.getQueryData<InitiativeResponseDto | null>(
          initiativeKeys.detail(organizationId, id),
        );
      if (!item) throw new Error("Initiative not found");
      await cancelEntityReads<InitiativeResponseDto>(
        client,
        {
          lists: initiativeKeys.lists(organizationId),
          details: initiativeKeys.details(organizationId),
        },
        id,
        initiativeKeys.detail(organizationId, id),
      );
      const rollback = changeCachedEntity<InitiativeResponseDto>(
        client,
        {
          lists: initiativeKeys.lists(organizationId),
          details: initiativeKeys.details(organizationId),
        },
        id,
        () => null,
      );
      try {
        await platformClient.removeInitiative({
          organizationId,
          initiativeId: id,
        });
        invalidateRelationships({
          entityType: "Initiative",
          operation: "delete",
          sourceEntity: item,
          organizationId,
          projectId,
        });
        callbacks?.onSuccess?.();
      } catch (error) {
        rollback();
        callbacks?.onError?.(
          error instanceof Error ? error : new Error(String(error)),
        );
        throw error;
      } finally {
        callbacks?.onSettled?.();
      }
    },
    [client, queryKey, organizationId, projectId, invalidateRelationships],
  );
}
