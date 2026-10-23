import { describe, expect, it } from "vitest";
import { reportsQueryOptions, projectReportsQueryOptions } from "../reports";
import {
  ReportEntityRelation,
  ReportRelatedEntityType,
  ReportType,
} from "../../../api";
describe("report query contracts", () => {
  it("retains all server filters and partitions by organization and project", () => {
    const filters = {
      projectId: "p",
      reportType: ReportType.Snapshot,
      sourceExecutionId: "e",
      entityType: ReportRelatedEntityType.Task,
      entityId: "t",
      relation: ReportEntityRelation.Primary,
      parentReportId: "parent",
      includeExpired: true,
      limit: 25,
    };
    const options = reportsQueryOptions("org", filters);
    const { projectId, ...params } = filters;
    expect(options.queryKey).toEqual([
      "reports",
      "org",
      "entityList",
      projectId,
      params,
    ]);
    expect(options.staleTime).toBe(300000);
    expect(
      projectReportsQueryOptions("org", "p", { limit: 5, offset: 10 }).queryKey
    ).toEqual([
      "reports",
      "org",
      "projectList",
      "p",
      { limit: 5, offset: 10, types: undefined },
    ]);
  });
});
