import { describe, expect, it } from "vitest";
import { ListReportFileTouchesByWorkEntityTypeEnum } from "../../../api";
import {
  fileReferenceKeys,
  buildFileReferenceCandidatesRequest,
  parseFileReferenceCandidatesResponse,
} from "../fileReferenceCandidates";

describe("file reference candidates collection", () => {
  it("builds an isolated cache identity for every scope dimension", () => {
    const taskKey = fileReferenceKeys.scope("org-1", "project-1", {
      kind: "task",
      taskId: "task-1",
    });
    const featureKey = fileReferenceKeys.scope("org-1", "project-1", {
      kind: "feature",
      featureId: "feature-1",
    });

    expect(taskKey).toEqual([
      "fileReferenceCandidates",
      "org-1",
      "project-1",
      "task",
      "task-1",
    ]);
    expect(featureKey).toEqual([
      "fileReferenceCandidates",
      "org-1",
      "project-1",
      "feature",
      "feature-1",
    ]);
  });

  it("builds mutually exclusive task and feature requests", () => {
    expect(
      buildFileReferenceCandidatesRequest({
        organizationId: "org-1",
        projectId: "project-1",
        scope: { kind: "task", taskId: "task-1" },
      })
    ).toEqual({
      organizationId: "org-1",
      projectId: "project-1",
      entityType: ListReportFileTouchesByWorkEntityTypeEnum.Task,
      entityId: "task-1",
    });

    expect(
      buildFileReferenceCandidatesRequest({
        organizationId: "org-1",
        projectId: "project-1",
        scope: { kind: "feature", featureId: "feature-1" },
      })
    ).toEqual({
      organizationId: "org-1",
      projectId: "project-1",
      featureId: "feature-1",
    });
  });

  it("extracts generated candidates and rejects the raw index response", () => {
    const candidates = [
      {
        serviceId: "service-1",
        serviceName: "UI Common",
        normalizedPath: "src/index.ts",
      },
    ];

    expect(
      parseFileReferenceCandidatesResponse({ data: { candidates } })
    ).toEqual(candidates);
    expect(() =>
      parseFileReferenceCandidatesResponse({ data: { entries: [] } })
    ).toThrow("does not match the generated candidate contract");
  });
});
