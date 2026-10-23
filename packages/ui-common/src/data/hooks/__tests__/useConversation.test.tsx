import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { describe, it, expect, vi, beforeEach, Mock } from "vitest";
import { useConversation } from "../useConversation";
import { platformClient } from "../../../clients/serviceClients";
import { conversationKeys } from "../../collections/conversations";

vi.mock("../../../clients/serviceClients", () => ({
  platformClient: {
    getConversation: vi.fn(),
  },
}));

// Mock useWebsocketSubscriptions for unit tests
vi.mock("../useWebsocketSubscriptions", () => ({
  useWebsocketSubscriptions: vi.fn(),
}));

import { useWebsocketSubscriptions } from "../useWebsocketSubscriptions";

const mockGetConversation = platformClient.getConversation as Mock;
const mockUseWebsocketSubscriptions = useWebsocketSubscriptions as Mock;

function createHarness() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  return { queryClient, wrapper };
}

const notFound = () =>
  Object.assign(new Error("Not Found"), {
    isAxiosError: true,
    response: { status: 404, data: {} },
  });

describe("useConversation", () => {
  const mockConversation = {
    id: "conv-123",
    projectId: "project-123",
    organizationId: "org-123",
    category: "task_generation",
    status: "STARTED",
    createdAt: "2023-01-01T00:00:00Z",
    updatedAt: "2023-01-01T00:00:00Z",
  };

  const renderConversation = (
    wrapper: ReturnType<typeof createHarness>["wrapper"],
    options: Parameters<typeof useConversation>[3] = {}
  ) =>
    renderHook(
      () =>
        useConversation(
          "org-123",
          "project-123",
          { conversationId: "conv-123" },
          options
        ),
      { wrapper }
    );

  beforeEach(() => {
    vi.clearAllMocks();
    mockGetConversation.mockResolvedValue({
      data: { data: mockConversation },
    });
  });

  describe("data retrieval", () => {
    it("uses the websocket subscription only to keep the conversation room observed", async () => {
      const { wrapper } = createHarness();
      const { result } = renderConversation(wrapper);

      await waitFor(() => expect(result.current.isReady).toBe(true));
      const subscription = mockUseWebsocketSubscriptions.mock.calls.at(-1)?.[0];
      expect(subscription).toEqual({ conversationIds: ["conv-123"] });
      // Subscribing does not cause any extra read.
      expect(mockGetConversation).toHaveBeenCalledTimes(1);
    });

    it("does not schedule recurring conversation refreshes", () => {
      vi.useFakeTimers();
      const setIntervalSpy = vi.spyOn(globalThis, "setInterval");
      const { wrapper } = createHarness();

      const { unmount } = renderConversation(wrapper);

      expect(setIntervalSpy).not.toHaveBeenCalled();
      unmount();
      setIntervalSpy.mockRestore();
      vi.useRealTimers();
    });

    it("should return conversation data from the read", async () => {
      const { wrapper, queryClient } = createHarness();
      const { result } = renderConversation(wrapper);

      await waitFor(() =>
        expect(result.current.data).toEqual(mockConversation)
      );
      expect(mockGetConversation).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org-123",
          projectId: "project-123",
          conversationId: "conv-123",
        }),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
      expect(
        queryClient.getQueryData(
          conversationKeys.envelope("org-123", "project-123", "conv-123")
        )
      ).toEqual(mockConversation);
    });

    it("serves a seeded envelope without a request", () => {
      const { wrapper, queryClient } = createHarness();
      queryClient.setQueryData(
        conversationKeys.envelope("org-123", "project-123", "conv-123"),
        mockConversation
      );

      const { result } = renderConversation(wrapper);

      expect(result.current.data).toEqual(mockConversation);
      expect(result.current.isReady).toBe(true);
      expect(mockGetConversation).not.toHaveBeenCalled();
    });

    it("reads the suggestion-decisions variant under its own key", async () => {
      const { wrapper, queryClient } = createHarness();
      queryClient.setQueryData(
        conversationKeys.envelope("org-123", "project-123", "conv-123"),
        mockConversation
      );

      const { result } = renderConversation(wrapper, {
        includeSuggestionDecisions: true,
      });

      await waitFor(() => expect(result.current.isReady).toBe(true));
      expect(mockGetConversation).toHaveBeenCalledWith(
        expect.objectContaining({ includeSuggestionDecisions: true }),
        expect.anything()
      );
    });

    it("should return null data when disabled, without a request or an error", () => {
      const { wrapper } = createHarness();
      const { result } = renderConversation(wrapper, { enabled: false });

      expect(result.current.data).toBeNull();
      expect(result.current.error).toBeNull();
      expect(result.current.isReady).toBe(false);
      expect(mockGetConversation).not.toHaveBeenCalled();
    });
  });

  describe("loading states", () => {
    it("should return isLoading true while the read is pending", () => {
      mockGetConversation.mockReturnValue(new Promise(() => {}));
      const { wrapper } = createHarness();

      const { result } = renderConversation(wrapper);

      expect(result.current.isLoading).toBe(true);
      expect(result.current.data).toBeNull();
    });

    it("should return isLoading false once the read settles", async () => {
      const { wrapper } = createHarness();
      const { result } = renderConversation(wrapper);

      await waitFor(() => expect(result.current.isLoading).toBe(false));
      expect(result.current.data).toEqual(mockConversation);
    });
  });

  describe("error handling", () => {
    it("should return error after a failed read", async () => {
      const testError = notFound();
      mockGetConversation.mockRejectedValue(testError);
      const { wrapper } = createHarness();

      const { result } = renderConversation(wrapper);

      await waitFor(() => expect(result.current.error).toBe(testError));
      expect(result.current.isReady).toBe(false);
      // A 4xx is the server's answer; it is not retried.
      expect(mockGetConversation).toHaveBeenCalledTimes(1);
    });

    it("should return null error when no error", async () => {
      const { wrapper } = createHarness();
      const { result } = renderConversation(wrapper);

      expect(result.current.error).toBeNull();
      await waitFor(() => expect(result.current.isReady).toBe(true));
      expect(result.current.error).toBeNull();
    });
  });

  describe("isFetched calculation", () => {
    it("should return isFetched true when data exists", async () => {
      const { wrapper } = createHarness();
      const { result } = renderConversation(wrapper);

      await waitFor(() => {
        expect(result.current.isFetched).toBe(true);
      });
    });

    it("should return isFetched true when error exists (attempted fetch)", async () => {
      mockGetConversation.mockRejectedValue(notFound());
      const { wrapper } = createHarness();

      const { result } = renderConversation(wrapper);

      await waitFor(() => expect(result.current.isFetched).toBe(true));
      expect(result.current.error).not.toBeNull();
    });

    it("should return isFetched false when no data and no error", () => {
      mockGetConversation.mockReturnValue(new Promise(() => {}));
      const { wrapper } = createHarness();

      const { result } = renderConversation(wrapper);

      expect(result.current.isFetched).toBe(false);
      expect(result.current.error).toBeNull();
    });
  });
});
