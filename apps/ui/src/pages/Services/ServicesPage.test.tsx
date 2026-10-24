import React from "react";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { en } from "@hey-hey/ui-common/i18n";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ServicesPage } from "./ServicesPage";

const mocks = vi.hoisted(() => ({
  createServiceForm: vi.fn(),
  createConversation: vi.fn(),
  useConversationByWorkflow: vi.fn(),
  onboardingConversation: null as {
    id: string;
    triggerEvent: string;
  } | null,
  canManageLifecycle: false,
  archive: vi.fn(),
  remove: vi.fn(),
  useServices: vi.fn(),
}));

const activeService = { id: "service-1", name: "UI", status: "ACTIVE" };
const archivedService = { id: "service-2", name: "Legacy", status: "ARCHIVED" };

vi.mock("@hey-hey/ui-common/components", () => ({
  ServicesList: ({
    services,
    renderActions,
    onServiceClick,
  }: {
    services: Array<{ id: string; name: string }>;
    onServiceClick?: (service: { id: string; name: string }) => void;
    renderActions?: (service: { id: string; name: string }) => React.ReactNode;
  }) => (
    <div data-testid="services-list">
      {services.map((service) => (
        <div key={service.id} data-testid={`services-list-row-${service.id}`}>
          <button onClick={() => onServiceClick?.(service)}>
            {service.name}
          </button>
          {renderActions?.(service)}
        </div>
      ))}
    </div>
  ),
}));

vi.mock("@hey-hey/ui-common/components/Services", () => ({
  CreateServiceForm: (props: {
    organizationId: string;
    projectId: string;
    onCancel?: () => void;
  }) => {
    mocks.createServiceForm(props);
    return (
      <div data-testid="shared-create-service-form">
        <button type="button" onClick={props.onCancel}>
          Cancel shared form
        </button>
      </div>
    );
  },
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useProject: () => ({ data: { name: "Example project" } }),
  useServices: mocks.useServices,
  useServiceLifecycle: () => ({
    canManageLifecycle: mocks.canManageLifecycle,
    archive: { mutate: mocks.archive, isPending: false },
    remove: { mutate: mocks.remove, isPending: false },
  }),
  useConversationByWorkflow: mocks.useConversationByWorkflow,
  useCreateConversation: () => ({
    mutate: mocks.createConversation,
  }),
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: () => ({ currentOrgId: "organization-1" }),
}));

vi.mock("../../components/Layout", () => ({
  PageBreadcrumbs: () => <div data-testid="page-breadcrumbs" />,
}));

vi.mock("react-i18next", async (importOriginal) => {
  return {
    ...(await importOriginal<typeof import("react-i18next")>()),
    useTranslation: () => ({
      // `en` is read at render time, after the module graph has loaded.
      t: (key: string, options?: string | Record<string, string>) => {
        if (typeof options === "string") return options;
        const translations: Record<string, string> = en;
        return (translations[key] ?? key).replace(
          /\{\{(\w+)\}\}/g,
          (_match, name: string) => options?.[name] ?? "",
        );
      },
    }),
  };
});

const renderPage = (searchParams = "") =>
  render(
    <NuqsTestingAdapter searchParams={searchParams}>
      <MemoryRouter initialEntries={["/projects/project-1/services"]}>
        <Routes>
          <Route
            path="/projects/:projectId/services"
            element={<ServicesPage />}
          />
          <Route
            path="/projects/:projectId/services/:serviceId"
            element={<LocationProbe />}
          />
          <Route
            path="/projects/:projectId/repository-import"
            element={<LocationProbe />}
          />
        </Routes>
      </MemoryRouter>
    </NuqsTestingAdapter>,
  );

const LocationProbe = () => {
  const location = useLocation();
  return (
    <output data-testid="location">
      {location.pathname + location.search}
    </output>
  );
};

describe("ServicesPage", () => {
  beforeEach(() => {
    mocks.createServiceForm.mockClear();
    mocks.canManageLifecycle = false;
    mocks.archive.mockReset();
    mocks.remove.mockReset();
    mocks.useServices.mockImplementation(
      (_organizationId: string, options: { status?: string }) => ({
        services:
          options.status === "ARCHIVED" ? [archivedService] : [activeService],
        isLoading: false,
        error: null,
        refetch: vi.fn(),
      }),
    );
    mocks.createConversation.mockReset();
    mocks.createConversation.mockResolvedValue({ id: "conversation-1" });
    mocks.useConversationByWorkflow.mockReset();
    mocks.onboardingConversation = null;
    mocks.useConversationByWorkflow.mockImplementation(() => ({
      data: mocks.onboardingConversation,
      isLoading: false,
    }));
  });

  it("opens ui-common's create Service flow", async () => {
    const user = userEvent.setup();
    renderPage();

    await user.click(screen.getByRole("button", { name: "Create Service" }));

    expect(
      screen.getByTestId("shared-create-service-form"),
    ).toBeInTheDocument();
    expect(mocks.createServiceForm).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "organization-1",
        projectId: "project-1",
      }),
    );

    await user.click(
      screen.getByRole("button", { name: "Cancel shared form" }),
    );

    await waitFor(() => {
      expect(
        screen.queryByTestId("shared-create-service-form"),
      ).not.toBeInTheDocument();
    });
  });

  it("labels the repository import tab as Imports", () => {
    renderPage();

    expect(screen.getByRole("tab", { name: "Imports" })).toBeInTheDocument();
    expect(
      screen.queryByRole("tab", { name: "Importing" }),
    ).not.toBeInTheDocument();
  });

  it("creates a typed existing-project import seed before navigating to import", async () => {
    const user = userEvent.setup();
    renderPage();

    expect(mocks.useConversationByWorkflow).toHaveBeenCalledWith(
      "organization-1",
      "project-1",
      "repository-import",
      expect.objectContaining({
        workflowAboutId: "project-1",
        workflowAboutType: "project",
      }),
    );

    await user.click(
      screen.getByRole("button", { name: "Import existing work" }),
    );

    await waitFor(() => {
      expect(mocks.createConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "organization-1",
          projectId: "project-1",
          conversationDto: expect.objectContaining({
            workflowName: "repository-import",
            workflowAboutId: "project-1",
            workflowAboutType: "project",
            triggerEvent: "services_import",
            context: {
              repositoryGrounding: {
                entryMode: "existing_project",
              },
            },
          }),
        }),
      );
    });

    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/projects/project-1/repository-import?conversationId=conversation-1",
    );
  });

  it("offers resume or distinct creation when an unfinished import exists", async () => {
    mocks.onboardingConversation = {
      id: "conversation-existing",
      triggerEvent: "services_import",
    };
    const user = userEvent.setup();
    renderPage();

    await user.click(
      screen.getByRole("button", { name: "Import existing work" }),
    );

    expect(screen.getByRole("dialog")).toHaveTextContent(
      "Unfinished repository import",
    );
    expect(mocks.createConversation).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Resume existing" }));
    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/projects/project-1/repository-import?conversationId=conversation-existing",
    );
  });

  it("creates a distinct conversation when start new is chosen", async () => {
    mocks.onboardingConversation = {
      id: "conversation-existing",
      triggerEvent: "services_import",
    };
    mocks.createConversation.mockResolvedValue({ id: "conversation-new" });
    const user = userEvent.setup();
    renderPage();

    await user.click(
      screen.getByRole("button", { name: "Import existing work" }),
    );
    await user.click(screen.getByRole("button", { name: "Start new import" }));

    await waitFor(() =>
      expect(mocks.createConversation).toHaveBeenCalledTimes(1),
    );
    expect(await screen.findByTestId("location")).toHaveTextContent(
      "/projects/project-1/repository-import?conversationId=conversation-new",
    );
  });

  describe("Service lifecycle", () => {
    it("hides archive and delete actions from roles outside Owner and Architect", () => {
      renderPage();
      expect(
        screen.queryByTestId("service-archive-service-1"),
      ).not.toBeInTheDocument();

      renderPage("?tab=archived");
      expect(
        screen.getByTestId("services-list-row-service-2"),
      ).toBeInTheDocument();
      expect(
        screen.queryByTestId("service-delete-service-2"),
      ).not.toBeInTheDocument();
    });

    it("keeps the active catalog on the default list and lists archived Services on the Archived tab", () => {
      renderPage("?tab=archived");

      expect(mocks.useServices).toHaveBeenCalledWith(
        "organization-1",
        expect.objectContaining({
          projectId: "project-1",
          status: "ARCHIVED",
          enabled: true,
        }),
      );
      expect(mocks.useServices).toHaveBeenCalledWith(
        "organization-1",
        expect.not.objectContaining({ status: expect.anything() }),
      );
      expect(
        screen.queryByTestId("services-list-row-service-1"),
      ).not.toBeInTheDocument();
    });

    it("opens archived Service detail", async () => {
      renderPage("?tab=archived");
      await userEvent.click(screen.getByRole("button", { name: "Legacy" }));
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/projects/project-1/services/service-2",
      );
    });

    it("omits lifecycle and refresh controls even for eligible users", () => {
      mocks.canManageLifecycle = true;
      renderPage("?tab=archived");
      expect(
        screen.queryByTestId("service-delete-service-2"),
      ).not.toBeInTheDocument();
      expect(screen.queryByTitle("Refresh")).not.toBeInTheDocument();
    });
  });
});
