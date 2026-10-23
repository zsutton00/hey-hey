import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkStatus } from "../../../api";

vi.mock("../../../data/hooks", () => ({
  useTaskAllowedStatuses: vi.fn(),
}));

vi.mock("../../WorkItem/SupersedeTaskDialog", () => ({
  SupersedeTaskDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="supersede-dialog" /> : null,
}));

import { useTaskAllowedStatuses } from "../../../data/hooks";
import { WorkItemStatusSelector } from "../WorkItemStatusSelector";

const mockedUseTaskAllowedStatuses = vi.mocked(useTaskAllowedStatuses);

const mockAllowedStatuses = (statuses: WorkStatus[]): void => {
  mockedUseTaskAllowedStatuses.mockReturnValue({
    isLoading: false,
    error: null,
    getAllowedStatuses: () => statuses,
  });
};

const STANDARD_ALLOWED: WorkStatus[] = [
  WorkStatus.Backlog,
  WorkStatus.Active,
  WorkStatus.Completed,
  WorkStatus.Cancelled,
  WorkStatus.Superseded,
];

describe("WorkItemStatusSelector", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockAllowedStatuses(STANDARD_ALLOWED);
  });

  it("renders the per-type allowed statuses from the backend", async () => {
    render(
      <WorkItemStatusSelector
        value={WorkStatus.Backlog}
        onChange={vi.fn()}
        organizationId="org-1"
        projectId="project-1"
        taskId="task-1"
      />
    );

    await userEvent.click(screen.getByRole("combobox"));

    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.getByText("Completed")).toBeInTheDocument();
    expect(screen.getByText("Cancelled")).toBeInTheDocument();
    expect(screen.getByText("Superseded")).toBeInTheDocument();
  });

  it("hides system-managed generating/refining statuses returned by the backend", async () => {
    mockAllowedStatuses([
      WorkStatus.Generated,
      WorkStatus.RefiningDescription,
      WorkStatus.GeneratingDescription,
      WorkStatus.Backlog,
      WorkStatus.Active,
    ]);
    render(
      <WorkItemStatusSelector
        value={WorkStatus.Backlog}
        onChange={vi.fn()}
        organizationId="org-1"
        projectId="project-1"
        taskId="task-1"
      />
    );

    await userEvent.click(screen.getByRole("combobox"));

    expect(screen.getByText("In progress")).toBeInTheDocument();
    expect(screen.queryByText("Needs review")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Generating description")
    ).not.toBeInTheDocument();
  });

  it("forwards a normal status selection to onChange", async () => {
    const onChange = vi.fn();
    render(
      <WorkItemStatusSelector
        value={WorkStatus.Backlog}
        onChange={onChange}
        organizationId="org-1"
        projectId="project-1"
        taskId="task-1"
      />
    );

    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(screen.getByText("Completed"));

    expect(onChange).toHaveBeenCalledWith(WorkStatus.Completed);
  });

  it("routes a SUPERSEDED selection to the dialog and never to onChange", async () => {
    const onChange = vi.fn();
    render(
      <WorkItemStatusSelector
        value={WorkStatus.Backlog}
        onChange={onChange}
        organizationId="org-1"
        projectId="project-1"
        taskId="task-1"
      />
    );

    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(screen.getByText("Superseded"));

    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("supersede-dialog")).toBeInTheDocument();
  });

  it("omits SUPERSEDED when there is no task to supersede", async () => {
    render(
      <WorkItemStatusSelector
        value={WorkStatus.Backlog}
        onChange={vi.fn()}
        organizationId="org-1"
        projectId="project-1"
      />
    );

    await userEvent.click(screen.getByRole("combobox"));

    expect(screen.queryByText("Superseded")).not.toBeInTheDocument();
    expect(screen.getByText("In progress")).toBeInTheDocument();
  });

  it("displays Active as 'Ready' for feature tasks", () => {
    mockAllowedStatuses([WorkStatus.Active]);
    render(
      <WorkItemStatusSelector
        value={WorkStatus.Active}
        onChange={vi.fn()}
        organizationId="org-1"
        projectId="project-1"
        taskType={"FEATURE"}
      />
    );

    expect(screen.getByText("Ready")).toBeInTheDocument();
  });
});

it("labels Plan BACKLOG as Draft but submits the canonical BACKLOG value", async () => {
  mockAllowedStatuses([WorkStatus.Backlog, WorkStatus.Ready]);
  const onChange = vi.fn();
  render(
    <WorkItemStatusSelector
      value={WorkStatus.Ready}
      onChange={onChange}
      organizationId="org-1"
      projectId="project-1"
      taskType="PLAN"
    />
  );
  await userEvent.click(screen.getByRole("combobox"));
  await userEvent.click(screen.getByRole("option", { name: "Draft" }));
  expect(onChange).toHaveBeenCalledWith(WorkStatus.Backlog);
});
it("keeps ordinary task BACKLOG labeled Backlog", () => {
  mockAllowedStatuses(STANDARD_ALLOWED);
  render(
    <WorkItemStatusSelector
      value={WorkStatus.Backlog}
      onChange={vi.fn()}
      organizationId="org-1"
      projectId="project-1"
      taskType="STANDARD"
    />
  );
  expect(screen.getByText("Backlog")).toBeInTheDocument();
  expect(screen.queryByText("Draft")).not.toBeInTheDocument();
});
