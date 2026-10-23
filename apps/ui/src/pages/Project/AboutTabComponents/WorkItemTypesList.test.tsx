import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  WorkItemTypeLifecycleStatus,
} from "@hey-hey/ui-common/api";
import { WorkItemTypesList } from "./WorkItemTypesList";

const mockUseWorkItemTypes = vi.fn();
const mockUseProjectCapabilities = vi.fn();

vi.mock("@hey-hey/ui-common/data", () => ({
  useWorkItemTypes: (...args: unknown[]) => mockUseWorkItemTypes(...args),
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: () => ({ currentOrgId: "org-1" }),
  useProjectCapabilities: (...args: unknown[]) =>
    mockUseProjectCapabilities(...args),
}));

describe("WorkItemTypesList", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockUseProjectCapabilities.mockReturnValue({ manageWorkItemTypes: true });
    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [
        {
          status: WorkItemTypeLifecycleStatus.Active,
          projectId: "proj-1",
          effectiveSource: "PROJECT_CUSTOM",
          definition: {
            key: "CUSTOM TYPE",
            name: "Custom type",
            description: "Project-defined work.",
            sections: [],
            allowedStatuses: [],
          },
        },
        {
          status: WorkItemTypeLifecycleStatus.Archived,
          projectId: "proj-1",
          effectiveSource: "CANONICAL_OVERRIDE",
          definition: {
            key: "BUG",
            name: "Bug",
            description: "Archived canonical work.",
            sections: [],
            allowedStatuses: [],
          },
        },
        {
          status: WorkItemTypeLifecycleStatus.Active,
          projectId: "proj-1",
          effectiveSource: "CANONICAL",
          definition: {
            key: "STANDARD",
            name: "Task",
            sections: [],
            allowedStatuses: [],
          },
        },
        {
          status: WorkItemTypeLifecycleStatus.Archived,
          projectId: "proj-1",
          effectiveSource: "PROJECT_CUSTOM",
          definition: {
            key: "ARCHIVED_CUSTOM",
            name: "Archived custom",
            description: "Retained project work.",
            sections: [],
            allowedStatuses: [],
          },
        },
        {
          status: WorkItemTypeLifecycleStatus.Active,
          projectId: "other-project",
          effectiveSource: "PROJECT_CUSTOM",
          definition: {
            key: "FOREIGN",
            name: "Foreign project type",
            sections: [],
            allowedStatuses: [],
          },
        },
      ],
      isLoading: false,
      error: null,
    });
  });

  it("renders active project-owned rows in one sorted list with provenance chips", () => {
    render(
      <MemoryRouter>
        <WorkItemTypesList projectId="proj-1" />
      </MemoryRouter>,
    );

    const createButton = screen.getByTestId("work-item-type-create");
    expect(createButton).toHaveTextContent("Create New Custom Type");
    expect(createButton).toHaveClass("MuiButton-contained");
    expect(createButton).toHaveAttribute(
      "href",
      "/projects/proj-1/work-item-types/new",
    );
    expect(screen.getByTestId("work-item-type-edit-CUSTOM TYPE"))
      .toHaveAttribute(
        "href",
        "/projects/proj-1/work-item-types/CUSTOM%20TYPE/edit",
      );
    expect(screen.getByText("Task")).toBeInTheDocument();
    expect(screen.getByText("Base")).toBeInTheDocument();
    expect(screen.getByText("Custom")).toBeInTheDocument();
    expect(screen.queryByText("Bug")).not.toBeInTheDocument();
    expect(screen.queryByText("Archived custom")).not.toBeInTheDocument();
    expect(screen.queryByText(/Active · Canonical-seeded/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Archived · Custom/)).not.toBeInTheDocument();
    expect(screen.queryByText("Foreign project type")).not.toBeInTheDocument();
    expect(screen.getByRole("switch", { name: "Show Archived" })).not.toBeChecked();
    expect(mockUseWorkItemTypes).toHaveBeenCalledWith("org-1", {
      projectId: "proj-1",
    });
    expect(mockUseProjectCapabilities).toHaveBeenCalledWith("org-1", "proj-1");
  });

  it("hides Create New Custom Type from roles that cannot manage work-item types", () => {
    mockUseProjectCapabilities.mockReturnValue({ manageWorkItemTypes: false });

    render(
      <MemoryRouter>
        <WorkItemTypesList projectId="proj-1" />
      </MemoryRouter>,
    );

    expect(screen.queryByTestId("work-item-type-create")).not.toBeInTheDocument();
    expect(screen.getByTestId("work-item-type-edit-CUSTOM TYPE")).toBeVisible();
  });

  it("adds archived rows to the same list and preserves generated provenance", async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <WorkItemTypesList projectId="proj-1" />
      </MemoryRouter>,
    );

    await user.click(screen.getByRole("switch", { name: "Show Archived" }));

    expect(screen.getByText("Bug")).toBeInTheDocument();
    expect(screen.getByText("Archived custom")).toBeInTheDocument();
    expect(screen.getAllByText("Base")).toHaveLength(2);
    expect(screen.getByText("Customized")).toBeInTheDocument();
    expect(screen.getAllByText("Custom")).toHaveLength(2);
    expect(screen.getByRole("switch", { name: "Show Archived" })).toBeChecked();
  });

  it("fails closed to an empty project-owned inventory", () => {
    mockUseWorkItemTypes.mockReturnValue({
      workItemTypes: [
        {
          status: WorkItemTypeLifecycleStatus.Active,
          projectId: "other-project",
          effectiveSource: "PROJECT_CUSTOM",
          definition: {
            key: "FOREIGN",
            name: "Foreign project type",
            sections: [],
            allowedStatuses: [],
          },
        },
      ],
      isLoading: false,
      error: null,
    });

    render(
      <MemoryRouter>
        <WorkItemTypesList projectId="proj-1" />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("work-item-types-empty")).toBeInTheDocument();
    expect(screen.queryByText("Foreign project type")).not.toBeInTheDocument();
  });
});
