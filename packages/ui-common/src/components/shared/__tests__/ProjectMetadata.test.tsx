import { render, screen, within } from "@testing-library/react";
import { createTheme, ThemeProvider } from "@mui/material/styles";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it, vi } from "vitest";
import {
  ProjectMaturity,
  ProjectRole,
  ProjectStatus,
  type ProjectResponseDto,
} from "../../../api";
import { ProjectMetadata } from "../ProjectMetadata";
import { ProjectIdentity } from "../../ProjectOverview/ProjectIdentity";
import { OrganizationHomeProjectList } from "../../OrganizationHome/OrganizationHomeProjectList";

vi.mock("../../../data/hooks/useEntityStars", () => ({
  useEntityStar: () => ({
    isStarred: false,
    isLoading: false,
    isMutating: false,
    error: null,
    mutationError: null,
    toggle: vi.fn(),
  }),
}));

const theme = createTheme();
const colors = {
  [ProjectStatus.Active]: "rgb(46, 125, 50)",
  [ProjectStatus.Onboarding]: "rgb(156, 39, 176)",
  [ProjectStatus.Completed]: "rgb(2, 136, 209)",
  [ProjectStatus.Failed]: "rgb(211, 47, 47)",
} satisfies Record<ProjectStatus, string>;

describe("ProjectMetadata", () => {
  it("keeps updated date and status together without a bullet", () => {
    render(
      <ProjectMetadata
        updatedAt="2026-09-27T01:00:00.000Z"
        status={ProjectStatus.Onboarding}
      />,
    );
    const metadata = screen.getByTestId("project-metadata");
    expect(metadata).toHaveTextContent("Updated Sep 27, 2026");
    expect(metadata).not.toHaveTextContent("·");
    expect(metadata.querySelector("time")).toHaveAttribute(
      "datetime",
      "2026-09-27T01:00:00.000Z",
    );
    expect(getComputedStyle(metadata).flexDirection).toBe("row");
    expect(getComputedStyle(metadata).flexWrap).toBe("nowrap");
    expect(getComputedStyle(metadata).whiteSpace).toBe("nowrap");
  });

  it.each(Object.values(ProjectStatus))(
    "renders matching %s status colors on Home and the project header",
    (status) => {
      const project: ProjectResponseDto = {
        id: "project-1",
        organizationId: "org-1",
        name: "A long project name that wraps across multiple lines",
        description: "Project description",
        status,
        maturity: ProjectMaturity.Established,
        currentUserRole: ProjectRole.Owner,
        hasEstablishedActivity: true,
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-09-27T01:00:00.000Z",
      };
      render(
        <ThemeProvider theme={theme}>
          <MemoryRouter>
            <OrganizationHomeProjectList
              projects={[project]}
              organizationId="org-1"
              pathForProject={() => "/projects/project-1"}
            />
            <ProjectIdentity organizationId="org-1" project={project} />
          </MemoryRouter>
        </ThemeProvider>,
      );
      const home = screen.getByTestId("organization-home-project-item");
      const header = screen.getByTestId("project-overview-identity");
      expect(
        within(header).getByRole("button", {
          name:
            status === ProjectStatus.Onboarding ? "Cancel Onboarding" : "Star",
        }),
      ).toBeInTheDocument();
      const homeChip = within(home).getByLabelText(/Project status:/);
      const headerChip = within(header).getByLabelText(/Project status:/);
      expect(getComputedStyle(homeChip).color).toBe(colors[status]);
      expect(getComputedStyle(headerChip).color).toBe(colors[status]);
      expect(getComputedStyle(homeChip).backgroundColor).toBe(
        getComputedStyle(headerChip).backgroundColor,
      );
      expect(getComputedStyle(homeChip).border).toBe(
        getComputedStyle(headerChip).border,
      );
      expect(within(home).getByTestId("project-updated-at").textContent).toBe(
        within(header).getByTestId("project-updated-at").textContent,
      );
      expect(homeChip.textContent).toBe(headerChip.textContent);
    },
  );
});
