import { renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AgentEdgeType,
  PlanConfigurationV1SchemaVersionEnum,
  PlanType,
  TaskSource,
  WorkStatus,
  type WorkItemTypeSummaryDto,
} from "../../api";
import { resetCapabilityCatalogForTests } from "../AgentSession/capabilityCatalog";
import {
  TASK_MONITOR_SETUP_SURFACE_ID,
  writeSurfaceSelection,
} from "../AgentSession/surfaceSelectionMemory";
import type {
  PlanStageStandardTask,
  PlanStageWorkItem,
  PlanWorkItem,
} from "./planStageTaskMonitorSetup";
import { usePlanStageTaskMonitorSetup } from "./usePlanStageTaskMonitorSetup";

const mocks = vi.hoisted(() => ({
  useWorkItem: vi.fn(),
  useWorkItems: vi.fn(),
  useWorkItemTypes: vi.fn(),
}));

vi.mock("../../data/hooks/useWorkItem", () => ({
  useWorkItem: mocks.useWorkItem,
}));
vi.mock("../../data/hooks/useWorkItems", () => ({
  useWorkItems: mocks.useWorkItems,
}));
vi.mock("../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypes: mocks.useWorkItemTypes,
}));

const organizationId = "org-1";
const projectId = "project-1";
const planId = "plan-1";
const stageId = "stage-1";

const plan = (worktreeBranch: string | null = null): PlanWorkItem => ({
  id: planId,
  name: "Feature delivery",
  type: "PLAN",
  parentTaskId: "feature-1",
  organizationId,
  projectId,
  status: WorkStatus.Active,
  source: TaskSource.User,
  sections: [
    {
      id: "configuration",
      key: "planConfiguration",
      order: 0,
      materializedMarkdown: JSON.stringify({
        schemaVersion: PlanConfigurationV1SchemaVersionEnum.PlanConfigurationV1,
        planType: PlanType.Standard,
        worktreeBranch,
      }),
    },
  ],
});

const stage: PlanStageWorkItem = {
  id: stageId,
  name: "Build",
  type: "PLAN_STAGE",
  parentTaskId: planId,
  organizationId,
  projectId,
  status: WorkStatus.Active,
  source: TaskSource.User,
};

const task: PlanStageStandardTask = {
  id: "11111111-1111-4111-8111-111111111111",
  name: "Implement",
  type: "STANDARD",
  parentTaskId: stageId,
  organizationId,
  projectId,
  status: WorkStatus.Ready,
  source: TaskSource.User,
};

const registryItem = (key: string): WorkItemTypeSummaryDto => ({
  id: `${key}-definition`,
  projectId,
  effectiveSource: "CANONICAL",
  status: "ACTIVE",
  definition: {
    key,
    name: key,
    sections:
      key === "PLAN"
        ? [{ key: "planConfiguration", label: "Plan configuration" }]
        : [],
    allowedStatuses: [WorkStatus.Backlog],
    allowedParentTypes:
      key === "PLAN"
        ? ["FEATURE"]
        : key === "PLAN_STAGE"
          ? ["PLAN"]
          : ["PLAN_STAGE"],
    capabilities: { requiresParent: true },
    edgeTargets:
      key === "PLAN_STAGE" || key === "STANDARD"
        ? [
            {
              edgeType: AgentEdgeType.DependsOn,
              targetTypeKeys: [key],
            },
          ]
        : [],
  },
});

const registry = [
  registryItem("PLAN"),
  registryItem("PLAN_STAGE"),
  registryItem("STANDARD"),
];

const collectionResult = (
  workItems: readonly (PlanStageWorkItem | PlanStageStandardTask)[],
) => ({
  workItems,
  isLoading: false,
  isFetching: false,
  isFetched: true,
  error: null,
  refetch: vi.fn(),
});

describe("usePlanStageTaskMonitorSetup", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    localStorage.clear();
    writeSurfaceSelection(TASK_MONITOR_SETUP_SURFACE_ID, {
      method: "quick",
      provider: "codex",
      model: "gpt-5.5",
      reasoningEffort: "medium",
    });
    mocks.useWorkItem.mockReturnValue({
      workItem: plan(),
      isLoading: false,
      isFetching: false,
      isFetched: true,
      error: null,
      refetch: vi.fn(),
    });
    mocks.useWorkItems.mockImplementation(
      (
        _organizationId: string,
        _entityType: string,
        _projectId: string,
        _conversationId: string | undefined,
        options: { parentTaskId?: string },
      ) =>
        options.parentTaskId === planId
          ? collectionResult([stage])
          : collectionResult([task]),
    );
    mocks.useWorkItemTypes.mockReturnValue({
      workItemTypes: registry,
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      refetch: vi.fn(),
    });
  });

  it("loads one canonical Plan aggregate without PlanStep or guidance reads", () => {
    const { result } = renderHook(() =>
      usePlanStageTaskMonitorSetup({
        organizationId,
        projectId,
        planId,
        stageId,
      }),
    );

    expect(mocks.useWorkItem).toHaveBeenCalledWith(
      organizationId,
      "task",
      planId,
      expect.objectContaining({ projectId, enabled: true }),
    );
    expect(mocks.useWorkItems).toHaveBeenNthCalledWith(
      1,
      organizationId,
      "task",
      projectId,
      undefined,
      expect.objectContaining({
        parentTaskId: planId,
      }),
    );
    expect(mocks.useWorkItems).toHaveBeenNthCalledWith(
      2,
      organizationId,
      "task",
      projectId,
      undefined,
      expect.objectContaining({
        parentTaskId: stageId,
        includeEdges: true,
        includeServiceRelations: true,
      }),
    );
    expect(result.current.state.status).toBe("ready");
    expect(
      result.current.setup?.definition.launchPolicy.terminalSupervision,
    ).toEqual({
      mode: "AGENT_DECIDES",
    });
    expect(result.current.setup?.definition).not.toHaveProperty("status");
    expect(result.current.setup?.definition.executionPlan).toEqual([
      expect.objectContaining({
        taskId: task.id,
        dependsOnTaskIds: [],
        launchConfiguration: expect.objectContaining({ fastMode: false }),
      }),
    ]);
    expect(result.current.setup?.executableTasks[0]).not.toHaveProperty(
      "stepId",
    );
  });

  it.each([
    ["absent", undefined, false],
    ["remembered true", true, true],
    ["remembered false", false, false],
  ] as const)(
    "seeds a supported node with %s Fast mode intent",
    (_label, rememberedFastMode, expectedFastMode) => {
      if (rememberedFastMode === undefined) {
        writeSurfaceSelection(TASK_MONITOR_SETUP_SURFACE_ID, {
          provider: "codex",
          model: "gpt-5.5",
          reasoningEffort: "medium",
        });
      } else {
        writeSurfaceSelection(TASK_MONITOR_SETUP_SURFACE_ID, {
          provider: "codex",
          model: "gpt-5.5",
          reasoningEffort: "medium",
          fastMode: rememberedFastMode,
        });
      }

      const { result } = renderHook(() =>
        usePlanStageTaskMonitorSetup({
          organizationId,
          projectId,
          planId,
          stageId,
        }),
      );

      expect(
        result.current.setup?.definition.executionPlan[0]?.launchConfiguration
          .fastMode,
      ).toBe(expectedFastMode);
    },
  );

  it("omits stale Fast mode intent for an unsupported selection", () => {
    writeSurfaceSelection(TASK_MONITOR_SETUP_SURFACE_ID, {
      provider: "claude",
      model: "claude-sonnet-5-5",
      reasoningEffort: "high",
      fastMode: true,
    });

    const { result } = renderHook(() =>
      usePlanStageTaskMonitorSetup({
        organizationId,
        projectId,
        planId,
        stageId,
      }),
    );

    expect(
      result.current.setup?.definition.executionPlan[0]?.launchConfiguration,
    ).not.toHaveProperty("fastMode");
  });

  it("fails closed while required effective registry definitions are absent", () => {
    mocks.useWorkItemTypes.mockReturnValue({
      workItemTypes: [registryItem("STANDARD")],
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() =>
      usePlanStageTaskMonitorSetup({
        organizationId,
        projectId,
        planId,
        stageId,
      }),
    );

    expect(result.current.state).toEqual({
      status: "invalid-source",
      messages: [
        "The effective Work Item type registry is missing PLAN, PLAN_STAGE.",
      ],
    });
  });

  it("fails closed when the effective registry has invalid Plan parentage", () => {
    mocks.useWorkItemTypes.mockReturnValue({
      workItemTypes: registry.map((item) =>
        item.definition.key === "PLAN_STAGE"
          ? {
              ...item,
              definition: {
                ...item.definition,
                allowedParentTypes: ["FEATURE"],
              },
            }
          : item,
      ),
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() =>
      usePlanStageTaskMonitorSetup({
        organizationId,
        projectId,
        planId,
        stageId,
      }),
    );

    expect(result.current.state).toEqual({
      status: "invalid-source",
      messages: [
        "PLAN_STAGE must require a PLAN parent in the effective Work Item type registry.",
      ],
    });
  });

  it("reports canonical read failures without composing a draft", () => {
    mocks.useWorkItems
      .mockReturnValueOnce(collectionResult([stage]))
      .mockReturnValueOnce({
        workItems: [],
        isLoading: false,
        isFetching: false,
        isFetched: true,
        error: new Error("hierarchy read failed"),
        refetch: vi.fn(),
      });

    const { result } = renderHook(() =>
      usePlanStageTaskMonitorSetup({
        organizationId,
        projectId,
        planId,
        stageId,
      }),
    );

    expect(result.current.state).toEqual({
      status: "read-error",
      message: "hierarchy read failed",
    });
    expect(result.current.setup).toBeNull();
  });

  it("reports a Stage outside the loaded Plan hierarchy", () => {
    mocks.useWorkItems
      .mockReturnValueOnce(collectionResult([]))
      .mockReturnValueOnce(collectionResult([task]));

    const { result } = renderHook(() =>
      usePlanStageTaskMonitorSetup({
        organizationId,
        projectId,
        planId,
        stageId,
      }),
    );

    expect(result.current.state).toEqual({
      status: "invalid-source",
      messages: ["The selected Plan Stage is unavailable."],
    });
  });

  it("carries the schema-backed Plan branch into the launch policy", () => {
    mocks.useWorkItem.mockReturnValue({
      workItem: plan("plan/shared-branch"),
      isLoading: false,
      isFetching: false,
      isFetched: true,
      error: null,
      refetch: vi.fn(),
    });

    const { result } = renderHook(() =>
      usePlanStageTaskMonitorSetup({
        organizationId,
        projectId,
        planId,
        stageId,
      }),
    );

    expect(result.current.setup?.provenance.planWorktreeBranch).toBe(
      "plan/shared-branch",
    );
    expect(result.current.setup?.definition.launchPolicy.worktree).toEqual({
      enabled: true,
      branch: "plan/shared-branch",
    });
  });

  it("composes no draft until a machine's CLI has reported its models", () => {
    resetCapabilityCatalogForTests();

    const { result } = renderHook(() =>
      usePlanStageTaskMonitorSetup({
        organizationId,
        projectId,
        planId,
        stageId,
      }),
    );

    expect(result.current.catalogSource).toBeNull();
    expect(result.current.setup).toBeNull();
    expect(result.current.state).toEqual({
      status: "read-error",
      message:
        "Select a machine to see the models its CLI can launch for this Task Monitor.",
    });
  });
});
