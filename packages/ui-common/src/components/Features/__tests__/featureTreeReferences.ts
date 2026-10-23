import type {
  PaginatedWorkItemReferenceResponseDto,
  TaskResponseDto,
  WorkItemReferenceDto,
} from "../../../api";

/** Structural reference projection of task fixtures, as served by the references endpoint. */
function toReferences(
  features: readonly TaskResponseDto[],
): WorkItemReferenceDto[] {
  return features.map((feature) => ({
    id: feature.id,
    name: feature.name,
    type: feature.type,
    parentTaskId: feature.parentTaskId ?? null,
  }));
}

/** Single-page `listWorkItemReferences` axios-shaped response. */
export function referencesResponse(features: readonly TaskResponseDto[]): {
  data: { data: PaginatedWorkItemReferenceResponseDto };
} {
  const items = toReferences(features);
  return {
    data: {
      data: {
        items,
        pagination: {
          page: 1,
          limit: 500,
          total: items.length,
          totalPages: items.length > 0 ? 1 : 0,
          hasNext: false,
          hasPrevious: false,
        },
      },
    },
  };
}
