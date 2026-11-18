import { describe, expect, it } from "vitest";
import {
  ReportAudience,
  ReportEntityRelation,
  ReportRelatedEntityType,
  ReportType,
  type ImplementReportPayload,
  type ReportDto,
} from "../../../../api";
import { decisionsForFile, selectLocatedDecisions } from "../locatedDecisions";

const buildImplementReport = (
  payload: ImplementReportPayload,
  overrides: Partial<ReportDto> = {},
): ReportDto =>
  ({
    id: "report-implement",
    organizationId: "org-1",
    reportType: ReportType.Implement,
    audience: ReportAudience.ProjectVisible,
    title: "IMPLEMENT report",
    payload,
    version: 1,
    schemaVersion: 1,
    sourceExecutionId: "exec-1",
    createdAt: "2026-05-15T00:00:00.000Z",
    expiresAt: "2026-06-15T00:00:00.000Z",
    entities: [],
    ...overrides,
  }) as ReportDto;

const buildPlanReport = (overrides: Partial<ReportDto> = {}): ReportDto =>
  ({
    id: "report-plan",
    organizationId: "org-1",
    reportType: ReportType.Plan,
    audience: ReportAudience.ProjectVisible,
    title: "PLAN report",
    payload: { reportType: "PLAN" },
    version: 1,
    schemaVersion: 1,
    sourceExecutionId: "exec-1",
    createdAt: "2026-05-16T00:00:00.000Z",
    expiresAt: "2026-06-16T00:00:00.000Z",
    entities: [],
    ...overrides,
  }) as ReportDto;

describe("selectLocatedDecisions", () => {
  it("returns only decisions that carry a location", () => {
    const payload: ImplementReportPayload = {
      reportType: "IMPLEMENT",
      summary: "summary",
      filesChanged: ["src/a.ts"],
      decisions: [
        {
          topic: "Located decision",
          choice: "Anchored choice",
          location: { file: "src/a.ts", startLine: 4 },
        },
        {
          topic: "Cross-cutting decision",
          choice: "Unanchored choice",
        },
      ],
    };

    const located = selectLocatedDecisions([buildImplementReport(payload)]);

    expect(located).toHaveLength(1);
    expect(located[0].topic).toBe("Located decision");
    expect(located[0].location.file).toBe("src/a.ts");
  });

  it("returns an empty list when there are no reports", () => {
    expect(selectLocatedDecisions([])).toEqual([]);
  });

  it("returns an empty list when no report is an IMPLEMENT report", () => {
    expect(selectLocatedDecisions([buildPlanReport()])).toEqual([]);
  });

  it("returns an empty list when the IMPLEMENT report has no decisions", () => {
    const payload: ImplementReportPayload = {
      reportType: "IMPLEMENT",
      summary: "summary",
      filesChanged: [],
    };

    expect(selectLocatedDecisions([buildImplementReport(payload)])).toEqual([]);
  });

  it("uses the first IMPLEMENT report, skipping other report types", () => {
    const newestPayload: ImplementReportPayload = {
      reportType: "IMPLEMENT",
      summary: "newest",
      filesChanged: ["src/new.ts"],
      decisions: [
        {
          topic: "Newest decision",
          choice: "Newest choice",
          location: { file: "src/new.ts" },
        },
      ],
    };
    const olderPayload: ImplementReportPayload = {
      reportType: "IMPLEMENT",
      summary: "older",
      filesChanged: ["src/old.ts"],
      decisions: [
        {
          topic: "Older decision",
          choice: "Older choice",
          location: { file: "src/old.ts" },
        },
      ],
    };

    // useReports returns reports most-recent-first; a non-IMPLEMENT report
    // ahead of the newest IMPLEMENT report must be skipped, not break narrowing.
    const located = selectLocatedDecisions([
      buildPlanReport(),
      buildImplementReport(newestPayload, { id: "report-newest" }),
      buildImplementReport(olderPayload, { id: "report-older" }),
    ]);

    expect(located).toHaveLength(1);
    expect(located[0].topic).toBe("Newest decision");
  });

  it("keeps each Service's notes when one turn writes a report per Service", () => {
    const serviceEntity = (serviceId: string) => ({
      entityType: ReportRelatedEntityType.Service,
      entityId: serviceId,
      relation: ReportEntityRelation.Context,
      createdAt: "2026-05-17T00:00:00.000Z",
    });
    const reportFor = (serviceId: string, topic: string) =>
      buildImplementReport(
        {
          reportType: "IMPLEMENT",
          summary: "turn summary",
          filesChanged: ["src/index.ts"],
          decisions: [
            {
              topic,
              choice: "choice",
              location: { file: "src/index.ts", startLine: 3 },
            },
            { topic: "Cross-cutting", choice: "everywhere" },
          ],
        },
        { id: `report-${serviceId}`, entities: [serviceEntity(serviceId)] },
      );

    // Newest first: service-b's report was saved after service-a's, and an
    // older service-a report from an earlier turn follows both.
    const decisions = selectLocatedDecisions([
      reportFor("service-b", "Service B note"),
      reportFor("service-a", "Service A note"),
      reportFor("service-a", "Older service A note"),
    ]);

    expect(
      decisions.map((decision) => [decision.serviceId, decision.topic]),
    ).toEqual([
      ["service-b", "Service B note"],
      ["service-a", "Service A note"],
    ]);
    expect(
      decisionsForFile(decisions, {
        serviceId: "service-a",
        filePath: "src/index.ts",
      }).map((decision) => decision.topic),
    ).toEqual(["Service A note"]);
    expect(
      decisionsForFile(decisions, {
        serviceId: "service-b",
        filePath: "src/index.ts",
      }).map((decision) => decision.topic),
    ).toEqual(["Service B note"]);
  });

  it("shows notes from a report attached to no Service on any Service's file", () => {
    const decisions = selectLocatedDecisions([
      buildImplementReport({
        reportType: "IMPLEMENT",
        summary: "older report",
        filesChanged: ["src/a.ts"],
        decisions: [
          {
            topic: "Legacy note",
            choice: "kept",
            location: { file: "src/a.ts" },
          },
        ],
      }),
    ]);

    expect(
      decisionsForFile(decisions, {
        serviceId: "service-a",
        filePath: "src/a.ts",
      }).map((decision) => decision.topic),
    ).toEqual(["Legacy note"]);
  });
});
