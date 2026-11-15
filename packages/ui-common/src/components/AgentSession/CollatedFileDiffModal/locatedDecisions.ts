import {
  ReportRelatedEntityType,
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

/**
 * A located decision with the Service of the report it came from, or null
 * for older reports attached to no Service.
 */
export type ServiceLocatedDecision = LocatedDecision & {
  serviceId: string | null;
};

type ImplementReportDto = ReportDto & {
  reportType: typeof ReportType.Implement;
};

const isImplementReport = (report: ReportDto): report is ImplementReportDto =>
  report.reportType === ReportType.Implement;

const hasLocation = (
  decision: ImplementReportPayloadAllOfDecisions,
): decision is LocatedDecision => decision.location !== undefined;

const reportServiceId = (report: ReportDto): string | null =>
  report.entities.find(
    (entity) => entity.entityType === ReportRelatedEntityType.Service,
  )?.entityId ?? null;

/**
 * From a list of reports ordered most-recent-first (as returned by
 * `useReports`), pick the latest IMPLEMENT report of each Service and return
 * only the decisions that carry a `location`, tagged with that Service. A
 * turn that changes several Services writes one report per Service, so
 * taking a single latest report would drop the other Services' notes.
 */
export const selectLocatedDecisions = (
  reports: ReportDto[],
): ServiceLocatedDecision[] => {
  const latestByService = new Map<string | null, ImplementReportDto>();
  for (const report of reports.filter(isImplementReport)) {
    const serviceId = reportServiceId(report);
    if (!latestByService.has(serviceId)) {
      latestByService.set(serviceId, report);
    }
  }

  return [...latestByService.entries()].flatMap(([serviceId, report]) =>
    (narrowReportPayload(report).decisions ?? [])
      .filter(hasLocation)
      .map((decision) => ({ ...decision, serviceId })),
  );
};

/**
 * The decisions to show on one changed file: same path, and from that file's
 * Service. Decisions from older reports with no Service match any Service.
 */
export const decisionsForFile = (
  decisions: readonly ServiceLocatedDecision[],
  file: { serviceId: string; filePath: string },
): ServiceLocatedDecision[] =>
  decisions.filter(
    (decision) =>
      decision.location.file === file.filePath &&
      (decision.serviceId === null || decision.serviceId === file.serviceId),
  );
