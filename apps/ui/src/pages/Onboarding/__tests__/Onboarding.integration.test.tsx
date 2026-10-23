import { WebSocketHandler } from "../../../../../../packages/ui-common/src/data/websockets/handler";
import { useConversationMessages } from "@hey-hey/ui-common/data";
import type { ConversationResponseDto } from "@hey-hey/ui-common/api";
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import "@testing-library/jest-dom";
import { http, HttpResponse } from "msw";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ThemeProvider, createTheme } from "@mui/material/styles";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter, Route, Routes, useLocation } from "react-router-dom";
import { Provider as JotaiProvider, createStore } from "jotai";
import { useState, type ReactNode } from "react";
import i18n from "@hey-hey/ui-common/i18n";
import { initializeBrowserApiRuntime } from "@hey-hey/ui-common/clients";
import { setAuthToken } from "@hey-hey/ui-common/services";
import OnboardingPage from "../Onboarding";
import type {
  ProjectResponseDto,
  OrganizationResponseDto,
} from "@hey-hey/ui-common/api";
import {
  ProjectRole,
  ProjectStatus,
  OrganizationRole,
} from "@hey-hey/ui-common/api";
import {
  AuthProvider,
  WebSocketProvider,
  OrganizationProvider,
  DebugProvider,
  TrackingProvider,
} from "@hey-hey/ui-common/context";

vi.mock("../../../components/Layout", () => ({
  PageBreadcrumbs: ({
    items,
  }: {
    items: Array<{
      label: string;
      isCurrent?: boolean;
      to?: string;
    }>;
  }) => (
    <nav aria-label="breadcrumb" data-testid="onboarding-breadcrumbs">
      {items.map((item) => (
        <span
          data-current={item.isCurrent ? "true" : "false"}
          data-to={item.to}
          key={item.label}
        >
          {item.label}
        </span>
      ))}
    </nav>
  ),
}));

const LocationDisplay = () => {
  const location = useLocation();

  return (
    <output data-testid="location">
      {`${location.pathname}${location.search}`}
    </output>
  );
};

vi.mock("@hey-hey/ui-common/components", () => ({
  DISABLED_CONVERSATION_SCROLL_POLICY: {},
  determineMessageState: () => "completed",
  HeyHeyBranding: () => <span>Hey Hey</span>,
  Conversation: ({
    conversation,
    onSubmitOnboardingReply,
    agentSessionId,
    agentSessionCurrentState,
  }: {
    conversation: ConversationResponseDto;
    onSubmitOnboardingReply: (submission: {
      parentMessageId: string;
      expectedConversationVersion: number;
      answers: Record<string, unknown>;
    }) => Promise<void>;
    agentSessionId?: string;
    agentSessionCurrentState?: string;
  }) => {
    const [value, setValue] = useState("");
    const { data: messages } = useConversationMessages(
      conversation.organizationId,
      conversation.projectId,
      conversation.id,
    );
    const firstMessage = messages[0];
    const isReplyForm = firstMessage?.awaitingResponse;
    const isExistingWorkIntent = firstMessage?.data?.uiElements?.some(
      (element) => element.id === "repository_grounding_intent",
    );

    if (isReplyForm) {
      if (isExistingWorkIntent) {
        return (
          <div data-testid="conversation-timeline">
            <div data-testid="dynamic-form">
              <button
                data-testid="existing-work-import"
                onClick={() =>
                  void onSubmitOnboardingReply({
                    parentMessageId: firstMessage.id,
                    expectedConversationVersion: conversation.version,
                    answers: {
                      repository_grounding_intent: { choice: "yes" },
                    },
                  }).catch(() => undefined)
                }
              >
                Import existing work
              </button>
            </div>
          </div>
        );
      }

      return (
        <div data-testid="conversation-timeline">
          <div data-testid="dynamic-form">
            <label data-testid="textarea-field-project_concept">
              Project Concept
              <textarea
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            </label>
            <button
              data-testid="run-stream-external-reply-submit"
              onClick={() =>
                void onSubmitOnboardingReply({
                  parentMessageId: firstMessage.id,
                  expectedConversationVersion: conversation.version,
                  answers: { project_concept: value },
                }).catch(() => undefined)
              }
            >
              Submit
            </button>
          </div>
        </div>
      );
    }

    return (
      <div
        data-testid="conversation-timeline"
        data-agent-session-id={agentSessionId}
        data-agent-session-current-state={agentSessionCurrentState}
      >
        {Array.from({ length: 6 }, (_, index) => (
          <div key={index} data-testid={`conversation-step-${index}`} />
        ))}
        <div data-testid="initiative-field-initiative-1">
          <div data-testid="work-item-card" />
        </div>
      </div>
    );
  },
}));

const mockAgentSessions = vi.hoisted(() => {
  const sessions: Array<{ id: string; currentState?: string }> = [];
  return {
    sessions,
    use: vi.fn(() => ({ agentSessions: sessions })),
  };
});

vi.mock("@hey-hey/ui-common/data", async () => {
  const actual = await vi.importActual<
    typeof import("@hey-hey/ui-common/data")
  >("@hey-hey/ui-common/data");

  return {
    ...actual,
    useAgentSessions: mockAgentSessions.use,
  };
});

// Declare global MSW server
declare global {
  var mswServer: {
    use: (...handlers: unknown[]) => void;
    resetHandlers: () => void;
  };
}

// Mock auth context
vi.mock("@hey-hey/ui-common/context", async () => {
  const actual = await vi.importActual<
    typeof import("@hey-hey/ui-common/context")
  >("@hey-hey/ui-common/context");

  return {
    ...actual,
    AuthProvider: ({ children }: { children: ReactNode }) => children,
    WebSocketProvider: ({ children }: { children: ReactNode }) => children,
    OrganizationProvider: ({ children }: { children: ReactNode }) => children,
    DebugProvider: ({ children }: { children: ReactNode }) => children,
    TrackingProvider: ({ children }: { children: ReactNode }) => children,
    usePageTracking: vi.fn(),
    useDebugActions: () => ({
      setWorkflowId: vi.fn(),
      setOrganizationId: vi.fn(),
      setConversationMessages: vi.fn(),
    }),
    useAuth: () => ({
      isAuthenticated: true,
      user: {
        id: "0ed78103-c072-4c97-8749-4740d456c403",
        email: "test@example.com",
      },
      loading: false,
    }),
    useOrganization: () => ({
      organizations: [
        {
          id: "6815f349-7b01-4852-9b59-66cf17709c25",
          name: "Test Organization",
          slug: "test-organization",
          isActive: true,
          userRole: "ADMIN",
          createdAt: "2025-10-06T01:03:07.467Z",
          updatedAt: "2025-10-06T02:10:53.508Z",
        },
      ],
      currentOrganization: {
        id: "6815f349-7b01-4852-9b59-66cf17709c25",
        name: "Test Organization",
        slug: "test-organization",
        isActive: true,
        userRole: "ADMIN",
        createdAt: "2025-10-06T01:03:07.467Z",
        updatedAt: "2025-10-06T02:10:53.508Z",
      },
      loading: false,
      error: null,
      switchOrganization: vi.fn(),
      refreshOrganizations: vi.fn(),
      createOrganization: vi.fn(),
    }),
    TrackingProvider: ({ children }: { children: ReactNode }) => children,
    WebSocketProvider: ({ children }: { children: ReactNode }) => children,
  };
});

// Mock useUserIdentity hook
vi.mock("@hey-hey/ui-common/hooks", async () => {
  const actual = await vi.importActual<
    typeof import("@hey-hey/ui-common/hooks")
  >("@hey-hey/ui-common/hooks");

  return {
    ...actual,
    useUserIdentity: () => ({
      userId: "0ed78103-c072-4c97-8749-4740d456c403",
      email: "test@example.com",
      name: "Test User",
      currentOrgId: "6815f349-7b01-4852-9b59-66cf17709c25",
      orgMemberships: [
        {
          orgId: "6815f349-7b01-4852-9b59-66cf17709c25",
          role: "admin",
        },
      ],
      isDevAdmin: false,
      devAdminMode: false,
      isTokenExpired: false,
      currentOrgRole: "admin",
    }),
    useActionGuard: () => ({
      guard:
        <TArgs extends unknown[]>(
          _key: string,
          handler: (...args: TArgs) => void,
        ) =>
        (...args: TArgs) =>
          handler(...args),
      isLocked: () => false,
      release: vi.fn(),
    }),
  };
});

// Create test wrapper
const createTestWrapper = (
  initialEntry = "/projects/5528269f-ab34-48ca-95f4-dd46e8a3393f/onboarding",
  store = createStore(),
) => {
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false, gcTime: 0 },
    },
  });

  const theme = createTheme({
    palette: {
      heyhey: { main: "#087e8b", light: "#5ab1bb", dark: "#04545d" },
    },
  });

  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <JotaiProvider store={store}>
        <AuthProvider>
          <WebSocketProvider>
            <ThemeProvider theme={theme}>
              <I18nextProvider i18n={i18n}>
                <OrganizationProvider>
                  <DebugProvider>
                    <TrackingProvider enabled={false}>
                      <MemoryRouter initialEntries={[initialEntry]}>
                        <Routes>
                          <Route
                            path="/projects/:projectId/onboarding"
                            element={children}
                          />
                          <Route
                            path="/projects/:projectId"
                            element={<LocationDisplay />}
                          />
                        </Routes>
                      </MemoryRouter>
                    </TrackingProvider>
                  </DebugProvider>
                </OrganizationProvider>
              </I18nextProvider>
            </ThemeProvider>
          </WebSocketProvider>
        </AuthProvider>
      </JotaiProvider>
    </QueryClientProvider>
  );
};

describe("Onboarding Page Integration Tests", () => {
  const mockOrganization: OrganizationResponseDto = {
    id: "6815f349-7b01-4852-9b59-66cf17709c25",
    name: "Test Organization",
    slug: "test-organization",
    isActive: true,
    userRole: OrganizationRole.Admin,
    createdAt: "2025-10-06T01:03:07.467Z",
    updatedAt: "2025-10-06T02:10:53.508Z",
  };

  const mockProject: ProjectResponseDto = {
    id: "5528269f-ab34-48ca-95f4-dd46e8a3393f",
    organizationId: "6815f349-7b01-4852-9b59-66cf17709c25",
    name: "Hey Hey",
    status: ProjectStatus.Onboarding,
    currentUserRole: ProjectRole.Owner,
    createdBy: "0ed78103-c072-4c97-8749-4740d456c403",
    createdAt: "2025-10-07T08:15:55.124Z",
    updatedAt: "2025-10-07T08:15:55.124Z",
  };

  const { messages: mockMessages, ...mockConversation } = {
    id: "aabd4686-a99a-4670-a240-d58484000938",
    projectId: "5528269f-ab34-48ca-95f4-dd46e8a3393f",
    organizationId: "6815f349-7b01-4852-9b59-66cf17709c25",
    workflowId: "c39a94ea-4d8c-4813-9630-3972954ad795",
    workflowAboutType: null,
    initiatedBy: "SYSTEM",
    triggerEvent: "flow_started_onboarding",
    status: "IN_PROGRESS",
    title: "onboarding - Node: shared-generate-initiatives",
    version: 32,
    lastModifiedBy: null,
    workflowName: "onboarding",
    initiativeId: null,
    workflowAboutId: null,
    createdAt: "2025-10-07T08:17:34.047Z",
    updatedAt: "2025-10-07T14:38:34.692Z",
    messages: [
      {
        id: "msg-1",
        workflowId: "c39a94ea-4d8c-4813-9630-3972954ad795",
        projectId: "5528269f-ab34-48ca-95f4-dd46e8a3393f",
        status: "completed",
        conversationId: "aabd4686-a99a-4670-a240-d58484000938",
        parentMessageId: null,
        createdAt: "2025-10-07T08:17:34.151Z",
        type: "SYSTEM",
        data: {
          type: "QUESTIONS",
          nodeId: "onboarding-welcome",
          response: "Welcome! I'm here to help you set up your project.",
          uiElements: [
            {
              id: "project_concept",
              type: "textarea",
              label: "Project Concept",
              required: true,
            },
          ],
        },
        awaitingResponse: false,
        responses: [
          {
            id: "msg-2",
            workflowId: "c39a94ea-4d8c-4813-9630-3972954ad795",
            projectId: "5528269f-ab34-48ca-95f4-dd46e8a3393f",
            status: "completed",
            conversationId: "aabd4686-a99a-4670-a240-d58484000938",
            parentMessageId: "msg-1",
            createdAt: "2025-10-07T08:17:49.847Z",
            type: "USER",
            data: { project_concept: "Test project concept" },
            awaitingResponse: false,
            responses: [
              {
                id: "msg-3",
                workflowId: "c39a94ea-4d8c-4813-9630-3972954ad795",
                projectId: "5528269f-ab34-48ca-95f4-dd46e8a3393f",
                status: "completed",
                conversationId: "aabd4686-a99a-4670-a240-d58484000938",
                parentMessageId: "msg-2",
                createdAt: "2025-10-07T08:17:50.095Z",
                type: "SYSTEM",
                data: {
                  type: "QUESTIONS",
                  nodeId: "onboarding-clarify-concept",
                  response: "Let me clarify some details.",
                  uiElements: [],
                },
                awaitingResponse: false,
                responses: [
                  {
                    id: "msg-4",
                    workflowId: "c39a94ea-4d8c-4813-9630-3972954ad795",
                    projectId: "5528269f-ab34-48ca-95f4-dd46e8a3393f",
                    status: "completed",
                    conversationId: "aabd4686-a99a-4670-a240-d58484000938",
                    parentMessageId: "msg-3",
                    createdAt: "2025-10-07T08:18:31.205Z",
                    type: "USER",
                    data: {},
                    awaitingResponse: false,
                    responses: [
                      {
                        id: "msg-5",
                        workflowId: "c39a94ea-4d8c-4813-9630-3972954ad795",
                        projectId: "5528269f-ab34-48ca-95f4-dd46e8a3393f",
                        status: "completed",
                        conversationId: "aabd4686-a99a-4670-a240-d58484000938",
                        parentMessageId: "msg-4",
                        createdAt: "2025-10-07T08:18:31.321Z",
                        type: "SYSTEM",
                        data: {
                          type: "ROUTING",
                          nodeId: "onboarding-analyze-project-concept",
                          response: "Analyzing your project...",
                        },
                        awaitingResponse: false,
                        responses: [
                          {
                            id: "msg-6",
                            workflowId: "c39a94ea-4d8c-4813-9630-3972954ad795",
                            projectId: "5528269f-ab34-48ca-95f4-dd46e8a3393f",
                            status: "open",
                            conversationId:
                              "aabd4686-a99a-4670-a240-d58484000938",
                            parentMessageId: "msg-5",
                            createdAt: "2025-10-07T14:35:52.759Z",
                            type: "SYSTEM",
                            data: {
                              type: "INITIATIVES",
                              title: "MVP Execution Plan",
                              nodeId: "shared-generate-initiatives",
                              response:
                                "Great! I've analyzed your project and created 6 workstreams.",
                              uiElements: [
                                {
                                  id: "initiative-1",
                                  type: "initiative_list",
                                  label: "Generated Initiatives",
                                  required: true,
                                },
                              ],
                              generatedInitiativeIds: [
                                "70d0cb5f-ce2b-41ca-ae0d-3dfd56229e1d",
                              ],
                            },
                            awaitingResponse: true,
                            responses: [],
                          },
                        ],
                      },
                    ],
                  },
                ],
              },
            ],
          },
        ],
      },
    ],
  };

  const mockInitiatives = [
    {
      id: "70d0cb5f-ce2b-41ca-ae0d-3dfd56229e1d",
      name: "Foundational Artifact Graph and Data Model",
      description:
        "Implement the core data model and artifact graph to unify initiatives, tasks, design docs.",
      details: "Build upon the existing Java-based Graph service...",
      acceptanceCriteria: "Database schema migrations for all core entities...",
      assigneeId: null,
      status: "ACTIVE",
      priority: "CRITICAL",
      dueDate: "",
      tags: ["artifact-graph", "backend"],
      organizationId: "6815f349-7b01-4852-9b59-66cf17709c25",
      sourceConversationId: "aabd4686-a99a-4670-a240-d58484000938",
      creatorType: "SYSTEM",
      reasoning: "This is the substrate enabling RAG.",
      createdAt: "2025-10-07T14:38:34.347Z",
      updatedAt: "2025-10-08T19:31:48.385Z",
    },
  ];

  const { messages: mockReplyMessages, ...mockReplyConversation } = {
    ...mockConversation,
    version: 33,
    messages: [
      {
        ...mockMessages[0],
        id: "reply-parent",
        status: "open",
        data: {
          type: "QUESTIONS",
          nodeId: "onboarding-reply",
          response: "Tell us what you are building.",
          uiElements: [
            {
              id: "project_concept",
              type: "button_group",
              label: "Project Concept",
              required: true,
              options: [
                {
                  label: "A graph-backed project workspace",
                  value: "A graph-backed project workspace",
                },
                {
                  label: "Keep this onboarding draft",
                  value: "Keep this onboarding draft",
                },
              ],
            },
          ],
        },
        awaitingResponse: true,
        responses: [],
      },
    ],
  };

  let currentMessages = mockMessages;
  const mockIntentReplyConversation = {
    ...mockReplyConversation,
    messages: [
      {
        ...mockReplyMessages[0],
        data: {
          type: "QUESTIONS",
          nodeId: "repository-grounding-intent",
          response: "How should Hey Hey set up this project?",
          uiElements: [
            {
              id: "repository_grounding_intent",
              type: "select",
              label: "Project setup approach",
              required: true,
            },
          ],
        },
      },
    ],
  };

  const mockCompletedIntentConversation = {
    ...mockIntentReplyConversation,
    status: "COMPLETED",
    messages: [
      {
        ...mockIntentReplyConversation.messages[0],
        status: "completed",
        awaitingResponse: false,
        responses: [
          {
            id: "intent-reply",
            type: "USER",
            data: { repository_grounding_intent: { choice: "yes" } },
            responses: [],
          },
        ],
      },
    ],
  };
  beforeEach(() => {
    currentMessages = mockMessages;
    vi.clearAllMocks();
    mockAgentSessions.sessions.length = 0;
    initializeBrowserApiRuntime({
      baseUrl: "http://localhost:3000/api/v1",
    });
    setAuthToken(
      "eyJhbGciOiJub25lIiwidHlwIjoiSldUIn0.eyJzdWIiOiIwZWQ3ODEwMy1jMDcyLTRjOTctODc0OS00NzQwZDQ1NmM0MDMiLCJlbWFpbCI6InRlc3RAZXhhbXBsZS5jb20iLCJuYW1lIjoiVGVzdCBVc2VyIiwiY3VycmVudE9yZ0lkIjoiNjgxNWYzNDktN2IwMS00ODUyLTliNTktNjZjZjE3NzA5YzI1Iiwib3JnTWVtYmVyc2hpcHMiOlt7Im9yZ0lkIjoiNjgxNWYzNDktN2IwMS00ODUyLTliNTktNjZjZjE3NzA5YzI1Iiwicm9sZSI6ImFkbWluIn1dLCJpc0RldkFkbWluIjpmYWxzZSwiZGV2QWRtaW5Nb2RlIjpmYWxzZSwiaWF0IjoxNzg4MjM2MDAwLCJleHAiOjQxMDI0NDQ4MDB9.",
    );

    // Set up MSW handlers
    globalThis.mswServer.use(
      http.get(
        "http://localhost:3000/api/v1/organizations/:organizationId/projects/:projectId/conversations/:conversationId/version",
        () => HttpResponse.json({ success: true, data: { version: 33 } }),
      ),
      http.get(
        "http://localhost:3000/api/v1/organizations/:organizationId/projects/:projectId/messages",
        () =>
          HttpResponse.json({
            success: true,
            data: { messages: currentMessages },
          }),
      ),
      // Organizations endpoint
      http.get("http://localhost:3000/api/v1/organizations", () => {
        return HttpResponse.json({
          success: true,
          message: "Request processed successfully",
          data: [mockOrganization],
          timestamp: new Date().toISOString(),
          statusCode: 200,
        });
      }),

      // Single project endpoint
      http.get(
        "http://localhost:3000/api/v1/organizations/:organizationId/projects/:projectId",
        () => {
          return HttpResponse.json({
            success: true,
            message: "Request processed successfully",
            data: mockProject,
            timestamp: new Date().toISOString(),
            statusCode: 200,
            path: "/api/v1/organizations/6815f349-7b01-4852-9b59-66cf17709c25/projects/5528269f-ab34-48ca-95f4-dd46e8a3393f",
          });
        },
      ),

      // Conversations endpoint with workflowName query
      http.get(
        "http://localhost:3000/api/v1/organizations/:organizationId/projects/:projectId/conversations",
        ({ request }) => {
          const url = new URL(request.url);
          const workflowName = url.searchParams.get("workflowName");

          if (workflowName === "onboarding") {
            return HttpResponse.json({
              success: true,
              message: "Request processed successfully",
              data: {
                data: [mockConversation],
                pagination: {
                  page: 1,
                  limit: 100,
                  total: 1,
                  totalPages: 1,
                },
              },
              timestamp: new Date().toISOString(),
              statusCode: 200,
              path: `/api/v1/organizations/6815f349-7b01-4852-9b59-66cf17709c25/projects/5528269f-ab34-48ca-95f4-dd46e8a3393f/conversations?page=1&limit=100&workflowName=onboarding`,
            });
          }

          return HttpResponse.json({
            success: true,
            data: {
              data: [],
              pagination: { page: 1, limit: 100, total: 0, totalPages: 0 },
            },
            timestamp: new Date().toISOString(),
            statusCode: 200,
          });
        },
      ),

      // Initiatives endpoint
      http.get(
        "http://localhost:3000/api/v1/organizations/:organizationId/projects/:projectId/conversations/:conversationId/initiatives",
        () => {
          return HttpResponse.json({
            success: true,
            message: "Request processed successfully",
            data: mockInitiatives,
            timestamp: new Date().toISOString(),
            statusCode: 200,
          });
        },
      ),

      // Background context lookups used by the shared conversation renderer.
      http.get(
        "*/api/v1/organizations/:organizationId/projects/:projectId/work-item-types",
        () =>
          HttpResponse.json({
            success: true,
            data: [],
            timestamp: new Date().toISOString(),
            statusCode: 200,
          }),
      ),
      http.get("*/api/v1/organizations/:organizationId/services", () =>
        HttpResponse.json({
          success: true,
          data: [],
          timestamp: new Date().toISOString(),
          statusCode: 200,
        }),
      ),
      http.get(
        "*/api/v1/organizations/:organizationId/projects/:projectId/work-items/references",
        () =>
          HttpResponse.json({
            success: true,
            data: {
              data: [],
              pagination: {
                page: 1,
                limit: 500,
                total: 0,
                totalPages: 0,
              },
            },
            timestamp: new Date().toISOString(),
            statusCode: 200,
          }),
      ),
      http.get("*/api/v1/machines", () =>
        HttpResponse.json({
          success: true,
          data: { machines: [] },
          timestamp: new Date().toISOString(),
          statusCode: 200,
        }),
      ),

      // Integrations endpoint
      http.get(
        "http://localhost:3000/api/v1/organizations/:organizationId/projects/:projectId/integrations",
        () => {
          return HttpResponse.json({
            success: true,
            message: "Request processed successfully",
            data: [],
            timestamp: new Date().toISOString(),
            statusCode: 200,
          });
        },
      ),
    );
  });

  it("should render onboarding conversation with correct structure", async () => {
    const wrapper = createTestWrapper();

    render(<OnboardingPage />, { wrapper });

    // Wait for the conversation timeline to load
    await waitFor(
      () => {
        const timeline = screen.getByTestId("conversation-timeline");
        expect(timeline).toBeInTheDocument();
      },
      { timeout: 15000 },
    );
    expect(
      screen.queryByTestId("onboarding-breadcrumbs"),
    ).not.toBeInTheDocument();

    // Assert there are 6 elements with data-step-index
    const stepElements = screen.getAllByTestId(/^conversation-step-/);
    expect(stepElements.length).toBe(6);

    // Assert initiative field exists
    const initiativeField = screen.getByTestId("initiative-field-initiative-1");
    expect(initiativeField).toBeInTheDocument();

    // Assert there is 1 work item card
    const workItemCards = screen.getAllByTestId("work-item-card");
    expect(workItemCards.length).toBe(1);
  });

  it("renders completion Messages from websocket updates without refreshing metadata", async () => {
    currentMessages = mockReplyMessages;
    let envelopeReads = 0;
    globalThis.mswServer.use(
      http.get(
        "http://localhost:3000/api/v1/organizations/:organizationId/projects/:projectId/conversations",
        () => {
          envelopeReads += 1;
          return HttpResponse.json({
            success: true,
            data: { data: [mockReplyConversation] },
          });
        },
      ),
    );
    const store = createStore();
    render(<OnboardingPage />, {
      wrapper: createTestWrapper(undefined, store),
    });
    await screen.findByTestId("textarea-field-project_concept");
    currentMessages = mockReplyMessages.map((message) => ({
      ...message,
      awaitingResponse: false,
    }));
    const handler = new WebSocketHandler(store);
    const completion = {
      type: "conversation.updated" as const,
      conversationId: mockConversation.id,
      organizationId: mockConversation.organizationId,
      projectId: mockConversation.projectId,
      timestamp: "2026-09-16T00:00:00Z",
      previousVersion: 33,
      newVersion: 34,
      changeType: "message_updated",
    };
    act(() => {
      handler.handleEvent(completion);
      handler.handleEvent(completion);
    });
    await screen.findByTestId("initiative-field-initiative-1");
    expect(
      screen.queryByTestId("textarea-field-project_concept"),
    ).not.toBeInTheDocument();
    expect(envelopeReads).toBe(1);
  });

  it("renders existing-project breadcrumbs without changing the import conversation route", async () => {
    const existingImportConversation = {
      ...mockIntentReplyConversation,
      messages: [
        {
          ...mockIntentReplyConversation.messages[0],
          data: {
            ...mockIntentReplyConversation.messages[0].data,
            uiElements: [
              ...(mockIntentReplyConversation.messages[0].data.uiElements ??
                []),
              { id: "repository_grounding" },
            ],
          },
        },
      ],
    };
    currentMessages = existingImportConversation.messages;

    globalThis.mswServer.use(
      http.get(
        "http://localhost:3000/api/v1/organizations/:organizationId/projects/:projectId/conversations/:conversationId",
        () =>
          HttpResponse.json({
            success: true,
            message: "Request processed successfully",
            data: existingImportConversation,
            timestamp: new Date().toISOString(),
            statusCode: 200,
          }),
      ),
    );

    render(<OnboardingPage />, {
      wrapper: createTestWrapper(
        `/projects/${mockProject.id}/onboarding?entry=existing&conversationId=${mockIntentReplyConversation.id}`,
      ),
    });

    const breadcrumbs = await screen.findByTestId("onboarding-breadcrumbs");
    expect(breadcrumbs).toHaveTextContent("Projects");
    expect(breadcrumbs).toHaveTextContent(mockProject.name);
    expect(breadcrumbs).toHaveTextContent("Import existing work");
    expect(
      within(breadcrumbs).getByText("Import existing work"),
    ).toHaveAttribute("data-current", "true");
    expect(within(breadcrumbs).getByText("Projects")).toHaveAttribute(
      "data-to",
      "/projects",
    );
    expect(within(breadcrumbs).getByText(mockProject.name)).toHaveAttribute(
      "data-to",
      `/projects/${mockProject.id}`,
    );
    expect(
      await screen.findByTestId("conversation-timeline"),
    ).toBeInTheDocument();
  });

  it("passes the conversation-filtered Agent Session state into the active conversation", async () => {
    mockAgentSessions.sessions.push({
      id: "agent-session-1",
      currentState: "THINKING",
    });
    globalThis.mswServer.use(
      http.get(
        "http://localhost:3000/api/v1/organizations/:organizationId/projects/:projectId/conversations/:conversationId",
        () =>
          HttpResponse.json({
            success: true,
            message: "Request processed successfully",
            data: mockConversation,
            timestamp: new Date().toISOString(),
            statusCode: 200,
          }),
      ),
    );

    render(<OnboardingPage />, {
      wrapper: createTestWrapper(
        `/projects/${mockProject.id}/onboarding?conversationId=${mockConversation.id}`,
      ),
    });

    const timeline = await screen.findByTestId("conversation-timeline");
    expect(timeline).toHaveAttribute(
      "data-agent-session-id",
      "agent-session-1",
    );
    expect(timeline).toHaveAttribute(
      "data-agent-session-current-state",
      "THINKING",
    );
    expect(mockAgentSessions.use).toHaveBeenCalledWith(
      mockProject.organizationId,
      mockProject.id,
      expect.objectContaining({
        conversationId: mockConversation.id,
        type: "CODING",
        enabled: true,
      }),
    );
  });

  it("redirects an active question-led project to Help while conversation recovery is pending", async () => {
    globalThis.mswServer.use(
      http.get(
        "http://localhost:3000/api/v1/organizations/:organizationId/projects/:projectId",
        () =>
          HttpResponse.json({
            success: true,
            message: "Request processed successfully",
            data: { ...mockProject, status: ProjectStatus.Active },
            timestamp: new Date().toISOString(),
            statusCode: 200,
          }),
      ),
      http.get(
        "http://localhost:3000/api/v1/organizations/:organizationId/projects/:projectId/conversations",
        () =>
          HttpResponse.json({
            success: true,
            data: {
              data: [],
              pagination: { page: 1, limit: 100, total: 0, totalPages: 0 },
            },
            timestamp: new Date().toISOString(),
            statusCode: 200,
          }),
      ),
    );

    const wrapper = createTestWrapper();

    render(<OnboardingPage />, { wrapper });

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/projects/5528269f-ab34-48ca-95f4-dd46e8a3393f?tab=help",
      );
    });
  });

  it("submits onboarding replies with the current version despite older mounted metadata", async () => {
    const user = userEvent.setup();
    const requests: unknown[] = [];
    currentMessages = mockReplyMessages;

    globalThis.mswServer.use(
      http.get(
        "http://localhost:3000/api/v1/organizations/:organizationId/projects/:projectId/conversations/:conversationId/version",
        () => HttpResponse.json({ success: true, data: { version: 34 } }),
      ),
      http.get(
        "http://localhost:3000/api/v1/organizations/:organizationId/projects/:projectId/conversations",
        () =>
          HttpResponse.json({
            success: true,
            message: "Request processed successfully",
            data: {
              data: [mockReplyConversation],
              pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
            },
            timestamp: new Date().toISOString(),
            statusCode: 200,
          }),
      ),
      http.post(
        "http://localhost:3000/api/v1/organizations/:organizationId/projects/:projectId/onboarding/conversations/:conversationId/replies",
        async ({ request }) => {
          requests.push(await request.json());
          return HttpResponse.json(
            {
              success: true,
              message: "Reply accepted",
              data: {
                id: "reply-1",
                projectId: mockProject.id,
                type: "USER",
                status: "completed",
                data: { project_concept: "A graph-backed project workspace" },
                conversationId: mockReplyConversation.id,
                parentMessageId: "reply-parent",
                createdAt: new Date().toISOString(),
              },
              timestamp: new Date().toISOString(),
              statusCode: 202,
            },
            { status: 202 },
          );
        },
      ),
    );

    render(<OnboardingPage />, { wrapper: createTestWrapper() });

    const field = await screen.findByTestId("textarea-field-project_concept");
    await user.type(
      within(field).getByRole("textbox"),
      "A graph-backed project workspace",
    );
    await user.click(
      await screen.findByTestId("run-stream-external-reply-submit"),
    );

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toEqual({
      parentMessageId: "reply-parent",
      expectedConversationVersion: 34,
      answers: { project_concept: "A graph-backed project workspace" },
    });
    expect(requests[0]).not.toHaveProperty("organizationId");
    expect(requests[0]).not.toHaveProperty("controllerCredentialId");
    expect(requests[0]).not.toHaveProperty("machineId");
  });

  it("submits the existing-work intent as an admitted option through onboarding admission", async () => {
    const requests: unknown[] = [];
    currentMessages = mockIntentReplyConversation.messages;
    let replyAdmitted = false;
    const projectStatuses: ProjectStatus[] = [];
    let releaseActiveProject: (() => void) | undefined;
    const activeProjectReady = new Promise<void>((resolve) => {
      releaseActiveProject = resolve;
    });

    globalThis.mswServer.use(
      http.get(
        "http://localhost:3000/api/v1/organizations/:organizationId/projects/:projectId",
        async () => {
          const status = replyAdmitted
            ? ProjectStatus.Active
            : ProjectStatus.Onboarding;
          if (status === ProjectStatus.Active) await activeProjectReady;
          projectStatuses.push(status);
          return HttpResponse.json({
            success: true,
            message: "Request processed successfully",
            data: {
              ...mockProject,
              status,
            },
            timestamp: new Date().toISOString(),
            statusCode: 200,
          });
        },
      ),
      http.get(
        "http://localhost:3000/api/v1/organizations/:organizationId/projects/:projectId/conversations",
        () =>
          HttpResponse.json({
            success: true,
            message: "Request processed successfully",
            data: {
              data: [mockIntentReplyConversation],
              pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
            },
            timestamp: new Date().toISOString(),
            statusCode: 200,
          }),
      ),
      http.post(
        "http://localhost:3000/api/v1/organizations/:organizationId/projects/:projectId/onboarding/conversations/:conversationId/replies",
        async ({ request }) => {
          requests.push(await request.json());
          replyAdmitted = true;
          return HttpResponse.json(
            {
              success: true,
              message: "Reply accepted",
              data: {
                id: "reply-intent-1",
                projectId: mockIntentReplyConversation.projectId,
                type: "USER",
                status: "completed",
                data: {
                  repository_grounding_intent: { choice: "yes" },
                },
                conversationId: mockIntentReplyConversation.id,
                parentMessageId: "reply-parent",
                createdAt: new Date().toISOString(),
              },
              timestamp: new Date().toISOString(),
              statusCode: 202,
            },
            { status: 202 },
          );
        },
      ),
    );

    render(<OnboardingPage />, { wrapper: createTestWrapper() });
    await userEvent
      .setup()
      .click(await screen.findByTestId("existing-work-import"));

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(screen.queryByTestId("location")).not.toBeInTheDocument();
    expect(projectStatuses).toEqual([ProjectStatus.Onboarding]);

    releaseActiveProject?.();

    expect(requests[0]).toEqual({
      parentMessageId: "reply-parent",
      expectedConversationVersion: 33,
      answers: {
        repository_grounding_intent: { choice: "yes" },
      },
    });
    expect(requests[0]).not.toHaveProperty("controllerCredentialId");
    expect(requests[0]).not.toHaveProperty("machineId");
    expect(requests[0]).not.toHaveProperty("repository_prerequisites");
    expect(requests[0]).not.toHaveProperty("repository_analysis_configuration");
    expect(requests[0]).not.toHaveProperty("repository_grounding_action");
    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/projects/5528269f-ab34-48ca-95f4-dd46e8a3393f?tab=help",
      );
    });
    expect(projectStatuses).toEqual([
      ProjectStatus.Onboarding,
      ProjectStatus.Active,
    ]);
  });

  it("routes a reloaded completed existing-work conversation to Help", async () => {
    globalThis.mswServer.use(
      http.get(
        "http://localhost:3000/api/v1/organizations/:organizationId/projects/:projectId",
        () =>
          HttpResponse.json({
            success: true,
            message: "Request processed successfully",
            data: { ...mockProject, status: ProjectStatus.Active },
            timestamp: new Date().toISOString(),
            statusCode: 200,
          }),
      ),
      http.get(
        "http://localhost:3000/api/v1/organizations/:organizationId/projects/:projectId/conversations",
        () =>
          HttpResponse.json({
            success: true,
            message: "Request processed successfully",
            data: {
              data: [mockCompletedIntentConversation],
              pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
            },
            timestamp: new Date().toISOString(),
            statusCode: 200,
          }),
      ),
      http.get(
        "http://localhost:3000/api/v1/organizations/:organizationId/projects/:projectId/conversations/:conversationId",
        () =>
          HttpResponse.json({
            success: true,
            message: "Request processed successfully",
            data: mockCompletedIntentConversation,
            timestamp: new Date().toISOString(),
            statusCode: 200,
          }),
      ),
    );

    render(<OnboardingPage />, {
      wrapper: createTestWrapper(
        "/projects/5528269f-ab34-48ca-95f4-dd46e8a3393f/onboarding?entry=existing&conversationId=aabd4686-a99a-4670-a240-d58484000938",
      ),
    });

    await waitFor(() => {
      expect(screen.getByTestId("location")).toHaveTextContent(
        "/projects/5528269f-ab34-48ca-95f4-dd46e8a3393f?tab=help",
      );
    });
  });

  it("keeps the onboarding form available when admission is rejected", async () => {
    const user = userEvent.setup();
    const requests: unknown[] = [];
    currentMessages = mockReplyMessages;

    globalThis.mswServer.use(
      http.get(
        "http://localhost:3000/api/v1/organizations/:organizationId/projects/:projectId/conversations",
        () =>
          HttpResponse.json({
            success: true,
            message: "Request processed successfully",
            data: {
              data: [mockReplyConversation],
              pagination: { page: 1, limit: 100, total: 1, totalPages: 1 },
            },
            timestamp: new Date().toISOString(),
            statusCode: 200,
          }),
      ),
      http.post(
        "http://localhost:3000/api/v1/organizations/:organizationId/projects/:projectId/onboarding/conversations/:conversationId/replies",
        async ({ request }) => {
          requests.push(await request.json());
          return HttpResponse.json(
            {
              success: false,
              message: "The onboarding form is stale.",
              data: null,
              timestamp: new Date().toISOString(),
              statusCode: 409,
            },
            { status: 409 },
          );
        },
      ),
    );

    render(<OnboardingPage />, { wrapper: createTestWrapper() });

    const field = await screen.findByTestId("textarea-field-project_concept");
    const textarea = within(field).getByRole("textbox");
    await user.type(textarea, "Keep this onboarding draft");
    await user.click(
      await screen.findByTestId("run-stream-external-reply-submit"),
    );

    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toEqual({
      parentMessageId: "reply-parent",
      expectedConversationVersion: 33,
      answers: { project_concept: "Keep this onboarding draft" },
    });
    expect(screen.getByTestId("dynamic-form")).toBeInTheDocument();
    expect(textarea).toHaveValue("Keep this onboarding draft");
  });
});
