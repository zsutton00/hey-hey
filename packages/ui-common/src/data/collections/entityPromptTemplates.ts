import { captureRequestOptions } from "../core/requestInitiator";
import { queryOptions, type QueryClient } from "@tanstack/react-query";
import type {
  EntityPromptTemplateCatalogEntryDto,
  EntityPromptTemplateEffectiveDto,
  EntityPromptTemplateSelectorDto,
} from "../../api";
import { entityPromptTemplatesClient } from "../../clients/serviceClients";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
import { invalidateWithFollowUpRead } from "../query/invalidateWithFollowUpRead";
export type EntityPromptTemplateCollectionItem =
  | EntityPromptTemplateCatalogEntryDto
  | EntityPromptTemplateEffectiveDto;

export interface EntityPromptTemplateProjectionIdentity {
  organizationId: string;
  projectId: string;
  templateKey: string;
  selector: EntityPromptTemplateSelectorDto;
}

export interface EntityPromptTemplateCatalogIdentity {
  organizationId: string;
  projectId: string;
}

export const promptTemplateKeys = {
  root: () => ["entityPromptTemplates"] as const,
  project: (identity: EntityPromptTemplateCatalogIdentity) =>
    [
      ...promptTemplateKeys.root(),
      identity.organizationId,
      identity.projectId,
    ] as const,
  catalog: (identity: EntityPromptTemplateCatalogIdentity) =>
    [...promptTemplateKeys.project(identity), "catalog"] as const,
  effective: (identity: EntityPromptTemplateProjectionIdentity) =>
    [
      ...promptTemplateKeys.project(identity),
      "effective",
      identity.templateKey,
      identity.selector,
    ] as const,
};
const selectorsEqual = (
  left: EntityPromptTemplateSelectorDto,
  right: EntityPromptTemplateSelectorDto
): boolean =>
  left.entityType === right.entityType &&
  (left.entityType !== "WORK_ITEM" ||
    (right.entityType === "WORK_ITEM" &&
      left.workItemTypeKey === right.workItemTypeKey));
export const entityPromptTemplateCatalogQueryOptions = (
  identity: EntityPromptTemplateCatalogIdentity
) =>
  queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: promptTemplateKeys.catalog(identity),
    queryFn: async ({ signal }) => {
      const response =
        await entityPromptTemplatesClient.getProjectEntityPromptTemplateCatalog(
          identity,
          { ...captureRequestOptions(), signal }
        );
      return response.data?.data?.templates ?? [];
    },
  });
export const entityPromptTemplateEffectiveQueryOptions = (
  identity: EntityPromptTemplateProjectionIdentity
) =>
  queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: promptTemplateKeys.effective(identity),
    queryFn: async ({ signal }) => {
      const response =
        await entityPromptTemplatesClient.getEffectiveEntityPromptTemplate(
          {
            organizationId: identity.organizationId,
            projectId: identity.projectId,
            templateKey: identity.templateKey,
          },
          { ...captureRequestOptions(), signal }
        );
      const template = response.data?.data;
      return template && selectorsEqual(template.selector, identity.selector)
        ? template
        : null;
    },
  });
export const refetchEntityPromptTemplateProjections = async (
  queryClient: QueryClient,
  identity: EntityPromptTemplateProjectionIdentity
): Promise<void> => {
  await Promise.all(
    [
      promptTemplateKeys.catalog(identity),
      promptTemplateKeys.effective(identity),
    ].map((queryKey) =>
      invalidateWithFollowUpRead(queryClient, { queryKey, exact: true })
    )
  );
};
export function isEntityPromptTemplateCatalogEntry(
  item: EntityPromptTemplateCollectionItem
): item is EntityPromptTemplateCatalogEntryDto {
  return (
    "canonicalDefault" in item &&
    "revisionHistory" in item &&
    "effective" in item
  );
}

export function isEntityPromptTemplateEffective(
  item: EntityPromptTemplateCollectionItem
): item is EntityPromptTemplateEffectiveDto {
  return "ownershipSource" in item && "revisionId" in item;
}

export const selectEntityPromptTemplateCanonical = (
  template: EntityPromptTemplateCatalogEntryDto
) => template.canonicalDefault;

export const selectEntityPromptTemplateProjectOverride = (
  template: EntityPromptTemplateCatalogEntryDto
) => template.projectOverride;

export const selectEntityPromptTemplateRevisionHistory = (
  template: EntityPromptTemplateCatalogEntryDto
) => template.revisionHistory;

export const selectEntityPromptTemplateEffective = (
  template: EntityPromptTemplateCatalogEntryDto
) => template.effective;

export const selectCanonicalEntityPromptTemplate =
  selectEntityPromptTemplateCanonical;
export const selectProjectOverrideEntityPromptTemplate =
  selectEntityPromptTemplateProjectOverride;
export const selectRevisionHistoryEntityPromptTemplate =
  selectEntityPromptTemplateRevisionHistory;
export const selectEffectiveEntityPromptTemplate =
  selectEntityPromptTemplateEffective;
