import { useMemo } from "react";
import type { ReportDto } from "../../api";
import { reportQueryOptions } from "../collections/reports";
import type { CollectionHookOptions, DataHookReturn } from "../core/types";
import { useDataLayerQuery } from "../query/useDataLayerQuery";
export type UseReportReturn = DataHookReturn<ReportDto>;
export function useReport(
  organizationId: string | undefined,
  reportId: string | undefined,
  options: CollectionHookOptions<ReportDto> = {}
): UseReportReturn {
  const queryOptions = useMemo(
    () =>
      reportQueryOptions(organizationId ?? "__noop__", reportId ?? "__noop__"),
    [organizationId, reportId]
  );
  const { result, state } = useDataLayerQuery(queryOptions, {
    ...options,
    enabled: (options.enabled ?? true) && !!organizationId && !!reportId,
  });
  return { ...state, data: result.data ?? null };
}
