import { act, renderHook } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi, type Mock } from "vitest";
import {
  AgentSessionStatus,
  AgentSessionType,
  EntityType,
  ValidationLaunchContextScopeEnum,
  type AgentSessionDto,
} from "../../../api";
import { useValidationLauncher } from "../useValidationLauncher";

const mutateMock = vi.fn();

vi.mock("../../../data/hooks/useCreateAgentSession", () => ({
  useCreateAgentSession: vi.fn(),
}));

import { useCreateAgentSession } from "../../../data/hooks/useCreateAgentSession";

const mockedUseCreateAgentSession = useCreateAgentSession as unknown as Mock;

const buildSession = (
  overrides: Partial<AgentSessionDto> = {},
): AgentSessionDto => ({
  id: "session-validation-1",
  organizationId: "org-1",
  projectId: "proj-1",
  userId: "user-1",
  type: AgentSessionType.Validation,
  status: AgentSessionStatus.Started,
  sessionDate: "2026-05-12T00:00:00Z",
  createdAt: "2026-05-12T00:00:00Z",
  updatedAt: "2026-05-12T00:00:00Z",
  ...overrides,
});

let lastOptions: {
  onSuccess?: (s: AgentSessionDto) => void;
  onError?: (e: Error) => void;
} | null = null;

beforeEach(() => {
  vi.clearAllMocks();
  lastOptions = null;
  mockedUseCreateAgentSession.mockImplementation((options) => {
    lastOptions = options ?? {};
    return {
      mutate: mutateMock,
      isPending: false,
      isSuccess: false,
      isError: false,
      error: null,
    };
  });
});

describe("useValidationLauncher", () => {
  it("builds a CreateAgentSession payload with scope=task", async () => {
    const created = buildSession();
    mutateMock.mockResolvedValueOnce(created);

    const { result } = renderHook(() =>
      useValidationLauncher({ organizationId: "org-1", projectId: "proj-1" }),
    );

    let session: AgentSessionDto | null = null;
    await act(async () => {
      session = await result.current.launch({
        scope: ValidationLaunchContextScopeEnum.Task,
        entityId: "task-1",
        taskId: "task-1",
      });
    });

    expect(session).toBe(created);
    expect(mutateMock).toHaveBeenCalledTimes(1);
    const arg = mutateMock.mock.calls[0]![0] as {
      organizationId: string;
      agentSession: Record<string, unknown>;
    };
    expect(arg.organizationId).toBe("org-1");
    expect(arg.agentSession.projectId).toBe("proj-1");
    expect(arg.agentSession.type).toBe(AgentSessionType.Validation);
    expect(arg.agentSession.validationLaunchContext).toEqual({
      scope: "task",
      entityId: "task-1",
    });
    expect(arg.agentSession.entityType).toBe(EntityType.Task);
    expect(arg.agentSession.entityId).toBe("task-1");
  });

  it("builds a payload with scope=parent_task and stores the parent task id", async () => {
    mutateMock.mockResolvedValueOnce(buildSession());

    const { result } = renderHook(() =>
      useValidationLauncher({ organizationId: "org-1", projectId: "proj-1" }),
    );

    await act(async () => {
      await result.current.launch({
        scope: ValidationLaunchContextScopeEnum.ParentTask,
        entityId: "parent-task-7",
        taskId: "parent-task-7",
      });
    });

    const arg = mutateMock.mock.calls[0]![0] as {
      agentSession: Record<string, unknown>;
    };
    expect(arg.agentSession.validationLaunchContext).toEqual({
      scope: "parent_task",
      entityId: "parent-task-7",
    });
    expect(arg.agentSession.entityType).toBe(EntityType.Task);
    expect(arg.agentSession.entityId).toBe("parent-task-7");
  });

  it("builds a payload with scope=plan_stage and stores the plan id when provided", async () => {
    mutateMock.mockResolvedValueOnce(buildSession());

    const { result } = renderHook(() =>
      useValidationLauncher({ organizationId: "org-1", projectId: "proj-1" }),
    );

    await act(async () => {
      await result.current.launch({
        scope: ValidationLaunchContextScopeEnum.PlanStage,
        entityId: "stage-42",
        planId: "plan-3",
      });
    });

    const arg = mutateMock.mock.calls[0]![0] as {
      agentSession: Record<string, unknown>;
    };
    expect(arg.agentSession.validationLaunchContext).toEqual({
      scope: "plan_stage",
      entityId: "stage-42",
    });
    expect(arg.agentSession.entityType).toBe(EntityType.Task);
    expect(arg.agentSession.entityId).toBe("plan-3");
  });

  it("invokes onSessionCreated with the created session", async () => {
    const onSessionCreated = vi.fn();
    const created = buildSession({ id: "session-validation-7" });
    mutateMock.mockResolvedValueOnce(created);

    const { result } = renderHook(() =>
      useValidationLauncher({
        organizationId: "org-1",
        projectId: "proj-1",
        onSessionCreated,
      }),
    );

    await act(async () => {
      await result.current.launch({
        scope: ValidationLaunchContextScopeEnum.Task,
        entityId: "task-1",
      });
    });

    expect(lastOptions?.onSuccess).toBeDefined();
    lastOptions!.onSuccess!(created);
    expect(onSessionCreated).toHaveBeenCalledWith(created);
  });

  it("returns null and surfaces an error when required inputs are missing", async () => {
    const { result } = renderHook(() =>
      useValidationLauncher({ organizationId: "", projectId: "proj-1" }),
    );

    let session: AgentSessionDto | null = buildSession();
    await act(async () => {
      session = await result.current.launch({
        scope: ValidationLaunchContextScopeEnum.Task,
        entityId: "task-1",
      });
    });

    expect(session).toBeNull();
    expect(mutateMock).not.toHaveBeenCalled();
  });

  it("captures errors thrown by the mutation", async () => {
    mutateMock.mockRejectedValueOnce(new Error("boom"));

    const { result } = renderHook(() =>
      useValidationLauncher({ organizationId: "org-1", projectId: "proj-1" }),
    );

    let session: AgentSessionDto | null = buildSession();
    await act(async () => {
      session = await result.current.launch({
        scope: ValidationLaunchContextScopeEnum.Task,
        entityId: "task-1",
      });
    });

    expect(session).toBeNull();
    expect(result.current.error).toBe("boom");
  });
});
