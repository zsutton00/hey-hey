import { ThemeProvider } from "@mui/material";
import { createHeyTheme } from "@hey-hey/ui-common/context";
import { useEffect, useState, type ReactNode } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  MemoryRouter,
  Route,
  Routes,
  useLocation,
  useNavigate,
} from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  ModalProvider,
  useModal,
  usePreviewHost,
} from "@hey-hey/ui-common/context";
import {
  ActionsCapsuleProvider,
  useActionsCapsule,
  DiscussCapsuleAction,
} from "@hey-hey/ui-common/components/ActionsCapsule";
import { FunctionalDialog } from "@hey-hey/ui-common/components/Modals";
import type { DiscussModalProps } from "@hey-hey/ui-common/components/InteractionComponent/DiscussModal";
import {
  EntityType,
  ConversationStartRunRequestDtoProviderEnum,
} from "@hey-hey/ui-common/api";
import { createOpenItemEntity } from "@hey-hey/ui-common/context";
import { HeyHeyModal } from "./HeyHeyModal";
import { OpenItemsPreviewHost } from "./OpenItemsPreviewHost";
import { OpenItemsTriageAction } from "./Explorer/OpenItemsTriageAction";

const evidence = vi.hoisted(() => ({
  pageCleanup: vi.fn(),
  discussCleanup: vi.fn(),
  previewCleanup: vi.fn(),
  launch: vi.fn().mockResolvedValue(true),
  session: vi.fn(),
  triageCleanup: vi.fn(),
}));
vi.mock("@hey-hey/ui-common/context", async (original) => ({
  ...(await original<typeof import("@hey-hey/ui-common/context")>()),
  useAuth: () => ({ user: { id: "user" } }),
}));
vi.mock("../contexts/OpenItemsContext", () => ({
  OpenItemsProvider: ({ children }: { children: ReactNode }) => children,
}));
vi.mock(
  "@hey-hey/ui-common/components/InteractionComponent/useEntityConversationLauncher",
  () => ({
    useEntityConversationLauncher: (scope: {
      organizationId: string;
      projectId: string;
    }) => ({
      launch: (input: unknown) => evidence.launch(scope, input),
      isLoading: false,
      error: null,
      clearError: () => {},
    }),
  }),
);
vi.mock("@hey-hey/ui-common/data", async (original) => ({
  ...(await original<typeof import("@hey-hey/ui-common/data")>()),
  useOpenItemsTriageSession: () => ({ mutate: evidence.session }),
  useAgentSession: () => ({
    agentSession: { id: "review", conversationId: "conversation" },
    error: null,
  }),
  useEntityNames: () => ({ names: new Map() }),
  useWorkItem: () => ({
    workItem: { id: "task", type: "STANDARD", name: "Original subject" },
    isFetching: false,
    refetch: async () => null,
  }),
}));
vi.mock("../../../../packages/ui-common/src/data/hooks/useWorkItem", () => ({
  useWorkItem: () => ({
    workItem: { type: "STANDARD", name: "Original subject" },
    isFetching: false,
    refetch: async () => null,
  }),
}));
vi.mock(
  "@hey-hey/ui-common/components/InteractionComponent/DiscussModal",
  () => ({
    DiscussModal: (props: DiscussModalProps) => {
      const [draft, setDraft] = useState("");
      useEffect(() => () => evidence.discussCleanup(), []);
      return (
        <FunctionalDialog
          open
          onClose={props.onClose}
          workTitle={`Discuss ${props.entityTitle}`}
        >
          <input
            aria-label="Discuss draft"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
          />
          <button
            onClick={() =>
              void props.onSubmit({
                prompt: draft,
                provider: ConversationStartRunRequestDtoProviderEnum.Claude,
                model: null,
                reasoningEffort: null,
                machineId: "machine",
              })
            }
          >
            Start conversation
          </button>
        </FunctionalDialog>
      );
    },
  }),
);
vi.mock("./CanonicalEntityPreview", () => ({
  CanonicalEntityPreview: ({ projectId }: { projectId: string }) => {
    useEffect(() => () => evidence.previewCleanup(), []);
    return (
      <>
        <output data-testid="preview-project">{projectId}</output>
        <input aria-label="Preview reply" defaultValue="" />
        <a href="/projects/original/target">Target page</a>
      </>
    );
  },
}));
vi.mock("./Explorer/OpenItemsTriageContent", () => ({
  OpenItemsTriagePage: ({
    review,
    projectId,
  }: {
    projectId: string;
    review: {
      options: { guidance: string };
      registerStop: (stop: (() => Promise<{ ok: true }>) | null) => void;
    };
  }) => {
    useEffect(() => {
      review.registerStop(async () => ({ ok: true }));
      return () => {
        review.registerStop(null);
        evidence.triageCleanup();
      };
    }, [review.registerStop]);
    return (
      <>
        <h2 id="open-items-triage-title">Open Items triage</h2>
        <output>
          {projectId}:{review.options.guidance}
        </output>
        <input aria-label="Triage follow-up" defaultValue="" />
      </>
    );
  },
}));
function CapsuleButton() {
  const action = useActionsCapsule().actions.find(
    (item) => item.id === "discuss",
  );
  return (
    <button
      onClick={() => {
        if (action?.behavior === "click") action.onClick();
      }}
    >
      Capsule Discuss
    </button>
  );
}
function Origin() {
  const preview = usePreviewHost();
  useEffect(() => () => evidence.pageCleanup(), []);
  return (
    <>
      <DiscussCapsuleAction
        organizationId="org"
        projectId="original"
        entityId="task"
        entityType={EntityType.Task}
        entityTitle="Original subject"
      />
      <CapsuleButton />
      <OpenItemsTriageAction organizationId="org" projectId="original" />
      <button
        onClick={() =>
          preview.openPreview({
            kind: "project_collection",
            collection: "features",
          })
        }
      >
        Collection Preview
      </button>
      <button
        onClick={() =>
          preview.openPreview(createOpenItemEntity("task", "task"))
        }
      >
        Preview
      </button>
    </>
  );
}
function Application() {
  const location = useLocation();
  const navigate = useNavigate();
  const modal = useModal();
  const projectId = location.pathname.split("/")[2];
  return (
    <>
      <output data-testid="location">
        {location.pathname}
        {location.search}
      </output>
      <button onClick={() => navigate("/projects/destination/other?tab=notes")}>
        Elsewhere
      </button>
      <button onClick={() => navigate(-1)}>Back</button>
      <button onClick={() => navigate(1)}>Forward</button>
      <div key={projectId}>
        <OpenItemsPreviewHost organizationId="org" projectId={projectId}>
          <Routes>
            <Route path="/projects/original/task" element={<Origin />} />
            <Route
              path="*"
              element={
                <button
                  onClick={() =>
                    modal?.openModal({
                      type: "discuss",
                      organizationId: "org",
                      projectId: "destination",
                      entityId: "another",
                      entityType: EntityType.Task,
                      entityTitle: "Another subject",
                    })
                  }
                >
                  Another Discuss
                </button>
              }
            />
          </Routes>
        </OpenItemsPreviewHost>
      </div>
      <HeyHeyModal />
    </>
  );
}
function mount() {
  return render(
    <ThemeProvider theme={createHeyTheme("light")}>
      <ModalProvider>
        <ActionsCapsuleProvider>
          <MemoryRouter initialEntries={["/projects/original/task"]}>
            <Application />
          </MemoryRouter>
        </ActionsCapsuleProvider>
      </ModalProvider>
    </ThemeProvider>,
  );
}
beforeEach(() => {
  vi.clearAllMocks();
  evidence.launch.mockResolvedValue(true);
  evidence.session.mockResolvedValue({ agentSessionId: "review" });
});
describe("application-owned modal navigation", () => {
  it("uses the actual capsule opening, cleans up the page across project routes, and submits the retained draft about its original subject once", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByText("Capsule Discuss"));
    const draft = screen.getByLabelText("Discuss draft");
    await user.type(draft, "Original draft");
    await user.click(screen.getByTestId("modal-minimize"));
    await user.click(screen.getByText("Elsewhere"));
    expect(evidence.pageCleanup).toHaveBeenCalledOnce();
    expect(evidence.discussCleanup).not.toHaveBeenCalled();
    expect(evidence.launch).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "Back" }));
    await user.click(screen.getByText("Capsule Discuss"));
    expect(screen.getAllByLabelText("Discuss draft")).toHaveLength(1);
    expect(screen.getByLabelText("Discuss draft")).toBe(draft);
    await user.click(screen.getByTestId("modal-minimize"));
    await user.click(screen.getByText("Forward"));
    await user.click(
      screen.getByRole("button", { name: "Restore Discuss Original subject" }),
    );
    expect(draft).toHaveValue("Original draft");
    await user.click(screen.getByText("Start conversation"));
    expect(evidence.launch).toHaveBeenCalledExactlyOnceWith(
      { organizationId: "org", projectId: "original" },
      expect.objectContaining({
        prompt: "Original draft",
        context: expect.objectContaining({
          entityId: "task",
          entityType: EntityType.Task,
        }),
      }),
    );
    await waitFor(() => expect(evidence.discussCleanup).toHaveBeenCalledOnce());
    expect(screen.queryByTestId("modal-restore")).not.toBeInTheDocument();
  });
  it("keeps two independent drafts and removes only the accepted instance", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByText("Capsule Discuss"));
    await user.type(screen.getByLabelText("Discuss draft"), "First");
    await user.click(screen.getByTestId("modal-minimize"));
    await user.click(screen.getByText("Elsewhere"));
    await user.click(screen.getByText("Another Discuss"));
    const second = screen.getAllByLabelText("Discuss draft")[1];
    await user.type(second, "Second");
    await user.click(
      within(screen.getByRole("dialog")).getByTestId("modal-minimize"),
    );
    expect(screen.getAllByTestId("modal-restore")).toHaveLength(2);
    await user.click(
      screen.getByRole("button", { name: "Restore Discuss Original subject" }),
    );
    await user.click(
      within(screen.getByRole("dialog")).getByTestId("modal-close"),
    );
    await user.click(
      screen.getByRole("button", { name: "Restore Discuss Another subject" }),
    );
    expect(second).toHaveValue("Second");
    expect(evidence.launch).not.toHaveBeenCalled();
  });
  it("preserves Preview reply and pending confirmation while page/project cleanup occurs, cancels observationally, then navigates once", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByText("Preview"));
    const reply = screen.getByLabelText("Preview reply");
    await user.type(reply, "Preserve reply");
    await user.click(screen.getByText("Target page"));
    await user.click(
      screen.getByRole("button", { name: "Minimize Leave preview?" }),
    );
    await user.click(screen.getByText("Elsewhere"));
    expect(evidence.previewCleanup).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Restore Original subject" }),
    );
    await user.click(await screen.findByRole("button", { name: "Cancel" }));
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/destination/other?tab=notes",
    );
    expect(reply).toHaveValue("Preserve reply");
    expect(screen.getByTestId("preview-project")).toHaveTextContent("original");
    await user.click(screen.getByText("Target page"));
    await user.click(await screen.findByRole("button", { name: "Continue" }));
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/original/target",
    );
    await waitFor(() => expect(evidence.previewCleanup).toHaveBeenCalledOnce());
    await user.click(screen.getByText("Back"));
    expect(screen.getByTestId("location")).toHaveTextContent(
      "/projects/destination/other?tab=notes",
    );
  });
  it("keeps the triage review and follow-up draft after Explorer disposal without starting a second review", async () => {
    const user = userEvent.setup();
    mount();
    await user.click(screen.getByTestId("open-items-triage-action"));
    expect(evidence.session).not.toHaveBeenCalled();
    await user.click(await screen.findByTestId("triage-start-tidy-up"));
    const draft = await screen.findByLabelText("Triage follow-up");
    await user.type(draft, "Keep my follow-up");
    await user.click(screen.getByTestId("modal-minimize"));
    await user.click(screen.getByText("Elsewhere"));
    expect(evidence.pageCleanup).toHaveBeenCalledOnce();
    expect(evidence.triageCleanup).not.toHaveBeenCalled();
    await user.click(
      screen.getByRole("button", { name: "Restore Open Items triage" }),
    );
    expect(screen.getByLabelText("Triage follow-up")).toBe(draft);
    expect(draft).toHaveValue("Keep my follow-up");
    expect(evidence.session).toHaveBeenCalledExactlyOnceWith({
      organizationId: "org",
      projectId: "original",
    });
  });
});
