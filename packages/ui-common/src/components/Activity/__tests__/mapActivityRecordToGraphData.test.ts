import { describe, expect, it } from "vitest";
import {
  ActivityCorrelationLinkType,
  EntityType,
  RecentActivityCorrelationMode,
  type RecentActivityCorrelationRecordDto,
} from "../../../api";
import { mapRecentCorrelatedActivityRecord } from "../../../data/collections/activityCorrelations";
import { mapActivityRecordToGraphData } from "../mapActivityRecordToGraphData";

const buildCodingSessionRecord = (
  overrides: Partial<RecentActivityCorrelationRecordDto> = {}
) => {
  const dto: RecentActivityCorrelationRecordDto = {
    entityId: "coding-session-1",
    entityType: EntityType.AgentSession,
    title: "Coding Session",
    timestamp: "2026-04-01T10:00:00.000Z",
    linkedEntities: [
      {
        entityId: "service-a",
        entityType: EntityType.Service,
        linkType: ActivityCorrelationLinkType.Related,
        title: "ui-common",
      },
      {
        entityId: "task-a",
        entityType: EntityType.Task,
        linkType: ActivityCorrelationLinkType.Parent,
        title: "Parent Task",
      },
      {
        entityId: "session-related",
        entityType: EntityType.AgentSession,
        linkType: ActivityCorrelationLinkType.Related,
        title: "Related Session",
        conversationId: "conv-related",
      },
    ],
    reports: [],
    conversationId: "conv-coding-1",
    lastMessage: null,
    ...overrides,
  };

  return mapRecentCorrelatedActivityRecord(
    dto,
    RecentActivityCorrelationMode.CodingSession
  );
};

describe("mapActivityRecordToGraphData (coding-session filter)", () => {
  it("drops Service and Task linked entities when view mode is coding session", () => {
    const activity = buildCodingSessionRecord();

    const graph = mapActivityRecordToGraphData(
      activity,
      RecentActivityCorrelationMode.CodingSession
    );

    const allNodes = [
      ...graph.parentTasks,
      ...graph.subtasks,
      ...graph.currentWork,
      ...graph.activeSessions,
    ];

    expect(
      allNodes.find((node) => node.entityType === EntityType.Service)
    ).toBeUndefined();
    expect(
      allNodes.find((node) => node.entityType === EntityType.Task)
    ).toBeUndefined();
    expect(graph.breadcrumbs).toHaveLength(0);
  });

  it("keeps AgentSession linked entities to support conversation overlays", () => {
    const activity = buildCodingSessionRecord();

    const graph = mapActivityRecordToGraphData(
      activity,
      RecentActivityCorrelationMode.CodingSession
    );

    expect(
      graph.activeSessions.find((node) => node.entityId === "session-related")
    ).toBeDefined();
  });

  it("does not filter when view mode is not coding session", () => {
    const activity = buildCodingSessionRecord();

    const graph = mapActivityRecordToGraphData(activity);

    const taskNode =
      graph.parentTasks.find((node) => node.entityId === "task-a") ??
      graph.subtasks.find((node) => node.entityId === "task-a") ??
      graph.breadcrumbs.find((segment) => segment.entityId === "task-a");

    expect(taskNode).toBeDefined();
  });
});
