import { describe, expect, it } from "vitest";
import {
  ActivityCorrelationApiAxiosParamCreator,
  ProjectMetricIdentity,
} from "../../../api";
import {
  buildCrossProjectActivityRequest,
  activityKeys,
} from "../../../data/collections/activityCorrelations";
import {
  editActivityHistoryQuery,
  getActivityHistorySelection,
  parseActivityHistoryFilter,
} from "../activityHistoryQuery";

const initial = {
  metricContinuation: {
    metric: ProjectMetricIdentity.TaskCompleted,
    projectIds: ["550e8400-e29b-41d4-a716-446655440000"],
    windowStart: "2026-09-01T00:00:00.000Z",
    windowEnd: "2026-09-02T00:00:00.000Z",
    actorScope: {
      mode: "PERSONAL" as const,
      userId: "550e8400-e29b-41d4-a716-446655440001",
    },
  },
  offset: 50,
};

describe("editable activity history", () => {
  it("seeds exact selection without mutation and resets pagination on successive edits", () => {
    const seed = getActivityHistorySelection(initial);
    expect(seed.userId).toBe(initial.metricContinuation.actorScope.userId);
    const edit = {
      windowStart: initial.metricContinuation.windowStart,
      windowEnd: "2026-09-03T00:00:00.000Z",
    };
    const first = editActivityHistoryQuery(initial, edit);
    const second = editActivityHistoryQuery(
      { ...first, offset: 100 },
      { ...edit, userId: seed.userId }
    );
    expect(first.historyFilter).toEqual({
      ...edit,
      metric: initial.metricContinuation.metric,
      projectIds: initial.metricContinuation.projectIds,
    });
    expect(second.offset).toBe(0);
    expect(second.historyFilter?.userId).toBe(seed.userId);
    expect(initial.offset).toBe(50);
    expect(initial.metricContinuation.windowEnd).toBe(
      "2026-09-02T00:00:00.000Z"
    );
    expect(second.metricContinuation).toBeUndefined();
  });

  it("round trips every edited field through cache and serializes one JSON query value", async () => {
    const query = {
      organizationId: "org",
      ...editActivityHistoryQuery(initial, {
        windowStart: initial.metricContinuation.windowStart,
        windowEnd: initial.metricContinuation.windowEnd,
        userId: initial.metricContinuation.actorScope.userId,
      }),
    };
    const parsed = activityKeys.crossProject(query)[3];
    expect(parsed).toEqual({ ...query, limit: 50 });
    const request = buildCrossProjectActivityRequest(parsed);
    const args = await ActivityCorrelationApiAxiosParamCreator().queryActivity(
      request.organizationId,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      undefined,
      request.historyFilter,
      request.limit,
      request.offset
    );
    const params = new URL(args.url, "https://example.test").searchParams;
    expect(
      parseActivityHistoryFilter(JSON.parse(params.get("historyFilter")!))
    ).toEqual(query.historyFilter);
    expect(params.has("metric")).toBe(false);
    expect(params.has("historyFilter.metric")).toBe(false);
  });

  it("retains empty project scope and separates actor and time cache identities", () => {
    const edit = {
      windowStart: initial.metricContinuation.windowStart,
      windowEnd: initial.metricContinuation.windowEnd,
    };
    const empty = editActivityHistoryQuery(
      { metricContinuation: { ...initial.metricContinuation, projectIds: [] } },
      edit
    );
    expect(empty.historyFilter?.projectIds).toEqual([]);
    const key = activityKeys.crossProject({
      organizationId: "org",
      ...empty,
    });
    expect(
      activityKeys.crossProject({
        organizationId: "org",
        ...editActivityHistoryQuery(empty, {
          ...edit,
          userId: initial.metricContinuation.actorScope.userId,
        }),
      })
    ).not.toEqual(key);
  });
});
