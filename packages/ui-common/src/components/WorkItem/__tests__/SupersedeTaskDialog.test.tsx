import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UpdateTaskResponseDto } from "../../../api";
import type { UseSupersedeTaskReturn } from "../../../data/hooks";

vi.mock("../../../data/hooks", () => ({
  useSupersedeTask: vi.fn(),
}));

vi.mock("../../Selectors/TaskSelector", () => ({
  TaskSelector: ({
    value,
    onChange,
  }: {
    value: string | null;
    onChange: (taskId: string | null) => void;
  }) => (
    <button
      type="button"
      data-testid="successor-task-selector"
      onClick={() => onChange("successor-1")}
    >
      {value ?? "no successor"}
    </button>
  ),
}));

import { useSupersedeTask } from "../../../data/hooks";
import { SupersedeTaskDialog } from "../SupersedeTaskDialog";

const mockedUseSupersedeTask = vi.mocked(useSupersedeTask);

const supersedeResult = {
  status: "APPLIED",
  task: { id: "task-1" },
} as unknown as UpdateTaskResponseDto;

const setSupersedeHook = (
  overrides: Partial<UseSupersedeTaskReturn> = {}
): ReturnType<typeof vi.fn> => {
  const supersede = vi.fn().mockResolvedValue(supersedeResult);
  mockedUseSupersedeTask.mockReturnValue({
    supersede,
    isLoading: false,
    error: null,
    ...overrides,
  } as UseSupersedeTaskReturn);
  return supersede;
};

describe("SupersedeTaskDialog", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("keeps the supersede action disabled until a successor is chosen", async () => {
    setSupersedeHook();
    render(
      <SupersedeTaskDialog
        open
        organizationId="org-1"
        projectId="project-1"
        taskId="task-1"
        onClose={vi.fn()}
      />
    );

    expect(screen.getByTestId("supersede-task-confirm")).toBeDisabled();

    await userEvent.click(screen.getByTestId("successor-task-selector"));

    expect(screen.getByTestId("supersede-task-confirm")).toBeEnabled();
  });

  it("runs the atomic supersede transition with the chosen successor", async () => {
    const supersede = setSupersedeHook();
    const onClose = vi.fn();
    const onSuperseded = vi.fn();
    render(
      <SupersedeTaskDialog
        open
        organizationId="org-1"
        projectId="project-1"
        taskId="task-1"
        onClose={onClose}
        onSuperseded={onSuperseded}
      />
    );

    await userEvent.click(screen.getByTestId("successor-task-selector"));
    await userEvent.click(screen.getByTestId("supersede-task-confirm"));

    expect(supersede).toHaveBeenCalledWith("task-1", "successor-1");
    await waitFor(() => {
      expect(onSuperseded).toHaveBeenCalledWith(supersedeResult);
      expect(onClose).toHaveBeenCalled();
    });
  });

  it("surfaces a supersede failure inline", () => {
    setSupersedeHook({ error: "Successor task not found." });
    render(
      <SupersedeTaskDialog
        open
        organizationId="org-1"
        projectId="project-1"
        taskId="task-1"
        onClose={vi.fn()}
      />
    );

    expect(screen.getByTestId("supersede-task-error")).toHaveTextContent(
      "Successor task not found."
    );
  });
});
