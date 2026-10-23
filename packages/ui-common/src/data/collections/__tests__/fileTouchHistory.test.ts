import { QueryClient } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  fileHistoryKeys,
  fileTaskHistoryQueryOptions,
  serviceFileHistoryQueryOptions,
  buildWorkItemFileHistoryRequest,
  parseServiceFileHistoryResponse,
  parseWorkItemFileHistoryResponse,
} from "../fileTouchHistory";
import {
  FileTouchServiceHistorySortBy,
  FileTouchServiceHistorySortOrder,
  ListReportFileTouchesByWorkEntityTypeEnum,
} from "../../../api";

const {
  listReportFileHistoryByFileMock,
  listReportFileHistoryByServiceMock,
  listReportFileTouchesByFileMock,
} = vi.hoisted(() => ({
  listReportFileHistoryByFileMock: vi.fn(),
  listReportFileHistoryByServiceMock: vi.fn(),
  listReportFileTouchesByFileMock: vi.fn(),
}));

vi.mock("../../../clients/serviceClients", () => ({
  reportsClient: {
    listReportFileHistoryByFile: listReportFileHistoryByFileMock,
    listReportFileHistoryByService: listReportFileHistoryByServiceMock,
    listReportFileTouchesByFile: listReportFileTouchesByFileMock,
  },
}));

describe("file touch history collections", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps work scope and reverse file identity in separate cache keys", () => {
    const workKey = fileHistoryKeys.workItem("org-1", "project-1", {
      kind: "feature",
      featureId: "feature-1",
    });
    const fileKey = fileTaskHistoryQueryOptions({
      organizationId: "org-1",
      projectId: "project-1",
      serviceId: "service-1",
      normalizedPath: "/src\\components//Files.tsx",
    });

    expect(workKey).toEqual(["fileHistory", "org-1", "project-1", "workItem", "feature", "feature-1"]);
    expect(fileKey.queryKey).toEqual(["fileHistory", "org-1", "project-1", "file", "service-1", "src/components/Files.tsx"]);
  });

  it("separates service collection cache entries by every collection input", () => {
    const base = {
      organizationId: "org-1",
      projectId: "project-1",
      serviceId: "service-1",
      pathFilter: "src/",
      sortBy: FileTouchServiceHistorySortBy.LastTouchedAt,
      sortOrder: FileTouchServiceHistorySortOrder.Desc,
    };
    const first = serviceFileHistoryQueryOptions(base);
    const second = serviceFileHistoryQueryOptions({
      ...base,
      cursor: "page-2",
    });
    const differentSort = serviceFileHistoryQueryOptions({
      ...base,
      sortBy: FileTouchServiceHistorySortBy.TouchCount,
    });

    expect(first.queryKey).not.toEqual(second.queryKey);
    expect(first.queryKey).not.toEqual(differentSort.queryKey);
    expect(second.queryKey.at(-1)).toBe("page-2");
  });

  it("parses service pagination metadata and normalizes returned paths", () => {
    expect(
      parseServiceFileHistoryResponse({
        data: {
          files: [
            {
              serviceId: "service-1",
              serviceName: "UI",
              normalizedPath: "/src\\index.ts",
              touchCount: 2,
              firstTouchedAt: "2026-08-01T00:00:00.000Z",
              lastTouchedAt: "2026-08-02T00:00:00.000Z",
              latestTaskId: "task-1",
              latestTaskName: "Add files",
              latestTaskType: "STANDARD",
              latestAgentSessionId: "session-1",
              latestAgentSessionTitle: "Implementation",
              latestReportId: "report-1",
            },
          ],
          nextCursor: "next-page",
        },
      })
    ).toEqual({
      files: [expect.objectContaining({ normalizedPath: "src/index.ts" })],
      nextCursor: "next-page",
    });
  });

  it("constructs the generated service request with filter, sort, cursor, and bound", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryKey = serviceFileHistoryQueryOptions({
      organizationId: "org-1",
      projectId: "project-1",
      serviceId: "service-1",
      pathFilter: "src/",
      sortBy: FileTouchServiceHistorySortBy.TouchCount,
      sortOrder: FileTouchServiceHistorySortOrder.Asc,
      cursor: "page-2",
    });
    listReportFileHistoryByServiceMock.mockResolvedValue({
      data: { data: { files: [], nextCursor: null } },
    });

    await queryClient.fetchQuery(queryKey);

    expect(listReportFileHistoryByServiceMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      serviceId: "service-1",
      pathFilter: "src/",
      sortBy: FileTouchServiceHistorySortBy.TouchCount,
      sortOrder: FileTouchServiceHistorySortOrder.Asc,
      cursor: "page-2",
      limit: 50,
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
  });

  it("builds task and feature work requests without changing the candidate contract", () => {
    expect(
      buildWorkItemFileHistoryRequest({
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
      buildWorkItemFileHistoryRequest({
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

  it("parses sectioned Feature results and normalizes file paths once", () => {
    expect(
      parseWorkItemFileHistoryResponse(
        {
          data: {
            sections: [
              {
                featureId: "feature-1",
                featureName: "Work Item Page",
                featurePath: "Work Item Page",
                files: [
                  {
                    serviceId: "service-1",
                    serviceName: "UI",
                    normalizedPath: "/src\\index.ts",
                  },
                ],
              },
            ],
          },
        },
        { kind: "feature", featureId: "feature-1" }
      )
    ).toEqual({
      kind: "feature",
      sections: [
        {
          featureId: "feature-1",
          featureName: "Work Item Page",
          featurePath: "Work Item Page",
          files: [
            {
              serviceId: "service-1",
              serviceName: "UI",
              normalizedPath: "src/index.ts",
            },
          ],
        },
      ],
    });
  });

  it("fetches enriched task history with complete backend ordering", async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryKey = fileTaskHistoryQueryOptions({
      organizationId: "org-1",
      projectId: "project-1",
      serviceId: "service-1",
      normalizedPath: "/src\\components//Files.tsx",
    });
    const tasks = [
      {
        taskId: "task-2",
        taskName: "Second returned task",
        taskType: "BUG",
        directFeatureId: null,
        directFeatureName: null,
        touchCount: 1,
        firstTouchedAt: "2026-08-03T00:00:00.000Z",
        lastTouchedAt: "2026-08-03T00:00:00.000Z",
        evidence: [
          {
            reportId: "report-3",
            agentSessionId: "session-3",
            agentSessionTitle: "Latest implementation",
            createdAt: "2026-08-03T00:00:00.000Z",
          },
        ],
      },
      {
        taskId: "task-1",
        taskName: "Human-readable task title",
        taskType: "STANDARD",
        directFeatureId: "feature-1",
        directFeatureName: "Work Item Page",
        touchCount: 2,
        firstTouchedAt: "2026-08-01T00:00:00.000Z",
        lastTouchedAt: "2026-08-02T00:00:00.000Z",
        evidence: [
          {
            reportId: "report-2",
            agentSessionId: "session-2",
            agentSessionTitle: "Follow-up implementation",
            createdAt: "2026-08-02T00:00:00.000Z",
          },
          {
            reportId: "report-1",
            agentSessionId: "session-1",
            agentSessionTitle: "Initial implementation",
            createdAt: "2026-08-01T00:00:00.000Z",
          },
        ],
      },
    ];
    listReportFileHistoryByFileMock.mockResolvedValue({
      data: { data: { tasks } },
    });

    const result = await queryClient.fetchQuery(queryKey);

    expect(listReportFileHistoryByFileMock).toHaveBeenCalledWith({
      organizationId: "org-1",
      projectId: "project-1",
      serviceId: "service-1",
      path: "src/components/Files.tsx",
    }, expect.objectContaining({ signal: expect.any(AbortSignal) }));
    expect(listReportFileTouchesByFileMock).not.toHaveBeenCalled();
    expect(result).toEqual(tasks);
  });

  it.each([
    [
      "raw reverse facts",
      {
        data: {
          entries: [
            {
              id: "touch-1",
              projectId: "project-1",
              serviceId: "service-1",
              featureId: "feature-1",
              attachedEntityType: "TASK",
              attachedEntityId: "task-1",
              reportId: "report-1",
              agentSessionId: "session-1",
              normalizedPath: "src/index.ts",
              createdAt: "2026-08-01T00:00:00.000Z",
            },
          ],
        },
      },
    ],
    [
      "malformed enriched evidence",
      {
        data: {
          tasks: [
            {
              taskId: "task-1",
              taskName: "Human-readable task title",
              taskType: "STANDARD",
              directFeatureId: null,
              directFeatureName: null,
              touchCount: 1,
              firstTouchedAt: "2026-08-01T00:00:00.000Z",
              lastTouchedAt: "2026-08-01T00:00:00.000Z",
              evidence: [{ reportId: "report-1" }],
            },
          ],
        },
      },
    ],
  ])("rejects %s from the generated history operation", async (_name, data) => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const queryKey = fileTaskHistoryQueryOptions({
      organizationId: "org-1",
      projectId: "project-1",
      serviceId: "service-1",
      normalizedPath: "src/index.ts",
    });
    listReportFileHistoryByFileMock.mockResolvedValue({ data });

    await expect(
      queryClient.fetchQuery({ ...queryKey, retry: false })
    ).rejects.toThrow(
      "File task history lookup response does not match the generated contract."
    );
    expect(listReportFileTouchesByFileMock).not.toHaveBeenCalled();
  });
});
