import type { TaskResponseDto } from "../../../api/api";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkStatus } from "../../../api";

vi.mock("../../../data/hooks", () => ({
  useWorkItemTypeByKey: vi.fn(),
}));

vi.mock("../../WorkItem/SupersedeTaskDialog", () => ({
  SupersedeTaskDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="supersede-dialog" /> : null,
}));

import { useWorkItemTypeByKey } from "../../../data/hooks";
import { statusDefinition } from "../../../test/statusDefinitionFixture";
import { WorkItemStatusSelector } from "../WorkItemStatusSelector";

const mockedUseWorkItemTypeByKey = vi.mocked(useWorkItemTypeByKey);

const mockAllowedStatuses = (statuses: TaskResponseDto["status"][]): void => {
  mockedUseWorkItemTypeByKey.mockReturnValue({
    isLoading: false,
    workItemTypeDefinition: statusDefinition(statuses),
  } as never);
};

/** The statuses the built-in Feature and Plan definitions declare. */
const mockLabelledStatuses = (
  key: string,
  statuses: { name: string; meaning: { kind: string; text?: string } }[],
): void => {
  mockedUseWorkItemTypeByKey.mockReturnValue({
    isLoading: false,
    workItemTypeDefinition: statusDefinition([], { key, statuses }),
  } as never);
};

const STANDARD_ALLOWED: TaskResponseDto["status"][] = [
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
      />,
    );

    await userEvent.click(screen.getByRole("combobox"));

    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    expect(screen.getByText("COMPLETED")).toBeInTheDocument();
    expect(screen.getByText("CANCELLED")).toBeInTheDocument();
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
      />,
    );

    await userEvent.click(screen.getByRole("combobox"));

    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    expect(screen.queryByText("Needs review")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Generating description"),
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
      />,
    );

    await userEvent.click(screen.getByRole("combobox"));
    await userEvent.click(screen.getByText("COMPLETED"));

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
      />,
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
      />,
    );

    await userEvent.click(screen.getByRole("combobox"));

    expect(screen.queryByText("Superseded")).not.toBeInTheDocument();
    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
  });

  it("shows a feature's ACTIVE status as named, not as 'Ready'", () => {
    mockLabelledStatuses("FEATURE", [
      { name: WorkStatus.Active, meaning: { kind: "IN_PROGRESS" as const } },
    ]);
    render(
      <WorkItemStatusSelector
        value={WorkStatus.Active}
        onChange={vi.fn()}
        organizationId="org-1"
        projectId="project-1"
        taskType={"FEATURE"}
      />,
    );

    expect(screen.getByText("ACTIVE")).toBeInTheDocument();
    expect(screen.queryByText("Ready")).not.toBeInTheDocument();
  });
});

it("shows Plan BACKLOG as named and submits the same value", async () => {
  mockLabelledStatuses("PLAN", [
    {
      name: WorkStatus.Backlog,
      meaning: { kind: "CUSTOM" as const, text: "Drafting" },
    },
    {
      name: WorkStatus.Ready,
      meaning: { kind: "CUSTOM" as const, text: "Ready to build" },
    },
  ]);
  const onChange = vi.fn();
  render(
    <WorkItemStatusSelector
      value={WorkStatus.Ready}
      onChange={onChange}
      organizationId="org-1"
      projectId="project-1"
      taskType="PLAN"
    />,
  );
  await userEvent.click(screen.getByRole("combobox"));
  await userEvent.click(screen.getByRole("option", { name: "BACKLOG" }));
  expect(onChange).toHaveBeenCalledWith(WorkStatus.Backlog);
});
it("shows ordinary task BACKLOG exactly as named", () => {
  mockAllowedStatuses(STANDARD_ALLOWED);
  render(
    <WorkItemStatusSelector
      value={WorkStatus.Backlog}
      onChange={vi.fn()}
      organizationId="org-1"
      projectId="project-1"
      taskType="STANDARD"
    />,
  );
  expect(screen.getByText("BACKLOG")).toBeInTheDocument();
  expect(screen.queryByText("Draft")).not.toBeInTheDocument();
});

describe("WorkItemStatusSelector — custom type vocabulary", () => {
  it("offers the type's own statuses in its order, plus Archived, with exact custom names", async () => {
    mockedUseWorkItemTypeByKey.mockReturnValue({
      isLoading: false,
      workItemTypeDefinition: {
        key: "RECIPE",
        name: "Recipe",
        statuses: [
          {
            name: "Idea",
            meaning: { kind: "CUSTOM" as const, text: "Not started" },
          },
          { name: "Made", meaning: { kind: "COMPLETED" as const } },
          { name: "Rejected", meaning: { kind: "COMPLETED" as const } },
        ],
        capabilities: { supportsSupersession: true },
      },
    } as never);
    render(
      <WorkItemStatusSelector
        value="Testing"
        onChange={vi.fn()}
        organizationId="org-1"
        projectId="project-1"
        taskId="task-1"
        taskType="RECIPE"
      />,
    );

    expect(screen.getByText("Testing")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("combobox"));

    const options = screen.getAllByRole("option").map((o) => o.textContent);
    expect(options).toEqual([
      "Idea",
      "Made",
      "Rejected",
      "Archived",
      "Superseded",
    ]);
  });
});
