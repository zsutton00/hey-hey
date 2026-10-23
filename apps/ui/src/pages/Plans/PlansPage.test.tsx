import { fireEvent, render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { WorkStatus, TaskSource } from "@hey-hey/ui-common/api";
import type { PlanWorkItem } from "@hey-hey/ui-common/data";
import { PlansPage } from "./PlansPage";

const mockUseProjectPlans = vi.fn();
const mockUseProject = vi.fn();
const mockUseCreatePlan = vi.fn();
const mockUsePlan = vi.fn();
const mockUsePlanActiveStageExecutionGuidance = vi.fn();

vi.mock("@hey-hey/ui-common/data", () => ({
  useProjectPlans: (...args: unknown[]) => mockUseProjectPlans(...args),
  useProject: (...args: unknown[]) => mockUseProject(...args),
  useCreatePlan: (...args: unknown[]) => mockUseCreatePlan(...args),
  usePlan: (...args: unknown[]) => mockUsePlan(...args),
  usePlanActiveStageExecutionGuidance: (...args: unknown[]) =>
    mockUsePlanActiveStageExecutionGuidance(...args),
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: () => ({ currentOrgId: "org-1", userId: "user-1" }),
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  EntityIcon: () => <span data-testid="entity-icon" />,
}));

vi.mock("@hey-hey/ui-common/i18n", () => ({
  compose: (value: string) => value,
  KEYS: { common: { loading: "Loading" } },
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({ t: (value: string) => value }),
}));

vi.mock("../../components/Layout", () => ({
  PageBreadcrumbs: ({ items }: { items: Array<{ label: string }> }) => (
    <nav aria-label="breadcrumbs">
      {items.map((item) => (
        <span key={item.label}>{item.label}</span>
      ))}
    </nav>
  ),
}));

vi.mock("../../components/CreatePlanDialog", () => ({
  CreatePlanDialog: () => null,
}));

function buildPlan(
  id: string,
  title: string,
  status: WorkStatus
): PlanWorkItem {
  return {
    id,
    organizationId: "org-1",
    projectId: "project-1",
    parentTaskId: "feature-1",
    type: "PLAN",
    name: title,
    source: TaskSource.User,
    status,
  };
}

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/projects/project-1/plans"]}>
      <Routes>
        <Route path="/projects/:projectId/plans" element={<PlansPage />} />
      </Routes>
    </MemoryRouter>
  );

beforeEach(() => {
  vi.clearAllMocks();
  const plans = [
    buildPlan("plan-active", "Active plan", WorkStatus.Active),
    buildPlan("plan-verifying", "Verifying plan", WorkStatus.Verifying),
    buildPlan("plan-complete", "Completed plan", WorkStatus.Completed),
    buildPlan("plan-archived", "Archived plan", WorkStatus.Archived),
  ];
  mockUseProjectPlans.mockReturnValue({
    plans,
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  });
  mockUseProject.mockReturnValue({
    data: { id: "project-1", name: "Project Alpha" },
  });
  mockUseCreatePlan.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mockUsePlan.mockReturnValue({ deletePlan: vi.fn() });
  mockUsePlanActiveStageExecutionGuidance.mockReturnValue({
    guidance: [
      {
        planId: "plan-active",
        projectId: "project-1",
        stageId: "stage-1",
        planTitle: "Active plan",
        stageTitle: "Current stage",
        next_step_hint: "Continue the active work",
        next_step_options: [],
      },
    ],
    isLoading: false,
    error: null,
  });
});

describe("PlansPage lifecycle presentation", () => {
  it("places Verifying between Active and Completed and filters only verifying plans", () => {
    renderPage();

    expect(screen.getByRole("tab", { name: "Active" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Verifying" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Completed" })).toBeInTheDocument();
    expect(screen.getByText("Active plan")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Verifying" }));

    expect(screen.getByText("Verifying plan")).toBeInTheDocument();
    expect(
      screen.getByText("Verifying", { selector: ".MuiChip-label" }),
    ).toBeInTheDocument();
    expect(screen.queryByText("Active plan")).not.toBeInTheDocument();
    expect(screen.queryByText("Completed plan")).not.toBeInTheDocument();
    expect(
      screen.queryByText("Continue the active work")
    ).not.toBeInTheDocument();
  });

  it("preserves the existing Completed and Archived filters", () => {
    renderPage();

    fireEvent.click(screen.getByRole("tab", { name: "Completed" }));
    expect(screen.getByText("Completed plan")).toBeInTheDocument();
    expect(screen.queryByText("Archived plan")).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Archived" }));
    expect(screen.getByText("Archived plan")).toBeInTheDocument();
    expect(screen.queryByText("Completed plan")).not.toBeInTheDocument();
  });
});
