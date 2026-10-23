import { act, cleanup, renderHook } from "@testing-library/react";
import {
  AxiosError,
  AxiosHeaders,
  type InternalAxiosRequestConfig,
} from "axios";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import {
  MessageReadMode,
  MessageStatus,
  type MessageResponseDto,
} from "../../../api";
import { createBrowserApiRuntime } from "../../../clients/createApiRuntime";
import { registerRuntimeClients } from "../../../clients/serviceClients";
import { resetConversationMessageHistoryStateForTests } from "../../collections/conversationMessageHistoryState";
import * as initiatorContext from "../initiatorContext";
import { useConversationMessages } from "../../hooks/useConversationMessages";

const trace =
  "Error\n at View (http://localhost/src/components/ConversationView.tsx:42:7)";
const message: MessageResponseDto = {
  id: "message-one",
  conversationId: "conversation",
  type: "USER",
  content: "hello",
  createdAt: "2026-09-28T00:00:00Z",
  status: MessageStatus.Completed,
};
const latestMessage: MessageResponseDto = {
  ...message,
  id: "message-two",
  createdAt: "2026-09-28T00:01:00Z",
};

beforeEach(() => {
  vi.useFakeTimers();
  window.localStorage.setItem(
    initiatorContext.REQUEST_INITIATOR_TRACKING_STORAGE_KEY,
    "true"
  );
  // Only the browser stack is supplied; hooks, query cache, generated
  // clients, interceptor, and the Axios request adapter are the production path.
  vi.spyOn(initiatorContext, "captureInitiator").mockReturnValue(trace);
  resetConversationMessageHistoryStateForTests();
});
afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  window.localStorage.clear();
});

it("carries the render caller through queued reads, delta recovery, and a failed request", async () => {
  const runtime = createBrowserApiRuntime({ baseUrl: "https://example.test" });
  registerRuntimeClients(runtime.clients);
  const requests: InternalAxiosRequestConfig[] = [];
  const queuedRequests: InternalAxiosRequestConfig[] = [];
  let fail = false;
  let release: (() => void) | undefined;
  runtime.transport.axios.defaults.adapter = async (config) => {
    if (config.url?.includes("queued-inputs")) {
      queuedRequests.push(config);
      if (fail)
        throw new AxiosError("Network unavailable", "ERR_NETWORK", config);
      return {
        config,
        status: 200,
        statusText: "OK",
        headers: new AxiosHeaders(),
        data: { data: [] },
      };
    }
    requests.push(config);
    if (fail)
      throw new AxiosError("Network unavailable", "ERR_NETWORK", config);
    if (config.url?.includes("since=")) {
      throw new AxiosError(
        "Invalid cursor",
        "ERR_BAD_REQUEST",
        config,
        undefined,
        {
          config,
          data: {},
          status: 404,
          statusText: "Not Found",
          headers: new AxiosHeaders(),
        }
      );
    }
    if (requests.length === 1)
      await new Promise<void>((resolve) => {
        release = resolve;
      });
    return {
      config,
      status: 200,
      statusText: "OK",
      headers: new AxiosHeaders(),
      data: { data: { messages: [message, latestMessage], nextCursor: null } },
    };
  };
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(
    () => useConversationMessages("org", "project", "conversation"),
    { wrapper }
  );

  await act(async () => {
    await vi.advanceTimersByTimeAsync(50);
  });
  expect(result.current.isFetching).toBe(true);
  expect(requests).toHaveLength(1);
  await act(async () => {
    release?.();
    await vi.advanceTimersByTimeAsync(50);
  });
  expect(result.current.orderedData).toEqual([message, latestMessage]);
  expect(result.current.isFetching).toBe(false);

  await act(async () => {
    const read = result.current.refetch();
    await vi.advanceTimersByTimeAsync(50);
    await read;
  });
  expect(requests).toHaveLength(3);
  expect(requests[1].url).toContain("since=");
  expect(requests[2].url).toContain(`mode=${MessageReadMode.ReverseHistory}`);
  expect(requests.map((request) => request.params._from)).toEqual(
    Array(3).fill("src/components/ConversationView.tsx:42:7")
  );

  fail = true;
  await act(async () => {
    const read = result.current.refetch().catch(() => undefined);
    await vi.advanceTimersByTimeAsync(50);
    await read;
  });
  expect(result.current.error?.message).toBe("Network unavailable");
  expect(result.current.isFetching).toBe(false);
  expect(queuedRequests.at(-1)?.params._from).toBe(
    "src/components/ConversationView.tsx:42:7"
  );
});
