import { queryOptions } from "@tanstack/react-query";
import type { AxiosRequestConfig } from "axios";
import { captureRequestOptions } from "../core/requestInitiator";
import type { EntityStarDto, EntityType } from "../../api";
import { starsClient } from "../../clients/serviceClients";
import { dataLayerQueryPolicy } from "../query/queryPolicy";

/**
 * Prefix tree for star reads. There is one star list per organization;
 * entity-type subsets are a `select` over it, never a second request.
 */
export const entityStarKeys = {
  root: () => ["entityStars"] as const,
  all: (organizationId: string) => ["entityStars", organizationId] as const,
  list: (organizationId: string) =>
    [...entityStarKeys.all(organizationId), "list"] as const,
};

export const fetchEntityStars = async (
  organizationId: string,
  requestOptions: AxiosRequestConfig = captureRequestOptions()
): Promise<EntityStarDto[]> => {
  const response = await starsClient.listStars(
    { organizationId },
    requestOptions
  );
  const data = response.data?.data;

  if (!Array.isArray(data)) {
    throw new Error("Stars response did not include a list");
  }

  return data;
};

export function filterEntityStars(
  stars: EntityStarDto[],
  entityType: EntityType | undefined
): EntityStarDto[] {
  return entityType
    ? stars.filter((star) => star.entityType === entityType)
    : stars;
}

export function entityStarsQueryOptions(organizationId: string) {
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: entityStarKeys.list(organizationId),
    queryFn: ({ signal }) =>
      fetchEntityStars(organizationId, { ...captureRequestOptions(), signal }),
  });
}
