import type { QueryClient } from "@tanstack/react-query";
import { projectKeys } from "../collections/projects";
import { userKeys } from "../collections/users";
import { invalidateWithFollowUpRead } from "./invalidateWithFollowUpRead";

export function invalidateProjectQueries(
  client: QueryClient,
  organizationId: string,
  projectId?: string
): Promise<void> {
  return Promise.all([
    invalidateWithFollowUpRead(client, {
      queryKey: projectKeys.list(organizationId),
    }),
    ...(projectId
      ? [
          invalidateWithFollowUpRead(client, {
            queryKey: projectKeys.detail(organizationId, projectId),
          }),
        ]
      : []),
  ]).then(() => undefined);
}

/** Organization removal affects membership in every project of that organization. */
export function invalidateMembershipQueries(
  client: QueryClient,
  organizationId: string,
  projectId?: string
): Promise<void> {
  const members =
    projectId === undefined
      ? {
          queryKey: projectKeys.all(organizationId),
          predicate: ({ queryKey }: { queryKey: readonly unknown[] }) =>
            queryKey[3] === "members",
        }
      : { queryKey: projectKeys.members(organizationId, projectId) };
  return Promise.all([
    invalidateWithFollowUpRead(client, members),
    invalidateWithFollowUpRead(client, {
      queryKey: userKeys.all(organizationId),
    }),
  ]).then(() => undefined);
}
