import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { Provider } from "jotai";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { OrganizationMemberResponseDto, ServiceDto } from "../../../api";
import { Priority, WorkStatus } from "../../../api";
import { StatusActionCompact } from "../StatusActionCompact";

vi.mock("../../../data/hooks", () => ({
  useUsers: vi.fn(),
  useServices: vi.fn(),
  useTaskAllowedStatuses: vi.fn(),
}));

vi.mock("../../../contexts/AuthContext", () => ({
  useAuth: vi.fn(),
}));

vi.mock("../SupersedeTaskDialog", () => ({
  SupersedeTaskDialog: ({ open }: { open: boolean }) =>
    open ? <div data-testid="supersede-dialog" /> : null,
}));

vi.mock("@mui/x-date-pickers/DateCalendar", () => ({
  DateCalendar: ({ onChange }: { onChange: (date: Date | null) => void }) => (
    <div role="grid">
      <button type="button" onClick={() => onChange(new Date(2026, 7, 20))}>
        August 20
      </button>
      <button type="button" onClick={() => onChange(null)}>
        Calendar clear
      </button>
    </div>
  ),
}));

import { useAuth } from "../../../contexts/AuthContext";
import {
  useServices,
  useTaskAllowedStatuses,
  useUsers,
} from "../../../data/hooks";

const mockedUseUsers = vi.mocked(useUsers);
const mockedUseServices = vi.mocked(useServices);
const mockedUseTaskAllowedStatuses = vi.mocked(useTaskAllowedStatuses);
const mockedUseAuth = vi.mocked(useAuth);

const COMPACT_ALLOWED_STATUSES: WorkStatus[] = [
  WorkStatus.Backlog,
  WorkStatus.Active,
  WorkStatus.Verifying,
  WorkStatus.OnHold,
  WorkStatus.Completed,
  WorkStatus.Cancelled,
  WorkStatus.Superseded,
];

const mockMembers: OrganizationMemberResponseDto[] = [
  {
    id: "member-1",
    userId: "user-1",
    organizationId: "org-1",
    role: "admin",
    isActive: true,
    invitedAt: "2024-01-01T00:00:00Z",
    joinedAt: "2024-01-01T00:00:00Z",
    createdAt: "2024-01-01T00:00:00Z",
    user: { id: "user-1", name: "Alice Johnson", email: "alice@example.com" },
  },
  {
    id: "member-2",
    userId: "user-2",
    organizationId: "org-1",
    role: "member",
    isActive: true,
    invitedAt: "2024-01-02T00:00:00Z",
    joinedAt: "2024-01-02T00:00:00Z",
    createdAt: "2024-01-02T00:00:00Z",
    user: { id: "user-2", name: "Bob Smith", email: "bob@example.com" },
  },
];

const renderCompact = (
  overrides: Partial<React.ComponentProps<typeof StatusActionCompact>> = {},
): {
  onStatusChange: ReturnType<typeof vi.fn>;
  onPriorityChange: ReturnType<typeof vi.fn>;
  onDueDateChange: ReturnType<typeof vi.fn>;
  onAssigneeChange: ReturnType<typeof vi.fn>;
} => {
  const onStatusChange = vi.fn();
  const onPriorityChange = vi.fn();
  const onDueDateChange = vi.fn();
  const onAssigneeChange = vi.fn();

  render(
    <Provider>
      <StatusActionCompact
        fields={{
          status: {
            mode: "editable",
            value: WorkStatus.Backlog,
            onChange: onStatusChange,
          },
          priority: {
            mode: "editable",
            value: Priority.Medium,
            onChange: onPriorityChange,
          },
          dueDate: { mode: "editable", value: null, onChange: onDueDateChange },
          assignee: {
            mode: "editable",
            value: null,
            onChange: onAssigneeChange,
          },
        }}
        organizationId="org-1"
        projectId="project-1"
        {...overrides}
      />
    </Provider>,
  );

  return {
    onStatusChange,
    onPriorityChange,
    onDueDateChange,
    onAssigneeChange,
  };
};

const mockServices: ServiceDto[] = [
  {
    id: "service-1",
    name: "UI",
    description: "Web client",
    organizationId: "org-1",
    status: "ACTIVE",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  } as ServiceDto,
  {
    id: "service-2",
    name: "API",
    description: "Backend",
    organizationId: "org-1",
    status: "ACTIVE",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  } as ServiceDto,
];

describe("StatusActionCompact", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockedUseUsers.mockReturnValue({
      data: mockMembers,
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
    } as never);
    mockedUseServices.mockReturnValue({
      services: mockServices,
      data: mockServices,
      isLoading: false,
      isFetching: false,
      isFetched: true,
      isReady: true,
      error: null,
      isStale: false,
      refetch: vi.fn(),
      markStale: vi.fn(),
    } as never);
    mockedUseAuth.mockReturnValue({
      isAuthenticated: true,
      user: { id: "user-1", email: "alice@example.com" },
      loading: false,
      login: vi.fn(),
      completeChangePassword: vi.fn(),
      logout: vi.fn(),
      toggleDevAdminMode: vi.fn(),
    } as never);
    mockedUseTaskAllowedStatuses.mockReturnValue({
      isLoading: false,
      error: null,
      getAllowedStatuses: () => COMPACT_ALLOWED_STATUSES,
    });
  });

  it("renders four icon buttons with non-empty aria-labels", () => {
    renderCompact();

    const statusBtn = screen.getByTestId("status-action-compact-status");
    const priorityBtn = screen.getByTestId("status-action-compact-priority");
    const dueDateBtn = screen.getByTestId("status-action-compact-due-date");
    const assigneeBtn = screen.getByTestId("status-action-compact-assignee");

    for (const btn of [statusBtn, priorityBtn, dueDateBtn, assigneeBtn]) {
      const label = btn.getAttribute("aria-label");
      expect(label).toBeTruthy();
      expect(label?.length).toBeGreaterThan(0);
    }

    expect(statusBtn.getAttribute("aria-label")).toContain("Status");
    expect(priorityBtn.getAttribute("aria-label")).toContain("Priority");
    expect(dueDateBtn.getAttribute("aria-label")).toContain("Due date");
    expect(assigneeBtn.getAttribute("aria-label")).toContain("Assignee");
  });

  it("renders only fields present in the metadata contract", () => {
    renderCompact({
      fields: { status: { mode: "readOnly", value: WorkStatus.Active } },
    });

    expect(screen.getByTestId("status-action-compact-status")).toBeDisabled();
    expect(
      screen.queryByTestId("status-action-compact-priority"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("status-action-compact-due-date"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("status-action-compact-assignee"),
    ).not.toBeInTheDocument();
  });

  it("opens the status menu and forwards selection to onStatusChange", async () => {
    const user = userEvent.setup();
    const { onStatusChange } = renderCompact();

    await user.click(screen.getByTestId("status-action-compact-status"));

    const menu = await screen.findByRole("menu");
    const activeOption = within(menu).getByText("In progress");
    await user.click(activeOption);

    expect(onStatusChange).toHaveBeenCalledWith(WorkStatus.Active);
  });

  it("hides system-managed generating/refining statuses returned by the backend", async () => {
    const user = userEvent.setup();
    mockedUseTaskAllowedStatuses.mockReturnValue({
      isLoading: false,
      error: null,
      getAllowedStatuses: () => [
        WorkStatus.Generated,
        WorkStatus.RefiningDetails,
        WorkStatus.GeneratingAll,
        WorkStatus.Backlog,
        WorkStatus.Active,
      ],
    });
    renderCompact();

    await user.click(screen.getByTestId("status-action-compact-status"));

    const menu = await screen.findByRole("menu");
    expect(within(menu).getByText("In progress")).toBeInTheDocument();
    expect(
      within(menu).queryByText("Refining details"),
    ).not.toBeInTheDocument();
    expect(within(menu).queryByText("Generating all")).not.toBeInTheDocument();
  });

  it("opens the priority menu and forwards selection to onPriorityChange", async () => {
    const user = userEvent.setup();
    const { onPriorityChange } = renderCompact();

    await user.click(screen.getByTestId("status-action-compact-priority"));

    const menu = await screen.findByRole("menu");
    const highOption = within(menu).getByText("High");
    await user.click(highOption);

    expect(onPriorityChange).toHaveBeenCalledWith("HIGH");
  });

  it("opens the assignee menu and forwards selection to onAssigneeChange", async () => {
    const user = userEvent.setup();
    const { onAssigneeChange } = renderCompact();

    await user.click(screen.getByTestId("status-action-compact-assignee"));

    const menu = await screen.findByRole("menu");
    const bobOption = within(menu).getByText("Bob Smith");
    await user.click(bobOption);

    expect(onAssigneeChange).toHaveBeenCalledWith("user-2");
  });

  it("opens the due date popover when the calendar button is tapped", async () => {
    const user = userEvent.setup();
    renderCompact();

    await user.click(screen.getByTestId("status-action-compact-due-date"));

    const calendar = await screen.findByRole("grid");
    expect(calendar).toBeInTheDocument();
  });

  it("forwards a compact calendar selection as a local-day ISO timestamp", async () => {
    const user = userEvent.setup();
    const { onDueDateChange } = renderCompact();

    await user.click(screen.getByTestId("status-action-compact-due-date"));
    await user.click(screen.getByRole("button", { name: "August 20" }));

    expect(onDueDateChange).toHaveBeenCalledWith(
      new Date(2026, 7, 20).toISOString(),
    );
  });

  it("does not expose or accept compact clearing for a required date", async () => {
    const user = userEvent.setup();
    const onDueDateChange = vi.fn();
    renderCompact({
      fields: {
        dueDate: {
          mode: "editable",
          value: "2026-08-13",
          onChange: onDueDateChange,
          allowClear: false,
        },
      },
    });

    await user.click(screen.getByTestId("status-action-compact-due-date"));
    expect(
      screen.queryByTestId("status-action-compact-due-date-clear"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: "Calendar clear" }));
    expect(onDueDateChange).not.toHaveBeenCalled();
  });

  it("disables all icon buttons when disabled is true", () => {
    renderCompact({ disabled: true });

    for (const id of [
      "status-action-compact-status",
      "status-action-compact-priority",
      "status-action-compact-due-date",
      "status-action-compact-assignee",
    ]) {
      expect(screen.getByTestId(id)).toBeDisabled();
    }
  });

  it("does not render the services button when taskServices is omitted", () => {
    renderCompact();
    expect(
      screen.queryByTestId("status-action-compact-services"),
    ).not.toBeInTheDocument();
  });

  it("renders the services button and toggles selection through taskServices.onChange", async () => {
    const user = userEvent.setup();
    const onServicesChange = vi.fn();

    renderCompact({
      projectId: "project-1",
      taskServices: {
        serviceIds: [],
        onChange: onServicesChange,
      },
    });

    const servicesBtn = screen.getByTestId("status-action-compact-services");
    expect(servicesBtn.getAttribute("aria-label")).toContain("Services");

    await user.click(servicesBtn);

    const menu = await screen.findByRole("menu");
    const apiOption = within(menu).getByText("API");
    await user.click(apiOption);

    expect(onServicesChange).toHaveBeenCalledWith(
      ["service-2"],
      [expect.objectContaining({ id: "service-2" })],
    );
  });

  it("routes a SUPERSEDED selection to the dialog and never to onStatusChange", async () => {
    const user = userEvent.setup();
    const { onStatusChange } = renderCompact({ taskId: "task-1" });

    await user.click(screen.getByTestId("status-action-compact-status"));

    const menu = await screen.findByRole("menu");
    await user.click(within(menu).getByText("Superseded"));

    expect(onStatusChange).not.toHaveBeenCalled();
    expect(screen.getByTestId("supersede-dialog")).toBeInTheDocument();
  });

  it("omits SUPERSEDED from the status menu when there is no task to supersede", async () => {
    const user = userEvent.setup();
    renderCompact();

    await user.click(screen.getByTestId("status-action-compact-status"));

    const menu = await screen.findByRole("menu");
    expect(within(menu).queryByText("Superseded")).not.toBeInTheDocument();
  });

  it("removes an already-selected service when toggled off", async () => {
    const user = userEvent.setup();
    const onServicesChange = vi.fn();

    renderCompact({
      projectId: "project-1",
      taskServices: {
        serviceIds: ["service-1", "service-2"],
        onChange: onServicesChange,
      },
    });

    await user.click(screen.getByTestId("status-action-compact-services"));
    const menu = await screen.findByRole("menu");
    await user.click(within(menu).getByText("UI"));

    expect(onServicesChange).toHaveBeenCalledWith(
      ["service-2"],
      [expect.objectContaining({ id: "service-2" })],
    );
  });
  it("uses Goal labels for compact set, change and clear controls", async () => {
    const onChange = vi.fn();
    const labels = {
      noDate: "No target date",
      set: "Set date",
      change: "Change",
      clear: "Clear",
    };
    const fields = {
      dueDate: {
        mode: "editable" as const,
        value: null as string | null,
        onChange,
        actionLabels: labels,
      },
    };
    const { rerender } = render(
      <StatusActionCompact
        fields={fields}
        taskType="GOAL"
        organizationId="org-1"
        projectId="project-1"
      />,
    );
    expect(screen.getByText("No target date")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Set date" }));
    await userEvent.click(screen.getByRole("button", { name: "August 20" }));
    expect(onChange).toHaveBeenLastCalledWith(
      new Date(2026, 7, 20).toISOString(),
    );
    rerender(
      <StatusActionCompact
        fields={{ dueDate: { ...fields.dueDate, value: "2026-08-20" } }}
        taskType="GOAL"
        organizationId="org-1"
        projectId="project-1"
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Change" }));
    await userEvent.click(screen.getByText("Clear"));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });
});
