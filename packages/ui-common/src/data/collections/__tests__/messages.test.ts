import { QueryClient } from "@tanstack/react-query";
import {
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type MockedFunction,
} from "vitest";
import type { InternalAxiosRequestConfig } from "axios";
import {
  MessageReadMode,
  MessageStatus,
  type MessageResponseDto,
  type ProposalResponseDto,
  type ReportDto,
} from "../../../api";
import { platformClient, projectsClient } from "../../../clients/serviceClients";
import {
  ConversationMessagesNotFoundError,
  conversationMessagesQueryOptions,
  getDeltaFetchCursorId,
  messageKeys,
} from "../messages";
import { resetConversationMessageHistoryStateForTests } from "../conversationMessageHistoryState";

vi.mock("../../../clients/serviceClients", () => ({
  platformClient: {
    getMessages: vi.fn(),
    getMessage: vi.fn(),
  },
  projectsClient: {
    getQueuedConversationInputs: vi.fn(async () => ({ data: { data: [] } })),
  },
}));

const buildMessage = (
  overrides: Partial<MessageResponseDto> = {}
): MessageResponseDto => ({
  id: "msg-1",
  conversationId: "conv-1",
  type: "SYSTEM",
  content: "Latest seeded response",
  createdAt: "2026-03-07T10:00:00.000Z",
  status: MessageStatus.Completed,
  ...overrides,
});

describe("getDeltaFetchCursorId", () => {
  it("returns null when no list is cached", () => {
    expect(getDeltaFetchCursorId(undefined)).toBeNull();
    expect(getDeltaFetchCursorId([])).toBeNull();
  });

  it("backs up one terminal message (overlap) when every cached message is terminal", () => {
    const cached = [
      buildMessage({
        id: "msg-a",
        createdAt: "2026-03-07T10:00:00.000Z",
        status: MessageStatus.Completed,
      }),
      buildMessage({
        id: "msg-b",
        createdAt: "2026-03-07T10:05:00.000Z",
        status: MessageStatus.Failed,
      }),
    ];

    // since=msg-a (exclusive) re-fetches msg-b, the boundary message — so a
    // late server-side edit to the most recent terminal message is observed.
    expect(
getDeltaFetchCursorId(cached)
    ).toBe("msg-a");
  });

  it("never anchors the cursor on an undated queued input", () => {
    const cached = [
      buildMessage({
        id: "msg-a",
        createdAt: "2026-03-07T10:00:00.000Z",
        status: MessageStatus.Completed,
      }),
      buildMessage({
        id: "msg-b",
        createdAt: "2026-03-07T10:05:00.000Z",
        status: MessageStatus.Completed,
      }),
      // Undated and terminal-status: must not be treated as the newest row.
      {
        ...buildMessage({ id: "queued", status: MessageStatus.Completed }),
        executionStatus: "queued",
        createdAt: null,
      } as never,
    ];

    expect(
getDeltaFetchCursorId(cached)
    ).toBe("msg-a");
  });

  it("backs the cursor up one terminal message below the oldest non-terminal", () => {
    const cached = [
      buildMessage({
        id: "msg-a",
        createdAt: "2026-03-07T10:00:00.000Z",
        status: MessageStatus.Completed,
      }),
      buildMessage({
        id: "msg-b",
        createdAt: "2026-03-07T10:05:00.000Z",
        status: MessageStatus.Completed,
      }),
      buildMessage({
        id: "msg-c",
        createdAt: "2026-03-07T10:10:00.000Z",
        status: MessageStatus.SystemProcessing,
      }),
      buildMessage({
        id: "msg-d",
        createdAt: "2026-03-07T10:15:00.000Z",
        status: MessageStatus.Completed,
      }),
    ];

    // since=msg-a returns msg-b (the overlap/boundary terminal), msg-c (with
    // current status) and msg-d — so both msg-c's transitions and a late edit
    // to msg-b are observed without a side-channel single-message refetch.
    expect(
getDeltaFetchCursorId(cached)
    ).toBe("msg-a");
  });

  it("returns null (full fetch) when only one eligible terminal message exists to anchor on", () => {
    const cached = [
      buildMessage({
        id: "msg-a",
        createdAt: "2026-03-07T10:00:00.000Z",
        status: MessageStatus.Completed,
      }),
      buildMessage({
        id: "msg-b",
        createdAt: "2026-03-07T10:05:00.000Z",
        status: MessageStatus.SystemProcessing,
      }),
    ];

    // Only msg-a is terminal below the non-terminal boundary; backing up one
    // leaves no anchor, so we fall back to a full fetch rather than cursoring
    // exactly on msg-a.
    expect(
getDeltaFetchCursorId(cached)
    ).toBeNull();
  });

  it("returns null when the oldest cached message is non-terminal (no terminal anchor available)", () => {
    const cached = [
      buildMessage({
        id: "msg-a",
        createdAt: "2026-03-07T10:00:00.000Z",
        status: MessageStatus.SystemProcessing,
      }),
      buildMessage({
        id: "msg-b",
        createdAt: "2026-03-07T10:05:00.000Z",
        status: MessageStatus.Completed,
      }),
    ];

    expect(
getDeltaFetchCursorId(cached)
    ).toBeNull();
  });
});

const okMessagesResponse = (messages: MessageResponseDto[]) => ({
  data: { data: messages, success: true, message: "ok", timestamp: "now" },
  status: 200,
  statusText: "OK",
  headers: {},
  config: {} as InternalAxiosRequestConfig,
});

const okHistoryResponse = (messages: MessageResponseDto[]) => ({
  data: {
    data: { messages },
    success: true,
    message: "ok",
    timestamp: "now",
  },
  status: 200,
  statusText: "OK",
  headers: {},
  config: {} as InternalAxiosRequestConfig,
});

let queryClient: QueryClient;

const seedConversationMessages = (
  organizationId: string,
  projectId: string,
  conversationId: string,
  messages: MessageResponseDto[]
) => {
  queryClient.setQueryData(
    messageKeys.list(organizationId, projectId, conversationId),
    messages
  );
};

const readConversationMessages = (
  organizationId: string,
  projectId: string,
  conversationId: string
) =>
  queryClient.fetchQuery({
    ...conversationMessagesQueryOptions(
      queryClient,
      organizationId,
      projectId,
      conversationId
    ),
    staleTime: 0,
  });

const readCachedMessages = (
  organizationId: string,
  projectId: string,
  conversationId: string
) =>
  queryClient.getQueryData<MessageResponseDto[]>(
    messageKeys.list(organizationId, projectId, conversationId)
  );

const readCachedMessageIds = (
  organizationId: string,
  projectId: string,
  conversationId: string
): string[] | undefined =>
  readCachedMessages(organizationId, projectId, conversationId)?.map(
    (message) => message.id
  );

const requestOptions = expect.objectContaining({
  signal: expect.any(AbortSignal),
});

describe("conversation messages list read", () => {
  const getMessagesMock = platformClient.getMessages as MockedFunction<
    typeof platformClient.getMessages
  >;
  const getMessageMock = platformClient.getMessage as MockedFunction<
    typeof platformClient.getMessage
  >;

  beforeEach(() => {
    vi.resetAllMocks();
    vi.mocked(projectsClient.getQueuedConversationInputs).mockResolvedValue({
      data: { data: [] },
    } as never);
    resetConversationMessageHistoryStateForTests();
    queryClient = new QueryClient({
      defaultOptions: { queries: { retryDelay: 0 } },
    });
  });

  it("issues a bounded recent-history fetch when the cache is empty", async () => {
    const fresh = [
      buildMessage({ id: "msg-1", createdAt: "2026-04-01T10:00:00.000Z" }),
      buildMessage({ id: "msg-2", createdAt: "2026-04-01T10:05:00.000Z" }),
    ];
    getMessagesMock.mockResolvedValueOnce(okHistoryResponse(fresh));

    await readConversationMessages("org-1", "proj-1", "conv-1");

    expect(projectsClient.getQueuedConversationInputs).toHaveBeenCalledWith(
      { organizationId: "org-1", projectId: "proj-1", conversationId: "conv-1" },
      requestOptions
    );
    expect(getMessagesMock).toHaveBeenCalledTimes(1);
    expect(getMessagesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "proj-1",
        conversationId: "conv-1",
        mode: MessageReadMode.ReverseHistory,
        limit: 8,
        includeProposals: true,
        includeReports: true,
      }),
      requestOptions
    );
    expect(readCachedMessageIds("org-1", "proj-1", "conv-1")).toEqual([
      "msg-1",
      "msg-2",
    ]);
  });

  it("issues since=<terminal before latest> (one-message overlap) and merges the delta", async () => {
    seedConversationMessages(
      "org-1",
      "proj-1",
      "conv-1",
      [
        buildMessage({ id: "msg-1", createdAt: "2026-04-01T10:00:00.000Z" }),
        buildMessage({ id: "msg-2", createdAt: "2026-04-01T10:05:00.000Z" }),
      ]
    );

    const delta = [
      buildMessage({ id: "msg-3", createdAt: "2026-04-01T10:10:00.000Z" }),
      buildMessage({ id: "msg-4", createdAt: "2026-04-01T10:15:00.000Z" }),
    ];
    getMessagesMock.mockResolvedValueOnce(okMessagesResponse(delta));

    await readConversationMessages("org-1", "proj-1", "conv-1");

    expect(getMessagesMock).toHaveBeenCalledTimes(1);
    // since=msg-1 (not msg-2): the overlap re-pulls msg-2 so a late edit to the
    // most recent terminal message is observed.
    expect(getMessagesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "proj-1",
        conversationId: "conv-1",
        since: "msg-1",
        includeProposals: true,
        includeReports: true,
      }),
      requestOptions
    );
    expect(readCachedMessageIds("org-1", "proj-1", "conv-1")).toEqual([
      "msg-1",
      "msg-2",
      "msg-3",
      "msg-4",
    ]);
  });

  it("merges one fully associated final message without duplicating its artifacts", async () => {
    const cachedMessages = [
      buildMessage({ id: "msg-1", createdAt: "2026-04-01T10:00:00.000Z" }),
      buildMessage({ id: "msg-2", createdAt: "2026-04-01T10:05:00.000Z" }),
    ];
    seedConversationMessages(
      "org-1",
      "proj-1",
      "conv-1",
      cachedMessages
    );

    const proposals: ProposalResponseDto[] = [
      {
        id: "proposal-final-1",
        organizationId: "org-1",
        projectId: "proj-1",
        type: "SINGLE",
        action: "CREATE",
        status: "DRAFT",
        targetEntityId: "task-1",
        targetEntityType: "TASK",
        updates: {},
        requestorId: "user-1",
        requiredApprovals: 1,
        approvals: [],
        createdAt: "2026-04-01T10:10:00.000Z",
        updatedAt: "2026-04-01T10:10:00.000Z",
      },
      {
        id: "proposal-final-2",
        organizationId: "org-1",
        projectId: "proj-1",
        type: "SINGLE",
        action: "UPDATE",
        status: "DRAFT",
        targetEntityId: "task-2",
        targetEntityType: "TASK",
        updates: {},
        requestorId: "user-1",
        requiredApprovals: 1,
        approvals: [],
        createdAt: "2026-04-01T10:10:01.000Z",
        updatedAt: "2026-04-01T10:10:01.000Z",
      },
    ];
    const reports: ReportDto[] = [
      {
        id: "report-final-1",
        organizationId: "org-1",
        projectId: "proj-1",
        reportType: "SNAPSHOT",
        audience: "PROJECT_VISIBLE",
        title: "Final snapshot",
        payload: {
          reportType: "SNAPSHOT",
          summary: "The completed response is fully associated.",
        },
        version: 1,
        schemaVersion: 1,
        createdAt: "2026-04-01T10:10:00.000Z",
        expiresAt: "2026-04-02T10:10:00.000Z",
        entities: [],
      },
    ];
    const finalMessage = buildMessage({
      id: "final-message",
      createdAt: "2026-04-01T10:10:00.000Z",
      data: { type: "AGENT", response: "Completed response." },
      proposals,
      reports,
    });
    getMessagesMock.mockResolvedValueOnce(
      okMessagesResponse([cachedMessages[1]!, finalMessage])
    );

    await readConversationMessages("org-1", "proj-1", "conv-1");

    expect(getMessagesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        conversationId: "conv-1",
        since: "msg-1",
        includeProposals: true,
        includeReports: true,
      }),
      requestOptions
    );
    expect(readCachedMessageIds("org-1", "proj-1", "conv-1")).toEqual([
      "msg-1",
      "msg-2",
      "final-message",
    ]);

    const storedFinalMessage = readCachedMessages(
      "org-1",
      "proj-1",
      "conv-1"
    )?.find((message) => message.id === "final-message");
    expect(storedFinalMessage).toEqual(finalMessage);
    expect(storedFinalMessage?.proposals).toEqual(proposals);
    expect(storedFinalMessage?.reports).toEqual(reports);
  });

  it("upserts in-flight messages when the delta returns a status update", async () => {
    seedConversationMessages(
      "org-1",
      "proj-1",
      "conv-1",
      [
        buildMessage({
          id: "msg-0",
          createdAt: "2026-04-01T09:55:00.000Z",
          status: MessageStatus.Completed,
        }),
        buildMessage({
          id: "msg-1",
          createdAt: "2026-04-01T10:00:00.000Z",
          status: MessageStatus.Completed,
        }),
        buildMessage({
          id: "msg-2",
          createdAt: "2026-04-01T10:05:00.000Z",
          status: MessageStatus.SystemProcessing,
          content: "still processing",
        }),
      ]
    );

    getMessagesMock.mockResolvedValueOnce(
      okMessagesResponse([
        buildMessage({
          id: "msg-2",
          createdAt: "2026-04-01T10:05:00.000Z",
          status: MessageStatus.Completed,
          content: "now done",
        }),
      ])
    );

    await readConversationMessages("org-1", "proj-1", "conv-1");

    // since=msg-0: the one-message overlap backs the cursor up off msg-1 (the
    // most recent terminal) so the delta still covers the in-flight msg-2.
    expect(getMessagesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "proj-1",
        conversationId: "conv-1",
        since: "msg-0",
        includeProposals: true,
        includeReports: true,
      }),
      requestOptions
    );

    const updatedMsg2 = readCachedMessages("org-1", "proj-1", "conv-1")?.find(
      (message) => message.id === "msg-2"
    );
    expect(updatedMsg2?.status).toBe(MessageStatus.Completed);
    expect(updatedMsg2?.content).toBe("now done");
  });

  it("merges recent recovery when the oldest cached message is still non-terminal", async () => {
    seedConversationMessages(
      "org-1",
      "proj-1",
      "conv-1",
      [
        buildMessage({
          id: "msg-1",
          createdAt: "2026-04-01T10:00:00.000Z",
          status: MessageStatus.SystemProcessing,
          content: "anchor still processing",
        }),
        buildMessage({
          id: "msg-2",
          createdAt: "2026-04-01T10:05:00.000Z",
          status: MessageStatus.Completed,
        }),
        buildMessage({
          id: "msg-3",
          createdAt: "2026-04-01T10:10:00.000Z",
          status: MessageStatus.Completed,
        }),
      ]
    );

    getMessagesMock.mockResolvedValueOnce(
      okHistoryResponse([
        buildMessage({
          id: "msg-1",
          createdAt: "2026-04-01T10:00:00.000Z",
          status: MessageStatus.Completed,
          content: "anchor done",
        }),
        buildMessage({
          id: "msg-2",
          createdAt: "2026-04-01T10:05:00.000Z",
          status: MessageStatus.Completed,
        }),
        buildMessage({
          id: "msg-3",
          createdAt: "2026-04-01T10:10:00.000Z",
          status: MessageStatus.Completed,
        }),
      ])
    );

    await readConversationMessages("org-1", "proj-1", "conv-1");

    // No since= cursor: recover the recent page without replacing history.
    expect(getMessagesMock).toHaveBeenCalledTimes(1);
    expect(getMessagesMock).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "proj-1",
        conversationId: "conv-1",
        mode: MessageReadMode.ReverseHistory,
        limit: 8,
        includeProposals: true,
        includeReports: true,
      }),
      requestOptions
    );
    expect(getMessageMock).not.toHaveBeenCalled();

    const updatedAnchor = readCachedMessages("org-1", "proj-1", "conv-1")?.find(
      (message) => message.id === "msg-1"
    );
    expect(updatedAnchor?.status).toBe(MessageStatus.Completed);
    expect(updatedAnchor?.content).toBe("anchor done");
  });

  it("recovers from a 404 on the since= delta with a merged recent page", async () => {
    seedConversationMessages(
      "org-1",
      "proj-1",
      "conv-1",
      [
        buildMessage({ id: "msg-1", createdAt: "2026-04-01T10:00:00.000Z" }),
        buildMessage({ id: "msg-2", createdAt: "2026-04-01T10:05:00.000Z" }),
      ]
    );

    const cursorInvalid = Object.assign(new Error("Not Found"), {
      isAxiosError: true,
      response: { status: 404, data: {} },
      toJSON: () => ({}),
    });
    const fresh = [
      buildMessage({ id: "msg-9", createdAt: "2026-04-01T10:30:00.000Z" }),
    ];
    getMessagesMock
      .mockRejectedValueOnce(cursorInvalid)
      .mockResolvedValueOnce(okHistoryResponse(fresh));

    await readConversationMessages("org-1", "proj-1", "conv-1");

    expect(getMessagesMock).toHaveBeenCalledTimes(2);
    // since=msg-1 (one-message overlap backs the cursor off msg-2).
    expect(getMessagesMock).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "proj-1",
        conversationId: "conv-1",
        since: "msg-1",
        includeProposals: true,
        includeReports: true,
      }),
      requestOptions
    );
    expect(getMessagesMock).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        organizationId: "org-1",
        projectId: "proj-1",
        conversationId: "conv-1",
        mode: MessageReadMode.ReverseHistory,
        limit: 8,
        includeProposals: true,
        includeReports: true,
      }),
      requestOptions
    );
    expect(readCachedMessageIds("org-1", "proj-1", "conv-1")).toEqual([
      "msg-1",
      "msg-2",
      "msg-9",
    ]);
  });

  it("surfaces ConversationMessagesNotFoundError when the conversation itself is gone", async () => {
    const notFound = Object.assign(new Error("Not Found"), {
      isAxiosError: true,
      response: { status: 404, data: {} },
      toJSON: () => ({}),
    });
    getMessagesMock.mockRejectedValueOnce(notFound);

    const error = await readConversationMessages(
      "org-1",
      "proj-1",
      "conv-1"
    ).catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(ConversationMessagesNotFoundError);
    expect(error).toMatchObject({ status: 404 });
    // A 404 is the server's answer for this key; it is not retried.
    expect(getMessagesMock).toHaveBeenCalledTimes(1);
  });
});
