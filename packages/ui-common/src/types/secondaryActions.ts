import { RelatedEntityDtoWriterPayloadModeEnum } from "../api";
import type { RelatedEntityDto } from "../api";
import type { VerifyFeaturePayload, UIElementPayload } from "../api";

export const isVerifyFeaturePayload = (
  value: UIElementPayload | undefined
): value is VerifyFeaturePayload =>
  value !== undefined && "feature" in value && "explanation" in value;

export type { RelatedEntityDto };

export interface RegistryTaskContentApplyPayload {
  handlerType: "task_content_apply";
  initiativeId?: string;
  fields: Array<{ key: string; content: string }>;
}

export const isTaskContentApplyPayload = (
  payload: unknown
): payload is RegistryTaskContentApplyPayload => {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const candidate = payload as Record<string, unknown>;
  return (
    candidate.handlerType === "task_content_apply" &&
    Array.isArray(candidate.fields) &&
    candidate.fields.every(
      (field) =>
        field &&
        typeof field === "object" &&
        typeof (field as { key?: unknown }).key === "string" &&
        typeof (field as { content?: unknown }).content === "string"
    )
  );
};

export interface RelatedEntitiesPayload {
  handlerType: "related_entities";
  relatedEntities: RelatedEntityDto[];
}

const isRelatedEntityDto = (value: unknown): value is RelatedEntityDto => {
  if (!value || typeof value !== "object") {
    return false;
  }

  const candidate = value as RelatedEntityDto;
  const validWriterPayloadModes = Object.values(
    RelatedEntityDtoWriterPayloadModeEnum
  );
  const hasValidWriterPayloadMode =
    candidate.writerPayloadMode === undefined ||
    validWriterPayloadModes.includes(candidate.writerPayloadMode);
  const hasValidSelectedForHydration =
    candidate.selectedForHydration === undefined ||
    typeof candidate.selectedForHydration === "boolean";
  const hasValidHydrated =
    candidate.hydrated === undefined || typeof candidate.hydrated === "boolean";

  return (
    typeof candidate.entityId === "string" &&
    typeof candidate.entityType === "string" &&
    typeof candidate.entityName === "string" &&
    hasValidWriterPayloadMode &&
    hasValidSelectedForHydration &&
    hasValidHydrated
  );
};

export const isRelatedEntitiesPayload = (
  payload: unknown
): payload is RelatedEntitiesPayload => {
  if (!payload || typeof payload !== "object") {
    return false;
  }

  const candidate = payload as RelatedEntitiesPayload;
  return (
    candidate.handlerType === "related_entities" &&
    Array.isArray(candidate.relatedEntities) &&
    candidate.relatedEntities.length > 0 &&
    candidate.relatedEntities.every(isRelatedEntityDto)
  );
};
