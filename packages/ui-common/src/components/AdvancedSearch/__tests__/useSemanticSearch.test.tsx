import { act, renderHook, waitFor } from "@testing-library/react";
import { vi, describe, it, expect, beforeEach, afterEach } from "vitest";
import { useSemanticSearch } from "../hooks/useSemanticSearch";
import { createTestQueryClient } from "./testUtils";
import { QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import * as serviceClients from "../../../clients/serviceClients";
import type { SearchFilterState } from "../types";
import {
  EntityType,
  UnifiedEmbeddingsSearchOptionsQueryModeEnum,
  UnifiedSearchIntent,
} from "../../../api";

// Mock the service clients
vi.mock("../../../clients/serviceClients", () => ({
  unifiedApiClient: {
    semanticSearch: vi.fn(),
    unifiedSearch: vi.fn(),
  },
}));

// Helper to create a wrapper with QueryClient
function createWrapper() {
  const queryClient = createTestQueryClient();
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    );
  };
}

// Helper to create mock unified search results
function createMockResults(count: number) {
  return Array.from({ length: count }, (_, i) => ({
    entityId: `entity-${i + 1}`,
    entityType:
      i % 3 === 0
        ? EntityType.Task
        : i % 3 === 1
        ? EntityType.Initiative
        : EntityType.DesignDoc,
    title: `Test Entity ${i + 1}`,
    status: "in_progress",
    score: 0.85 - i * 0.05,
    content: `Test entity ${i + 1} description`,
  }));
}

function createMockUnifiedResponse(results: unknown[]) {
  return {
    data: {
      data: {
        intent: UnifiedSearchIntent.Hybrid,
        query: "mock query",
        organizationId: "org-123",
        execution: { elapsedMs: 1 },
        results,
      },
    },
  };
}

describe("useSemanticSearch", () => {
  const mockOrganizationId = "org-123";
  const defaultFilters: SearchFilterState = {
    entityTypes: [],
    statuses: [],
    threshold: 0.15,
    boostRecent: false,
  };

  beforeEach(() => {
    vi.resetAllMocks();
    // Default: return empty results
    vi.mocked(serviceClients.unifiedApiClient.unifiedSearch).mockResolvedValue(
      createMockUnifiedResponse([]) as never
    );
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  const waitForDebounce = async (ms = 510) => {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, ms));
    });
  };

  describe("Empty query handling", () => {
    it("should return empty results when both queries are empty", () => {
      const { result } = renderHook(
        () => useSemanticSearch(mockOrganizationId, "", "", defaultFilters),
        {
          wrapper: createWrapper(),
        }
      );

      expect(result.current.results).toEqual([]);
      expect(result.current.isLoading).toBe(false);
      expect(result.current.error).toBeNull();
      expect(
        serviceClients.unifiedApiClient.unifiedSearch
      ).not.toHaveBeenCalled();
    });

    it("should return empty results when queries contain only whitespace", () => {
      const { result } = renderHook(
        () =>
          useSemanticSearch(mockOrganizationId, "   ", "  ", defaultFilters),
        {
          wrapper: createWrapper(),
        }
      );

      expect(result.current.results).toEqual([]);
      expect(result.current.isLoading).toBe(false);
      expect(
        serviceClients.unifiedApiClient.unifiedSearch
      ).not.toHaveBeenCalled();
    });
  });

  describe("Title-only search", () => {
    it("should call unifiedSearch with titleQuery and TitleFuzzy mode", async () => {
      vi.mocked(
        serviceClients.unifiedApiClient.unifiedSearch
      ).mockResolvedValue(
        createMockUnifiedResponse(createMockResults(3)) as never
      );

      const { result } = renderHook(
        () =>
          useSemanticSearch(
            mockOrganizationId,
            "test query",
            "",
            defaultFilters
          ),
        {
          wrapper: createWrapper(),
        }
      );

      await waitForDebounce();

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(
        serviceClients.unifiedApiClient.unifiedSearch
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: mockOrganizationId,
          unifiedSearchRequest: expect.objectContaining({
            intent: UnifiedSearchIntent.Hybrid,
            query: "test query",
            embeddings: expect.objectContaining({
              maxResults: 50,
              similarityThreshold: 0.15,
              queryMode: UnifiedEmbeddingsSearchOptionsQueryModeEnum.TitleFuzzy,
            }),
          }),
        })
      );

      expect(result.current.results).toHaveLength(3);
      expect(result.current.error).toBeNull();
    });
  });

  describe("Semantic-only search", () => {
    it("should call unifiedSearch with semanticQuery and Default mode", async () => {
      vi.mocked(
        serviceClients.unifiedApiClient.unifiedSearch
      ).mockResolvedValue(
        createMockUnifiedResponse(createMockResults(5)) as never
      );

      const { result } = renderHook(
        () =>
          useSemanticSearch(
            mockOrganizationId,
            "",
            "semantic search query",
            defaultFilters
          ),
        {
          wrapper: createWrapper(),
        }
      );

      await waitForDebounce();

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(
        serviceClients.unifiedApiClient.unifiedSearch
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: mockOrganizationId,
          unifiedSearchRequest: expect.objectContaining({
            intent: UnifiedSearchIntent.Hybrid,
            query: "semantic search query",
            embeddings: expect.objectContaining({
              maxResults: 50,
              similarityThreshold: 0.15,
              queryMode: UnifiedEmbeddingsSearchOptionsQueryModeEnum.Default,
            }),
          }),
        })
      );

      expect(result.current.results).toHaveLength(5);
    });
  });

  describe("Combined search", () => {
    it("should prefer semanticQuery when both queries are provided", async () => {
      vi.mocked(
        serviceClients.unifiedApiClient.unifiedSearch
      ).mockResolvedValue(
        createMockUnifiedResponse(createMockResults(2)) as never
      );

      const { result } = renderHook(
        () =>
          useSemanticSearch(
            mockOrganizationId,
            "title query",
            "semantic query",
            defaultFilters
          ),
        {
          wrapper: createWrapper(),
        }
      );

      await waitForDebounce();

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(
        serviceClients.unifiedApiClient.unifiedSearch
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: mockOrganizationId,
          unifiedSearchRequest: expect.objectContaining({
            query: "semantic query",
            embeddings: expect.objectContaining({
              queryMode: UnifiedEmbeddingsSearchOptionsQueryModeEnum.Default,
            }),
          }),
        })
      );
    });
  });

  describe("Filter parameters", () => {
    it("should pass filter parameters to the unified search request", async () => {
      vi.mocked(
        serviceClients.unifiedApiClient.unifiedSearch
      ).mockResolvedValue(
        createMockUnifiedResponse(createMockResults(1)) as never
      );

      const filters: SearchFilterState = {
        entityTypes: ["task", "initiative"],
        statuses: ["in_progress", "completed"],
        initiativeId: "init-123",
        parentTaskId: "task-456",
        threshold: 0.25,
        boostRecent: true,
      };

      const projectId = "proj-789";
      const options = {
        maxResults: 25,
      };

      const { result } = renderHook(
        () =>
          useSemanticSearch(
            mockOrganizationId,
            "test",
            "",
            filters,
            projectId,
            options
          ),
        {
          wrapper: createWrapper(),
        }
      );

      await waitForDebounce();

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(
        serviceClients.unifiedApiClient.unifiedSearch
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: mockOrganizationId,
          projectId: "proj-789",
          unifiedSearchRequest: expect.objectContaining({
            intent: UnifiedSearchIntent.Hybrid,
            query: "test",
            common: expect.objectContaining({
              statuses: ["in_progress", "completed"],
            }),
            embeddings: expect.objectContaining({
              maxResults: 25,
              similarityThreshold: 0.25,
              queryMode: UnifiedEmbeddingsSearchOptionsQueryModeEnum.TitleFuzzy,
            }),
            graph: expect.objectContaining({ size: 25 }),
          }),
        })
      );
    });

    it("should use default maxResults when not provided", async () => {
      vi.mocked(
        serviceClients.unifiedApiClient.unifiedSearch
      ).mockResolvedValue(
        createMockUnifiedResponse(createMockResults(1)) as never
      );

      const { result } = renderHook(
        () => useSemanticSearch(mockOrganizationId, "test", "", defaultFilters),
        {
          wrapper: createWrapper(),
        }
      );

      await waitForDebounce();

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(
        serviceClients.unifiedApiClient.unifiedSearch
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: expect.any(String),
          unifiedSearchRequest: expect.objectContaining({
            embeddings: expect.objectContaining({
              maxResults: 50,
            }),
          }),
        })
      );
    });
  });

  describe("Scoped entity search", () => {
    it("should use unified search with seeded entity ID when scope is provided", async () => {
      vi.mocked(
        serviceClients.unifiedApiClient.unifiedSearch
      ).mockResolvedValue({
        data: {
          data: {
            intent: UnifiedSearchIntent.Hybrid,
            query: "test scope query",
            organizationId: mockOrganizationId,
            projectId: "proj-123",
            execution: { elapsedMs: 1 },
            results: [
              {
                entityId: "task-1",
                entityType: EntityType.Task,
                title: "Scoped Task",
                status: "in_progress",
                score: 0.91,
              },
            ],
          },
        },
      } as never);

      const scopedEntity = {
        entityId: "initiative-123",
        entityType: EntityType.Initiative,
      } as const;

      const { result } = renderHook(
        () =>
          useSemanticSearch(
            mockOrganizationId,
            "test scope query",
            "",
            defaultFilters,
            "proj-123",
            undefined,
            scopedEntity
          ),
        {
          wrapper: createWrapper(),
        }
      );

      await waitForDebounce();

      await waitFor(() => {
        expect(
          serviceClients.unifiedApiClient.unifiedSearch
        ).toHaveBeenCalledTimes(1);
      });

      expect(
        serviceClients.unifiedApiClient.semanticSearch
      ).not.toHaveBeenCalled();
      expect(
        serviceClients.unifiedApiClient.unifiedSearch
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: mockOrganizationId,
          projectId: "proj-123",
          unifiedSearchRequest: expect.objectContaining({
            intent: UnifiedSearchIntent.Hybrid,
            query: "test scope query",
            graph: expect.objectContaining({
              seedEntityIds: ["initiative-123"],
              seedEntityIdsStrategy: "explicit",
            }),
          }),
        })
      );

      expect(result.current.results).toEqual([
        {
          id: "task-1",
          type: "task",
          name: "Scoped Task",
          description: undefined,
          status: "in_progress",
          similarity: 0.91,
        },
      ]);
    });
  });

  describe("Loading state management", () => {
    it("should set isLoading=true during API call and false after completion", async () => {
      const mockResponse = createMockUnifiedResponse(createMockResults(1));

      let resolveSearch: ((value: unknown) => void) | undefined;
      const searchPromise = new Promise((resolve) => {
        resolveSearch = resolve;
      });

      vi.mocked(serviceClients.unifiedApiClient.unifiedSearch).mockReturnValue(
        searchPromise as never
      );

      const { result } = renderHook(
        () => useSemanticSearch(mockOrganizationId, "test", "", defaultFilters),
        {
          wrapper: createWrapper(),
        }
      );

      // Initially not loading
      expect(result.current.isLoading).toBe(false);

      // Trigger search with debounce
      await waitForDebounce();

      // Should be loading now
      await waitFor(() => {
        expect(result.current.isLoading).toBe(true);
      });

      // Resolve the search
      resolveSearch?.(mockResponse);

      // Should finish loading
      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.results).toHaveLength(1);
    });
  });

  describe("Error handling", () => {
    it("should capture API errors and expose them via error state", async () => {
      const mockError = new Error("API request failed");

      vi.mocked(
        serviceClients.unifiedApiClient.unifiedSearch
      ).mockRejectedValue(mockError);

      const { result } = renderHook(
        () => useSemanticSearch(mockOrganizationId, "test", "", defaultFilters),
        {
          wrapper: createWrapper(),
        }
      );

      await waitForDebounce();

      await waitFor(() => {
        expect(result.current.error).toEqual(mockError);
      });

      expect(result.current.results).toEqual([]);
      expect(result.current.isLoading).toBe(false);
    });

    it("should ignore CanceledError from aborted requests", async () => {
      const cancelError = new Error("Request was canceled");
      cancelError.name = "CanceledError";

      vi.mocked(
        serviceClients.unifiedApiClient.unifiedSearch
      ).mockRejectedValue(cancelError);

      const { result } = renderHook(
        () => useSemanticSearch(mockOrganizationId, "test", "", defaultFilters),
        {
          wrapper: createWrapper(),
        }
      );

      await waitForDebounce();

      await waitFor(() => {
        expect(
          serviceClients.unifiedApiClient.unifiedSearch
        ).toHaveBeenCalledTimes(1);
      });

      // CanceledError should be ignored, not set as error state
      expect(result.current.error).toBeNull();
      expect(result.current.results).toEqual([]);
    });
  });

  describe("Debouncing", () => {
    it("should debounce API calls when queries change rapidly", async () => {
      vi.mocked(
        serviceClients.unifiedApiClient.unifiedSearch
      ).mockResolvedValue(
        createMockUnifiedResponse(createMockResults(1)) as never
      );

      const { rerender } = renderHook(
        ({ query }: { query: string }) =>
          useSemanticSearch(mockOrganizationId, query, "", defaultFilters),
        {
          wrapper: createWrapper(),
          initialProps: { query: "first" },
        }
      );

      // Change query multiple times quickly
      rerender({ query: "second" });
      await waitForDebounce(100);

      rerender({ query: "third" });
      await waitForDebounce(100);

      rerender({ query: "fourth" });
      await waitForDebounce(100);

      // At this point, no API calls should have been made yet
      expect(
        serviceClients.unifiedApiClient.unifiedSearch
      ).not.toHaveBeenCalled();

      // Complete the debounce period
      await waitForDebounce();

      await waitFor(() => {
        expect(
          serviceClients.unifiedApiClient.unifiedSearch
        ).toHaveBeenCalledTimes(1);
      });

      // Should only call with the final query
      expect(
        serviceClients.unifiedApiClient.unifiedSearch
      ).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: mockOrganizationId,
          unifiedSearchRequest: expect.objectContaining({
            query: "fourth",
            embeddings: expect.objectContaining({
              queryMode: UnifiedEmbeddingsSearchOptionsQueryModeEnum.TitleFuzzy,
            }),
          }),
        })
      );
    });

    it("should wait 300ms before executing search", async () => {
      vi.mocked(
        serviceClients.unifiedApiClient.unifiedSearch
      ).mockResolvedValue(
        createMockUnifiedResponse(createMockResults(1)) as never
      );

      renderHook(
        () => useSemanticSearch(mockOrganizationId, "test", "", defaultFilters),
        {
          wrapper: createWrapper(),
        }
      );

      // Should not call immediately
      expect(
        serviceClients.unifiedApiClient.unifiedSearch
      ).not.toHaveBeenCalled();

      // After a short delay, still not called
      await waitForDebounce(100);
      expect(
        serviceClients.unifiedApiClient.unifiedSearch
      ).not.toHaveBeenCalled();

      // After debounce window, should be called
      await waitForDebounce();
      await waitFor(() => {
        expect(
          serviceClients.unifiedApiClient.unifiedSearch
        ).toHaveBeenCalledTimes(1);
      });
    });
  });

  describe("Request cancellation", () => {
    it("should cancel previous requests when new ones are made", async () => {
      const mockResponse = createMockUnifiedResponse(createMockResults(1));

      vi.mocked(serviceClients.unifiedApiClient.unifiedSearch)
        .mockImplementationOnce((async () => {
          // Simulate slow first request
          await new Promise((resolve) => setTimeout(resolve, 1000));
          return mockResponse;
        }) as never)
        .mockImplementationOnce((async () => {
          return mockResponse;
        }) as never);

      const { rerender } = renderHook(
        ({ query }: { query: string }) =>
          useSemanticSearch(mockOrganizationId, query, "", defaultFilters),
        {
          wrapper: createWrapper(),
          initialProps: { query: "first query" },
        }
      );

      // Trigger first search
      await waitForDebounce();

      await waitFor(() => {
        expect(
          serviceClients.unifiedApiClient.unifiedSearch
        ).toHaveBeenCalledTimes(1);
      });

      // Change query and trigger second search
      rerender({ query: "second query" });
      await waitForDebounce();

      await waitFor(() => {
        expect(
          serviceClients.unifiedApiClient.unifiedSearch
        ).toHaveBeenCalledTimes(2);
      });

      // Second call should have been made with the new query
      expect(
        serviceClients.unifiedApiClient.unifiedSearch
      ).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          organizationId: mockOrganizationId,
          unifiedSearchRequest: expect.objectContaining({
            query: "second query",
          }),
        })
      );
    });
  });

  describe("Result transformation", () => {
    it("should transform unified search results to SearchEntity format", async () => {
      const mockUnifiedResults = [
        {
          entityId: "entity-1",
          entityType: EntityType.Task,
          title: "Complete feature X",
          status: "in_progress",
          score: 0.92,
          content: "This is a task description",
        },
        {
          entityId: "entity-2",
          entityType: EntityType.Initiative,
          title: "Strategic Initiative",
          status: "planned",
          score: 0.87,
          content: "This is an initiative description",
        },
      ];

      vi.mocked(
        serviceClients.unifiedApiClient.unifiedSearch
      ).mockResolvedValue(
        createMockUnifiedResponse(mockUnifiedResults) as never
      );

      const { result } = renderHook(
        () => useSemanticSearch(mockOrganizationId, "test", "", defaultFilters),
        {
          wrapper: createWrapper(),
        }
      );

      await waitForDebounce();

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.results).toEqual([
        {
          id: "entity-1",
          type: "task",
          name: "Complete feature X",
          description: "This is a task description",
          status: "in_progress",
          similarity: 0.92,
        },
        {
          id: "entity-2",
          type: "initiative",
          name: "Strategic Initiative",
          description: "This is an initiative description",
          status: "planned",
          similarity: 0.87,
        },
      ]);
    });

    it("should fall back to entityId as name when title is missing", async () => {
      const mockUnifiedResults = [
        {
          entityId: "entity-1",
          // no entityType
          // no title
          status: undefined,
          score: 0.75,
          content: "Entity without title",
        },
      ];

      vi.mocked(
        serviceClients.unifiedApiClient.unifiedSearch
      ).mockResolvedValue(
        createMockUnifiedResponse(mockUnifiedResults) as never
      );

      const { result } = renderHook(
        () => useSemanticSearch(mockOrganizationId, "test", "", defaultFilters),
        {
          wrapper: createWrapper(),
        }
      );

      await waitForDebounce();

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.results[0]).toEqual({
        id: "entity-1",
        type: "unknown",
        name: "entity-1",
        description: "Entity without title",
        status: undefined,
        similarity: 0.75,
      });
    });

    it("should prefer topologySummary over content as description", async () => {
      const mockUnifiedResults = [
        {
          entityId: "entity-1",
          entityType: EntityType.Task,
          title: "Task Title",
          topologySummary: "Topology summary text",
          content: "Regular content",
          score: 0.8,
        },
      ];

      vi.mocked(
        serviceClients.unifiedApiClient.unifiedSearch
      ).mockResolvedValue(
        createMockUnifiedResponse(mockUnifiedResults) as never
      );

      const { result } = renderHook(
        () => useSemanticSearch(mockOrganizationId, "test", "", defaultFilters),
        {
          wrapper: createWrapper(),
        }
      );

      await waitForDebounce();

      await waitFor(() => {
        expect(result.current.isLoading).toBe(false);
      });

      expect(result.current.results[0]).toEqual({
        id: "entity-1",
        type: "task",
        name: "Task Title",
        description: "Topology summary text",
        status: undefined,
        similarity: 0.8,
      });
    });
  });
});
