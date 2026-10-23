import React from "react";
import { act, render } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ValidationCapsuleAction } from "../ValidationCapsuleAction";
import { ParentTaskValidationCapsuleAction } from "../ParentTaskValidationCapsuleAction";
import { ActionsCapsuleProvider } from "../../ActionsCapsuleProvider";
import { useActionsCapsule } from "../../ActionsCapsuleContext";

const mockLaunch = vi.fn().mockResolvedValue({ id: "session-validation-1" });
const useValidationLauncherMock = vi.fn(() => ({
  launch: mockLaunch,
  isPending: false,
  error: null,
}));

vi.mock("../../../AgentSession/useValidationLauncher", () => ({
  useValidationLauncher: (input: unknown) => useValidationLauncherMock(input),
}));

const useTaskHierarchyMock = vi.fn();

vi.mock("../../../../data/hooks/useTaskHierarchy", () => ({
  useTaskHierarchy: (...args: unknown[]) => useTaskHierarchyMock(...args),
}));

interface RegisteredAction {
  id: string;
  behavior: string;
  label?: string;
  onClick?: () => void;
}

const ActionsHarness: React.FC<{
  onActions: (actions: RegisteredAction[]) => void;
}> = ({ onActions }) => {
  const ctx = useActionsCapsule();
  React.useEffect(() => {
    onActions(ctx.actions as unknown as RegisteredAction[]);
  }, [ctx.actions, onActions]);
  return null;
};

const renderWithProvider = (ui: React.ReactNode) =>
  render(<ActionsCapsuleProvider>{ui}</ActionsCapsuleProvider>);

beforeEach(() => {
  mockLaunch.mockClear();
  useValidationLauncherMock.mockClear();
  useTaskHierarchyMock.mockReset();
});

describe("ValidationCapsuleAction", () => {
  it("registers a click-behavior action that launches with scope=task", async () => {
    const snapshots: RegisteredAction[][] = [];
    renderWithProvider(
      <>
        <ValidationCapsuleAction
          scope="task"
          entityId="task-1"
          organizationId="org-1"
          projectId="proj-1"
        />
        <ActionsHarness onActions={(actions) => snapshots.push(actions)} />
      </>
    );

    const latest = snapshots[snapshots.length - 1]!;
    expect(latest).toHaveLength(1);
    expect(latest[0]!.id).toBe("validation-task");
    expect(latest[0]!.behavior).toBe("click");

    await act(async () => {
      latest[0]!.onClick?.();
    });

    expect(mockLaunch).toHaveBeenCalledTimes(1);
    expect(mockLaunch).toHaveBeenCalledWith({
      scope: "task",
      entityId: "task-1",
    });
  });

  it("registers a plan_stage entry that launches with the stage id as entityId", async () => {
    const snapshots: RegisteredAction[][] = [];
    renderWithProvider(
      <>
        <ValidationCapsuleAction
          scope="plan_stage"
          entityId="stage-9"
          planId="plan-3"
          organizationId="org-1"
          projectId="proj-1"
        />
        <ActionsHarness onActions={(actions) => snapshots.push(actions)} />
      </>
    );

    const latest = snapshots[snapshots.length - 1]!;
    expect(latest).toHaveLength(1);
    expect(latest[0]!.id).toBe("validation-plan_stage");

    await act(async () => {
      latest[0]!.onClick?.();
    });

    expect(mockLaunch).toHaveBeenCalledWith({
      scope: "plan_stage",
      entityId: "stage-9",
      planId: "plan-3",
    });
  });

  it("does not register when disabled or missing identifiers", () => {
    const snapshots: RegisteredAction[][] = [];
    renderWithProvider(
      <>
        <ValidationCapsuleAction
          scope="task"
          entityId="task-1"
          organizationId=""
          projectId="proj-1"
        />
        <ActionsHarness onActions={(actions) => snapshots.push(actions)} />
      </>
    );

    const latest = snapshots[snapshots.length - 1]!;
    expect(latest).toHaveLength(0);
  });
});

describe("ParentTaskValidationCapsuleAction", () => {
  it("does not register when the parent task has no children", () => {
    useTaskHierarchyMock.mockReturnValue({
      children: [],
      isFetched: true,
    });

    const snapshots: RegisteredAction[][] = [];
    renderWithProvider(
      <>
        <ParentTaskValidationCapsuleAction
          taskId="parent-1"
          organizationId="org-1"
          projectId="proj-1"
        />
        <ActionsHarness onActions={(actions) => snapshots.push(actions)} />
      </>
    );

    const latest = snapshots[snapshots.length - 1]!;
    expect(latest).toHaveLength(0);
  });

  it("registers a parent_task entry when the task has at least one child", async () => {
    useTaskHierarchyMock.mockReturnValue({
      children: [{ id: "child-1" }],
      isFetched: true,
    });

    const snapshots: RegisteredAction[][] = [];
    renderWithProvider(
      <>
        <ParentTaskValidationCapsuleAction
          taskId="parent-1"
          organizationId="org-1"
          projectId="proj-1"
        />
        <ActionsHarness onActions={(actions) => snapshots.push(actions)} />
      </>
    );

    const latest = snapshots[snapshots.length - 1]!;
    expect(latest).toHaveLength(1);
    expect(latest[0]!.id).toBe("validation-parent_task");

    await act(async () => {
      latest[0]!.onClick?.();
    });

    expect(mockLaunch).toHaveBeenCalledWith({
      scope: "parent_task",
      entityId: "parent-1",
      taskId: "parent-1",
    });
  });
});
