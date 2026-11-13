import { ReportType, type ReportDto } from "../../api";

export type ProjectReportMetadataProblem =
  | "wrong-report-type"
  | "other-organization-or-project"
  | "payload-shape-invalid"
  | "scope-project-mismatch"
  | "blank-title"
  | "invalid-dates"
  | "invalid-window"
  | "unusable-time-zone";

export interface ProjectReportMetadataIssue {
  reason: ProjectReportMetadataProblem;
  detail?: string;
}

/**
 * Each field is read on its own: a problem with one never discards another
 * that is readable. `belongsHere` is false for reports of another
 * organization or project, which never expose a title or dates.
 */
export interface ProjectReportMetadata {
  belongsHere: boolean;
  title: string | null;
  period: string | null;
  issues: ProjectReportMetadataIssue[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const isUsableTimeZone = (timeZone: string): boolean => {
  try {
    new Intl.DateTimeFormat(undefined, { timeZone });
    return true;
  } catch {
    return false;
  }
};

const readDate = (value: unknown): Date | null => {
  if (typeof value !== "string") {
    return null;
  }
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
};

const foreign = (
  reason: ProjectReportMetadataProblem,
  detail?: string,
): ProjectReportMetadata => ({
  belongsHere: false,
  title: null,
  period: null,
  issues: [{ reason, detail }],
});

export const readProjectReportMetadata = (
  report: ReportDto,
  organizationId: string,
  projectId: string,
): ProjectReportMetadata => {
  if (report.reportType !== ReportType.ProjectReport) {
    return foreign("wrong-report-type", report.reportType);
  }
  if (
    report.organizationId !== organizationId ||
    report.projectId !== projectId
  ) {
    return foreign("other-organization-or-project");
  }

  const issues: ProjectReportMetadataIssue[] = [];
  const payload: Record<string, unknown> = isRecord(report.payload)
    ? report.payload
    : {};
  if (!isRecord(report.payload)) {
    issues.push({ reason: "payload-shape-invalid" });
  }
  const scope: Record<string, unknown> = isRecord(payload.scope)
    ? payload.scope
    : {};
  if (scope.projectId !== undefined && scope.projectId !== projectId) {
    return foreign("scope-project-mismatch");
  }

  const payloadTitle =
    typeof payload.title === "string" ? payload.title.trim() : "";
  const entityTitle = report.title?.trim() ?? "";
  const title = payloadTitle || entityTitle || null;
  if (!payloadTitle) {
    issues.push({ reason: "blank-title" });
  }

  const timeZoneValue =
    typeof scope.timeZone === "string" ? scope.timeZone : "";
  const timeZoneUsable =
    timeZoneValue !== "" && isUsableTimeZone(timeZoneValue);
  if (!timeZoneUsable) {
    issues.push({ reason: "unusable-time-zone", detail: timeZoneValue });
  }
  // Without a usable report timezone, dates are shown in UTC and labelled so.
  const timeZone = timeZoneUsable ? timeZoneValue : "UTC";
  const zoneSuffix = timeZoneUsable ? "" : " (UTC)";

  const created = readDate(report.createdAt);
  const start = readDate(scope.windowStart);
  const end = readDate(scope.windowEnd);
  const createdText = created
    ? `Created ${created.toLocaleDateString(undefined, { timeZone })}`
    : null;
  if (!created) {
    issues.push({ reason: "invalid-dates", detail: "createdAt" });
  }

  let windowText: string | null = null;
  if (!start || !end) {
    issues.push({ reason: "invalid-dates", detail: "window" });
  } else if (end.getTime() < start.getTime()) {
    issues.push({ reason: "invalid-window" });
  } else {
    const format =
      end.getTime() - start.getTime() <= DAY_MS
        ? (date: Date) => date.toLocaleString(undefined, { timeZone })
        : (date: Date) => date.toLocaleDateString(undefined, { timeZone });
    windowText = `${format(start)} – ${format(end)}`;
  }

  const parts = [windowText, createdText].filter(
    (part): part is string => part !== null,
  );
  const period = parts.length > 0 ? `${parts.join(" · ")}${zoneSuffix}` : null;

  return { belongsHere: true, title, period, issues };
};
