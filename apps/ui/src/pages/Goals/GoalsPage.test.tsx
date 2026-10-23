import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { PreviewPresentationProvider } from "../../contexts/PreviewPresentationContext";
import { GoalsPage } from "./GoalsPage";

const goalDefinition = { key: "GOAL", allowedStatuses: ["ACTIVE", "COMPLETED"] };
const createTask = vi.fn();
const invalidateQueries = vi.fn();
const useWorkItemsMock = vi.fn();
const collectionPropsMock = vi.fn();

vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => ({ invalidateQueries }),
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useProject: () => ({ data: { name: "Project" } }),
  useWorkItemTypeByKey: () => ({
    workItemTypeDefinition: goalDefinition,
    error: null,
  }),
  useWorkItems: (...args: unknown[]) => {
    useWorkItemsMock(...args);
    return { workItems: [], isLoading: false, error: null, createTask };
  },
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: () => ({ currentOrgId: "org-1" }),
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  NewGoalModal: ({
    open,
    onSubmit,
  }: {
    open: boolean;
    onSubmit: (payload: { name: string }) => Promise<void>;
  }) =>
    open ? (
      <button onClick={() => void onSubmit({ name: "New goal" })}>
        submit-goal
      </button>
    ) : null,
  GoalProgressChip: ({ goal }: { goal: { id: string } }) => (
    <span>progress-{goal.id}</span>
  ),
  entityCollectionQueryKeyPrefix: (org: string, project: string, type: string) => [
    "work-item-reference-page",
    org,
    project,
    type,
  ],
  EntityCollectionPage: (props: {
    renderRowAttention?: (item: { id: string }) => React.ReactNode;
  }) => {
    collectionPropsMock(props);
    return (
      <div data-testid="goal-collection">
        {props.renderRowAttention?.({ id: "goal-1" })}
      </div>
    );
  },
}));

vi.mock("../../components/Layout", () => ({
  DetailPageContainer: ({ children }: { children: React.ReactNode }) => (
    <main>{children}</main>
  ),
  DetailPageHeader: ({ title }: { title: React.ReactNode }) => <h1>{title}</h1>,
  PageBreadcrumbs: () => <nav />,
}));

const renderPage = (preview = false) =>
  render(
    <MemoryRouter>
      {preview ? (
        <PreviewPresentationProvider>
          <GoalsPage organizationId="org-1" projectId="project-1" preview />
        </PreviewPresentationProvider>
      ) : (
        <GoalsPage organizationId="org-1" projectId="project-1" />
      )}
    </MemoryRouter>,
  );

describe("GoalsPage", () => {
  beforeEach(() => {
    createTask.mockReset().mockResolvedValue({ id: "goal-new" });
    invalidateQueries.mockReset().mockResolvedValue(undefined);
    useWorkItemsMock.mockReset();
    collectionPropsMock.mockReset();
  });

  it("suppresses the collection title and create action in Preview", () => {
    renderPage(true);

    expect(screen.queryByRole("heading", { name: "Goals" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Create Goal" })).not.toBeInTheDocument();
    expect(screen.getByTestId("goal-collection")).toBeInTheDocument();
  });

  it("renders goals through the shared collection with the compact progress summary", () => {
    renderPage();

    expect(collectionPropsMock).toHaveBeenLastCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "project-1",
        typeDefinition: goalDefinition,
        includeTrackedWorkSummary: true,
      }),
    );
    expect(screen.getByText("progress-goal-1")).toBeInTheDocument();
    // The page no longer hydrates the full goal list or tracked snapshots itself.
    expect(useWorkItemsMock).toHaveBeenLastCalledWith(
      "org-1",
      "task",
      "project-1",
      undefined,
      expect.objectContaining({ enabled: false, includeTrackedEntities: false }),
    );
  });

  it("refreshes the collection after creating a goal", async () => {
    renderPage();

    fireEvent.click(screen.getByTestId("create-goal-button"));
    fireEvent.click(screen.getByText("submit-goal"));

    await waitFor(() =>
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ["work-item-reference-page", "org-1", "project-1", "GOAL"],
      }),
    );
    expect(createTask).toHaveBeenCalledWith({ name: "New goal", type: "GOAL" });
  });
});
