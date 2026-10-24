import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServicePage } from "./ServicePage";

const mocks = vi.hoisted(() => {
  return {
    activeTab: "overview" as string,
    dataClientRequest: vi.fn(),
    serviceSessionLaunchButton: vi.fn(),
    conversationListTab: vi.fn(),
    service: vi.fn(),
    serviceFilesTab: vi.fn(),
    project: vi.fn(),
    setActiveTab: vi.fn(),
    canManageLifecycle: false,
    isPending: false,
    archive: vi.fn(),
    remove: vi.fn(),
  };
});

vi.mock("nuqs", () => ({
  parseAsStringLiteral: () => ({
    withDefault: () => ({}),
  }),
  useQueryState: () => [mocks.activeTab, mocks.setActiveTab],
}));

vi.mock("motion/react", () => ({
  AnimatePresence: ({ children }: { children: React.ReactNode }) => children,
  motion: {
    div: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  },
}));

vi.mock("@hey-hey/ui-common/api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hey-hey/ui-common/api")>()),
  TargetEntityType: { Service: "SERVICE" },
}));

vi.mock("@hey-hey/ui-common/clients", () => ({
  dataClient: { request: mocks.dataClientRequest },
}));

vi.mock("@hey-hey/ui-common/context", () => ({
  TrackingProvider: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useProject: () => mocks.project(),
  useService: () => mocks.service(),
  useServiceLifecycle: () => ({
    canManageLifecycle: mocks.canManageLifecycle,
    archive: { mutate: mocks.archive, isPending: mocks.isPending },
    remove: { mutate: mocks.remove, isPending: false },
  }),
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: () => ({ currentOrgId: "organization-1" }),
}));

vi.mock("@hey-hey/ui-common/i18n", async () => ({
  KEYS: (
    await vi.importActual<typeof import("@hey-hey/ui-common/i18n")>(
      "@hey-hey/ui-common/i18n",
    )
  ).KEYS,
  compose: (value: string) => value,
  TERMS: { Tasks: "Tasks" },
}));

vi.mock("@hey-hey/ui-common/components", () => ({
  CapsuleAction: () => null,
  ServiceDirectoryBindingControl: ({ serviceId }: { serviceId: string }) => (
    <div
      data-testid="service-directory-binding-control"
      data-service-id={serviceId}
    >
      <span>No directory is linked on the connected local CLI.</span>
      <button type="button">Link directory</button>
    </div>
  ),
}));

vi.mock("../../components/Layout", () => ({
  DetailPageBody: ({ content }: { content: React.ReactNode }) => (
    <main>{content}</main>
  ),
  DetailPageContainer: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DetailPageHeader: ({
    title,
    priorityChip,
    actions,
  }: {
    title: string;
    priorityChip?: React.ReactNode;
    actions?: React.ReactNode;
  }) => (
    <header>
      <h1>{title}</h1>
      {priorityChip}
      {actions}
    </header>
  ),
  DetailPageSidebar: () => null,
  DetailPageTabs: ({
    onChange,
    tabs,
    value,
  }: {
    onChange: (value: string) => void;
    tabs: Array<{ label: string; value: string }>;
    value: string;
  }) => (
    <div role="tablist">
      {tabs.map((tab) => (
        <button
          key={tab.value}
          type="button"
          role="tab"
          aria-selected={value === tab.value}
          onClick={() => onChange(tab.value)}
        >
          {tab.label}
        </button>
      ))}
    </div>
  ),
  MetadataPanel: () => null,
  PageBreadcrumbs: () => null,
}));

vi.mock("../../components/Tabs", () => ({
  AdminTab: ({ actions }: { actions?: React.ReactNode }) => (
    <section data-testid="service-admin">{actions}</section>
  ),
  buildAdminMetadataItems: () => [],
  ServiceFilesTab: (props: unknown) => {
    mocks.serviceFilesTab(props);
    return <div>Service files content</div>;
  },
}));
vi.mock("../../components/Tabs/AgentSessionsTab", () => ({
  AgentSessionsTab: () => null,
}));
vi.mock("../../components/Tabs/ConversationListTab", () => ({
  ConversationListTab: (props: unknown) => {
    mocks.conversationListTab(props);
    return null;
  },
}));
vi.mock("../../components/Tabs/DesignDocsTab", () => ({
  DesignDocsTab: () => null,
}));
vi.mock("./ServiceImplementationHintsTab", () => ({
  ServiceImplementationHintsTab: () => null,
}));
vi.mock("../../components/Tabs/TaskTab", () => ({
  TaskTab: () => <div>Tasks content</div>,
}));
vi.mock("../../components/Tasks", () => ({
  NewTaskModal: () => null,
}));
vi.mock("./ServiceSessionLaunchButton", () => ({
  ServiceSessionLaunchButton: (props: unknown) => {
    mocks.serviceSessionLaunchButton(props);
    return <button type="button">Start Service Session</button>;
  },
}));

const service = {
  id: "service-1",
  name: "UI",
  status: "ACTIVE",
  serviceType: "frontend",
  description: "The UI service",
  repositoryUrl: "https://example.com/ui",
  createdAt: "2026-07-31T00:00:00.000Z",
  updatedAt: "2026-07-31T01:00:00.000Z",
  archivedAt: null,
  childCounts: { implementationHints: 0 },
};

const renderPage = () =>
  render(
    <MemoryRouter initialEntries={["/projects/project-1/services/service-1"]}>
      <Routes>
        <Route
          path="/projects/:projectId/services/:serviceId"
          element={<ServicePage />}
        />
        <Route
          path="/projects/:projectId/services"
          element={<div data-testid="services-page" />}
        />
      </Routes>
    </MemoryRouter>,
  );

describe("ServicePage local directory controls", () => {
  beforeEach(() => {
    mocks.activeTab = "overview";
    mocks.setActiveTab.mockReset();
    mocks.service.mockReturnValue({
      data: service,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });
    mocks.serviceFilesTab.mockReset();
    mocks.canManageLifecycle = false;
    mocks.isPending = false;
    mocks.archive.mockReset();
    mocks.remove.mockReset();
    mocks.serviceSessionLaunchButton.mockReset();
    mocks.conversationListTab.mockReset();
    mocks.project.mockReturnValue({ data: { name: "Example project" } });
    window.history.replaceState(
      {},
      "",
      "/projects/project-1/services/service-1",
    );
  });

  it("renders the shared current-CLI directory control and removes Initiatives", () => {
    renderPage();

    expect(
      screen.getByTestId("service-directory-binding-control"),
    ).toHaveAttribute("data-service-id", "service-1");
    expect(
      screen.getByRole("button", { name: "Link directory" }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Initiatives" }),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Files" })).toBeInTheDocument();
  });

  it("renders the Service-scoped Files tab with the selected identity", () => {
    mocks.activeTab = "files";

    renderPage();

    expect(screen.getByText("Service files content")).toBeInTheDocument();
    expect(mocks.serviceFilesTab).toHaveBeenCalledWith({
      organizationId: "organization-1",
      projectId: "project-1",
      serviceId: "service-1",
      active: true,
    });
  });

  it("configures the shared launcher with the displayed Service as fixed scope", () => {
    mocks.activeTab = "sessions";

    renderPage();

    expect(mocks.serviceSessionLaunchButton).toHaveBeenCalledWith({
      organizationId: "organization-1",
      projectId: "project-1",
      serviceId: "service-1",
      serviceName: "UI",
    });
    expect(
      screen.getByRole("button", { name: "Start Service Session" }),
    ).toBeInTheDocument();
  });

  it("does not register the Service session launcher outside Agent Sessions", () => {
    renderPage();

    expect(mocks.serviceSessionLaunchButton).not.toHaveBeenCalled();
  });

  it("queries conversations with the Service as their durable subject", () => {
    mocks.activeTab = "conversations";

    renderPage();

    expect(mocks.conversationListTab).toHaveBeenCalledWith({
      organizationId: "organization-1",
      projectId: "project-1",
      workflowAboutId: "service-1",
      entityName: "UI",
      workflowAboutType: "service",
      conversationPathForId: expect.any(Function),
    });
    expect(
      mocks.conversationListTab.mock.lastCall?.[0].conversationPathForId(
        "conversation-1",
      ),
    ).toBe("/projects/project-1/resolve-agent-session/conversation-1");
  });

  it("keeps the directory-link action available when no local binding is present", () => {
    renderPage();

    expect(
      screen.getByText("No directory is linked on the connected local CLI."),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Link directory" }),
    ).toBeInTheDocument();
  });

  it("normalizes a stale Initiatives query to Overview while retaining remaining tabs", async () => {
    window.history.replaceState(
      {},
      "",
      "/projects/project-1/services/service-1?tab=initiatives",
    );

    renderPage();

    await waitFor(() => {
      expect(mocks.setActiveTab).toHaveBeenCalledWith("overview");
    });
    expect(screen.getByRole("tab", { name: "Overview" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "Tasks" })).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Initiatives" }),
    ).not.toBeInTheDocument();
  });

  it("hides lifecycle actions from roles outside Owner and Architect", () => {
    mocks.activeTab = "admin";
    renderPage();

    expect(
      screen.queryByTestId("service-archive-service-1"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("service-delete-service-1"),
    ).not.toBeInTheDocument();
  });

  it("keeps lifecycle actions out of the header and Overview for eligible users", () => {
    mocks.canManageLifecycle = true;
    renderPage();
    expect(
      screen.queryByTestId("service-archive-service-1"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTitle("Refresh")).not.toBeInTheDocument();
  });

  it("leaves deletion unchanged when confirmation is cancelled in Admin", () => {
    mocks.activeTab = "admin";
    mocks.canManageLifecycle = true;
    mocks.service.mockReturnValue({
      data: { ...service, status: "ARCHIVED" },
      isLoading: false,
    });
    renderPage();
    fireEvent.click(screen.getByTestId("service-delete-service-1"));
    expect(
      screen.getByTestId("service-lifecycle-dialog-body"),
    ).toHaveTextContent("No files or directories are deleted");
    fireEvent.click(screen.getByTestId("service-lifecycle-dialog-cancel"));
    expect(mocks.remove).not.toHaveBeenCalled();
  });

  it("keeps lifecycle errors visible in Admin", async () => {
    mocks.activeTab = "admin";
    mocks.canManageLifecycle = true;
    mocks.archive.mockRejectedValue(new Error("Permission denied"));
    renderPage();
    fireEvent.click(screen.getByTestId("service-archive-service-1"));
    fireEvent.click(screen.getByTestId("service-lifecycle-dialog-confirm"));
    expect(
      await screen.findByTestId("service-lifecycle-dialog-error"),
    ).toHaveTextContent("Permission denied");
  });

  it("disables confirmation and cancellation while an Admin mutation is pending", () => {
    mocks.activeTab = "admin";
    mocks.canManageLifecycle = true;
    mocks.isPending = true;
    renderPage();
    fireEvent.click(screen.getByTestId("service-archive-service-1"));
    expect(
      screen.getByTestId("service-lifecycle-dialog-confirm"),
    ).toBeDisabled();
    expect(
      screen.getByTestId("service-lifecycle-dialog-cancel"),
    ).toBeDisabled();
    expect(mocks.archive).not.toHaveBeenCalled();
  });

  it("archives an active Service from Admin for eligible roles", async () => {
    mocks.activeTab = "admin";
    mocks.canManageLifecycle = true;
    mocks.archive.mockResolvedValue({ ...service, status: "ARCHIVED" });

    renderPage();
    fireEvent.click(screen.getByTestId("service-archive-service-1"));
    fireEvent.click(screen.getByTestId("service-lifecycle-dialog-confirm"));

    await waitFor(() =>
      expect(mocks.archive).toHaveBeenCalledWith("service-1"),
    );
    expect(
      screen.queryByTestId("service-delete-service-1"),
    ).not.toBeInTheDocument();
  });

  it("shows the Archived badge and deletes an archived Service, returning to Services", async () => {
    mocks.activeTab = "admin";
    mocks.canManageLifecycle = true;
    mocks.remove.mockResolvedValue(undefined);
    mocks.service.mockReturnValue({
      data: { ...service, status: "ARCHIVED" },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    renderPage();
    expect(screen.getByTestId("service-archived-badge")).toBeInTheDocument();
    expect(
      screen.queryByTestId("service-archive-service-1"),
    ).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId("service-delete-service-1"));
    fireEvent.click(screen.getByTestId("service-lifecycle-dialog-confirm"));

    await waitFor(() => expect(mocks.remove).toHaveBeenCalledWith("service-1"));
    expect(await screen.findByTestId("services-page")).toBeInTheDocument();
  });
});
