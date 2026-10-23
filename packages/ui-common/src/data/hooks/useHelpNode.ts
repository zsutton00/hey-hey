import type { HelpNodeWithBody } from "../../api";
import { helpNodeQueryOptions } from "../collections/help";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
export type UseHelpNodeReturn = DataHookReturn<HelpNodeWithBody>;
export function useHelpNode(
  idOrSlugPath: string | undefined,
  options: CollectionHookOptions<HelpNodeWithBody> = {}
): UseHelpNodeReturn {
  const { result, state: query } = useDataLayerQuery(
    helpNodeQueryOptions(idOrSlugPath ?? "__noop__"),
    { ...options, enabled: !!idOrSlugPath && options.enabled !== false }
  );
  return { ...query, data: result.data ?? null };
}
