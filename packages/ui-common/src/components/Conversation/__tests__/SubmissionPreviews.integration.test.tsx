import { messageKeys } from "../../../data/collections/messages";
import { resetConversationMessageHistoryStateForTests } from "../../../data/collections/conversationMessageHistoryState";
const canonicalMessageRead = vi.hoisted(() => vi.fn());
const queuedInputsRead = vi.hoisted(() => vi.fn());
const cancelInput = vi.hoisted(() => vi.fn());
// Only HTTP is mocked; the store, hook, coordinator and viewer are real.
vi.mock("../../../clients/serviceClients", async (importOriginal) => {
  const original = await importOriginal<
    typeof import("../../../clients/serviceClients")
  >();
  return {
    ...original,
    unifiedApiClient: {
      ...original.unifiedApiClient,
      getConversationCliStatus: async () => ({ data: { data: null } }),
    },
    platformClient: {
      ...original.platformClient,
      getMessages: canonicalMessageRead,
    },
    projectsClient: {
      ...original.projectsClient,
      getQueuedConversationInputs: queuedInputsRead,
      cancelAgentOperationInput: cancelInput,
    },
  };
});
// Observes arrival animations without changing what renders.
vi.mock("../../../animations", async (importOriginal) => {
  const original =
    await importOriginal<typeof import("../../../animations")>();
  return {
    ...original,
    FadeIn: ({ children }: { children: ReactNode }) => (
      <div data-testid="fade-in">{children}</div>
    ),
  };
});
vi.mock("../useConversationWebSocket", () => ({
  useConversationWebSocket: vi.fn(() => ({
    isConnected: true,
    isAuthenticated: true,
    connectionError: null,
    disconnect: vi.fn(),
    resetVersionTracking: vi.fn(),
    getCurrentVersion: vi.fn(),
    setCurrentVersion: vi.fn(),
  })),
}));
vi.mock("../../../hooks/useUserIdentity", () => ({
  useUserIdentity: () => ({ userId: "user-123" }),
}));
vi.mock("../../../contexts/TrackingContext", () => ({
  useFormTracking: () => ({
    trackFormStart: vi.fn(),
    trackSubmitSuccess: vi.fn(),
  }),
  useUserAction: () => ({ trackUI: vi.fn() }),
}));
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import type { ReactNode } from "react";
import type { ConversationScrollPolicy } from "../hooks/useConversationScrolling";
import i18n from "../../../i18n";
import { ConversationViewer } from "../ConversationViewer";
import {
  DefaultAgentOperationCoordinator,
  type AgentOperationDependencies,
} from "../../AgentSession/operations/AgentOperationCoordinator";
import type { AgentOperationSnapshot } from "../../AgentSession/operations/agentOperationReducer";
import {
  getOptimisticInputs,
  removeOptimisticInput,
} from "../../../data/collections/optimisticConversationInputs";
import type {
  ConversationResponseDto,
  MessageRecordDto,
  ProjectResponseDto,
} from "../../../api";

const project = {
  id: "submit-project",
  organizationId: "submit-org",
  name: "Submissions",
} as ProjectResponseDto;
const conversation = {
  id: "submit-conversation",
  organizationId: project.organizationId,
  projectId: project.id,
  createdAt: "2026-10-01T00:00:00Z",
  updatedAt: "2026-10-01T00:00:00Z",
} as ConversationResponseDto;
const queryKey = messageKeys.list(
  project.organizationId,
  project.id,
  conversation.id
);
const opening = {
  id: "opening",
  projectId: project.id,
  conversationId: conversation.id,
  type: "SYSTEM",
  status: "completed",
  createdAt: "2026-10-01T00:00:00Z",
  awaitingResponse: false,
  data: { type: "AGENT", response: "How can I help?" },
} as unknown as MessageRecordDto;

/** The canonical HTTP reads: dated timeline plus the undated queue. */
let served: { timeline: MessageRecordDto[]; queue: MessageRecordDto[] };
const serve = (timeline: MessageRecordDto[], queue: MessageRecordDto[] = []) => {
  served = { timeline: [opening, ...timeline], queue };
};
/** The QueryClient the rendered viewer reads from. */
let queryClient: QueryClient;
const refresh = () =>
  act(async () => {
    await queryClient.refetchQueries({ queryKey, exact: true });
  });

const userMessage = (
  operationId: string,
  comment: string,
  fields: Partial<MessageRecordDto>
) =>
  ({
    id: `message-${operationId}`,
    projectId: project.id,
    conversationId: conversation.id,
    type: "USER",
    status: "completed",
    awaitingResponse: false,
    createdAt: null,
    data: { comment },
    executionStatus: "queued",
    executionOperationId: operationId,
    ...fields,
  }) as MessageRecordDto;

const accepted = (
  operationId: string,
  fingerprint: string,
  message: MessageRecordDto
): AgentOperationSnapshot => ({
  operationId,
  fingerprint,
  kind: "submit_message",
  state: "accepted",
  messageId: message.id,
  triggerMessageId: message.id,
  message,
});

const coordinatorWith = (
  submitMessage: AgentOperationDependencies["submitMessage"]
) =>
  new DefaultAgentOperationCoordinator({
    fingerprintStart: vi.fn(),
    startSession: vi.fn(),
    reconcile: vi.fn().mockRejectedValue(new Error("not found")),
    fingerprintMessage: async () => "fingerprint",
    submitMessage,
  });

const send = (
  coordinator: DefaultAgentOperationCoordinator,
  comment: string
) =>
  coordinator.submitMessage({
    organizationId: project.organizationId,
    projectId: project.id,
    agentSessionId: "session",
    conversationId: conversation.id,
    machineId: "machine",
    intent: {
      projectId: project.id,
      conversationId: conversation.id,
      parentMessageId: null,
      data: { comment },
    },
  });

const renderViewer = async (
  scrollPolicy: ConversationScrollPolicy = { mode: "disabled" },
  owner?: HTMLElement
) => {
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: 0 } },
  });
  const theme = createTheme();
  (theme.palette as Record<string, unknown>).attention = {
    main: "#1976d2",
    contrastText: "#ffffff",
  };
  render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider theme={theme}>
          <I18nextProvider i18n={i18n}>
            <ConversationViewer
              conversation={conversation}
              project={project}
              agentSessionId="session"
              readOnly
              timelineAnimationMode="new-only"
              animationType="minimal"
              scrollPolicy={scrollPolicy}
            />
          </I18nextProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </MemoryRouter>,
    owner ? { container: owner } : undefined
  );
  await screen.findByText("How can I help?");
};

const previews = (state?: string) =>
  screen
    .queryAllByTestId("submission-preview")
    .filter(
      (node) => !state || node.getAttribute("data-delivery-state") === state
    );
const timelineRow = (messageId: string) =>
  screen
    .getByTestId("conversation-timeline")
    .querySelector(`[data-message-id="${messageId}"]`);

beforeEach(() => {
  serve([]);
  canonicalMessageRead.mockImplementation(async () => ({
    data: { data: { messages: served.timeline } },
  }));
  queuedInputsRead.mockImplementation(async () => ({
    data: { data: served.queue },
  }));
});
afterEach(() => {
  act(() => {
    getOptimisticInputs().forEach((row) =>
      removeOptimisticInput(row.operationId)
    );
  });
  resetConversationMessageHistoryStateForTests();
  queryClient?.clear();
  vi.clearAllMocks();
});

describe("submission previews through the real submission path", () => {
  it("reveals a submitted bubble once through the coordinator and viewer, without following confirmation or a long reply", async () => {
    const owner = document.createElement("main");
    document.body.append(owner);
    const ownerRef = { current: owner };
    const scrollTo = vi.fn();
    Object.defineProperties(owner, {
      scrollTo: { value: scrollTo },
      scrollHeight: { configurable: true, value: 1600 },
      clientHeight: { value: 600 },
    });
    await renderViewer({ mode: "owned", ownerRef }, owner);
    await waitFor(() => expect(scrollTo).toHaveBeenCalled());
    scrollTo.mockClear();
    let release!: () => void;
    const gate = new Promise<void>(resolve => { release = resolve; });
    let confirmed!: MessageRecordDto;
    const coordinator = coordinatorWith(async ({ operationId, fingerprint }) => {
      await gate;
      confirmed = userMessage(operationId, "Read from here", {
        executionAdmissionDisposition: "IMMEDIATE",
      });
      return accepted(operationId, fingerprint, confirmed);
    });
    let submitted!: Promise<unknown>;
    act(() => { submitted = send(coordinator, "Read from here"); });
    await waitFor(() => expect(scrollTo).toHaveBeenCalledOnce());
    expect(scrollTo.mock.calls[0][0].behavior).toBe("instant");
    expect(previews("sending")).toHaveLength(1);
    await act(async () => { release(); await submitted; });
    expect(previews("starting")).toHaveLength(1);
    serve([{ ...confirmed, createdAt: "2026-10-01T00:00:05Z", executionStatus: "started" }]);
    await refresh();
    await waitFor(() => expect(timelineRow(confirmed.id)).not.toBeNull());
    expect(previews()).toHaveLength(0);
    Object.defineProperty(owner, "scrollHeight", { value: 8000 });
    canonicalMessageRead.mockResolvedValueOnce({ data: { data: [] } });
    await refresh();
    expect(scrollTo).toHaveBeenCalledOnce();
    expect(owner.style.overflowAnchor).toBe("");
  });

  it("shows an IMMEDIATE send at once as a user bubble, never queued, then replaces it with the started message without a second arrival", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    let confirmed!: MessageRecordDto;
    const coordinator = coordinatorWith(async ({ operationId, fingerprint }) => {
      await gate;
      confirmed = userMessage(operationId, "Start now", {
        executionAdmissionDisposition: "IMMEDIATE",
      });
      return accepted(operationId, fingerprint, confirmed);
    });
    await renderViewer();

    let submitted!: Promise<unknown>;
    act(() => {
      submitted = send(coordinator, "Start now");
    });
    expect(previews("sending")).toHaveLength(1);
    expect(previews("sending")[0]).toHaveTextContent("Start now");
    await act(async () => {
      release();
      await submitted;
    });
    expect(previews("starting")).toHaveLength(1);
    expect(previews("queued")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: "Cancel" })).toBeNull();

    serve([
      {
        ...confirmed,
        executionStatus: "started",
        createdAt: "2026-10-01T00:00:05Z",
      } as MessageRecordDto,
    ]);
    await refresh();
    await waitFor(() => expect(timelineRow(confirmed.id)).not.toBeNull());
    expect(previews()).toHaveLength(0);
    expect(screen.getAllByText("Start now")).toHaveLength(1);
    expect(
      screen.getByTestId(`user-message-${confirmed.id}`)
    ).toBeInTheDocument();
    expect(
      timelineRow(confirmed.id)!.closest('[data-testid="fade-in"]')
    ).toBeNull();
  });

  it("shows a QUEUED send as queued with Cancel as soon as the disposition returns, then hands over to the started message", async () => {
    let confirmed!: MessageRecordDto;
    const coordinator = coordinatorWith(async ({ operationId, fingerprint }) => {
      confirmed = userMessage(operationId, "Wait your turn", {
        executionAdmissionDisposition: "QUEUED",
        executionQueueConfirmed: true,
      });
      return accepted(operationId, fingerprint, confirmed);
    });
    await renderViewer();
    await act(async () => {
      await send(coordinator, "Wait your turn");
    });
    const [queued] = previews("queued");
    expect(queued).toHaveTextContent("Wait your turn");
    expect(
      within(queued).getByRole("button", { name: "Cancel" })
    ).toBeEnabled();

    serve([], [confirmed]);
    await refresh();
    expect(previews("queued")).toHaveLength(1);
    expect(screen.getAllByText("Wait your turn")).toHaveLength(1);

    serve([
      {
        ...confirmed,
        executionStatus: "started",
        executionQueueConfirmed: false,
        createdAt: "2026-10-01T00:00:05Z",
      } as MessageRecordDto,
    ]);
    await refresh();
    await waitFor(() => expect(timelineRow(confirmed.id)).not.toBeNull());
    expect(previews()).toHaveLength(0);
    expect(screen.getAllByText("Wait your turn")).toHaveLength(1);
    expect(
      timelineRow(confirmed.id)!.closest('[data-testid="fade-in"]')
    ).toBeNull();
  });

  it("shows a PENDING send as awaiting delivery", async () => {
    const coordinator = coordinatorWith(async ({ operationId, fingerprint }) =>
      accepted(
        operationId,
        fingerprint,
        userMessage(operationId, "Deliver me", {
          executionAdmissionDisposition: "PENDING",
        })
      )
    );
    await renderViewer();
    await act(async () => {
      await send(coordinator, "Deliver me");
    });
    expect(previews("awaiting-delivery")[0]).toHaveTextContent("Deliver me");
    expect(previews()).toHaveLength(1);
  });

  it.each([
    [
      "denied",
      async ({ operationId, fingerprint }: { operationId: string; fingerprint: string }) =>
        ({
          operationId,
          fingerprint,
          kind: "submit_message",
          state: "denied",
          code: "DENIED",
          message: "Not allowed",
        }) as AgentOperationSnapshot,
      "Not allowed",
    ],
    [
      "failed",
      async ({ operationId, fingerprint }: { operationId: string; fingerprint: string }) =>
        ({
          operationId,
          fingerprint,
          kind: "submit_message",
          state: "failed",
          code: "OPERATION_FAILED",
          message: "Runner crashed",
        }) as AgentOperationSnapshot,
      "Runner crashed",
    ],
    [
      "thrown",
      async () => {
        throw new Error("Network down");
      },
      "Network down",
    ],
  ] as const)(
    "keeps a %s submission visible as failed until dismissed",
    async (_label, submit, reason) => {
      const coordinator = coordinatorWith(submit);
      await renderViewer();
      await act(async () => {
        await send(coordinator, "Doomed").catch(() => {});
      });
      const [failed] = previews("failed");
      expect(failed).toHaveTextContent("Doomed");
      expect(failed).toHaveTextContent(reason);
      fireEvent.click(within(failed).getByRole("button", { name: "Dismiss" }));
      expect(previews()).toHaveLength(0);
      expect(screen.queryByText("Doomed")).not.toBeInTheDocument();
    }
  );

  it("keeps two rapid identical-text sends distinct and confirms them independently", async () => {
    const releases: Array<() => void> = [];
    const confirmed: MessageRecordDto[] = [];
    const coordinator = coordinatorWith(
      ({ operationId, fingerprint }) =>
        new Promise((resolve) => {
          releases.push(() => {
            const message = userMessage(operationId, "Same text", {
              executionAdmissionDisposition: "QUEUED",
              executionQueueConfirmed: true,
            });
            confirmed.push(message);
            resolve(accepted(operationId, fingerprint, message));
          });
        })
    );
    await renderViewer();
    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    act(() => {
      first = send(coordinator, "Same text");
      second = send(coordinator, "Same text");
    });
    await waitFor(() => expect(releases).toHaveLength(2));
    expect(previews("sending")).toHaveLength(2);
    const keys = previews().map((node) =>
      node.getAttribute("data-preview-key")
    );
    expect(new Set(keys).size).toBe(2);

    await act(async () => {
      releases[1]();
      await second;
    });
    expect(previews().map((node) => node.getAttribute("data-delivery-state")))
      .toEqual(["sending", "queued"]);
    await act(async () => {
      releases[0]();
      await first;
    });
    expect(previews("queued")).toHaveLength(2);
    expect(
      previews().map((node) => node.getAttribute("data-preview-key"))
    ).toEqual(keys);
  });

  it("cancels a queued send and keeps the remaining submissions in send order", async () => {
    const confirmed: MessageRecordDto[] = [];
    const coordinator = coordinatorWith(async ({ operationId, fingerprint }) => {
      const comment = `Queued ${confirmed.length + 1}`;
      const message = userMessage(operationId, comment, {
        executionAdmissionDisposition: "QUEUED",
        executionQueueConfirmed: true,
      });
      confirmed.push(message);
      return accepted(operationId, fingerprint, message);
    });
    await renderViewer();
    await act(async () => {
      await send(coordinator, "Queued 1");
      await send(coordinator, "Queued 2");
      await send(coordinator, "Queued 3");
    });
    serve([], confirmed);
    await refresh();
    expect(previews().map((node) => node.textContent)).toEqual([
      expect.stringContaining("Queued 1"),
      expect.stringContaining("Queued 2"),
      expect.stringContaining("Queued 3"),
    ]);

    cancelInput.mockImplementation(async () => {
      serve([], [
        confirmed[0],
        { ...confirmed[1], executionStatus: "cancelled" } as MessageRecordDto,
        confirmed[2],
      ]);
      return {
        data: {
          data: { executionStatus: "cancelled", cancellationRequested: true },
        },
      };
    });
    fireEvent.click(
      within(previews()[1]).getByRole("button", { name: "Cancel" })
    );
    await screen.findByText("Message cancelled");
    expect(cancelInput).toHaveBeenCalledWith(
      expect.objectContaining({ operationId: confirmed[1].executionOperationId })
    );
    await waitFor(() => expect(previews()).toHaveLength(2));
    expect(previews().map((node) => node.textContent)).toEqual([
      expect.stringContaining("Queued 1"),
      expect.stringContaining("Queued 3"),
    ]);
  });
});
