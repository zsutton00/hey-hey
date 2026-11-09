import { z } from 'zod';
import {
  RunEntityReferenceEntityTypeEnum,
  type RunEntityReference,
} from '@hey-hey/contracts/agent-bridge';

const entityTypeSchema = z.nativeEnum(RunEntityReferenceEntityTypeEnum);

export const runEntityReferenceSchema = z.object({
  entityType: entityTypeSchema,
  entityId: z.string().uuid(),
});

export const persistedRunEntitySchema = runEntityReferenceSchema.strict().nullable();

export const sameRunEntity = (
  left: RunEntityReference | null,
  right: RunEntityReference | null,
): boolean =>
  left === null || right === null
    ? left === right
    : left.entityType === right.entityType && left.entityId === right.entityId;
