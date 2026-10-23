import {
  render as testingRender,
  screen,
  within,
} from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter, Route, Routes } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { HELP_DEMO_FALLBACK } from "../helpCapabilities";
import type {
  HelpCapabilities,
  HelpFeatureNextStep,
  HelpFeatureRecord,
} from "../helpCapabilities";
import { HelpProvider } from "../HelpContext";
import { HELP_SCENARIO_CATALOG } from "../helpScenarioCatalog";
import { IntroHelpView, type IntroHelpViewVariant } from "../IntroHelpView";
import { GuidedWalkthroughControlsContext } from "../../GuidedWalkthrough/guidedWalkthroughRuntime";
import { buildGuidedFirstStepsWalkthrough } from "../buildGuidedFirstStepsWalkthrough";

const render = (ui: ReactElement) =>
  testingRender(ui, { wrapper: MemoryRouter });
const helpFlags = vi.hoisted(() => ({ showMeHow: true }));
vi.mock("../helpFeatureFlags", () => ({
  get SHOW_ME_HOW_ENABLED() {
    return helpFlags.showMeHow;
  },
}));

const FALLBACK_DEMOS = {
  "read-first-project": HELP_DEMO_FALLBACK,
  "install-agent-bridge": HELP_DEMO_FALLBACK,
  "features-ready": HELP_DEMO_FALLBACK,
  "create-a-service": HELP_DEMO_FALLBACK,
  "create-a-task": HELP_DEMO_FALLBACK,
  "first-agent-session": HELP_DEMO_FALLBACK,
  "where-to-start": HELP_DEMO_FALLBACK,
} as const;

const buildCapabilities = (
  overrides: Partial<HelpCapabilities> = {},
): HelpCapabilities => ({
  data: { features: [] },
  actions: {
    "import-repository": {
      status: "ready",
      error: null,
      execute: vi.fn(),
      retry: vi.fn(),
    },
  },
  routing: { buildHref: (intent: string) => `/${intent}` },
  demos: { ...FALLBACK_DEMOS },
  ...overrides,
});

const renderWithHelp = (
  capabilities: HelpCapabilities,
  variant: IntroHelpViewVariant = "generic",
) =>
  render(
    <HelpProvider capabilities={capabilities}>
      <IntroHelpView variant={variant} />
    </HelpProvider>,
  );

describe("IntroHelpView", () => {
  it.each(["generic", "existing-work"] as const)(
    "routes the final %s step through the Help routing capability",
    async (variant) => {
      const user = userEvent.setup();
      const buildHref = vi.fn(
        () => "/projects/project-1?tab=help&helpSubTab=first-project",
      );
      testingRender(
        <MemoryRouter initialEntries={["/welcome"]}>
          <Routes>
            <Route
              path="/welcome"
              element={
                <HelpProvider
                  capabilities={buildCapabilities({ routing: { buildHref } })}
                >
                  <IntroHelpView variant={variant} />
                </HelpProvider>
              }
            />
            <Route
              path="/projects/project-1"
              element={<p>Your First Project guide</p>}
            />
          </Routes>
        </MemoryRouter>,
      );

      expect(
        screen.getByRole("link", { name: "Read Your First Project" }),
      ).toHaveAttribute(
        "href",
        "/projects/project-1?tab=help&helpSubTab=first-project",
      );
      expect(buildHref).toHaveBeenCalledWith("read-first-project");
      await user.click(
        screen.getByRole("link", { name: "Read Your First Project" }),
      );
      expect(screen.getByText("Your First Project guide")).toBeInTheDocument();
      expect(screen.queryByTestId("intro-help-view")).not.toBeInTheDocument();
    },
  );

  it("renders every catalog scenario in order with a plain numeric badge and no status icons", () => {
    renderWithHelp(buildCapabilities());

    HELP_SCENARIO_CATALOG.forEach((scenario, index) => {
      const heading = screen.getByRole("heading", { name: scenario.title });
      const row = heading.closest("div");
      expect(row).not.toBeNull();
      expect(
        within(row!.parentElement!.parentElement!).getByText(String(index + 1)),
      ).toBeInTheDocument();
    });

    const view = screen.getByTestId("intro-help-view");
    expect(view.querySelector("[data-testid='CheckCircleIcon']")).toBeNull();
    expect(
      view.querySelector("[data-testid='CheckCircleOutlineIcon']"),
    ).toBeNull();
    expect(
      view.querySelector("[data-testid='RadioButtonUncheckedIcon']"),
    ).toBeNull();
  });

  it("renders the exact four-step existing-work sequence", () => {
    renderWithHelp(buildCapabilities(), "existing-work");

    expect(
      screen
        .getAllByTestId("help-scenario-title")
        .map((title) => title.textContent),
    ).toEqual([
      "Install Agent Bridge",
      "Bring in your first service",
      "Discover your feature map",
      "Read Your First Project",
    ]);
    expect(screen.getByText("Bring in your first service")).toBeInTheDocument();
    expect(screen.getByText("Discover your feature map")).toBeInTheDocument();
    expect(
      screen.getByText(/before starting repository work/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("Your features are ready")).toBeNull();
  });

  it("renders the exact three-step feature-discovery sequence without a first-service step", () => {
    renderWithHelp(buildCapabilities());

    expect(
      screen
        .getAllByTestId("help-scenario-title")
        .map((title) => title.textContent),
    ).toEqual([
      "Install Agent Bridge",
      "Your features are ready",
      "Read Your First Project",
    ]);
  });

  describe("Your features are ready", () => {
    const featureNextSteps: readonly HelpFeatureNextStep[] = [
      {
        feature: {
          id: "feat-1",
          name: "Recipe Library",
          href: "/projects/p/features/feat-1",
          overview: "Recipe Library overview.",
        },
        kind: "TASKS",
        rationale: "Its scope is clear enough to break into first tasks.",
        starterPrompt:
          "Flesh out Recipe Library with the tagging I described, then break it into tasks.",
      },
      {
        feature: {
          id: "feat-2",
          name: "Meal Planner",
          href: "/projects/p/features/feat-2",
          overview: "Meal Planner overview.",
        },
        kind: "MOCKUPS",
        rationale: "You talked mostly about how planning should feel.",
        starterPrompt:
          "Flesh out Meal Planner around the weekly drag-and-drop board I described, then mock up its screens.",
      },
      {
        feature: {
          id: "feat-3",
          name: "Grocery Sync",
          href: "/projects/p/features/feat-3",
          overview: "Grocery Sync overview.",
        },
        kind: "DIAGRAM",
        rationale: "It hands data between your app and store partners.",
        starterPrompt:
          "Flesh out Grocery Sync and diagram how lists reach store partners.",
      },
    ];

    const features: readonly HelpFeatureRecord[] = [
      ...featureNextSteps.map((step) => step.feature),
      {
        id: "feat-4",
        name: "Pantry",
        href: "/projects/p/features/feat-4",
        overview: "Tracks what is in the kitchen.",
      },
    ];

    it("lists every feature with its overview and no Where to start step", () => {
      renderWithHelp(
        buildCapabilities({ data: { features, featureNextSteps } }),
      );

      expect(
        screen
          .getAllByTestId("help-scenario-title")
          .map((title) => title.textContent),
      ).toEqual([
        "Install Agent Bridge",
        "Your features are ready",
        "Read Your First Project",
      ]);
      expect(screen.queryByText("Where to start")).toBeNull();
      expect(
        screen
          .getAllByTestId("help-feature-overview-text")
          .map((overview) => overview.textContent),
      ).toEqual([
        "Recipe Library overview.",
        "Meal Planner overview.",
        "Grocery Sync overview.",
        "Tracks what is in the kitchen.",
      ]);
      expect(screen.getByRole("link", { name: "Pantry" })).toHaveAttribute(
        "href",
        "/projects/p/features/feat-4",
      );
    });

    it("shows each suggestion's kind and a Walk me through button, then the invitation", () => {
      renderWithHelp(
        buildCapabilities({ data: { features, featureNextSteps } }),
      );

      const rows = screen.getAllByTestId("help-feature-next-step");
      expect(rows).toHaveLength(3);
      expect(
        rows.map(
          (row) =>
            within(row).getByTestId("help-feature-next-step-kind").textContent,
        ),
      ).toEqual(["Tasks", "Mockups", "Diagram"]);
      expect(
        within(rows[2]).getByRole("button", {
          name: "Walk me through Grocery Sync →",
        }),
      ).toBeInTheDocument();
      // The saved starter prompt is offered in the walkthrough, not in the list.
      expect(screen.queryByText(featureNextSteps[1].starterPrompt)).toBeNull();
      const [unsuggested] = screen.getAllByTestId("help-feature-overview");
      expect(within(unsuggested).queryByRole("button")).toBeNull();
      expect(
        screen.getByTestId("help-feature-next-steps-invite"),
      ).toBeInTheDocument();
    });

    it("starts each suggestion's walkthrough without navigating, restarting on re-click", async () => {
      const user = userEvent.setup();
      const controls = {
        startWalkthrough: vi.fn(),
        exitWalkthrough: vi.fn(),
      };
      testingRender(
        <MemoryRouter initialEntries={["/welcome"]}>
          <Routes>
            <Route
              path="/welcome"
              element={
                <GuidedWalkthroughControlsContext.Provider value={controls}>
                  <HelpProvider
                    capabilities={buildCapabilities({
                      data: { features, featureNextSteps },
                    })}
                  >
                    <IntroHelpView variant="generic" />
                  </HelpProvider>
                </GuidedWalkthroughControlsContext.Provider>
              }
            />
            <Route path="*" element={<p>Navigated away</p>} />
          </Routes>
        </MemoryRouter>,
      );

      const rows = screen.getAllByTestId("help-feature-next-step");
      for (const [index, row] of rows.entries()) {
        await user.click(
          within(row).getByTestId("help-feature-next-step-start"),
        );
        expect(controls.startWalkthrough).toHaveBeenLastCalledWith(
          buildGuidedFirstStepsWalkthrough(featureNextSteps[index]),
        );
      }
      await user.click(
        within(rows[0]).getByTestId("help-feature-next-step-start"),
      );
      expect(controls.startWalkthrough).toHaveBeenCalledTimes(4);
      expect(screen.getByTestId("intro-help-view")).toBeInTheDocument();
      expect(screen.queryByText("Navigated away")).toBeNull();
      expect(controls.exitWalkthrough).not.toHaveBeenCalled();
    });

    it("lists features and overviews without invitation or buttons when no suggestions were saved", () => {
      renderWithHelp(
        buildCapabilities({ data: { features, featureNextSteps: [] } }),
      );

      expect(screen.getAllByTestId("help-feature-overview")).toHaveLength(4);
      expect(screen.queryByTestId("help-feature-next-step")).toBeNull();
      expect(screen.queryByTestId("help-feature-next-steps-invite")).toBeNull();
      expect(screen.queryByTestId("help-feature-next-step-start")).toBeNull();
    });

    it("drops the Start a discussion pointer", () => {
      renderWithHelp(
        buildCapabilities({ data: { features, featureNextSteps } }),
      );

      expect(screen.queryByText(/Start a discussion/i)).toBeNull();
    });

    it("never shows the merged list in the existing-work sequence", () => {
      renderWithHelp(
        buildCapabilities({ data: { features, featureNextSteps } }),
        "existing-work",
      );

      expect(screen.getAllByTestId("help-scenario-title")).toHaveLength(4);
      expect(screen.queryByTestId("help-feature-overview-list")).toBeNull();
      expect(screen.queryByTestId("help-feature-next-step-start")).toBeNull();
    });
  });

  it("keeps live feature links in existing-work discovery guidance", () => {
    const features: readonly HelpFeatureRecord[] = [
      { id: "feat-1", name: "Plans", href: "/projects/p/features/feat-1" },
    ];

    renderWithHelp(buildCapabilities({ data: { features } }), "existing-work");

    expect(screen.getByRole("link", { name: "Plans" })).toHaveAttribute(
      "href",
      "/projects/p/features/feat-1",
    );
    expect(
      screen.getByText(/Use Help to explore the features/i),
    ).toBeInTheDocument();
  });

  it("renders templated feature copy as anchor links matching HelpFeatureRecord.href", () => {
    const features: readonly HelpFeatureRecord[] = [
      { id: "feat-1", name: "Plans", href: "/projects/p/features/feat-1" },
      { id: "feat-2", name: "Onboarding", href: "/projects/p/features/feat-2" },
    ];

    renderWithHelp(buildCapabilities({ data: { features } }));

    features.forEach((feature) => {
      const link = screen.getByRole("link", { name: feature.name });
      expect(link).toHaveAttribute("href", feature.href);
    });
  });

  it("renders the empty-state copy when the data capability returns no features", () => {
    renderWithHelp(buildCapabilities({ data: { features: [] } }));

    const featuresScenario = HELP_SCENARIO_CATALOG.find(
      (s) => s.id === "features-ready",
    );
    expect(featuresScenario?.templatedCopy?.emptyState).toBeTruthy();
    expect(
      screen.getByText(featuresScenario!.templatedCopy!.emptyState),
    ).toBeInTheDocument();
  });

  it("renders a supplied platform demo on demand", async () => {
    const user = userEvent.setup();
    const demo = <div data-testid="install-bridge-demo">demo body</div>;
    renderWithHelp(
      buildCapabilities({
        demos: { ...FALLBACK_DEMOS, "install-agent-bridge": demo },
      }),
    );

    await user.click(screen.getAllByRole("button", { name: "Show me how" })[0]);

    expect(screen.getByTestId("install-bridge-demo")).toBeInTheDocument();
  });

  it("renders nothing for slots filled with the HELP_DEMO_FALLBACK sentinel", () => {
    renderWithHelp(buildCapabilities());

    expect(screen.queryByTestId("install-bridge-demo")).toBeNull();
    HELP_SCENARIO_CATALOG.forEach((scenario) => {
      expect(
        screen.getByRole("heading", { name: scenario.title }),
      ).toBeInTheDocument();
    });
  });

  it("renders the install-agent-bridge checkpoints with terminal-first pairing", () => {
    renderWithHelp(buildCapabilities());

    const items = screen.getAllByTestId("help-scenario-checkpoint");
    expect(items.length).toBe(5);
    expect(items[0].textContent).toContain("Install Node.js");
    expect(items[1].textContent).toContain("Install the Bridge");
    expect(items[2].textContent).toContain("Run `heyhey pair`");
    expect(items[3].textContent).toContain("Claim the machine in your browser");
    expect(items[4].textContent).toContain("Review and create the passkey");
    expect(
      screen.getByTestId("heyhey-pair-terminal-command"),
    ).toHaveTextContent("heyhey pair");
    expect(screen.getByTestId("heyhey-pair-terminal-output")).toHaveTextContent(
      "Code: ABC-123",
    );
  });

  it("does not add a second numeric badge per checkpoint", () => {
    renderWithHelp(buildCapabilities());

    const view = screen.getByTestId("intro-help-view");
    const avatars = view.querySelectorAll(".MuiAvatar-root");
    expect(avatars.length).toBe(HELP_SCENARIO_CATALOG.length);
  });
});

it("uses the import action and omits only its service walkthrough", async () => {
  const capabilities = buildCapabilities();
  capabilities.demos["create-a-service"] = <div>Service demo</div>;
  renderWithHelp(capabilities, "existing-work");
  await userEvent.click(
    screen.getByRole("button", { name: "Import my service" }),
  );
  expect(
    capabilities.actions["import-repository"].execute,
  ).toHaveBeenCalledOnce();
  expect(
    screen.queryByRole("button", { name: "Show me how" }),
  ).not.toBeInTheDocument();
  expect(
    screen.queryByRole("link", { name: "Add a service" }),
  ).not.toBeInTheDocument();
});
it.each(["loading", "pending", "error"] as const)(
  "renders recoverable action state %s",
  async (status) => {
    const capabilities = buildCapabilities();
    capabilities.actions["import-repository"].status = status;
    capabilities.actions["import-repository"].error =
      status === "error" ? "Import unavailable" : null;
    renderWithHelp(capabilities, "existing-work");
    expect(
      screen.getByRole("button", { name: "Import my service" }),
    ).toBeDisabled();
    expect(screen.getByTestId("help-action-" + status)).toBeInTheDocument();
    if (status === "error") {
      await userEvent.click(screen.getByRole("button", { name: "Retry" }));
      expect(
        capabilities.actions["import-repository"].retry,
      ).toHaveBeenCalledOnce();
    }
  },
);
