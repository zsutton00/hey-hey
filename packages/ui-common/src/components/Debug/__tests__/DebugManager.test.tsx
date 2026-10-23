import React from "react";
import { screen } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  renderWithDebugProviders,
  resetDebugContextMock,
  updateDebugContextMock,
} from "./debugTestUtils";
import { DebugManager } from "../DebugManager";

// Mock the WebSocket debug hook
vi.mock("../../../data/websockets/debug", () => ({
  useWebSocketDebug: () => ({
    events: [],
    connectionState: {
      isConnected: false,
      isAuthenticated: false,
      connectionError: null,
    },
    statistics: {
      totalEvents: 0,
      eventsByType: {},
      averageEventProcessingTime: 0,
      errorsInLastHour: 0,
      lastReconnectTime: null,
    },
    collections: [],
    clearEventLog: vi.fn(),
    getFilteredEvents: vi.fn(() => []),
    exportDebugData: vi.fn(() => "mock-export"),
  }),
}));

// Mock the workflow status monitoring hook
vi.mock("../../../hooks/useWorkflowStatusMonitoring", () => ({
  useWorkflowStatusMonitoring: () => ({
    status: null,
    isLoading: false,
    error: null,
    lastUpdate: null,
    refresh: vi.fn(),
    fetchLogs: vi.fn(() => Promise.resolve([])),
  }),
}));

const originalNodeEnv = process.env.NODE_ENV;

beforeEach(() => {
  resetDebugContextMock();
});

afterEach(() => {
  vi.clearAllMocks();
  process.env.NODE_ENV = originalNodeEnv;
});

describe("DebugManager", () => {
  it("renders FAB when not visible in development mode", () => {
    process.env.NODE_ENV = "development";

    updateDebugContextMock({ debugPanelVisible: false });

    renderWithDebugProviders(
      <DebugManager enabled={true} initialVisible={false} />
    );

    expect(screen.getByLabelText(/toggle debug panel/i)).toBeInTheDocument();
  });

  it("does not render when disabled", () => {
    renderWithDebugProviders(<DebugManager enabled={false} />);

    expect(
      screen.queryByLabelText(/toggle debug panel/i)
    ).not.toBeInTheDocument();
  });

  it("renders unified debug panel with workflow ID", () => {
    updateDebugContextMock({ debugPanelVisible: true });

    renderWithDebugProviders(
      <DebugManager
        enabled={true}
        initialVisible={true}
        useUnifiedPanel={true}
        workflowId="test-workflow-id"
        organizationId="test-org-id"
        enabledTabs={["workflow", "websocket-events"]}
      />
    );

    // Should show the unified debug panel
    expect(screen.getByText(/debug panel/i)).toBeInTheDocument();
  });

  it("falls back to legacy WebSocket debug when unified panel is disabled", () => {
    updateDebugContextMock({ debugPanelVisible: true });

    renderWithDebugProviders(
      <DebugManager
        enabled={true}
        initialVisible={true}
        useUnifiedPanel={false}
      />
    );

    // Should show some form of debug interface
    expect(screen.getByText(/debug/i)).toBeInTheDocument();
  });

  it("supports different initial tabs", () => {
    updateDebugContextMock({ debugPanelVisible: true });

    renderWithDebugProviders(
      <DebugManager
        enabled={true}
        initialVisible={true}
        useUnifiedPanel={true}
        initialTab="websocket-events"
        enabledTabs={["workflow", "websocket-events"]}
      />
    );

    // Should render the debug panel
    expect(screen.getByText(/debug panel/i)).toBeInTheDocument();
  });
});
