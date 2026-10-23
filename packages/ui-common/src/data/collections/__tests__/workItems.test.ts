import { QueryClient } from "@tanstack/react-query";
import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  AgentEdgeCategory,
  AgentEdgeEndpointEntityType,
  AgentEdgeType,
  TaskSource,
  WorkStatus,
  type TaskResponseDto,
} from "../../../api";
import { isPlanWorkItem } from "../workItems";
import {
  workItemDetailQueryOptions,
  workItemHierarchyQueryOptions,
  workItemKeys,
  workItemListQueryOptions,
} from "../workItemLists";

vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: {
    getTask: vi.fn(),
    getTasks: vi.fn(),
  },
  tasksClient: {
    organizationsOrganizationIdProjectsProjectIdTasksTaskIdHierarchyGet:
      vi.fn(),
  },
}));

vi.mock("../../../utils/logger", () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

import {
  tasksClient,
  unifiedApiClient,
} from "../../../clients/serviceClients";
import {
  applyTaskSectionInputsToMaterialized,
  selectWorkItemSections,
} from "../../../utils/workItemSections";

const mockedUnifiedApiClient = vi.mocked(unifiedApiClient);
const mockedTasksClient = vi.mocked(tasksClient);

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
  ...(overrides.config !== undefined ? { config: overrides.config } : {}),
  ...(overrides.parentTaskId !== undefined
    ? { parentTaskId: overrides.parentTaskId }
    : {}),
  edges: overrides.edges,
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

const createClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false } } });

/** Request options carry the abort signal and request initiator. */
const anyRequestOptions = expect.objectContaining({
  signal: expect.any(AbortSignal),
});

describe("work-item list keys", () => {
  it("normalizes id sets and keeps hydration variants in the key", () => {
    const first = workItemKeys.list("org-1", "project-1", {
      taskIds: ["task-b", "task-a", "task-b"],
      includeServiceRelations: true,
      includeEdges: true,
    });
    const second = workItemKeys.list("org-1", "project-1", {
      taskIds: ["task-a", "task-b"],
      includeServiceRelations: true,
      includeEdges: true,
    });

    expect(first).toEqual(second);
    expect(first[4]).toMatchObject({
      taskIds: ["task-a", "task-b"],
      includeServiceRelations: true,
      includeEdges: true,
    });
    expect(first[4]).not.toEqual(
      workItemKeys.list("org-1", "project-1", { taskIds: ["task-a", "task-b"] })[4]
    );
  });

  it("distinguishes no parent filter from root items only", () => {
    const unfiltered = workItemKeys.list("org-1", "project-1", {});
    const rootOnly = workItemKeys.list("org-1", "project-1", {
      parentTaskId: null,
    });
    expect(unfiltered[4].parentTaskId).toBeNull();
    expect(rootOnly[4].parentTaskId).toBe("null");
  });

  it("keeps initiativeId '' and null as today's distinct keys", () => {
    expect(
      workItemKeys.list("org-1", "project-1", { initiativeId: "" })[4]
        .initiativeId
    ).toBe("");
    expect(
      workItemKeys.list("org-1", "project-1", {})[4].initiativeId
    ).toBeNull();
  });

  it("serves a status filter over a complete list from the unfiltered entry", () => {
    const active = workItemKeys.list("org-1", "project-1", {
      taskType: "GOAL",
      status: [WorkStatus.Active],
    });
    const all = workItemKeys.list("org-1", "project-1", { taskType: "GOAL" });
    expect(active).toEqual(all);
  });

  it("keeps the status filter server-side for paged, limited or archived reads", () => {
    const all = workItemKeys.list("org-1", "project-1", { taskType: "GOAL" });
    for (const params of [
      { status: [WorkStatus.Active], page: 1 },
      { status: [WorkStatus.Active], limit: 5 },
      { status: [WorkStatus.Archived] },
      { status: [WorkStatus.Superseded, WorkStatus.Active] },
    ]) {
      const key = workItemKeys.list("org-1", "project-1", {
        taskType: "GOAL",
        ...params,
      });
      expect(key).not.toEqual(all);
      expect(key[4].status).not.toBeNull();
    }
  });

  it("sits every work-item read under one project prefix", () => {
    const project = workItemKeys.project("org-1", "project-1");
    for (const key of [
      workItemKeys.list("org-1", "project-1", {}),
      workItemKeys.detail("org-1", "project-1", "task-1"),
      workItemKeys.hierarchy("org-1", "project-1", "task-1"),
    ]) {
      expect(key.slice(0, project.length)).toEqual(project);
    }
  });
});

describe("work-item list reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards connected-entity filters without edge hydration", async () => {
    mockedUnifiedApiClient.getTasks.mockResolvedValue({
      data: {
        data: [
          makeTask({ id: "monitor-1", name: "Monitor one", type: "TASK_MONITOR" }),
        ],
      },
    } as any);

    await createClient().fetchQuery(
      workItemListQueryOptions("org-1", "project-1", {
        taskType: "TASK_MONITOR",
        relatedEntityId: "plan-1",
        relatedEntityType: AgentEdgeEndpointEntityType.Task,
        edgeTypes: [AgentEdgeType.RelatedTo],
      })
    );

    expect(mockedUnifiedApiClient.getTasks).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "TASK_MONITOR",
        relatedEntityId: "plan-1",
        relatedEntityType: AgentEdgeEndpointEntityType.Task,
        edgeTypes: [AgentEdgeType.RelatedTo],
      }),
      anyRequestOptions
    );
    expect(mockedUnifiedApiClient.getTasks).toHaveBeenCalledWith(
      expect.not.objectContaining({ includeEdges: true }),
      anyRequestOptions
    );
  });

  it("defaults the tracked-entity projection on and forwards an opt-out", async () => {
    mockedUnifiedApiClient.getTasks.mockResolvedValue({ data: { data: [] } } as any);
    const client = createClient();

    await client.fetchQuery(
      workItemListQueryOptions("org-1", "project-1", { taskType: "GOAL" })
    );
    await client.fetchQuery(
      workItemListQueryOptions("org-1", "project-1", {
        taskType: "GOAL",
        includeTrackedEntities: false,
      })
    );

    expect(mockedUnifiedApiClient.getTasks).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ includeTrackedEntities: true }),
      anyRequestOptions
    );
    expect(mockedUnifiedApiClient.getTasks).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ includeTrackedEntities: false }),
      anyRequestOptions
    );
  });

  it("normalizes parent ids and forwards one batch read", async () => {
    mockedUnifiedApiClient.getTasks.mockResolvedValue({ data: { data: [] } } as any);

    await createClient().fetchQuery(
      workItemListQueryOptions("org-1", "project-1", {
        parentTaskIds: ["stage-2", "stage-1", "stage-1"],
        taskType: "STANDARD",
      })
    );

    expect(mockedUnifiedApiClient.getTasks).toHaveBeenCalledTimes(1);
    expect(mockedUnifiedApiClient.getTasks).toHaveBeenCalledWith(
      expect.objectContaining({
        parentTaskIds: ["stage-1", "stage-2"],
        type: "STANDARD",
      }),
      anyRequestOptions
    );
  });

  it("requests the tracked-work summary independently of snapshots", async () => {
    mockedUnifiedApiClient.getTasks.mockResolvedValue({ data: { data: [] } } as any);
    const summary = workItemListQueryOptions("org-1", "project-1", {
      taskType: "GOAL",
      includeTrackedEntities: false,
      includeTrackedWorkSummary: true,
    });
    const plain = workItemListQueryOptions("org-1", "project-1", {
      taskType: "GOAL",
      includeTrackedEntities: false,
    });

    await createClient().fetchQuery(summary);

    expect(summary.queryKey).not.toEqual(plain.queryKey);
    expect(mockedUnifiedApiClient.getTasks).toHaveBeenCalledWith(
      expect.objectContaining({
        includeTrackedEntities: false,
        includeTrackedWorkSummary: true,
      }),
      anyRequestOptions
    );
  });

  it("forwards a root-only parent filter as null", async () => {
    mockedUnifiedApiClient.getTasks.mockResolvedValue({ data: { data: [] } } as any);

    await createClient().fetchQuery(
      workItemListQueryOptions("org-1", "project-1", { parentTaskId: null })
    );

    expect(mockedUnifiedApiClient.getTasks).toHaveBeenCalledWith(
      expect.objectContaining({ parentTaskId: null }),
      anyRequestOptions
    );
  });

  it("filters a selected status locally from one unfiltered read", async () => {
    mockedUnifiedApiClient.getTasks.mockResolvedValue({
      data: {
        data: [
          makeTask({ id: "a", name: "A", status: WorkStatus.Active }),
          makeTask({ id: "b", name: "B", status: WorkStatus.Completed }),
        ],
      },
    } as any);
    const options = workItemListQueryOptions("org-1", "project-1", {
      status: [WorkStatus.Active],
    });

    const raw = await createClient().fetchQuery(options);

    expect(mockedUnifiedApiClient.getTasks).toHaveBeenCalledWith(
      expect.objectContaining({ status: undefined }),
      anyRequestOptions
    );
    expect(raw).toHaveLength(2);
    expect(options.select?.(raw).map((item) => item.id)).toEqual(["a"]);
  });
});

describe("single work-item reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("fetches without edge hydration by default", async () => {
    mockedUnifiedApiClient.getTask.mockResolvedValue({
      data: { data: makeTask({ id: "task-1", name: "Task one" }) },
    } as any);

    await createClient().fetchQuery(
      workItemDetailQueryOptions("org-1", "project-1", "task-1")
    );

    expect(mockedUnifiedApiClient.getTask).toHaveBeenCalledWith(
      {
        organizationId: "org-1",
        projectId: "project-1",
        taskId: "task-1",
        includeServiceRelations: false,
        includeEdges: false,
      },
      anyRequestOptions
    );
  });

  it("caches hydrated edge payloads under their own variant key", async () => {
    const workflow = makeTask({
      id: "workflow-1",
      name: "Launch workflow",
      type: "workflow",
      edges: [
        {
          id: "edge-1",
          sourceNodeId: "step-1",
          targetNodeId: "step-2",
          type: AgentEdgeType.Standard,
          category: AgentEdgeCategory.Flow,
          reasoning: "",
          createdAt: "2026-07-01T00:00:00.000Z",
          updatedAt: "2026-07-01T00:00:00.000Z",
        },
      ],
    });
    mockedUnifiedApiClient.getTask.mockResolvedValue({
      data: { data: workflow },
    } as any);
    const client = createClient();
    const options = workItemDetailQueryOptions(
      "org-1",
      "project-1",
      "workflow-1",
      {
        includeEdges: true,
        edgeTypes: [AgentEdgeType.Standard, AgentEdgeType.FulfilledBy],
      }
    );

    await client.fetchQuery(options);

    expect(mockedUnifiedApiClient.getTask).toHaveBeenCalledWith(
      expect.objectContaining({
        taskId: "workflow-1",
        includeEdges: true,
        edgeTypes: expect.arrayContaining([
          AgentEdgeType.Standard,
          AgentEdgeType.FulfilledBy,
        ]),
      }),
      anyRequestOptions
    );
    expect(client.getQueryData(options.queryKey)?.edges).toEqual(
      workflow.edges
    );
    expect(
      client.getQueryData(
        workItemKeys.detail("org-1", "project-1", "workflow-1")
      )
    ).toBeUndefined();
  });

  it("keeps launch config from a single work-item read", async () => {
    const config = {
      kind: "INITIAL_WORKTREE" as const,
      version: "v1" as const,
      initialWorktreeBranch: "feature/launch-default",
    };
    mockedUnifiedApiClient.getTask.mockResolvedValue({
      data: { data: makeTask({ id: "task-1", name: "Configured task", config }) },
    } as any);

    const item = await createClient().fetchQuery(
      workItemDetailQueryOptions("org-1", "project-1", "task-1")
    );

    expect(item?.config).toEqual(config);
  });
});

describe("task hierarchy reads", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("caches a MODE hierarchy as returned, with type and sections unchanged", async () => {
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
        materializedMarkdown: JSON.stringify({
          schemaVersion: "project-mode-files.v1",
          files: {
            "MODE.md": "Read this first.",
            "references/checklist.md": "Check the list.",
          },
        }),
        materializedProposalId: "proposal-mode",
      },
    ];
    const mode = makeTask({
      id: "mode-1",
      name: "Review discipline",
      type: "MODE",
      sections: sections as any,
    });
    mockedTasksClient.organizationsOrganizationIdProjectsProjectIdTasksTaskIdHierarchyGet.mockResolvedValue(
      { data: { data: { parent: undefined, task: mode, children: [] } } } as any
    );

    const hierarchy = await createClient().fetchQuery(
      workItemHierarchyQueryOptions("org-1", "project-1", "mode-1", {
        includeDesignDocCounts: true,
      })
    );

    expect(
      mockedTasksClient.organizationsOrganizationIdProjectsProjectIdTasksTaskIdHierarchyGet
    ).toHaveBeenCalledWith(
      {
        organizationId: "org-1",
        projectId: "project-1",
        taskId: "mode-1",
        includeDesignDocCounts: true,
        includeAgentSessionCounts: false,
      },
      anyRequestOptions
    );
    expect(hierarchy?.task).toEqual(mode);
    expect(hierarchy?.task.sections).toEqual(sections);
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
        allowedStatuses: [],
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

