import {
  OrganizationDirectorySortBy,
  OrganizationDirectorySortOrder,
  OrganizationDirectoryRowDtoAccessStatusEnum,
  OrganizationDirectoryRowDtoSubscriptionTypeEnum,
  type OrganizationDirectoryPageDto,
  type OrganizationDirectoryRowDto,
} from "../../api";
import { unifiedApiClient } from "../../clients/serviceClients";
import { queryOptions } from "@tanstack/react-query";
import { captureRequestOptions } from "../core/requestInitiator";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
import { z } from "zod";

export const ORGANIZATION_DIRECTORY_DEFAULT_LIMIT = 25;
export const ORGANIZATION_DIRECTORY_MAX_LIMIT = 100;

export interface OrganizationsDirectoryQuery {
  name?: string;
  sortBy?: OrganizationDirectorySortBy;
  sortOrder?: OrganizationDirectorySortOrder;
  cursor?: string;
  limit?: number;
  /**
   * Ephemeral browser-session scope for this protected collection. It is part
   * of the cache identity only and is never sent to the API.
   */
  cacheScope?: string;
}

export interface OrganizationsDirectoryKey {
  name: string;
  sortBy: OrganizationDirectorySortBy;
  sortOrder: OrganizationDirectorySortOrder;
  cursor?: string;
  limit: number;
  cacheScope?: string;
}

export const organizationKeys = {
  root: () => ["organizationsDirectory"] as const,
  directory: (query: OrganizationsDirectoryQuery = {}) =>
    [
      "organizationsDirectory",
      {
        name: query.name?.trim() ?? "",
        sortBy: query.sortBy ?? OrganizationDirectorySortBy.CreatedAt,
        sortOrder: query.sortOrder ?? OrganizationDirectorySortOrder.Desc,
        cursor: query.cursor || undefined,
        limit: query.limit ?? ORGANIZATION_DIRECTORY_DEFAULT_LIMIT,
        cacheScope: query.cacheScope ?? "",
      },
    ] as const,
};
const organizationDirectoryRowSchema: z.ZodType<OrganizationDirectoryRowDto> =
  z.object({
    id: z.string(),
    name: z.string(),
    createdAt: z.string(),
    memberCount: z.number().int().nonnegative(),
    subscriptionType: z.nativeEnum(
      OrganizationDirectoryRowDtoSubscriptionTypeEnum
    ),
    accessStatus: z.nativeEnum(OrganizationDirectoryRowDtoAccessStatusEnum),
  });

const organizationDirectoryPageSchema: z.ZodType<OrganizationDirectoryPageDto> =
  z.object({
    organizations: z.array(organizationDirectoryRowSchema),
    totalCount: z.number().int().nonnegative(),
    nextCursor: z.string().nullable(),
  });

const organizationDirectoryResponseSchema = z.object({
  data: organizationDirectoryPageSchema,
});

export const parseOrganizationsDirectoryResponse = (
  payload: unknown
): OrganizationDirectoryPageDto => {
  const result = organizationDirectoryResponseSchema.safeParse(payload);
  if (!result.success) {
    throw new Error(
      "Organizations directory response does not match the generated contract."
    );
  }
  return result.data.data;
};

export const organizationsDirectoryQueryOptions = (
  query: OrganizationsDirectoryQuery = {}
) => {
  const queryKey = organizationKeys.directory(query);
  return queryOptions({
    ...dataLayerQueryPolicy,
    queryKey,
    queryFn: async () => {
      const { cacheScope: _cacheScope, ...params } = queryKey[1];
      const response = await unifiedApiClient.listOrganizationDirectory(
        { ...params, name: params.name || undefined },
        captureRequestOptions()
      );
      return parseOrganizationsDirectoryResponse(response.data);
    },
  });
};
export { OrganizationDirectorySortBy, OrganizationDirectorySortOrder };
