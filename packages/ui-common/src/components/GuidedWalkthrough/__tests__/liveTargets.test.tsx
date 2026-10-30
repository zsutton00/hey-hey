import { ModalProvider } from "../../../contexts/ModalContext";
import { TestDiscussHost } from "../../../test/DiscussTestHost";
import React from "react";
import {
  act,
  fireEvent,
  render as renderView,
  screen,
  waitFor,
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
} from "../../../api";
import { createHeyTheme } from "../../../contexts/ThemeContext";
import { loadContentWithMentions } from "../../SmarterTextAreaCard/serializationUtils";
import { ActionsCapsuleProvider } from "../../ActionsCapsule/ActionsCapsuleProvider";
import { useActionsCapsule } from "../../ActionsCapsule/ActionsCapsuleContext";
import { CapsuleActionButton } from "../../ActionsCapsule/CapsuleActionButton";
import { DiscussCapsuleAction } from "../../ActionsCapsule/Common/DiscussCapsuleAction";
import { InteractionComponent } from "../../InteractionComponent/InteractionComponent";
import { GuidedWalkthroughProvider } from "../GuidedWalkthroughProvider";
import {
  createGuidedWalkthroughRuntime,
  type GuidedWalkthroughRuntime,
} from "../guidedWalkthroughRuntime";
import type { GuidableEntity, WalkthroughEvent } from "../types";

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

vi.mock("react-router-dom", () => ({ useNavigate: () => vi.fn() }));
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

const FEATURE: GuidableEntity = { kind: "feature", id: "feature-1" };
const OTHER: GuidableEntity = { kind: "task", id: "task-2" };
const SUGGESTION = "Help me plan the first slice of this feature.";

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

function renderSurface(runtime: GuidedWalkthroughRuntime) {
  const events: WalkthroughEvent[] = [];
  runtime.events.subscribe((event) => events.push(event));
  const utils = render(
    <ThemeProvider theme={createHeyTheme("light")}>
      <GuidedWalkthroughProvider runtime={runtime}>
        <ActionsCapsuleProvider>
          <InteractionComponent
            entityId="feature-1"
            entityType="TASK"
            entitySubtype="FEATURE"
            hasProposalSupport
            organizationId="org-1"
            projectId="proj-1"
            guidableSurface="explorer-row"
          >
            <span>Feature row</span>
          </InteractionComponent>
          <InteractionComponent
            entityId="feature-1"
            entityType="TASK"
            entitySubtype="FEATURE"
            hasProposalSupport={false}
          >
            <span>Undeclared surface</span>
          </InteractionComponent>
          <DiscussCapsuleAction
            entityId="feature-1"
            entityType={EntityType.Task}
            entityTitle="Feature One"
            organizationId="org-1"
            projectId="proj-1"
          />
          <CapsuleButtons />
        </ActionsCapsuleProvider>
        <TestDiscussHost />
      </GuidedWalkthroughProvider>
    </ThemeProvider>,
  );
  return { ...utils, events };
}

function currentSession(runtime: GuidedWalkthroughRuntime) {
  const session = runtime.discussSessions.current();
  if (session === null) throw new Error("No Discuss session published");
  return session;
}

function editorText(): string {
  return screen.getByTestId("discuss-modal-input").textContent ?? "";
}

async function openDiscuss(runtime: GuidedWalkthroughRuntime) {
  const user = userEvent.setup();
  const button = runtime.targets.lookup({
    name: "discuss-action",
    entity: FEATURE,
  });
  expect(button).toBe(screen.getByTestId("capsule-action-discuss"));
  await user.click(button!);
  await waitFor(() => expect(runtime.discussSessions.current()).not.toBeNull());
  return { user, session: currentSession(runtime) };
}

function typeAsUser(text: string) {
  fireEvent.change(screen.getByTestId("user-edit-input"), {
    target: { value: text },
  });
}

beforeEach(() => {
  globalThis.mswServer.use(
    http.get("http://localhost:3847/api/local/repos", () =>
      HttpResponse.json({ machineId: "machine-1", bindings: [] }),
    ),
  );
  launcher.launch.mockReset();
  launcher.launch.mockResolvedValue(true);
});

describe("Explorer row target", () => {
  it("resolves and reveals only the declared Explorer surface", () => {
    const runtime = createGuidedWalkthroughRuntime();
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const { unmount } = renderSurface(runtime);

    const address = { surface: "explorer-row", entity: FEATURE } as const;
    const row = runtime.targets.reveal(address);
    expect(row).toHaveTextContent("Feature row");
    expect(row).not.toHaveTextContent("Undeclared surface");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);

    unmount();
    expect(runtime.targets.lookup(address)).toBeNull();
  });

  it("registers the inert (no context menu) branch when a surface is declared", () => {
    const runtime = createGuidedWalkthroughRuntime();
    render(
      <GuidedWalkthroughProvider runtime={runtime}>
        <InteractionComponent
          entityId="task-2"
          entityType="TASK"
          hasProposalSupport={false}
          guidableSurface="explorer-row"
        >
          <span>Inert row</span>
        </InteractionComponent>
        <TestDiscussHost />
      </GuidedWalkthroughProvider>,
    );
    expect(
      runtime.targets.lookup({ surface: "explorer-row", entity: OTHER }),
    ).toHaveTextContent("Inert row");
  });
});

describe("Discuss button and modal targets", () => {
  it("opens the matching modal and exposes its editor and Start Conversation targets until close", async () => {
    const runtime = createGuidedWalkthroughRuntime();
    const { events } = renderSurface(runtime);
    const { user, session } = await openDiscuss(runtime);

    const opened = events.filter((e) => e.type === "discuss-modal-opened");
    expect(opened).toEqual([
      {
        type: "discuss-modal-opened",
        entity: expect.objectContaining({ id: "feature-1" }),
        modalInstanceId: session.modalInstanceId,
      },
    ]);
    const editorAddress = {
      name: "discuss-prompt-editor",
      entity: FEATURE,
      modalInstanceId: session.modalInstanceId,
    } as const;
    const startAddress = {
      name: "discuss-start-conversation",
      entity: FEATURE,
      modalInstanceId: session.modalInstanceId,
    } as const;
    expect(runtime.targets.lookup(editorAddress)).toContainElement(
      screen.getByTestId("discuss-modal-input"),
    );
    expect(runtime.targets.lookup(startAddress)).toBe(
      screen.getByRole("button", { name: "Start Conversation" }),
    );
    expect(
      runtime.targets.lookup({ ...editorAddress, entity: OTHER }),
    ).toBeNull();
    expect(screen.getByTestId("discuss-modal")).toContainElement(
      session.guidanceContainer,
    );

    await user.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(runtime.discussSessions.current()).toBeNull());
    expect(runtime.targets.lookup(editorAddress)).toBeNull();
    expect(runtime.targets.lookup(startAddress)).toBeNull();

    const reopened = await openDiscuss(runtime);
    expect(reopened.session.modalInstanceId).not.toBe(session.modalInstanceId);
    expect(reopened.session.suggestion).toEqual({ status: "none" });
  });
});

describe("Use our suggestion", () => {
  it("fills visible and submitted text, then completes only after a successful Start Conversation launch", async () => {
    const runtime = createGuidedWalkthroughRuntime();
    const { events } = renderSurface(runtime);
    const { user } = await openDiscuss(runtime);

    act(() => currentSession(runtime).offerSuggestion(SUGGESTION));
    expect(currentSession(runtime).suggestion.status).toBe("available");
    expect(currentSession(runtime).promptReady).toBe(false);

    let accepted = false;
    act(() => {
      accepted = currentSession(runtime).acceptSuggestion();
    });
    expect(accepted).toBe(true);
    await waitFor(() => expect(editorText()).toBe(SUGGESTION));
    expect(currentSession(runtime).promptReady).toBe(true);

    // Repeated acceptance and later suggestion updates never refill.
    act(() => {
      accepted = currentSession(runtime).acceptSuggestion();
      currentSession(runtime).offerSuggestion("A newer suggestion");
    });
    expect(accepted).toBe(false);
    expect(editorText()).toBe(SUGGESTION);

    const modalInstanceId = currentSession(runtime).modalInstanceId;
    await user.click(
      screen.getByRole("button", { name: "Start Conversation" }),
    );

    await waitFor(() =>
      expect(events.map((e) => e.type)).toContain(
        "discuss-conversation-launched",
      ),
    );
    expect(launcher.launch).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: SUGGESTION }),
    );
    expect(launcher.launch.mock.calls[0][0]).not.toHaveProperty(
      "projectAssistant",
    );
    expect(events.at(-1)).toEqual({
      type: "discuss-conversation-launched",
      entity: expect.objectContaining({ id: "feature-1" }),
      modalInstanceId,
    });
  });

  it("protects text the user edited after the suggestion became available", async () => {
    const runtime = createGuidedWalkthroughRuntime();
    renderSurface(runtime);
    await openDiscuss(runtime);

    act(() => currentSession(runtime).offerSuggestion(SUGGESTION));
    typeAsUser("My own question");
    await waitFor(() =>
      expect(currentSession(runtime).suggestion.status).toBe("protected"),
    );
    // A later suggestion update does not re-baseline over the user's edit.
    act(() => currentSession(runtime).offerSuggestion("Updated suggestion"));

    let accepted = true;
    act(() => {
      accepted = currentSession(runtime).acceptSuggestion();
    });
    expect(accepted).toBe(false);
    expect(editorText()).toBe("My own question");
  });

  it("selects Start Conversation for non-empty custom text and submits that text", async () => {
    const runtime = createGuidedWalkthroughRuntime();
    const { events } = renderSurface(runtime);
    const { user } = await openDiscuss(runtime);

    typeAsUser("Custom prompt");
    await waitFor(() => expect(currentSession(runtime).promptReady).toBe(true));
    await user.click(
      screen.getByRole("button", { name: "Start Conversation" }),
    );

    await waitFor(() => expect(launcher.launch).toHaveBeenCalledTimes(1));
    expect(launcher.launch).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: "Custom prompt" }),
    );
    await waitFor(() =>
      expect(events.map((e) => e.type)).toContain(
        "discuss-conversation-launched",
      ),
    );
  });

  it("does not complete on a failed launch or on Quick Question", async () => {
    const runtime = createGuidedWalkthroughRuntime();
    const { events } = renderSurface(runtime);
    const { user } = await openDiscuss(runtime);
    typeAsUser("Will it start?");
    await waitFor(() => expect(currentSession(runtime).promptReady).toBe(true));

    launcher.launch.mockResolvedValueOnce(false);
    await user.click(
      screen.getByRole("button", { name: "Start Conversation" }),
    );
    await waitFor(() => expect(launcher.launch).toHaveBeenCalledTimes(1));
    // The failed launch keeps the modal and its prompt.
    expect(screen.getByTestId("discuss-modal")).toBeInTheDocument();
    expect(editorText()).toBe("Will it start?");

    await user.click(screen.getByRole("button", { name: "Quick Question" }));
    await waitFor(() => expect(launcher.launch).toHaveBeenCalledTimes(2));
    expect(launcher.launch.mock.calls[1][0]).toHaveProperty(
      "projectAssistant",
      { enabled: false },
    );

    expect(events.map((e) => e.type)).not.toContain(
      "discuss-conversation-launched",
    );
  });
});

const render: typeof renderView = (ui, options) =>
  renderView(ui, { ...options, wrapper: ModalProvider });
