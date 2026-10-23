import { queryOptions } from "@tanstack/react-query";
import {
  createDirectoryBindingApi,
  resolveLocalDirectoryRuntimeBaseUrl,
} from "../../components/AgentSession/runtime/directoryBindingApi";
import { dataLayerQueryPolicy } from "../query/queryPolicy";
export const localRepoBindingKeys = {
  root: () => ["localRepoBindings"] as const,
  runtime: (baseUrl: string) => ["localRepoBindings", baseUrl] as const,
};
export const localRepoBindingsQueryOptions = (baseUrl: string) =>
  queryOptions({
    ...dataLayerQueryPolicy,
    queryKey: localRepoBindingKeys.runtime(baseUrl),
    queryFn: async () =>
      (await createDirectoryBindingApi(baseUrl).listRepos()).bindings,
  });
export { resolveLocalDirectoryRuntimeBaseUrl };
