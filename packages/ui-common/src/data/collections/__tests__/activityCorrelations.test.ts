import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  ActivityCorrelationApiAxiosParamCreator,
  ActivityCorrelationActivityType,
  ActivityCorrelationSource,
  ActivityCorrelationMode,
  EntityType,
  MessageStatus,
  ProjectMetricIdentity,
  RecentActivityCorrelationMode,
  RecentActivityCorrelationSort,
  SystemMessageDataTypeEnum,
  type ActivityCorrelationRecordDto,
  type RecentActivityCorrelationRecordDto,
} from "../../../api";
import {
  buildCrossProjectActivityRequest,
  fetchCorrelatedActivityPage,
  fetchCrossProjectActivityPage,
  activityKeys,
  mapCorrelatedActivityRecord,
  mapCorrelatedActivityRecords,
} from "../activityCorrelations";
import { setSearchParams } from "../../../api/common";

const {
  getCorrelatedActivityMock,
  getCorrelatedActivityByEntityMock,
  queryActivityMock,
} = vi.hoisted(() => ({
  getCorrelatedActivityMock: vi.fn(),
  getCorrelatedActivityByEntityMock: vi.fn(),
  queryActivityMock: vi.fn(),
}));

vi.mock("../../../clients/serviceClients", () => ({
  activityCorrelationClient: {
    getCorrelatedActivity: getCorrelatedActivityMock,
    getCorrelatedActivityByEntity: getCorrelatedActivityByEntityMock,
    queryActivity: queryActivityMock,
  },
}));

const buildRecord = (
  overrides: Partial<ActivityCorrelationRecordDto> = {}
): ActivityCorrelationRecordDto => ({
  entityId: "task-1",
  entityType: EntityType.Task,
  projectId: "project-1",
  title: "Task 1",
  type: ActivityCorrelationActivityType.Viewed,
  timestamp: "2026-03-02T00:00:00Z",
  source: ActivityCorrelationSource.AttentionEvent,
  linkedEntities: [],
  reports: [],
  ...overrides,
});

const buildRecentRecord = (
  overrides: Partial<RecentActivityCorrelationRecordDto> = {}
): RecentActivityCorrelationRecordDto => ({
  entityId: "task-1",
  entityType: EntityType.Task,
  title: "Task 1",
  timestamp: "2026-03-02T00:00:00Z",
  linkedEntities: [],
  reports: [],
  ...overrides,
});

describe("activity correlations collection", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("builds query keys with recent feed params", () => {
    const key = activityKeys.correlated({
      organizationId: "org-123",
      projectId: "project-123",
      mode: RecentActivityCorrelationMode.Activity,
      sort: RecentActivityCorrelationSort.Mixed,
    });
    expect(key).toEqual([
      "activity",
      "org-123",
      "correlated",
      {
        organizationId: "org-123",
        projectId: "project-123",
        mode: "ACTIVITY",
        sort: "MIXED",
        limit: 50,
        offset: 0,
      },
    ]);
  });

  it("keeps every cross-project filter in a stable cache identity", () => {
    const key = activityKeys.crossProject({
      organizationId: "org-123",
      projectId: "project-123",
      userId: "user-123",
      entityType: [EntityType.Task, EntityType.Project],
      activityMode: ActivityCorrelationMode.All,
      activityType: [ActivityCorrelationActivityType.Notification],
      source: [ActivityCorrelationSource.System],
      serviceId: "service-123",
      since: "2026-03-01T00:00:00.000Z",
      until: "2026-03-02T00:00:00.000Z",
      affectsMe: true,
      sinceLastVisit: false,
      limit: 25,
      offset: 50,
    });

    expect(key[3]).toMatchObject({
      userId: "user-123",
      entityType: ["PROJECT", "TASK"],
      activityMode: "ALL",
      serviceId: "service-123",
      affectsMe: true,
      sinceLastVisit: false,
      limit: 25,
      offset: 50,
    });
  });

  it("separates and round-trips metric evidence cache state", () => {
    const metricContinuation = {
      metric: ProjectMetricIdentity.TaskCompleted,
      projectIds: ["project-2", "project-1"],
      windowStart: "2026-03-01T00:00:00.000Z",
      windowEnd: "2026-03-02T00:00:00.000Z",
      actorScope: { mode: "ORGANIZATION" as const },
    };
    const metricKey = activityKeys.crossProject({
      organizationId: "org-123",
      metricContinuation,
      limit: 25,
      offset: 50,
    });
    const filterKey = activityKeys.crossProject({
      organizationId: "org-123",
      activityMode: ActivityCorrelationMode.All,
      limit: 25,
      offset: 50,
    });

    expect(metricKey).not.toEqual(filterKey);
    expect(metricKey[3]).toEqual({
      organizationId: "org-123",
      metricContinuation,
      limit: 25,
      offset: 50,
    });
  });

  it("forwards metric continuation and compatible filters unchanged to the generated query", async () => {
    const metricContinuation = {
      metric: ProjectMetricIdentity.BugCreated,
      projectIds: ["project-1"],
      windowStart: "2026-03-01T00:00:00.000Z",
      windowEnd: "2026-03-02T00:00:00.000Z",
      actorScope: { mode: "PERSONAL" as const, userId: "person-1" },
    };
    queryActivityMock.mockResolvedValueOnce({
      data: { data: [buildRecord()] },
      headers: { "x-total-count": "1", "x-next-offset": null },
    });

    const request = buildCrossProjectActivityRequest({
      organizationId: "org-1",
      userId: "person-1",
      entityType: [EntityType.Task, EntityType.Project],
      activityType: [ActivityCorrelationActivityType.Notification],
      source: [ActivityCorrelationSource.System],
      metricContinuation,
      limit: 25,
      offset: 0,
    });
    await fetchCrossProjectActivityPage({
      organizationId: "org-1",
      userId: "person-1",
      entityType: [EntityType.Task, EntityType.Project],
      activityType: [ActivityCorrelationActivityType.Notification],
      source: [ActivityCorrelationSource.System],
      metricContinuation,
      limit: 25,
      offset: 0,
    });

    expect(request).toEqual(
      expect.objectContaining({
        organizationId: "org-1",
        userId: "person-1",
        entityType: [EntityType.Task, EntityType.Project],
        activityType: [ActivityCorrelationActivityType.Notification],
        source: [ActivityCorrelationSource.System],
        metricContinuation: {
          metric: metricContinuation.metric,
          projectIds: metricContinuation.projectIds,
          windowStart: metricContinuation.windowStart,
          windowEnd: metricContinuation.windowEnd,
          actorScope: "PERSONAL",
          actorUserId: "person-1",
        },
        limit: 25,
        offset: 0,
      })
    );
    expect(queryActivityMock).toHaveBeenCalledWith(request, {});
  });

  it("serializes published list filters and the exploded continuation through the generated client", async () => {
    const request =
      await ActivityCorrelationApiAxiosParamCreator().queryActivity(
        "org-1",
        "project-1",
        "person-1",
        [EntityType.Task, EntityType.Project],
        ActivityCorrelationMode.WithoutAttention,
        [
          ActivityCorrelationActivityType.Notification,
          ActivityCorrelationActivityType.Viewed,
        ],
        [ActivityCorrelationSource.System, ActivityCorrelationSource.Report],
        "service-1",
        "2026-03-01T00:00:00.000Z",
        "2026-03-02T00:00:00.000Z",
        true,
        false,
        {
          metric: ProjectMetricIdentity.TaskCreated,
          projectIds: ["project-1"],
          windowStart: "2026-03-01T00:00:00.000Z",
          windowEnd: "2026-03-02T00:00:00.000Z",
          actorScope: "ORGANIZATION",
        },
        25,
        0
      );

    const query = new URL(request.url, "https://heyhey.test").searchParams;
    expect(query.get("userId")).toBe("person-1");
    expect(query.get("entityType")).toBe("TASK,PROJECT");
    expect(query.get("activityMode")).toBe("WITHOUT_ATTENTION");
    expect(query.get("activityType")).toBe("NOTIFICATION,VIEWED");
    expect(query.get("source")).toBe("SYSTEM,REPORT");
    expect(query.getAll("projectIds")).toEqual(["project-1"]);
    expect(query.get("metric")).toBe("TASK_CREATED");
    expect(query.get("windowStart")).toBe("2026-03-01T00:00:00.000Z");
    expect(query.get("windowEnd")).toBe("2026-03-02T00:00:00.000Z");
    expect(query.get("actorScope")).toBe("ORGANIZATION");
  });

  it("returns an empty page without broadening an empty metric scope", async () => {
    await expect(
      fetchCrossProjectActivityPage({
        organizationId: "org-1",
        metricContinuation: {
          metric: ProjectMetricIdentity.TaskCreated,
          projectIds: [],
          windowStart: "2026-03-01T00:00:00.000Z",
          windowEnd: "2026-03-02T00:00:00.000Z",
          actorScope: { mode: "ORGANIZATION" },
        },
        limit: 25,
        offset: 0,
      })
    ).resolves.toEqual({
      items: [],
      records: [],
      pagination: {
        limit: 25,
        offset: 0,
        totalCount: 0,
        nextOffset: null,
      },
    });
    expect(queryActivityMock).not.toHaveBeenCalled();
  });

  it.each([
    { projectIds: ["project-1"], expected: ["project-1"] },
    {
      projectIds: ["project-1", "project-2"],
      expected: ["project-1", "project-2"],
    },
  ])(
    "serializes generated array project scopes without broadening: $expected",
    ({ projectIds, expected }) => {
      const url = new URL("https://heyhey.test/activity");

      setSearchParams(url, {
        metric: ProjectMetricIdentity.TaskCreated,
        projectIds,
      });

      expect(url.searchParams.getAll("projectIds")).toEqual(expected);
    }
  );

  it("builds query keys with normalized entity filters", () => {
    const key = activityKeys.correlated({
      organizationId: "org-123",
      entityType: EntityType.Task,
      entityId: "task-123",
      activityType: [
        ActivityCorrelationActivityType.Viewed,
        ActivityCorrelationActivityType.Notification,
        ActivityCorrelationActivityType.Viewed,
      ],
      source: [
        ActivityCorrelationSource.System,
        ActivityCorrelationSource.Report,
      ],
      limit: 25,
      offset: 10,
    });

    expect(key[3]).toMatchObject({
      activityType: ["NOTIFICATION", "VIEWED"],
      source: ["REPORT", "SYSTEM"],
      limit: 25,
      offset: 10,
    });
  });

  it("parses query keys with recent feed params", () => {
    const key = activityKeys.correlated({
      organizationId: "org-123",
      projectId: "project-123",
      mode: RecentActivityCorrelationMode.Task,
      sort: RecentActivityCorrelationSort.LastMessage,
      limit: 15,
      offset: 5,
    });
    const parsed = key[3];

    expect(parsed).toEqual({
      organizationId: "org-123",
      projectId: "project-123",
      mode: RecentActivityCorrelationMode.Task,
      sort: RecentActivityCorrelationSort.LastMessage,
      limit: 15,
      offset: 5,
    });
  });

  it("parses query keys with entity scope", () => {
    const key = activityKeys.correlated({
      organizationId: "org-123",
      entityType: EntityType.Task,
      entityId: "task-123",
      limit: 10,
      offset: 0,
    });
    const parsed = key[3];

    expect(parsed).toEqual({
      organizationId: "org-123",
      entityType: EntityType.Task,
      entityId: "task-123",
      limit: 10,
      offset: 0,
    });
  });

  it("maps server DTO records to a stable UI model", () => {
    const mapped = mapCorrelatedActivityRecord(buildRecord());

    expect(mapped.activityId).toBe(
      "TASK:task-1:VIEWED:2026-03-02T00:00:00Z:ATTENTION_EVENT"
    );
    expect(mapped.activityType).toBe(ActivityCorrelationActivityType.Viewed);
    expect(mapped.preview.dropdown).toBe("Viewed from Attention");
    expect(mapped.previewText).toBe("Viewed from Attention");
    expect(mapped.priorityRank).toBeGreaterThan(0);
  });

  it("preserves optional plan context on mapped records", () => {
    const mapped = mapCorrelatedActivityRecord(
      buildRecord({
        conversationId: "conversation-1",
        plan: {
          planId: "plan-1",
          planTitle: "Execution Plan",
          planStageId: "stage-1",
          planStageTitle: "Stage 1",
          planStepId: "step-1",
          planStepTitle: "Step 1",
        },
      })
    );

    expect(mapped.conversationId).toBe("conversation-1");
    expect(mapped.plan).toEqual({
      planId: "plan-1",
      planTitle: "Execution Plan",
      planStageId: "stage-1",
      planStageTitle: "Stage 1",
      planStepId: "step-1",
      planStepTitle: "Step 1",
    });
  });

  it("preserves optional lastMessage payloads on mapped records", () => {
    const lastMessage = {
      id: "msg-1",
      projectId: "project-1",
      conversationId: "conversation-1",
      type: "SYSTEM" as const,
      content: "Latest system response",
      status: MessageStatus.Completed,
      awaitingResponse: false,
      createdAt: "2026-03-02T00:00:00Z",
      data: {
        type: SystemMessageDataTypeEnum.Analysis,
        response: "Latest system response",
      },
    };

    const mapped = mapCorrelatedActivityRecord(
      buildRecord({
        entityType: EntityType.AgentSession,
        conversationId: "conversation-1",
        lastMessage,
      })
    );

    expect(mapped.lastMessage).toEqual(lastMessage);
  });

  it("deduplicates and prioritizes mapped records", () => {
    const duplicatedRecord = buildRecord();

    const newerRecord = buildRecord({
      timestamp: "2026-03-03T00:00:00Z",
      type: ActivityCorrelationActivityType.Notification,
      source: ActivityCorrelationSource.System,
    });

    const mapped = mapCorrelatedActivityRecords([
      duplicatedRecord,
      duplicatedRecord,
      newerRecord,
    ]);

    expect(mapped).toHaveLength(2);
    expect(mapped[0]?.activityId).toBe(
      "TASK:task-1:NOTIFICATION:2026-03-03T00:00:00Z:SYSTEM"
    );
    expect(mapped[1]?.activityId).toBe(
      "TASK:task-1:VIEWED:2026-03-02T00:00:00Z:ATTENTION_EVENT"
    );
  });

  it("fetches mapped paginated activity and retries transient errors", async () => {
    getCorrelatedActivityMock
      .mockRejectedValueOnce({ response: { status: 500 } })
      .mockResolvedValueOnce({
        data: {
          data: [buildRecentRecord()],
        },
        headers: {
          "x-total-count": "1",
          "x-next-offset": "25",
        },
      });

    const result = await fetchCorrelatedActivityPage(
      {
        organizationId: "org-1",
        projectId: "project-1",
        limit: 25,
        offset: 0,
      },
      {
        maxRetries: 2,
        baseDelayMs: 0,
        maxDelayMs: 0,
      }
    );

    expect(getCorrelatedActivityMock).toHaveBeenCalledTimes(2);
    expect(getCorrelatedActivityByEntityMock).not.toHaveBeenCalled();
    expect(getCorrelatedActivityMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        mode: RecentActivityCorrelationMode.Activity,
        sort: RecentActivityCorrelationSort.Mixed,
        limit: 25,
        offset: 0,
      }),
      {}
    );
    expect(result.items).toHaveLength(1);
    expect(result.records).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      activityId: "RECENT:ACTIVITY:TASK:task-1:2026-03-02T00:00:00Z",
      kind: "recent",
      mode: RecentActivityCorrelationMode.Activity,
    });
    expect(result.pagination).toEqual({
      limit: 25,
      offset: 0,
      totalCount: 1,
      nextOffset: 25,
    });
  });

  it("maps records when API payload uses items and pagination object", async () => {
    getCorrelatedActivityMock.mockResolvedValueOnce({
      data: {
        items: [buildRecentRecord()],
        pagination: {
          totalCount: 1,
          nextOffset: 25,
        },
      },
      headers: {},
    });

    const result = await fetchCorrelatedActivityPage({
      organizationId: "org-1",
      projectId: "project-1",
      limit: 25,
      offset: 0,
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]).toMatchObject({
      activityId: "RECENT:ACTIVITY:TASK:task-1:2026-03-02T00:00:00Z",
      kind: "recent",
    });
    expect(result.pagination).toEqual({
      limit: 25,
      offset: 0,
      totalCount: 1,
      nextOffset: 25,
    });
  });

  it("uses entity endpoint when entity scope is provided", async () => {
    getCorrelatedActivityByEntityMock.mockResolvedValueOnce({
      data: {
        data: [buildRecord()],
      },
      headers: {
        "x-total-count": "1",
        "x-next-offset": null,
      },
    });

    const result = await fetchCorrelatedActivityPage({
      organizationId: "org-1",
      entityType: EntityType.Task,
      entityId: "task-1",
      limit: 25,
      offset: 0,
    });

    expect(getCorrelatedActivityByEntityMock).toHaveBeenCalledTimes(1);
    expect(getCorrelatedActivityByEntityMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        entityType: EntityType.Task,
        entityId: "task-1",
        limit: 25,
        offset: 0,
      }),
      {}
    );
    expect(getCorrelatedActivityMock).not.toHaveBeenCalled();
    expect(result.items).toHaveLength(1);
  });

  it("returns empty data for invalid entity scope without falling back to unscoped endpoint", async () => {
    const result = await fetchCorrelatedActivityPage({
      organizationId: "org-1",
      entityType: EntityType.Task,
      entityId: "",
      limit: 25,
      offset: 0,
    });

    expect(getCorrelatedActivityByEntityMock).not.toHaveBeenCalled();
    expect(getCorrelatedActivityMock).not.toHaveBeenCalled();
    expect(result).toEqual({
      items: [],
      records: [],
      pagination: {
        limit: 25,
        offset: 0,
        totalCount: 0,
        nextOffset: null,
      },
    });
  });

  it("does not retry aborted or canceled requests", async () => {
    getCorrelatedActivityMock.mockRejectedValueOnce({
      code: "ERR_CANCELED",
      message: "canceled",
    });

    await expect(
      fetchCorrelatedActivityPage(
        {
          organizationId: "org-1",
          projectId: "project-1",
          limit: 25,
          offset: 0,
        },
        {
          maxRetries: 2,
          baseDelayMs: 0,
          maxDelayMs: 0,
        }
      )
    ).rejects.toEqual(
      expect.objectContaining({
        code: "ERR_CANCELED",
      })
    );

    expect(getCorrelatedActivityMock).toHaveBeenCalledTimes(1);
  });
});
