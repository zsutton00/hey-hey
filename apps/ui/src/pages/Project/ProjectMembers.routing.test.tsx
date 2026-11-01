import {
  ProjectRole,
  ProjectStatus,
  WorkItemTypeEffectiveSource,
  WorkItemTypeLifecycleStatus,
  WorkItemTypeRole,
  type WorkItemTypeSummaryDto,
} from "@hey-hey/ui-common/api";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Provider } from "jotai";
import { http, HttpResponse } from "msw";
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

vi.mock("@hey-hey/ui-common/context", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hey-hey/ui-common/context")>()),
  useOrganization: () => ({ currentOrganization: { id: "org-1" } }),
  TrackingProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@hey-hey/ui-common/hooks", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@hey-hey/ui-common/hooks")>();
  return {
    ...actual,
    useUserIdentity: () => ({ currentOrgId: "org-1", userId: "user-1" }),
    useProjectCapabilities: () =>
      actual.projectCapabilitiesForRole(ProjectRole.Owner),
    usePermissions: () => ({ removeMembers: true }),
  };
});

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
  usePlatformAdminAccess: () => ({ isPlatformAdmin: false, isResolved: true }),
  useProjectPlans: () => ({ plans: [], isLoading: false }),
  useWorkItemTypes: () => ({ workItemTypes, isReady: true }),
}));

vi.mock("@hey-hey/ui-common/components", async (importOriginal) => ({
  ProjectMembersPanel: (
    await importOriginal<typeof import("@hey-hey/ui-common/components")>()
  ).ProjectMembersPanel,
  DiscussCapsuleAction: () => null,
  ProjectOverview: () => <div>Authoritative Project Overview</div>,
  PlanList: () => <div data-testid="selected-content">Plans content</div>,
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
  ServicesTab: () => <div>Services content</div>,
  IntegrationsTab: () => <div>Integrations content</div>,
  DesignDocsTab: () => <div data-testid="selected-content">Design Docs</div>,
  ProjectWorkItemsTab: ({ title }: { title: string }) => (
    <div data-testid="selected-content">{title}</div>
  ),
  ProposalsTab: () => <div>Project review records</div>,
}));

vi.mock("./ProjectAgentsTab", () => ({
  ProjectAgentsTab: () => <div>Project Agents composition</div>,
}));

vi.mock("./AboutTabComponents", () => ({ WorkItemTypesList: () => null }));
vi.mock("./EntityPromptTemplatesPanel", () => ({
  EntityPromptTemplatesPanel: () => null,
}));
vi.mock("./ProjectAdminTab", () => ({ ProjectAdminTab: () => null }));

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
    <QueryClientProvider
      client={
        new QueryClient({ defaultOptions: { queries: { retryDelay: 0 } } })
      }
    >
      <Provider>
        <BrowserRouter>
          <NuqsAdapter>
            <Routes>
              <Route path="/projects/:projectId" element={<ProjectPage />} />
            </Routes>
          </NuqsAdapter>
        </BrowserRouter>
      </Provider>
    </QueryClientProvider>,
  );

const initialMember = {
  id: "membership-1",
  userId: "user-1",
  projectId: "project-1",
  role: "MEMBER",
  user: { name: "Alice", email: "alice@example.com" },
};
const newMember = {
  id: "membership-2",
  userId: "user-2",
  projectId: "project-1",
  role: "VIEWER",
  user: { name: "Bob", email: "bob@example.com" },
};
const membersUrl =
  "*/organizations/:organizationId/projects/:projectId/members";
let members = [initialMember];
const requests = vi.fn();

describe("Settings Members route and shared panel", () => {
  beforeEach(() => {
    window.matchMedia = vi.fn((query: string) => ({
      matches: false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    }));
    members = [initialMember];
    window.history.replaceState({}, "", "/projects/project-1?tab=settings");
    globalThis.mswServer.use(
      http.get("*/organizations/:organizationId/members", () =>
        HttpResponse.json({
          data: [initialMember, newMember].map((member) => ({
            ...member,
            organizationId: "org-1",
            isActive: true,
          })),
        }),
      ),
      http.get(membersUrl, ({ params }) => {
        requests("list", {
          organizationId: params.organizationId,
          projectId: params.projectId,
        });
        return HttpResponse.json({
          data: {
            members,
            pagination: {
              page: 1,
              limit: 50,
              total: members.length,
              hasNext: false,
            },
          },
        });
      }),
      http.post(membersUrl, async ({ params, request }) => {
        requests(
          "add",
          {
            organizationId: params.organizationId,
            projectId: params.projectId,
          },
          await request.json(),
        );
        members = [...members, newMember];
        return HttpResponse.json({ data: newMember });
      }),
    );
  });

  it("navigates from Settings, adds with the selected identity and role, and refreshes the real member hook", async () => {
    const user = userEvent.setup();
    renderPage();
    await user.click(
      screen.getByRole("button", { name: "Members", exact: true }),
    );
    expect(await screen.findByRole("link", { name: /Alice/ })).toHaveAttribute(
      "href",
      "/projects/project-1/users/user-1",
    );
    await waitFor(() =>
      expect(window.location.search).toContain("settingsSubTab=members"),
    );
    expect(requests).toHaveBeenCalledWith("list", {
      organizationId: "org-1",
      projectId: "project-1",
    });
    await user.click(screen.getByRole("button", { name: "Add existing user" }));
    await user.click(screen.getByRole("combobox", { name: "User" }));
    await user.click(await screen.findByRole("option", { name: /Bob/ }));
    await user.click(screen.getByRole("combobox", { name: "Role" }));
    await user.click(screen.getByRole("option", { name: "Viewer" }));
    await user.click(screen.getByRole("button", { name: "Add to project" }));
    expect(await screen.findByRole("link", { name: /Bob/ })).toHaveAttribute(
      "href",
      "/projects/project-1/users/user-2",
    );
    expect(requests).toHaveBeenCalledWith(
      "add",
      { organizationId: "org-1", projectId: "project-1" },
      { userId: "user-2", role: "VIEWER" },
    );
    expect(screen.getByTestId("project-members-count")).toHaveTextContent(
      "2 members",
    );
    expect(
      within(screen.getByRole("link", { name: /Bob/ })).getByText("VIEWER"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  it("restores Members on direct entry, remount, and browser back/forward", async () => {
    const user = userEvent.setup();
    window.history.replaceState(
      {},
      "",
      "/projects/project-1?tab=settings&settingsSubTab=members",
    );
    const page = renderPage();
    expect(
      await screen.findByRole("link", { name: /Alice/ }),
    ).toBeInTheDocument();
    page.unmount();
    renderPage();
    expect(
      await screen.findByRole("link", { name: /Alice/ }),
    ).toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Integrations", exact: true }),
    );
    await waitFor(() =>
      expect(window.location.search).toContain("settingsSubTab=integrations"),
    );
    act(() => window.history.back());
    expect(
      await screen.findByTestId("project-members-panel"),
    ).toBeInTheDocument();
    expect(window.location.search).toContain("settingsSubTab=members");
    act(() => window.history.forward());
    expect(await screen.findByText("Integrations content")).toBeInTheDocument();
  });

  it.each(["project", "organization"] as const)(
    "confirms the %s removal scope and refreshes membership",
    async (scope) => {
      globalThis.mswServer.use(
        http.delete(
          scope === "project"
            ? membersUrl + "/:userId"
            : "*/organizations/:organizationId/members/:userId",
          ({ params }) => {
            requests(
              "remove",
              scope === "project"
                ? {
                    organizationId: params.organizationId,
                    projectId: params.projectId,
                    userId: params.userId,
                  }
                : {
                    organizationId: params.organizationId,
                    userId: params.userId,
                  },
            );
            members = [];
            return new HttpResponse(null, { status: 204 });
          },
        ),
      );
      const user = userEvent.setup();
      window.history.replaceState(
        {},
        "",
        "/projects/project-1?tab=settings&settingsSubTab=members",
      );
      renderPage();
      const member = await screen.findByRole("link", { name: /Alice/ });
      await user.click(
        within(member).getByRole("button", { name: "member actions" }),
      );
      await user.click(
        screen.getByRole("menuitem", { name: "Remove from " + scope }),
      );
      expect(screen.getByTestId("remove-member-dialog-body")).toHaveTextContent(
        "Remove Alice from this " + scope,
      );
      expect(
        requests.mock.calls.filter(([operation]) => operation === "remove"),
      ).toHaveLength(0);
      await user.click(screen.getByTestId("remove-member-dialog-cancel"));
      expect(
        await screen.findByRole("link", { name: /Alice/ }),
      ).toBeInTheDocument();
      await user.click(
        within(member).getByRole("button", { name: "member actions" }),
      );
      await user.click(
        screen.getByRole("menuitem", { name: "Remove from " + scope }),
      );
      await user.click(screen.getByTestId("remove-member-dialog-confirm"));
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      await waitFor(() =>
        expect(
          screen.queryByRole("link", { name: /Alice/ }),
        ).not.toBeInTheDocument(),
      );
      expect(requests).toHaveBeenCalledWith(
        "remove",
        scope === "project"
          ? {
              organizationId: "org-1",
              projectId: "project-1",
              userId: "user-1",
            }
          : { organizationId: "org-1", userId: "user-1" },
      );
    },
  );

  it("exposes Members in the mobile Settings dropdown", async () => {
    const matchMedia = vi
      .spyOn(window, "matchMedia")
      .mockImplementation((query) => ({
        matches: query.includes("max-width"),
        media: query,
        onchange: null,
        addListener: vi.fn(),
        removeListener: vi.fn(),
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
        dispatchEvent: vi.fn(),
      }));
    try {
      const user = userEvent.setup();
      renderPage();
      await user.click(screen.getByRole("combobox", { name: "Select view" }));
      await user.click(
        screen.getByRole("option", { name: "Members", exact: true }),
      );
      expect(
        await screen.findByRole("link", { name: /Alice/ }),
      ).toBeInTheDocument();
      await waitFor(() =>
        expect(window.location.search).toContain("settingsSubTab=members"),
      );
    } finally {
      matchMedia.mockRestore();
    }
  });

  it("refreshes from page one after removing a member while a later page is selected", async () => {
    let removed = false;
    globalThis.mswServer.use(
      http.get(membersUrl, ({ request }) => {
        const page = Number(new URL(request.url).searchParams.get("page"));
        return HttpResponse.json({
          data: {
            members: removed || page === 2 ? [newMember] : [initialMember],
            pagination: {
              page,
              limit: 1,
              total: removed ? 1 : 2,
              hasNext: !removed && page === 1,
            },
          },
        });
      }),
      http.delete(membersUrl + "/:userId", () => {
        removed = true;
        return new HttpResponse(null, { status: 204 });
      }),
    );
    const user = userEvent.setup();
    window.history.replaceState(
      {},
      "",
      "/projects/project-1?tab=settings&settingsSubTab=members",
    );
    renderPage();
    await screen.findByRole("link", { name: /Alice/ });
    await user.click(screen.getByRole("button", { name: "Load more" }));
    await screen.findByRole("link", { name: /Bob/ });
    await user.click(
      within(screen.getByRole("link", { name: /Alice/ })).getByRole("button"),
    );
    await user.click(
      screen.getByRole("menuitem", { name: "Remove from project" }),
    );
    await user.click(screen.getByTestId("remove-member-dialog-confirm"));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    await waitFor(() =>
      expect(
        screen.queryByRole("link", { name: /Alice/ }),
      ).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByRole("link", { name: /Bob/ }),
    ).toBeInTheDocument();
    expect(screen.getByTestId("project-members-count")).toHaveTextContent(
      "1 member",
    );
  });

  it("shows a failed membership read as an error instead of an empty list", async () => {
    globalThis.mswServer.use(
      http.get(membersUrl, () => new HttpResponse(null, { status: 500 })),
    );
    window.history.replaceState(
      {},
      "",
      "/projects/project-1?tab=settings&settingsSubTab=members",
    );
    renderPage();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Unable to load project members",
    );
    expect(screen.queryByText("No members yet")).not.toBeInTheDocument();
  });

  it("keeps the add dialog pending, then shows a rejected addition without adding a row", async () => {
    let rejectAddition = () => {};
    const responseReady = new Promise<void>((resolve) => {
      rejectAddition = resolve;
    });
    globalThis.mswServer.use(
      http.post(membersUrl, async () => {
        await responseReady;
        return HttpResponse.json(
          { message: "Membership already exists" },
          { status: 409 },
        );
      }),
    );
    const user = userEvent.setup();
    window.history.replaceState(
      {},
      "",
      "/projects/project-1?tab=settings&settingsSubTab=members",
    );
    renderPage();
    await screen.findByRole("link", { name: /Alice/ });
    await user.click(screen.getByRole("button", { name: "Add existing user" }));
    await user.click(screen.getByRole("combobox", { name: "User" }));
    await user.click(await screen.findByRole("option", { name: /Bob/ }));
    await user.click(screen.getByRole("button", { name: "Add to project" }));
    expect(screen.getByRole("button", { name: "Adding…" })).toBeDisabled();
    rejectAddition();
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Membership already exists",
    );
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(
      screen.queryByRole("link", { name: /Bob/, hidden: true }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Add to project" }),
    ).toBeEnabled();
  });

  it("invites by email with the current project and refreshes the member list", async () => {
    globalThis.mswServer.use(
      http.post(
        "*/organizations/:organizationId/members",
        async ({ request, params }) => {
          requests("invite", params.organizationId, await request.json());
          members = [...members, newMember];
          return HttpResponse.json({ data: { ...newMember, isActive: true } });
        },
      ),
    );
    const user = userEvent.setup();
    window.history.replaceState(
      {},
      "",
      "/projects/project-1?tab=settings&settingsSubTab=members",
    );
    renderPage();
    await screen.findByRole("link", { name: /Alice/ });
    await user.click(screen.getByRole("button", { name: "Invite by email" }));
    await user.type(
      screen.getByRole("textbox", { name: "Email" }),
      "bob@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Send invite" }));
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(
      await screen.findByRole("link", { name: /Bob/ }),
    ).toBeInTheDocument();
    expect(requests).toHaveBeenCalledWith("invite", "org-1", {
      email: "bob@example.com",
      role: "MEMBER",
      projects: [{ projectId: "project-1", role: "MEMBER" }],
    });
  });
});
