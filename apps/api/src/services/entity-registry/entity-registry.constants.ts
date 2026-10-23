import { EntityType } from '@prisma/client';

export const NON_ARTIFACT_ENTITY_TYPES: EntityType[] = Object.values(
  EntityType,
).filter((type) => type !== EntityType.ARTIFACT);
