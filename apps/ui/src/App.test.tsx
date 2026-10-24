import { useOrganization } from "@hey-hey/ui-common/context";
import { render, screen, within } from "@testing-library/react";
import { isValidElement, type ReactNode } from "react";
import { AppProtectedRoute } from "./components/AppProtectedRoute";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import App, { AppRouteShell, router } from "./App";
import { useOrganizationProjectShellVisibility } from "./hooks/useOrganizationProjectShellVisibility";

const { openItemsScopeMock } = vi.hoisted(() => ({
  openItemsScopeMock: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/context", () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  CanonicalPageProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="canonical-page-provider">{children}</div>
  ),
  DebugProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  DndProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  EntityActivationProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  OpenItemLocatorProvider: ({ children }: { children: ReactNode }) => children,
  ModalProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  OrganizationProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
  WebSocketProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
  useOrganization: vi.fn(),
  useAuth: () => ({ user: { id: "user-1" } }),
}));

vi.mock("@hey-hey/ui-common/components/ActionsCapsule", () => ({
  ActionsCapsule: () => <div data-testid="actions-capsule" />,
  ActionsCapsuleProvider: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("@hey-hey/ui-common/components/GuidedWalkthrough", () => ({
  GuidedWalkthroughProvider: ({ children }: { children: ReactNode }) => (
    <div data-testid="guided-walkthrough-provider">{children}</div>
  ),
  CanonicalWalkthroughEvents: () => (
    <div data-testid="canonical-walkthrough-events" />
  ),
}));

vi.mock("@hey-hey/ui-common/clients", () => ({
  WebClientProvider: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  ControllerAuthorizationPromptHost: () => null,
  hasDemoSandboxSession: () => false,
  useDemoSandbox: () => ({
    sandbox: null,
    isReady: true,
    isLoading: false,
    error: null,
  }),
}));

vi.mock("./components/OrganizationAccessBoundary", () => ({
  OrganizationAccessBoundary: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  RouterProvider: () => <div data-testid="router-provider" />,
}));

vi.mock("./hooks/useOrganizationProjectShellVisibility", () => ({
  useOrganizationProjectShellVisibility: vi.fn(),
}));

vi.mock("./hooks/usePageMetadata", () => ({
  usePageMetadata: vi.fn(),
}));

vi.mock("./hooks/useTabLocationRegistry", () => ({
  useTabLocationRegistry: vi.fn(),
}));

vi.mock("./contexts/OpenItemsContext", () => ({
  OpenItemsProvider: ({
    children,
    ...scope
  }: {
    children: ReactNode;
    organizationId: string | null;
    projectId: string | null;
    userId: string | null;
  }) => {
    openItemsScopeMock(scope);
    return <>{children}</>;
  },
  useOpenItemsActivationSink: () => vi.fn(),
  useOpenItemLocatorHandler: () => vi.fn(),
}));

vi.mock("./components/OpenItemsPreviewHost", () => ({
  OpenItemsPreviewHost: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("./components/LazyAnimatePresence", () => ({
  LazyAnimatePresence: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));

vi.mock("./components/HeyHeyModal", () => ({
  HeyHeyModal: () => null,
}));

vi.mock("./components/Layout", () => ({
  Layout: () => {
    const { shouldShowProjectShell } = useOrganizationProjectShellVisibility();
    return shouldShowProjectShell ? <div data-testid="project-chrome" /> : null;
  },
}));

const useOrganizationMock = vi.mocked(useOrganization);
const useOrganizationProjectShellVisibilityMock = vi.mocked(
  useOrganizationProjectShellVisibility,
);

const renderShell = () =>
  render(
    <MemoryRouter initialEntries={["/projects/project-1/activity"]}>
      <AppRouteShell />
    </MemoryRouter>,
  );

describe("AppRouteShell", () => {
  beforeEach(() => {
    useOrganizationMock.mockReturnValue({
      currentOrganization: { id: "org-1" },
      loading: false,
    } as ReturnType<typeof useOrganization>);
  });

  it.each([
    { label: "unresolved", isReady: false, shouldShow: true },
    { label: "zero projects", isReady: true, shouldShow: false },
    { label: "one project", isReady: true, shouldShow: false },
    { label: "two projects", isReady: true, shouldShow: true },
  ])(
    "$label organization keeps entity actions independent from project chrome",
    async ({ isReady, shouldShow }) => {
      useOrganizationProjectShellVisibilityMock.mockReturnValue({
        isProjectCollectionReady: isReady,
        shouldShowProjectShell: shouldShow,
      });

      renderShell();
      expect(openItemsScopeMock).toHaveBeenLastCalledWith({
        organizationId: "org-1",
        projectId: "project-1",
        userId: "user-1",
      });

      if (shouldShow) {
        expect(screen.getByTestId("project-chrome")).toBeInTheDocument();
        expect(
          await screen.findByTestId("actions-capsule"),
        ).toBeInTheDocument();
      } else {
        expect(screen.queryByTestId("project-chrome")).not.toBeInTheDocument();
        expect(
          await screen.findByTestId("actions-capsule"),
        ).toBeInTheDocument();
      }
    },
  );

  it("restores project chrome without changing entity actions", async () => {
    useOrganizationProjectShellVisibilityMock.mockReturnValue({
      isProjectCollectionReady: true,
      shouldShowProjectShell: false,
    });
    const view = renderShell();

    expect(screen.queryByTestId("project-chrome")).not.toBeInTheDocument();
    expect(await screen.findByTestId("actions-capsule")).toBeInTheDocument();

    useOrganizationProjectShellVisibilityMock.mockReturnValue({
      isProjectCollectionReady: true,
      shouldShowProjectShell: true,
    });
    view.rerender(
      <MemoryRouter initialEntries={["/projects/project-1/activity"]}>
        <AppRouteShell />
      </MemoryRouter>,
    );

    expect(screen.getByTestId("project-chrome")).toBeInTheDocument();
    expect(await screen.findByTestId("actions-capsule")).toBeInTheDocument();
  });
});

describe("guided walkthrough mounting", () => {
  beforeEach(() => {
    useOrganizationMock.mockReturnValue({
      currentOrganization: { id: "org-1" },
      loading: false,
    } as ReturnType<typeof useOrganization>);
    useOrganizationProjectShellVisibilityMock.mockReturnValue({
      isProjectCollectionReady: true,
      shouldShowProjectShell: true,
    });
  });

  it("runs the walkthrough above the router so it survives navigation", () => {
    render(<App />);

    expect(
      within(screen.getByTestId("guided-walkthrough-provider")).getByTestId(
        "router-provider",
      ),
    ).toBeInTheDocument();
  });

  it("observes canonical pages inside the per-project route shell", () => {
    renderShell();

    expect(
      within(screen.getByTestId("canonical-page-provider")).getByTestId(
        "canonical-walkthrough-events",
      ),
    ).toBeInTheDocument();
  });
});

describe("application routes", () => {
  it("registers protected report creation and dated detail routes", () => {
    const children = router.routes.flatMap((route) => route.children ?? []);
    const create = children.find(
      (route) => route.path === "projects/:projectId/reports/new",
    );
    const detail = children.find(
      (route) => route.path === "projects/:projectId/reports/:reportId",
    );
    for (const route of [create, detail]) {
      expect(isValidElement<{ children: ReactNode }>(route?.element)).toBe(
        true,
      );
      if (!isValidElement<{ children: ReactNode }>(route?.element))
        throw new Error("Missing route element");
      const protectedElement = route.element.props.children;
      expect(isValidElement(protectedElement) && protectedElement.type).toBe(
        AppProtectedRoute,
      );
    }
    expect(create).toBeDefined();
    expect(detail).toBeDefined();
  });
  it("registers the admin area tabs without replacing the selected-organization route", () => {
    const children = router.routes.flatMap((route) => route.children ?? []);
    const admin = children.find((route) => route.path === "admin");
    const adminPaths = admin?.children?.map((child) => child.path) ?? [];

    expect(adminPaths).toEqual(
      expect.arrayContaining([
        "organizations",
        "organizations/:organizationId",
        "beta-access",
        "demo",
      ]),
    );
    expect(children.map((child) => child.path)).toContain("organizations");
    expect(children.map((child) => child.path)).not.toContain(
      "debug/private-beta-access",
    );
  });

  it("registers project- and organization-scoped User Pages", () => {
    const childPaths = router.routes.flatMap(
      (route) => route.children?.map((child) => child.path) ?? [],
    );

    expect(childPaths).toContain("projects/:projectId/users/:userId");
    expect(childPaths).toContain("organizations/:organizationId/users/:userId");
  });

  it("registers organization Home as a protected application route", () => {
    const childRoutes = router.routes.flatMap((route) => route.children ?? []);
    const childPaths = childRoutes.map((child) => child.path);

    expect(childPaths).toContain("home");
    expect(
      childRoutes.find((route) => route.path === "projects")?.element,
    ).toEqual(childRoutes.find((route) => route.path === "home")?.element);
  });

  it("registers pairing as a deployment-level route without a project parameter", () => {
    const childPaths = router.routes.flatMap(
      (route) => route.children?.map((child) => child.path) ?? [],
    );

    expect(childPaths).toContain("pairing");
    expect(childPaths).toContain("add-controller");
    expect(childPaths).not.toContain("projects/:projectId/pairing");
  });

  it("removes the legacy project-list route while retaining project onboarding", () => {
    const childPaths = router.routes.flatMap(
      (route) => route.children?.map((child) => child.path) ?? [],
    );

    expect(childPaths).not.toContain("onboarding");
    expect(childPaths).toContain("projects/:projectId/onboarding");
  });

  it("keeps the Goals list and resolves Goal details through work-item routes", () => {
    const childPaths = router.routes.flatMap(
      (route) => route.children?.map((child) => child.path) ?? [],
    );

    expect(childPaths).toContain("projects/:projectId/goals");
    expect(childPaths).not.toContain("projects/:projectId/goals/:taskId");
    expect(childPaths).toContain("projects/:projectId/tasks/:taskId");
    expect(childPaths).toContain("tasks/:taskId");
    expect(childPaths).toContain("work-items/:id");
  });
});
