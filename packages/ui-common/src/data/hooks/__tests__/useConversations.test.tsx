import { vi, type MockedFunction } from "vitest";
import { AxiosHeaders } from "axios";
import { act, cleanup, renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode } from "react";
import type { ConversationResponseDto } from "../../../api";
import { useConversations } from "../useConversations";
import { platformClient } from "../../../clients/serviceClients";
import {
  webSocketService,
  type SubscriptionConfig,
} from "../../../services/webSocketService";
import { conversationKeys } from "../../collections/conversations";

// Mock the dependencies
vi.mock("../../../clients/serviceClients", () => ({
  platformClient: {
    getActiveConversations: vi.fn(),
    getConversation: vi.fn(),
  },
}));

vi.mock("../../../services/webSocketService", () => ({
  webSocketService: {
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  },
}));

// Mock useWebsocketSubscriptions for unit tests
vi.mock("../useWebsocketSubscriptions", async () => {
  const React = await import("react");
  const { webSocketService } = await import(
    "../../../services/webSocketService"
  );

  return {
    useWebsocketSubscriptions: vi.fn(
      (config: SubscriptionConfig, options: { enabled: boolean }) => {
        const subscriptionRef = React.useRef<string | null>(null);

        const idDependencies: string[] = [];
        if (config.conversationIds) {
          idDependencies.push(...config.conversationIds);
        }
        if (config.projectIds) {
          idDependencies.push(...config.projectIds);
        }
        if (config.initiativeIds) {
          idDependencies.push(...config.initiativeIds);
        }
        idDependencies.sort();
        const dependencyKey = idDependencies.join(",");

        React.useEffect(() => {
          if (!options.enabled || dependencyKey.length === 0) {
            return;
          }

          const subscriptionId = webSocketService.subscribe(config);
          subscriptionRef.current = subscriptionId;

          return () => {
            if (subscriptionRef.current) {
              webSocketService.unsubscribe(subscriptionRef.current);
              subscriptionRef.current = null;
            }
          };
        }, [dependencyKey, options.enabled]);
      }
    ),
  };
});

const mockedPlatformClient = {
  getActiveConversations:
    platformClient.getActiveConversations as MockedFunction<
      typeof platformClient.getActiveConversations
    >,
};

const requestOptions = expect.objectContaining({
  signal: expect.any(AbortSignal),
});

const mockWebSocketSubscribe = webSocketService.subscribe as MockedFunction<
  typeof webSocketService.subscribe
>;
const mockWebSocketUnsubscribe = webSocketService.unsubscribe as MockedFunction<
  typeof webSocketService.unsubscribe
>;

describe("useConversations", () => {
  let queryClient: QueryClient;
  let wrapper: ({ children }: { children: ReactNode }) => JSX.Element;

  const mockConversations = [
    {
      id: "conv-123",
      projectId: "project-123",
      organizationId: "org-123",
      workflowName: "task-generation",
      status: "STARTED",
      createdAt: "2023-01-01T00:00:00Z",
      updatedAt: "2023-01-01T00:00:00Z",
    },
    {
      id: "conv-456",
      projectId: "project-123",
      organizationId: "org-123",
      workflowName: "initiative-refinement",
      status: "IN_PROGRESS",
      createdAt: "2023-01-02T00:00:00Z",
      updatedAt: "2023-01-02T00:00:00Z",
    },
  ] as ConversationResponseDto[];

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retryDelay: 0 } },
    });
    wrapper = ({ children }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
    vi.clearAllMocks();
    mockWebSocketSubscribe.mockReturnValue("subscription-123");
  });

  describe("app resume through the real query cache", () => {
    type Response = Awaited<
      ReturnType<typeof platformClient.getActiveConversations>
    >;
    function response(data: ConversationResponseDto[]): Response {
      return {
        data: {
          success: true,
          message: "OK",
          data: { data, total: data.length, page: 1, totalPages: 1, limit: 100 },
          timestamp: new Date().toISOString(),
          statusCode: 200,
          path: "/conversations",
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config: { headers: new AxiosHeaders() },
      };
    }
    function resume() {
      // TanStack's focus manager observes visibility on window.
      window.dispatchEvent(new Event("visibilitychange"));
      document.dispatchEvent(new Event("visibilitychange"));
      document.dispatchEvent(new Event("resume"));
      window.dispatchEvent(new Event("pageshow"));
    }
    async function tick() {
      await act(async () => {
        await vi.advanceTimersByTimeAsync(100);
      });
    }
    beforeEach(() => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-09-27T00:00:00Z"));
      vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
      mockedPlatformClient.getActiveConversations.mockReset();
      mockedPlatformClient.getActiveConversations.mockResolvedValue(
        response(mockConversations)
      );
    });
    afterEach(() => {
      cleanup();
      vi.useRealTimers();
      vi.restoreAllMocks();
    });
    it("refreshes without a realtime event, retaining data while pending and replacing it on success", async () => {
      const { result } = renderHook(
        () => useConversations("org-123", "project-123"),
        { wrapper }
      );
      await tick();
      expect(result.current.data).toEqual(mockConversations);
      const lastRead = Date.now();
      vi.setSystemTime(lastRead + 299_000);
      act(resume);
      await tick();
      expect(mockedPlatformClient.getActiveConversations).toHaveBeenCalledTimes(
        1
      );
      vi.setSystemTime(lastRead + 300_001);
      let complete!: (value: Response) => void;
      mockedPlatformClient.getActiveConversations.mockReturnValueOnce(
        new Promise<Response>((resolve) => {
          complete = resolve;
        })
      );
      act(resume);
      await tick();
      expect(result.current.isFetching).toBe(true);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.data).toEqual(mockConversations);
      expect(mockedPlatformClient.getActiveConversations).toHaveBeenCalledTimes(
        2
      );
      expect(
        mockedPlatformClient.getActiveConversations
      ).toHaveBeenLastCalledWith(
        expect.objectContaining({
          organizationId: "org-123",
          projectId: "project-123",
        }),
        requestOptions
      );
      act(resume);
      await tick();
      const updated = [
        {
          ...mockConversations[0],
          title: "Updated on the server",
          updatedAt: new Date().toISOString(),
        },
      ];
      await act(async () => {
        complete(response(updated));
      });
      await tick();
      expect(result.current.data).toEqual(updated);
      expect(result.current.isFetching).toBe(false);
      expect(result.current.error).toBeNull();
      expect(mockedPlatformClient.getActiveConversations).toHaveBeenCalledTimes(
        2
      );
    });
    it("exposes recovery failure and succeeds on a later resume", async () => {
      const { result } = renderHook(
        () => useConversations("org-123", "project-123"),
        { wrapper }
      );
      await tick();
      vi.setSystemTime(Date.now() + 300_001);
      const error = new Error("Connection unavailable");
      // A transient failure is retried; the error surfaces once retries settle.
      for (let attempt = 0; attempt < 4; attempt++)
        mockedPlatformClient.getActiveConversations.mockRejectedValueOnce(error);
      act(resume);
      await tick();
      expect(result.current.error).toEqual(error);
      expect(result.current.isReady).toBe(false);
      expect(result.current.isFetching).toBe(false);
      expect(result.current.data).toEqual(mockConversations);
      act(resume);
      await tick();
      expect(result.current.error).toBeNull();
      expect(result.current.isReady).toBe(true);
      expect(mockedPlatformClient.getActiveConversations).toHaveBeenCalledTimes(
        6
      );
    });
  });

  describe("data retrieval", () => {
    it("should fetch and return conversations data", async () => {
      mockedPlatformClient.getActiveConversations.mockResolvedValue({
        data: {
          success: true,
          message: "Conversations retrieved successfully",
          data: {
            data: mockConversations,
            total: mockConversations.length,
            page: 1,
            totalPages: 1,
            limit: 100,
          },
          timestamp: new Date().toISOString(),
          statusCode: 200,
          path: "/conversations",
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as unknown as {
          requiredFieldA: string;
          requiredFieldB: number;
        },
      });

      const { result } = renderHook(
        () => useConversations("org-123", "project-123"),
        { wrapper }
      );

      expect(result.current.isLoading).toBe(true);
      expect(result.current.data).toBe(null);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).toEqual(mockConversations);
      expect(
        queryClient.getQueryData(
          conversationKeys.list("org-123", "project-123", {})
        )
      ).toEqual(mockConversations);
    });

    it("should return null when no data is available", async () => {
      // Don't mock the API call to simulate no data state
      const { result } = renderHook(
        () => useConversations("org-123", "project-123"),
        { wrapper }
      );

      expect(result.current.data).toBeNull();
    });
  });

  describe("loading states", () => {
    it("should return isLoading true when fetching data", async () => {
      mockedPlatformClient.getActiveConversations.mockImplementation(
        () =>
          new Promise((resolve) => {
            setTimeout(() => {
              resolve({
                data: {
                  success: true,
                  message: "Conversations retrieved successfully",
                  data: {
                    data: mockConversations,
                    total: mockConversations.length,
                    page: 1,
                    totalPages: 1,
                    limit: 100,
                  },
                  timestamp: new Date().toISOString(),
                  statusCode: 200,
                  path: "/conversations",
                },
                status: 200,
                statusText: "OK",
                headers: {},
                config: {} as unknown as {
                  requiredFieldA: string;
                  requiredFieldB: number;
                },
              });
            }, 100);
          })
      );

      const { result } = renderHook(
        () => useConversations("org-123", "project-123"),
        { wrapper }
      );

      expect(result.current.isLoading).toBe(true);

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });
    });

    it("should return isLoading false when data is available", async () => {
      mockedPlatformClient.getActiveConversations.mockResolvedValue({
        data: {
          success: true,
          message: "Conversations retrieved successfully",
          data: {
            data: mockConversations,
            total: mockConversations.length,
            page: 1,
            totalPages: 1,
            limit: 100,
          },
          timestamp: new Date().toISOString(),
          statusCode: 200,
          path: "/conversations",
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as unknown as {
          requiredFieldA: string;
          requiredFieldB: number;
        },
      });

      const { result } = renderHook(
        () => useConversations("org-123", "project-123"),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.data).toEqual(mockConversations);
    });
  });

  describe("error handling", () => {
    it("should handle API errors", async () => {
      const testError = new Error("Test error");
      mockedPlatformClient.getActiveConversations.mockRejectedValue(testError);

      const { result } = renderHook(
        () => useConversations("org-123", "project-123", { enabled: true }),
        { wrapper }
      );

      expect(result.current.isLoading).toBe(true);

      await waitFor(
        () => {
          expect(result.current.isLoading).toBe(false);
        },
        { timeout: 1000 }
      );

      await waitFor(
        () => {
          expect(result.current.error).toEqual(testError);
        },
        { timeout: 1000 }
      );
    });

    it("should return null error when no error occurs", async () => {
      mockedPlatformClient.getActiveConversations.mockResolvedValue({
        data: {
          success: true,
          message: "Conversations retrieved successfully",
          data: {
            data: mockConversations,
            total: mockConversations.length,
            page: 1,
            totalPages: 1,
            limit: 100,
          },
          timestamp: new Date().toISOString(),
          statusCode: 200,
          path: "/conversations",
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as unknown as {
          requiredFieldA: string;
          requiredFieldB: number;
        },
      });

      const { result } = renderHook(
        () => useConversations("org-123", "project-123"),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.error).toBeNull();
      });
    });
  });

  describe("isFetched calculation", () => {
    it("should return isFetched true when data exists", async () => {
      mockedPlatformClient.getActiveConversations.mockResolvedValue({
        data: {
          success: true,
          message: "Conversations retrieved successfully",
          data: {
            data: mockConversations,
            total: mockConversations.length,
            page: 1,
            totalPages: 1,
            limit: 100,
          },
          timestamp: new Date().toISOString(),
          statusCode: 200,
          path: "/conversations",
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as unknown as {
          requiredFieldA: string;
          requiredFieldB: number;
        },
      });

      const { result } = renderHook(
        () => useConversations("org-123", "project-123"),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isFetched).toBe(true);
      });
    });

    it("should return isFetched true when error exists (attempted fetch)", async () => {
      const testError = new Error("Test error");
      mockedPlatformClient.getActiveConversations.mockRejectedValue(testError);

      const { result } = renderHook(
        () => useConversations("org-123", "project-123"),
        { wrapper }
      );

      await waitFor(() => {
        expect(result.current.isFetched).toBe(true);
      });
    });

    it("should return isFetched false when no data and no error", async () => {
      // Don't mock the API call to simulate no data state
      const { result } = renderHook(
        () => useConversations("org-123", "project-123"),
        { wrapper }
      );

      expect(result.current.isFetched).toBe(false);
    });
  });

  describe("WebSocket subscription", () => {
    it("should subscribe to WebSocket when data is loaded", async () => {
      mockedPlatformClient.getActiveConversations.mockResolvedValue({
        data: {
          success: true,
          message: "Conversations retrieved successfully",
          data: {
            data: mockConversations,
            total: mockConversations.length,
            page: 1,
            totalPages: 1,
            limit: 100,
          },
          timestamp: new Date().toISOString(),
          statusCode: 200,
          path: "/conversations",
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as unknown as {
          requiredFieldA: string;
          requiredFieldB: number;
        },
      });

      renderHook(() => useConversations("org-123", "project-123"), { wrapper });

      await waitFor(() => {
        expect(mockWebSocketSubscribe).toHaveBeenCalledWith({
          conversationIds: ["conv-123", "conv-456"],
        });
      });
    });

    it("should not subscribe when organizationId is missing", async () => {
      renderHook(() => useConversations(undefined, "project-123"), { wrapper });

      // Wait a short time to ensure no subscription occurs
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(mockWebSocketSubscribe).not.toHaveBeenCalled();
    });

    it("should not subscribe when projectId is missing", async () => {
      renderHook(() => useConversations("org-123", undefined), { wrapper });

      // Wait a short time to ensure no subscription occurs
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(mockWebSocketSubscribe).not.toHaveBeenCalled();
    });

    it("should unsubscribe on unmount", async () => {
      mockedPlatformClient.getActiveConversations.mockResolvedValue({
        data: {
          success: true,
          message: "Conversations retrieved successfully",
          data: {
            data: mockConversations,
            total: mockConversations.length,
            page: 1,
            totalPages: 1,
            limit: 100,
          },
          timestamp: new Date().toISOString(),
          statusCode: 200,
          path: "/conversations",
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as unknown as {
          requiredFieldA: string;
          requiredFieldB: number;
        },
      });

      const { unmount } = renderHook(
        () => useConversations("org-123", "project-123"),
        { wrapper }
      );

      await waitFor(() => {
        expect(mockWebSocketSubscribe).toHaveBeenCalled();
      });

      unmount();

      expect(mockWebSocketUnsubscribe).toHaveBeenCalledWith("subscription-123");
    });
  });

  describe("enabled option", () => {
    it("should not subscribe when enabled is false", async () => {
      renderHook(
        () => useConversations("org-123", "project-123", { enabled: false }),
        { wrapper }
      );

      // Wait a short time to ensure no subscription occurs
      await new Promise((resolve) => setTimeout(resolve, 100));
      expect(mockWebSocketSubscribe).not.toHaveBeenCalled();
      expect(
        mockedPlatformClient.getActiveConversations
      ).not.toHaveBeenCalled();
    });
  });

  describe("filtering options", () => {
    it("should pass workflowName filter to API call", async () => {
      mockedPlatformClient.getActiveConversations.mockResolvedValue({
        data: {
          success: true,
          message: "Conversations retrieved successfully",
          data: {
            data: mockConversations.filter(
              (c) => c.workflowName === "task-generation"
            ),
            total: 1,
            page: 1,
            totalPages: 1,
            limit: 100,
          },
          timestamp: new Date().toISOString(),
          statusCode: 200,
          path: "/conversations",
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as unknown as {
          requiredFieldA: string;
          requiredFieldB: number;
        },
      });

      renderHook(
        () =>
          useConversations("org-123", "project-123", {
            workflowName: "task-generation",
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(
          mockedPlatformClient.getActiveConversations
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            organizationId: "org-123",
            projectId: "project-123",
            page: 1,
            limit: 100,
            workflowName: "task-generation",
            includeSuggestionDecisions: undefined,
          }),
        requestOptions
        );
      });
    });

    it("should pass multiple workflowName filters to API call", async () => {
      mockedPlatformClient.getActiveConversations.mockResolvedValue({
        data: {
          success: true,
          message: "Conversations retrieved successfully",
          data: {
            data: mockConversations,
            total: 2,
            page: 1,
            totalPages: 1,
            limit: 100,
          },
          timestamp: new Date().toISOString(),
          statusCode: 200,
          path: "/conversations",
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as unknown as {
          requiredFieldA: string;
          requiredFieldB: number;
        },
      });

      renderHook(
        () =>
          useConversations("org-123", "project-123", {
            workflowName: ["task-generation", "initiative-refinement"],
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(
          mockedPlatformClient.getActiveConversations
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            organizationId: "org-123",
            projectId: "project-123",
            page: 1,
            limit: 100,
            workflowName: "task-generation,initiative-refinement",
            includeSuggestionDecisions: undefined,
          }),
        requestOptions
        );
      });
    });

    it("should pass search filter to API call", async () => {
      mockedPlatformClient.getActiveConversations.mockResolvedValue({
        data: {
          success: true,
          message: "Conversations retrieved successfully",
          data: {
            data: [],
            total: 0,
            page: 1,
            totalPages: 1,
            limit: 100,
          },
          timestamp: new Date().toISOString(),
          statusCode: 200,
          path: "/conversations",
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as unknown as {
          requiredFieldA: string;
          requiredFieldB: number;
        },
      });

      renderHook(
        () =>
          useConversations("org-123", "project-123", { search: "test search" }),
        { wrapper }
      );

      await waitFor(() => {
        expect(
          mockedPlatformClient.getActiveConversations
        ).toHaveBeenCalledWith(
          expect.objectContaining({
            organizationId: "org-123",
            projectId: "project-123",
            page: 1,
            limit: 100,
            search: "test search",
            includeSuggestionDecisions: undefined,
          }),
        requestOptions
        );
      });
    });

    it("should pass both workflowName and search filters to API call", async () => {
      mockedPlatformClient.getActiveConversations.mockResolvedValue({
        data: {
          success: true,
          message: "Conversations retrieved successfully",
          data: {
            data: [],
            total: 0,
            page: 1,
            totalPages: 1,
            limit: 100,
          },
          timestamp: new Date().toISOString(),
          statusCode: 200,
          path: "/conversations",
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as unknown as {
          requiredFieldA: string;
          requiredFieldB: number;
        },
      });

      renderHook(
        () =>
          useConversations("org-123", "project-123", {
            workflowName: "task-generation",
            search: "test search",
          }),
        { wrapper }
      );

      await waitFor(() => {
        expect(
          mockedPlatformClient.getActiveConversations.mock.calls
        ).toContainEqual([
          expect.objectContaining({
            organizationId: "org-123",
            projectId: "project-123",
            page: 1,
            limit: 100,
            workflowName: "task-generation",
            search: "test search",
            includeSuggestionDecisions: undefined,
          }),
          requestOptions,
        ]);
      });
    });
  });

  describe("concurrent fetch deduplication", () => {
    it("should deduplicate concurrent fetches", async () => {
      let fetchCount = 0;

      // Track API calls
      mockedPlatformClient.getActiveConversations.mockImplementation(
        async () => {
          fetchCount++;
          await new Promise((resolve) => setTimeout(resolve, 100));
          return {
            data: {
              success: true,
              message: "Conversations retrieved successfully",
              data: {
                data: mockConversations,
                total: mockConversations.length,
                page: 1,
                totalPages: 1,
                limit: 100,
              },
              timestamp: new Date().toISOString(),
              statusCode: 200,
              path: "/conversations",
            },
            status: 200,
            statusText: "OK",
            headers: {},
            config: {} as unknown as {
              requiredFieldA: string;
              requiredFieldB: number;
            },
          };
        }
      );

      // Create multiple wrapper components to simulate concurrent hook usage
      const wrapper1 = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      );
      const wrapper2 = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      );
      const wrapper3 = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
      );

      // Render hooks concurrently - all with same parameters
      const { result: result1 } = renderHook(
        () => useConversations("org-123", "project-123"),
        { wrapper: wrapper1 }
      );
      const { result: result2 } = renderHook(
        () => useConversations("org-123", "project-123"),
        { wrapper: wrapper2 }
      );
      const { result: result3 } = renderHook(
        () => useConversations("org-123", "project-123"),
        { wrapper: wrapper3 }
      );

      // All should be loading
      expect(result1.current.isLoading).toBe(true);
      expect(result2.current.isLoading).toBe(true);
      expect(result3.current.isLoading).toBe(true);

      // Wait for all to complete
      await waitFor(() => {
        expect(result1.current.isLoading).toBe(false);
        expect(result2.current.isLoading).toBe(false);
        expect(result3.current.isLoading).toBe(false);
      });

      // Due to deduplication, only one actual API call should have been made
      // (all concurrent requests for the same query should share the same promise)
      expect(fetchCount).toBe(1);

      // All hooks should have the same data
      expect(result1.current.data).toEqual(mockConversations);
      expect(result2.current.data).toEqual(mockConversations);
      expect(result3.current.data).toEqual(mockConversations);
    });

    it("should allow separate fetches for different query parameters", async () => {
      let fetchCount = 0;

      mockedPlatformClient.getActiveConversations.mockImplementation(
        async () => {
          fetchCount++;
          await new Promise((resolve) => setTimeout(resolve, 50));
          return {
            data: {
              success: true,
              message: "Conversations retrieved successfully",
              data: {
                data: mockConversations,
                total: mockConversations.length,
                page: 1,
                totalPages: 1,
                limit: 100,
              },
              timestamp: new Date().toISOString(),
              statusCode: 200,
              path: "/conversations",
            },
            status: 200,
            statusText: "OK",
            headers: {},
            config: {} as unknown as {
              requiredFieldA: string;
              requiredFieldB: number;
            },
          };
        }
      );

      // Render hooks with different parameters
      const { result: result1 } = renderHook(
        () => useConversations("org-123", "project-123"),
        { wrapper }
      );
      const { result: result2 } = renderHook(
        () => useConversations("org-456", "project-456"),
        { wrapper }
      );

      // Wait for both to complete
      await waitFor(() => {
        expect(result1.current.isLoading).toBe(false);
        expect(result2.current.isLoading).toBe(false);
      });

      // Different queries should result in separate API calls
      expect(fetchCount).toBe(2);
    });
  });

  describe("list refetch integration", () => {
    it("should refetch and update existing conversations in list", async () => {
      // Initial conversations with original data
      const initialConversations = [
        {
          id: "conv-list-1",
          projectId: "project-123",
          organizationId: "org-123",
          workflowName: "task-generation",
          status: "STARTED", // Initial status
          createdAt: "2023-01-01T00:00:00Z",
          updatedAt: "2023-01-01T00:00:00Z",
        },
        {
          id: "conv-list-2",
          projectId: "project-123",
          organizationId: "org-123",
          workflowName: "task-generation",
          status: "STARTED", // Initial status
          createdAt: "2023-01-01T00:00:00Z",
          updatedAt: "2023-01-01T00:00:00Z",
        },
      ];

      // Updated conversations with changed data
      const updatedConversations = [
        {
          ...initialConversations[0],
          status: "COMPLETED", // Updated status
        },
        {
          ...initialConversations[1],
          status: "COMPLETED", // Updated status
        },
      ];

      // Mock initial API response
      mockedPlatformClient.getActiveConversations.mockResolvedValue({
        data: {
          success: true,
          message: "Conversations retrieved successfully",
          data: {
            data: initialConversations,
            total: 2,
            page: 1,
            totalPages: 1,
            limit: 100,
          },
          timestamp: new Date().toISOString(),
          statusCode: 200,
          path: "/conversations",
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as any,
      });

      const { result } = renderHook(
        () => useConversations("org-123", "project-123"),
        { wrapper }
      );

      // Wait for initial load
      await waitFor(() => {
        expect(result.current.data).toHaveLength(2);
        expect(result.current.data![0].status).toBe("STARTED");
        expect(result.current.data![1].status).toBe("STARTED");
      });

      // Update mock to return updated data
      mockedPlatformClient.getActiveConversations.mockResolvedValue({
        data: {
          success: true,
          message: "Conversations retrieved successfully",
          data: {
            data: updatedConversations,
            total: 2,
            page: 1,
            totalPages: 1,
            limit: 100,
          },
          timestamp: new Date().toISOString(),
          statusCode: 200,
          path: "/conversations",
        },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {} as any,
      });

      // Call refetch
      await waitFor(() => {
        expect(result.current.refetch).toBeDefined();
      });

      const callCountBefore =
        mockedPlatformClient.getActiveConversations.mock.calls.length;
      await result.current.refetch!();

      // Verify API was called again
      await waitFor(() => {
        expect(
          mockedPlatformClient.getActiveConversations.mock.calls.length
        ).toBeGreaterThan(callCountBefore);
      });

      // Verify data was updated - this should fail due to SET_ITEMS bug
      await waitFor(() => {
        expect(result.current.data).toHaveLength(2);
        expect(result.current.data![0].status).toBe("COMPLETED"); // Should show updated status
        expect(result.current.data![1].status).toBe("COMPLETED"); // Should show updated status
      });
    });
  });
});
