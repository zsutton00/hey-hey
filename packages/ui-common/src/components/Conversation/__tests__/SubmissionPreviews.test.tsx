import {
  DefaultAgentOperationCoordinator,
  type AgentOperationDependencies,
  type DirectTriggerInput,
} from "../../AgentSession/operations/AgentOperationCoordinator";
import {
  getOptimisticInputs,
  removeOptimisticInput,
  inputScope,
  observeCanonicalInputs,
} from "../../../data/collections/optimisticConversationInputs";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { MessageRecordDto } from "../../../api";
import { SubmissionPreviews } from "../SubmissionPreviews";
const mocks = vi.hoisted(() => ({
  read: vi.fn(),
  cancel: vi.fn(),
  refresh: vi.fn(),
}));
// Mirrors the real hook: only dated messages are in the timeline.
vi.mock("../../../data/hooks/useConversationMessages", () => ({
  useConversationMessages: (...args: unknown[]) => {
    const result = mocks.read(...args) as {
      orderedData: Array<MessageRecordDto>;
    };
    return {
      ...result,
      orderedData: result.orderedData.filter((message) => message.createdAt),
      undatedInputs: result.orderedData.filter((message) => !message.createdAt),
    };
  },
}));
vi.mock("../../AgentSession/operations/AgentOperationProvider", () => ({
  cancelQueuedInput: mocks.cancel,
}));
const previewsIn = (state: string) =>
  screen
    .queryAllByTestId("submission-preview")
    .filter((node) => node.getAttribute("data-delivery-state") === state);
const props = {
  organizationId: "org",
  projectId: "project",
  conversationId: "conversation",
  agentSessionId: "session",
};
const queued = {
  id: "message",
  createdAt: null,
  type: "USER",
  data: { comment: "Please investigate" },
  executionStatus: "queued",
  executionQueueConfirmed: true,
  executionOperationId: "operation",
  executionCancellationRequested: false,
};
describe("persisted queued messages", () => {
  beforeEach(() => {
    act(() => {
      getOptimisticInputs().forEach((row) =>
        removeOptimisticInput(row.operationId),
      );
    });
    observeCanonicalInputs(
      inputScope(props.organizationId, props.projectId, props.conversationId),
      [],
    );
    vi.resetAllMocks();
    mocks.read.mockReturnValue({
      orderedData: [queued],
      refetch: mocks.refresh,
    });
  });
  it("shows unconfirmed delivery as pending, outside the queue, until it starts", () => {
    mocks.read.mockReturnValue({
      orderedData: [{ ...queued, executionQueueConfirmed: false }],
      refetch: mocks.refresh,
    });
    const view = () => <SubmissionPreviews {...props} />;
    const { rerender } = render(view());
    expect(previewsIn("queued")).toHaveLength(0);
    expect(previewsIn("awaiting-delivery")[0]).toHaveTextContent(
      "Please investigate",
    );
    mocks.read.mockReturnValue({
      orderedData: [
        {
          ...queued,
          executionQueueConfirmed: false,
          executionStatus: "started",
        },
      ],
      refetch: mocks.refresh,
    });
    rerender(view());
    expect(previewsIn("queued")).toHaveLength(0);
    expect(previewsIn("awaiting-delivery")).toHaveLength(0);
  });
  it("moves a pending input into the queue only after owner confirmation", () => {
    mocks.read.mockReturnValue({
      orderedData: [{ ...queued, executionQueueConfirmed: false }],
      refetch: mocks.refresh,
    });
    const view = () => <SubmissionPreviews {...props} />;
    const { rerender } = render(view());
    mocks.read.mockReturnValue({
      orderedData: [queued],
      refetch: mocks.refresh,
    });
    rerender(view());
    expect(previewsIn("awaiting-delivery")).toHaveLength(0);
    expect(previewsIn("queued")[0]).toHaveTextContent("Please investigate");
    expect(screen.getAllByText("Please investigate")).toHaveLength(1);
  });
  it("shows persisted cancellation progress after reload and prevents duplicate requests", () => {
    mocks.read.mockReturnValue({
      orderedData: [{ ...queued, executionCancellationRequested: true }],
      refetch: mocks.refresh,
    });
    render(<SubmissionPreviews {...props} />);
    expect(screen.getByText("Please investigate")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Cancelling…" })).toBeDisabled();
  });
  it("sends cancellation for the exact message and waits for confirmation", async () => {
    let finish: (result: object) => void = () => {};
    mocks.cancel.mockReturnValue(
      new Promise((resolve) => {
        finish = resolve;
      }),
    );
    render(<SubmissionPreviews {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Cancelling…" })).toBeDisabled();
    expect(mocks.cancel).toHaveBeenCalledWith({
      ...props,
      messageId: "message",
      operationId: "operation",
    });
    finish({ executionStatus: "queued", cancellationRequested: true });
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
  });
  it("reports a pickup winning cancellation without stopping active execution", async () => {
    mocks.cancel.mockResolvedValue({
      executionStatus: "started",
      cancellationRequested: false,
    });
    render(<SubmissionPreviews {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await screen.findByText("This message has already started.");
    expect(mocks.cancel).toHaveBeenCalledOnce();
  });
  it("removes the queue section after the last message starts, even with cancellation feedback", async () => {
    mocks.cancel.mockResolvedValue({
      executionStatus: "started",
      cancellationRequested: false,
    });
    const { rerender } = render(<SubmissionPreviews {...props} />);
    expect(previewsIn("queued")[0]).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await screen.findByText("This message has already started.");
    mocks.read.mockReturnValue({
      orderedData: [{ ...queued, executionStatus: "started" }],
      refetch: mocks.refresh,
    });
    rerender(<SubmissionPreviews {...props} />);
    expect(previewsIn("queued")).toHaveLength(0);
    expect(
      screen.getByText("This message has already started."),
    ).toBeInTheDocument();
  });
  it("confirms an immediate cancellation and removes the queued row", async () => {
    mocks.cancel.mockResolvedValue({
      executionStatus: "cancelled",
      cancellationRequested: true,
    });
    mocks.refresh.mockImplementation(async () => {
      mocks.read.mockReturnValue({
        orderedData: [{ ...queued, executionStatus: "cancelled" }],
        refetch: mocks.refresh,
      });
    });
    const { rerender } = render(<SubmissionPreviews {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await screen.findByText("Message cancelled");
    rerender(<SubmissionPreviews {...props} />);
    expect(previewsIn("queued")).toHaveLength(0);
    expect(screen.queryByText("Please investigate")).not.toBeInTheDocument();
    expect(screen.getByText("Message cancelled")).toBeInTheDocument();
    const closeButton = screen.queryByRole("button", { name: "Close" });
    expect(closeButton).not.toBeInTheDocument();
  });
  it("keeps a pending cancellation in progress and confirms it once refreshed state reports cancelled", async () => {
    mocks.cancel.mockResolvedValue({
      executionStatus: "queued",
      cancellationRequested: true,
    });
    mocks.refresh.mockImplementation(async () => {
      mocks.read.mockReturnValue({
        orderedData: [{ ...queued, executionCancellationRequested: true }],
        refetch: mocks.refresh,
      });
    });
    const { rerender } = render(<SubmissionPreviews {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await waitFor(() => expect(mocks.refresh).toHaveBeenCalledOnce());
    rerender(<SubmissionPreviews {...props} />);
    expect(screen.getByRole("button", { name: "Cancelling…" })).toBeDisabled();
    expect(screen.queryByText("Message cancelled")).not.toBeInTheDocument();
    mocks.read.mockReturnValue({
      orderedData: [{ ...queued, executionStatus: "cancelled" }],
      refetch: mocks.refresh,
    });
    rerender(<SubmissionPreviews {...props} />);
    await screen.findByText("Message cancelled");
    expect(previewsIn("queued")).toHaveLength(0);
    expect(mocks.cancel).toHaveBeenCalledOnce();
  });
  it("dismisses the cancellation notice automatically after a few seconds", async () => {
    vi.useFakeTimers();
    try {
      mocks.cancel.mockResolvedValue({
        executionStatus: "cancelled",
        cancellationRequested: true,
      });
      render(<SubmissionPreviews {...props} />);
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      });
      expect(screen.getByText("Message cancelled")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(5999);
      });
      expect(screen.getByText("Message cancelled")).toBeInTheDocument();
      act(() => {
        vi.advanceTimersByTime(1);
      });
      expect(screen.queryByText("Message cancelled")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
  it("lets the user close a notice", async () => {
    mocks.cancel.mockResolvedValue({
      executionStatus: "started",
      cancellationRequested: false,
    });
    render(<SubmissionPreviews {...props} />);
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    await screen.findByText("This message has already started.");
    fireEvent.click(screen.getByRole("button", { name: "Close" }));
    expect(
      screen.queryByText("This message has already started."),
    ).not.toBeInTheDocument();
  });
  it("draws queued messages in the queued section, not among the submitted messages", () => {
    mocks.read.mockReturnValue({
      orderedData: [
        queued,
        {
          ...queued,
          id: "pending",
          executionQueueConfirmed: false,
          data: { comment: "Still sending" },
        },
      ],
      refetch: mocks.refresh,
    });
    mocks.cancel.mockReturnValue(new Promise(() => {}));
    render(<SubmissionPreviews {...props} />);
    const queuedSection = screen.getByRole("region", {
      name: "Queued messages",
    });
    const messageArea = screen.getByTestId("submission-previews");
    expect(queuedSection).toHaveTextContent("Queued · 1");
    expect(queuedSection).toHaveTextContent("Please investigate");
    expect(messageArea).not.toHaveTextContent("Please investigate");
    expect(messageArea).toHaveTextContent("Still sending");
    expect(queuedSection).not.toHaveTextContent("Still sending");
    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
    expect(screen.getByRole("button", { name: "Cancelling…" })).toBeDisabled();
  });
  it("does not put legacy or started messages back in the queue", () => {
    mocks.read.mockReturnValue({
      orderedData: [
        { ...queued, executionStatus: undefined },
        { ...queued, id: "started", executionStatus: "started" },
      ],
      refetch: mocks.refresh,
    });
    render(<SubmissionPreviews {...props} />);
    expect(previewsIn("queued")).toHaveLength(0);
  });
});

describe("optimistic submission", () => {
  beforeEach(() => {
    act(() => {
      getOptimisticInputs().forEach((row) =>
        removeOptimisticInput(row.operationId),
      );
    });
    vi.resetAllMocks();
    mocks.read.mockReturnValue({ orderedData: [], refetch: mocks.refresh });
  });
  const input = (comment: string): DirectTriggerInput => ({
    ...props,
    machineId: "machine",
    intent: {
      projectId: props.projectId,
      conversationId: props.conversationId,
      parentMessageId: null,
      data: { comment },
    },
  });
  const coordinatorWith = (
    submitMessage: AgentOperationDependencies["submitMessage"],
  ) =>
    new DefaultAgentOperationCoordinator({
      fingerprintStart: vi.fn(),
      startSession: vi.fn(),
      reconcile: vi.fn().mockRejectedValue(new Error("not found")),
      fingerprintMessage: async () => "fingerprint",
      submitMessage,
    });

  it("renders as a sending user bubble before network completion, then hands over to the canonical input in place", async () => {
    let finish!: () => void;
    const gate = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const coordinator = coordinatorWith(
      async ({ operationId, fingerprint }) => {
        await gate;
        return {
          operationId,
          fingerprint,
          kind: "submit_message",
          state: "accepted",
          messageId: "persisted",
          triggerMessageId: "trigger",
        };
      },
    );
    const { rerender } = render(<SubmissionPreviews {...props} />);
    let submitted!: ReturnType<typeof coordinator.submitMessage>;
    act(() => {
      submitted = coordinator.submitMessage(input("Immediate hello"));
    });
    const [sending] = previewsIn("sending");
    expect(sending).toHaveTextContent("Immediate hello");
    const operationId = sending.getAttribute("data-preview-key")!;
    expect(
      screen.getByTestId(`submission-preview-message-${operationId}`),
    ).toHaveAttribute("aria-busy", "true");
    mocks.read.mockReturnValue({
      orderedData: [
        {
          ...queued,
          executionQueueConfirmed: false,
          executionOperationId: operationId,
          data: { comment: "Immediate hello" },
        },
      ],
      refetch: mocks.refresh,
    });
    rerender(<SubmissionPreviews {...props} />);
    expect(previewsIn("awaiting-delivery")[0]).toHaveAttribute(
      "data-preview-key",
      operationId,
    );
    expect(screen.getAllByText("Immediate hello")).toHaveLength(1);
    await act(async () => {
      finish();
      await submitted;
    });
  });

  it.each([
    ["denied", { state: "denied", code: "DENIED", message: "Denied" }],
    [
      "failed",
      { state: "failed", code: "OPERATION_FAILED", message: "Exploded" },
    ],
  ] as const)(
    "keeps a %s submission visible as failed until dismissed",
    async (_label, outcome) => {
      const coordinator = coordinatorWith(
        async ({ operationId, fingerprint }) => ({
          operationId,
          fingerprint,
          kind: "submit_message",
          ...outcome,
        }),
      );
      render(<SubmissionPreviews {...props} />);
      await act(async () => {
        await coordinator.submitMessage(input("Rejected hello"));
      });
      const [failed] = previewsIn("failed");
      expect(failed).toHaveTextContent("Rejected hello");
      expect(failed).toHaveTextContent(outcome.message);
      fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
      expect(screen.queryByText("Rejected hello")).not.toBeInTheDocument();
      expect(getOptimisticInputs()).toHaveLength(0);
    },
  );

  it("removes a cancelled submission instead of showing it as failed", async () => {
    const coordinator = coordinatorWith(
      async ({ operationId, fingerprint }) => ({
        operationId,
        fingerprint,
        kind: "submit_message",
        state: "cancelled",
      }),
    );
    render(<SubmissionPreviews {...props} />);
    await act(async () => {
      await coordinator.submitMessage(input("Never mind"));
    });
    expect(screen.queryByText("Never mind")).not.toBeInTheDocument();
  });

  const confirmedSubmission = (
    disposition: "QUEUED" | "IMMEDIATE" | "PENDING",
    comment: string,
  ) => {
    const confirmed = new Map<string, MessageRecordDto>();
    const coordinator = coordinatorWith(
      async ({ operationId, fingerprint }) => {
        const message = {
          ...queued,
          id: `message-${operationId}`,
          data: { comment },
          executionOperationId: operationId,
          executionAdmissionDisposition: disposition,
          executionQueueConfirmed: disposition === "QUEUED",
        } as unknown as MessageRecordDto;
        confirmed.set(operationId, message);
        return {
          operationId,
          fingerprint,
          kind: "submit_message",
          state: "accepted",
          messageId: message.id,
          triggerMessageId: message.id,
          message,
        };
      },
    );
    return {
      submit: () => coordinator.submitMessage(input(comment)),
      confirmed,
    };
  };

  it.each([
    ["QUEUED", "queued"],
    ["IMMEDIATE", "starting"],
    ["PENDING", "awaiting-delivery"],
  ] as const)(
    "shows a confirmed %s submission as %s, once, straight from the disposition",
    async (disposition, state) => {
      const { submit } = confirmedSubmission(disposition, "Go now");
      render(<SubmissionPreviews {...props} />);
      await act(async () => {
        await submit();
      });
      expect(previewsIn(state)[0]).toHaveTextContent("Go now");
      expect(screen.getAllByTestId("submission-preview")).toHaveLength(1);
      expect(screen.queryByRole("button", { name: "Cancel" }) !== null).toBe(
        disposition === "QUEUED",
      );
    },
  );

  it("hands over to the canonical record of the same identity without a duplicate", async () => {
    const { submit, confirmed } = confirmedSubmission("QUEUED", "Once only");
    const { rerender } = render(<SubmissionPreviews {...props} />);
    await act(async () => {
      await submit();
    });
    const [message] = [...confirmed.values()];
    const key = previewsIn("queued")[0].getAttribute("data-preview-key");
    mocks.read.mockReturnValue({
      orderedData: [message],
      refetch: mocks.refresh,
    });
    rerender(<SubmissionPreviews {...props} />);
    expect(screen.getAllByText("Once only")).toHaveLength(1);
    expect(previewsIn("queued")[0]).toHaveAttribute("data-preview-key", key);
    // Accepted start dates the same canonical message; the timeline owns it.
    mocks.read.mockReturnValue({
      orderedData: [
        {
          ...message,
          executionStatus: "started",
          createdAt: "2026-10-03T02:46:49.300Z",
        },
      ],
      refetch: mocks.refresh,
    });
    rerender(<SubmissionPreviews {...props} />);
    expect(screen.queryByText("Once only")).not.toBeInTheDocument();
  });

  it("keeps rapid identical-text sends as distinct operations", async () => {
    const { submit, confirmed } = confirmedSubmission("QUEUED", "Same text");
    render(<SubmissionPreviews {...props} />);
    await act(async () => {
      await Promise.all([submit(), submit(), submit()]);
    });
    expect(new Set([...confirmed.keys()]).size).toBe(3);
    expect(previewsIn("queued")).toHaveLength(3);
    expect(screen.getAllByTestId("submission-preview")).toHaveLength(3);
  });
});
