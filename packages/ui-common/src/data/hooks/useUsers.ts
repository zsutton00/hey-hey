import type { OrganizationMemberResponseDto } from "../../api";
import { usersQueryOptions } from "../collections/users";
import type {
  CollectionHookOptions,
  DataCollectionHookReturn,
} from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";

export type UseUsersReturn =
  DataCollectionHookReturn<OrganizationMemberResponseDto>;

export function useUsers(
  organizationId: string | undefined,
  options: CollectionHookOptions<OrganizationMemberResponseDto> = {}
): UseUsersReturn {
  const { result, state } = useDataLayerQuery(
    usersQueryOptions(organizationId ?? ""),
    { ...options, enabled: (options.enabled ?? true) && !!organizationId }
  );

  return { ...state, data: result.data ?? [] };
}
