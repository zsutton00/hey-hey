import {
  UsageTrendsView as SharedUsageTrendsView,
  defaultUsageTrendsFilters,
  type UsageTrendsFilterState,
} from "@hey-hey/ui-common/components";
import {
  parseAsArrayOf,
  parseAsString,
  parseAsStringLiteral,
  useQueryStates,
} from "nuqs";
import { useCallback, useMemo } from "react";

export interface UsageTrendsViewProps {
  organizationId: string;
  projectId: string;
}

const granularities = ["day", "week", "month"] as const;
const reportKinds = ["RESEARCH", "IMPLEMENTATION", "REVIEW"] as const;

/** Owns the URL state for the trends view so links and refresh reproduce it. */
export const UsageTrendsView = ({
  organizationId,
  projectId,
}: UsageTrendsViewProps) => {
  const defaults = useMemo(() => defaultUsageTrendsFilters(), []);
  const [params, setParams] = useQueryStates({
    utFrom: parseAsString.withDefault(defaults.from),
    utTo: parseAsString.withDefault(defaults.to),
    utBy: parseAsStringLiteral(granularities).withDefault(defaults.granularity),
    utKinds: parseAsArrayOf(parseAsStringLiteral(reportKinds)).withDefault([]),
    utProviders: parseAsArrayOf(parseAsString).withDefault([]),
    utModels: parseAsArrayOf(parseAsString).withDefault([]),
    utEfforts: parseAsArrayOf(parseAsString).withDefault([]),
  });
  const filters: UsageTrendsFilterState = useMemo(
    () => ({
      from: params.utFrom,
      to: params.utTo,
      granularity: params.utBy,
      reportKinds: params.utKinds,
      providers: params.utProviders,
      models: params.utModels,
      efforts: params.utEfforts,
    }),
    [params],
  );
  const handleChange = useCallback(
    (next: UsageTrendsFilterState) => {
      void setParams({
        utFrom: next.from,
        utTo: next.to,
        utBy: next.granularity,
        utKinds: next.reportKinds,
        utProviders: next.providers,
        utModels: next.models,
        utEfforts: next.efforts,
      });
    },
    [setParams],
  );

  return (
    <SharedUsageTrendsView
      organizationId={organizationId}
      projectId={projectId}
      filters={filters}
      onFiltersChange={handleChange}
    />
  );
};
