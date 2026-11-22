import { describe, expect, it, vi } from "vitest";
import { MessageStatus, type MessageResponseDto } from "../../../api";
import { getDeltaFetchCursorId } from "../messages";

vi.mock("../../../clients/serviceClients", () => ({
  projectsClient: { getQueuedConversationInputs: vi.fn() },
}));

vi.mock("../../../utils/logger", () => ({
  default: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn(), debug: vi.fn() },
}));

const buildMessage = (
  overrides: Partial<MessageResponseDto> = {},
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
    expect(getDeltaFetchCursorId(cached)).toBe("msg-a");
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

    expect(getDeltaFetchCursorId(cached)).toBe("msg-a");
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
    expect(getDeltaFetchCursorId(cached)).toBe("msg-a");
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
    expect(getDeltaFetchCursorId(cached)).toBeNull();
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

    expect(getDeltaFetchCursorId(cached)).toBeNull();
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
  messages: MessageResponseDto[],
) => {
  queryClient.setQueryData(
    messageKeys.list(organizationId, projectId, conversationId),
    messages,
  );
};

const readConversationMessages = (
  organizationId: string,
  projectId: string,
  conversationId: string,
) =>
  queryClient.fetchQuery({
    ...conversationMessagesQueryOptions(
      queryClient,
      organizationId,
      projectId,
      conversationId,
    ),
    staleTime: 0,
  });

const readCachedMessages = (
  organizationId: string,
  projectId: string,
  conversationId: string,
) =>
  queryClient.getQueryData<MessageResponseDto[]>(
    messageKeys.list(organizationId, projectId, conversationId),
  );

const readCachedMessageIds = (
  organizationId: string,
  projectId: string,
  conversationId: string,
): string[] | undefined =>
  readCachedMessages(organizationId, projectId, conversationId)?.map(
    (message) => message.id,
  );

const requestOptions = expect.objectContaining({
  signal: expect.any(AbortSignal),
});
