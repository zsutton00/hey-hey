import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { vi } from "vitest";
import type { ComponentProps } from "react";
import { ConversationMessage as ResolvedConversationMessage } from "../ConversationMessage";
import { resolveConversationForm } from "../../utils/conversationResponseModel";

const ConversationMessage = (props: ComponentProps<typeof ResolvedConversationMessage>) => {
  const context = useConversationContext();
  context.resolvedForms = new Map([[props.conversationMessage.message.id, resolveConversationForm(
    props.conversationMessage, props.messageIndex === props.totalMessages - 1, {
      workflowCanSubmit: context.workflowStatus.canSubmit, isSubmitting: context.isSubmitting,
      readOnly: context.isReadOnly, isCliInputDisabled: false,
    },
  )]]);
  return <ResolvedConversationMessage {...props} />;
};
import { useConversationContext } from "../ConversationContext";
import { getProposalsRenderConfig } from "../../../LlmForms/Registry";
import { getReportConfig } from "../../../Reports/reportConfig";
import type { ConversationMessage as ConversationMessageType } from "../../../../types/conversation";
import type {
  AgentSystemMessageData,
  ConversationResponseDto,
  ProjectResponseDto,
  ProposalResponseDto,
  TaskMonitorInterventionSystemMessageData,
  TaskMonitorSupervisionSystemMessageData,
} from "../../../../api";
import {
  ProposalAction,
  ProposalGroupLifecycle,
  ProposalStatus,
  ProposalType,
  SystemMessageDataTypeEnum,
  TargetEntityType,
  UserMessageAgentInputProvenance,
} from "../../../../api";
import {
  AgentSessionCurrentState,
  MessageType,
  ReportAudience,
  ReportType,
} from "../../../../api";

// Mock dependencies
vi.mock("../ConversationContext", () => ({
  useConversationContext: vi.fn(),
}));
vi.mock("../SystemMessageWithRetry", () => ({
  SystemMessageWithRetry: ({
    "data-testid": testId = "system-message-retry",
    inlineReports = [],
  }) => (
    <div data-testid={testId}>
      SystemMessageWithRetry Component
      <div data-testid={`${testId}-inline-reports`}>
        {inlineReports.map((report) => report.reportType).join(",")}
      </div>
    </div>
  ),
}));

vi.mock("../../../shared/ReportActions", () => ({
  ReportActions: ({ reports }) => (
    <div data-testid="report-actions">
      {reports.map((report) => report.reportType).join(",")}
    </div>
  ),
}));

vi.mock("../../AnalysisMessage", () => ({
  AnalysisMessage: ({ "data-testid": testId = "analysis-message" }) => (
    <div data-testid={testId}>AnalysisMessage Component</div>
  ),
}));

vi.mock("../ConversationFormRenderer", () => ({
  ConversationFormRenderer: ({
    "data-testid": testId = "form-renderer",
    resolvedForm: { inlineReports, interactiveReportAttachments },
  }: {
    "data-testid"?: string;
    resolvedForm: import("../../utils/conversationResponseModel").ResolvedConversationForm;
  }) => (
    <div data-testid={testId}>
      ConversationFormRenderer Component
      <div data-testid={`${testId}-inline-reports`}>
        {inlineReports.map((report) => report.reportType).join(",")}
      </div>
      <div
        data-testid={`${testId}-interactive-reports`}
        data-source-ui-element-id={
          interactiveReportAttachments[0]?.responseUiElement.id
        }
      >
        {interactiveReportAttachments
          .map(({ report }) => report.reportType)
          .join(",")}
      </div>
    </div>
  ),
}));

vi.mock("../TaskMonitorInterventionMessage", () => ({
  TaskMonitorInterventionMessage: ({
    data,
  }: {
    data: TaskMonitorInterventionSystemMessageData;
  }) => (
    <div
      data-testid="task-monitor-intervention-message"
      data-intervention-id={data.interventionId}
    />
  ),
}));

vi.mock("../MessageProposals", () => ({
  MessageProposals: () => (
    <div data-testid="message-proposals">MessageProposals Component</div>
  ),
}));

vi.mock("../../../LlmForms/Registry", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../../LlmForms/Registry")
  >();
  return {
    ...actual,
    getProposalsRenderConfig: vi.fn(actual.getProposalsRenderConfig),
  };
});

vi.mock("../../../Reports/reportConfig", async (importOriginal) => {
  const actual = await importOriginal<
    typeof import("../../../Reports/reportConfig")
  >();
  return {
    ...actual,
    getReportConfig: vi.fn(actual.getReportConfig),
  };
});

describe("ConversationMessage", () => {
  const mockProject: ProjectResponseDto = {
    id: "project-1",
    organizationId: "org-1",
    name: "Test Project",
    description: "Test Description",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  };

  const mockConversation: ConversationResponseDto = {
    id: "conv-1",
    projectId: "project-1",
    workflowId: "workflow-1",
    status: "ACTIVE",
    createdAt: "2024-01-01T00:00:00Z",
    updatedAt: "2024-01-01T00:00:00Z",
  };

  const mockWorkflowStatus = {
    status: "ready" as const,
    message: "",
    canSubmit: true,
    showLoader: false,
  };
  const mockOnNext = vi.fn();
  const mockOnAnalysisAcknowledged = vi.fn().mockResolvedValue(undefined);
  const mockOnRetrySuccess = vi.fn().mockResolvedValue(undefined);
  const mockHandleNext = vi.fn().mockResolvedValue(undefined);
  const mockHandleStepClick = vi.fn();
  let mockConversationContext: ReturnType<typeof useConversationContext>;

  const createMockConversationMessage = (
    overrides: Partial<ConversationMessageType> = {}
  ): ConversationMessageType => ({
    message: {
      id: "msg-1",
      conversationId: "conv-1",
      projectId: "project-1",
      workflowId: "workflow-1",
      type: MessageType.System,
      status: "COMPLETED",
      data: {
        type: "QUESTIONS",
        response: "Test response",
        uiHints: { title: "Test Title" },
        uiElements: [],
      },
      createdAt: "2024-01-01T00:00:00Z",
      parentMessageId: null,
      awaitingResponse: false,
      responses: [],
    },
    state: "completed",
    canEdit: false,
    ...overrides,
  });

  const renderSupervisionDecision = (
    data: TaskMonitorSupervisionSystemMessageData
  ) => {
    const conversationMessage = createMockConversationMessage({
      message: {
        ...createMockConversationMessage().message,
        data,
      },
    });

    render(
      <MemoryRouter>
        <ConversationMessage
          conversationMessage={conversationMessage}
          messageIndex={0}
          totalMessages={1}
        />
      </MemoryRouter>
    );
  };

  beforeEach(() => {
    vi.clearAllMocks();

    mockConversationContext = {
      conversationTimeline: [createMockConversationMessage()],
      activeConversation: mockConversation,
      project: mockProject,
      workflowStatus: mockWorkflowStatus,
      isSubmitting: false,
      versionConflictDialog: null,
      handleNext: mockHandleNext,
      handleRetrySuccess: mockOnRetrySuccess,
      handleAnalysisAcknowledged: mockOnAnalysisAcknowledged,
      handleStepClick: mockHandleStepClick,
      animationType: "minimal",
      isReadOnly: false,
    };
    vi.mocked(useConversationContext).mockReturnValue(mockConversationContext);
  });

  it("renders conversation message container with correct attributes", () => {
    const conversationMessage = createMockConversationMessage();

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
      />
    );

    const container = screen.getByTestId("msg-1");
    expect(container).toBeInTheDocument();
    expect(container).toHaveAttribute("data-step-index", "0");
  });

  it("renders custom data-testid when provided", () => {
    const conversationMessage = createMockConversationMessage();

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        data-testid="custom-message"
        messageIndex={0}
        totalMessages={1}
      />
    );

    expect(screen.getByTestId("custom-message")).toBeInTheDocument();
  });

  it("renders SystemMessageWithRetry when message has response", () => {
    const conversationMessage = createMockConversationMessage({
      message: {
        ...createMockConversationMessage().message,
        data: {
          type: "QUESTIONS",
          response: "Test response",
          uiHints: { title: "Test Title" },
        },
      },
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
      />
    );

    expect(screen.getByTestId("system-message-retry")).toBeInTheDocument();
  });

  it("renders SystemMessageWithRetry when message state is error", () => {
    const conversationMessage = createMockConversationMessage({
      state: "error",
      message: {
        ...createMockConversationMessage().message,
        data: {
          type: "QUESTIONS",
          uiHints: { title: "Test Title" },
        },
      },
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
      />
    );

    expect(screen.getByTestId("system-message-retry")).toBeInTheDocument();
  });

  it("routes a Task Monitor intervention through its typed renderer", () => {
    const data: TaskMonitorInterventionSystemMessageData = {
      type: SystemMessageDataTypeEnum.TaskMonitorIntervention,
      response: "An exact action requires a human decision.",
      agentIdentity: "task-monitor-coordinator",
      interventionId: "22222222-2222-4222-8222-222222222222",
      providerActionId: "provider-action-1",
      runId: "33333333-3333-4333-8333-333333333333",
      agentSessionId: "44444444-4444-4444-8444-444444444444",
      action: "Delete the production deployment",
      target: "Production deployment",
      fingerprint: "immutable-fingerprint",
      createdAt: "2026-08-10T00:00:00.000Z",
      expiresAt: "2026-08-10T01:00:00.000Z",
      choices: new Set(["APPROVE", "DENY"]),
    };
    const conversationMessage = createMockConversationMessage({
      message: {
        ...createMockConversationMessage().message,
        type: MessageType.System,
        data,
      },
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
      />
    );

    expect(
      screen.getByTestId("task-monitor-intervention-message")
    ).toHaveAttribute(
      "data-intervention-id",
      "22222222-2222-4222-8222-222222222222"
    );
    expect(
      screen.queryByTestId("system-message-retry")
    ).not.toBeInTheDocument();
  });

  it("renders an accepted Task Monitor supervision decision", () => {
    const data: TaskMonitorSupervisionSystemMessageData = {
      type: SystemMessageDataTypeEnum.TaskMonitorSupervision,
      response: "The task was accepted.",
      agentIdentity: "task-monitor-coordinator",
      outcome: "ACCEPTED",
      rationale: "The implementation **satisfies** the acceptance criteria.",
    };
    renderSupervisionDecision(data);

    expect(screen.getByTestId("supervision-decision-message")).toBeVisible();
    expect(
      screen.getByTestId("supervision-decision-outcome")
    ).toHaveTextContent("Accepted");
    expect(
      screen.getByTestId("supervision-decision-rationale")
    ).toHaveTextContent(
      "The implementation **satisfies** the acceptance criteria."
    );
    expect(
      screen.queryByTestId("supervision-decision-guidance")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId("system-message-retry")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("The task was accepted.")
    ).not.toBeInTheDocument();
  });

  it("renders a Task Monitor request-changes decision with guidance", () => {
    const data: TaskMonitorSupervisionSystemMessageData = {
      type: SystemMessageDataTypeEnum.TaskMonitorSupervision,
      response: "Changes were requested.",
      agentIdentity: "task-monitor-coordinator",
      outcome: "CHANGES_REQUESTED",
      rationale: "The focused test does not cover the failure path.",
      guidance:
        "Add **coverage** for @[feature:8be2f12f-4313-427a-a279-70f94136f0c6|@ Mention Nodes].",
    };
    renderSupervisionDecision(data);

    expect(screen.getByTestId("supervision-decision-message")).toBeVisible();
    expect(
      screen.getByTestId("supervision-decision-outcome")
    ).toHaveTextContent("Changes requested");
    expect(
      screen.getByTestId("supervision-decision-rationale")
    ).toHaveTextContent("The focused test does not cover the failure path.");
    expect(
      screen.getByTestId("supervision-decision-guidance")
    ).toHaveTextContent("Add **coverage** for @ Mention Nodes.");
    expect(screen.getByTestId("mention-badge")).toHaveAttribute(
      "data-mention-token",
      "@[feature:8be2f12f-4313-427a-a279-70f94136f0c6|@ Mention Nodes]"
    );
    expect(
      screen.queryByTestId("system-message-retry")
    ).not.toBeInTheDocument();
    expect(
      screen.queryByText("Changes were requested.")
    ).not.toBeInTheDocument();
  });

  const reviewLifecycleCases = [
    {
      data: {
        type: SystemMessageDataTypeEnum.TaskMonitorSupervision,
        response: "Review is being requested.",
        agentIdentity: "task-monitor-coordinator",
        outcome: "REQUESTING_REVIEW",
        requestId: "11111111-1111-4111-8111-111111111111",
        rationale: "The review request has been committed.",
      },
      expectedLabel: "Requesting review",
    },
    {
      data: {
        type: SystemMessageDataTypeEnum.TaskMonitorSupervision,
        response: "Review is pending.",
        agentIdentity: "task-monitor-coordinator",
        outcome: "AWAITING_REVIEW",
        requestId: "22222222-2222-4222-8222-222222222222",
        rationale: "The implementation is awaiting independent review.",
      },
      expectedLabel: "Awaiting review",
    },
    {
      data: {
        type: SystemMessageDataTypeEnum.TaskMonitorSupervision,
        response: "The review request failed.",
        agentIdentity: "task-monitor-coordinator",
        outcome: "REVIEW_REQUEST_FAILED",
        requestId: "33333333-3333-4333-8333-333333333333",
        rationale: "The review provider rejected the request.",
        failureContext: "The provider returned an invalid response.",
      },
      expectedLabel: "Review request failed",
      detailTestId: "supervision-decision-failure-context",
      expectedDetail: "The provider returned an invalid response.",
    },
    {
      data: {
        type: SystemMessageDataTypeEnum.TaskMonitorSupervision,
        response: "The review request is being reconciled.",
        agentIdentity: "task-monitor-coordinator",
        outcome: "REVIEW_REQUEST_RECONCILING",
        requestId: "44444444-4444-4444-8444-444444444444",
        rationale: "The review request has an uncertain provider result.",
        recoveryContext: "Checking whether the provider accepted the request.",
      },
      expectedLabel: "Reconciling review request",
      detailTestId: "supervision-decision-recovery-context",
      expectedDetail: "Checking whether the provider accepted the request.",
    },
    {
      data: {
        type: SystemMessageDataTypeEnum.TaskMonitorSupervision,
        response: "Review recovery needs judgment.",
        agentIdentity: "task-monitor-coordinator",
        outcome: "REVIEW_RECOVERY_JUDGMENT_REQUIRED",
        requestId: "55555555-5555-4555-8555-555555555555",
        rationale: "Automatic recovery cannot determine the review state.",
        recoveryContext: "Choose whether to retry or abandon the review.",
      },
      expectedLabel: "Review recovery judgment required",
      detailTestId: "supervision-decision-recovery-context",
      expectedDetail: "Choose whether to retry or abandon the review.",
    },
  ] satisfies ReadonlyArray<{
    data: TaskMonitorSupervisionSystemMessageData;
    expectedLabel: string;
    detailTestId?: string;
    expectedDetail?: string;
  }>;

  it.each(reviewLifecycleCases)(
    "renders the $data.outcome Task Monitor review lifecycle state",
    ({ data, expectedLabel, detailTestId, expectedDetail }) => {
      renderSupervisionDecision(data);

      expect(
        screen.getByTestId("supervision-decision-outcome")
      ).toHaveTextContent(expectedLabel);
      expect(
        screen.getByTestId("supervision-decision-rationale")
      ).toHaveTextContent(data.rationale);
      if (detailTestId && expectedDetail) {
        expect(screen.getByTestId(detailTestId)).toHaveTextContent(
          expectedDetail
        );
      }
      expect(screen.queryByText(data.requestId)).not.toBeInTheDocument();
    }
  );

  it("renders a waiting Task Monitor supervision decision", () => {
    renderSupervisionDecision({
      type: SystemMessageDataTypeEnum.TaskMonitorSupervision,
      response: "Supervision is waiting.",
      agentIdentity: "task-monitor-coordinator",
      outcome: "WAITING",
      rationale: "Canonical completion evidence has not arrived yet.",
    });

    expect(
      screen.getByTestId("supervision-decision-outcome")
    ).toHaveTextContent("Waiting");
    expect(
      screen.getByTestId("supervision-decision-rationale")
    ).toHaveTextContent("Canonical completion evidence has not arrived yet.");
  });

  it("renders a Task Monitor judgment request with guidance", () => {
    renderSupervisionDecision({
      type: SystemMessageDataTypeEnum.TaskMonitorSupervision,
      response: "Judgment was requested.",
      agentIdentity: "task-monitor-coordinator",
      outcome: "JUDGMENT_REQUESTED",
      rationale: "The available evidence does not resolve the product choice.",
      guidance: "Choose whether compatibility or strict validation wins.",
    });

    expect(
      screen.getByTestId("supervision-decision-outcome")
    ).toHaveTextContent("Judgment requested");
    expect(
      screen.getByTestId("supervision-decision-rationale")
    ).toHaveTextContent(
      "The available evidence does not resolve the product choice."
    );
    expect(
      screen.getByTestId("supervision-decision-guidance")
    ).toHaveTextContent(
      "Choose whether compatibility or strict validation wins."
    );
  });

  it("renders a halted Task Monitor supervision decision with failure context", () => {
    renderSupervisionDecision({
      type: SystemMessageDataTypeEnum.TaskMonitorSupervision,
      response: "Supervision halted.",
      agentIdentity: "task-monitor-coordinator",
      outcome: "HALTED",
      rationale: "The released Turn cannot be evaluated safely.",
      failureContext: "The **canonical** Agent Session could not be resolved.",
    });

    expect(
      screen.getByTestId("supervision-decision-outcome")
    ).toHaveTextContent("Halted");
    expect(
      screen.getByTestId("supervision-decision-rationale")
    ).toHaveTextContent("The released Turn cannot be evaluated safely.");
    expect(
      screen.getByTestId("supervision-decision-failure-context")
    ).toHaveTextContent(
      "The **canonical** Agent Session could not be resolved."
    );
  });

  it("renders AnalysisMessage for ANALYSIS type messages with awaitingResponse", () => {
    const conversationMessage = createMockConversationMessage({
      message: {
        ...createMockConversationMessage().message,
        type: MessageType.System,
        data: {
          type: "ANALYSIS",
          response: "Analysis response",
          uiHints: { title: "Analysis Title" },
        },
        awaitingResponse: true,
      },
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
      />
    );

    expect(screen.getByTestId("analysis-message")).toBeInTheDocument();
  });

  it("does not render AnalysisMessage when not awaiting response", () => {
    const conversationMessage = createMockConversationMessage({
      message: {
        ...createMockConversationMessage().message,
        type: MessageType.System,
        data: {
          type: "ANALYSIS",
          response: "Analysis response",
          uiHints: { title: "Analysis Title" },
        },
        awaitingResponse: false,
      },
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
      />
    );

    expect(screen.queryByTestId("analysis-message")).not.toBeInTheDocument();
  });

  it("keeps a response-less carrier's proposal and inline/modal reports at its own boundary", () => {
    vi.mocked(getReportConfig)
      .mockReturnValueOnce({ presentation: "inline" })
      .mockReturnValueOnce({ presentation: "modal" });

    const conversationMessage = createMockConversationMessage({
      message: {
        ...createMockConversationMessage().message,
        id: "carrier-message-id",
        proposals: [{ id: "carrier-proposal" }],
        reports: [
          {
            id: "carrier-inline-report",
            organizationId: "org-1",
            audience: ReportAudience.ProjectVisible,
            version: 1,
            schemaVersion: 1,
            sourceExecutionId: "run-1",
            createdAt: "2026-06-30T00:00:00.000Z",
            expiresAt: null,
            entities: [],
            reportType: ReportType.Snapshot,
            title: "Carrier Snapshot",
            payload: {},
          },
          {
            id: "carrier-modal-report",
            organizationId: "org-1",
            audience: ReportAudience.ProjectVisible,
            version: 1,
            schemaVersion: 1,
            sourceExecutionId: "run-1",
            createdAt: "2026-06-30T00:00:01.000Z",
            expiresAt: null,
            entities: [],
            reportType: ReportType.Implement,
            title: "Carrier Implement",
            payload: {},
          },
        ],
        data: { type: "CARRIER" },
      } as never,
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
        data-testid="carrier-message"
      />
    );

    expect(screen.getByTestId("carrier-message")).toHaveAttribute(
      "data-message-id",
      "carrier-message-id"
    );
    expect(screen.getByTestId("message-proposals")).toBeInTheDocument();
    expect(
      screen.getByTestId("system-message-retry-inline-reports")
    ).toHaveTextContent("SNAPSHOT");
    expect(screen.getByTestId("report-actions")).toHaveTextContent("IMPLEMENT");
    expect(screen.getByTestId("carrier-message")).not.toHaveTextContent(
      "A fabricated response"
    );
    expect(screen.queryByTestId("completion-message")).not.toBeInTheDocument();
  });

  it("routes startup plan reports to the interactive field path", () => {
    const conversationMessage = createMockConversationMessage({
      message: {
        ...createMockConversationMessage().message,
        reports: [
          {
            id: "startup-plan-report-1",
            organizationId: "org-1",
            audience: ReportAudience.ProjectVisible,
            version: 1,
            schemaVersion: 1,
            sourceExecutionId: "run-1",
            createdAt: "2026-06-30T00:00:00.000Z",
            expiresAt: null,
            entities: [],
            reportType: ReportType.Plan,
            title: "Startup Plan",
            payload: {},
          },
        ],
        data: {
          type: "QUESTIONS",
          response: "",
          uiElements: [
            {
              id: "startup-plan-field",
              type: "coding_prompt_startup_plan",
              label: "Startup plan",
            },
          ],
        },
      } as never,
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
      />
    );

    expect(screen.getByTestId("report-actions")).toBeEmptyDOMElement();
    expect(
      screen.getByTestId("form-renderer-interactive-reports")
    ).toHaveTextContent("PLAN");
    expect(
      screen.getByTestId("form-renderer-interactive-reports")
    ).toHaveAttribute("data-source-ui-element-id", "startup-plan-field");
    expect(
      screen.queryByTestId("system-message-retry")
    ).not.toBeInTheDocument();
  });

  it("routes carried PLAN reports through report configuration", () => {
    const conversationMessage = createMockConversationMessage({
      canEdit: false,
      message: {
        ...createMockConversationMessage().message,
        reports: [
          {
            id: "carried-plan-report",
            organizationId: "org-1",
            audience: ReportAudience.ProjectVisible,
            version: 1,
            schemaVersion: 1,
            sourceExecutionId: "run-1",
            createdAt: "2026-08-20T00:00:00.000Z",
            expiresAt: null,
            entities: [],
            reportType: ReportType.Plan,
            title: "Carried startup plan",
            payload: {},
          },
        ],
        data: {
          type: "AGENT",
          response: "Prepared the implementation plan.",
        },
      } as never,
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
      />
    );

    expect(
      screen.getByTestId("form-renderer-interactive-reports")
    ).toHaveTextContent("PLAN");
    expect(
      screen.getByTestId("form-renderer-interactive-reports")
    ).toHaveAttribute(
      "data-source-ui-element-id",
      "coding_prompt_startup_plan"
    );
    expect(
      screen.getByTestId("form-renderer-inline-reports")
    ).toBeEmptyDOMElement();
  });

  it("routes explicitly associated modal reports to the modal action surface", () => {
    vi.mocked(getReportConfig).mockReturnValueOnce({ presentation: "modal" });
    const conversationMessage = createMockConversationMessage({
      message: {
        ...createMockConversationMessage().message,
        reports: [
          {
            id: "modal-report-1",
            organizationId: "org-1",
            audience: ReportAudience.ProjectVisible,
            version: 1,
            schemaVersion: 1,
            sourceExecutionId: "run-1",
            createdAt: "2026-08-20T00:00:00.000Z",
            expiresAt: "2026-08-21T00:00:00.000Z",
            entities: [],
            reportType: ReportType.Snapshot,
            title: "Modal snapshot",
            payload: {},
          },
        ],
        data: {
          type: "AGENT",
          response: "The snapshot is ready to review.",
        },
      } as never,
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
      />
    );

    expect(screen.getByTestId("report-actions")).toHaveTextContent(
      "SNAPSHOT"
    );
    expect(
      screen.getByTestId("form-renderer-inline-reports")
    ).toBeEmptyDOMElement();
    expect(
      screen.getByTestId("system-message-retry-inline-reports")
    ).toBeEmptyDOMElement();
  });

  it("does not render an inline attachment when the response mentions that report", () => {
    const conversationMessage = createMockConversationMessage({
      message: {
        ...createMockConversationMessage().message,
        reports: [
          {
            id: "snapshot-report-1",
            organizationId: "org-1",
            audience: ReportAudience.ProjectVisible,
            version: 1,
            schemaVersion: 1,
            sourceExecutionId: "run-1",
            createdAt: "2026-07-22T00:00:00.000Z",
            expiresAt: null,
            entities: [],
            reportType: ReportType.Snapshot,
            title: "Snapshot report",
            payload: {},
          },
        ],
        data: {
          type: "AGENT",
          response:
            "See @[report:snapshot-report-1|Snapshot report] for the details.",
        },
      } as never,
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
      />
    );

    expect(
      screen.getByTestId("system-message-retry-inline-reports")
    ).toBeEmptyDOMElement();
    expect(screen.getByTestId("report-actions")).toBeEmptyDOMElement();
  });

  it("keeps attachments whose IDs do not match a report mention", () => {
    const conversationMessage = createMockConversationMessage({
      message: {
        ...createMockConversationMessage().message,
        reports: [
          {
            id: "attached-report-1",
            organizationId: "org-1",
            audience: ReportAudience.ProjectVisible,
            version: 1,
            schemaVersion: 1,
            sourceExecutionId: "run-1",
            createdAt: "2026-07-22T00:00:00.000Z",
            expiresAt: null,
            entities: [],
            reportType: ReportType.Snapshot,
            title: "Attached report",
            payload: {},
          },
        ],
        data: {
          type: "AGENT",
          response: "See @\\[report:another-report-1\\|Another report].",
        },
      } as never,
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
      />
    );

    expect(
      screen.getByTestId("system-message-retry-inline-reports")
    ).toHaveTextContent("SNAPSHOT");
  });

  it("always renders ConversationFormRenderer", () => {
    const conversationMessage = createMockConversationMessage();

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
      />
    );

    expect(screen.getByTestId("form-renderer")).toBeInTheDocument();
  });

  it("passes unmentioned Feature Sync reports as interactive attachments", () => {
    const conversationMessage = createMockConversationMessage({
      message: {
        ...createMockConversationMessage().message,
        reports: [
          {
            id: "feature-sync-decision-report",
            organizationId: "org-1",
            audience: ReportAudience.ProjectVisible,
            version: 1,
            schemaVersion: 2,
            sourceExecutionId: "run-1",
            createdAt: "2026-07-22T00:00:00.000Z",
            expiresAt: null,
            entities: [],
            reportType: ReportType.FeatureSyncDecision,
            title: "Feature Sync Decision",
            payload: {
              reportType: "FEATURE_SYNC_DECISION",
              summary: "Review the grouped decisions.",
              decisionGroups: [],
            },
          },
        ],
        data: {
          type: "AGENT",
          response: "Reviewing feature sync...",
          uiElements: [{ id: "interstitial", type: "interstitial", label: "" }],
        },
      } as never,
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
      />
    );

    expect(
      screen.getByTestId("form-renderer-inline-reports")
    ).toBeEmptyDOMElement();
    expect(
      screen.getByTestId("form-renderer-interactive-reports")
    ).toHaveTextContent("FEATURE_SYNC_DECISION");
    expect(
      screen.queryByTestId("system-message-retry-inline-reports")
    ).not.toBeInTheDocument();
  });

  it("keeps response-capable Feature Sync reports attached when the response mentions them", () => {
    const conversationMessage = createMockConversationMessage({
      message: {
        ...createMockConversationMessage().message,
        reports: [
          {
            id: "feature-sync-decision-report",
            organizationId: "org-1",
            audience: ReportAudience.ProjectVisible,
            version: 1,
            schemaVersion: 2,
            sourceExecutionId: "run-1",
            createdAt: "2026-07-22T00:00:00.000Z",
            expiresAt: null,
            entities: [],
            reportType: ReportType.FeatureSyncDecision,
            title: "Feature Sync Decision",
            payload: {
              reportType: "FEATURE_SYNC_DECISION",
              summary: "Review the grouped decisions.",
              decisionGroups: [],
            },
          },
        ],
        data: {
          type: "AGENT",
          response:
            "Please choose how to resolve this in @[report:feature-sync-decision-report|Feature Sync Decision].",
        },
      } as never,
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
      />
    );

    expect(
      screen.getByTestId("form-renderer-interactive-reports")
    ).toHaveTextContent("FEATURE_SYNC_DECISION");
    expect(
      screen.getByTestId("system-message-retry-inline-reports")
    ).toBeEmptyDOMElement();
  });

  it("renders USER messages as user bubbles", () => {
    const conversationMessage = createMockConversationMessage({
      message: {
        ...createMockConversationMessage().message,
        type: MessageType.User,
        data: {
          comment: "User prompt text",
          text: "User prompt text",
          source: "coding_prompt",
        },
      },
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
      />
    );

    expect(screen.getByTestId("user-message-msg-1")).toBeInTheDocument();
    expect(screen.getByText("User prompt text")).toBeInTheDocument();
  });

  it("renders grouped proposals attached to a USER message", () => {
    const groupedProposal: ProposalResponseDto = {
      id: "proposal-1",
      organizationId: "org-1",
      projectId: "project-1",
      groupMembership: {
        groupId: "group-1",
        memberId: "member-1",
        memberOrder: 0,
        revision: 1,
        lifecycle: ProposalGroupLifecycle.Reviewable,
      },
      type: ProposalType.Single,
      action: ProposalAction.Create,
      status: ProposalStatus.Draft,
      targetEntityId: "target-1",
      targetEntityType: TargetEntityType.Task,
      updates: {},
      requestorId: "requestor-1",
      requiredApprovals: 1,
      approvals: [],
      createdAt: "2024-01-01T00:00:00Z",
      updatedAt: "2024-01-01T00:00:00Z",
    };
    const conversationMessage = createMockConversationMessage({
      message: {
        ...createMockConversationMessage().message,
        type: MessageType.User,
        data: {
          comment: "User prompt text",
        },
        proposals: [groupedProposal],
      },
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
      />
    );

    expect(screen.getByTestId("user-message-msg-1")).toBeInTheDocument();
    expect(screen.getByTestId("message-proposals")).toBeInTheDocument();
  });

  it("keeps ordinary USER text as human-authored without provenance", () => {
    const conversationMessage = createMockConversationMessage({
      message: {
        ...createMockConversationMessage().message,
        type: MessageType.User,
        data: {
          comment: "session_monitor",
          text: "session_monitor",
        },
        user: {
          id: "user-1",
          name: "Alice Smith",
          email: "alice@example.com",
          isActive: true,
          createdAt: "2024-01-01T00:00:00Z",
        },
      },
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
      />
    );

    expect(screen.getByTestId("user-message-msg-1")).toBeInTheDocument();
    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
    expect(screen.queryByTestId("agent-caption-msg-1")).not.toBeInTheDocument();
  });

  it("renders session-monitor provenance USER messages with the monitor treatment", () => {
    const conversationMessage = createMockConversationMessage({
      message: {
        ...createMockConversationMessage().message,
        type: MessageType.User,
        data: {
          agentInput: {
            promptType: "free_form",
            userMessage: "monitor-authored reply",
            provenance: UserMessageAgentInputProvenance.SessionMonitor,
          },
        } as never,
        user: {
          id: "user-1",
          name: "Alice Smith",
          email: "alice@example.com",
          isActive: true,
          createdAt: "2024-01-01T00:00:00Z",
        },
      },
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
      />
    );

    expect(screen.getByTestId("user-message-msg-1")).toHaveAttribute(
      "data-user-message-provenance",
      UserMessageAgentInputProvenance.SessionMonitor
    );
    expect(screen.getByTestId("agent-caption-msg-1")).toHaveTextContent(
      "Auto-run Agent"
    );
    expect(screen.queryByText("Alice Smith")).not.toBeInTheDocument();
    expect(screen.getByText("monitor-authored reply")).toBeInTheDocument();
  });

  it("renders task-monitor provenance USER messages with the monitor treatment", () => {
    const conversationMessage = createMockConversationMessage({
      message: {
        ...createMockConversationMessage().message,
        type: MessageType.User,
        data: {
          agentInput: {
            promptType: "coding_freeform",
            userMessage: "task-monitor guidance",
            provenance: UserMessageAgentInputProvenance.TaskMonitor,
          },
        },
        user: {
          id: "user-1",
          name: "Alice Smith",
          email: "alice@example.com",
          isActive: true,
          createdAt: "2024-01-01T00:00:00Z",
        },
      },
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
      />
    );

    expect(screen.getByTestId("user-message-msg-1")).toHaveAttribute(
      "data-user-message-provenance",
      UserMessageAgentInputProvenance.TaskMonitor
    );
    expect(screen.getByTestId("agent-caption-msg-1")).toHaveTextContent(
      "Auto-run Agent"
    );
    expect(screen.queryByText("Alice Smith")).not.toBeInTheDocument();
    expect(screen.getByText("task-monitor guidance")).toBeInTheDocument();
  });

  it("does not render timestamps by default", () => {
    const conversationMessage = createMockConversationMessage();

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
      />
    );

    expect(
      screen.queryByTestId("message-timestamp-msg-1")
    ).not.toBeInTheDocument();
  });

  it("renders timestamp for SYSTEM messages when enabled", () => {
    const conversationMessage = createMockConversationMessage();

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
        renderTimestamp={true}
      />
    );

    expect(screen.getByTestId("message-timestamp-msg-1")).toBeInTheDocument();
  });

  it("renders timestamp for USER messages when enabled", () => {
    const conversationMessage = createMockConversationMessage({
      message: {
        ...createMockConversationMessage().message,
        type: MessageType.User,
        data: {
          comment: "User prompt text",
        },
      },
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
        renderTimestamp={true}
      />
    );

    expect(screen.getByTestId("message-timestamp-msg-1")).toBeInTheDocument();
  });

  it("marks a non-final interstitial as thought even when its own state is still open", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T07:08:21Z"));
    const timestamp = "2026-08-22T07:08:16Z";
    const conversationMessage = createMockConversationMessage({
      canEdit: true,
      state: "open",
      message: {
        ...createMockConversationMessage().message,
        status: "OPEN",
        data: {
          type: "AGENT",
          response: `Previous narration -- ${timestamp}`,
          uiElements: [{ id: "interstitial", type: "interstitial", label: "" }],
        },
      } as never,
    });
    vi.mocked(useConversationContext).mockReturnValue({
      ...mockConversationContext,
      conversationTimeline: [
        conversationMessage,
        createMockConversationMessage({
          message: {
            ...createMockConversationMessage().message,
            id: "msg-2",
            createdAt: "2026-08-22T07:08:21Z",
          },
        }),
      ],
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={2}
        renderTimestamp
      />
    );

    expect(screen.getByTestId("agent-caption-msg-1")).toHaveTextContent(
      "thought for 5s"
    );
    expect(screen.getByTestId("agent-caption-msg-1")).not.toHaveTextContent(
      "thinking"
    );
    vi.useRealTimers();
  });

  it("keeps the final open interstitial in thinking state", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-22T07:08:21Z"));
    const conversationMessage = createMockConversationMessage({
      canEdit: true,
      state: "open",
      message: {
        ...createMockConversationMessage().message,
        status: "OPEN",
        data: {
          type: "AGENT",
          response: "Current narration -- 2026-08-22T07:08:16Z",
          uiElements: [{ id: "interstitial", type: "interstitial", label: "" }],
        },
      } as never,
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={1}
        totalMessages={2}
        renderTimestamp
      />
    );

    expect(screen.getByTestId("agent-caption-msg-1")).toHaveTextContent(
      "thinking for 5s"
    );
    vi.useRealTimers();
  });

  it.each([
    AgentSessionCurrentState.Writing,
    AgentSessionCurrentState.AwaitingApproval,
    AgentSessionCurrentState.Idle,
  ])(
    "freezes a trailing interstitial when the Run phase is %s",
    (currentState) => {
      vi.useFakeTimers();
      vi.setSystemTime(new Date("2026-08-22T07:08:30Z"));
      const conversationMessage = createMockConversationMessage({
        canEdit: true,
        state: "open",
        message: {
          ...createMockConversationMessage().message,
          status: "OPEN",
          data: {
            type: "AGENT",
            response:
              "First narration -- 2026-08-22T07:08:16Z\n──────────\nFinal narration -- 2026-08-22T07:08:23Z",
            uiElements: [
              { id: "interstitial", type: "interstitial", label: "" },
            ],
          },
        } as never,
      });
      vi.mocked(useConversationContext).mockReturnValue({
        ...mockConversationContext,
        conversationTimeline: [conversationMessage],
        agentSessionId: "agent-session-1",
        agentSessionCurrentState: currentState,
      });

      const { rerender } = render(
        <ConversationMessage
          conversationMessage={conversationMessage}
          messageIndex={0}
          totalMessages={1}
          renderTimestamp
        />
      );

      expect(screen.getByTestId("agent-caption-msg-1")).toHaveTextContent(
        "thought for 7s"
      );

      vi.mocked(useConversationContext).mockReturnValue({
        ...mockConversationContext,
        conversationTimeline: [conversationMessage],
        agentSessionId: "agent-session-1",
        agentSessionCurrentState: AgentSessionCurrentState.Thinking,
      });
      rerender(
        <ConversationMessage
          conversationMessage={{ ...conversationMessage }}
          messageIndex={0}
          totalMessages={1}
          renderTimestamp
        />
      );

      expect(screen.getByTestId("agent-caption-msg-1")).toHaveTextContent(
        "thinking for 14s"
      );
      vi.useRealTimers();
    }
  );

  it("uses the requested MUI spacing for the interstitial agent caption", () => {
    const conversationMessage = createMockConversationMessage({
      message: {
        ...createMockConversationMessage().message,
        data: {
          type: "AGENT",
          response: "Current narration",
          uiElements: [{ id: "interstitial", type: "interstitial", label: "" }],
        },
      } as never,
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
        renderTimestamp
      />
    );

    const caption = window.getComputedStyle(
      screen.getByTestId("agent-caption-msg-1")
    );
    expect(caption.marginLeft).toBe("40px");
    expect(caption.marginTop).toBe("4px");
    expect(caption.marginBottom).toBe("20px");
  });

  it("does not render system components for USER messages", () => {
    const conversationMessage = createMockConversationMessage({
      message: {
        ...createMockConversationMessage().message,
        type: MessageType.User,
        data: {
          comment: "User prompt text",
        },
      },
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
      />
    );

    expect(
      screen.queryByTestId("system-message-retry")
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId("form-renderer")).not.toBeInTheDocument();
  });

  it("renders single-field USER form payloads as plain text", () => {
    const feedbackText =
      "ok, so as part of the confused last task, we ended up implementing the activity dropdown.";
    const conversationMessage = createMockConversationMessage({
      message: {
        ...createMockConversationMessage().message,
        type: MessageType.User,
        data: {
          task_feedback: feedbackText,
        },
      },
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
      />
    );

    expect(screen.getByText(feedbackText)).toBeInTheDocument();
  });

  it.each([
    {
      label: "feature-sync Done",
      action: "DISMISSED",
      payload: {},
    },
    {
      label: "review approval",
      action: "approve_all",
      payload: { approval: true },
    },
  ])(
    "does not render $label structured metadata as prose",
    ({ action, payload }) => {
      const conversationMessage = createMockConversationMessage({
        message: {
          ...createMockConversationMessage().message,
          type: MessageType.User,
          data: {
            action,
            payload,
            nodeId: "review-step",
            workflowAnswerOperationId: "operation-1",
            comment: " \n\t ",
          },
        },
      });

      render(
        <ConversationMessage
          conversationMessage={conversationMessage}
          messageIndex={0}
          totalMessages={1}
        />
      );

      expect(
        screen.queryByTestId("user-message-msg-1")
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(/plan_shaping_feature_sync_review_done/)
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText(/workflowAnswerOperationId/)
      ).not.toBeInTheDocument();
    }
  );

  it("renders workflow-answer feedback verbatim without exposing its action envelope", () => {
    const feedbackText = "Keep the completed items as-is.";
    const conversationMessage = createMockConversationMessage({
      message: {
        ...createMockConversationMessage().message,
        type: MessageType.User,
        data: {
          action: "approve_all",
          payload: { approval: true },
          nodeId: "review-step",
          workflowAnswerOperationId: "operation-1",
          comment: feedbackText,
        },
      },
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
      />
    );

    expect(screen.getByTestId("user-message-msg-1")).toHaveTextContent(
      feedbackText
    );
    expect(screen.queryByText(/approve_all/)).not.toBeInTheDocument();
    expect(
      screen.queryByText(/workflowAnswerOperationId/)
    ).not.toBeInTheDocument();
  });

  it("renders agentInput.userMessage as the USER bubble text", () => {
    const conversationMessage = createMockConversationMessage({
      message: {
        ...createMockConversationMessage().message,
        type: MessageType.User,
        data: {
          agentInput: { promptType: "free_form", userMessage: "just say hi!" },
        } as never,
      },
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
      />
    );

    expect(screen.getByText("just say hi!")).toBeInTheDocument();
    expect(screen.queryByText(/```json/)).not.toBeInTheDocument();
  });

  it("renders Review display text instead of the executable agentInput envelope", () => {
    const conversationMessage = createMockConversationMessage({
      message: {
        ...createMockConversationMessage().message,
        type: MessageType.User,
        data: {
          comment:
            "Review the changes made during this session\n\nFocus on error handling.",
          agentInput: {
            promptType: "code_review",
            userMessage: "Focus on error handling.",
            provider: "claude",
            model: "claude-sonnet-4-6",
            reasoningEffort: "high",
            fastMode: false,
          },
        } as never,
      },
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
      />
    );

    expect(screen.getByTestId("user-message-msg-1")).toHaveTextContent(
      "Review the changes made during this session"
    );
    expect(screen.getByTestId("user-message-msg-1")).toHaveTextContent(
      "Focus on error handling."
    );
    expect(screen.queryByText(/claude-sonnet-4-6/)).not.toBeInTheDocument();
    expect(screen.queryByText(/```json/)).not.toBeInTheDocument();
  });

  it("displays user name on user messages when user is present", () => {
    const conversationMessage = createMockConversationMessage({
      message: {
        ...createMockConversationMessage().message,
        type: MessageType.User,
        data: { comment: "Hello" },
        user: {
          id: "user-1",
          name: "Alice Smith",
          email: "alice@example.com",
          isActive: true,
          createdAt: "2024-01-01T00:00:00Z",
        },
      },
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
      />
    );

    expect(screen.getByText("Alice Smith")).toBeInTheDocument();
  });

  it("does not display user name on user messages when user is absent", () => {
    const conversationMessage = createMockConversationMessage({
      message: {
        ...createMockConversationMessage().message,
        type: MessageType.User,
        data: { comment: "Hello" },
      },
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
      />
    );

    expect(
      screen.queryByTestId(`message-timestamp-msg-1`)
    ).not.toBeInTheDocument();
  });

  it("applies correct margin bottom styling", () => {
    const conversationMessage = createMockConversationMessage();

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
      />
    );

    const container = screen.getByTestId("msg-1");
    expect(window.getComputedStyle(container).marginBottom).toBe("80px");
  });

  it("passes correct props to child components", () => {
    const conversationMessage = createMockConversationMessage({
      message: {
        ...createMockConversationMessage().message,
        data: {
          type: "QUESTIONS",
          response: "Test response",
          uiHints: { title: "Test Title" },
        },
      },
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={2}
        totalMessages={5}
      />
    );

    // All child components should be rendered
    expect(screen.getByTestId("system-message-retry")).toBeInTheDocument();
    expect(screen.getByTestId("form-renderer")).toBeInTheDocument();

    // Container should have correct step index
    expect(screen.getByTestId("msg-1")).toHaveAttribute("data-step-index", "2");
  });

  it("renders agent caption with tooltip when AGENT message has providerSessionId and promptHandler", () => {
    const agentData: AgentSystemMessageData = {
      type: "AGENT",
      response: "Agent response",
      detectedIntent: "test_intent",
      intentConfidence: 0.95,
      providerSessionId: "provider-session-123",
      promptHandler: "coding_prompt",
    };
    const conversationMessage = createMockConversationMessage({
      message: {
        ...createMockConversationMessage().message,
        type: MessageType.System,
        data: agentData,
      },
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
      />
    );

    expect(screen.getByTestId("agent-caption-msg-1")).toBeInTheDocument();
    const tooltipAnchor = screen.getByTestId("agent-caption-tooltip-msg-1");
    expect(tooltipAnchor).toBeInTheDocument();
    expect(tooltipAnchor).toHaveTextContent("Coding Prompt agent");
  });

  it("renders agent caption without tooltip wrapper when AGENT fields are absent", () => {
    const agentData: AgentSystemMessageData = {
      type: "AGENT",
      response: "Agent response",
      detectedIntent: "test_intent",
      intentConfidence: 0.95,
    };
    const conversationMessage = createMockConversationMessage({
      message: {
        ...createMockConversationMessage().message,
        type: MessageType.System,
        data: agentData,
      },
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
      />
    );

    const caption = screen.getByTestId("agent-caption-msg-1");
    expect(caption).toBeInTheDocument();
    expect(caption).toHaveTextContent("Agent");
    expect(
      screen.queryByTestId("agent-caption-tooltip-msg-1")
    ).not.toBeInTheDocument();
  });

  it("does not render agent caption for USER messages", () => {
    const conversationMessage = createMockConversationMessage({
      message: {
        ...createMockConversationMessage().message,
        type: MessageType.User,
        data: {
          comment: "User prompt text",
        },
      },
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
      />
    );

    expect(screen.queryByTestId("agent-caption-msg-1")).not.toBeInTheDocument();
    expect(screen.getByTestId("user-message-msg-1")).toBeInTheDocument();
  });

  it("renders proposals after the form for default-config elements", () => {
    const conversationMessage = createMockConversationMessage({
      message: {
        ...createMockConversationMessage().message,
        data: {
          type: "QUESTIONS",
          response: "Test response",
          uiHints: { title: "Test Title" },
          uiElements: [
            {
              id: "field-1",
              type: "textarea",
              payload: {},
            },
          ],
        },
      },
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
      />
    );

    const form = screen.getByTestId("form-renderer");
    const proposals = screen.getByTestId("message-proposals");
    expect(form).toBeInTheDocument();
    expect(proposals).toBeInTheDocument();
    expect(
      form.compareDocumentPosition(proposals) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("renders proposals before the form for agent-reply-textarea", () => {
    const conversationMessage = createMockConversationMessage({
      message: {
        ...createMockConversationMessage().message,
        data: {
          type: "QUESTIONS",
          response: "Test response",
          uiHints: { title: "Test Title" },
          uiElements: [
            {
              id: "field-1",
              type: "agent-reply-textarea",
              payload: {},
            },
          ],
        },
      },
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
      />
    );

    const systemMessage = screen.getByTestId("system-message-retry");
    const proposals = screen.getByTestId("message-proposals");
    const form = screen.getByTestId("form-renderer");
    expect(
      systemMessage.compareDocumentPosition(proposals) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
    expect(
      proposals.compareDocumentPosition(form) & Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it("omits proposals when the registry entry sets autoRenderProposals to false", () => {
    vi.mocked(getProposalsRenderConfig).mockReturnValueOnce({
      autoRender: false,
      placement: "below-element",
    });

    const conversationMessage = createMockConversationMessage({
      message: {
        ...createMockConversationMessage().message,
        data: {
          type: "QUESTIONS",
          response: "Test response",
          uiHints: { title: "Test Title" },
          uiElements: [
            {
              id: "field-1",
              type: "textarea",
              payload: {},
            },
          ],
        },
      },
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
      />
    );

    expect(screen.getByTestId("form-renderer")).toBeInTheDocument();
    expect(screen.queryByTestId("message-proposals")).not.toBeInTheDocument();
  });

  it("handles complex message states correctly", () => {
    const conversationMessage = createMockConversationMessage({
      state: "system_processing",
      message: {
        ...createMockConversationMessage().message,
        data: {
          type: "QUESTIONS",
          uiHints: { title: "Processing Title" },
        },
      },
    });

    render(
      <ConversationMessage
        conversationMessage={conversationMessage}
        messageIndex={0}
        totalMessages={1}
      />
    );

    // Should not render SystemMessageWithRetry for processing state without response
    expect(
      screen.queryByTestId("system-message-retry")
    ).not.toBeInTheDocument();

    // Should still render form renderer
    expect(screen.getByTestId("form-renderer")).toBeInTheDocument();
  });
});
