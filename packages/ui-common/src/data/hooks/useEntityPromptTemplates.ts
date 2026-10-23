import { useQueryClient } from "@tanstack/react-query";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
import { useCallback, useEffect, useRef } from "react";
import {
  EntityPromptTemplateRetireUpdatesPayloadOperationEnum,
  EntityPromptTemplateUpsertUpdatesPayloadOperationEnum,
  ProposalAction,
  ProposalStatus,
  ProposalType,
  TargetEntityType,
  type CreateProposalRequestDto,
  type EntityPromptTemplateCatalogDto,
  type EntityPromptTemplateCatalogEntryDto,
  type EntityPromptTemplateEffectiveDto,
  type EntityPromptTemplateExpectedEffectiveRevisionDto,
  type EntityPromptTemplateRetireUpdatesPayload,
  type EntityPromptTemplateSyntaxVersion,
  type EntityPromptTemplateUpsertUpdatesPayload,
  type ProposalResponseDto,
} from "../../api";
import { proposalsClient } from "../../clients/serviceClients";
import {
  entityPromptTemplateCatalogQueryOptions,
  entityPromptTemplateEffectiveQueryOptions,
  refetchEntityPromptTemplateProjections,
  type EntityPromptTemplateCatalogIdentity,
  type EntityPromptTemplateProjectionIdentity,
} from "../collections/entityPromptTemplates";
import type {
  CollectionHookOptions,
  DataCollectionHookReturn,
  DataHookReturn,
} from "../core/types";
import type { MutationOptions } from "../core/useMutation";
import { useMutation } from "../core/useMutation";
import { useProposal, type UseProposalReturn } from "./useProposal";

const DISABLED_IDENTITY: EntityPromptTemplateProjectionIdentity = {
  organizationId: "__noop__",
  projectId: "__noop__",
  templateKey: "noop",
  selector: { entityType: "PROJECT" },
};

const DISABLED_CATALOG_IDENTITY: EntityPromptTemplateCatalogIdentity = {
  organizationId: "__noop__",
  projectId: "__noop__",
};

const assertRequiredValue = (value: string, name: string): void => {
  if (value.trim().length === 0) {
    throw new Error(`${name} is required`);
  }
};

const assertProjectionIdentity = (
  identity: EntityPromptTemplateProjectionIdentity,
): void => {
  assertRequiredValue(identity.organizationId, "Organization ID");
  assertRequiredValue(identity.projectId, "Project ID");
  assertRequiredValue(identity.templateKey, "Template key");
  if (identity.selector.entityType === "WORK_ITEM") {
    assertRequiredValue(
      identity.selector.workItemTypeKey,
      "Work Item type key",
    );
  }
};

const assertCreatedProposal = (
  proposal: ProposalResponseDto | null | undefined,
): ProposalResponseDto => {
  if (!proposal) {
    throw new Error(
      "No proposal returned from entity prompt-template endpoint",
    );
  }
  return proposal;
};

const createTemplateProposal = async (
  identity: EntityPromptTemplateProjectionIdentity,
  createProposalRequestDto: CreateProposalRequestDto,
): Promise<ProposalResponseDto> => {
  assertProjectionIdentity(identity);
  const response = await proposalsClient.createProposal({
    organizationId: identity.organizationId,
    projectId: identity.projectId,
    createProposalRequestDto,
  });
  return assertCreatedProposal(response.data?.data);
};

export interface CreateEntityPromptTemplateChangeProposalVariables extends EntityPromptTemplateProjectionIdentity {
  eli5: string;
  syntaxVersion: EntityPromptTemplateSyntaxVersion;
  content: string;
  expectedEffectiveRevision: EntityPromptTemplateExpectedEffectiveRevisionDto;
}

export type UseCreateEntityPromptTemplateChangeProposalOptions =
  MutationOptions<ProposalResponseDto>;

export function useCreateEntityPromptTemplateChangeProposal(
  options: UseCreateEntityPromptTemplateChangeProposalOptions = {},
) {
  const mutationFn = useCallback(
    async ({
      organizationId,
      projectId,
      templateKey,
      selector,
      eli5,
      syntaxVersion,
      content,
      expectedEffectiveRevision,
    }: CreateEntityPromptTemplateChangeProposalVariables): Promise<ProposalResponseDto> => {
      assertRequiredValue(content, "Template content");
      const identity = { organizationId, projectId, templateKey, selector };
      const updates: EntityPromptTemplateUpsertUpdatesPayload = {
        operation: EntityPromptTemplateUpsertUpdatesPayloadOperationEnum.Upsert,
        projectId,
        selector,
        syntaxVersion,
        content,
        expectedEffectiveRevision,
      };

      return createTemplateProposal(identity, {
        type: ProposalType.Single,
        action: ProposalAction.Update,
        eli5,
        targetEntityId: templateKey,
        targetEntityType: TargetEntityType.EntityPromptTemplate,
        updates,
      });
    },
    [],
  );

  return useMutation(mutationFn, options);
}

export interface CreateEntityPromptTemplateRetirementProposalVariables extends EntityPromptTemplateProjectionIdentity {
  eli5: string;
  expectedEffectiveRevision: EntityPromptTemplateExpectedEffectiveRevisionDto;
}

export type UseCreateEntityPromptTemplateRetirementProposalOptions =
  MutationOptions<ProposalResponseDto>;

export function useCreateEntityPromptTemplateRetirementProposal(
  options: UseCreateEntityPromptTemplateRetirementProposalOptions = {},
) {
  const mutationFn = useCallback(
    async ({
      organizationId,
      projectId,
      templateKey,
      selector,
      eli5,
      expectedEffectiveRevision,
    }: CreateEntityPromptTemplateRetirementProposalVariables): Promise<ProposalResponseDto> => {
      const identity = { organizationId, projectId, templateKey, selector };
      const updates: EntityPromptTemplateRetireUpdatesPayload = {
        operation: EntityPromptTemplateRetireUpdatesPayloadOperationEnum.Retire,
        projectId,
        selector,
        expectedEffectiveRevision,
      };

      return createTemplateProposal(identity, {
        type: ProposalType.Single,
        action: ProposalAction.Delete,
        eli5,
        targetEntityId: templateKey,
        targetEntityType: TargetEntityType.EntityPromptTemplate,
        updates,
      });
    },
    [],
  );

  return useMutation(mutationFn, options);
}

export type UseEntityPromptTemplateProposalReturn = UseProposalReturn;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const proposalMatchesProjectionIdentity = (
  proposal: ProposalResponseDto,
  identity: EntityPromptTemplateProjectionIdentity,
): boolean => {
  if (
    proposal.organizationId !== identity.organizationId ||
    proposal.projectId !== identity.projectId ||
    proposal.targetEntityType !== TargetEntityType.EntityPromptTemplate ||
    proposal.targetEntityId !== identity.templateKey
  ) {
    return false;
  }

  const expectedOperation =
    proposal.action === ProposalAction.Update
      ? EntityPromptTemplateUpsertUpdatesPayloadOperationEnum.Upsert
      : proposal.action === ProposalAction.Delete
        ? EntityPromptTemplateRetireUpdatesPayloadOperationEnum.Retire
        : null;
  const updates: unknown = proposal.updates;
  if (
    !expectedOperation ||
    !isRecord(updates) ||
    updates.operation !== expectedOperation ||
    updates.projectId !== identity.projectId ||
    !isRecord(updates.selector) ||
    updates.selector.entityType !== identity.selector.entityType
  ) {
    return false;
  }

  return (
    identity.selector.entityType !== "WORK_ITEM" ||
    updates.selector.workItemTypeKey === identity.selector.workItemTypeKey
  );
};

export function useEntityPromptTemplateProposal(
  createdProposal: ProposalResponseDto | null | undefined,
  identity: EntityPromptTemplateProjectionIdentity | null | undefined,
  options: CollectionHookOptions<ProposalResponseDto> = {},
): UseEntityPromptTemplateProposalReturn {
  const proposal = useProposal(
    createdProposal?.organizationId,
    createdProposal?.projectId,
    createdProposal?.id,
    options,
  );
  const queryClient = useQueryClient();
  const refreshedApprovalRef = useRef<string | null>(null);

  useEffect(() => {
    const current = proposal.proposal;
    if (
      !identity ||
      current?.status !== ProposalStatus.Approved ||
      !proposalMatchesProjectionIdentity(current, identity)
    ) {
      return;
    }

    const approvalVersion = `${current.id}:${current.updatedAt}`;
    if (refreshedApprovalRef.current === approvalVersion) {
      return;
    }
    refreshedApprovalRef.current = approvalVersion;

    void refetchEntityPromptTemplateProjections(queryClient, identity).catch(
      () => {
        refreshedApprovalRef.current = null;
      },
    );
  }, [queryClient, identity, proposal.proposal]);

  return proposal;
}

export type UseEntityPromptTemplateCatalogOptions =
  CollectionHookOptions<EntityPromptTemplateCatalogEntryDto>;

export interface UseEntityPromptTemplateCatalogReturn extends DataCollectionHookReturn<EntityPromptTemplateCatalogEntryDto> {
  catalog: Pick<
    EntityPromptTemplateCatalogDto,
    "projectId" | "templates"
  > | null;
}

export function useEntityPromptTemplateCatalog(
  identity: EntityPromptTemplateCatalogIdentity | null | undefined,
  options: UseEntityPromptTemplateCatalogOptions = {},
): UseEntityPromptTemplateCatalogReturn {
  const { result, state: query } = useDataLayerQuery(
    entityPromptTemplateCatalogQueryOptions(
      identity ?? DISABLED_CATALOG_IDENTITY,
    ),
    { ...options, enabled: options.enabled !== false && !!identity },
  );
  const templates = result.data ?? [];

  return {
    catalog:
      identity && query.isFetched && !query.error
        ? { projectId: identity.projectId, templates }
        : null,
    data: templates,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isFetched: query.isFetched,
    isReady: query.isFetched && !query.error,
    error: query.error,
    isStale: query.isStale,
    refetch: query.refetch,
    markStale: query.markStale,
  };
}

export const useEntityPromptTemplates = useEntityPromptTemplateCatalog;

export type UseEntityPromptTemplateEffectiveOptions =
  CollectionHookOptions<EntityPromptTemplateEffectiveDto>;

export interface UseEntityPromptTemplateEffectiveReturn extends DataHookReturn<EntityPromptTemplateEffectiveDto> {
  effective: EntityPromptTemplateEffectiveDto | null;
}

export function useEffectiveEntityPromptTemplate(
  identity: EntityPromptTemplateProjectionIdentity | null | undefined,
  options: UseEntityPromptTemplateEffectiveOptions = {},
): UseEntityPromptTemplateEffectiveReturn {
  const { result, state: query } = useDataLayerQuery(
    entityPromptTemplateEffectiveQueryOptions(identity ?? DISABLED_IDENTITY),
    { ...options, enabled: options.enabled !== false && !!identity },
  );
  const effective = result.data ?? null;

  return {
    effective,
    data: effective,
    isLoading: query.isLoading,
    isFetching: query.isFetching,
    isFetched: query.isFetched,
    isReady: query.isFetched && !query.error,
    error: query.error,
    isStale: query.isStale,
    refetch: query.refetch,
    markStale: query.markStale,
  };
}

export const useEntityPromptTemplateEffective =
  useEffectiveEntityPromptTemplate;
