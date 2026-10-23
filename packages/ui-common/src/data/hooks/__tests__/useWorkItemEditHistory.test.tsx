import { vi, beforeEach, describe, it, expect } from "vitest";
import { renderHook, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ReactNode } from "react";
import { useWorkItemEditHistory } from "../useWorkItemEditHistory";
import type { EditHistoryEntryDto } from "../../../utils/textDiff";

// Mock the platform client to avoid real network calls
vi.mock("../../../clients/serviceClients", () => ({
  platformClient: {
    getInitiativeEditHistory: vi.fn(),
  },
}));

// Mock useWebsocketSubscriptions
vi.mock("../useWebsocketSubscriptions", () => ({
  useWebsocketSubscriptions: vi.fn(() => ({
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
  })),
}));

import { platformClient } from "../../../clients/serviceClients";

const mockGetInitiativeEditHistory = vi.mocked(
  platformClient.getInitiativeEditHistory
);

describe("useWorkItemEditHistory", () => {
  let queryClient: QueryClient;
  let wrapper: ({ children }: { children: ReactNode }) => JSX.Element;

  beforeEach(() => {
    queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, retryDelay: 0 } } });
    wrapper = ({ children }) => <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>;
    vi.clearAllMocks();
  });

  it("should initialize with empty state when disabled", () => {
    const { result } = renderHook(
      () =>
        useWorkItemEditHistory({
          entityType: "initiative",
          organizationId: "org-1",
          workItemId: "workitem-1",
          enabled: false,
        }),
      { wrapper }
    );

    expect(result.current.editHistory).toEqual([]);
    expect(result.current.isLoading).toBe(false);
  });

  it("should fetch edit history when enabled", async () => {
    const mockEditHistory: EditHistoryEntryDto[] = [
      {
        id: "edit-1",
        workItemId: "workitem-1",
        timestamp: "2024-01-01T10:00:00Z",
        section: "description",
        previousContent: "Old content",
        newContent: "New content",
        changeType: "edit",
      },
      {
        id: "edit-2",
        workItemId: "workitem-1",
        timestamp: "2024-01-01T11:00:00Z",
        section: "details",
        previousContent: "",
        newContent: "Added details",
        changeType: "add",
      },
    ];

    mockGetInitiativeEditHistory.mockResolvedValue({
      data: { data: { entries: mockEditHistory } },
    });

    const { result } = renderHook(
      () =>
        useWorkItemEditHistory({
          entityType: "initiative",
          organizationId: "org-1",
          workItemId: "workitem-1",
          enabled: true,
        }),
      { wrapper }
    );

    expect(result.current.isLoading).toBe(true);

    const expectedHistory = mockEditHistory.map((entry) => ({
      ...entry,
      updatedAt: new Date(entry.timestamp).toISOString(),
    }));

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.editHistory).toEqual(expectedHistory);
    });

    expect(mockGetInitiativeEditHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        initiativeId: "workitem-1",
      }), expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });

  it("should handle fetch errors gracefully", async () => {
    const fetchError = new Error("Failed to fetch edit history");
    mockGetInitiativeEditHistory.mockRejectedValue(Object.assign(fetchError, { status: 400 }));

    const { result } = renderHook(
      () =>
        useWorkItemEditHistory({
          entityType: "task",
          organizationId: "org-1",
          workItemId: "workitem-1",
          enabled: true,
        }),
      { wrapper }
    );

    expect(result.current.isLoading).toBe(true);

    await waitFor(() => {
      expect(result.current.isLoading).toBe(false);
      expect(result.current.editHistory).toEqual([]);
    });
  });

  it("should support both initiative and task entity types", async () => {
    const mockEditHistory: EditHistoryEntryDto[] = [
      {
        id: "edit-1",
        workItemId: "task-1",
        timestamp: "2024-01-01T10:00:00Z",
        section: "description",
        previousContent: "Old task description",
        newContent: "New task description",
        changeType: "edit",
      },
    ];

    mockGetInitiativeEditHistory.mockResolvedValue({
      data: { data: { entries: mockEditHistory } },
    });

    const { result } = renderHook(
      () =>
        useWorkItemEditHistory({
          entityType: "task",
          organizationId: "org-1",
          workItemId: "task-1",
          enabled: true,
        }),
      { wrapper }
    );

    const expectedHistory = mockEditHistory.map((entry) => ({
      ...entry,
      updatedAt: new Date(entry.timestamp).toISOString(),
      entityType: "task",
    }));

    await waitFor(() => {
      expect(result.current.editHistory).toEqual(expectedHistory);
    });

    expect(mockGetInitiativeEditHistory).toHaveBeenCalledWith(
      expect.objectContaining({
        organizationId: "org-1",
        initiativeId: "task-1",
      }), expect.objectContaining({ signal: expect.any(AbortSignal) })
    );
  });
});
