import { useMemo } from "react";
import type { ServiceRepoBinding } from "../../api";
import {
  localRepoBindingsQueryOptions,
  resolveLocalDirectoryRuntimeBaseUrl,
} from "../collections/localRepoBindings";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
const EMPTY_BINDINGS: ServiceRepoBinding[] = [];

type BindingsByServiceId = Readonly<Record<string, ServiceRepoBinding>>;

export type LocalRepoBindingsState = {
  status: "loading" | "fetching" | "ready" | "empty" | "error";
  bindings: readonly ServiceRepoBinding[];
  bindingsByServiceId: BindingsByServiceId;
  error?: Error;
  refetch: () => Promise<ServiceRepoBinding[] | null>;
  markStale: () => void;
};

const indexBindingsByServiceId = (
  bindings: readonly ServiceRepoBinding[]
): BindingsByServiceId => {
  const result: Record<string, ServiceRepoBinding> = {};
  for (const binding of bindings) result[binding.serviceId] = binding;
  return result;
};

export const useLocalRepoBindings = (): LocalRepoBindingsState => {
  const baseUrl = resolveLocalDirectoryRuntimeBaseUrl();
  const { result, state: query } = useDataLayerQuery(
    localRepoBindingsQueryOptions(baseUrl),
    { enabled: true }
  );
  const bindings = result.data ?? EMPTY_BINDINGS;
  const bindingsByServiceId = useMemo(
    () => indexBindingsByServiceId(bindings),
    [bindings]
  );
  const common = { refetch: query.refetch, markStale: query.markStale };
  if (query.error)
    return {
      ...common,
      status: "error",
      bindings: [],
      bindingsByServiceId: {},
      error: query.error,
    };
  if (!query.isFetched)
    return {
      ...common,
      status: "loading",
      bindings: [],
      bindingsByServiceId: {},
    };
  const status =
    query.isFetching && bindings.length > 0
      ? "fetching"
      : bindings.length === 0
      ? "empty"
      : "ready";
  return { ...common, status, bindings, bindingsByServiceId };
};
