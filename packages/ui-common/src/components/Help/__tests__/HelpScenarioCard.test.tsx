import { render as testingRender, screen, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { HELP_DEMO_FALLBACK } from "../helpCapabilities";
import type { HelpCapabilities, HelpFeatureRecord } from "../helpCapabilities";
import { HelpProvider } from "../HelpContext";
import { HelpScenarioCard } from "../HelpScenarioCard";
import { getHelpScenario } from "../helpScenarioCatalog";

const render = (ui: ReactElement) => testingRender(ui, { wrapper: MemoryRouter });
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
} as const;

const buildCapabilities = (
  overrides: Partial<HelpCapabilities> = {}
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
  routing: {
    buildHref: (intent: string) => {
      if (intent === "node-installer") return "https://nodejs.org/";
      if (intent === "settings-machines") return "/projects/p/settings";
      if (intent === "install-agent-bridge") return "/projects/p/settings";
      return "/";
    },
  },
  demos: { ...FALLBACK_DEMOS },
  ...overrides,
});

describe("HelpScenarioCard", () => {
  it("renders the supplied HelpFeatureRecord items as anchor links when templated copy and features are provided", () => {
    const scenario = getHelpScenario("features-ready");
    expect(scenario.templatedCopy).toBeTruthy();

    const features: readonly HelpFeatureRecord[] = [
      { id: "feat-1", name: "Plans", href: "/projects/p/features/feat-1" },
      { id: "feat-2", name: "Onboarding", href: "/projects/p/features/feat-2" },
    ];

    render(<HelpScenarioCard scenario={scenario} features={features} />);

    features.forEach((feature) => {
      const link = screen.getByRole("link", { name: feature.name });
      expect(link).toHaveAttribute("href", feature.href);
    });
  });

  it("falls back to templatedCopy.emptyState when features is empty", () => {
    const scenario = getHelpScenario("features-ready");
    expect(scenario.templatedCopy?.emptyState).toBeTruthy();

    render(<HelpScenarioCard scenario={scenario} features={[]} />);

    expect(
      screen.getByText(scenario.templatedCopy!.emptyState)
    ).toBeInTheDocument();
  });

  it("keeps instructions visible and mounts the demo only after its trigger is activated", async () => {
    const user = userEvent.setup();
    const scenario = getHelpScenario("install-agent-bridge");
    render(
      <HelpScenarioCard
        scenario={scenario}
        demo={<div data-testid="card-demo">demo body</div>}
      />
    );

    scenario.instructions.forEach((instruction) => {
      expect(screen.getByText(instruction)).toBeInTheDocument();
    });
    expect(screen.queryByTestId("card-demo")).not.toBeInTheDocument();

    const trigger = screen.getByRole("button", { name: "Show me how" });
    expect(
      within(trigger).getByTestId("OndemandVideoOutlinedIcon")
    ).toBeInTheDocument();

    await user.click(trigger);

    expect(screen.getByRole("dialog")).toHaveAccessibleName(scenario.title);
    expect(screen.getByTestId("card-demo")).toBeInTheDocument();
  });

  it("hides the Show me how trigger while demos are disabled", () => {
    helpFlags.showMeHow = false;
    try {
      render(
        <HelpScenarioCard
          scenario={getHelpScenario("install-agent-bridge")}
          demo={<div data-testid="card-demo">demo body</div>}
        />
      );

      expect(
        screen.queryByRole("button", { name: "Show me how" })
      ).not.toBeInTheDocument();
      expect(screen.queryByTestId("card-demo")).not.toBeInTheDocument();
    } finally {
      helpFlags.showMeHow = true;
    }
  });

  it("does not render a demo region when no demo is provided", () => {
    const scenario = getHelpScenario("create-a-task");
    render(<HelpScenarioCard scenario={scenario} />);

    expect(screen.queryByTestId("card-demo")).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Show me how" })
    ).not.toBeInTheDocument();
  });

  it("unmounts the demo and restores focus to the same trigger when closed", async () => {
    const user = userEvent.setup();
    render(
      <HelpScenarioCard
        scenario={getHelpScenario("features-ready")}
        demo={<div data-testid="card-demo">demo body</div>}
      />
    );
    const trigger = screen.getByRole("button", { name: "Show me how" });

    await user.click(trigger);
    await user.click(screen.getByRole("button", { name: "Close" }));

    await waitFor(() => expect(trigger).toHaveFocus());
    expect(screen.queryByTestId("card-demo")).not.toBeInTheDocument();
  });

  it("renders deepContent by default when the scenario provides it and has no checkpoints", () => {
    const scenario = getHelpScenario("create-a-task");
    expect(scenario.deepContent).toBeTruthy();
    expect(scenario.checkpoints).toBeUndefined();

    render(<HelpScenarioCard scenario={scenario} />);

    expect(screen.getByText(scenario.deepContent!)).toBeInTheDocument();
  });

  it("omits deepContent when showDeepContent={false}", () => {
    const scenario = getHelpScenario("create-a-task");
    expect(scenario.deepContent).toBeTruthy();

    render(<HelpScenarioCard scenario={scenario} showDeepContent={false} />);

    expect(screen.queryByText(scenario.deepContent!)).toBeNull();
  });

  describe("checkpoints", () => {
    const renderWithHelp = (number?: number) =>
      render(
        <HelpProvider capabilities={buildCapabilities()}>
          <HelpScenarioCard
            scenario={getHelpScenario("install-agent-bridge")}
            number={number}
          />
        </HelpProvider>
      );

    it("renders every checkpoint title in order under the scenario heading", () => {
      renderWithHelp(1);
      const items = screen.getAllByTestId("help-scenario-checkpoint");
      expect(items.length).toBe(5);
      expect(items[0].textContent).toContain("Install Node.js");
      expect(items[1].textContent).toContain("Install the Bridge");
      expect(items[2].textContent).toContain("Run `heyhey pair`");
      expect(items[3].textContent).toContain(
        "Claim the machine in your browser"
      );
      expect(items[4].textContent).toContain("Review and create the passkey");
    });

    it("renders deepContent in place of checkpoints when no checkpoints exist", () => {
      const scenario = getHelpScenario("create-a-task");
      expect(scenario.checkpoints).toBeUndefined();

      render(
        <HelpProvider capabilities={buildCapabilities()}>
          <HelpScenarioCard scenario={scenario} />
        </HelpProvider>
      );

      expect(screen.getByText(scenario.deepContent!)).toBeInTheDocument();
    });

    it("renders only the parent scenario's numeric badge — no second badge per checkpoint", () => {
      const { container } = renderWithHelp(1);
      // Avatar uses the number; only one avatar is present
      const avatars = container.querySelectorAll(".MuiAvatar-root");
      expect(avatars.length).toBe(1);
      expect(avatars[0].textContent).toBe("1");
    });

    it("keeps checkpoint terminal visuals inline", () => {
      renderWithHelp();

      const disabledButton = screen.getByRole("button", {
        name: "Download Agent Bridge",
      });
      expect(disabledButton).toBeDisabled();

      const items = screen.getAllByTestId("help-scenario-checkpoint");
      const installCheckpoint = items[1];
      expect(
        within(installCheckpoint).getByRole("button", {
          name: "Download Agent Bridge",
        })
      ).toBeInTheDocument();
      expect(
        within(installCheckpoint).getByText("Claude Code")
      ).toBeInTheDocument();
      expect(within(installCheckpoint).getByText("Codex")).toBeInTheDocument();
      const worksWithCopy = within(installCheckpoint).getByText(
        /Agent Bridge runs alongside your installed, authenticated Claude Code executable/
      );
      expect(worksWithCopy).toHaveTextContent(
        "relays task context, progress, and completions to Hey Hey"
      );
      expect(worksWithCopy).toHaveTextContent(
        "Claude keeps control of its native login and token lifecycle"
      );
      expect(worksWithCopy).not.toHaveTextContent(
        "alternative model providers"
      );
      expect(
        within(installCheckpoint).getByTestId("install-agent-bridge-terminal")
      ).toBeInTheDocument();
      expect(
        screen.queryByRole("button", { name: "Show me how" })
      ).not.toBeInTheDocument();
    });

    it("renders the Node.js installer link inside the Node prerequisite checkpoint", () => {
      renderWithHelp();
      const items = screen.getAllByTestId("help-scenario-checkpoint");
      const link = within(items[0]).getByRole("link", {
        name: "Open Node.js installer",
      });
      expect(link).toHaveAttribute("href", "https://nodejs.org/");
    });

    it("does not offer Settings → Machines as the pairing entry point", () => {
      renderWithHelp();
      expect(
        screen.queryByRole("link", {
          name: "Open Settings → Machines",
        })
      ).not.toBeInTheDocument();
    });

    it("starts the inline pairing walkthrough with a terminal visibly running the exact command", () => {
      renderWithHelp();
      const items = screen.getAllByTestId("help-scenario-checkpoint");
      const pairingCheckpoint = items[2];

      expect(
        within(pairingCheckpoint).getByTestId("heyhey-pair-terminal-command")
      ).toHaveTextContent("heyhey pair");
      expect(
        within(pairingCheckpoint).getByTestId("heyhey-pair-terminal-output")
      ).toHaveTextContent(
        "Pair this machine in your browser. Code: ABC-123 Open: http://localhost:5173/pairing?code=ABC-123"
      );
      expect(
        within(items[3]).queryByTestId("heyhey-pair-terminal")
      ).not.toBeInTheDocument();
      expect(
        within(items[4]).queryByTestId("heyhey-pair-terminal")
      ).not.toBeInTheDocument();
    });
  });
});
