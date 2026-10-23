import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi, beforeEach } from "vitest";
import {
  CanonicalTaskMetadataTypeEnum,
  EntityType,
  type UnifiedSearchResult,
} from "../../../api";
import {
  buildUnifiedSearchCommonFilters,
  mapResultToSearchEntity,
  useMentionEntitySearch,
} from "../useMentionEntitySearch";
import {
  DIAGRAM_ELEMENT_TASK_TYPE,
  FEATURE_TASK_TYPE,
  WORKFLOW_STEP_TASK_TYPE,
  WORKFLOW_TASK_TYPE,
} from "../../../constants/taskTypes";
import { DEFAULT_MENTIONABLE_ENTITY_TYPES } from "../../../components/SmarterTextAreaCard/defaultMentionableEntityTypes";

const { unifiedSearchMock } = vi.hoisted(() => ({
  unifiedSearchMock: vi.fn(),
}));

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: { unifiedSearch: unifiedSearchMock },
}));

beforeEach(() => {
  unifiedSearchMock.mockReset().mockResolvedValue({
    data: { data: { results: [] } },
  });
});

describe("useMentionEntitySearch helpers", () => {
  it("maps historical workflow task results to canonical Diagram mentions", () => {
    const result: UnifiedSearchResult = {
      entityId: "workflow-1",
      entityType: EntityType.Task,
      title: "Plan review workflow",
      embeddings: {
        metadata: {
          id: "workflow-1",
          organizationId: "org-1",
          type: CanonicalTaskMetadataTypeEnum.Task,
          taskType: WORKFLOW_TASK_TYPE,
        },
      },
    };

    expect(mapResultToSearchEntity(result)).toMatchObject({
      id: "workflow-1",
      type: "diagram",
      name: "Plan review workflow",
    });
  });

  it("carries the task type so plan citations can be told apart", () => {
    const result: UnifiedSearchResult = {
      entityId: "plan-1",
      entityType: EntityType.Task,
      title: "Rollout plan",
      embeddings: {
        metadata: {
          id: "plan-1",
          organizationId: "org-1",
          type: CanonicalTaskMetadataTypeEnum.Task,
          taskType: "PLAN",
        },
      },
    };

    expect(mapResultToSearchEntity(result)).toMatchObject({
      id: "plan-1",
      type: "task",
      metadata: { taskType: "PLAN" },
    });
  });

  it.each(["mockups_v2", "CONTRACT", "mockups_v3"])(
    "keeps the exact %s registry key on task results for mention insertion",
    (taskType) => {
      const result: UnifiedSearchResult = {
        entityId: "item-1",
        entityType: EntityType.Task,
        title: "Item",
        embeddings: {
          metadata: {
            id: "item-1",
            organizationId: "org-1",
            type: CanonicalTaskMetadataTypeEnum.Task,
            taskType,
          },
        },
      };

      expect(mapResultToSearchEntity(result)).toMatchObject({
        id: "item-1",
        type: "task",
        metadata: { taskType },
      });
    },
  );

  it.each([
    DIAGRAM_ELEMENT_TASK_TYPE,
    WORKFLOW_STEP_TASK_TYPE,
    "WORKFLOW_STEP",
  ])(
    "maps %s task results to canonical Diagram Element mentions",
    (taskType) => {
      const result: UnifiedSearchResult = {
        entityId: "element-1",
        entityType: EntityType.Task,
        title: "Review request",
        embeddings: {
          metadata: {
            id: "element-1",
            organizationId: "org-1",
            type: CanonicalTaskMetadataTypeEnum.Task,
            taskType,
          },
        },
      };

      expect(mapResultToSearchEntity(result)).toMatchObject({
        id: "element-1",
        type: "diagram_element",
        name: "Review request",
      });
    },
  );

  it("keeps feature task results mapped to feature mentions", () => {
    const result: UnifiedSearchResult = {
      entityId: "feature-1",
      entityType: EntityType.Task,
      title: "Search UI",
      embeddings: {
        metadata: {
          id: "feature-1",
          organizationId: "org-1",
          type: CanonicalTaskMetadataTypeEnum.Task,
          taskType: FEATURE_TASK_TYPE,
        },
      },
    };

    expect(mapResultToSearchEntity(result)).toMatchObject({
      id: "feature-1",
      type: "feature",
      name: "Search UI",
    });
  });

  it("maps Agent Session search results to canonical Agent Session mentions", () => {
    const result: UnifiedSearchResult = {
      entityId: "65bf0144-47c5-41cb-a74d-517c20b20f6b",
      entityType: EntityType.AgentSession,
      title: "Review release notes",
    };

    expect(mapResultToSearchEntity(result)).toMatchObject({
      id: "65bf0144-47c5-41cb-a74d-517c20b20f6b",
      type: "agent_session",
      name: "Review release notes",
    });
  });

  it("includes Agent Sessions in the default mentionable entity types", () => {
    expect(DEFAULT_MENTIONABLE_ENTITY_TYPES).toContain("agent_session");
  });

  it("includes Agent Sessions in the default mention search scope", async () => {
    const { result } = renderHook(() =>
      useMentionEntitySearch("org-1", "project-1", null),
    );

    await act(async () => {
      await result.current.searchEntities("release notes");
    });

    expect(unifiedSearchMock).toHaveBeenCalledWith(
      expect.objectContaining({
        unifiedSearchRequest: expect.objectContaining({
          common: {
            types: expect.arrayContaining([EntityType.AgentSession]),
          },
        }),
      }),
    );
  });

  it("treats workflow registry keys as task-type filters", () => {
    expect(
      buildUnifiedSearchCommonFilters({
        kind: "work-item-types",
        taskTypes: ["workflow"],
      }),
    ).toEqual({
      types: [EntityType.Task],
      taskTypes: ["workflow"],
    });
  });

  it("treats Contract registry keys as task-type filters", () => {
    expect(
      buildUnifiedSearchCommonFilters({
        kind: "work-item-types",
        taskTypes: ["CONTRACT"],
      }),
    ).toEqual({
      types: [EntityType.Task],
      taskTypes: ["CONTRACT"],
    });
  });

  it("passes project-defined registry keys through without an allowlist", () => {
    expect(
      buildUnifiedSearchCommonFilters({
        kind: "work-item-types",
        taskTypes: ["customer_request"],
      }),
    ).toEqual({
      types: [EntityType.Task],
      taskTypes: ["customer_request"],
    });
  });

  it("keeps broad task searches free of subtype filters", () => {
    expect(
      buildUnifiedSearchCommonFilters({
        kind: "entity-types",
        entityTypes: ["task"],
      }),
    ).toEqual({
      types: [EntityType.Task],
    });
  });
});
