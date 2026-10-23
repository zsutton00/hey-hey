import type { SearchEntity } from "../../AdvancedSearch/types";
import type { RelatedEntityDto } from "../../../types/secondaryActions";
import type { PreviewableEntity, NormalizedEntity } from "./types";

export function normalizeEntity(entity: PreviewableEntity): NormalizedEntity {
  if (isSearchEntity(entity)) {
    return {
      id: entity.id,
      type: entity.type,
      name: entity.name,
      description: entity.description,
      status: entity.status,
      metadata: entity.metadata,
    };
  }

  return {
    id: entity.entityId,
    type: entity.entityType,
    name: entity.entityName,
  };
}

export function isSearchEntity(
  entity: PreviewableEntity
): entity is SearchEntity {
  return "id" in entity && "type" in entity && "name" in entity;
}

export function isRelatedEntityDto(
  entity: PreviewableEntity
): entity is RelatedEntityDto {
  return (
    "entityId" in entity && "entityType" in entity && "entityName" in entity
  );
}
