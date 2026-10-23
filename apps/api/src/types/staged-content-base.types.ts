/**
 * Staged Content Base Types
 *
 * Minimal base interface for all staged content entities.
 * Delegates to the OpenAPI generated `StagedContentEntity` definition so the
 * rest of the codebase stays aligned with the contract exposed by the API.
 */

import { StagedContentEntity } from '../generated';

export type StagedContentBase = StagedContentEntity;

/**
 * Type guard for runtime type checking
 */
export function isStagedContentBase(obj: unknown): obj is StagedContentBase {
  return (
    typeof obj === 'object' &&
    obj !== null &&
    typeof (obj as StagedContentBase).id === 'string' &&
    typeof (obj as StagedContentBase).organizationId === 'string' &&
    typeof (obj as StagedContentBase).currentStage === 'string' &&
    typeof (obj as StagedContentBase).status === 'string' &&
    typeof (obj as StagedContentBase).createdAt === 'string' &&
    typeof (obj as StagedContentBase).updatedAt === 'string'
  );
}
