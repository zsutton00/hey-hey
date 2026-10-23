import React, { useEffect, useState } from "react";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { ThemeProvider } from "@mui/material/styles";
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  AuthorizationProtocolVersion,
  CurrentControllerMachineEligibilityState,
  EntityType,
  MachineExecutionReadinessState,
  ProjectFeatureNextStepKind,
} from "../../../api";
import {
  CanonicalPageBoundary,
  CanonicalPageProvider,
  createCanonicalPageDescriptor,
} from "../../../contexts/CanonicalPageContext";
import { EntityActivationProvider } from "../../../contexts/EntityActivationContext";
import { createHeyTheme } from "../../../contexts/ThemeContext";
import { loadContentWithMentions } from "../../SmarterTextAreaCard/serializationUtils";
import { ActionsCapsuleProvider } from "../../ActionsCapsule/ActionsCapsuleProvider";
import { useActionsCapsule } from "../../ActionsCapsule/ActionsCapsuleContext";
import { CapsuleActionButton } from "../../ActionsCapsule/CapsuleActionButton";
import { DiscussCapsuleAction } from "../../ActionsCapsule/Common/DiscussCapsuleAction";
import { InteractionComponent } from "../../InteractionComponent/InteractionComponent";
import {
  CanonicalWalkthroughEvents,
  GuidedWalkthroughProvider,
} from "../../GuidedWalkthrough";
import { useGuidedWalkthroughRuntime } from "../../GuidedWalkthrough/guidedWalkthroughRuntime";
import { HelpScenarioCard } from "../HelpScenarioCard";
import { MemoryRouter } from "react-router-dom";
import { getFeatureDiscoveryWelcomeCatalog } from "../helpScenarioCatalog";
import type { HelpFeatureNextStep } from "../helpCapabilities";
import { buildGuidedFirstStepsWalkthrough } from "../buildGuidedFirstStepsWalkthrough";

class MockIntersectionObserver {
  constructor(private readonly callback: IntersectionObserverCallback) {}
  observe(target: Element) {
    this.callback(
      [{ target, isIntersecting: true } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}
vi.stubGlobal("IntersectionObserver", MockIntersectionObserver);
Element.prototype.scrollIntoView = vi.fn();

// Real Lexical editor; the test input applies a user edit to editor state.
vi.mock("@lexical/react/LexicalOnChangePlugin", async (importOriginal) => {
  const actual =
    await importOriginal<
      typeof import("@lexical/react/LexicalOnChangePlugin")
    >();
  const { useLexicalComposerContext } =
    await import("@lexical/react/LexicalComposerContext");
  return {
    OnChangePlugin: (
      props: React.ComponentProps<typeof actual.OnChangePlugin>,
    ) => {
      const [editor] = useLexicalComposerContext();
      return (
        <>
          <actual.OnChangePlugin {...props} />
          <textarea
            data-testid="user-edit-input"
            onChange={(event) => {
              const value = event.target.value;
              editor.update(() => loadContentWithMentions(value), {
                discrete: true,
              });
            }}
          />
        </>
      );
    },
  };
});

const navigate = vi.hoisted(() => vi.fn());
vi.mock("react-router-dom", async (importOriginal) => ({
  ...(await importOriginal<typeof import("react-router-dom")>()),
  useNavigate: () => navigate,
}));
vi.mock("../../WebUtils/navigateToEntity", () => ({
  navigateToEntity: vi.fn(),
}));
vi.mock("../../../data/hooks/useEntityContext", () => ({
  useEntityContext: () => ({
    data: null,
    isLoading: false,
    error: null,
    fetch: vi.fn(),
  }),
}));
vi.mock("../../../data/hooks/useEntityStars", () => ({
  useEntityStar: () => ({
    isStarred: false,
    isLoading: false,
    isMutating: false,
    error: null,
    mutationError: null,
    toggle: vi.fn(),
  }),
}));
vi.mock("../../../data/hooks/useWorkItem", () => ({
  useWorkItem: () => ({
    workItem: { id: "feature-1", type: "FEATURE" },
    isFetching: false,
    refetch: async () => ({ id: "feature-1", type: "FEATURE" }),
  }),
}));
vi.mock("../../../data/hooks/useWorkItemTypes", () => ({
  useWorkItemTypeByKey: () => ({ workItemTypeSummary: undefined }),
  useWorkItemTypeTrackingEligibility: () => ({
    isAllowed: false,
    isReady: true,
    isLoading: false,
    error: null,
  }),
}));
vi.mock("../../../data/hooks/useUserPairedMachines", () => ({
  useUserPairedMachines: () => ({
    isReady: true,
    machines: [
      {
        machineId: "machine-1",
        name: "CLI One",
        pairedAt: "2026-01-01T00:00:00.000Z",
        active: true,
        authorizationProtocolVersion: AuthorizationProtocolVersion.NUMBER_2,
        executionReadiness: MachineExecutionReadinessState.Ready,
        currentControllerEligibility:
          CurrentControllerMachineEligibilityState.Eligible,
        bindings: [],
      },
    ],
  }),
}));
vi.mock("../../../hooks/auth/useRole", () => ({
  useRole: () => ({
    isOrganizationAdmin: false,
  }),
}));
vi.mock("../../../data/hooks/usePlatformAdminAccess", () => ({
  usePlatformAdminAccess: () => ({ isPlatformAdmin: false, isResolved: true }),
}));
vi.mock("../../Selectors/ServiceSelector", () => ({
  ServiceSelector: () => null,
}));
vi.mock(
  "../../SmarterTextAreaCard/slashCommands/RichSlashCommandPlugin",
  () => ({
    RichSlashCommandPlugin: () => null,
  }),
);
vi.mock("../../SmarterTextAreaCard/FeatureReferenceDiscoveryPlugin", () => ({
  FeatureReferenceDiscoveryPlugin: () => null,
}));
vi.mock("../../SmarterTextAreaCard/MentionPlugin", () => ({
  MentionPlugin: () => null,
}));

const launcher = vi.hoisted(() => ({
  launch: vi.fn<(input: { prompt: string }) => Promise<boolean>>(),
}));
vi.mock("../../InteractionComponent/useEntityConversationLauncher", () => ({
  useEntityConversationLauncher: () => ({
    launch: launcher.launch,
    isLoading: false,
    error: null,
    clearError: vi.fn(),
  }),
}));

const FEATURES_READY = getFeatureDiscoveryWelcomeCatalog()[1];

const nextStep = (kind: ProjectFeatureNextStepKind): HelpFeatureNextStep => ({
  feature: {
    id: "feature-1",
    name: "Recipe Library",
    href: "/projects/p/features/feature-1",
  },
  kind,
  rationale: "Its scope is clear enough to start.",
  starterPrompt: `Flesh out Recipe Library around the shared family cookbook I described, then create its ${kind}.`,
});

const suggestedPromptFor = (step: HelpFeatureNextStep): string => {
  const compose = buildGuidedFirstStepsWalkthrough(step).steps[3];
  if (compose.actionKey !== "compose-and-start") throw new Error();
  return compose.inputs.suggestedPrompt;
};

const CapsuleButtons: React.FC = () => {
  const { actions } = useActionsCapsule();
  return (
    <>
      {actions.map((action, idx) => (
        <CapsuleActionButton
          key={action.id}
          action={action}
          idx={idx}
          isActive={false}
          isAnyExpanded={false}
          onClick={action.behavior === "click" ? action.onClick : () => {}}
        />
      ))}
    </>
  );
};

/** The Feature's canonical page with its real Discuss action. */
const FeaturePage: React.FC = () => (
  <CanonicalPageBoundary
    composition={{
      kind: "canonical",
      descriptor: createCanonicalPageDescriptor("task", "feature-1", null),
    }}
  >
    <ActionsCapsuleProvider>
      <DiscussCapsuleAction
        entityId="feature-1"
        entityType={EntityType.Task}
        entityTitle="Recipe Library"
        organizationId="org-1"
        projectId="proj-1"
      />
      <CapsuleButtons />
    </ActionsCapsuleProvider>
  </CanonicalPageBoundary>
);

/** Help, a declared Explorer row that opens the Feature, and its page. */
const Workspace: React.FC<{
  steps: readonly HelpFeatureNextStep[];
  initiallyOpen: boolean;
  explorerVisible: boolean;
}> = ({ steps, initiallyOpen, explorerVisible }) => {
  const [open, setOpen] = useState(initiallyOpen);
  const runtime = useGuidedWalkthroughRuntime();
  useEffect(
    () =>
      runtime?.explorerSections.publish("work-item:FEATURE", Symbol(), true),
    [runtime],
  );
  return (
    <>
      <HelpScenarioCard
        scenario={FEATURES_READY}
        features={steps.map((step) => step.feature)}
        featureNextSteps={steps}
      />
      {explorerVisible ? (
        <InteractionComponent
          entityId="feature-1"
          entityType="TASK"
          entitySubtype="FEATURE"
          hasProposalSupport
          organizationId="org-1"
          projectId="proj-1"
          guidableSurface="explorer-row"
        >
          <button type="button" onClick={() => setOpen(true)}>
            Recipe Library
          </button>
        </InteractionComponent>
      ) : null}
      {open ? <FeaturePage /> : null}
    </>
  );
};

function renderApp({
  steps = [nextStep("TASKS")],
  initiallyOpen = false,
  explorerVisible = true,
}: {
  steps?: readonly HelpFeatureNextStep[];
  initiallyOpen?: boolean;
  explorerVisible?: boolean;
} = {}) {
  const props = { steps, initiallyOpen };
  const utils = render(
    <MemoryRouter>
      <ThemeProvider theme={createHeyTheme("light")}>
        <GuidedWalkthroughProvider>
          <EntityActivationProvider sink={{ onEntityActivated: vi.fn() }}>
            <CanonicalPageProvider>
              <CanonicalWalkthroughEvents />
              <Workspace {...props} explorerVisible={explorerVisible} />
            </CanonicalPageProvider>
          </EntityActivationProvider>
        </GuidedWalkthroughProvider>
      </ThemeProvider>
    </MemoryRouter>,
  );
  const hideExplorer = () =>
    utils.rerender(
      <MemoryRouter>
        <ThemeProvider theme={createHeyTheme("light")}>
          <GuidedWalkthroughProvider>
            <EntityActivationProvider sink={{ onEntityActivated: vi.fn() }}>
              <CanonicalPageProvider>
                <CanonicalWalkthroughEvents />
                <Workspace {...props} explorerVisible={false} />
              </CanonicalPageProvider>
            </EntityActivationProvider>
          </GuidedWalkthroughProvider>
        </ThemeProvider>
      </MemoryRouter>,
    );
  return { ...utils, hideExplorer };
}

const bar = () => screen.getByTestId("guided-walkthrough-bar");
const startButton = () => screen.getByTestId("help-feature-next-step-start");
const editorText = () =>
  screen.getByTestId("discuss-modal-input").textContent ?? "";

async function followToCompose(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: "Recipe Library" }));
  await waitFor(() => expect(bar()).toHaveTextContent("Step 3 of 4"));
  // Nothing was opened on the user's behalf.
  expect(screen.queryByTestId("discuss-modal")).toBeNull();
  await user.click(screen.getByTestId("capsule-action-discuss"));
  await waitFor(() => expect(bar()).toHaveTextContent("Step 4 of 4"));
}

beforeEach(() => {
  globalThis.mswServer.use(
    http.get("http://localhost:3847/api/local/repos", () =>
      HttpResponse.json({ machineId: "machine-1", bindings: [] }),
    ),
  );
  vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
    () => new DOMRect(20, 20, 100, 30),
  );
  navigate.mockReset();
  launcher.launch.mockReset();
  launcher.launch.mockResolvedValue(true);
});

describe("Guided First Steps from a Walk me through button", () => {
  it.each(Object.values(ProjectFeatureNextStepKind))(
    "follows real Explorer and Discuss controls to a launched %s conversation with the accepted starter prompt",
    async (kind) => {
      const user = userEvent.setup();
      const step = nextStep(kind);
      const prompt = suggestedPromptFor(step);
      expect(prompt).toBe(step.starterPrompt);
      renderApp({ steps: [step] });

      await user.click(startButton());
      expect(navigate).not.toHaveBeenCalled();
      expect(bar()).toHaveAccessibleName(
        `${buildGuidedFirstStepsWalkthrough(step).title} walkthrough`,
      );
      expect(bar()).toHaveTextContent("Step 2 of 4");
      expect(
        screen.getByTestId("guided-walkthrough-callout"),
      ).toHaveTextContent("Open Recipe Library.");
      // The list is unchanged by starting.
      expect(startButton()).toBeVisible();

      await followToCompose(user);
      expect(editorText()).toBe("");
      await user.click(screen.getByTestId("guided-walkthrough-use-suggestion"));
      await waitFor(() => expect(editorText()).toBe(prompt));
      expect(launcher.launch).not.toHaveBeenCalled();

      await user.click(
        screen.getByRole("button", { name: "Start Conversation" }),
      );
      await waitFor(() =>
        expect(screen.queryByTestId("guided-walkthrough-bar")).toBeNull(),
      );
      expect(launcher.launch).toHaveBeenCalledWith(
        expect.objectContaining({ prompt }),
      );
    },
  );

  it("keeps the user's edits to the starter prompt", async () => {
    const user = userEvent.setup();
    const step = nextStep("TASKS");
    renderApp({ steps: [step] });
    await user.click(startButton());
    // The card keeps its rationale and does not show the prompt.
    expect(screen.queryByText(step.starterPrompt)).toBeNull();
    await followToCompose(user);

    await user.click(screen.getByTestId("guided-walkthrough-use-suggestion"));
    await waitFor(() => expect(editorText()).toBe(step.starterPrompt));

    const edited = `${step.starterPrompt} Start with sharing.`;
    fireEvent.change(screen.getByTestId("user-edit-input"), {
      target: { value: edited },
    });
    await waitFor(() => expect(editorText()).toBe(edited));
    await user.click(
      screen.getByRole("button", { name: "Start Conversation" }),
    );

    await waitFor(() =>
      expect(screen.queryByTestId("guided-walkthrough-bar")).toBeNull(),
    );
    expect(launcher.launch).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: edited }),
    );
  });

  it("launches the user's own text instead of the suggestion", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(startButton());
    await followToCompose(user);

    fireEvent.change(screen.getByTestId("user-edit-input"), {
      target: { value: "Plan the import flow first" },
    });
    await waitFor(() =>
      expect(editorText()).toBe("Plan the import flow first"),
    );
    await user.click(
      screen.getByRole("button", { name: "Start Conversation" }),
    );

    await waitFor(() =>
      expect(screen.queryByTestId("guided-walkthrough-bar")).toBeNull(),
    );
    expect(launcher.launch).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Plan the import flow first" }),
    );
  });

  it("skips opening a Feature that is already open", async () => {
    const user = userEvent.setup();
    renderApp({ initiallyOpen: true });

    await user.click(startButton());
    expect(bar()).toHaveTextContent("Step 3 of 4");
  });

  it("stays on Start Conversation after a failed launch and ends after a successful retry", async () => {
    const user = userEvent.setup();
    launcher.launch.mockResolvedValueOnce(false);
    renderApp();
    await user.click(startButton());
    await followToCompose(user);
    await user.click(screen.getByTestId("guided-walkthrough-use-suggestion"));

    const start = screen.getByRole("button", { name: "Start Conversation" });
    await user.click(start);
    await waitFor(() => expect(launcher.launch).toHaveBeenCalledTimes(1));
    expect(bar()).toHaveTextContent("Step 4 of 4");

    await user.click(start);
    await waitFor(() =>
      expect(screen.queryByTestId("guided-walkthrough-bar")).toBeNull(),
    );
    expect(launcher.launch).toHaveBeenCalledTimes(2);
  });

  it("Exit leaves the app in place and clicking the button again restarts", async () => {
    const user = userEvent.setup();
    renderApp();
    await user.click(startButton());
    await user.click(screen.getByRole("button", { name: "Recipe Library" }));
    await waitFor(() => expect(bar()).toHaveTextContent("Step 3 of 4"));

    await user.click(screen.getByTestId("guided-walkthrough-exit"));
    expect(screen.queryByTestId("guided-walkthrough-bar")).toBeNull();
    expect(screen.getByTestId("capsule-action-discuss")).toBeInTheDocument();
    expect(screen.getByTestId("help-feature-next-step")).toBeInTheDocument();

    // Restarting re-evaluates live state: the Feature is still open.
    await user.click(startButton());
    expect(bar()).toHaveTextContent("Step 3 of 4");
    await user.click(startButton());
    expect(screen.getAllByTestId("guided-walkthrough-bar")).toHaveLength(1);
  });

  it("ends with an accessible message when the Explorer target disappears after the card renders", () => {
    vi.useFakeTimers();
    try {
      const { hideExplorer } = renderApp();
      hideExplorer();
      fireEvent.click(startButton());
      act(() => {
        vi.advanceTimersByTime(5000);
      });
      const message = screen.getByTestId("guided-walkthrough-ended");
      expect(message).toHaveAttribute("role", "status");
      expect(message).toHaveTextContent(
        "The walkthrough ended because Recipe Library in the Explorer could not be found.",
      );
      expect(
        within(message).getByRole("button", { name: "Dismiss" }),
      ).toBeVisible();
      expect(launcher.launch).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });
});
