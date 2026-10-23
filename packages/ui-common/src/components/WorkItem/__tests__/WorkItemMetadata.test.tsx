import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import type { ServiceDto } from "../../../api";
import { Priority, WorkStatus } from "../../../api";
import {
  WorkItemMetadata,
  type WorkItemMetadataProps,
} from "../WorkItemMetadata";

vi.mock("../../Selectors/AssigneeSelector", () => ({
  AssigneeSelector: ({
    helperText,
    error,
    disabled,
  }: {
    helperText?: string;
    error?: boolean;
    disabled?: boolean;
  }) => (
    <button
      data-testid="assignee-selector"
      data-error={String(Boolean(error))}
      disabled={disabled}
    >
      {helperText}
    </button>
  ),
}));

vi.mock("../../Selectors/DueDateSelector", () => ({
  DueDateSelector: ({
    disabled,
    allowClear,
  }: {
    disabled?: boolean;
    allowClear?: boolean;
  }) => (
    <button
      data-testid="due-date-selector"
      data-allow-clear={String(allowClear)}
      disabled={disabled}
    />
  ),
}));

vi.mock("../../Selectors/FeatureSelector", () => ({
  FeatureSelector: () => <div data-testid="feature-selector" />,
}));

vi.mock("../../Selectors/ServiceSelector", () => ({
  ServiceSelector: ({
    helperText,
    error,
  }: {
    helperText?: string;
    error?: boolean;
  }) => (
    <div data-testid="service-selector" data-error={String(Boolean(error))}>
      {helperText}
    </div>
  ),
}));

vi.mock("../../Selectors/TaskSelector", () => ({
  TaskSelector: () => <div data-testid="task-selector" />,
}));

vi.mock("../../Selectors/WorkItemPrioritySelector", () => ({
  WorkItemPrioritySelector: ({
    onChange,
    disabled,
  }: {
    onChange?: (priority: Priority) => void;
    disabled?: boolean;
  }) => (
    <button
      data-testid="priority-selector"
      disabled={disabled}
      onClick={() => onChange?.(Priority.High)}
    />
  ),
}));

vi.mock("../../Selectors/WorkItemStatusSelector", () => ({
  WorkItemStatusSelector: ({
    onChange,
    disabled,
  }: {
    onChange?: (status: WorkStatus) => void;
    disabled?: boolean;
  }) => (
    <button
      data-testid="status-selector"
      disabled={disabled}
      onClick={() => onChange?.(WorkStatus.Active)}
    />
  ),
}));

vi.mock("../StatusActionCompact", () => ({
  StatusActionCompact: ({
    fields,
  }: {
    fields: WorkItemMetadataProps["fields"];
  }) => (
    <div
      data-testid="status-action-compact"
      data-field-count={Object.keys(fields).length}
    />
  ),
}));

describe("WorkItemMetadata", () => {
  const baseProps: WorkItemMetadataProps = {
    fields: {
      status: {
        mode: "editable",
        value: WorkStatus.Backlog,
        onChange: () => undefined,
      },
      priority: {
        mode: "editable",
        value: Priority.Medium,
        onChange: () => undefined,
      },
      dueDate: { mode: "editable", value: null, onChange: () => undefined },
      assignee: {
        mode: "editable",
        value: "user-1",
        onChange: () => undefined,
      },
    },
    organizationId: "org-1",
    projectId: "project-1",
    taskServices: {
      serviceIds: [],
      onChange: (_serviceIds: string[], _services: ServiceDto[]): void =>
        undefined,
    },
  };

  it("prompts for services when status is ready and no services are selected", () => {
    render(<WorkItemMetadata {...baseProps} />);

    const selector = screen.getByTestId("service-selector");
    expect(selector).toHaveAttribute("data-error", "true");
    expect(selector).toHaveTextContent(
      "Select one or more services for ready work items.",
    );
  });

  it("prompts for services when status is active and no services are selected", () => {
    render(
      <WorkItemMetadata
        {...baseProps}
        fields={{
          ...baseProps.fields,
          status: {
            mode: "editable",
            value: WorkStatus.Active,
            onChange: () => undefined,
          },
        }}
      />,
    );

    const selector = screen.getByTestId("service-selector");
    expect(selector).toHaveAttribute("data-error", "true");
    expect(selector).toHaveTextContent(
      "Select one or more services for active or completed work items.",
    );
  });

  it("does not show a required-services error when status is refining", () => {
    render(
      <WorkItemMetadata
        {...baseProps}
        fields={{
          ...baseProps.fields,
          status: {
            mode: "readOnly",
            value: WorkStatus.RefiningAcceptanceCriteria,
          },
        }}
      />,
    );

    const selector = screen.getByTestId("service-selector");
    expect(selector).toHaveAttribute("data-error", "false");
    expect(selector).toHaveTextContent(
      "Select one or more services linked to this work item.",
    );
  });

  it("renders the desktop layout with full selectors when viewport is wide", () => {
    render(<WorkItemMetadata {...baseProps} />);
    expect(screen.getByTestId("status-selector")).toBeInTheDocument();
    expect(screen.getByTestId("priority-selector")).toBeInTheDocument();
    expect(screen.getByTestId("due-date-selector")).toBeInTheDocument();
    expect(screen.getByTestId("assignee-selector")).toBeInTheDocument();
    expect(
      screen.queryByTestId("status-action-compact"),
    ).not.toBeInTheDocument();
  });

  it("forwards required-date clearability to the desktop selector", () => {
    render(
      <WorkItemMetadata
        {...baseProps}
        fields={{
          dueDate: {
            mode: "editable",
            value: "2026-08-13",
            onChange: () => undefined,
            allowClear: false,
          },
        }}
      />,
    );

    expect(screen.getByTestId("due-date-selector")).toHaveAttribute(
      "data-allow-clear",
      "false",
    );
  });

  it("omits metadata fields that are not present", () => {
    render(
      <WorkItemMetadata
        {...baseProps}
        fields={{ status: baseProps.fields.status }}
      />,
    );

    expect(screen.getByTestId("status-selector")).toBeInTheDocument();
    expect(screen.queryByTestId("priority-selector")).not.toBeInTheDocument();
    expect(screen.queryByTestId("due-date-selector")).not.toBeInTheDocument();
    expect(screen.queryByTestId("assignee-selector")).not.toBeInTheDocument();
  });

  it("renders read-only status without mutation authority", async () => {
    const user = userEvent.setup();
    const onStatusChange = vi.fn();
    render(
      <WorkItemMetadata
        {...baseProps}
        fields={{
          ...baseProps.fields,
          status: { mode: "readOnly", value: WorkStatus.Active },
        }}
      />,
    );

    await user.click(screen.getByTestId("status-selector"));
    expect(screen.getByTestId("status-selector")).toBeDisabled();
    expect(onStatusChange).not.toHaveBeenCalled();
  });

  it("forwards editable field changes through their own handler", async () => {
    const user = userEvent.setup();
    const onStatusChange = vi.fn();
    render(
      <WorkItemMetadata
        {...baseProps}
        fields={{
          ...baseProps.fields,
          status: {
            mode: "editable",
            value: WorkStatus.Backlog,
            onChange: onStatusChange,
          },
        }}
      />,
    );

    await user.click(screen.getByTestId("status-selector"));
    expect(onStatusChange).toHaveBeenCalledWith(WorkStatus.Active);
  });

  it("renders the compact icon row when the viewport is narrow", () => {
    const originalMatchMedia = window.matchMedia;
    window.matchMedia = vi.fn().mockImplementation((query: string) => ({
      matches: query.includes("max-width"),
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;

    try {
      render(<WorkItemMetadata {...baseProps} />);
      expect(screen.getByTestId("status-action-compact")).toBeInTheDocument();
      expect(screen.getByTestId("status-action-compact")).toHaveAttribute(
        "data-field-count",
        "4",
      );
      expect(screen.queryByTestId("status-selector")).not.toBeInTheDocument();
      expect(screen.queryByTestId("priority-selector")).not.toBeInTheDocument();
      expect(screen.queryByTestId("due-date-selector")).not.toBeInTheDocument();
      expect(screen.queryByTestId("assignee-selector")).not.toBeInTheDocument();
    } finally {
      window.matchMedia = originalMatchMedia;
    }
  });

  it("does not show a required-services error when services are selected", () => {
    render(
      <WorkItemMetadata
        {...baseProps}
        taskServices={{
          serviceIds: ["service-1"],
          onChange: (_serviceIds: string[], _services: ServiceDto[]): void =>
            undefined,
        }}
      />,
    );

    const selector = screen.getByTestId("service-selector");
    expect(selector).toHaveAttribute("data-error", "false");
    expect(selector).toHaveTextContent(
      "Select one or more services linked to this work item.",
    );
  });
  it("passes optional date clearing through the shared metadata boundary", () => {
    render(
      <WorkItemMetadata
        {...baseProps}
        fields={{
          dueDate: {
            mode: "editable",
            value: null,
            onChange: vi.fn(),
            allowClear: true,
          },
        }}
      />,
    );
    expect(screen.getByTestId("due-date-selector")).toHaveAttribute(
      "data-allow-clear",
      "true",
    );
  });
});
