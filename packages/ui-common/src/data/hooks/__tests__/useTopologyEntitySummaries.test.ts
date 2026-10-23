import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { Provider } from "jotai";
import * as React from "react";
import type { ReactNode } from "react";
import { useTopologyEntitySummaries } from "../useTopologyEntitySummaries";
import type { TopologyEntitySummaryDto } from "../../../api";
import { platformClient } from "../../../clients/serviceClients";

// Mock the platform API client
vi.mock("../../../clients/serviceClients", () => ({
  platformClient: {
    listTopologyEntitySummaries: vi.fn(),
  },
}));

// Mock logger
vi.mock("../../../utils/logger", () => ({
  default: {
    info: vi.fn(),
    error: vi.fn(),
  },
}));

const createWrapper = ({ children }: { children: ReactNode }) =>
  React.createElement(Provider, null, children);

describe("useTopologyEntitySummaries hook", () => {
  const mockEntitySummaries: TopologyEntitySummaryDto[] = [
    {
      entityType: "TASK",
      entityId: "0b4990ee-86f7-4268-a9ab-f0b4986e3e16",
      summary:
        "PostgreSQL table stores service-specific implementation hints with service_id foreign key, feature_name, description, timestamp, source_type fields. Indexed on service_id and timestamp for query performance. Backend service layer exposes list, create, retrieve operations filtered by service. REST API endpoints enable hint storage and retrieval grouped by service. Supports persistent capture of feature patterns, architectural decisions, coding conventions per service for cross-session development consistency.",
      category: "technology",
      updatedAt: "2025-12-27T20:56:15.824Z",
      subfacets: [
        {
          id: "3ea4bc00-b666-4883-a747-8dc3d22df30a",
          name: "database schema",
          updatedAt: "2025-12-18T04:00:43.526Z",
        },
        {
          id: "f283c8f2-5d42-4bec-a821-16569fed595c",
          name: "service layer API",
          updatedAt: "2025-12-27T20:56:15.815Z",
        },
      ],
    },
    {
      entityType: "TASK",
      entityId: "81a00302-1a23-4de1-be08-87b18e6a727e",
      summary:
        "Backend message service parses @mentions using ui-common parser, extracts entity_id and entity_type from message text. Creates message_mention table with composite index on (message_id, entity_id) for efficient queries. Transactional insertion validates entity references, notifies RAG indexing pipelines of new mention records. Enables relationship discovery between messages and referenced entities across conversation contexts.",
      category: "technology",
      updatedAt: "2025-12-18T04:22:00.772Z",
      subfacets: [
        {
          id: "3ea4bc00-b666-4883-a747-8dc3d22df30a",
          name: "database schema",
          updatedAt: "2025-12-18T04:00:43.526Z",
        },
        {
          id: "e3500b0d-75c5-4f3d-ad70-6440318e85c6",
          name: "observability and monitoring",
          updatedAt: "2025-12-18T04:22:00.756Z",
        },
      ],
    },
  ];

  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("basic functionality", () => {
    it("should return initial state correctly", () => {
      const { result } = renderHook(
        () => useTopologyEntitySummaries("org-123", "project-456"),
        { wrapper: createWrapper }
      );

      expect(result.current.summaries).toEqual([]);
      expect(result.current.isLoading).toBe(true);
      expect(result.current.isFetched).toBe(false);
      expect(result.current.error).toBeNull();
    });

    it("should fetch entity summaries successfully", async () => {
      const mockResponse = {
        data: { data: mockEntitySummaries },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {},
      };
      vi.mocked(platformClient.listTopologyEntitySummaries).mockResolvedValue(
        mockResponse as never
      );

      const { result } = renderHook(
        () => useTopologyEntitySummaries("org-123", "project-456"),
        { wrapper: createWrapper }
      );

      await waitFor(() => {
        expect(result.current.summaries).toEqual(mockEntitySummaries);
      });

      expect(result.current.isLoading).toBe(false);
      expect(result.current.isFetched).toBe(true);
      expect(result.current.error).toBeNull();
    });

    it("should return two distinct entities with different IDs", async () => {
      const mockResponse = {
        data: { data: mockEntitySummaries },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {},
      };
      vi.mocked(platformClient.listTopologyEntitySummaries).mockResolvedValue(
        mockResponse as never
      );

      const { result } = renderHook(
        () => useTopologyEntitySummaries("org-123", "project-456"),
        { wrapper: createWrapper }
      );

      await waitFor(() => {
        expect(result.current.summaries).toHaveLength(2);
      });

      // Verify we get 2 distinct entities
      expect(result.current.summaries).toHaveLength(2);

      // Verify the IDs are different
      const entityIds = result.current.summaries.map((s) => s.entityId);
      expect(entityIds).toEqual([
        "0b4990ee-86f7-4268-a9ab-f0b4986e3e16",
        "81a00302-1a23-4de1-be08-87b18e6a727e",
      ]);

      // Verify no duplicates
      const uniqueIds = new Set(entityIds);
      expect(uniqueIds.size).toBe(2);

      // Verify the actual data
      expect(result.current.summaries[0].entityId).toBe(
        "0b4990ee-86f7-4268-a9ab-f0b4986e3e16"
      );
      expect(result.current.summaries[0].entityType).toBe("TASK");
      expect(result.current.summaries[1].entityId).toBe(
        "81a00302-1a23-4de1-be08-87b18e6a727e"
      );
      expect(result.current.summaries[1].entityType).toBe("TASK");
    });

    it("should handle API errors", async () => {
      const mockError = new Error("API Error");
      vi.mocked(platformClient.listTopologyEntitySummaries).mockRejectedValue(
        mockError
      );

      const { result } = renderHook(
        () => useTopologyEntitySummaries("org-123", "project-456"),
        { wrapper: createWrapper }
      );

      await waitFor(() => {
        expect(result.current.error).toEqual(mockError);
      });

      expect(result.current.summaries).toEqual([]);
      expect(result.current.isLoading).toBe(false);
    });
  });

  describe("filtering", () => {
    it("should filter by subfacetId", async () => {
      const mockResponse = {
        data: { data: mockEntitySummaries },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {},
      };
      vi.mocked(platformClient.listTopologyEntitySummaries).mockResolvedValue(
        mockResponse as never
      );

      const { result } = renderHook(
        () =>
          useTopologyEntitySummaries("org-123", "project-456", {
            subfacetId: ["3ea4bc00-b666-4883-a747-8dc3d22df30a"],
          }),
        { wrapper: createWrapper }
      );

      await waitFor(() => {
        expect(result.current.isFetched).toBe(true);
      });

      expect(platformClient.listTopologyEntitySummaries).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org-123",
          projectId: "project-456",
          subfacetId: ["3ea4bc00-b666-4883-a747-8dc3d22df30a"],
        }),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });

    it("should filter by category", async () => {
      const mockResponse = {
        data: { data: mockEntitySummaries },
        status: 200,
        statusText: "OK",
        headers: {},
        config: {},
      };
      vi.mocked(platformClient.listTopologyEntitySummaries).mockResolvedValue(
        mockResponse as never
      );

      const { result } = renderHook(
        () =>
          useTopologyEntitySummaries("org-123", "project-456", {
            category: "technology",
          }),
        { wrapper: createWrapper }
      );

      await waitFor(() => {
        expect(result.current.isFetched).toBe(true);
      });

      expect(platformClient.listTopologyEntitySummaries).toHaveBeenCalledWith(
        expect.objectContaining({
          organizationId: "org-123",
          projectId: "project-456",
          category: "technology",
        }),
        expect.objectContaining({ signal: expect.any(AbortSignal) })
      );
    });
  });

  describe("conditional fetching", () => {
    it("should not fetch when organizationId is undefined", () => {
      const { result } = renderHook(
        () => useTopologyEntitySummaries(undefined, "project-456"),
        { wrapper: createWrapper }
      );

      expect(result.current.summaries).toEqual([]);
      expect(result.current.isLoading).toBe(false);
      expect(platformClient.listTopologyEntitySummaries).not.toHaveBeenCalled();
    });

    it("should not fetch when projectId is undefined", () => {
      const { result } = renderHook(
        () => useTopologyEntitySummaries("org-123", undefined),
        { wrapper: createWrapper }
      );

      expect(result.current.summaries).toEqual([]);
      expect(result.current.isLoading).toBe(false);
      expect(platformClient.listTopologyEntitySummaries).not.toHaveBeenCalled();
    });

    it("should not fetch when enabled is false", () => {
      const { result } = renderHook(
        () =>
          useTopologyEntitySummaries("org-123", "project-456", {
            enabled: false,
          }),
        { wrapper: createWrapper }
      );

      expect(result.current.summaries).toEqual([]);
      expect(result.current.isLoading).toBe(false);
      expect(platformClient.listTopologyEntitySummaries).not.toHaveBeenCalled();
    });
  });
});
