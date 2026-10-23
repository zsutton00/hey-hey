import { ReportType, type ReportDto } from "../../api";
import { narrowProjectReportPayload } from "../Reports/viewer/rendererContract";

export interface ProjectReportMetadata {
  title: string;
  summary: string;
  period: string;
}

export const readProjectReportMetadata = (
  report: ReportDto,
  organizationId: string,
  projectId: string
): ProjectReportMetadata | null => {
  if (report.reportType !== ReportType.ProjectReport ||
      report.organizationId !== organizationId || report.projectId !== projectId) return null;
  const payload = narrowProjectReportPayload(report);
  if (!payload || !payload.title.trim() || !payload.summary.trim() || payload.scope.projectId !== projectId) return null;
  const dates = [payload.scope.windowStart, payload.scope.windowEnd, report.createdAt].map((value) => new Date(value));
  if (dates.some((date) => Number.isNaN(date.getTime()))) return null;
  const [startDate, endDate, createdDate] = dates;
  if (endDate.getTime() < startDate.getTime()) return null;
  try {
    const timeZone = payload.scope.timeZone;
    const includesTime = endDate.getTime() - startDate.getTime() <= 24 * 60 * 60 * 1000;
    const formatBoundary = includesTime
      ? (date: Date) => date.toLocaleString(undefined, { timeZone })
      : (date: Date) => date.toLocaleDateString(undefined, { timeZone });
    return {
      title: payload.title,
      summary: payload.summary,
      period: `${formatBoundary(startDate)} – ${formatBoundary(endDate)} · Created ${createdDate.toLocaleDateString(undefined, { timeZone })}`,
    };
  } catch {
    return null;
  }
};
