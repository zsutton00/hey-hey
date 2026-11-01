import { ForbiddenException } from '@nestjs/common';
import type { SearchRequest } from '../generated/embeddings';
import { ReadPolicyContext } from './read-policy';

/** Adds the policy's task-type exclusions to a search so Embeddings removes them before paging. */
export function scopeEmbeddingsRequest(request: SearchRequest): SearchRequest {
  const { excludedTaskTypes } = ReadPolicyContext.current();

  if (excludedTaskTypes.length === 0) {
    return request;
  }

  return {
    ...request,
    filters: {
      ...request.filters,
      excludeTaskTypes: [
        ...new Set([
          ...(request.filters?.excludeTaskTypes ?? []),
          ...excludedTaskTypes,
        ]),
      ],
    },
  };
}

/**
 * The GET search endpoints cannot express exclusions. A restricted request is refused rather than
 * answered with unfiltered results; it searches through the unified search, which can.
 */
export function assertSearchCanCarryReadPolicy(): void {
  if (ReadPolicyContext.current().excludedTaskTypes.length > 0) {
    throw new ForbiddenException(
      'This search endpoint is unavailable to a restricted read; use unified search.',
    );
  }
}
