import { act, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  OpenItemsTriageMode,
  type AgentSessionDto,
  type OpenItemsTriagePromoteGroupSuggestion,
} from "@hey-hey/ui-common/api";
import type {
  TriageApplicationCoordinator,
  TriageApplicationPorts,
} from "@hey-hey/ui-common/data";
import { PreviewModal } from "../../components/PreviewModal";
import {
  OpenItemsTriagePage,
  type OpenItemsTriageReviewBinding,
} from "./OpenItemsTriagePage";

const mocks = vi.hoisted(() => ({
  runtime: vi.fn(),
  send: vi.fn(),
  stopRun: vi.fn(),
  currentState: "IDLE",
  reportResult: undefined as ((present: boolean) => void) | undefined,
  promote: vi.fn(),
  refresh: vi.fn(),
  track: vi.fn(),
  groupAvailable: true,
}));
const suggestion: OpenItemsTriagePromoteGroupSuggestion = {
  suggestionId: "promote",
  kind: "promoteGroupToGoal",
  groupId: "group",
  groupName: "This week",
  goalName: "Ship it",
  rationale: "One outcome",
  evidence: [{ kind: "attention", summary: "Viewed together" }],
  affectedMembers: [],
};
vi.mock("@hey-hey/ui-common/context", async (original) => ({
  ...(await original<typeof import("@hey-hey/ui-common/context")>()),
  useAuth: () => ({ user: { id: "user" } }),
  CanonicalPageBoundary: ({
    children,
    composition,
  }: {
    children: React.ReactNode;
    composition: { kind: string };
  }) => <div data-testid={`boundary-${composition.kind}`}>{children}</div>,
}));
vi.mock("@hey-hey/ui-common/data", async (original) => ({
  ...(await original<typeof import("@hey-hey/ui-common/data")>()),
  useAgentSessionCurrentState: () => ({ currentState: mocks.currentState }),
  useMessage: () => ({ data: undefined }),
  useOpenItems: () => ({
    collection: { state: "PRESENT", revision: 1, items: [], groups: [] },
    adapter: {
      scope: { organizationId: "org", projectId: "project", userId: "user" },
    },
  }),
  useTriageApplicationPorts: (
    _adapter: unknown,
    promote: TriageApplicationPorts["promote"],
  ) => ({
    refresh: mocks.refresh,
    groupExists: () => mocks.groupAvailable,
    target: () => ({ open: true, groupId: "group", pinned: false }),
    promote,
    revalidateGoals: vi.fn().mockResolvedValue(undefined),
    track: mocks.track,
  }),
}));
vi.mock("../../contexts/OpenItemsContext", () => ({
  useOpenItems: () => ({
    groups: mocks.groupAvailable ? [{ id: "group", name: "This week" }] : [],
    items: [],
    promoteGroupToGoal: mocks.promote,
    refresh: mocks.refresh,
  }),
}));
vi.mock("@hey-hey/ui-common/components", async (original) => ({
  ...(await original<typeof import("@hey-hey/ui-common/components")>()),
  useOpenItemsTriageRuntime: (...args: unknown[]) => {
    mocks.runtime(...args);
    return {
      send: mocks.send,
      pending: false,
      error: null,
      ready: true,
      machines: {
        isReady: true,
        mode: "one",
        machines: [],
        selectedMachine: { machineId: "machine" },
      },
      stopRun: mocks.stopRun,
      stoppingRun: false,
    };
  },
  AgentConversationView: () => {
    throw new Error("Triage must not mount the agent session interface");
  },
  OpenItemsTriageResults: ({
    onSend,
    application,
    disabled,
    pending,
    requestMessageIds,
    onResultPresenceChange,
  }: {
    disabled: boolean;
    pending: boolean;
    onSend: (text: string) => Promise<void>;
    application: TriageApplicationCoordinator;
    requestMessageIds?: readonly string[];
    onResultPresenceChange?: (present: boolean) => void;
  }) => {
    mocks.reportResult = onResultPresenceChange;
    return (
      <>
        {disabled && <span data-testid="conversation-read-only" />}
        <span
          data-testid="results-correlation"
          data-requests={requestMessageIds?.join(",") ?? "all"}
          data-pending={String(pending)}
        />
        <button onClick={() => void onSend("Keep active work")}>Send</button>
        <button onClick={() => void application.apply("reply", suggestion)}>
          Apply promotion
        </button>
      </>
    );
  },
}));
const session = {
  id: "session",
  userId: "user",
  projectId: "project",
  conversationId: "conversation",
  status: "IN_PROGRESS",
  type: "PROJECT_CONVERSATION",
  title: "Triage",
} as AgentSessionDto;
const binding = (
  overrides: Partial<OpenItemsTriageReviewBinding> = {},
): OpenItemsTriageReviewBinding => ({
  options: { mode: OpenItemsTriageMode.TidyUp, guidance: "" },
  requestMessageIds: [],
  onFreshPassSubmitted: vi.fn(),
  onFollowUpSubmitted: vi.fn(),
  onActivity: vi.fn(),
  onRunAgain: vi.fn(),
  onLaunchFailed: vi.fn(),
  registerStop: vi.fn(),
  ...overrides,
});
const mount = (
  status: AgentSessionDto["status"] = "IN_PROGRESS",
  props: Partial<React.ComponentProps<typeof OpenItemsTriagePage>> = {},
) =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <OpenItemsTriagePage
        organizationId="org"
        projectId="project"
        agentSession={{ ...session, status }}
        review={binding()}
        {...props}
      />
    </QueryClientProvider>,
  );

describe("triage page ownership and shared confirmation", () => {
  beforeEach(() => {
    mocks.groupAvailable = true;
    vi.clearAllMocks();
    mocks.currentState = "IDLE";
    mocks.send.mockResolvedValue({ messageId: "request" });
    mocks.refresh.mockResolvedValue(true);
    mocks.promote.mockResolvedValue({});
  });
  it("sends typed follow-ups on the session and never applies suggestions for them", async () => {
    mount();
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    expect(mocks.promote).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText("Send"));
    expect(mocks.send.mock.calls).toEqual([
      ["freshPass", ""],
      ["followUp", "Keep active work"],
    ]);
    expect(mocks.promote).not.toHaveBeenCalled();
    expect(mocks.track).not.toHaveBeenCalled();
  });
  it("cancel has no mutation, while explicit shared confirmation sends name and optional date", async () => {
    mount();
    await userEvent.click(screen.getByText("Apply promotion"));
    expect(await screen.findByRole("dialog")).toBeInTheDocument();
    expect(mocks.promote).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText("Cancel"));
    expect(mocks.promote).not.toHaveBeenCalled();
    await userEvent.click(screen.getByText("Apply promotion"));
    await userEvent.click(
      await screen.findByTestId("open-items-promotion-confirm"),
    );
    await waitFor(() => expect(mocks.promote).toHaveBeenCalledTimes(1));
    expect(mocks.promote.mock.calls[0][0]).toEqual({
      groupId: "group",
      goalName: "Ship it",
      idempotencyKey: expect.any(String),
    });
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });
  it("recovers an uncertain promotion after the group disappeared using the same provider identity and explicit confirmation", async () => {
    mocks.promote.mockRejectedValueOnce(new Error("Tracking failed"));
    mount();
    await userEvent.click(screen.getByText("Apply promotion"));
    await userEvent.click(
      await screen.findByTestId("open-items-promotion-confirm"),
    );
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    const request = mocks.promote.mock.calls[0][0];
    mocks.groupAvailable = false;
    await userEvent.click(screen.getByText("Apply promotion"));
    expect(await screen.findByText("Recover promotion")).toBeInTheDocument();
    await userEvent.click(
      await screen.findByTestId("open-items-promotion-confirm"),
    );
    await waitFor(() => expect(mocks.promote).toHaveBeenCalledTimes(2));
    expect(mocks.promote.mock.calls[1][0]).toEqual(request);
  });
  it.each([404, 409, 410, 412])(
    "retains promotion identity after an ordered-write HTTP %s failure",
    async (status) => {
      mocks.promote.mockRejectedValueOnce({
        isAxiosError: true,
        response: { status },
      });
      mount();
      await userEvent.click(screen.getByText("Apply promotion"));
      await userEvent.click(
        await screen.findByTestId("open-items-promotion-confirm"),
      );
      await waitFor(() =>
        expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
      );
      const request = mocks.promote.mock.calls[0][0];
      await userEvent.click(screen.getByText("Apply promotion"));
      expect(await screen.findByText("Recover promotion")).toBeInTheDocument();
      expect(screen.getByLabelText("Goal name")).toBeDisabled();
      await userEvent.click(
        await screen.findByTestId("open-items-promotion-confirm"),
      );
      await waitFor(() => expect(mocks.promote).toHaveBeenCalledTimes(2));
      expect(mocks.promote.mock.calls[1][0]).toEqual(request);
    },
  );
});

describe("promotion confirmation inside the triage modal", () => {
  beforeEach(() => {
    mocks.groupAvailable = true;
    vi.clearAllMocks();
    mocks.currentState = "IDLE";
    mocks.send.mockResolvedValue({ messageId: "request" });
  });
  it("layers over the triage modal and cancelling returns to it", async () => {
    const onClose = vi.fn();
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <PreviewModal
            open
            onClose={onClose}
            layout="dialog"
            labelledBy="open-items-triage-title"
          >
            <OpenItemsTriagePage
              organizationId="org"
              projectId="project"
              agentSession={session}
              pageIdentity="observational"
              onClose={onClose}
              review={binding()}
            />
          </PreviewModal>
        </MemoryRouter>
      </QueryClientProvider>,
    );
    const triage = screen.getByRole("dialog", { name: "Open Items triage" });
    const apply = screen.getByText("Apply promotion");
    await userEvent.click(apply);
    const promotion = await screen.findByRole("dialog", {
      name: "Promote to Goal",
    });
    // MUI stacks later-mounted modals above earlier ones at equal z-index.
    expect(
      triage.compareDocumentPosition(promotion) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(triage).not.toContainElement(promotion);
    await userEvent.click(screen.getByText("Cancel"));
    await waitFor(() =>
      expect(
        screen.queryByRole("dialog", { name: "Promote to Goal" }),
      ).not.toBeInTheDocument(),
    );
    expect(onClose).not.toHaveBeenCalled();
    expect(
      screen.getByRole("dialog", { name: "Open Items triage" }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(triage).toContainElement(document.activeElement as HTMLElement),
    );
    expect(mocks.promote).not.toHaveBeenCalled();
  });
});

describe("triage page identity", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.currentState = "IDLE";
    mocks.send.mockResolvedValue({ messageId: "request" });
  });
  it("claims canonical identity interactively by default", () => {
    mount();
    expect(screen.getByTestId("boundary-canonical")).toBeInTheDocument();
    expect(screen.queryByTestId("conversation-read-only")).toBeNull();
  });
  it("stays interactive while observational", async () => {
    mount("NOT_STARTED", { pageIdentity: "observational" });
    expect(screen.getByTestId("boundary-observational")).toBeInTheDocument();
    expect(screen.queryByTestId("conversation-read-only")).toBeNull();
  });
  it("preview is observational and read-only", () => {
    mount("NOT_STARTED", { preview: true });
    expect(screen.getByTestId("boundary-observational")).toBeInTheDocument();
    expect(screen.getByTestId("conversation-read-only")).toBeInTheDocument();
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

describe("triage page within a modal review", () => {
  beforeEach(() => {
    mocks.groupAvailable = true;
    vi.clearAllMocks();
    mocks.currentState = "IDLE";
    mocks.send.mockResolvedValue({ messageId: "fresh" });
    mocks.stopRun.mockResolvedValue({ ok: true });
  });

  it.each([
    [OpenItemsTriageMode.TidyUp, ""],
    [OpenItemsTriageMode.SpringCleaning, "Focus on stale bugs"],
  ])(
    "runs on the review's own %s mode and guidance for every request",
    async (mode, guidance) => {
      const review = binding({ options: { mode, guidance } });
      mount("NOT_STARTED", { review });
      await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
      expect(mocks.runtime).toHaveBeenLastCalledWith(
        "org",
        "project",
        expect.objectContaining({ id: "session" }),
        { mode, guidance },
      );
    },
  );

  it("submits one fresh pass for its new session and records it as the boundary", async () => {
    const review = binding();
    const view = mount("NOT_STARTED", {
      review,
      pageIdentity: "observational",
    });
    await waitFor(() =>
      expect(review.onFreshPassSubmitted).toHaveBeenCalledWith("fresh"),
    );
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <OpenItemsTriagePage
          organizationId="org"
          projectId="project"
          agentSession={{ ...session, status: "NOT_STARTED" }}
          pageIdentity="observational"
          review={{ ...review, requestMessageIds: ["fresh"] }}
        />
      </QueryClientProvider>,
    );
    expect(mocks.send.mock.calls).toEqual([["freshPass", ""]]);
    expect(screen.getByTestId("results-correlation")).toHaveAttribute(
      "data-requests",
      "fresh",
    );
    expect(mocks.promote).not.toHaveBeenCalled();
    expect(mocks.track).not.toHaveBeenCalled();
  });

  it.each(["rejected", "unaccepted"])(
    "reports an immediately %s launch to the review owner",
    async (kind) => {
      const review = binding();
      if (kind === "rejected")
        mocks.send.mockRejectedValueOnce(new Error("Admission failed"));
      else mocks.send.mockResolvedValueOnce(null);
      mount("NOT_STARTED", { review });
      await waitFor(() => expect(review.onLaunchFailed).toHaveBeenCalledOnce());
      expect(review.onFreshPassSubmitted).not.toHaveBeenCalled();
      expect(mocks.promote).not.toHaveBeenCalled();
    },
  );

  it("reports progress until a correlated result arrives, then results", async () => {
    const review = binding({ requestMessageIds: ["fresh"] });
    mount("IN_PROGRESS", { review });
    await waitFor(() =>
      expect(review.onActivity).toHaveBeenLastCalledWith("running", false),
    );
    expect(screen.getByTestId("results-correlation")).toHaveAttribute(
      "data-pending",
      "true",
    );
    act(() => mocks.reportResult?.(true));
    await waitFor(() =>
      expect(review.onActivity).toHaveBeenLastCalledWith("results", false),
    );
  });

  it("reports an active run as running and its end as results", async () => {
    mocks.currentState = "THINKING";
    const review = binding({ requestMessageIds: ["fresh"] });
    const view = mount("IN_PROGRESS", { review });
    await waitFor(() =>
      expect(review.onActivity).toHaveBeenLastCalledWith("running", true),
    );
    mocks.currentState = "IDLE";
    view.rerender(
      <QueryClientProvider client={new QueryClient()}>
        <OpenItemsTriagePage
          organizationId="org"
          projectId="project"
          agentSession={session}
          review={review}
        />
      </QueryClientProvider>,
    );
    await waitFor(() =>
      expect(review.onActivity).toHaveBeenLastCalledWith("results", false),
    );
  });

  it("records follow-ups on the review and hands Run Again back to it for a new session", async () => {
    const review = binding({ requestMessageIds: ["fresh"] });
    mount("IN_PROGRESS", { review });
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    act(() => mocks.reportResult?.(true));
    mocks.send.mockResolvedValueOnce({ messageId: "follow" });
    await userEvent.click(screen.getByText("Send"));
    await waitFor(() =>
      expect(review.onFollowUpSubmitted).toHaveBeenCalledWith("follow"),
    );
    await userEvent.click(screen.getByTestId("triage-run-again"));
    expect(review.onRunAgain).toHaveBeenCalledTimes(1);
    expect(mocks.send.mock.calls).toEqual([
      ["freshPass", ""],
      ["followUp", "Keep active work"],
    ]);
  });

  it("ends progress with a retryable error when the run errors before replying", async () => {
    const review = binding({ requestMessageIds: ["fresh"] });
    mount("ERRORED", { review });
    await waitFor(() =>
      expect(review.onActivity).toHaveBeenLastCalledWith("results", false),
    );
    expect(screen.getByTestId("triage-run-error")).toBeInTheDocument();
    expect(screen.getByTestId("results-correlation")).toHaveAttribute(
      "data-pending",
      "false",
    );
    expect(screen.getByTestId("triage-run-again")).toBeEnabled();
  });

  it("registers a stop that waits for an in-flight launch before the signed stop", async () => {
    let finishSend: (value: { messageId: string }) => void = () => {};
    mocks.send.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishSend = resolve;
        }),
    );
    const review = binding();
    mount("NOT_STARTED", { review });
    await waitFor(() => expect(review.registerStop).toHaveBeenCalled());
    await waitFor(() => expect(mocks.send).toHaveBeenCalledTimes(1));
    const stop = vi.mocked(review.registerStop).mock.calls.at(-1)?.[0];
    let outcome: Promise<unknown> | undefined;
    act(() => {
      outcome = stop?.();
    });
    await act(async () => {});
    expect(mocks.stopRun).not.toHaveBeenCalled();
    await act(async () => finishSend({ messageId: "fresh" }));
    await expect(outcome).resolves.toEqual({ ok: true });
    expect(mocks.stopRun).toHaveBeenCalledTimes(1);
  });

  it("shows the close gate under the header and keeps the review mounted", () => {
    mount("IN_PROGRESS", {
      review: binding({
        requestMessageIds: ["fresh"],
        closeGate: <div data-testid="gate" />,
      }),
      onClose: vi.fn(),
    });
    expect(screen.getByTestId("gate")).toBeInTheDocument();
    expect(screen.getByTestId("open-items-triage-body")).not.toBeVisible();
    expect(screen.getByTestId("results-correlation")).toBeInTheDocument();
    expect(screen.getByTestId("triage-run-again")).toBeDisabled();
    expect(
      screen.getByRole("heading", { name: "Open Items triage" }),
    ).toBeInTheDocument();
  });
});
