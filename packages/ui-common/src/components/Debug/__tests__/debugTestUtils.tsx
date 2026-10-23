import React from "react";
import { render, type RenderOptions } from "@testing-library/react";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { I18nextProvider } from "react-i18next";
import { vi } from "vitest";
import i18n from "../../../i18n";

type DebugContextMock = {
  workflowId: string | null;
  organizationId: string | null;
  conversationMessages: unknown[];
  debugPanelVisible: boolean;
  webSocketEvents: unknown[];
  webSocketStats: {
    totalEvents: number;
    eventsByType: Record<string, number>;
    averageEventProcessingTime: number;
    errorsInLastHour: number;
    lastReconnectTime: string | null;
  };
  webSocketConnectionState: {
    isConnected: boolean;
    isAuthenticated: boolean;
    connectionError: unknown;
  };
  webSocketCollections: unknown[];
  isWebSocketHealthy: boolean;
  lastEventTimestamp: string | null;
  toggleDebugPanel: ReturnType<typeof vi.fn>;
  showDebugPanel: ReturnType<typeof vi.fn>;
  hideDebugPanel: ReturnType<typeof vi.fn>;
  setDebugPanelVisible: ReturnType<typeof vi.fn>;
  setWorkflowId: ReturnType<typeof vi.fn>;
  setOrganizationId: ReturnType<typeof vi.fn>;
  setConversationMessages: ReturnType<typeof vi.fn>;
  clearWebSocketEvents: ReturnType<typeof vi.fn>;
  exportWebSocketDebugData: ReturnType<typeof vi.fn>;
  filteredWebSocketEvents: ReturnType<typeof vi.fn>;
};

const createDebugContextMock = (): DebugContextMock => ({
  workflowId: "test-workflow-id",
  organizationId: "test-org-id",
  conversationMessages: [],
  debugPanelVisible: true,
  webSocketEvents: [],
  webSocketStats: {
    totalEvents: 0,
    eventsByType: {},
    averageEventProcessingTime: 0,
    errorsInLastHour: 0,
    lastReconnectTime: null,
  },
  webSocketConnectionState: {
    isConnected: false,
    isAuthenticated: false,
    connectionError: null,
  },
  webSocketCollections: [],
  isWebSocketHealthy: true,
  lastEventTimestamp: null,
  toggleDebugPanel: vi.fn(),
  showDebugPanel: vi.fn(),
  hideDebugPanel: vi.fn(),
  setDebugPanelVisible: vi.fn(),
  setWorkflowId: vi.fn(),
  setOrganizationId: vi.fn(),
  setConversationMessages: vi.fn(),
  clearWebSocketEvents: vi.fn(),
  exportWebSocketDebugData: vi.fn(() => "mock-export"),
  filteredWebSocketEvents: vi.fn(() => []),
});

let debugContextStore = createDebugContextMock();

export const resetDebugContextMock = () => {
  debugContextStore = createDebugContextMock();
};

export const updateDebugContextMock = (
  overrides: Partial<DebugContextMock>,
) => {
  debugContextStore = {
    ...debugContextStore,
    ...overrides,
  };
};

vi.mock("../../../hooks/useDebugContext", () => ({
  __esModule: true,
  useDebugContext: () => debugContextStore,
  useDebugActions: () => ({
    toggleDebugPanel: debugContextStore.toggleDebugPanel,
    showDebugPanel: debugContextStore.showDebugPanel,
    hideDebugPanel: debugContextStore.hideDebugPanel,
    setWorkflowId: debugContextStore.setWorkflowId,
    setOrganizationId: debugContextStore.setOrganizationId,
    setConversationMessages: debugContextStore.setConversationMessages,
    clearWebSocketEvents: debugContextStore.clearWebSocketEvents,
    exportWebSocketDebugData: debugContextStore.exportWebSocketDebugData,
    filteredWebSocketEvents: debugContextStore.filteredWebSocketEvents,
  }),
  useDebugData: () => ({
    workflowId: debugContextStore.workflowId,
    organizationId: debugContextStore.organizationId,
    conversationMessages: debugContextStore.conversationMessages,
    debugPanelVisible: debugContextStore.debugPanelVisible,
    webSocketEvents: debugContextStore.webSocketEvents,
    webSocketStats: debugContextStore.webSocketStats,
    webSocketConnectionState: debugContextStore.webSocketConnectionState,
    webSocketCollections: debugContextStore.webSocketCollections,
    isWebSocketHealthy: debugContextStore.isWebSocketHealthy,
    lastEventTimestamp: debugContextStore.lastEventTimestamp,
  }),
}));

const theme = createTheme();

type RenderWithDebugProvidersResult = ReturnType<typeof render>;

const Providers: React.FC<{ children: React.ReactNode }> = ({ children }) => (
  <ThemeProvider theme={theme}>
    <I18nextProvider i18n={i18n}>{children}</I18nextProvider>
  </ThemeProvider>
);

export const renderWithDebugProviders = (
  ui: React.ReactElement,
  options?: RenderOptions,
): RenderWithDebugProvidersResult =>
  render(ui, { wrapper: Providers, ...options });
