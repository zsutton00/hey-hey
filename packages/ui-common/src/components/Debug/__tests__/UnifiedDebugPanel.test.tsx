import React from "react";
import { screen, fireEvent } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import {
  renderWithDebugProviders,
  resetDebugContextMock,
} from "./debugTestUtils";
import { UnifiedDebugPanel } from "../UnifiedDebugPanel";

// Mock the WebSocket debug hook
vi.mock("../../../data/websockets/debug", () => ({
  useWebSocketDebug: () => ({
    events: [
      {
        id: "1",
        type: "websocket.connected" as const,
        source: "test",
        timestamp: new Date().toISOString(),
        data: {},
        metadata: { success: true },
      },
    ],
    connectionState: {
      isConnected: true,
      isAuthenticated: true,
      connectionError: null,
    },
    statistics: {
      totalEvents: 1,
      eventsByType: { "websocket.connected": 1 },
      averageEventProcessingTime: 100,
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
    status: {
      workflowId: "test-workflow-id",
      status: "running" as const,
      currentStep: "test-step",
    },
    isLoading: false,
    error: null,
    lastUpdate: new Date(),
    refresh: vi.fn(),
    fetchLogs: vi.fn(() => Promise.resolve([])),
  }),
}));

// Mock the tab components
vi.mock("../tabs/WorkflowStatusTab", () => ({
  WorkflowStatusTab: ({ workflowId }: { workflowId?: string }) => (
    <div data-testid="workflow-status-tab">
      Workflow Status: {workflowId ? "running" : "No status"}
    </div>
  ),
}));

vi.mock("../tabs/WebSocketEventsTab", () => ({
  WebSocketEventsTab: ({ events }: { events: any[] }) => (
    <div data-testid="websocket-events-tab">Events: {events.length}</div>
  ),
}));

vi.mock("../tabs/WebSocketStatsTab", () => ({
  WebSocketStatsTab: ({ statistics }: { statistics: any }) => (
    <div data-testid="websocket-stats-tab">
      Stats: {statistics?.totalEvents || 0} events
    </div>
  ),
}));

vi.mock("../WorkflowLogsModal", () => ({
  WorkflowLogsModal: ({ open }: { open: boolean }) =>
    open ? <div data-testid="workflow-logs-modal">Logs Modal</div> : null,
}));

const originalCreateObjectURL = URL.createObjectURL;
const originalRevokeObjectURL = URL.revokeObjectURL;
const mockCreateObjectURL = vi.fn(() => "blob:mock-url");
const mockRevokeObjectURL = vi.fn();
const originalAnchorClick = HTMLAnchorElement.prototype.click;
const mockAnchorClick = vi.fn();

beforeAll(() => {
  Object.defineProperty(URL, "createObjectURL", {
    configurable: true,
    writable: true,
    value: mockCreateObjectURL,
  });
  Object.defineProperty(URL, "revokeObjectURL", {
    configurable: true,
    writable: true,
    value: mockRevokeObjectURL,
  });
  HTMLAnchorElement.prototype.click = mockAnchorClick;
});

beforeEach(() => {
  resetDebugContextMock();
});

afterEach(() => {
  vi.clearAllMocks();
});

afterAll(() => {
  if (originalCreateObjectURL) {
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      writable: true,
      value: originalCreateObjectURL,
    });
  } else {
    // @ts-expect-error - cleanup test shim
    delete URL.createObjectURL;
  }

  if (originalRevokeObjectURL) {
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      writable: true,
      value: originalRevokeObjectURL,
    });
  } else {
    // @ts-expect-error - cleanup test shim
    delete URL.revokeObjectURL;
  }

  HTMLAnchorElement.prototype.click = originalAnchorClick;
});

describe("UnifiedDebugPanel", () => {
  it("renders when visible", () => {
    renderWithDebugProviders(<UnifiedDebugPanel visible={true} />);

    expect(screen.getByText(/debug panel/i)).toBeInTheDocument();
  });

  it("does not render when not visible", () => {
    renderWithDebugProviders(<UnifiedDebugPanel visible={false} />);

    expect(screen.queryByText(/debug panel/i)).not.toBeInTheDocument();
  });

  it("shows workflow tab by default", () => {
    renderWithDebugProviders(
      <UnifiedDebugPanel
        visible={true}
        workflowId="test-workflow-id"
        enabledTabs={["workflow"]}
      />
    );

    expect(screen.getByTestId("workflow-status-tab")).toBeInTheDocument();
    expect(screen.getByText(/workflow status: running/i)).toBeInTheDocument();
  });

  it("switches between tabs", () => {
    renderWithDebugProviders(
      <UnifiedDebugPanel
        visible={true}
        enabledTabs={["workflow", "websocket-events"]}
      />
    );

    // Should show workflow tab initially
    expect(screen.getByTestId("workflow-status-tab")).toBeInTheDocument();

    // Click on Events tab
    const eventsTab = screen.getByText("Events");
    fireEvent.click(eventsTab);

    // Should show websocket events tab
    expect(screen.getByTestId("websocket-events-tab")).toBeInTheDocument();
  });

  it("shows stats summary when expanded", () => {
    renderWithDebugProviders(
      <UnifiedDebugPanel
        visible={true}
        enabledTabs={["workflow", "websocket-events", "websocket-stats"]}
      />
    );

    // Should show event count
    expect(screen.getByText(/1 events/i)).toBeInTheDocument();
    // Should show subscription count
    expect(screen.getByText(/0 subs/i)).toBeInTheDocument();
  });

  it("can be collapsed and expanded", () => {
    renderWithDebugProviders(<UnifiedDebugPanel visible={true} />);

    const expandButton = screen.getByLabelText(/toggle expand/i);

    // Click to collapse
    fireEvent.click(expandButton);

    // Should show compact view
    expect(screen.getByText(/1 events, 0 subs/i)).toBeInTheDocument();
  });

  it("handles export functionality", () => {
    renderWithDebugProviders(
      <UnifiedDebugPanel visible={true} exportEnabled={true} />
    );

    const exportButton = screen.getByLabelText(/export/i);

    // Should not throw when clicking export
    expect(() => fireEvent.click(exportButton)).not.toThrow();
  });

  it("handles different positions", () => {
    const { rerender } = renderWithDebugProviders(
      <UnifiedDebugPanel visible={true} position="top-left" />
    );

    expect(screen.getByText(/debug panel/i)).toBeInTheDocument();

    rerender(<UnifiedDebugPanel visible={true} position="bottom-right" />);

    expect(screen.getByText(/debug panel/i)).toBeInTheDocument();
  });

  it("only shows enabled tabs", () => {
    renderWithDebugProviders(
      <UnifiedDebugPanel visible={true} enabledTabs={["workflow"]} />
    );

    // Should show workflow tab
    expect(screen.getByTestId("workflow-status-tab")).toBeInTheDocument();

    // Should not show tabs navigation when only one tab
    expect(screen.queryByText("Events")).not.toBeInTheDocument();
    expect(screen.queryByText("Stats")).not.toBeInTheDocument();
  });
});
