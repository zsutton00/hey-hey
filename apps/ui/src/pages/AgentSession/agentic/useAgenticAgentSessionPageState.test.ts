import { describe, expect, it } from "vitest";
import { EntityType } from "@hey-hey/ui-common/api";
import { isTask } from "@hey-hey/ui-common/data";
import {
  captureSetupLaunchContext,
  resolveCanonicalPlanWorktreeBranch,
  resolveAgenticSetupReadState,
  resolveAgentSessionTaskId,
  resolveSessionMachineId,
  resolveTaskServiceIds,
} from "./useAgenticAgentSessionPageState";

describe("resolveTaskServiceIds", () => {
  it("preserves the complete task Service relation set for setup", () => {
    expect(
      resolveTaskServiceIds({
        serviceRelations: [
          { serviceId: "service-ui" },
          { serviceId: "service-api" },
          { serviceId: "service-worker" },
        ],
      }),
    ).toEqual(["service-ui", "service-api", "service-worker"]);
  });

  it("returns an empty scope when the session has no task", () => {
    expect(resolveTaskServiceIds(null)).toEqual([]);
  });
});

describe("resolveAgentSessionTaskId", () => {
  it.each(["BUG", "STANDARD"])(
    "accepts a %s work item as the general session parent",
    (type) => {
      const parent = { id: "associated-task", type };
      expect(isTask(parent as Parameters<typeof isTask>[0])).toBe(true);
      expect(
        resolveAgentSessionTaskId({
          agentSessionEntityType: EntityType.Task,
          agentSessionEntityId: parent.id,
        })
      ).toBe(parent.id);
    }
  );
  it("uses the direct Task route as the setup identity", () => {
    expect(
      resolveAgentSessionTaskId({
        routeTaskId: "task-from-route",
        agentSessionEntityType: null,
        agentSessionEntityId: null,
      }),
    ).toBe("task-from-route");
  });

  it("falls back to the attached Task when no direct Task route exists", () => {
    expect(
      resolveAgentSessionTaskId({
        agentSessionEntityType: EntityType.Task,
        agentSessionEntityId: "task-from-session",
      }),
    ).toBe("task-from-session");
  });

  it("does not treat another session entity as a Task", () => {
    expect(
      resolveAgentSessionTaskId({
        agentSessionEntityType: EntityType.Project,
        agentSessionEntityId: "plan-1",
      }),
    ).toBeNull();
  });
});

describe("resolveCanonicalPlanWorktreeBranch", () => {
  it("returns the configured branch for the matching canonical Plan", () => {
    expect(
      resolveCanonicalPlanWorktreeBranch({
        planId: "plan-1",
        aggregate: {
          plan: { id: "plan-1" },
          configuration: { worktreeBranch: "plan/release" },
        },
      }),
    ).toBe("plan/release");
  });

  it("preserves the editable path for a matching branchless Plan", () => {
    expect(
      resolveCanonicalPlanWorktreeBranch({
        planId: "plan-1",
        aggregate: {
          plan: { id: "plan-1" },
          configuration: { worktreeBranch: null },
        },
      }),
    ).toBeNull();
  });

  it("does not borrow a branch from a stale aggregate for another Plan", () => {
    expect(
      resolveCanonicalPlanWorktreeBranch({
        planId: "plan-2",
        aggregate: {
          plan: { id: "plan-1" },
          configuration: { worktreeBranch: "plan/release" },
        },
      }),
    ).toBeNull();
  });
});

describe("resolveSessionMachineId", () => {
  it("uses the sole execution-ready machine when launch state has no explicit target", () => {
    expect(
      resolveSessionMachineId({
        routeMachineId: null,
        submittedMachineId: null,
        persistedMachineId: null,
        executionReadyMachineIds: ["machine-1"],
        machinesReady: true,
      }),
    ).toBe("machine-1");
  });

  it("preserves an explicit target when several machines are ready", () => {
    expect(
      resolveSessionMachineId({
        routeMachineId: "machine-2",
        submittedMachineId: null,
        persistedMachineId: null,
        executionReadyMachineIds: ["machine-1", "machine-2"],
        machinesReady: true,
      }),
    ).toBe("machine-2");
  });

  it("waits for the machine collection before auto-selecting", () => {
    expect(
      resolveSessionMachineId({
        routeMachineId: null,
        submittedMachineId: null,
        persistedMachineId: null,
        executionReadyMachineIds: ["machine-1"],
        machinesReady: false,
      }),
    ).toBeNull();
  });
});

describe("captureSetupLaunchContext", () => {
  it("preserves setup metadata for the first active-session render", () => {
    expect(
      captureSetupLaunchContext({
        planData: {
          id: "plan-1",
          title: "Release plan",
          description: "Ship the release",
        },
        planWorktreeBranch: "plan/release",
        launchContext: {
          launchSource: "plan-step",
          launchPlanId: "plan-1",
          launchStepId: "step-1",
          launchStageId: "stage-1",
        },
      }),
    ).toEqual({
      planData: {
        id: "plan-1",
        title: "Release plan",
        description: "Ship the release",
      },
      planWorktreeBranch: "plan/release",
      launchSource: "plan-step",
      launchPlanId: "plan-1",
      launchStepId: "step-1",
      launchStageId: "stage-1",
    });
  });

  it("captures the exact Plan branch for a direct Plan-owned Task launch", () => {
    expect(
      captureSetupLaunchContext({
        planData: {
          id: "plan-1",
          title: "Release plan",
          description: "Ship the release",
        },
        planWorktreeBranch: "plan/release",
        launchContext: {
          launchSource: "task",
          launchPlanId: "plan-1",
          launchStepId: null,
          launchStageId: null,
        },
      }),
    ).toMatchObject({
      planWorktreeBranch: "plan/release",
      launchSource: "task",
      launchPlanId: "plan-1",
      launchStepId: null,
      launchStageId: null,
    });
  });
});

describe("resolveAgenticSetupReadState", () => {
  it("ignores a missing-scope plan error when setup has no plan", () => {
    expect(
      resolveAgenticSetupReadState({
        requiresTask: false,
        taskLoading: false,
        taskFetched: false,
        taskError: null,
        requiresContext: false,
        contextFetched: false,
        contextError: null,
        requiresPlan: false,
        planLoading: false,
        planError: "Plan scope identifiers are required.",
      }),
    ).toEqual({ loading: false, fetched: true, error: null });
  });

  it("surfaces a plan failure when setup requires that plan", () => {
    expect(
      resolveAgenticSetupReadState({
        requiresTask: false,
        taskLoading: false,
        taskFetched: false,
        taskError: null,
        requiresContext: false,
        contextFetched: false,
        contextError: null,
        requiresPlan: true,
        planLoading: false,
        planError: "Plan unavailable",
      }),
    ).toEqual({ loading: false, fetched: true, error: "Plan unavailable" });
  });
});
