import { EntityType } from "../api";

const ENTITY_TYPE_VALUES = new Set(Object.values(EntityType));

const ENTITY_TYPE_ALIASES: Record<string, EntityType> = {
  task: EntityType.Task,
  initiative: EntityType.Initiative,
  design_doc: EntityType.DesignDoc,
  conversation: EntityType.Conversation,
  message: EntityType.Message,
  service: EntityType.Service,
  plan: EntityType.Task,
  project: EntityType.Project,
  workflow: EntityType.Task,
};

const isEntityType = (value: string): value is EntityType => {
  return ENTITY_TYPE_VALUES.has(value as EntityType);
};

export const normalizeEntityType = (value: string): EntityType | null => {
  const trimmed = value.trim();
  if (isEntityType(trimmed)) {
    return trimmed;
  }

  const lowerValue = trimmed.toLowerCase();
  if (ENTITY_TYPE_ALIASES[lowerValue]) {
    return ENTITY_TYPE_ALIASES[lowerValue];
  }

  const upperValue = trimmed.toUpperCase();
  if (isEntityType(upperValue)) {
    return upperValue;
  }

  return null;
};
