import { useUserIdentity } from "@hey-hey/ui-common/hooks";
import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import Layout from "./Layout";
import { useSuppressLayoutMainBottomSpacing } from "./LayoutMainBottomSpacingContext";
import { useLayoutMainScrollOwner } from "./LayoutMainScrollOwnerContext";
import { PageBreadcrumbs } from "./PageBreadcrumbs";
import { useOrganizationProjectShellVisibility } from "../../hooks/useOrganizationProjectShellVisibility";
import { useKeyboardViewportRecovery } from "../../hooks/useKeyboardViewportRecovery";

vi.mock("../../hooks/useKeyboardViewportRecovery", () => ({
  useKeyboardViewportRecovery: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/hooks", () => ({
  useUserIdentity: vi.fn(),
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  FutureOfferProvider: ({ children }: { children: ReactNode }) => children,
  useUserPairedMachines: () => ({
    machines: [],
    isLoading: false,
  }),
}));

vi.mock("../../hooks/useOrganizationProjectShellVisibility", () => ({
  useOrganizationProjectShellVisibility: vi.fn(),
}));

// Stub the ui-common breadcrumb primitive (rendered via PageBreadcrumbs); it
// pulls in jotai/useProject providers unrelated to the header layout under test.
vi.mock("@hey-hey/ui-common/components", () => ({
  DemoSandboxBanner: ({ enabled }: { enabled?: boolean }) => (
    <div
      data-testid="demo-sandbox-banner-slot"
      data-enabled={String(enabled)}
    />
  ),
  Breadcrumbs: ({ items }: { items: { label: string }[] }) => (
    <nav data-testid="breadcrumbs">
      {items.map((item) => (
        <span className="MuiTypography-root" key={item.label}>
          {item.label}
        </span>
      ))}
    </nav>
  ),
}));

vi.mock("../AnimatedPageWrapper", () => ({
  default: ({ children }: { children: ReactNode }) => <>{children}</>,
}));

vi.mock("../Explorer/ExplorerSidebar", () => ({
  ExplorerSidebar: (props: {
    isMobileDrawer?: boolean;
    onMobileNavigate?: () => void;
  }) => (
    <div data-testid="explorer-sidebar">
      {props.isMobileDrawer && (
        <button onClick={props.onMobileNavigate} type="button">
          Close mobile Explorer
        </button>
      )}
    </div>
  ),
}));

vi.mock("../Notifications", () => ({
  ProjectNotificationCenter: (props: {
    organizationId: string;
    projectId: string;
  }) => (
    <>
      <a
        data-organization-id={props.organizationId}
        data-project-id={props.projectId}
        data-testid="project-notification-center"
        href={`/projects/${props.projectId}?view=coding&tab=agents`}
      >
        Activity
      </a>
    </>
  ),
}));

vi.mock("./ResizableDrawer", () => ({
  ResizableDrawer: ({
    children,
  }: {
    children: (props: { isMinimal: boolean; width: number }) => ReactNode;
  }) => <>{children({ isMinimal: false, width: 280 })}</>,
}));

const useUserIdentityMock = vi.mocked(useUserIdentity);
const useOrganizationProjectShellVisibilityMock = vi.mocked(
  useOrganizationProjectShellVisibility,
);

const setMobileViewport = (isMobile: boolean): void => {
  window.matchMedia = vi.fn().mockImplementation((query: string) => ({
    // MUI's breakpoints.down("md") compiles to a `max-width` media query.
    matches: isMobile && query.includes("max-width"),
    media: query,
    onchange: null,
    addListener: vi.fn(),
    removeListener: vi.fn(),
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  }));
};

const ActivityBreadcrumbsPage = () => (
  <PageBreadcrumbs
    items={[
      { label: "Projects", to: "/projects" },
      { label: "Activity", isCurrent: true, type: "project" },
    ]}
  />
);

const ExistingImportBreadcrumbsPage = () => (
  <PageBreadcrumbs
    items={[
      { label: "Projects", to: "/projects" },
      { label: "Hey Hey", to: "/projects/project-1", type: "project" },
      { label: "Import existing work", isCurrent: true },
    ]}
  />
);

const FirstPage = () => {
  const navigate = useNavigate();

  return (
    <button onClick={() => navigate("/second")} type="button">
      Go to second page
    </button>
  );
};

const SecondPage = () => <div>Second page</div>;

const LocationState = () => {
  const location = useLocation();
  return (
    <div data-testid="location-state">
      {location.pathname}
      {location.search}
    </div>
  );
};

const BoundedConversationPage = () => {
  const navigate = useNavigate();
  useSuppressLayoutMainBottomSpacing(true);
  return (
    <button onClick={() => navigate("/second")} type="button">
      Leave bounded conversation
    </button>
  );
};

const BoundedFeaturesTabPage = () => {
  useSuppressLayoutMainBottomSpacing(true);
  return <div data-testid="bounded-features-tab">Features document</div>;
};

const BottomSpacingOnlyPage = () => {
  useSuppressLayoutMainBottomSpacing(true, { suppressMainScroll: false });
  return <div data-testid="bottom-spacing-only">Normal-flow content</div>;
};

const LayoutScrollOwnerProbe = () => {
  const scrollOwner = useLayoutMainScrollOwner();

  return (
    <div
      data-testid="layout-scroll-owner-probe"
      data-task-context-sticky-top-xs={String(
        scrollOwner?.taskContextStickyTop.xs,
      )}
      data-task-context-sticky-top-md={String(
        scrollOwner?.taskContextStickyTop.md,
      )}
    />
  );
};

describe("Layout", () => {
  it.each([
    [true, "/projects/project-1", true],
    [false, "/projects/project-1", false],
    [true, "/", false],
    [true, "/request-access", false],
  ])("gates viewport recovery for mobile=%s at %s", (mobile, path, enabled) => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    setMobileViewport(mobile);
    render(
      <MemoryRouter initialEntries={[path]}>
        <Routes>
          <Route path="*" element={<Layout />} />
        </Routes>
      </MemoryRouter>,
    );
    expect(useKeyboardViewportRecovery).toHaveBeenLastCalledWith(enabled);
  });
  beforeEach(() => {
    useOrganizationProjectShellVisibilityMock.mockReturnValue({
      isProjectCollectionReady: true,
      shouldShowProjectShell: true,
    });
  });

  afterEach(() => {
    setMobileViewport(false);
  });

  it("resets the main scroll container when the route pathname changes", async () => {
    useUserIdentityMock.mockReturnValue(null);

    const windowScrollToMock = vi.fn();
    Object.defineProperty(window, "scrollTo", {
      configurable: true,
      value: windowScrollToMock,
      writable: true,
    });

    render(
      <MemoryRouter initialEntries={["/first"]}>
        <Routes>
          <Route element={<Layout />} path="/">
            <Route element={<FirstPage />} path="first" />
            <Route element={<SecondPage />} path="second" />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const layoutMain = screen.getByTestId("layout-main");
    layoutMain.scrollTop = 240;

    fireEvent.click(screen.getByRole("button", { name: "Go to second page" }));

    await waitFor(() => {
      expect(screen.getByText("Second page")).toBeInTheDocument();
      expect(screen.getByTestId("layout-main").scrollTop).toBe(0);
    });

    expect(windowScrollToMock).toHaveBeenCalledWith({
      behavior: "auto",
      left: 0,
      top: 0,
    });
  });

  it("suppresses and restores the main bottom spacing for bounded content", async () => {
    useUserIdentityMock.mockReturnValue(null);

    render(
      <MemoryRouter initialEntries={["/bounded"]}>
        <Routes>
          <Route element={<Layout />} path="/">
            <Route element={<BoundedConversationPage />} path="bounded" />
            <Route element={<SecondPage />} path="second" />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const layoutMain = screen.getByTestId("layout-main");
    expect(window.getComputedStyle(layoutMain).paddingBottom).toBe("0px");
    expect(window.getComputedStyle(layoutMain).overflow).toBe("clip");

    fireEvent.click(
      screen.getByRole("button", { name: "Leave bounded conversation" }),
    );

    await waitFor(() => {
      expect(screen.getByText("Second page")).toBeInTheDocument();
      expect(
        window.getComputedStyle(screen.getByTestId("layout-main"))
          .paddingBottom,
      ).toBe("100px");
      expect(
        window.getComputedStyle(screen.getByTestId("layout-main")).overflowY,
      ).toBe("auto");
    });
  });

  it("can suppress bottom spacing while leaving main as the scroll owner", () => {
    useUserIdentityMock.mockReturnValue(null);

    render(
      <MemoryRouter initialEntries={["/normal-flow"]}>
        <Routes>
          <Route element={<Layout />} path="/">
            <Route element={<BottomSpacingOnlyPage />} path="normal-flow" />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const layoutMain = screen.getByTestId("layout-main");
    expect(screen.getByTestId("bottom-spacing-only")).toBeInTheDocument();
    expect(window.getComputedStyle(layoutMain).paddingBottom).toBe("0px");
    expect(window.getComputedStyle(layoutMain).overflowY).toBe("auto");
  });

  it("clips main scrolling when the Features tab owns the viewport", () => {
    useUserIdentityMock.mockReturnValue(null);

    render(
      <MemoryRouter
        initialEntries={["/projects/project-1/features?tab=features"]}
      >
        <Routes>
          <Route element={<Layout />} path="/">
            <Route
              element={<BoundedFeaturesTabPage />}
              path="projects/:projectId/features"
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("bounded-features-tab")).toBeInTheDocument();
    expect(
      window.getComputedStyle(screen.getByTestId("layout-main")).overflow,
    ).toBe("clip");
    expect(
      window.getComputedStyle(screen.getByTestId("layout-main")).paddingBottom,
    ).toBe("0px");
  });

  it("renders project header controls from user identity org context", () => {
    useUserIdentityMock.mockReturnValue({
      currentOrgId: "org-1",
    } as ReturnType<typeof useUserIdentity>);

    render(
      <MemoryRouter initialEntries={["/projects/project-1/activity"]}>
        <Routes>
          <Route element={<Layout />} path="/">
            <Route
              element={<div>Activity page</div>}
              path="projects/:projectId/activity"
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("project-notification-center")).toHaveAttribute(
      "data-organization-id",
      "org-1",
    );
    expect(screen.getByTestId("project-notification-center")).toHaveAttribute(
      "data-project-id",
      "project-1",
    );
    expect(screen.getByTestId("explorer-sidebar")).toBeInTheDocument();
  });

  it("routes the project Pair action to the focused Settings journey", () => {
    useUserIdentityMock.mockReturnValue({
      currentOrgId: "org-1",
    } as ReturnType<typeof useUserIdentity>);

    render(
      <MemoryRouter initialEntries={["/projects/project-1/activity"]}>
        <Routes>
          <Route element={<Layout />} path="/">
            <Route
              element={<div>Activity page</div>}
              path="projects/:projectId/activity"
            />
            <Route
              element={<LocationState />}
              path="projects/:projectId/settings"
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const pairAction = screen.getByTestId("pair-cli-cta");
    expect(pairAction).toHaveAttribute(
      "href",
      "/projects/project-1/settings?section=pairing",
    );

    fireEvent.click(pairAction);

    expect(screen.getByTestId("location-state")).toHaveTextContent(
      "/projects/project-1/settings?section=pairing",
    );
  });

  it("renders the project-agnostic explorer on the organizations page", () => {
    useUserIdentityMock.mockReturnValue({
      currentOrgId: "org-1",
    } as ReturnType<typeof useUserIdentity>);

    render(
      <MemoryRouter initialEntries={["/organizations"]}>
        <Routes>
          <Route element={<Layout />} path="/">
            <Route
              element={<div>Organizations page</div>}
              path="organizations"
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("explorer-sidebar")).toBeInTheDocument();
  });

  it.each([
    {
      label: "unresolved",
      isReady: false,
      projectCount: null,
      shouldShow: true,
    },
    {
      label: "zero projects",
      isReady: true,
      projectCount: 0,
      shouldShow: false,
    },
    { label: "one project", isReady: true, projectCount: 1, shouldShow: false },
    { label: "two projects", isReady: true, projectCount: 2, shouldShow: true },
  ])(
    "$label organization sets desktop project header visibility",
    ({ isReady, shouldShow }) => {
      useOrganizationProjectShellVisibilityMock.mockReturnValue({
        isProjectCollectionReady: isReady,
        shouldShowProjectShell: shouldShow,
      });
      useUserIdentityMock.mockReturnValue({
        currentOrgId: "org-1",
      } as ReturnType<typeof useUserIdentity>);

      render(
        <MemoryRouter initialEntries={["/projects/project-1/activity"]}>
          <Routes>
            <Route element={<Layout />} path="/">
              <Route
                element={<div>Activity page</div>}
                path="projects/:projectId/activity"
              />
            </Route>
          </Routes>
        </MemoryRouter>,
      );

      const header = screen.queryByTestId("desktop-project-header");
      if (shouldShow) {
        expect(header).toBeInTheDocument();
      } else {
        expect(header).not.toBeInTheDocument();
      }
    },
  );

  it("restores the project header in place when the collection grows from one project to two", () => {
    useOrganizationProjectShellVisibilityMock.mockReturnValue({
      isProjectCollectionReady: true,
      shouldShowProjectShell: false,
    });
    useUserIdentityMock.mockReturnValue({
      currentOrgId: "org-1",
    } as ReturnType<typeof useUserIdentity>);

    const view = render(
      <MemoryRouter initialEntries={["/projects/project-1/activity"]}>
        <Routes>
          <Route element={<Layout />} path="/">
            <Route
              element={<div>Activity page</div>}
              path="projects/:projectId/activity"
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(
      screen.queryByTestId("desktop-project-header"),
    ).not.toBeInTheDocument();

    useOrganizationProjectShellVisibilityMock.mockReturnValue({
      isProjectCollectionReady: true,
      shouldShowProjectShell: true,
    });
    view.rerender(
      <MemoryRouter initialEntries={["/projects/project-1/activity"]}>
        <Routes>
          <Route element={<Layout />} path="/">
            <Route
              element={<div>Activity page</div>}
              path="projects/:projectId/activity"
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("desktop-project-header")).toBeInTheDocument();
  });

  it("renders one pinned mobile header with hamburger, breadcrumb slot, and notifications", () => {
    setMobileViewport(true);
    useUserIdentityMock.mockReturnValue({
      currentOrgId: "org-1",
    } as ReturnType<typeof useUserIdentity>);

    render(
      <MemoryRouter initialEntries={["/projects/project-1/activity"]}>
        <Routes>
          <Route element={<Layout />} path="/">
            <Route
              element={<ActivityBreadcrumbsPage />}
              path="projects/:projectId/activity"
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const header = screen.getByTestId("mobile-pinned-header");
    expect(
      within(header).getByTestId("mobile-nav-drawer-toggle"),
    ).toBeInTheDocument();
    expect(
      within(header).getByRole("button", { name: "Menu" }),
    ).toBeInTheDocument();
    expect(
      within(header).getByTestId("mobile-header-breadcrumb-slot"),
    ).toBeInTheDocument();
    expect(
      within(header).getByTestId("project-notification-center"),
    ).toBeInTheDocument();
    expect(header).toHaveStyle({
      display: "grid",
      height: "48px",
      minHeight: "48px",
      gridTemplateColumns: "44px minmax(0, 1fr) 44px",
      overflow: "visible",
    });
    expect(screen.getByTestId("mobile-pinned-header-spacer")).toHaveStyle({
      height: "48px",
    });
    expect(within(header).getByRole("button", { name: "Menu" })).toHaveStyle({
      width: "44px",
      height: "44px",
    });
    expect(
      within(header).queryByTestId("pair-cli-cta"),
    ).not.toBeInTheDocument();
  });

  it("shows the existing-project import in the shared mobile chrome", () => {
    setMobileViewport(true);
    useUserIdentityMock.mockReturnValue({
      currentOrgId: "org-1",
    } as ReturnType<typeof useUserIdentity>);

    render(
      <MemoryRouter
        initialEntries={["/projects/project-1/onboarding?entry=existing"]}
      >
        <Routes>
          <Route element={<Layout />} path="/">
            <Route
              element={<ExistingImportBreadcrumbsPage />}
              path="projects/:projectId/onboarding"
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const header = screen.getByTestId("mobile-pinned-header");
    expect(
      within(header).getByRole("button", { name: "Menu" }),
    ).toBeInTheDocument();
    expect(
      within(header).getByText("Import existing work"),
    ).toBeInTheDocument();
    expect(
      within(header).getByTestId("project-notification-center"),
    ).toHaveAttribute("href", "/projects/project-1?view=coding&tab=agents");

    fireEvent.click(within(header).getByRole("button", { name: "Menu" }));
    expect(screen.getByTestId("explorer-sidebar")).toBeInTheDocument();
  });

  it("keeps the new-project onboarding Explorer suppressed", () => {
    setMobileViewport(true);
    useUserIdentityMock.mockReturnValue({
      currentOrgId: "org-1",
    } as ReturnType<typeof useUserIdentity>);

    render(
      <MemoryRouter initialEntries={["/projects/project-1/onboarding"]}>
        <Routes>
          <Route element={<Layout />} path="/">
            <Route
              element={<div>New project onboarding</div>}
              path="projects/:projectId/onboarding"
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("mobile-pinned-header")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Menu" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("explorer-sidebar")).not.toBeInTheDocument();
  });

  it("keeps the existing-project import breadcrumbs in the desktop chrome", () => {
    setMobileViewport(false);
    useUserIdentityMock.mockReturnValue({
      currentOrgId: "org-1",
    } as ReturnType<typeof useUserIdentity>);

    render(
      <MemoryRouter
        initialEntries={["/projects/project-1/onboarding?entry=existing"]}
      >
        <Routes>
          <Route element={<Layout />} path="/">
            <Route
              element={<ExistingImportBreadcrumbsPage />}
              path="projects/:projectId/onboarding"
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("desktop-project-header")).toBeInTheDocument();
    expect(screen.getByTestId("explorer-sidebar")).toBeInTheDocument();
    expect(screen.getByText("Projects")).toBeInTheDocument();
    expect(screen.getByText("Hey Hey")).toBeInTheDocument();
    expect(screen.getByText("Import existing work")).toBeInTheDocument();
  });

  it("closes the mobile Explorer drawer through its navigation callback", async () => {
    setMobileViewport(true);
    useUserIdentityMock.mockReturnValue({
      currentOrgId: "org-1",
    } as ReturnType<typeof useUserIdentity>);

    render(
      <MemoryRouter initialEntries={["/projects/project-1/activity"]}>
        <Routes>
          <Route element={<Layout />} path="/">
            <Route
              element={<div>Activity page</div>}
              path="projects/:projectId/activity"
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByTestId("mobile-nav-drawer-toggle"));
    expect(
      screen.getByRole("button", { name: "Close mobile Explorer" }),
    ).toBeVisible();

    fireEvent.click(
      screen.getByRole("button", { name: "Close mobile Explorer" }),
    );

    await waitFor(() => {
      expect(
        screen.queryByRole("button", { name: "Close mobile Explorer" }),
      ).not.toBeInTheDocument();
    });
  });

  it("folds page breadcrumbs into the mobile header slot", () => {
    setMobileViewport(true);
    useUserIdentityMock.mockReturnValue({
      currentOrgId: "org-1",
    } as ReturnType<typeof useUserIdentity>);

    render(
      <MemoryRouter initialEntries={["/projects/project-1/activity"]}>
        <Routes>
          <Route element={<Layout />} path="/">
            <Route
              element={<ActivityBreadcrumbsPage />}
              path="projects/:projectId/activity"
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const slot = screen.getByTestId("mobile-header-breadcrumb-slot");
    expect(within(slot).getByText("Activity")).toBeInTheDocument();
  });

  it("keeps the desktop breadcrumb path in-flow without a pinned mobile header", () => {
    setMobileViewport(false);
    useUserIdentityMock.mockReturnValue({
      currentOrgId: "org-1",
    } as ReturnType<typeof useUserIdentity>);

    render(
      <MemoryRouter initialEntries={["/projects/project-1/activity"]}>
        <Routes>
          <Route element={<Layout />} path="/">
            <Route
              element={<ActivityBreadcrumbsPage />}
              path="projects/:projectId/activity"
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(
      screen.queryByTestId("mobile-pinned-header"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("mobile-nav-drawer-toggle"),
    ).not.toBeInTheDocument();
    expect(
      within(screen.getByTestId("breadcrumbs")).getByText("Activity"),
    ).toBeInTheDocument();
  });

  it("keeps the task context below the desktop Project Chrome breadcrumbs", () => {
    setMobileViewport(false);
    useUserIdentityMock.mockReturnValue({
      currentOrgId: "org-1",
    } as ReturnType<typeof useUserIdentity>);

    render(
      <MemoryRouter initialEntries={["/projects/project-1/activity"]}>
        <Routes>
          <Route element={<Layout />} path="/">
            <Route
              element={
                <>
                  <ActivityBreadcrumbsPage />
                  <LayoutScrollOwnerProbe />
                </>
              }
              path="projects/:projectId/activity"
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("layout-scroll-owner-probe")).toHaveAttribute(
      "data-task-context-sticky-top-xs",
      "48px",
    );
    expect(screen.getByTestId("layout-scroll-owner-probe")).toHaveAttribute(
      "data-task-context-sticky-top-md",
      "48px",
    );
  });

  it.each([
    { path: "/", pageName: "Landing page", expectsNoPadding: true },
    { path: "/request-access", pageName: "Request Access page" },
  ])(
    "renders the public marketing shell only around $pageName",
    ({ path, pageName, expectsNoPadding }) => {
      useUserIdentityMock.mockReturnValue(null);

      render(
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<Layout />} path="/">
              <Route index element={<div>Landing page</div>} />
              <Route
                element={<div>Request Access page</div>}
                path="request-access"
              />
            </Route>
          </Routes>
        </MemoryRouter>,
      );

      const layoutMain = screen.getByTestId("layout-main");
      const shell = screen.getByTestId("public-marketing-shell");

      expect(screen.getByText(pageName)).toBeInTheDocument();
      expect(shell).toContainElement(screen.getByTestId("site-legal-footer"));
      expect(window.getComputedStyle(layoutMain).height).toBe("auto");
      expect(window.getComputedStyle(layoutMain).overflowY).toBe("visible");
      expect(window.getComputedStyle(layoutMain).paddingBottom).toBe("0px");
      if (expectsNoPadding) {
        expect(window.getComputedStyle(layoutMain).paddingLeft).toBe("0px");
        expect(window.getComputedStyle(layoutMain).paddingRight).toBe("0px");
      }
    },
  );

  it("excludes the marketing footer from authenticated application routes", () => {
    useUserIdentityMock.mockReturnValue({
      currentOrgId: "org-1",
    } as ReturnType<typeof useUserIdentity>);

    render(
      <MemoryRouter initialEntries={["/projects/project-1/activity"]}>
        <Routes>
          <Route element={<Layout />} path="/">
            <Route
              element={<div>Authenticated activity</div>}
              path="projects/:projectId/activity"
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByText("Authenticated activity")).toBeInTheDocument();
    expect(
      screen.queryByTestId("public-marketing-shell"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("site-legal-footer")).not.toBeInTheDocument();
  });

  it("mounts the demo sandbox banner in the authenticated shell, enabled for signed-in users", () => {
    useUserIdentityMock.mockReturnValue({
      currentOrgId: "org-1",
    } as ReturnType<typeof useUserIdentity>);

    render(
      <MemoryRouter initialEntries={["/projects/project-1/activity"]}>
        <Routes>
          <Route element={<Layout />} path="/">
            <Route
              element={<div>Authenticated activity</div>}
              path="projects/:projectId/activity"
            />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    expect(screen.getByTestId("demo-sandbox-banner-slot")).toHaveAttribute(
      "data-enabled",
      "true",
    );
  });

  it.each(["/", "/request-access", "/demo"])(
    "does not mount the demo sandbox banner on the public page %s",
    (path) => {
      useUserIdentityMock.mockReturnValue(null);

      render(
        <MemoryRouter initialEntries={[path]}>
          <Routes>
            <Route element={<Layout />} path="/">
              <Route element={<div>Public page</div>} index />
              <Route element={<div>Public page</div>} path="request-access" />
              <Route element={<div>Public page</div>} path="demo" />
            </Route>
          </Routes>
        </MemoryRouter>,
      );

      expect(screen.getByText("Public page")).toBeInTheDocument();
      expect(
        screen.queryByTestId("demo-sandbox-banner-slot"),
      ).not.toBeInTheDocument();
    },
  );

  it("treats organization Home as an authenticated application surface", () => {
    useUserIdentityMock.mockReturnValue({
      currentOrgId: "org-1",
    } as ReturnType<typeof useUserIdentity>);

    render(
      <MemoryRouter initialEntries={["/home"]}>
        <Routes>
          <Route element={<Layout />} path="/">
            <Route element={<div>Organization Home</div>} path="home" />
          </Route>
        </Routes>
      </MemoryRouter>,
    );

    const layoutMain = screen.getByTestId("layout-main");
    expect(screen.getByText("Organization Home")).toBeInTheDocument();
    expect(
      screen.queryByTestId("public-marketing-shell"),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("site-legal-footer")).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("desktop-project-header"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("mobile-pinned-header"),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("mobile-pinned-header-spacer"),
    ).not.toBeInTheDocument();
    expect(window.getComputedStyle(layoutMain).height).toBe("100dvh");
    expect(window.getComputedStyle(layoutMain).overflowY).toBe("auto");
  });
});
