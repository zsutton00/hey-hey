import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import "@testing-library/jest-dom";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { I18nextProvider } from "react-i18next";
import {
  MemoryRouter,
  Route,
  Routes,
  useParams,
  useSearchParams,
} from "react-router-dom";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import React, { type ReactNode } from "react";
import i18n from "@hey-hey/ui-common/i18n";
import type {
  CreateProjectDto,
  ProjectResponseDto,
} from "@hey-hey/ui-common/api";
import { ProjectStatus } from "@hey-hey/ui-common/api";
import NewOrgLandingPage from "../NewOrgLandingPage";

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const USER_ID = "22222222-2222-4222-8222-222222222222";
const NEW_PROJECT_ID = "33333333-3333-4333-8333-333333333333";

const projectsState: { projects: ProjectResponseDto[] } = { projects: [] };
const permissionsState = { createProjects: true };
const entitlementState = {
  canCreateProject: true,
  creationUnavailableReason: null as string | null,
};

/** The placeholder project the advance button stands up via useProjects.create. */
const createdProject: ProjectResponseDto = {
  id: NEW_PROJECT_ID,
  organizationId: ORG_ID,
  name: "My First Project",
  status: ProjectStatus.Onboarding,
  createdBy: USER_ID,
  createdAt: "2026-05-20T00:00:00.000Z",
  updatedAt: "2026-05-20T00:00:00.000Z",
};

/**
 * Stand-in for useProjects.create: mirrors the real callback contract by
 * resolving the freshly created project through onSuccess, so the page can
 * navigate to the project-scoped onboarding route.
 */
const createProjectMock = vi.fn(
  async (
    _projectData: CreateProjectDto,
    callbacks?: {
      skipNavigation?: boolean;
      onSuccess?: (project: ProjectResponseDto) => void;
    },
  ): Promise<boolean> => {
    callbacks?.onSuccess?.(createdProject);
    return true;
  },
);

vi.mock("@hey-hey/ui-common/hooks", async () => {
  const actual = await vi.importActual<
    typeof import("@hey-hey/ui-common/hooks")
  >("@hey-hey/ui-common/hooks");
  return {
    ...actual,
    usePermissions: () => ({ createProjects: permissionsState.createProjects }),
    useUserIdentity: () => ({
      userId: USER_ID,
      email: "test@example.com",
      name: "Test User",
      currentOrgId: ORG_ID,
      orgMemberships: [{ orgId: ORG_ID, role: "admin" }],
      isDevAdmin: false,
      devAdminMode: false,
      isTokenExpired: false,
      currentOrgRole: "admin",
    }),
  };
});

vi.mock("@hey-hey/ui-common/context", async () => {
  const actual = await vi.importActual<
    typeof import("@hey-hey/ui-common/context")
  >("@hey-hey/ui-common/context");
  return {
    ...actual,
    TrackingProvider: ({ children }: { children: React.ReactNode }) => (
      <>{children}</>
    ),
    useOrganization: () => ({
      organizations: [
        {
          id: ORG_ID,
          name: "New Org",
          slug: "new-org",
          isActive: true,
          userRole: "admin",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
        },
      ],
      currentOrganization: {
        id: ORG_ID,
        name: "New Org",
        slug: "new-org",
        isActive: true,
        userRole: "admin",
        createdAt: "2026-01-01T00:00:00.000Z",
        updatedAt: "2026-01-01T00:00:00.000Z",
      },
      loading: false,
      error: null,
      switchOrganization: vi.fn(),
      refreshOrganizations: vi.fn(),
      createOrganization: vi.fn(),
    }),
  };
});

vi.mock("@hey-hey/ui-common/data", () => ({
  useProjects: () => ({
    projects: projectsState.projects,
    isLoading: false,
    isFetching: false,
    isFetched: true,
    isReady: true,
    error: null,
    isStale: false,
    fetchingProjects: false,
    create: createProjectMock,
    update: vi.fn(),
    remove: vi.fn(),
    selectProject: vi.fn(),
    refetch: vi.fn(),
    markStale: vi.fn(),
    clearError: vi.fn(),
    entitlement: {
      defaultProjectLimit: 2,
      projectLimitOverride: null,
      projectLimit: 2,
      usage: {
        projectCount: 0,
        workItemCount: 0,
        observedAt: "2026-08-11T20:00:00.000Z",
      },
      canCreateProject: entitlementState.canCreateProject,
      creationUnavailableReason: entitlementState.creationUnavailableReason,
    },
    entitlementLoading: false,
    refreshEntitlement: vi.fn(),
  }),
}));

vi.mock("@hey-hey/ui-common/components", async () => {
  const actual = await vi.importActual<
    typeof import("@hey-hey/ui-common/components")
  >("@hey-hey/ui-common/components");
  return {
    ...actual,
    MiniDemoPlayer: ({
      scenes,
    }: {
      scenes: Array<{ id: string; content: ReactNode }>;
    }) => (
      <div data-testid="mini-demo-player">
        {scenes.map((scene) => (
          <div key={scene.id} data-testid={`mini-demo-scene-${scene.id}`}>
            {scene.content}
          </div>
        ))}
      </div>
    ),
  };
});

const SEEN_KEY = `heyhey:newOrgIntroSeen:${ORG_ID}`;

const mockProject: ProjectResponseDto = {
  id: "project-with-data",
  organizationId: ORG_ID,
  name: "Existing Project",
  status: ProjectStatus.Active,
  createdBy: USER_ID,
  createdAt: "2026-02-01T00:00:00.000Z",
  updatedAt: "2026-02-01T00:00:00.000Z",
};

/**
 * Stand-in onboarding destination. Surfaces the routed project id and the
 * isNew search param as attributes so tests can assert the advance button
 * landed on the project-scoped onboarding route.
 */
const OnboardingHandoff: React.FC = () => {
  const { projectId } = useParams();
  const [searchParams] = useSearchParams();
  return (
    <div
      data-testid="onboarding-handoff"
      data-project-id={projectId}
      data-is-new={searchParams.get("isNew") ?? ""}
    >
      handoff
    </div>
  );
};

const renderLanding = (searchParams = ""): void => {
  const theme = createTheme();

  render(
    <ThemeProvider theme={theme}>
      <I18nextProvider i18n={i18n}>
        <NuqsTestingAdapter searchParams={searchParams}>
          <MemoryRouter initialEntries={["/welcome"]}>
            <Routes>
              <Route path="/welcome" element={<NewOrgLandingPage />} />
              <Route
                path="/projects/:projectId/onboarding"
                element={<OnboardingHandoff />}
              />
              <Route
                path="/projects"
                element={
                  <div data-testid="project-picker">project picker</div>
                }
              />
            </Routes>
          </MemoryRouter>
        </NuqsTestingAdapter>
      </I18nextProvider>
    </ThemeProvider>,
  );
};

describe("NewOrgLandingPage Integration Tests", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.localStorage.clear();
    projectsState.projects = [];
    permissionsState.createProjects = true;
    entitlementState.canCreateProject = true;
    entitlementState.creationUnavailableReason = null;
  });

  it("replaces the start button with an owner-or-admin message for roles that cannot create projects", async () => {
    permissionsState.createProjects = false;

    renderLanding();

    expect(
      await screen.findByTestId("new-org-landing-create-unavailable"),
    ).toHaveTextContent("owner or admin");
    expect(
      screen.queryByTestId("new-org-landing-advance"),
    ).not.toBeInTheDocument();
    expect(createProjectMock).not.toHaveBeenCalled();
  });

  it("shows the backend denial and disables project creation", async () => {
    entitlementState.canCreateProject = false;
    entitlementState.creationUnavailableReason =
      "This organization has reached its project limit (2). Ask an organization owner or admin to increase the limit.";

    renderLanding();

    expect(
      await screen.findByTestId("new-org-project-limit-message"),
    ).toHaveTextContent("reached its project limit");
    expect(screen.getByTestId("new-org-landing-advance")).toBeDisabled();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  it("renders all three sections together and hands off to the project-creation flow on advance", async () => {
    projectsState.projects = [];
    renderLanding();

    await waitFor(() => {
      expect(screen.getByTestId("new-org-landing-page")).toBeInTheDocument();
    });

    // The welcome intro block greets the user before the onboarding steps.
    const intro = screen.getByTestId("new-org-landing-intro");
    expect(intro).toBeInTheDocument();
    const mascot = screen.getByTestId("new-org-landing-intro-mascot");
    expect(mascot).toBeInTheDocument();
    expect(mascot).toHaveAttribute("alt");
    expect(
      screen.getByTestId("new-org-landing-intro-heading"),
    ).toBeInTheDocument();
    expect(screen.getByTestId("new-org-landing-intro-body")).toBeInTheDocument();

    // The intro renders ahead of the first onboarding section scene.
    const firstSection = screen.getByTestId(
      "new-org-landing-section-project-description",
    );
    expect(
      intro.compareDocumentPosition(firstSection) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    // All three section scenes are present on a single screen.
    expect(
      screen.getByTestId("mini-demo-scene-project-description"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("mini-demo-scene-followups"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("mini-demo-scene-features"),
    ).toBeInTheDocument();

    // Each section renders its own bespoke scripted scene.
    expect(
      screen.getByTestId("new-org-landing-project-description-scene"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("new-org-landing-followups-scene"),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("new-org-landing-features-scene"),
    ).toBeInTheDocument();

    // Each section pairs the demo with its description.
    expect(
      screen.getByTestId(
        "new-org-landing-section-description-project-description",
      ),
    ).toHaveTextContent(
      "Describe your project — more detail is better, but a paragraph is enough to get started.",
    );
    expect(
      screen.getByTestId("new-org-landing-section-description-followups"),
    ).toHaveTextContent(
      "We'll ask follow-up questions to understand goals; you can answer N/A to skip any question you don't want to answer.",
    );
    expect(
      screen.getByTestId("new-org-landing-section-description-features"),
    ).toHaveTextContent(
      "At the end of the conversation, Hey Hey breaks the project down into a starter set of features.",
    );

    // The single advance button stands up a placeholder project and hands off
    // to the project-scoped onboarding intake.
    expect(
      screen.getByTestId("new-org-landing-advance"),
    ).toHaveTextContent("Start setting up your project");

    act(() => {
      fireEvent.click(screen.getByTestId("new-org-landing-advance"));
    });

    const handoff = await screen.findByTestId("onboarding-handoff");
    expect(createProjectMock).toHaveBeenCalledTimes(1);
    expect(handoff).toHaveAttribute("data-project-id", NEW_PROJECT_ID);
    expect(handoff).toHaveAttribute("data-is-new", "t");

    expect(screen.queryByTestId("new-org-landing-page")).not.toBeInTheDocument();
    expect(window.localStorage.getItem(SEEN_KEY)).toBe("1");
  });

  it("redirects to the project picker when the org already has projects", async () => {
    projectsState.projects = [mockProject];
    renderLanding();

    await waitFor(() => {
      expect(screen.getByTestId("project-picker")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("mini-demo-player")).not.toBeInTheDocument();
    expect(screen.queryByTestId("new-org-landing-page")).not.toBeInTheDocument();
  });

  it("suppresses replay on revisit once the intro has been marked seen", async () => {
    projectsState.projects = [];
    window.localStorage.setItem(SEEN_KEY, "1");
    renderLanding();

    await waitFor(() => {
      expect(screen.getByTestId("project-picker")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("mini-demo-player")).not.toBeInTheDocument();
  });

  it("keeps the page rendered when ?forceShow=true overrides the intro gate", async () => {
    // Org already has a project and the intro was marked seen — both gates
    // would normally redirect, but the debug param keeps the page rendered.
    projectsState.projects = [mockProject];
    window.localStorage.setItem(SEEN_KEY, "1");
    renderLanding("?forceShow=true");

    await waitFor(() => {
      expect(screen.getByTestId("new-org-landing-page")).toBeInTheDocument();
    });

    expect(screen.queryByTestId("project-picker")).not.toBeInTheDocument();
  });
});
