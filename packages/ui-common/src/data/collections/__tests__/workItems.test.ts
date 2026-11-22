import { describe, it, expect } from "vitest";
import {
  AgentEdgeEndpointEntityType,
  AgentEdgeType,
  TaskSortBy,
  TaskSortDir,
  TaskSource,
  WorkStatus,
  type TaskResponseDto,
} from "../../../api";
import { legacyStatuses } from "../../../test/fixtures/workItemStatuses";
import {
  FakeWorkItemServer,
  type FakeWorkItem,
} from "../../../test/workItemGraphQL";
import {
  applyTaskSectionInputsToMaterialized,
  selectWorkItemSections,
} from "../../../utils/workItemSections";
import {
  fetchWorkItem,
  fetchWorkItemHierarchy,
  fetchWorkItemList,
} from "../workItemLists";
import { isPlanWorkItem } from "../workItems";

const scope = { organizationId: "org-1", projectId: "project-1" };

const makeTask = (
  overrides: Partial<TaskResponseDto> & Pick<TaskResponseDto, "id" | "name">,
): TaskResponseDto => ({
  id: overrides.id,
  name: overrides.name,
  type: overrides.type ?? "STANDARD",
  sections: overrides.sections ?? [],
  organizationId: overrides.organizationId ?? "org-1",
  projectId: overrides.projectId ?? "project-1",
  status: overrides.status ?? WorkStatus.Backlog,
  source: overrides.source ?? TaskSource.System,
  ...(overrides.parentTaskId !== undefined
    ? { parentTaskId: overrides.parentTaskId }
    : {}),
});

describe("plan work-item guard", () => {
  it("recognizes a PLAN work item with a parent", () => {
    const plan = makeTask({
      id: "plan-1",
      name: "Plan",
      type: "PLAN",
      parentTaskId: "feature-1",
    });

    expect(isPlanWorkItem(plan)).toBe(true);
  });

  it("rejects PLAN work items without a parent", () => {
    const plan = makeTask({
      id: "plan-1",
      name: "Plan",
      type: "PLAN",
    });

    expect(isPlanWorkItem(plan)).toBe(false);
  });
});

const items: FakeWorkItem[] = [
  { id: "a", name: "A", type: "STANDARD", status: "BACKLOG" },
  { id: "b", name: "B", type: "STANDARD", status: "ACTIVE", parentTaskId: "a" },
];

describe("work-item list reads", () => {
  const read = async (params: Parameters<typeof fetchWorkItemList>[2]) => {
    const server = new FakeWorkItemServer(items);
    const result = await fetchWorkItemList(
      server.graphql.apollo,
      scope,
      params,
    );

    return { result, variables: server.received("GetWorkItems")[0] };
  };

  it("sends every REST list filter as a query variable", async () => {
    const { variables } = await read({
      taskType: "STANDARD",
      parentTaskIds: ["b", "a", "a"],
      status: [WorkStatus.Backlog, WorkStatus.Active],
      taskIds: ["b", "a"],
      includeDescendants: true,
      page: 2,
      limit: 10,
      sortBy: TaskSortBy.Title,
      sortDir: TaskSortDir.Asc,
    });

    expect(variables).toMatchObject({
      type: "STANDARD",
      parentTaskIds: ["a", "b"],
      statuses: ["ACTIVE", "BACKLOG"],
      ids: ["a", "b"],
      includeDescendants: true,
      page: 2,
      limit: 10,
      sort: { field: "title", direction: "asc" },
    });
  });

  it("tells no parent filter apart from root items only", async () => {
    const unfiltered = await read({});
    const rootsOnly = await read({ parentTaskId: null });

    expect(unfiltered.variables).not.toHaveProperty("parentTaskId");
    expect(rootsOnly.variables).toHaveProperty("parentTaskId", null);
    expect(rootsOnly.result.map((item) => item.id)).toEqual(["a"]);
  });

  it("names a related-entity filter's types by the schema's enum names", async () => {
    const { variables } = await read({
      relatedEntityId: "goal-1",
      relatedEntityType: AgentEdgeEndpointEntityType.Task,
      edgeTypes: [AgentEdgeType.DependsOn],
    });

    expect(variables.relatedTo).toEqual({
      entityId: "goal-1",
      entityType: "Task",
      edgeTypes: ["DependsOn"],
    });
  });

  it("includes tracked entities by default and accepts an opt-out", async () => {
    const byDefault = await read({});
    const optedOut = await read({ includeTrackedEntities: false });
    const summary = await read({ includeTrackedWorkSummary: true });

    expect(byDefault.variables.withTrackedEntities).toBe(true);
    expect(optedOut.variables.withTrackedEntities).toBe(false);
    expect(summary.variables.withTrackedWorkSummary).toBe(true);
    expect(optedOut.variables.withTrackedWorkSummary).toBe(false);
  });

  it("reads sections only for the keys it asks for", async () => {
    const none = await read({});
    const some = await read({
      includeSectionKeys: ["requirements", "description"],
    });

    expect(none.variables.withSections).toBe(false);
    expect(some.variables).toMatchObject({
      withSections: true,
      sectionKeys: ["description", "requirements"],
    });
  });
});

describe("single work-item reads", () => {
  it("returns the item with the launch config it carries", async () => {
    const config = {
      kind: "INITIAL_WORKTREE",
      version: "v1",
      initialWorktreeBranch: "feature/launch-default",
    };
    const server = new FakeWorkItemServer([
      {
        id: "task-1",
        name: "Configured",
        type: "STANDARD",
        status: "BACKLOG",
        config,
      },
    ]);

    const item = await fetchWorkItem(server.graphql.apollo, scope, "task-1");

    expect(item.config).toEqual(config);
  });

  it("rejects an item the project does not hold", async () => {
    const server = new FakeWorkItemServer([]);

    await expect(
      fetchWorkItem(server.graphql.apollo, scope, "missing"),
    ).rejects.toBeDefined();
  });
});

describe("task hierarchy reads", () => {
  it("returns a MODE hierarchy as the server sent it, with type and sections unchanged", async () => {
    const sections = [
      {
        id: "mode-description",
        key: "description",
        order: 0,
        materializedMarkdown: "Choose this mode for review work.",
        materializedProposalId: "proposal-mode",
      },
      {
        id: "mode-files",
        key: "files",
        order: 1,
        materializedMarkdown: "{}",
        materializedProposalId: "proposal-mode",
      },
    ];
    const server = new FakeWorkItemServer([
      {
        id: "mode-1",
        name: "Review discipline",
        type: "MODE",
        status: "BACKLOG",
        sections: sections.map((section) => ({
          ...section,
          __typename: "WorkItemSection",
          crdtSnapshotSeq: null,
        })),
      },
    ]);

    const hierarchy = await fetchWorkItemHierarchy(
      server.graphql.apollo,
      scope,
      "mode-1",
      { includeDesignDocCounts: true },
    );

    expect(server.received("GetWorkItemHierarchy")[0]).toMatchObject({
      id: "mode-1",
      includeDesignDocCounts: true,
      includeAgentSessionCounts: false,
    });
    expect(hierarchy.task.type).toBe("MODE");
    expect(hierarchy.task.sections).toEqual(
      sections.map((section) => ({ ...section, crdtSnapshotSeq: null })),
    );
    expect(hierarchy.parent).toBeUndefined();
    expect(hierarchy.children).toEqual([]);
  });
});

describe("optimistic registry section materialization", () => {
  it("retains a project-defined key and rewrites order from the definition", () => {
    const selection = selectWorkItemSections({
      typeKey: "RESEARCH",
      isFetched: true,
      definition: {
        key: "RESEARCH",
        name: "Research",
        sections: [
          { key: "sources", label: "Sources" },
          { key: "findings", label: "Findings" },
        ],
        statuses: legacyStatuses([]),
      },
    });

    expect(
      applyTaskSectionInputsToMaterialized(
        undefined,
        [{ key: "findings", content: "Result", order: 42 }],
        selection,
      ),
    ).toEqual([
      {
        id: "temp-findings",
        key: "findings",
        order: 1,
        materializedMarkdown: "Result",
        materializedProposalId: "",
        crdtSnapshotSeq: null,
      },
    ]);
  });
});
