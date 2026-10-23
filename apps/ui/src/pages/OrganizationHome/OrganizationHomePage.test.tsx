import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationHomePage } from "./OrganizationHomePage";
import { useAuth, useOrganization } from "@hey-hey/ui-common/context";
import { useAccountDefaultOrganization } from "@hey-hey/ui-common/data";
import { usePermissions } from "@hey-hey/ui-common/hooks";

const createProject = vi.hoisted(() => vi.fn());
const logout = vi.hoisted(() => vi.fn());

vi.mock("@hey-hey/ui-common/components", () => ({
  OrganizationHome: ({
    organizationId,
    onMetricActivate,
    onCreateProject,
    header,
  }: {
    organizationId: string;
    onMetricActivate: (path: string) => void;
    onCreateProject: () => void;
    header: {
      userName: string;
      organization: { id: string; name: string };
      organizations: Array<{ id: string; name: string }>;
      onOrganizationChange: (id: string) => Promise<void>;
      onSetDefault: (id: string) => Promise<void>;
      onLogout: () => Promise<void>;
    };
  }) => (
    <div
      data-testid="organization-home-projects-card"
      data-organization-id={organizationId}
    >
      <span>
        {header.userName}: {header.organization.name}
      </span>
      <button
        data-testid="organization-home-create-project"
        onClick={onCreateProject}
        type="button"
      >
        Create New Project
      </button>
      <button
        onClick={() =>
          void header.onOrganizationChange(header.organizations[1].id)
        }
      >
        Switch organization
      </button>
      <button onClick={() => void header.onSetDefault(header.organization.id)}>
        Set as default
      </button>
      <button onClick={() => void header.onLogout()}>Logout</button>
      <button
        data-testid="organization-home-metric"
        onClick={() =>
          onMetricActivate(
            "/organizations/org-1/activity?metric=TASK_COMPLETED&projectIds=project-2&projectIds=project-1&windowStart=2026-03-01T00%3A00%3A00.000Z&windowEnd=2026-03-02T00%3A00%3A00.000Z&actorScope=PERSONAL&actorUserId=user-1",
          )
        }
        type="button"
      >
        Metric
      </button>
    </div>
  ),
}));

vi.mock("@hey-hey/ui-common/context", () => ({
  useAuth: vi.fn(() => ({
    isAuthenticated: true,
    loading: false,
    logout,
    user: { id: "user-1", name: "Alex" },
  })),
  useOrganization: vi.fn(() => ({
    currentOrganization: { id: "org-1", name: "First organization" },
    organizations: [
      { id: "org-1", name: "First organization" },
      { id: "org-2", name: "Second organization" },
    ],
    switchOrganization: vi.fn().mockResolvedValue(undefined),
    error: null,
    loading: false,
  })),
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: vi.fn(() => ({
    currentOrgId: "org-1",
    userId: "user-1",
    name: "Alex",
  })),
  usePermissions: vi.fn(() => ({ createProjects: true })),
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useAccountDefaultOrganization: vi.fn(() => ({
    state: { status: "ready", preference: { organizationId: null } },
    save: vi.fn().mockResolvedValue(undefined),
    reload: vi.fn().mockResolvedValue(undefined),
  })),
  useProjects: () => ({ create: createProject }),
}));

vi.mock("../../hooks/useShouldShowNewOrgIntro", () => ({
  useShouldShowNewOrgIntro: vi.fn(() => ({
    isReady: true,
    shouldShow: false,
  })),
}));

const LocationProbe = () => {
  const location = useLocation();
  return (
    <div data-testid="location">
      {location.pathname}
      {location.search}
    </div>
  );
};

describe("OrganizationHomePage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(usePermissions).mockReturnValue({
      createProjects: true,
    } as ReturnType<typeof usePermissions>);
    createProject.mockResolvedValue(true);
    logout.mockResolvedValue(undefined);
    vi.mocked(useAccountDefaultOrganization).mockReturnValue({
      state: { status: "ready", preference: { organizationId: null } },
      save: vi.fn().mockResolvedValue(undefined),
      reload: vi.fn().mockResolvedValue(undefined),
    });
  });

  it("shows a profile error instead of inferring a greeting from an identifier", () => {
    vi.mocked(useAuth).mockReturnValueOnce({
      ...useAuth(),
      user: { id: "user-1", email: "alex@example.com" },
    });
    render(
      <MemoryRouter>
        <OrganizationHomePage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent(
      "Unable to load your profile.",
    );
    expect(screen.queryByText("Set as default")).not.toBeInTheDocument();
  });

  it("opens the canonical Activity URL with the exact metric continuation", () => {
    render(
      <MemoryRouter initialEntries={["/home"]}>
        <Routes>
          <Route
            element={
              <>
                <OrganizationHomePage />
                <LocationProbe />
              </>
            }
            path="/home"
          />
          <Route element={<LocationProbe />} path="*" />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId("organization-home-metric"));

    expect(screen.getByTestId("location")).toHaveTextContent(
      "/organizations/org-1/activity?metric=TASK_COMPLETED&projectIds=project-2&projectIds=project-1&windowStart=2026-03-01T00%3A00%3A00.000Z&windowEnd=2026-03-02T00%3A00%3A00.000Z&actorScope=PERSONAL&actorUserId=user-1",
    );
  });

  it("creates a named project from a modal and delegates onboarding navigation", async () => {
    render(
      <MemoryRouter initialEntries={["/home"]}>
        <Routes>
          <Route
            element={
              <>
                <OrganizationHomePage />
                <LocationProbe />
              </>
            }
            path="/home"
          />
          <Route element={<LocationProbe />} path="*" />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId("organization-home-create-project"));

    expect(
      screen.getByRole("dialog", { name: "Create New Project" }),
    ).toBeInTheDocument();
    const createButton = screen.getByRole("button", { name: "Create" });
    expect(createButton).toBeDisabled();

    fireEvent.change(screen.getByLabelText(/Project Name/), {
      target: { value: "  Roadmap  " },
    });
    fireEvent.change(screen.getByLabelText("Description (Optional)"), {
      target: { value: "  Product roadmap  " },
    });
    fireEvent.click(createButton);

    await waitFor(() =>
      expect(createProject).toHaveBeenCalledWith(
        { name: "Roadmap", description: "Product roadmap" },
        expect.objectContaining({ onSuccess: expect.any(Function) }),
      ),
    );
    expect(screen.getByTestId("location")).toHaveTextContent("/home");
  });

  it("does not offer the create-project dialog to callers who cannot create projects", () => {
    vi.mocked(usePermissions).mockReturnValue({
      createProjects: false,
    } as ReturnType<typeof usePermissions>);
    render(
      <MemoryRouter initialEntries={["/home"]}>
        <Routes>
          <Route element={<OrganizationHomePage />} path="/home" />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId("organization-home-create-project"));

    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("passes confirmed names and independent organization/default callbacks to Home", () => {
    render(
      <MemoryRouter>
        <OrganizationHomePage />
      </MemoryRouter>,
    );
    expect(screen.getByText("Alex: First organization")).toBeInTheDocument();
    expect(
      screen.getByTestId("organization-home-projects-card"),
    ).toHaveAttribute("data-organization-id", "org-1");
    expect(useAccountDefaultOrganization).toHaveBeenCalledWith("user-1");
    fireEvent.click(screen.getByText("Switch organization"));
    const organization = vi.mocked(useOrganization).mock.results[0].value;
    const preference = vi.mocked(useAccountDefaultOrganization).mock.results[0]
      .value;
    expect(organization.switchOrganization).toHaveBeenCalledWith("org-2");
    expect(preference.save).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText("Set as default"));
    expect(preference.save).toHaveBeenCalledWith("org-1");
  });

  it("exposes logout on the projects page and waits for shared sign-out", async () => {
    let resolveLogout: (() => void) | undefined;
    logout.mockReturnValueOnce(
      new Promise<void>((resolve) => {
        resolveLogout = resolve;
      }),
    );

    render(
      <MemoryRouter initialEntries={["/projects"]}>
        <Routes>
          <Route
            path="/projects"
            element={
              <>
                <OrganizationHomePage />
                <LocationProbe />
              </>
            }
          />
          <Route path="*" element={<LocationProbe />} />
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Logout" }));

    expect(logout).toHaveBeenCalledOnce();
    expect(screen.getByTestId("location")).toHaveTextContent("/projects");

    resolveLogout?.();

    await waitFor(() =>
      expect(screen.getByTestId("location")).toHaveTextContent("/"),
    );
  });
});
