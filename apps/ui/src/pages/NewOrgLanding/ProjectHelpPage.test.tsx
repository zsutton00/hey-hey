import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import React from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ProjectConfigVersionEnum,
  ProjectExistingWorkIntent,
} from "@hey-hey/ui-common/api";
import { buildHelpDemoMap } from "../Project/help/helpDemoMap";
import { ProjectHelpPage } from "./ProjectHelpPage";

const mockUseHelpCapabilities = vi.hoisted(() => vi.fn());
const mocks = vi.hoisted(() => ({
  project: null as { config?: unknown } | null,
  deepHelpView: vi.fn(),
  introHelpView: vi.fn(),
}));

vi.mock("../Project/help/ProjectHelpProvider", () => ({
  ProjectHelpProvider: ({
    children,
    organizationId,
    projectId,
  }: {
    children: React.ReactNode;
    organizationId: string;
    projectId: string;
  }) => {
    mockUseHelpCapabilities(organizationId, projectId);
    return <div data-testid="help-provider">{children}</div>;
  },
}));

vi.mock("../Project/help/useHelpCapabilities", () => ({
  useHelpCapabilities: (...args: unknown[]) => mockUseHelpCapabilities(...args),
}));

vi.mock("@hey-hey/ui-common/components", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@hey-hey/ui-common/components")>()),
  HelpProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="help-provider">{children}</div>
  ),
  IntroHelpView: (props: { variant?: "generic" | "existing-work" }) => {
    mocks.introHelpView(props);
    return <div data-testid="intro-help-view" data-variant={props.variant} />;
  },
  DeepHelpView: (props: {
    rootSection?: string;
    excludedTopicIds?: readonly string[];
  }) => {
    mocks.deepHelpView(props);
    return (
      <div data-testid="deep-help-view" data-root-section={props.rootSection} />
    );
  },
}));

vi.mock("@hey-hey/ui-common/data", () => ({
  useProject: () => ({ data: mocks.project }),
}));

vi.mock("../Project/help/demos/CreateTaskStepDemo", () => ({
  CreateTaskStepDemo: () => <div data-testid="create-task-demo" />,
}));
vi.mock("../Project/help/demos/FirstAgentSessionStepDemo", () => ({
  FirstAgentSessionStepDemo: () => <div data-testid="first-session-demo" />,
}));

const setCompactViewport = (matches: boolean): void => {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })),
  });
};

const renderPage = ({
  searchParams = "",
  onUrlUpdate = vi.fn(),
}: {
  searchParams?: string;
  onUrlUpdate?: ReturnType<typeof vi.fn>;
} = {}) => {
  render(
    <NuqsTestingAdapter searchParams={searchParams} onUrlUpdate={onUrlUpdate}>
      <ProjectHelpPage organizationId="organization-1" projectId="project-1" />
    </NuqsTestingAdapter>,
  );

  return { onUrlUpdate };
};

describe("ProjectHelpPage", () => {
  beforeEach(() => {
    setCompactViewport(false);
    mockUseHelpCapabilities.mockReturnValue({});
    mocks.project = null;
    mocks.deepHelpView.mockReset();
    mocks.introHelpView.mockReset();
  });

  it("renders the ordered desktop subtabs and defaults to Welcome", () => {
    renderPage();

    expect(
      screen.getAllByRole("button").map((button) => button.textContent),
    ).toEqual(["Welcome", "Your First Project", "Help"]);
    expect(screen.getByTestId("intro-help-view")).toBeInTheDocument();
    expect(screen.queryByTestId("deep-help-view")).not.toBeInTheDocument();
    expect(screen.getByTestId("help-provider")).toContainElement(
      screen.getByTestId("intro-help-view"),
    );
    expect(mockUseHelpCapabilities).toHaveBeenCalledWith(
      "organization-1",
      "project-1",
    );
    expect(mocks.deepHelpView).not.toHaveBeenCalled();
    expect(mocks.introHelpView).toHaveBeenCalledWith({ variant: "generic" });
  });

  it("renders the existing-work Welcome variant from direct URL state", () => {
    mocks.project = {
      config: {
        version: ProjectConfigVersionEnum.NUMBER_1,
        existingWorkIntent: ProjectExistingWorkIntent.Selected,
      },
    };

    renderPage({ searchParams: "?helpSubTab=welcome" });

    expect(screen.getByTestId("intro-help-view")).toHaveAttribute(
      "data-variant",
      "existing-work",
    );
    expect(mocks.introHelpView).toHaveBeenCalledWith({
      variant: "existing-work",
    });
  });

  it.each([
    ["missing config", undefined],
    [
      "declined intent",
      {
        version: ProjectConfigVersionEnum.NUMBER_1,
        existingWorkIntent: ProjectExistingWorkIntent.Declined,
      },
    ],
    [
      "unanswered intent",
      {
        version: ProjectConfigVersionEnum.NUMBER_1,
        existingWorkIntent: ProjectExistingWorkIntent.Unanswered,
      },
    ],
    ["missing intent", { version: ProjectConfigVersionEnum.NUMBER_1 }],
    [
      "unsupported legacy config",
      {
        version: 0,
        existingWorkIntent: ProjectExistingWorkIntent.Selected,
      },
    ],
  ])("keeps the generic Welcome variant for %s", (_label, config) => {
    mocks.project = { config };

    renderPage({ searchParams: "?helpSubTab=welcome" });

    expect(mocks.introHelpView).toHaveBeenCalledWith({ variant: "generic" });
  });

  it("hides feature-ready guidance for explicit selected existing-work intent", () => {
    mocks.project = {
      config: {
        version: ProjectConfigVersionEnum.NUMBER_1,
        existingWorkIntent: ProjectExistingWorkIntent.Selected,
      },
    };

    renderPage({ searchParams: "?helpSubTab=help" });

    expect(mocks.deepHelpView).toHaveBeenCalledWith({
      excludedTopicIds: ["features-ready"],
      rootSection: "help",
    });
  });

  it.each([
    ["declined", ProjectExistingWorkIntent.Declined],
    ["unanswered", ProjectExistingWorkIntent.Unanswered],
  ])("keeps generic guidance for %s existing-work intent", (_label, intent) => {
    mocks.project = {
      config: {
        version: ProjectConfigVersionEnum.NUMBER_1,
        existingWorkIntent: intent,
      },
    };

    renderPage({ searchParams: "?helpSubTab=help" });

    expect(mocks.deepHelpView).toHaveBeenCalledWith({
      excludedTopicIds: undefined,
      rootSection: "help",
    });
  });

  it("keeps generic guidance for unsupported legacy config", () => {
    mocks.project = {
      config: {
        version: 0,
        existingWorkIntent: ProjectExistingWorkIntent.Selected,
      },
    };

    renderPage({ searchParams: "?helpSubTab=help" });

    expect(mocks.deepHelpView).toHaveBeenCalledWith({
      excludedTopicIds: undefined,
      rootSection: "help",
    });
  });

  it("pushes selection into isolated Help URL state and renders the guided API collection", async () => {
    const user = userEvent.setup();
    const { onUrlUpdate } = renderPage();

    await user.click(
      screen.getByRole("button", { name: "Your First Project" }),
    );

    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalledOnce());
    const update = onUrlUpdate.mock.calls[0][0];
    expect(update.searchParams.get("helpSubTab")).toBe("first-project");
    expect(update.options.history).toBe("push");
    expect(screen.getByTestId("deep-help-view")).toHaveAttribute(
      "data-root-section",
      "first-project",
    );
    expect(screen.getByTestId("help-provider")).toContainElement(
      screen.getByTestId("deep-help-view"),
    );
  });

  it("restores the Help library directly from URL state", () => {
    renderPage({ searchParams: "?helpSubTab=help" });

    expect(screen.getByTestId("deep-help-view")).toHaveAttribute(
      "data-root-section",
      "help",
    );
    expect(screen.queryByTestId("intro-help-view")).not.toBeInTheDocument();
  });

  it("normalizes an invalid URL selection to Welcome", () => {
    renderPage({ searchParams: "?helpSubTab=unknown" });

    expect(screen.getByTestId("intro-help-view")).toBeInTheDocument();
    expect(screen.queryByTestId("deep-help-view")).not.toBeInTheDocument();
  });

  it("presents every ordered selection through the mobile dropdown", async () => {
    const user = userEvent.setup();
    setCompactViewport(true);
    const { onUrlUpdate } = renderPage();

    const dropdown = screen.getByRole("combobox", { name: "Select view" });
    expect(dropdown).toHaveTextContent("Welcome");
    fireEvent.mouseDown(dropdown);

    const listbox = screen.getByRole("listbox");
    expect(
      within(listbox)
        .getAllByRole("option")
        .map((option) => option.textContent),
    ).toEqual(["Welcome", "Your First Project", "Help"]);

    await user.click(within(listbox).getByRole("option", { name: "Help" }));
    await waitFor(() => expect(onUrlUpdate).toHaveBeenCalledOnce());
    expect(onUrlUpdate.mock.calls[0][0].searchParams.get("helpSubTab")).toBe(
      "help",
    );
    expect(screen.getByTestId("deep-help-view")).toHaveAttribute(
      "data-root-section",
      "help",
    );
  });

  it("keeps the existing platform demo mapped for UI Common presentation", () => {
    const demos = buildHelpDemoMap("organization-1", "project-1");
    const demo = demos["create-a-task"];
    expect(React.isValidElement(demo)).toBe(true);

    render(<>{demo}</>);
    expect(screen.getByTestId("create-task-demo")).toBeInTheDocument();
  });
});
