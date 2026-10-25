import { useQuery } from "@tanstack/react-query";
import { proposalsClient } from "../../clients/serviceClients";
import { proposalKeys } from "../collections/proposals";

export function useProjectReadyFutures(
  organizationId: string,
  projectId: string,
  page: number,
) {
  return useQuery({
    queryKey: [
      ...proposalKeys.lists(organizationId, projectId),
      "ready-futures",
      page,
    ],
    queryFn: async () => {
      const response = await proposalsClient.listProjectReadyFutures({
        organizationId,
        projectId,
        limit: 10,
        offset: (page - 1) * 10,
      });
      if (!response.data.data)
        throw new Error("Ready futures response is missing");
      return response.data.data;
    },
    staleTime: 0,
    refetchOnMount: "always",
    refetchOnWindowFocus: "always",
  });
}
