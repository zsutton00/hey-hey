import {
  ProjectMaturity,
  ProjectStatus,
  type ProjectResponseDto,
} from "@hey-hey/ui-common/api";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React from "react";
import { MemoryRouter, useLocation } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import { ProjectOverviewDestination } from "./ProjectOverviewDestination";

const overview = vi.hoisted(() => vi.fn());
vi.mock("@hey-hey/ui-common/components", () => ({
  ProjectOverview: (props: { organizationId: string; projectId: string }) => {
    overview(props);
    return <div>Established Overview</div>;
  },
}));

vi.mock("../../NewOrgLanding/OrientationContent", () => ({
  OrientationContent: ({
    cta,
    heading,
  }: {
    cta: React.ReactNode;
    heading: React.ReactNode;
  }) => (
    <div>
      {heading}
      {cta}
    </div>
  ),
}));

const project = (
  status: ProjectStatus,
  hasEstablishedActivity: boolean,
): ProjectResponseDto => ({
  id: "00000000-0000-4000-8000-000000000001",
  organizationId: "00000000-0000-4000-8000-000000000002",
  name: "Project Alpha",
  status,
  hasEstablishedActivity,
  maturity: ProjectMaturity.TakingShape,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
});

const Location = () => (
  <div data-testid="location">
    {useLocation().pathname}
    {useLocation().search}
  </div>
);

describe("ProjectOverviewDestination", () => {
  it("forwards replacement organization and project scope to Overview", () => {
    const view = (organizationId: string, projectId: string) => (
      <ProjectOverviewDestination
        organizationId={organizationId}
        projectId={projectId}
        project={project(ProjectStatus.Active, false)}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />
    );
    const { rerender } = render(view("first-org", "first-project"));
    rerender(view("next-org", "next-project"));
    expect(overview).toHaveBeenLastCalledWith({
      organizationId: "next-org",
      projectId: "next-project",
    });
    expect(screen.queryByTestId("project-setup-introduction")).toBeNull();
  });
  it("holds the destination in loading and error states", async () => {
    const retry = vi.fn();
    const { rerender } = render(
      <ProjectOverviewDestination
        organizationId="org"
        projectId="project"
        project={null}
        isLoading
        error={null}
        onRetry={retry}
      />,
    );
    expect(
      screen.getByTestId("project-overview-destination-loading"),
    ).toBeInTheDocument();

    rerender(
      <ProjectOverviewDestination
        organizationId="org"
        projectId="project"
        project={null}
        isLoading={false}
        error={new Error("failed")}
        onRetry={retry}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(retry).toHaveBeenCalledOnce();
  });

  it("shows setup for a project without organic activity and opens intake for that project", async () => {
    render(
      <MemoryRouter>
        <ProjectOverviewDestination
          organizationId="org"
          projectId="00000000-0000-4000-8000-000000000001"
          project={project(ProjectStatus.Onboarding, false)}
          isLoading={false}
          error={null}
          onRetry={vi.fn()}
        />
        <Location />
      </MemoryRouter>,
    );
    expect(
      screen.getByTestId("project-setup-introduction"),
    ).toBeInTheDocument();
    expect(screen.queryByText("Established Overview")).not.toBeInTheDocument();
    await userEvent.click(
      screen.getByRole("button", { name: "Start setting up your project" }),
    );
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/00000000-0000-4000-8000-000000000001/onboarding?isNew=t",
    );
  });

  it("delegates an active project to the established Overview even without activity", () => {
    render(
      <ProjectOverviewDestination
        organizationId="org"
        projectId="project"
        project={project(ProjectStatus.Active, false)}
        isLoading={false}
        error={null}
        onRetry={vi.fn()}
      />,
    );
    expect(screen.getByText("Established Overview")).toBeInTheDocument();
    expect(overview).toHaveBeenLastCalledWith({
      organizationId: "org",
      projectId: "project",
    });
    expect(
      screen.queryByTestId("project-setup-introduction"),
    ).not.toBeInTheDocument();
  });
});
