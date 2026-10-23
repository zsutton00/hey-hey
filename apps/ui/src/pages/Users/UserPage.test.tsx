import type { OrganizationMemberResponseDto } from "@hey-hey/ui-common/api";
import { useProject, useUsers } from "@hey-hey/ui-common/data";
import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import { render, screen } from "@testing-library/react";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { UserDetailPage } from "./UserPage";

const queryState = vi.hoisted(() => ({ activeTab: "overview" }));

vi.mock("nuqs", () => ({
  parseAsStringLiteral: () => ({ withDefault: () => ({}) }),
  useQueryState: () => [queryState.activeTab, vi.fn()],
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useProject: vi.fn(),
  useUsers: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/context", () => ({
  TrackingProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  CapsuleAction: ({ label }: { label: string }) => (
    <button type="button">{label}</button>
  ),
}));

vi.mock("@hey-hey/ui-common/i18n", () => ({
  compose: () => "Project",
  TERMS: { Tasks: "Tasks" },
}));

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: {
    div: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
  },
}));

vi.mock("../../components/Layout", () => ({
  DetailPageBody: ({
    content,
    sidebar,
  }: {
    content: React.ReactNode;
    sidebar: React.ReactNode;
  }) => (
    <div>
      {sidebar}
      {content}
    </div>
  ),
  DetailPageContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DetailPageHeader: ({ title }: { title: React.ReactNode }) => (
    <div>{title}</div>
  ),
  DetailPageSidebar: ({ metadata }: { metadata: React.ReactNode }) => (
    <div>{metadata}</div>
  ),
  DetailPageTabs: ({ tabs }: { tabs: Array<{ label: string }> }) => (
    <div role="tablist">
      {tabs.map((tab) => (
        <button type="button" role="tab" key={tab.label}>
          {tab.label}
        </button>
      ))}
    </div>
  ),
  MetadataPanel: () => <div data-testid="metadata" />,
  PageBreadcrumbs: ({ items }: { items: Array<{ label: string }> }) => (
    <nav aria-label="breadcrumb">
      {items.map((item) => (
        <span key={item.label}>{item.label}</span>
      ))}
    </nav>
  ),
}));

vi.mock("../../components/Tabs", () => ({
  AdminTab: () => <div>Admin content</div>,
  buildAdminMetadataItems: () => [],
}));

vi.mock("../../components/Tabs/AgentSessionsTab", () => ({
  AgentSessionsTab: () => <div>Agent sessions content</div>,
}));

vi.mock("./UserTasksTab", () => ({
  UserTasksTab: () => <div>Tasks content</div>,
}));

vi.mock("./UserActivityTab", () => ({
  UserActivityTab: () => <div>Activity content</div>,
}));

const member: OrganizationMemberResponseDto = {
  id: "membership-1",
  userId: "user-1",
  organizationId: "organization-1",
  role: "ADMIN",
  isActive: true,
  joinedAt: "2026-08-01T00:00:00.000Z",
  createdAt: "2026-08-01T00:00:00.000Z",
  user: {
    id: "user-1",
    name: "Alex Admin",
    email: "alex@example.com",
    isActive: true,
    createdAt: "2026-08-01T00:00:00.000Z",
    updatedAt: "2026-08-18T00:00:00.000Z",
  },
};

const collectionResult = (): ReturnType<typeof useUsers> => ({
  data: [member],
  isLoading: false,
  isFetching: false,
  isFetched: true,
  isReady: true,
  error: null,
  isStale: false,
  refetch: vi.fn(),
  markStale: vi.fn(),
});

const projectResult = (): ReturnType<typeof useProject> => ({
  data: null,
  isLoading: false,
  isFetching: false,
  isFetched: true,
  isReady: true,
  error: null,
  isStale: false,
  refetch: vi.fn(),
  markStale: vi.fn(),
});

const renderRoute = (path: string, routePath: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path={routePath} element={<UserDetailPage />} />
      </Routes>
    </MemoryRouter>
  );

describe("UserDetailPage route scopes", () => {
  beforeEach(() => {
    queryState.activeTab = "overview";
    vi.mocked(useUsers).mockReturnValue(collectionResult());
    vi.mocked(useProject).mockReturnValue(projectResult());
    vi.mocked(useUserIdentity).mockReturnValue({
      userId: "viewer-1",
      email: "viewer@example.com",
      name: "Viewer",
      currentOrgId: "current-organization",
      orgMemberships: [],
      isDevAdmin: false,
      devAdminMode: false,
      isTokenExpired: false,
      currentOrgRole: "MEMBER",
    });
  });

  it("uses the route organization and omits project-only surfaces", () => {
    renderRoute(
      "/organizations/organization-1/users/user-1",
      "/organizations/:organizationId/users/:userId"
    );

    expect(useUsers).toHaveBeenCalledWith("organization-1", {
      enabled: true,
    });
    expect(
      screen.getByRole("navigation", { name: "breadcrumb" })
    ).toHaveTextContent("OrganizationsAlex Admin");
    expect(screen.getByRole("tab", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Admin" })).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Activity" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Tasks" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Agent Sessions" })
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "View Activity" })
    ).not.toBeInTheDocument();
  });

  it("preserves project-scoped tabs and membership resolution", () => {
    renderRoute(
      "/projects/project-1/users/user-1",
      "/projects/:projectId/users/:userId"
    );

    expect(useUsers).toHaveBeenCalledWith("current-organization", {
      enabled: true,
    });
    expect(screen.getByRole("tab", { name: "Activity" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Tasks" })).toBeInTheDocument();
    expect(
      screen.getByRole("tab", { name: "Agent Sessions" })
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "View Activity" })
    ).toBeInTheDocument();
  });

  it("falls back to Overview for a project-only tab on an organization route", () => {
    queryState.activeTab = "activity";

    renderRoute(
      "/organizations/organization-1/users/user-1?tab=activity",
      "/organizations/:organizationId/users/:userId"
    );

    expect(screen.getByText("Profile")).toBeInTheDocument();
    expect(screen.queryByText("Activity content")).not.toBeInTheDocument();
  });
});
