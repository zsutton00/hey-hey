import React from "react";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { describe, it, expect, vi, beforeEach } from "vitest";
import "@testing-library/jest-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createStore, Provider as JotaiProvider } from "jotai";
import type { ConversationResponseDto } from "../../../api";

const { mockUseProject, mockUseConversation, mockUseCreateConversation } =
  vi.hoisted(() => ({
    mockUseProject: vi.fn(() => ({
      data: {
        id: "test-project-id",
        name: "Test Project",
        organizationId: "test-org-id",
      },
      isLoading: false,
      isFetched: true,
      refetch: vi.fn(),
    })),
    mockUseConversation: vi.fn(() => ({
      data: null,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    })),
    mockUseCreateConversation: vi.fn(() => ({
      mutate: vi.fn(),
      isPending: false,
      isError: false,
      error: null,
    })),
  }));

// Mock the hooks and services
vi.mock("../../../hooks/useUserIdentity", () => ({
  useUserIdentity: () => ({
    currentOrgId: "test-org-id",
  }),
}));

vi.mock("react-i18next", () => ({
  useTranslation: () => ({
    t: (key: string) => key,
    i18n: { changeLanguage: vi.fn() },
    ready: true,
  }),
  Trans: ({ children }: { children: React.ReactNode }) => children,
}));

vi.mock("../../../data/hooks/useProject", () => ({
  useProject: mockUseProject,
}));

vi.mock("../../data/hooks/useProject", () => ({
  useProject: mockUseProject,
}));

vi.mock("../../../data/hooks/useConversation", () => ({
  useConversation: mockUseConversation,
}));

vi.mock("../../data/hooks/useConversation", () => ({
  useConversation: mockUseConversation,
}));

vi.mock("../../../data/hooks/useCreateConversation", () => ({
  useCreateConversation: mockUseCreateConversation,
}));

vi.mock("../../data/hooks/useCreateConversation", () => ({
  useCreateConversation: mockUseCreateConversation,
}));

vi.mock("../../../clients/serviceClients", () => ({
  platformClient: {
    createConversation: vi.fn(),
  },
}));

vi.mock(
  "../../../clients/client",
  () => ({
    apiClient: {
      postMessage: vi.fn(),
    },
  }),
  { virtual: true }
);

vi.mock(
  "../../clients/client",
  () => ({
    apiClient: {
      postMessage: vi.fn(),
    },
  }),
  { virtual: true }
);

vi.mock(
  "@mui/system",
  () => ({
    keyframes: () => ({ toString: () => "" }),
  }),
  { virtual: true }
);

vi.mock("../Conversation/ConversationViewer", () => ({
  ConversationViewer: () => (
    <div data-testid="conversation-viewer">ConversationViewer</div>
  ),
}));

// Mock WebSocketProvider and related services
vi.mock("../../../contexts/WebSocketContext", () => ({
  WebSocketProvider: ({ children }: { children: React.ReactNode }) => (
    <div data-testid="websocket-provider-mock">{children}</div>
  ),
  useWebSocketService: () => ({
    connect: vi.fn(),
    disconnect: vi.fn(),
    subscribe: vi.fn(),
    unsubscribe: vi.fn(),
    isConnected: false,
  }),
}));

vi.mock("../../../data/hooks/useWebsocketSubscriptions", () => ({
  useWebsocketSubscriptions: () => ({}),
}));

vi.mock("../../contexts/TrackingContext", () => ({
  TrackingProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useTracking: () => ({ track: vi.fn() }),
}));

vi.mock("../../contexts/OrganizationContext", () => ({
  useOrganization: () => ({
    organizations: [],
    currentOrganization: null,
    loading: false,
    error: null,
    switchOrganization: vi.fn(),
    refreshOrganizations: vi.fn(),
    createOrganization: vi.fn(),
  }),
}));

import { TaskGenerationAssistant } from "./TaskGenerationAssistant";

const createWrapper = () => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  const store = createStore();

  return ({ children }: { children: React.ReactNode }) => (
    <JotaiProvider store={store}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </JotaiProvider>
  );
};

describe("TaskGenerationAssistant", () => {
  const defaultProps = {
    projectId: "test-project-id",
    initiativeId: "test-initiative-id",
    initiativeName: "Test Initiative",
    onConversationCreated: vi.fn(),
    onError: vi.fn(),
  };

  let mutateMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockUseConversation.mockReturnValue({
      data: null,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    mutateMock = vi.fn();
    mockUseCreateConversation.mockReturnValue({
      mutate: mutateMock,
      isPending: false,
      isError: false,
      error: null,
    });
  });

  it("should render the assistant button", () => {
    render(<TaskGenerationAssistant {...defaultProps} />, {
      wrapper: createWrapper(),
    });

    expect(
      screen.getByTestId("workitem-generation-assistant-button")
    ).toBeInTheDocument();
    expect(
      screen.getByTestId("workitem-generation-assistant-button")
    ).toHaveTextContent("tasks.assistant.button");
  });

  it("should disable button and show waiting state when starting assistant", async () => {
    render(<TaskGenerationAssistant {...defaultProps} />, {
      wrapper: createWrapper(),
    });

    const button = screen.getByTestId("workitem-generation-assistant-button");
    fireEvent.click(button);

    await waitFor(() => {
      expect(button).toBeDisabled();
      expect(screen.getByText("Waiting for workflow...")).toBeVisible();
    });

    expect(mutateMock).toHaveBeenCalledWith({
      organizationId: "test-org-id",
      projectId: "test-project-id",
      conversationDto: expect.objectContaining({
        workflowAboutId: "test-initiative-id",
        workflowAboutType: "initiative",
      }),
    });
  });

  it("should detect existing conversations and toggle button label", async () => {
    const existingConversation = {
      id: "conversation-1",
      workflowName: "task-generation",
      messages: [],
      status: "started",
    } as unknown as ConversationResponseDto;

    mockUseConversation.mockReturnValue({
      data: existingConversation,
      isLoading: false,
      error: null,
      refetch: vi.fn(),
    });

    mockUseProject.mockReturnValue({
      data: null,
      isLoading: false,
      isFetched: true,
      refetch: vi.fn(),
    });

    render(<TaskGenerationAssistant {...defaultProps} />, {
      wrapper: createWrapper(),
    });

    await waitFor(() => {
      expect(
        screen.getByTestId("workitem-generation-assistant-button")
      ).toHaveTextContent("Show Work Item Generation");
    });
  });
});
