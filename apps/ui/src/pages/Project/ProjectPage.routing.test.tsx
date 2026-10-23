import {
  ProjectStatus,
  WorkItemTypeEffectiveSource,
  WorkItemTypeLifecycleStatus,
  WorkItemTypeRole,
  type WorkItemTypeSummaryDto,
} from "@hey-hey/ui-common/api";
import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsAdapter } from "nuqs/adapters/react-router";
import React from "react";
import { BrowserRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ProjectPage } from "./ProjectPage";

const workItemType = (
  key: string,
  name: string,
  role: WorkItemTypeRole,
): WorkItemTypeSummaryDto => ({
  id: `type-${key}`,
  projectId: "project-1",
  status: WorkItemTypeLifecycleStatus.Active,
  effectiveSource: WorkItemTypeEffectiveSource.Canonical,
  definition: { key, name, role, sections: [], allowedStatuses: [] },
});

const workItemTypes: WorkItemTypeSummaryDto[] = [
  workItemType("STANDARD", "Tasks", WorkItemTypeRole.WorkItem),
  workItemType("BUG", "Bugs", WorkItemTypeRole.WorkItem),
  workItemType("FEATURE", "Features", WorkItemTypeRole.ProjectInfo),
];

vi.mock("@hey-hey/ui-common", () => ({
  WebPathService: {
    project: (projectId: string) => `/projects/${projectId}`,
    projects: () => "/projects",
  },
}));

vi.mock("@hey-hey/ui-common/context", () => ({
  useOrganization: () => ({ currentOrganization: { id: "org-1" } }),
  TrackingProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: () => ({ currentOrgId: "org-1", userId: "user-1" }),
}));

vi.mock("@hey-hey/ui-common/data", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hey-hey/ui-common/data")>()),
  useProject: () => ({
    data: {
      id: "project-1",
      name: "Project Alpha",
      status: ProjectStatus.Active,
      hasEstablishedActivity: false,
      createdBy: "user-1",
      createdAt: "2026-01-01T00:00:00.000Z",
      updatedAt: "2026-01-02T00:00:00.000Z",
    },
  }),
  useProjectPlans: () => ({ plans: [], isLoading: false }),
  useWorkItemTypes: () => ({ workItemTypes, isReady: true }),
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  DiscussCapsuleAction: () => null,
  ProjectOverview: () => <div>Authoritative Project Overview</div>,
  PlanList: () => <div data-testid="selected-content">Plans content</div>,
}));

vi.mock("../../components/SegmentedToggle", () => ({
  SegmentedToggle: (props: {
    onChange: (value: string) => void;
    segments: Array<{ value: string; label: string }>;
  }) => (
    <div aria-label="Project type selection" role="group">
      {props.segments.map((segment) => (
        <button
          key={segment.value}
          onClick={() => props.onChange(segment.value)}
          type="button"
        >
          {segment.label}
        </button>
      ))}
    </div>
  ),
}));

vi.mock("../../components/Layout", () => ({
  DetailPageContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DetailPageTabs: (props: {
    onChange: (value: string) => void;
    tabs: Array<{ value: string; label: string }>;
  }) => (
    <nav aria-label="Project views">
      {props.tabs.map((tab) => (
        <button
          key={tab.value}
          onClick={() => props.onChange(tab.value)}
          type="button"
        >
          {tab.label}
        </button>
      ))}
    </nav>
  ),
  PageBreadcrumbs: () => <nav aria-label="Breadcrumbs" />,
}));

vi.mock("../../components/Tabs", () => ({
  buildAdminMetadataItems: () => [],
  DesignDocsTab: () => <div data-testid="selected-content">Design Docs</div>,
  ProjectWorkItemsTab: ({ title }: { title: string }) => (
    <div data-testid="selected-content">{title}</div>
  ),
  ProposalsTab: () => <div>Project review records</div>,
}));

vi.mock("./ProjectAgentsTab", () => ({
  ProjectAgentsTab: () => <div>Project Agents composition</div>,
}));

vi.mock("./ProjectSettingsTab", () => ({
  ProjectSettingsTab: () => <div>Project Settings composition</div>,
}));

vi.mock("../NewOrgLanding/ProjectHelpPage", () => ({
  ProjectHelpPage: ({
    organizationId,
    projectId,
  }: {
    organizationId: string;
    projectId: string;
  }) => (
    <div data-testid="project-help-page">
      {organizationId}:{projectId}
    </div>
  ),
}));

const renderPage = () =>
  render(
    <BrowserRouter>
      <NuqsAdapter>
        <Routes>
          <Route path="/projects/:projectId" element={<ProjectPage />} />
        </Routes>
      </NuqsAdapter>
    </BrowserRouter>,
  );

describe("ProjectPage query-backed browser routing", () => {
  beforeEach(() => {
    window.history.replaceState(
      {},
      "",
      "/projects/project-1?tab=work&type=BUG",
    );
  });

  it("restores direct Overview entry across a refresh-equivalent remount", async () => {
    window.history.replaceState({}, "", "/projects/project-1?tab=overview");

    const directEntry = renderPage();
    expect(
      await screen.findByText("Authoritative Project Overview"),
    ).toBeInTheDocument();

    directEntry.unmount();
    renderPage();

    expect(
      await screen.findByText("Authoritative Project Overview"),
    ).toBeInTheDocument();
    expect(window.location.search).toBe("?tab=overview");
  });

  it("restores direct entry, remount, and browser history destination and type state", async () => {
    const user = userEvent.setup();
    const directEntry = renderPage();

    expect(await screen.findByTestId("selected-content")).toHaveTextContent(
      "Bugs",
    );
    expect(window.location.search).toBe("?tab=work&type=BUG");

    directEntry.unmount();
    renderPage();

    expect(await screen.findByTestId("selected-content")).toHaveTextContent(
      "Bugs",
    );
    expect(window.location.search).toBe("?tab=work&type=BUG");

    await user.click(screen.getByRole("button", { name: "Knowledge" }));
    await waitFor(() => {
      expect(window.location.search).toBe("?tab=knowledge&type=FEATURE");
      expect(screen.getByTestId("selected-content")).toHaveTextContent(
        "Features",
      );
    });

    await user.click(screen.getByRole("button", { name: "Plans" }));
    await waitFor(() => {
      expect(window.location.search).toBe("?tab=knowledge&type=PLAN");
      expect(screen.getByTestId("selected-content")).toHaveTextContent(
        "Plans content",
      );
    });

    act(() => window.history.back());
    await waitFor(() => {
      expect(window.location.search).toBe("?tab=knowledge&type=FEATURE");
      expect(screen.getByTestId("selected-content")).toHaveTextContent(
        "Features",
      );
    });

    act(() => window.history.back());
    await waitFor(() => {
      expect(window.location.search).toBe("?tab=work&type=BUG");
      expect(screen.getByTestId("selected-content")).toHaveTextContent("Bugs");
    });

    act(() => window.history.forward());
    await waitFor(() => {
      expect(window.location.search).toBe("?tab=knowledge&type=FEATURE");
      expect(screen.getByTestId("selected-content")).toHaveTextContent(
        "Features",
      );
    });

    act(() => window.history.forward());
    await waitFor(() => {
      expect(window.location.search).toBe("?tab=knowledge&type=PLAN");
      expect(screen.getByTestId("selected-content")).toHaveTextContent(
        "Plans content",
      );
    });
  });

  it("restores direct Help entry and browser history across remount", async () => {
    const user = userEvent.setup();
    window.history.replaceState({}, "", "/projects/project-1?tab=help");

    const directEntry = renderPage();

    expect(await screen.findByTestId("project-help-page")).toHaveTextContent(
      "org-1:project-1",
    );
    expect(window.location.search).toBe("?tab=help");

    directEntry.unmount();
    renderPage();

    expect(await screen.findByTestId("project-help-page")).toBeInTheDocument();
    expect(window.location.search).toBe("?tab=help");

    await user.click(screen.getByRole("button", { name: "Overview" }));
    await waitFor(() => {
      expect(window.location.search).toBe("");
      expect(
        screen.getByText("Authoritative Project Overview"),
      ).toBeInTheDocument();
    });

    act(() => window.history.back());
    await waitFor(() => {
      expect(window.location.search).toBe("?tab=help");
      expect(screen.getByTestId("project-help-page")).toBeInTheDocument();
    });
  });
});
