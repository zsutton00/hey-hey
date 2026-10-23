import {
  ReportType,
  type ImplementReportPayloadAllOfDecisions,
  type ImplementReportPayloadAllOfLocation,
  type ReportDto,
} from "../../../api";
import { narrowReportPayload } from "../../Reports/viewer/rendererContract";

/**
 * An IMPLEMENT-report decision that carries a concrete code location, so it
 * can be anchored inline in the diff viewer.
 */
export type LocatedDecision = ImplementReportPayloadAllOfDecisions & {
  location: ImplementReportPayloadAllOfLocation;
};

type ImplementReportDto = ReportDto & {
  reportType: typeof ReportType.Implement;
};

const isImplementReport = (report: ReportDto): report is ImplementReportDto =>
  report.reportType === ReportType.Implement;

const hasLocation = (
  decision: ImplementReportPayloadAllOfDecisions,
): decision is LocatedDecision => decision.location !== undefined;

/**
 * From a list of reports ordered most-recent-first (as returned by
 * `useReports`), pick the latest IMPLEMENT report and return only the
 * decisions that carry a `location`. Decisions without a location are
 * excluded here so they never reach the diff viewer.
 */
export const selectLocatedDecisions = (
  reports: ReportDto[],
): LocatedDecision[] => {
  const latestImplementReport = reports.find(isImplementReport);
  if (!latestImplementReport) return [];
  const payload = narrowReportPayload(latestImplementReport);
  return (payload.decisions ?? []).filter(hasLocation);
};
