import { http, HttpResponse } from "msw";
import { flattenFixtureMessages } from "../../../../test/conversationFixtures";
import { createStore, Provider } from "jotai";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { messageKeys } from "../../../../data/collections/messages";
import {
  buildConversationMessageHistoryKey,
  recordInitialConversationMessageHistoryPage,
  resetConversationMessageHistoryStateForTests,
} from "../../../../data/collections/conversationMessageHistoryState";
import React from "react";
import { render } from "@testing-library/react";
import { vi } from "vitest";
import {
  ConversationStatus,
  InitiationType,
  ProjectMaturity,
  WorkflowName,
  type ConversationResponseDto,
  type ProjectResponseDto,
  type MessageResponseDto,
} from "../../../../api";
import type { ConversationMessage } from "../../../../types/conversation";
import type { WorkflowState } from "../../../../types/WorkflowState";
import type { ConversationFormResolver } from "../conversationFormTypes";

type RenderOptions = {
  timeline?: ConversationMessage[];
  workflowStatus?: Partial<WorkflowState>;
  isSubmitting?: boolean;
  animationType?: "fun" | "minimal";
  readOnly?: boolean;
  composerResetMode?: "preserve" | "clearOnSuccess";
  agentSessionId?: string;
  taskMonitorId?: string;
  conversationFormResolver?: ConversationFormResolver;
  projectOverride?: ProjectResponseDto;
  conversationOverride?: ConversationResponseDto;
  shouldShowForm?: boolean;
  isQuestionsMessage?: boolean;
  isInitiativesMessage?: boolean;
  isWorkItemMessage?: boolean;
  calculateMessageStatus?: string;
  isFormSubmissionDisabled?: boolean;
  isFormSubmitted?: boolean;
  isFinalStep?: boolean;
  formInitialData?: Record<string, unknown>;
  formContext?: Record<string, unknown>;
  secondActions?: unknown[];
  onNext?: ReturnType<typeof vi.fn>;
  onRetrySuccess?: ReturnType<typeof vi.fn>;
  onAnalysisAcknowledged?: ReturnType<typeof vi.fn>;
  historyCursor?: string;
  initialScrollReady?: boolean;
};

type RenderWithConversationProviderResult = ReturnType<typeof render> & {
  onNext: ReturnType<typeof vi.fn>;
  onRetrySuccess: ReturnType<typeof vi.fn>;
  onAnalysisAcknowledged: ReturnType<typeof vi.fn>;
};

const hoistedMocks = vi.hoisted(() => ({
  mockUseConversationSubmission: vi.fn(),
  mockUseConversationScrolling: vi.fn(),
  mockUseUserIdentity: vi.fn(),
  mockUseWorkflowStatus: vi.fn(),
  mockCollectSystemMessages: vi.fn(),
  mockIsRoutingMessage: vi.fn(),
  mockIsExternalAgentTriggerMessage: vi.fn(),
  mockIsEmptyExternalAgentCompletionMessage: vi.fn(),
  mockIsHiddenQuestionsMessage: vi.fn(),
  mockDetermineMessageState: vi.fn(),
  mockShouldShowForm: vi.fn(),
  mockIsQuestionsMessage: vi.fn(),
  mockIsInitiativesMessage: vi.fn(),
  mockIsWorkItemMessage: vi.fn(),
  mockCalculateMessageStatus: vi.fn(),
  mockPrepareFormInitialData: vi.fn(),
  mockIsFormSubmissionDisabled: vi.fn(),
  mockIsFormSubmitted: vi.fn(),
  mockIsFinalStep: vi.fn(),
  mockCreateFormContext: vi.fn(),
  mockCreateEnhancedSecondAction: vi.fn(),
  mockGetButtonSecondAction: vi.fn(),
}));

vi.mock("../../../../components/Conversation/hooks", () => ({
  __esModule: true,
  useConversationSubmission: (...args: unknown[]) =>
    hoistedMocks.mockUseConversationSubmission(...args),
  useConversationScrolling: (...args: unknown[]) =>
    hoistedMocks.mockUseConversationScrolling(...args),
}));

vi.mock("../../../../components/Conversation/hooks/index", () => ({
  __esModule: true,
  useConversationSubmission: (...args: unknown[]) =>
    hoistedMocks.mockUseConversationSubmission(...args),
  useConversationScrolling: (...args: unknown[]) =>
    hoistedMocks.mockUseConversationScrolling(...args),
}));

vi.mock("../../../../hooks", () => ({
  __esModule: true,
  useUserIdentity: () => ({ userId: "test-user" }),
}));

vi.mock("../../../../hooks/index", () => ({
  __esModule: true,
  useUserIdentity: () => ({ userId: "test-user" }),
}));

vi.mock("../../../../hooks/useUserIdentity", () => ({
  __esModule: true,
  useUserIdentity: () => ({ userId: "test-user" }),
}));

vi.mock("../../../../hooks/useWorkflowStatus", () => ({
  __esModule: true,
  useWorkflowStatus: (...args: unknown[]) =>
    hoistedMocks.mockUseWorkflowStatus(...args),
}));

vi.mock("../../../../contexts/TrackingContext", () => ({
  __esModule: true,
  useUserAction: () => ({
    trackUI: vi.fn(),
  }),
}));

vi.mock("../../../../services/authService", () => ({
  __esModule: true,
  getAuthToken: vi.fn(() => null),
  getCurrentUser: vi.fn(() => null),
  refreshAuthToken: vi.fn(() => Promise.resolve(null)),
  login: vi.fn(async () => ({
    accessToken: "token",
    refreshToken: "refresh",
    user: { id: "user-123" },
  })),
  logout: vi.fn(async () => {}),
  toggleDevAdminMode: vi.fn(async () => ({ user: { id: "user-123" } })),
}));

vi.mock("../../../../contexts/AuthContext", () => ({
  __esModule: true,
  AuthProvider: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  useAuth: () => ({
    isAuthenticated: true,
    user: { id: "user-123" },
    loading: false,
    login: vi.fn(),
    logout: vi.fn(),
    toggleDevAdminMode: vi.fn(),
  }),
}));

vi.mock("../../utils", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../utils")>()),
  __esModule: true,
  collectSystemMessages: (...args: unknown[]) =>
    hoistedMocks.mockCollectSystemMessages(...args),
  isRoutingMessage: (...args: unknown[]) =>
    hoistedMocks.mockIsRoutingMessage(...args),
  isExternalAgentTriggerMessage: (...args: unknown[]) =>
    hoistedMocks.mockIsExternalAgentTriggerMessage(...args),
  isEmptyExternalAgentCompletionMessage: (...args: unknown[]) =>
    hoistedMocks.mockIsEmptyExternalAgentCompletionMessage(...args),
  isHiddenQuestionsMessage: (...args: unknown[]) =>
    hoistedMocks.mockIsHiddenQuestionsMessage(...args),
}));

vi.mock("../../utils/messageStateUtils", () => ({
  __esModule: true,
  determineMessageState: (...args: unknown[]) =>
    hoistedMocks.mockDetermineMessageState(...args),
  shouldShowForm: (...args: unknown[]) =>
    hoistedMocks.mockShouldShowForm(...args),
  isQuestionsMessage: (...args: unknown[]) =>
    hoistedMocks.mockIsQuestionsMessage(...args),
  isInitiativesMessage: (...args: unknown[]) =>
    hoistedMocks.mockIsInitiativesMessage(...args),
  isWorkItemMessage: (...args: unknown[]) =>
    hoistedMocks.mockIsWorkItemMessage(...args),
}));

vi.mock("../../utils/messageStatusCalculator", () => ({
  __esModule: true,
  calculateMessageStatus: (...args: unknown[]) =>
    hoistedMocks.mockCalculateMessageStatus(...args),
}));

vi.mock("../../utils/conversationFormHelpers", async (importOriginal) => ({
  ...(await importOriginal<
    typeof import("../../utils/conversationFormHelpers")
  >()),
  __esModule: true,
  prepareFormInitialData: (...args: unknown[]) =>
    hoistedMocks.mockPrepareFormInitialData(...args),
  isFormSubmissionDisabled: (...args: unknown[]) =>
    hoistedMocks.mockIsFormSubmissionDisabled(...args),
  isFormSubmitted: (...args: unknown[]) =>
    hoistedMocks.mockIsFormSubmitted(...args),
  isFinalStep: (...args: unknown[]) => hoistedMocks.mockIsFinalStep(...args),
  createFormContext: (...args: unknown[]) =>
    hoistedMocks.mockCreateFormContext(...args),
  createEnhancedSecondAction: (...args: unknown[]) =>
    hoistedMocks.mockCreateEnhancedSecondAction(...args),
  getButtonSecondActions: (...args: unknown[]) =>
    hoistedMocks.mockGetButtonSecondAction(...args),
}));

export const {
  mockUseConversationSubmission,
  mockUseConversationScrolling,
  mockUseUserIdentity,
  mockUseWorkflowStatus,
  mockCollectSystemMessages,
  mockIsRoutingMessage,
  mockIsExternalAgentTriggerMessage,
  mockIsEmptyExternalAgentCompletionMessage,
  mockIsHiddenQuestionsMessage,
  mockDetermineMessageState,
  mockShouldShowForm,
  mockIsQuestionsMessage,
  mockIsInitiativesMessage,
  mockIsWorkItemMessage,
  mockCalculateMessageStatus,
  mockPrepareFormInitialData,
  mockIsFormSubmissionDisabled,
  mockIsFormSubmitted,
  mockIsFinalStep,
  mockCreateFormContext,
  mockCreateEnhancedSecondAction,
  mockGetButtonSecondAction,
} = hoistedMocks;

export const createMockMessage = (
  overrides: Partial<MessageResponseDto> = {},
): MessageResponseDto =>
  ({
    id: "test-message-id",
    projectId: "test-project-id",
    userId: "test-user-id",
    type: "SYSTEM",
    status: "COMPLETED",
    data: {
      type: "QUESTIONS",
      response: "Test response",
      uiElements: [],
      uiHints: { estimatedDelayMs: 5000 },
    },
    responses: [],
    createdAt: "2023-01-01T00:00:00Z",
    awaitingResponse: false,
    ...overrides,
  }) as MessageResponseDto;

export const createMockConversationMessage = (
  overrides: Partial<ConversationMessage> = {},
): ConversationMessage => ({
  message: createMockMessage(),
  state: "completed",
  canEdit: true,
  ...overrides,
});

export const createMockProject = (
  overrides: Partial<ProjectResponseDto> = {},
): ProjectResponseDto => ({
  maturity: ProjectMaturity.Established,
  id: "test-project-id",
  organizationId: "test-org-id",
  name: "Test Project",
  description: "Test Description",
  status: "ACTIVE" as ProjectResponseDto["status"],
  currentUserRole: "OWNER" as ProjectResponseDto["currentUserRole"],
  createdAt: "2023-01-01T00:00:00Z",
  updatedAt: "2023-01-01T00:00:00Z",
  ...overrides,
  hasEstablishedActivity: overrides.hasEstablishedActivity ?? false,
});

export const createMockConversation = (
  overrides: Partial<ConversationResponseDto> = {},
): ConversationResponseDto => ({
  id: "test-conversation-id",
  createdBy: null,
  projectId: "test-project-id",
  organizationId: "test-org-id",
  title: "Test Conversation",
  status: ConversationStatus.Started,
  initiatedBy: InitiationType.User,
  version: 1,
  workflowName: WorkflowName.Onboarding,
  createdAt: "2023-01-01T00:00:00Z",
  updatedAt: "2023-01-01T00:00:00Z",
  ...overrides,
});

const buildWorkflowStatus = (
  overrides: RenderOptions["workflowStatus"],
): WorkflowState => ({
  status: overrides?.status ?? "ready",
  message: overrides?.message ?? "",
  canSubmit: overrides?.canSubmit ?? true,
  showLoader: overrides?.showLoader ?? false,
  processingUser: overrides?.processingUser,
});

export const renderWithConversationProvider = async (
  ui: React.ReactElement,
  {
    timeline = [createMockConversationMessage()],
    workflowStatus,
    isSubmitting = false,
    animationType = "fun",
    readOnly = false,
    composerResetMode = "preserve",
    agentSessionId,
    taskMonitorId,
    conversationFormResolver,
    projectOverride,
    conversationOverride,
    shouldShowForm = true,
    isQuestionsMessage = true,
    isInitiativesMessage = false,
    isWorkItemMessage = false,
    calculateMessageStatus = "idle",
    isFormSubmissionDisabled = false,
    isFormSubmitted = false,
    isFinalStep = true,
    formInitialData = {},
    formContext = {},
    secondActions,
    onNext = vi.fn(),
    onRetrySuccess = vi.fn(),
    onAnalysisAcknowledged = vi.fn(),
    historyCursor,
    initialScrollReady = true,
  }: RenderOptions = {},
): Promise<RenderWithConversationProviderResult> => {
  mockCollectSystemMessages.mockImplementation(() => ({
    systemMessages: timeline.map((item) => item.message),
    activeStep: 0,
  }));

  mockDetermineMessageState.mockImplementation(
    (message: MessageResponseDto) => {
      return (
        timeline.find((item) => item.message.id === message.id)?.state ??
        "completed"
      );
    },
  );

  mockIsRoutingMessage.mockReturnValue(false);
  mockIsExternalAgentTriggerMessage.mockReturnValue(false);
  mockIsEmptyExternalAgentCompletionMessage.mockReturnValue(false);
  mockIsHiddenQuestionsMessage.mockReturnValue(false);

  mockUseConversationSubmission.mockReturnValue({
    isSubmitting,
    versionConflictDialog: null,
    handleNext: onNext,
    handleRetrySuccess: onRetrySuccess,
    handleAnalysisAcknowledged: onAnalysisAcknowledged,
  });

  mockUseConversationScrolling.mockReturnValue({
    handleStepClick: vi.fn(),
    loadOlderMessages: async (loadOlder: () => Promise<void>) => loadOlder(),
    initialScrollReady,
  });

  mockUseWorkflowStatus.mockReturnValue({
    ...buildWorkflowStatus(workflowStatus),
    canSubmit: workflowStatus?.canSubmit ?? true,
  });

  mockShouldShowForm.mockImplementation(() => shouldShowForm);
  mockIsQuestionsMessage.mockImplementation(() => isQuestionsMessage);
  mockIsInitiativesMessage.mockImplementation(() => isInitiativesMessage);
  mockIsWorkItemMessage.mockImplementation(() => isWorkItemMessage);
  mockCalculateMessageStatus.mockImplementation(() => calculateMessageStatus);
  mockIsFormSubmissionDisabled.mockImplementation(
    () => isFormSubmissionDisabled,
  );
  mockIsFormSubmitted.mockImplementation(() => isFormSubmitted);
  mockIsFinalStep.mockImplementation(() => isFinalStep);
  mockPrepareFormInitialData.mockImplementation(() => formInitialData);
  mockCreateFormContext.mockImplementation(() => formContext);
  mockGetButtonSecondAction.mockImplementation(() => secondActions ?? []);

  const project = projectOverride ?? createMockProject();
  const conversation = conversationOverride ?? createMockConversation();

  const [{ ConversationProvider }, { AuthProvider }] = await Promise.all([
    import("../ConversationContext"),
    import("../../../../contexts/AuthContext"),
  ]);

  const store = createStore();
  resetConversationMessageHistoryStateForTests();
  if (historyCursor) {
    recordInitialConversationMessageHistoryPage(
      buildConversationMessageHistoryKey({
        organizationId: conversation.organizationId,
        projectId: conversation.projectId,
        conversationId: conversation.id,
      }),
      historyCursor,
    );
  }
  const canonicalMessages = flattenFixtureMessages(
    timeline.map((item) => item.message),
  );
  globalThis.mswServer.use(
    http.get(
      `*/api/v1/organizations/${conversation.organizationId}/projects/${conversation.projectId}/conversations/${conversation.id}/queued-inputs`,
      () =>
        HttpResponse.json({
          data: canonicalMessages.filter(
            (message) => message.executionStatus === "queued",
          ),
        }),
    ),
    http.get(
      "*/api/v1/organizations/" +
        conversation.organizationId +
        "/projects/" +
        conversation.projectId +
        "/messages",
      ({ request }) => {
        const mode = new URL(request.url).searchParams.get("mode");
        return HttpResponse.json({
          success: true,
          data:
            mode === "REVERSE_HISTORY"
              ? { messages: canonicalMessages }
              : canonicalMessages,
        });
      },
    ),
  );
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retryDelay: 0 } },
  });
  queryClient.setQueryData(
    messageKeys.list(
      conversation.organizationId,
      conversation.projectId,
      conversation.id,
    ),
    canonicalMessages,
  );
  const renderResult = render(
    <QueryClientProvider client={queryClient}>
      <Provider store={store}>
        <AuthProvider>
          <ConversationProvider
            scrollPolicy={{ mode: "disabled" }}
            conversation={conversation}
            project={project}
            animationType={animationType}
            readOnly={readOnly}
            composerResetMode={composerResetMode}
            agentSessionId={agentSessionId}
            taskMonitorId={taskMonitorId}
            conversationFormResolver={conversationFormResolver}
            suggestionDecisions={{
              getRoutingDecision: () => undefined,
              upsertRoutingDecision: vi.fn(),
              decisionsById: {},
              getDecision: () => undefined,
              upsertDecision: vi.fn(),
            }}
          >
            {ui}
          </ConversationProvider>
        </AuthProvider>
      </Provider>
    </QueryClientProvider>,
  );

  return {
    ...renderResult,
    onNext,
    onRetrySuccess,
    onAnalysisAcknowledged,
  };
};
